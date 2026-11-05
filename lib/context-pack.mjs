import { existsSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildPack as assemble } from '../modules/context/application.mjs'
import { contextFiles } from '../modules/context/files.mjs'

export { SECTION_LIMITS } from '../modules/context/domain.mjs'
export { fieldBlock } from '../core/domain/requirement-fields.mjs'
export function buildPack({ root, budget = 'standard', reqSlug = null }) {
  return assemble({ store: contextFiles(root), budget, reqSlug })
}

// CLI: node lib/context-pack.mjs [--root <dir>] [--budget brief|standard|deep] [--req <slug>]
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const arg = (name) => {
    const i = process.argv.indexOf(name)
    if (i === -1) return undefined
    const value = process.argv[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`${name}: 값이 필요하다`)
    return value
  }
  try {
    process.stdout.write(
      buildPack({ root: arg('--root') ?? process.cwd(), budget: arg('--budget'), reqSlug: arg('--req') ?? null }),
    )
  } catch (err) {
    console.error(`context-pack: ${err.message}`)
    process.exit(1)
  }
}
