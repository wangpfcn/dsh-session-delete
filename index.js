/**
 * dsh-session-delete — 工作区侧栏「删除会话 / 归档全部会话 / 删除全部会话 / 恢复归档会话」（Host 半）
 *
 * 能力：
 *   - 在 ctx.webServer 注册 POST /dsh-session-delete/{delete,delete-all,archive-all,restore,restore-all}
 *     路由，浏览器同源 fetch 调用（客户端半见 client.js）；
 *   - 删除 = 受限沙箱内移除会话日志目录（workspace-write，root 限定该会话所属
 *     项目目录），成功后才归档隐藏 + 从工作区账目 detach（先文件后簿记，
 *     失败时行保持可见、错误直达对话框）；
 *   - 恢复 = 从归档集合移除会话，并优先放回原工作区；如果原工作区注册已删除，
 *     则按会话头里的 cwd 自动重建工作区，再把会话挂回该工作区。
 *   - 活跃（本进程内 live）会话拒绝删除，防止误删运行中/已打开会话。
 *
 * 挂载（profile 的 cordis.patch.yml）：
 *   - insert:
 *       - id: dsh-session-delete
 *         name: dsh-session-delete
 *
 * 依赖服务（inject）：webServer、shell、sessionPersistence、workspaceRegistry、sessions。
 */
import { realpathSync } from 'node:fs'

const MODULE = '[dsh-session-delete]';

function log(...args) {
  console.error(MODULE, ...args);
}

function textOf(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v.text === 'string') return v.text;
  try {
    return String(v);
  } catch {
    return '';
  }
}

function dirname(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i <= 0 ? '' : p.slice(0, i);
}

/** POSIX 单引号转义：bash 双引号内特殊字符（$ ` \ !）在此全部保持字面量。 */
function shSingle(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/**
 * 按路径分隔符分派删除命令：/-路径走 POSIX bash rm，\-路径走 pwsh
 * Remove-Item（win32 部署组合的是 pwsh 执行器）。
 */
function removalCommand(dir, isWin) {
  if (isWin) {
    const lit = "'" + String(dir).replace(/'/g, "''") + "'";
    return 'Remove-Item -LiteralPath ' + lit + ' -Recurse -Force -ErrorAction Stop';
  }
  return 'rm -rf -- ' + shSingle(dir);
}

/** 收集并解析 JSON 请求体；空体返回 {}，非法 JSON 返回 null。 */
async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** 尝试解析为真实路径；目录已不存在时退回原值，交给 registry.create 自行判定。 */
function canonicalPath(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * 删除一个会话：live 拒绝 → 定位日志 → 沙箱 rm 目录 → 归档 + detach 簿记。
 * 结果写入 report（deleted/live/missing/failed 四类）。
 */
async function deleteOne(deps, id, report) {
  if (deps.sessions.get(id) !== undefined) {
    report.live.push(id);
    return;
  }
  let header;
  try {
    const headers = await deps.persistence.list();
    header = Array.isArray(headers) ? headers.find((h) => h && h.id === id) : undefined;
  } catch (e) {
    report.failed.push({ id, code: 'list-failed', detail: textOf(e && e.message) });
    return;
  }
  if (header === undefined) {
    report.missing.push(id);
    return;
  }
  let loc;
  try {
    loc = deps.persistence.locate(header);
  } catch {
    loc = undefined;
  }
  if (loc === undefined || typeof loc.path !== 'string' || loc.path === '') {
    report.failed.push({ id, code: 'no-location' });
    return;
  }
  const dir = dirname(loc.path);
  const parent = dirname(dir);
  if (dir === '' || parent === '') {
    report.failed.push({ id, code: 'bad-path' });
    return;
  }
  /* 1) 先删文件：受限沙箱（root=该项目目录）。失败则无任何状态变化。 */
  let res;
  try {
    const spec = await deps.shell.resolve({
      command: removalCommand(dir, loc.path.indexOf('\\') !== -1),
      timeoutMs: 30_000,
      sandboxPolicy: { mode: 'workspace-write', workspaceRoot: parent },
    });
    res = await deps.shell.run(spec);
  } catch (e) {
    report.failed.push({ id, code: 'run-error', detail: textOf(e && e.message) });
    return;
  }
  const denied = res.sandbox !== undefined && res.sandbox.denied === true;
  if (res.exitCode !== 0) {
    report.failed.push({ id, code: denied ? 'sandbox-denied' : 'rm-failed', detail: textOf(res.stderr) });
    return;
  }
  /* 2) 文件已删，做簿记：归档隐藏 + 工作区账目 detach。失败仅影响显示。 */
  try {
    await deps.registry.archiveSession(id);
  } catch {
    /* 已归档或竞态：忽略 */
  }
  try {
    for (const w of deps.registry.list()) {
      if (w.sessionIds.includes(id)) {
        await w.detachSession(id);
        break;
      }
    }
  } catch {
    /* 下次重启自愈 */
  }
  report.deleted.push(id);
}

/** 从工作区注册表全局归档集合移除一个会话（官方无公开 unarchive API，直接写 domain state）。 */
async function unarchive(reg, id) {
  const state = reg.state;
  if (!state || !Array.isArray(state.archivedSessionIds)) {
    throw new Error('workspace registry state is unavailable');
  }
  if (!state.archivedSessionIds.some((x) => String(x) === String(id))) return;
  const next = {
    ...state,
    archivedSessionIds: state.archivedSessionIds.filter((x) => String(x) !== String(id)),
  };
  if (typeof reg.global?.set !== 'function') {
    throw new Error('workspace registry global handle is unavailable');
  }
  await reg.global.set(next);
  reg.state = next;
}

/**
 * 恢复一个已归档会话：
 *   - 优先放回原工作区（会话头 cwd 与现存 workspace 路径匹配；
 *     DSH 归档不会删除 sessionIds 席位，所以原工作区存在时可以直接恢复位置）；
 *   - 原工作区注册已删除时，按 cwd 自动 create 工作区再 attach；
 *   - 最后从全局归档集合移除。
 */
async function restoreOne(deps, id, report) {
  const reg = deps.registry;
  const archived = new Set([...reg.archivedSessionIds].map(String));
  if (!archived.has(String(id))) {
    report.notArchived.push(id);
    return;
  }

  let header;
  try {
    const headers = await deps.persistence.list();
    header = Array.isArray(headers) ? headers.find((h) => h && h.id === id) : undefined;
  } catch (e) {
    report.failed.push({ id, code: 'list-failed', detail: textOf(e && e.message) });
    return;
  }
  if (header === undefined) {
    report.missing.push(id);
    return;
  }

  const cwd = typeof header.cwd === 'string' && header.cwd !== '' ? header.cwd : undefined;
  if (!cwd) {
    report.failed.push({ id, code: 'no-cwd', detail: 'session header carries no cwd; cannot recreate its workspace' });
    return;
  }

  const resolved = canonicalPath(cwd);
  let workspace = reg.list().find((w) => w.path === resolved || w.path === cwd);
  let created = false;
  if (workspace === undefined) {
    try {
      workspace = await reg.create(cwd);
      created = true;
    } catch (e) {
      report.failed.push({ id, code: 'workspace-create-failed', detail: textOf(e && e.message) });
      return;
    }
  }

  try {
    await workspace.attachSession(id);
  } catch (e) {
    report.failed.push({ id, code: 'attach-failed', detail: textOf(e && e.message) });
    return;
  }

  try {
    await unarchive(reg, id);
  } catch (e) {
    report.failed.push({ id, code: 'unarchive-failed', detail: textOf(e && e.message) });
    return;
  }

  report.restored.push({ id, workspaceId: workspace.id, workspacePath: workspace.path, created });
}

/** 从一批 id 中逐个恢复；用于单会话和工作区/全局批量恢复。 */
async function restoreMany(deps, ids, report) {
  for (const id of ids) {
    await restoreOne(deps, id, report);
  }
}

export default {
  name: 'dsh-session-delete',
  inject: ['webServer', 'shell', 'sessionPersistence', 'workspaceRegistry', 'sessions'],
  apply(ctx) {
    const deps = {
      shell: ctx.shell,
      persistence: ctx.sessionPersistence,
      registry: ctx.workspaceRegistry,
      sessions: ctx.sessions,
    };

    const routes = [
      {
        path: '/dsh-session-delete/delete',
        handler: async (req, res) => {
          const body = await readJsonBody(req);
          if (body === null || typeof body.sessionId !== 'string' || body.sessionId === '') {
            sendJson(res, 400, { ok: false, code: 'bad-args' });
            return;
          }
          const report = { deleted: [], live: [], missing: [], failed: [] };
          await deleteOne(deps, body.sessionId, report);
          if (report.deleted.length > 0) sendJson(res, 200, { ok: true });
          else if (report.live.length > 0) sendJson(res, 409, { ok: false, code: 'live' });
          else if (report.missing.length > 0) sendJson(res, 404, { ok: false, code: 'missing' });
          else {
            const f = report.failed[0];
            sendJson(res, 500, { ok: false, code: f === undefined ? 'unknown' : f.code, detail: f === undefined ? '' : f.detail });
          }
        },
      },
      {
        path: '/dsh-session-delete/delete-all',
        handler: async (req, res) => {
          const body = await readJsonBody(req);
          if (body === null || typeof body.workspaceId !== 'string' || body.workspaceId === '') {
            sendJson(res, 400, { ok: false, code: 'bad-args' });
            return;
          }
          const w = deps.registry.get(body.workspaceId);
          if (w === undefined) {
            sendJson(res, 404, { ok: false, code: 'unknown-workspace' });
            return;
          }
          const report = { deleted: [], live: [], missing: [], failed: [] };
          for (const id of [...w.sessionIds]) await deleteOne(deps, id, report);
          sendJson(res, 200, {
            ok: true,
            deleted: report.deleted.length,
            live: report.live.length,
            missing: report.missing.length,
            failed: report.failed,
          });
        },
      },
      {
        path: '/dsh-session-delete/archive-all',
        handler: async (req, res) => {
          const body = await readJsonBody(req);
          if (body === null || typeof body.workspaceId !== 'string' || body.workspaceId === '') {
            sendJson(res, 400, { ok: false, code: 'bad-args' });
            return;
          }
          const w = deps.registry.get(body.workspaceId);
          if (w === undefined) {
            sendJson(res, 404, { ok: false, code: 'unknown-workspace' });
            return;
          }
          const archivedSet = new Set(deps.registry.archivedSessionIds);
          let count = 0;
          const failed = [];
          for (const id of [...w.sessionIds]) {
            if (archivedSet.has(id)) continue;
            try {
              await deps.registry.archiveSession(id);
              count += 1;
            } catch {
              failed.push(id);
            }
          }
          sendJson(res, 200, { ok: true, archived: count, failed });
        },
      },
      {
        path: '/dsh-session-delete/restore',
        handler: async (req, res) => {
          const body = await readJsonBody(req);
          if (body === null || typeof body.sessionId !== 'string' || body.sessionId === '') {
            sendJson(res, 400, { ok: false, code: 'bad-args' });
            return;
          }
          const report = { restored: [], notArchived: [], missing: [], failed: [] };
          await restoreOne(deps, body.sessionId, report);
          if (report.restored.length > 0) {
            sendJson(res, 200, { ok: true, restored: report.restored[0] });
          } else if (report.notArchived.length > 0) {
            sendJson(res, 200, { ok: false, code: 'not-archived' });
          } else if (report.missing.length > 0) {
            sendJson(res, 404, { ok: false, code: 'missing' });
          } else {
            const f = report.failed[0];
            sendJson(res, 500, { ok: false, code: f === undefined ? 'unknown' : f.code, detail: f === undefined ? '' : f.detail });
          }
        },
      },
      {
        path: '/dsh-session-delete/restore-all',
        handler: async (req, res) => {
          const body = await readJsonBody(req);
          const report = { restored: [], notArchived: [], missing: [], failed: [] };
          const archivedSet = new Set([...deps.registry.archivedSessionIds].map(String));

          let ids = [];
          if (body !== null && typeof body.workspaceId === 'string' && body.workspaceId !== '') {
            const w = deps.registry.get(body.workspaceId);
            if (w === undefined) {
              sendJson(res, 404, { ok: false, code: 'unknown-workspace' });
              return;
            }
            ids = [...w.sessionIds].filter((id) => archivedSet.has(String(id)));
          } else {
            ids = [...deps.registry.archivedSessionIds];
          }

          await restoreMany(deps, ids, report);
          sendJson(res, 200, {
            ok: true,
            restored: report.restored.length,
            notArchived: report.notArchived.length,
            missing: report.missing.length,
            failed: report.failed,
            details: report.restored,
          });
        },
      },
    ];

    for (const r of routes) {
      ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: r.path, handler: r.handler }));
    }
    log('host ready: POST /dsh-session-delete/{delete,delete-all,archive-all,restore,restore-all}');
  },
};
