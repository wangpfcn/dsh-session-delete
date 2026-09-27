import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import plugin from '../index.js'

const PROJECT = 'E:\\fake\\year-end'
const OTHER = 'E:\\fake\\other'

/**
 * 把 Host 半装进一组桩里：shell 只记录命令不真删，persistence 给出
 * 「两个已登记 + 一个同项目子代理 + 一个别的项目」的会话头。
 */
function harness({ live = new Set(), listThrows = false } = {}) {
  const routes = new Map()
  const removed = []
  const archived = []
  const detached = []
  const workspace = {
    id: 'ws-1',
    path: PROJECT,
    title: 'year-end',
    sessionIds: ['session-a', 'session-b'],
    async detachSession(id) {
      detached.push(id)
    },
  }
  const ctx = {
    effect(fn) {
      return fn()
    },
    get: () => undefined,
    webServer: {
      register(spec) {
        routes.set(spec.path, spec.handler)
        return () => {}
      },
    },
    shell: {
      resolve: (request) => request,
      async run(spec) {
        removed.push(spec.command)
        return { exitCode: 0, stderr: '' }
      },
    },
    sessionPersistence: {
      async list() {
        if (listThrows) throw new Error('boom')
        return [
          { id: 'session-a', cwd: PROJECT },
          { id: 'session-b', cwd: PROJECT },
          { id: 'subagent-1', cwd: PROJECT },
          { id: 'elsewhere', cwd: OTHER },
        ]
      },
      locate: (header) => ({ kind: 'jsonl', path: join('C:\\root', header.cwd, header.id, 'session.v4.jsonl.zstd') }),
    },
    workspaceRegistry: {
      get: (id) => (id === 'ws-1' ? workspace : undefined),
      list: () => [workspace],
      archivedSessionIds: new Set(),
      async archiveSession(id) {
        archived.push(id)
      },
    },
    sessions: { get: (id) => (live.has(id) ? { id } : undefined) },
  }
  plugin.apply(ctx)
  return { routes, removed, archived, detached }
}

async function post(routes, path, body) {
  const req = (async function* () {
    yield Buffer.from(JSON.stringify(body))
  })()
  let status = 0
  let payload = {}
  const res = {
    writeHead(code) {
      status = code
    },
    end(body) {
      payload = JSON.parse(body)
    },
  }
  await routes.get(path)(req, res)
  return { status, payload }
}

test('delete-all 覆盖账目之外的同项目会话，且跳过运行中的会话', async () => {
  const { routes, removed, archived, detached } = harness({ live: new Set(['session-b']) })
  const { status, payload } = await post(routes, '/dsh-session-delete/delete-all', { workspaceId: 'ws-1' })

  assert.equal(status, 200)
  assert.deepEqual(
    { scanned: payload.scanned, deleted: payload.deleted, live: payload.live, missing: payload.missing },
    { scanned: 3, deleted: 2, live: 1, missing: 0 },
  )
  // 账目里的两个（减去运行中的一个）+ 没登记的子代理会话
  assert.equal(removed.length, 2)
  assert.ok(removed.some((c) => c.includes('subagent-1')), '子代理会话必须进入删除集合')
  assert.ok(!removed.some((c) => c.includes('elsewhere')), '别的项目的会话不得被波及')
  // 运行中的会话既不删文件也不记账
  assert.ok(!removed.some((c) => c.includes('session-b')))
  assert.ok(!archived.includes('session-b') && !detached.includes('session-b'))
})

test('persistence.list() 失败时按账目扫描，失败如实上报', async () => {
  const { routes, removed } = harness({ listThrows: true })
  const { status, payload } = await post(routes, '/dsh-session-delete/delete-all', { workspaceId: 'ws-1' })

  assert.equal(status, 200)
  assert.deepEqual({ scanned: payload.scanned, deleted: payload.deleted }, { scanned: 2, deleted: 0 })
  assert.equal(payload.failed.length, 2)
  assert.equal(removed.length, 0)
})
