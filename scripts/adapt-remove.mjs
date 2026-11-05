import { join } from 'node:path'
import { removeAdapt } from '../modules/integration/application.mjs'
import { integrationFiles } from '../modules/integration/files.mjs'

const index = process.argv.indexOf('--target')
const target = index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : process.cwd()
try {
  const result = removeAdapt(integrationFiles({ root: target }))
  if (!result) { console.error(`adapt-remove: ${join(target, '.harness', 'adapt-manifest.json')} 없음 — adapt 적용본이 아니다`); process.exit(1) }
  console.log(`adapt-remove: target=${target} restored=${result.restored} removed=${result.removed}`)
} catch (error) {
  console.error(`adapt-remove: ${error.message}`)
  process.exit(1)
}
