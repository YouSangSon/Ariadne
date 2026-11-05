import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { scrub } from '../../lib/scrub.mjs'

export function contextFiles(root) {
  const base = join(root, '.harness')
  const readIf = (path) => existsSync(path) ? scrub(readFileSync(path, 'utf8')).text : ''
  return {
    readHandoff: () => readIf(join(base, 'handoff', 'LATEST.md')),
    readDecisions: () => readIf(join(base, 'decisions.md')),
    readRequirement: (slug) => readIf(join(base, 'reqs', `${slug}.yaml`)),
    hasRequirement: (slug) => existsSync(join(base, 'reqs', `${slug}.yaml`)),
    listRequirements: () => existsSync(join(base, 'reqs'))
      ? readdirSync(join(base, 'reqs')).filter((file) => file.endsWith('.yaml')).sort().map((file) => file.slice(0, -5))
      : [],
  }
}
