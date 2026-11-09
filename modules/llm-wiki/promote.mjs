import { promote } from './application.mjs'
import { wikiFiles } from './files.mjs'

const arg = (name, req = false) => {
  const i = process.argv.indexOf(name)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  if (req) {
    console.error(`promote: ${name} 필요`)
    process.exit(1)
  }
  return undefined
}

const root = arg('--root') ?? process.cwd()
const vault = arg('--vault', true)
const project = arg('--project', true)
const date = arg('--date') ?? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

try {
  const { changed, page } = promote(wikiFiles({ root, vault, project }), project, date)
  console.log(`promote: changed=${changed} page=${page}`)
} catch (error) {
  console.error(`promote: ${error.message}`)
  process.exit(1)
}
