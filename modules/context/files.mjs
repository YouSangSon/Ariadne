import { readFileSync, readdirSync, existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { scrub } from '../../lib/scrub.mjs'
import { readProjectText } from '../../core/infrastructure/project-files.mjs'
import { skillMetadata } from './skills.mjs'

export function contextFiles(root) {
  const base = join(root, '.harness')
  const readIf = (path) => existsSync(path) ? scrub(readFileSync(path, 'utf8')).text : ''
  return {
    listSkills: () => {
      const directory = join(root, 'skills')
      let stat
      try { stat = lstatSync(directory) }
      catch (error) { if (error.code === 'ENOENT') return []; throw error }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('skills must be a local directory, not a symbolic link')
      const entries = readdirSync(directory, { withFileTypes: true })
      if (entries.length > 100) throw new Error('skill catalog exceeds 100 entries')
      if (entries.some((entry) => entry.isSymbolicLink())) throw new Error('skill symbolic links are denied')
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    },
    readSkill: (id) => {
      if (scrub(id).detections.length) throw new Error('secret-bearing skill identifiers are denied')
      const file = readProjectText(root, `skills/${id}/SKILL.md`)
      if (Buffer.byteLength(file.content) > 64 * 1024) throw new Error('skill exceeds 64 KiB')
      const metadata = skillMetadata(id, file.content)
      const content = scrub(file.content).text
      return { ...metadata, description: scrub(metadata.description).text, path: file.path, sha256: file.sha256, chars: content.length, content }
    },
    readHandoff: () => readIf(join(base, 'handoff', 'LATEST.md')),
    readDecisions: () => readIf(join(base, 'decisions.md')),
    readRequirement: (slug) => readIf(join(base, 'reqs', `${slug}.yaml`)),
    hasRequirement: (slug) => existsSync(join(base, 'reqs', `${slug}.yaml`)),
    listRequirements: () => existsSync(join(base, 'reqs'))
      ? readdirSync(join(base, 'reqs')).filter((file) => file.endsWith('.yaml')).sort().map((file) => file.slice(0, -5))
      : [],
  }
}
