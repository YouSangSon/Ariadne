import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout } from 'node:timers/promises'
import { runCommand } from '../lib/command.mjs'

test('child failures and spawn errors propagate and release signal listeners', async () => {
  const count = process.listenerCount('SIGTERM')
  assert.equal(await runCommand(process.execPath, ['-e', 'process.exit(7)']), 7)
  await assert.rejects(runCommand('/no-such-ariadne-command', []), /ENOENT/)
  assert.equal(process.listenerCount('SIGTERM'), count)
})
test('cancellation reaches the child and waits for its cleanup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ariadne-command-'))
  const ready = join(dir, 'ready')
  const closed = join(dir, 'closed')
  try {
    const result = runCommand(process.execPath, ['--input-type=module', '-e', `
      import { writeFileSync } from 'node:fs';
      process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(closed)}, 'closed'); process.exit(0) });
      writeFileSync(${JSON.stringify(ready)}, 'ready');
      setInterval(() => {}, 1000);
    `])
    const deadline = Date.now() + 5000
    while (!existsSync(ready) && Date.now() < deadline) await setTimeout(10)
    assert.ok(existsSync(ready), 'child did not start')
    process.emit('SIGTERM')
    assert.equal(await result, 0)
    assert.ok(existsSync(closed))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
