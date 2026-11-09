import { homedir } from 'node:os'
import { join } from 'node:path'
import { installRules } from '../modules/integration/application.mjs'
import { integrationFiles } from '../modules/integration/files.mjs'
import { repoRootFromArgs } from './mirror-lib.mjs'

const index = process.argv.indexOf('--prefix')
const prefix = index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : join(homedir(), '.harness')
try {
  const { created, updated, skipped } = installRules(integrationFiles({ root: repoRootFromArgs(process.argv), target: prefix, home: homedir() }), process.argv.includes('--global-pointer'))
  console.log(`install: prefix=${prefix} created=${created} updated=${updated} skipped=${skipped}`)
} catch (error) {
  console.error(`install: ${error.message}`)
  process.exit(1)
}
