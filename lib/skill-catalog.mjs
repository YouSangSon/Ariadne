import { skillCatalog } from '../modules/context/application.mjs'
import { contextFiles } from '../modules/context/files.mjs'
import { scrub } from './scrub.mjs'

try {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--root' || !args[1] || args[1].startsWith('--'))) throw new Error('usage: Ariadne skills [--root path]')
  console.log(JSON.stringify(skillCatalog(contextFiles(args[1] ?? process.cwd())), null, 2))
} catch (error) {
  console.error(`skills: ${scrub(error.message).text}`)
  process.exitCode = 2
}
