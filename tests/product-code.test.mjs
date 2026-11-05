import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../bin/Ariadne.mjs', import.meta.url))
const codeShim = fileURLToPath(new URL('../bin/code.mjs', import.meta.url))
function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PARALLAX_EMBEDDING_MODEL: 'stub-sha256' } })
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ariadne-product-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
test('code indexing, impact and generated MCP use Ariadne from the caller repository', (t) => {
  const dir = fixture(t)
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src/value.ts'), 'export function value() { return 1 }\n')
  writeFileSync(join(dir, 'src/consumer.ts'), "import { value } from './value'; export const result = value()\n")
  for (const args of [['init'], ['index'], ['analyze', '--changed', 'src/value.ts', '--json']]) {
    const result = run(dir, 'code', ...args)
    assert.equal(result.status, args[0] === 'analyze' ? 1 : 0, result.stdout + result.stderr)
    if (args[0] === 'analyze') assert.match(result.stdout, /src\/consumer.ts/)
  }
  const install = run(dir, 'code', 'install-agent', '--dry-run')
  assert.equal(install.status, 0, install.stderr)
  const config = JSON.parse(install.stdout)
  assert.equal(config.mcpServers['ariadne-code'].command, codeShim)
  assert.deepEqual(config.mcpServers['ariadne-code'].args, ['mcp', 'serve'])
  const help = spawnSync(config.mcpServers['ariadne-code'].command, ['mcp', 'serve', '--help'], { cwd: dir, encoding: 'utf8' })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /mcp serve/)
  assert.ok(readFileSync(join(dir, '.parallax/config.json'), 'utf8'))
})
