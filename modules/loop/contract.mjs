import { loadContract as load, sourceState as inspect } from '../requirements/application.mjs'
import { requirementFiles, sourceFilesAdapter } from '../requirements/files.mjs'

export function loadContract(root, reqId) {
  return load(requirementFiles(root), reqId)
}
export function sourceState(root, options) {
  return inspect(sourceFilesAdapter(root), options)
}
