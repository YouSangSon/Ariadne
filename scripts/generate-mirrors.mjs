import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { MIRROR_DIRS, listSkills, renderMirror, repoRootFromArgs } from './mirror-lib.mjs'

const root = repoRootFromArgs(process.argv)
let written = 0
let skipped = 0

try {
  for (const name of listSkills(root)) {
    const out = renderMirror(root, name)
    for (const dir of MIRROR_DIRS) {
      const dest = join(root, dir, 'skills', name, 'SKILL.md')
      if (existsSync(dest) && readFileSync(dest, 'utf8') === out) {
        skipped += 1
        continue
      }
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, out)
      written += 1
    }
  }
  console.log(`generate-mirrors: written=${written} skipped=${skipped}`)
} catch (err) {
  console.error(`generate-mirrors: ${err.message}`)
  process.exit(1)
}
