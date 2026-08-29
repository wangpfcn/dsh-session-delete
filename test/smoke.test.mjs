import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

assert.equal(pkg.name, 'dsh-session-delete')
assert.ok(pkg.dsh?.bundle?.patch, 'dsh.bundle.patch must be declared')
assert.match(patch, /id:\s*dsh-session-delete/)
assert.match(host, /dsh-session-delete\/delete/)
assert.match(host, /dsh-session-delete\/delete-all/)
assert.match(host, /dsh-session-delete\/archive-all/)
assert.match(host, /dsh-session-delete\/restore/)
assert.match(host, /dsh-session-delete\/restore-all/)
assert.match(host, /restoreOne/)
assert.match(host, /unarchive/)
assert.match(client, /delete-all/)
assert.match(client, /restore-all/)
assert.match(client, /restoreArchived/)
assert.match(client, /restoreAllArchived/)
