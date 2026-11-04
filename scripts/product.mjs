import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommand } from '../lib/command.mjs'
import { selectModules } from '../lib/module-selection.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const [action, ...extra] = process.argv.slice(2)
if (!['setup', 'build', 'test', 'verify'].includes(action)) {
  console.error('usage: node scripts/product.mjs setup|build|test|verify [--modules core,memory,code,ontology]')
  process.exit(2)
}
let modules
try { modules = selectModules(extra) }
catch (error) { console.error(`product: ${error.message}`); process.exit(2) }
const scope = [...modules].join(',')
const packages = ['memory', 'code'].filter((name) => modules.has(name))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const env = { ...process.env, ONNXRUNTIME_NODE_INSTALL: 'skip' }
// Verification never inherits an opt-in to user databases, evaluation or paid providers.
if (['test', 'verify'].includes(action)) {
  for (const key of ['POSTGRES_HOST', 'PGVECTOR_TEST_URL', 'AKASHA_WRITE_CONCURRENCY_TEST', 'RUN_EVAL', 'DATABASE_URL', 'ARIADNE_SMOKE_DATABASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY']) delete env[key]
}
async function step(command, args, cwd) {
  const status = await runCommand(command, args, { cwd, env })
  if (status !== 0) process.exit(status)
}
console.log(`product: ${action} modules=${scope}`)
if (action === 'setup') {
  for (const name of packages) await step(npm, ['ci'], join(root, 'packages', name))
}
if (['setup', 'build'].includes(action)) {
  for (const name of packages) await step(npm, ['run', 'build'], join(root, 'packages', name))
}
if (['test', 'verify'].includes(action)) {
  await step(process.execPath, [join(root, 'scripts/verify.mjs'), '--modules', scope], root)
  if (modules.has('memory')) {
    await step(npm, ['run', 'typecheck'], join(root, 'packages/memory'))
    await step(npm, ['test', '--', '--maxWorkers=1'], join(root, 'packages/memory'))
    if (action === 'verify') await step(npm, ['run', 'audit:dependencies'], join(root, 'packages/memory'))
  }
  if (modules.has('code')) await step(npm, action === 'verify' ? ['run', 'verify'] : ['test'], join(root, 'packages/code'))
}
console.log(`product: ${action} complete modules=${scope}`)
