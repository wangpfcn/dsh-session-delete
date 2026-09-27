/**
 * dsh-session-delete — 工作区侧栏「删除会话 / 归档全部会话 / 删除全部会话」（Host 半）
 *
 * 能力：
 *   - 在 ctx.webServer 注册 POST /dsh-session-delete/{delete,delete-all,archive-all}
 *     路由，浏览器同源 fetch 调用（客户端半见 client.js）；
 *   - 删除 = 受限沙箱内移除会话日志目录（workspace-write，root 限定该会话所属
 *     项目目录），成功后才归档隐藏 + 从工作区账目 detach（先文件后簿记，
 *     失败时行保持可见、错误直达对话框）；
 *   - 活跃（本进程内 live）会话拒绝删除，防止误删运行中/已打开会话。
 *
 * 挂载（profile 的 cordis.patch.yml）：
 *   - insert:
 *       - id: dsh-session-delete
 *         name: dsh-session-delete
 *
 * 依赖服务（inject）：webServer、shell、sessionPersistence、workspaceRegistry、sessions。
 */
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

/** 路径规范化：去掉尾部分隔符；win32 上路径不区分大小写。 */
function normalizePath(p) {
  const trimmed = String(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
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

/**
 * 某个工作区应覆盖的全部会话：工作区账目里的，加上日志落在同一项目目录下
 * 但没有登记进任何工作区的会话（子代理会话、被 detach 的会话）。
 * 只走 `w.sessionIds` 会漏掉后者——它们不在侧栏，任何 GUI 删除都碰不到，
 * 而 DSH 持久层没有删除接口，这些日志会一直留在磁盘上。
 */
/**
 * 从 `sessionPersistence.list()` 的一项里取出 Session header。
 *
 * DSH 0.1.7-rc.2 起 `list()` 返回 `SessionPersistenceSnapshot`，即
 * `{ header, revision, eventCount?, sizeBytes? }`，会话 id 与 cwd 都在 `header` 里；
 * 0.1.0-rc.6 及更早返回的是扁平的 header 本身。两种都认，否则在新版 DSH 上
 * 每一个会话都会因 `id` 取不到而落到 missing 分支——删除会整体失效。
 *
 * @param snapshot - `list()` 返回的一项
 * @returns 该项的 header，或 undefined（结构无法识别时）
 */
function headerOf(snapshot) {
  if (snapshot === null || snapshot === undefined) return undefined;
  if (snapshot.header !== null && typeof snapshot.header === 'object') return snapshot.header;
  return typeof snapshot.id === 'string' ? snapshot : undefined;
}

async function sessionIdsForWorkspace(deps, w) {
  const ids = new Set([...w.sessionIds].map(String));
  const target = normalizePath(w.path);
  let snapshots;
  try {
    snapshots = await deps.persistence.list();
  } catch (e) {
    log('list headers failed', e);
    snapshots = [];
  }
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const h = headerOf(snapshot);
    if (h === undefined) continue;
    if (typeof h.id !== 'string' || h.id === '' || typeof h.cwd !== 'string' || h.cwd === '') continue;
    if (normalizePath(h.cwd) === target) ids.add(h.id);
  }
  return [...ids];
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
    const snapshots = await deps.persistence.list();
    if (Array.isArray(snapshots)) {
      for (const snapshot of snapshots) {
        const h = headerOf(snapshot);
        if (h !== undefined && h.id === id) {
          header = h;
          break;
        }
      }
    }
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
          const ids = await sessionIdsForWorkspace(deps, w);
          for (const id of ids) await deleteOne(deps, id, report);
          sendJson(res, 200, {
            ok: true,
            scanned: ids.length,
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
    ];

    for (const r of routes) {
      ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: r.path, handler: r.handler }));
    }
    log('host ready: POST /dsh-session-delete/{delete,delete-all,archive-all}');
  },
};
