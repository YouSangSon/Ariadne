import { checkMirrors } from '../modules/integration/application.mjs'
import { integrationFiles } from '../modules/integration/files.mjs'
import { repoRootFromArgs } from './mirror-lib.mjs'

const errors = checkMirrors(integrationFiles({ root: repoRootFromArgs(process.argv) }))
if (errors.length) {
  for (const error of errors) console.error(`check-mirror: ${error}`)
  process.exit(1)
}
console.log('check-mirror: ok')
