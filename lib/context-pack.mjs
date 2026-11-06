import { existsSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildPack as assemble } from '../modules/context/application.mjs'
import { contextFiles } from '../modules/context/files.mjs'
import { scrub } from './scrub.mjs'

export { SECTION_LIMITS } from '../modules/context/domain.mjs'
export { fieldBlock } from '../core/domain/requirement-fields.mjs'
export function buildPack({ root, budget = 'standard', reqSlug = null, skills = [] }) {
  return assemble({ store: contextFiles(root), budget, reqSlug, skills })
}

// CLI: node lib/context-pack.mjs [--root <dir>] [--budget brief|standard|deep] [--req <slug>]
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const skills = []
    const options = new Map()
    for (let i = 2; i < process.argv.length; i++) {
      const name = process.argv[i]
      if (!['--root', '--req', '--budget', '--skill'].includes(name)) throw new Error(`unknown context option: ${name}`)
      const value = process.argv[++i]
      if (!value || value.startsWith('--')) throw new Error(`${name}: 값이 필요하다`)
      if (name === '--skill') skills.push(value)
      else {
        if (options.has(name)) throw new Error(`duplicate context option: ${name}`)
        options.set(name, value)
      }
    }
    process.stdout.write(
      buildPack({ root: options.get('--root') ?? process.cwd(), budget: options.get('--budget'), reqSlug: options.get('--req') ?? null, skills }),
    )
  } catch (err) {
    console.error(`context-pack: ${scrub(err.message).text}`)
    process.exit(1)
  }
}
