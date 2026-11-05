import { generateMirrors } from '../modules/integration/application.mjs'
import { integrationFiles } from '../modules/integration/files.mjs'
import { repoRootFromArgs } from './mirror-lib.mjs'

try {
  const { written, skipped } = generateMirrors(integrationFiles({ root: repoRootFromArgs(process.argv) }))
  console.log(`generate-mirrors: written=${written} skipped=${skipped}`)
} catch (error) {
  console.error(`generate-mirrors: ${error.message}`)
  process.exit(1)
}
