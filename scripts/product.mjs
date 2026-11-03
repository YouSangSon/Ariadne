import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommand } from '../lib/command.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const [action, ...extra] = process.argv.slice(2)
if (!['setup', 'build', 'test', 'verify'].includes(action) || extra.length) {
  console.error('usage: node scripts/product.mjs setup|build|test|verify')
  process.exit(2)
}
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
if (action === 'setup') {
  for (const name of ['memory', 'code']) await step(npm, ['ci'], join(root, 'packages', name))
}
if (['setup', 'build'].includes(action)) {
  for (const name of ['memory', 'code']) await step(npm, ['run', 'build'], join(root, 'packages', name))
}
if (['test', 'verify'].includes(action)) {
  await step(process.execPath, [join(root, 'scripts/verify.mjs')], root)
  await step(npm, ['run', 'typecheck'], join(root, 'packages/memory'))
  await step(npm, ['test', '--', '--maxWorkers=1'], join(root, 'packages/memory'))
  if (action === 'verify') {
    await step(npm, ['run', 'audit:dependencies'], join(root, 'packages/memory'))
    await step(npm, ['run', 'verify'], join(root, 'packages/code'))
  } else await step(npm, ['test'], join(root, 'packages/code'))
}
