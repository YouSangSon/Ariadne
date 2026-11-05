import { homedir } from 'node:os'
import { join } from 'node:path'
import { uninstallRules } from '../modules/integration/application.mjs'
import { integrationFiles } from '../modules/integration/files.mjs'

const index = process.argv.indexOf('--prefix')
const prefix = index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : join(homedir(), '.harness')
try {
  const result = uninstallRules(integrationFiles({ root: prefix, home: homedir() }))
  if (!result) { console.error(`uninstall: ${join(prefix, 'manifest.json')} — manifest.json이 없다. 설치본이 아니거나 이미 제거됨`); process.exit(1) }
  console.log(`uninstall: prefix=${prefix} removed=${result.removed}`)
} catch (error) {
  console.error(`uninstall: ${error.message}`)
  process.exit(1)
}
