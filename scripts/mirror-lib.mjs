import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderMirror as render } from '../modules/integration/application.mjs'
import { integrationFiles } from '../modules/integration/files.mjs'

export { MIRROR_DIRS, CORE_LINE_CAP, VERSION, BLOCK_BEGIN, BLOCK_END, BLOCK_RE } from '../modules/integration/domain.mjs'
export function repoRootFromArgs(argv) {
  const index = argv.indexOf('--root')
  return index !== -1 && argv[index + 1] ? argv[index + 1] : join(dirname(fileURLToPath(import.meta.url)), '..')
}
export function listSkills(root) { return integrationFiles({ root }).listSkills() }
export function renderMirror(root, name) { return render(integrationFiles({ root }), name) }
