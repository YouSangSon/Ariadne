import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
const cli = join(root, 'bin/Ariadne.mjs')
test('one installation serves actual code MCP and scoped persistent memory through generated wrappers', {
  skip: !process.env.ARIADNE_SMOKE_DATABASE_URL,
}, async () => {
  assert.ok(!existsSync(join(root, '.env')), 'Run the disposable DB smoke from a checkout without root .env; generated wrappers load that file.')
  // Only opt in with a disposable DB; the dedicated CI service owns its lifetime.
  const dir = mkdtempSync(join(tmpdir(), 'ariadne-mcp-'))
  const env = Object.fromEntries(Object.entries({ ...process.env,
    DATABASE_URL: process.env.ARIADNE_SMOKE_DATABASE_URL, VECTOR_BACKEND: 'pgvector',
    EMBEDDING_PROVIDER: 'local', EMBEDDING_MODEL: 'local-deterministic-v1',
    EMBEDDING_DIMENSIONS: '384', PARALLAX_EMBEDDING_MODEL: 'stub-sha256', LOG_LEVEL: 'silent',
  }).filter(([, value]) => typeof value === 'string'))
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY', 'NODE_TEST_CONTEXT']) delete env[key]
  const project = `ariadne-smoke-${randomUUID()}`
  const content = `Decision: consolidate memory and code with Ariadne ${randomUUID()}`
  const { Client } = await import(new URL('../packages/memory/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js', import.meta.url))
  const { StdioClientTransport } = await import(new URL('../packages/memory/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js', import.meta.url))
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: dir, env, encoding: 'utf8', timeout: 30000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result.stdout
  }
  try {
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/value.ts'), 'export const value = 1\n')
    run('code', 'init')
    run('code', 'index')
    run('memory', 'init', '--project', project, '--organization-id', 'personal')
    const generated = JSON.parse(readFileSync(join(dir, '.akasha/mcp/claude-desktop.json'), 'utf8')).mcpServers.akasha
    for (const [command, args, kind] of [
      [process.execPath, [cli, 'code', 'mcp', 'serve'], 'code'],
      [generated.command, generated.args, 'memory'],
    ]) {
      const transport = new StdioClientTransport({ command, args, cwd: dir, env, stderr: 'pipe' })
      const client = new Client({ name: 'ariadne-integration', version: '1.0.0' })
      try {
        await client.connect(transport)
        const listed = await client.listTools()
        assert.ok(listed.tools.length > 0)
        if (kind === 'memory') {
          assert.ok(listed.tools.some((tool) => tool.name === 'build_context_pack'))
          run('memory', 'remember', '--project', project, '--organization-id', 'personal', '--kind', 'decision', '--content', content)
          assert.match(run('memory', 'pack', '--project', project, '--organization-id', 'personal', '--task', content), /consolidate memory and code/)
          const pack = await client.callTool({ name: 'build_context_pack', arguments: { projectKey: project, organizationId: 'personal', task: content } })
          assert.notEqual(pack.isError, true, JSON.stringify(pack))
          assert.ok(JSON.stringify(pack).includes(content))
          const other = await client.callTool({ name: 'build_context_pack', arguments: { projectKey: project, organizationId: 'other-person', task: 'continue' } })
          assert.notEqual(other.isError, true, JSON.stringify(other))
          assert.ok(!JSON.stringify(other).includes(content))
          // The task text itself is echoed in the pack; memory must remain absent.
          assert.ok(!run('memory', 'pack', '--project', project, '--organization-id', 'other-person', '--task', 'continue').includes(content))
        } else assert.ok(listed.tools.some((tool) => /analy|impact/.test(tool.name)))
      } finally { await client.close() }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
