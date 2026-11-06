import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, extname, join, relative, resolve } from 'node:path'

const SOURCE = /\.(?:[cm]?js|tsx?|sh|sql)$/
const JAVASCRIPT = /\.(?:[cm]?js|tsx?)$/
const LAYERS = new Set(['domain', 'application', 'infrastructure', 'interfaces', 'composition', 'compatibility', 'tooling'])
const INNER = new Set(['domain', 'application'])
const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))
export const ROOT_EXCLUSIONS = ['packages', '.harness', '.ariadne']
const PACKAGE_AREAS = ['src', 'scripts', 'bench']
const ROOT_CONFIG = ['package.json', '.gitignore', '.gitleaks.toml', '.gitleaksignore', 'evaluation/suite.json', 'evaluation/suite.sha256', 'evaluation/comparison-example.json', 'modules/ontology/example.json', 'templates/req.yaml']
const SHARED = new Set(['lib/scrub.mjs', 'lib/budget.mjs', 'lib/caps.mjs', 'lib/module-selection.mjs', 'core/domain/requirement-fields.mjs'])
// These are shared guarded I/O and existing outward entrypoints, never inward dependencies.
const PUBLIC = new Set(['core/infrastructure/project-files.mjs', 'hooks/hook-io.mjs', 'scripts/mirror-lib.mjs'])
const COMPUTED = {
  'bin/Ariadne.mjs': ['path'],
  'evaluation/files.mjs': ['pathToFileURL(join(root,entry)).href'],
  'tests/product-mcp.test.mjs': [
    "newURL('../packages/memory/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js',import.meta.url)",
    "newURL('../packages/memory/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js',import.meta.url)",
  ],
  'packages/code/bench/config-extraction-profile.ts': ["pathToFileURL(path.join(root,'dist/src',`${file}.js`)).href"],
}

function tokens(source) {
  const result = []
  let cursor = 0
  const push = (kind, value, start) => result.push({ kind, value, start, end: cursor })
  const quoted = (quote) => {
    const start = cursor++
    while (cursor < source.length) {
      if (source[cursor] === '\\') { cursor += 2; continue }
      if (source[cursor++] === quote) return source.slice(start + 1, cursor - 1)
    }
    throw new Error('unterminated JavaScript literal')
  }
  const template = () => {
    cursor++
    while (cursor < source.length) {
      if (source[cursor] === '\\') { cursor += 2; continue }
      if (source[cursor] === '`') { cursor++; return }
      if (source[cursor] === '$' && source[cursor + 1] === '{') { cursor += 2; code(true); continue }
      cursor++
    }
    throw new Error(`unterminated JavaScript template at ${cursor}`)
  }
  const code = (interpolation = false) => {
    let braces = 0
    while (cursor < source.length) {
      const start = cursor
      const char = source[cursor]
      if (/\s/.test(char)) { cursor++; continue }
      if (char === '/' && source[cursor + 1] === '/') { while (cursor < source.length && source[cursor] !== '\n') cursor++; continue }
      if (char === '/' && source[cursor + 1] === '*') {
        const end = source.indexOf('*/', cursor + 2)
        if (end === -1) throw new Error('unterminated JavaScript comment')
        cursor = end + 2
        continue
      }
      if (char === "'" || char === '"') { const value = quoted(char); push('string', value, start); continue }
      if (char === '`') { template(); push('template', source.slice(start, cursor), start); continue }
      const previous = result.at(-1)?.value
      if (char === '/' && (!previous || /^(?:[=(:,\[!?:;{}|&+*%~<>^-]|=>|return|throw|case|yield|await)$/.test(previous))) {
        cursor++
        let characterClass = false
        while (cursor < source.length) {
          const next = source[cursor++]
          if (next === '\\') { cursor++; continue }
          if (next === '[') characterClass = true
          if (next === ']') characterClass = false
          if (next === '/' && !characterClass) break
          if (next === '\n') throw new Error(`unsupported JavaScript regexp syntax at ${cursor}`)
        }
        while (/[a-z]/i.test(source[cursor] ?? '') && cursor < source.length) cursor++
        push('regexp', source.slice(start, cursor), start)
        continue
      }
      if (/[A-Za-z_$]/.test(char)) {
        cursor++
        while (/[\w$]/.test(source[cursor] ?? '') && cursor < source.length) cursor++
        push('word', source.slice(start, cursor), start)
        continue
      }
      if (interpolation && char === '}' && braces === 0) { cursor++; return }
      if (char === '{') braces++
      if (char === '}') braces--
      cursor++
      if (char === '=' && source[cursor] === '>') cursor++
      push('punctuation', source.slice(start, cursor), start)
    }
    if (interpolation) throw new Error('unterminated JavaScript interpolation')
  }
  code()
  return result
}

// shortcut: this lexes literal JS/TS module loads, not an AST; new loader syntax must add a rejecting control or use the package AST gate.
export function imports(source) {
  const values = tokens(source)
  const loads = []
  const sequence = (start, end) => values.slice(start, end).map((token) => token.value).join('')
  const createRequireImport = (index) => sequence(index - 2, index + 4) === 'import{createRequire}fromnode:module'
  const canonicalCreateRequire = values.some((token, index) => token.kind === 'word' && token.value === 'createRequire' && createRequireImport(index))
  const requireDeclaration = (index) => canonicalCreateRequire && sequence(index - 1, index + 10) === 'constrequire=createRequire(import.meta.url)'
  const literal = (token) => {
    if (token.kind !== 'string' || token.value.includes('\\')) throw new Error('module specifiers must be unescaped string literals')
    loads.push({ specifier: token.value })
  }
  for (let index = 0; index < values.length; index++) {
    const token = values[index]
    const base = values[index - 2]
    const property = values[index - 1]?.value === '[' && values[index + 1]?.value === ']' &&
      (base?.kind === 'word' && !['return', 'throw', 'yield', 'await'].includes(base.value) || [')', ']'].includes(base?.value))
    if (property && ['string', 'template'].includes(token.kind) && ['require', '`require`'].includes(token.value)) throw new Error('unsupported CommonJS loader property')
    if (token.kind !== 'word') continue
    if (token.value === 'createRequire' && !createRequireImport(index) && !requireDeclaration(index - 2)) throw new Error('unsupported CommonJS loader binding')
    if (!['import', 'export', 'require'].includes(token.value)) continue
    const next = values[index + 1]
    if (token.value === 'require') {
      if (requireDeclaration(index)) continue
      if (values[index - 1]?.value === '.' || next?.value !== '(') throw new Error('unsupported CommonJS loader reference')
    } else if (values[index - 1]?.value === '.') continue
    if (token.value === 'import' && next?.value === '.') continue
    if (next?.value === '(') {
      let end = index + 2
      let depth = 1
      for (; end < values.length; end++) {
        if (values[end].value === '(') depth++
        if (values[end].value === ')' && --depth === 0) break
      }
      if (end === values.length) throw new Error('unterminated module load')
      if (end === index + 3 && values[index + 2].kind === 'string') literal(values[index + 2])
      else loads.push({ expression: source.slice(next.end, values[end].start).replace(/\s+/g, '') })
      index = end
      continue
    }
    if (token.value === 'import' && next?.kind === 'string') { literal(next); continue }
    if (token.value === 'export' && !['*', '{', 'type'].includes(next?.value)) continue
    let end = index + 1
    for (; end < values.length; end++) {
      if (values[end].value === 'from' && values[end + 1]?.kind === 'string') { literal(values[end + 1]); break }
      if (values[end].value === ';' || (end > index + 1 && ['import', 'export'].includes(values[end].value))) break
    }
  }
  return loads
}

export function sourceFiles(root, areas, excluded = []) {
  const walk = (directory) => !existsSync(directory) ? [] : readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '.git'].includes(entry.name)) return []
    const path = join(directory, entry.name)
    if (excluded.includes(relative(root, path).split(/[\\/]/)[0])) return []
    return entry.isDirectory() ? walk(path) : SOURCE.test(entry.name) ? [relative(root, path).split('\\').join('/')] : []
  })
  return areas.flatMap((area) => walk(join(root, area))).sort()
}

export function readInventory(root) {
  const files = {}
  const dependencies = {}
  const scopes = [['', ['.']], ['packages/memory', PACKAGE_AREAS], ['packages/code', PACKAGE_AREAS]]
  const actual = [...ROOT_CONFIG]
  for (const area of ['.github/workflows', 'samples']) {
    for (const entry of readdirSync(join(root, area), { withFileTypes: true })) {
      if (entry.isFile() && /\.(?:ya?ml|json|toml)$/.test(entry.name)) actual.push(`${area}/${entry.name}`)
    }
  }
  for (const [prefix, areas] of scopes) {
    const map = JSON.parse(readFileSync(join(root, prefix, 'architecture-map.json'), 'utf8'))
    if (map.schema_version !== 1) throw new Error(`unsupported architecture map ${prefix}`)
    for (const [path, record] of Object.entries(map.files)) {
      const key = prefix ? `${prefix}/${path}` : path
      if (files[key]) throw new Error(`duplicate ownership ${key}`)
      files[key] = { ...record, ...(record.target ? { target: prefix ? `${prefix}/${record.target}` : record.target } : {}) }
    }
    if (prefix) {
      const manifest = JSON.parse(readFileSync(join(root, prefix, 'package.json'), 'utf8'))
      dependencies[prefix] = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }))
    }
    actual.push(...sourceFiles(root, areas.map((area) => prefix ? `${prefix}/${area}` : area), prefix ? [] : ROOT_EXCLUSIONS))
  }
  return { files, actual: actual.sort(), dependencies }
}

function targetFile(path, files) {
  const candidates = [path, path.replace(/\.js$/, '.ts'), path.replace(/\.js$/, '.tsx'), `${path}.ts`, `${path}.js`, `${path}/index.ts`, `${path}/index.js`]
  return candidates.find((candidate) => files[candidate])
}

export function boundaryErrors({ files, actual, sources, dependencies = {} }) {
  const errors = []
  for (const path of actual) if (!files[path]) errors.push(`unowned source ${path}`)
  for (const [path, record] of Object.entries(files)) {
    const prescribed = path.match(/\/(domain|application|infrastructure|interfaces|composition)(?:\/|\.mjs$)/)?.[1] ?? (SHARED.has(path) || path === 'modules/loop/native.mjs' ? 'domain' : undefined)
    if (prescribed && record.layer !== prescribed) errors.push(`incorrect layer classification ${path}`)
    if (!LAYERS.has(record.layer) || typeof record.context !== 'string' || !record.context) errors.push(`invalid ownership ${path}`)
    if (!actual.includes(path)) { errors.push(`stale ownership ${path}`); continue }
    if (record.target && !files[record.target]) errors.push(`unowned compatibility target ${path} -> ${record.target}`)
    if (!JAVASCRIPT.test(path)) continue
    let loads
    try { loads = imports(sources(path)) }
    catch (error) { errors.push(`${path}: ${error.message}`); continue }
    const allowedComputed = [...(COMPUTED[path] ?? [])]
    for (const load of loads) {
      if (load.expression !== undefined) {
        const found = allowedComputed.indexOf(load.expression)
        if (found === -1 || INNER.has(record.layer)) errors.push(`${path}: unreviewed computed import ${load.expression}`)
        else allowedComputed.splice(found, 1)
        continue
      }
      const specifier = load.specifier
      if (!specifier.startsWith('.')) {
        const builtin = BUILTINS.has(specifier.replace(/^node:/, ''))
        if (specifier.startsWith('#') || specifier.startsWith('@/') || specifier.startsWith('~/') || specifier.startsWith('/') || /^[a-z]+:/i.test(specifier) && !specifier.startsWith('node:')) errors.push(`${path}: unsupported alias or module URL ${specifier}`)
        if (!path.startsWith('packages/') && !builtin) errors.push(`${path}: optional package dependency ${specifier}`)
        if (path.startsWith('packages/') && !builtin) {
          const prefix = path.split('/').slice(0, 2).join('/')
          const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
          if (!dependencies[prefix]?.has(name)) errors.push(`${path}: undeclared package or unsupported alias ${specifier}`)
        }
        const pureBuiltin = path.startsWith('packages/') && ['node:crypto', 'node:path', 'node:util', 'crypto', 'path', 'util'].includes(specifier)
        if (INNER.has(record.layer) && !pureBuiltin) errors.push(`${path}: inward layer imports platform/package ${specifier}`)
        continue
      }
      const resolved = relative('/', resolve('/', dirname(path), specifier)).split('\\').join('/')
      const target = targetFile(resolved, files)
      if (!target) {
        if (!/\.(?:json|sql)$/.test(extname(specifier))) errors.push(`${path}: unowned relative dependency ${specifier}`)
        continue
      }
      const dependency = files[target]
      if (record.context !== dependency.context && !SHARED.has(target) && !(!INNER.has(record.layer) && PUBLIC.has(target)) && record.layer !== 'tooling') errors.push(`${path}: cross-context internal dependency ${target}`)
      if (record.layer === 'domain' && dependency.layer !== 'domain') errors.push(`${path}: domain depends outward on ${target}`)
      if (record.layer === 'application' && !INNER.has(dependency.layer)) errors.push(`${path}: application depends outward on ${target}`)
    }
    if (allowedComputed.length) errors.push(`${path}: stale computed import review`)
    if (INNER.has(record.layer)) {
      const values = tokens(sources(path))
      const runtimeAccess = values.some((token, index) => {
        if (token.kind !== 'word' || !['process', 'global', 'globalThis', 'fetch', 'XMLHttpRequest'].includes(token.value)) return false
        if (values[index - 1]?.value === '.') return false
        // A typed port method is a member name, not a reference to the global.
        if (['{', ';', '}'].includes(values[index - 1]?.value) && values[index + 1]?.value === '(') {
          let depth = 0
          for (let end = index + 1; end < values.length; end++) {
            if (values[end].value === '(') depth++
            if (values[end].value === ')' && --depth === 0) return values[end + 1]?.value !== ':'
          }
        }
        return true
      })
      if (runtimeAccess) errors.push(`${path}: inward layer accesses runtime I/O`)
    }
  }
  return errors
}

export function checkArchitecture(root) {
  const inventory = readInventory(root)
  return boundaryErrors({ ...inventory, sources: (path) => readFileSync(join(root, path), 'utf8') })
}
