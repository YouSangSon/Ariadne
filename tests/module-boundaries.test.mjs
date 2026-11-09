import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'
import { boundaryErrors, checkArchitecture, imports, ROOT_EXCLUSIONS, sourceFiles } from '../core/tooling/architecture.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

test('all inventoried production contexts and root validation sources obey their boundaries', () => {
  assert.deepEqual(checkArchitecture(root), [])
})

test('literal loader scanner covers exports, dynamic imports, CommonJS and TypeScript types', () => {
  assert.deepEqual(imports(`import value from './a.js'; export { value } from './b.js'; await import('./c.js'); require('./d.js'); import './e.js'; type T = import('./f.js').T`),
    ['./a.js', './b.js', './c.js', './d.js', './e.js', './f.js'].map((specifier) => ({ specifier })))
  assert.deepEqual(imports(`// import('./comment.js')\nconst fields = ['from', 'type', 'to']; const example = "import('example')"; const pattern = /import\\(.*\\)/; const text = \`export * from 'example'\``), [])
  assert.deepEqual(imports('import(selectedModule)'), [{ expression: 'selectedModule' }])
  assert.deepEqual(imports("const names = ['require']; const render = () => ['require']"), [])
  assert.throws(() => imports("import('escaped\\x2dmodule')"), /unescaped string/)
  assert.deepEqual(imports(`import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); require('pg')`), [{ specifier: 'node:module' }, { specifier: 'pg' }])
})

test('runtime-valid unsupported CommonJS loaders fail the boundary gate', () => {
  const files = {
    'a/application.cjs': { layer: 'application', context: 'a' },
    'a/files.cjs': { layer: 'infrastructure', context: 'a' },
  }
  for (const source of [
    "module.require('./files.cjs')",
    "const load = require; load('./files.cjs')",
    "require?.('./files.cjs')",
    "module['require']('./files.cjs')",
    "require.call(null, './files.cjs')",
  ]) {
    assert.doesNotThrow(() => new Script(source))
    assert.match(errors(files, { 'a/application.cjs': source }).join('\n'), /unsupported CommonJS loader/)
  }
  assert.throws(() => imports("import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load('./files.cjs')"), /unsupported CommonJS loader binding/)
})

function errors(entries, contents, actual = Object.keys(entries)) {
  return boundaryErrors({ files: entries, actual, sources: (path) => contents[path] ?? '' })
}

test('negative controls reject reverse layers, compatibility facades and cross-context internals', () => {
  const files = {
    'a/domain.mjs': { layer: 'domain', context: 'a' },
    'a/application.mjs': { layer: 'application', context: 'a' },
    'a/files.mjs': { layer: 'infrastructure', context: 'a' },
    'a/old.mjs': { layer: 'compatibility', context: 'a', target: 'a/domain.mjs' },
    'b/domain.mjs': { layer: 'domain', context: 'b' },
  }
  for (const [path, specifier, reason] of [
    ['a/domain.mjs', './application.mjs', /domain depends outward/],
    ['a/application.mjs', './files.mjs', /application depends outward/],
    ['a/application.mjs', './old.mjs', /application depends outward/],
    ['a/domain.mjs', '../b/domain.mjs', /cross-context internal/],
  ]) assert.ok(errors(files, { [path]: `import value from '${specifier}'` }).some((message) => reason.test(message)), `${path} ${specifier}`)
  assert.deepEqual(errors(files, { 'a/application.mjs': "import value from './domain.mjs'" }), [])
})

test('negative controls reject unowned sources, stale records and false layer classifications', () => {
  assert.match(errors({}, {}, ['new-source.mjs']).join('\n'), /unowned source/)
  assert.match(errors({ 'removed.mjs': { layer: 'tooling', context: 'a' } }, {}, []).join('\n'), /stale ownership/)
  assert.match(errors({ 'a/domain.mjs': { layer: 'infrastructure', context: 'a' } }, {}).join('\n'), /incorrect layer classification/)
})

test('new top-level tooling is discovered and cannot escape ownership coverage', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'ariadne-boundaries-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  for (const directory of ['new-tools', '.harness', 'packages/memory/src']) mkdirSync(join(workspace, directory), { recursive: true })
  for (const path of ['new-tools/unowned.mjs', '.harness/evidence.mjs', 'packages/memory/src/owned-separately.ts']) writeFileSync(join(workspace, path), '')
  const actual = sourceFiles(workspace, ['.'], ROOT_EXCLUSIONS)
  assert.deepEqual(actual, ['new-tools/unowned.mjs'])
  assert.match(errors({}, {}, actual).join('\n'), /unowned source new-tools\/unowned.mjs/)
})

test('native sources and WIT interfaces cannot escape the root inventory', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'ariadne-native-boundaries-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  for (const name of ['unowned.go', 'unowned.rs', 'interface.wit', 'qualification.py']) writeFileSync(join(workspace, name), '')
  const actual = sourceFiles(workspace, ['.'])
  assert.deepEqual(actual, ['interface.wit', 'qualification.py', 'unowned.go', 'unowned.rs'])
  assert.equal(errors({}, {}, actual).length, 4)
})

test('Cargo build outputs do not become owned application sources', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'ariadne-cargo-boundaries-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  for (const path of ['runtime/rust/src/domain.rs', 'runtime/rust/target/debug/build/generated.rs']) {
    mkdirSync(dirname(join(workspace, path)), { recursive: true })
    writeFileSync(join(workspace, path), '')
  }
  assert.deepEqual(sourceFiles(workspace, ['.']), ['runtime/rust/src/domain.rs'])
})

test('root sources reject optional packages, unsupported aliases and unreviewed loaders', () => {
  const files = { 'a/domain.mjs': { layer: 'domain', context: 'a' } }
  for (const [source, reason] of [
    ["import x from 'optional-model-package'", /optional package dependency/],
    ["export * from '@/hidden-adapter'", /unsupported alias/],
    ["import x from 'node:fs'", /inward layer imports platform/],
    ['await import(selectedModule)', /unreviewed computed import/],
    ['process.env.API_KEY', /runtime I\/O/],
  ]) assert.match(errors(files, { 'a/domain.mjs': source }).join('\n'), reason)
})

test('runtime capability checks distinguish port members from global access', () => {
  const files = { 'a/domain.mjs': { layer: 'domain', context: 'a' } }
  for (const source of [
    'run.process(file)',
    'run?.process(file)',
    'export interface AdapterRun { process(file: File): AsyncIterable<Event>; }',
  ]) assert.deepEqual(errors(files, { 'a/domain.mjs': source }), [], source)
  for (const source of [
    'process.env.API_KEY',
    'const host = process; host.env.API_KEY',
    'globalThis.process.env.API_KEY',
    'global.process.env.API_KEY',
    'global.fetch(url)',
    'async function run() { return fetch(url) }',
    'const result = ready ? fetch(url) : fallback',
  ]) assert.match(errors(files, { 'a/domain.mjs': source }).join('\n'), /runtime I\/O/, source)
})

test('shared pure exports are controlled and guarded filesystem I/O stays outward', () => {
  const files = {
    'a/domain.mjs': { layer: 'domain', context: 'a' },
    'a/files.mjs': { layer: 'infrastructure', context: 'a' },
    'lib/scrub.mjs': { layer: 'domain', context: 'shared' },
    'core/infrastructure/project-files.mjs': { layer: 'infrastructure', context: 'workspace' },
  }
  assert.deepEqual(errors(files, {
    'a/domain.mjs': "import { scrub } from '../lib/scrub.mjs'",
    'a/files.mjs': "import { readProjectText } from '../core/infrastructure/project-files.mjs'",
  }), [])
  assert.match(errors(files, { 'a/domain.mjs': "import { readProjectText } from '../core/infrastructure/project-files.mjs'" }).join('\n'), /domain depends outward/)
})
