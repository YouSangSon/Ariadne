import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

export function integrationFiles({ root, target = root, home }) {
  const readIf = (path) => existsSync(path) ? readFileSync(path, 'utf8') : null
  const write = (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content) }
  const files = (base) => existsSync(base)
    ? readdirSync(base, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => relative(base, join(entry.parentPath, entry.name)).split(sep).join('/'))
    : []
  const prune = (path) => { if (existsSync(path) && readdirSync(path).length === 0) rmdirSync(path) }
  const pruneParents = (path) => {
    if (path === target || !existsSync(path)) return
    if (readdirSync(path).length === 0) { rmdirSync(path); pruneParents(dirname(path)) }
  }
  return {
    read: (path) => readIf(join(target, path)),
    sourceExists: (path) => existsSync(join(root, path)),
    readSource: (path) => readFileSync(join(root, path), 'utf8'),
    readSourceIf: (path) => readIf(join(root, path)),
    readManifest(path) { const text = readIf(join(target, path)); return text === null ? null : JSON.parse(text) },
    listSkills: () => existsSync(join(root, 'skills')) ? readdirSync(join(root, 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(root, 'skills', entry.name, 'SKILL.md'))).map((entry) => entry.name) : [],
    listFiles: () => files(target),
    listSourceFiles: (area) => files(join(root, area)).map((path) => `${area}/${path}`),
    hash: (text) => createHash('sha256').update(text).digest('hex'),
    write: (path, content) => write(join(target, path), content),
    copy(source, destination) { mkdirSync(dirname(join(target, destination)), { recursive: true }); copyFileSync(join(target, source), join(target, destination)) },
    exists: (path) => existsSync(join(target, path)),
    remove: (path, options = {}) => { if (existsSync(join(target, path))) rmSync(join(target, path), options) },
    prune: (path) => prune(join(target, path)),
    pruneParents: (path) => pruneParents(dirname(join(target, path))),
    ensureRoot: () => mkdirSync(target, { recursive: true }),
    installFile(path) {
      const content = readFileSync(join(root, path))
      const present = existsSync(join(target, path))
      return { path, content, present, identical: present && readFileSync(join(target, path)).equals(content) }
    },
    installedCore: () => ({ path: join(target, 'core', 'AGENTS.core.md'), content: readFileSync(join(target, 'core', 'AGENTS.core.md'), 'utf8') }),
    pointerTargets: () => [
      { id: 'claude-CLAUDE.md', kind: 'claude', path: join(home, '.claude', 'CLAUDE.md') },
      { id: 'codex-AGENTS.md', kind: 'codex', path: join(home, '.codex', 'AGENTS.md') },
    ].map((entry) => ({ ...entry, current: readIf(entry.path), backupExists: existsSync(join(target, 'backup', `${entry.id}.bak`)) })),
    backupPointer: (path, backup) => { mkdirSync(dirname(join(target, backup)), { recursive: true }); copyFileSync(path, join(target, backup)) },
    writePointer: write,
    restorePointer(path, backup) { writeFileSync(path, readFileSync(join(target, backup))); rmSync(join(target, backup)) },
    removePointer(path) { if (existsSync(path)) { rmSync(path); prune(dirname(path)) } },
  }
}
