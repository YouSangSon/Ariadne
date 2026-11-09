import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export function wikiFiles({ root, vault, project }) {
  const wiki = join(vault, 'Projects', project, 'Long', 'llm-wiki')
  const readIf = (path) => existsSync(path) ? readFileSync(path, 'utf8') : ''
  const markdownFiles = (directory) => readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => join(entry.parentPath, entry.name))
  const pagePath = (title) => join(wiki, 'wiki', 'sources', `${title}.md`)
  const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
  return {
    readRecords() {
      const base = join(root, '.harness')
      return {
        decisions: readIf(join(base, 'decisions.md')),
        handoff: readIf(join(base, 'handoff', 'LATEST.md')),
        requirements: existsSync(join(base, 'reqs')) ? readdirSync(join(base, 'reqs')).filter((file) => file.endsWith('.yaml')).sort().map((file) => readIf(join(base, 'reqs', file))) : [],
      }
    },
    pagePath,
    readPage: (title) => readIf(pagePath(title)),
    writePage: (title, text) => write(pagePath(title), text),
    readLog: () => readIf(join(wiki, 'log.md')),
    appendLog: (text) => appendFileSync(join(wiki, 'log.md'), text),
    readGraph: () => ({ names: markdownFiles(vault).map((path) => basename(path, '.md')), pages: markdownFiles(wiki).map((path) => ({ name: basename(path, '.md'), text: readFileSync(path, 'utf8') })) }),
    writeGraph: (name, text) => write(join(wiki, 'wiki', 'graphs', `${name}.md`), text),
  }
}
