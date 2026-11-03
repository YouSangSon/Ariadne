import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
test('private migrations, credentials and runtime data cannot be staged accidentally', () => {
  for (const path of ['.ariadne/private/akasha/history.bundle', '.env', 'packages/memory/.env.production', 'credentials.local.json', 'local.pem', 'local.key', 'packages/code/.parallax/index.db', 'packages/memory/.akasha/session.json']) {
    const result = spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: root })
    assert.equal(result.status, 0, `${path} must be ignored`)
  }
  for (const path of ['packages/memory/.env.example', 'tests/fixtures/example.sql', 'package-lock.json']) {
    const result = spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: root })
    assert.equal(result.status, 1, `${path} must remain trackable`)
  }
})
