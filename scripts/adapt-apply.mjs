import { applyAdapt } from '../modules/integration/application.mjs'
import { integrationFiles } from '../modules/integration/files.mjs'

const arg = (name) => { const index = process.argv.indexOf(name); return index !== -1 ? process.argv[index + 1] : undefined }
const target = arg('--target') ?? process.cwd()
const verifyCommand = arg('--verify-cmd') ?? '(미확정 — adapt 스킬이 사용자에게 확인)'
try {
  const { created, updated, skipped } = applyAdapt(integrationFiles({ root: target }), verifyCommand)
  console.log(`adapt-apply: target=${target} created=${created} updated=${updated} skipped=${skipped}`)
} catch (error) {
  console.error(`adapt-apply: ${error.message}`)
  process.exit(1)
}
