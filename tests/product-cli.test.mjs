import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../bin/Ariadne.mjs', import.meta.url))
function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PARALLAX_EMBEDDING_MODEL: 'stub-sha256' } })
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ariadne-product-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
test('one entry point explains capabilities and rejects unknown commands', (t) => {
  const dir = fixture(t)
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.bin, { Ariadne: 'bin/Ariadne.mjs' })
  symlinkSync(cli, join(dir, 'Ariadne'))
  const help = spawnSync(join(dir, 'Ariadne'), ['--help'], { cwd: dir, encoding: 'utf8', timeout: 60000 })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /Ariadne/)
  assert.match(help.stdout, /^  Ariadne code /m)
  for (const name of ['memory', 'code', 'context', 'knowledge', 'ontology', '--modules']) assert.match(help.stdout, new RegExp(name))
  const unknown = run(dir, 'not-a-command')
  assert.equal(unknown.status, 2, unknown.stderr)
  assert.match(unknown.stderr, /unknown command/)
})
