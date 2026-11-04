import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const contexts = ['packages/memory', 'packages/code', 'modules/ontology', 'modules/loop', 'modules/llm-wiki']
function owner(path) {
  return contexts.find((context) => path.startsWith(`${context}/`))
}
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path) : /\.(?:[cm]?js|tsx?)$/.test(entry.name) ? [path] : []
  })
}
function imports(source) {
  assert.doesNotMatch(source, /\b(?:import|require)\s*\(\s*(?!['"\s])/, 'computed imports require an explicit boundary review')
  // shortcut: this checks literal JS/TS import forms; use an AST rule when introducing aliases or new loader syntax.
  return [...source.matchAll(/\b(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])
}

test('bounded contexts do not import another context internals', () => {
  const files = contexts.flatMap((context) => sources(join(root, context, context.startsWith('packages/') ? 'src' : '')))
  for (const file of files) {
    const sourceOwner = owner(relative(root, file))
    for (const specifier of imports(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) continue
      const targetOwner = owner(relative(root, resolve(dirname(file), specifier)))
      assert.ok(!targetOwner || targetOwner === sourceOwner, `${relative(root, file)} crosses into ${targetOwner}`)
    }
  }
})

test('ontology domain and use cases depend only on pure inward code', () => {
  const pure = new Set(['modules/ontology/domain.mjs', 'modules/ontology/application.mjs', 'lib/scrub.mjs', 'lib/module-selection.mjs'])
  for (const path of pure) {
    const source = readFileSync(join(root, path), 'utf8')
    assert.doesNotMatch(source, /\b(?:process|globalThis|fetch|XMLHttpRequest)\b/, path)
    for (const specifier of imports(source)) {
      assert.ok(specifier.startsWith('.'), `${path} imports platform/package dependency ${specifier}`)
      const target = relative(root, resolve(root, dirname(path), specifier))
      assert.ok(pure.has(target), `${path} depends outward on ${target}`)
      if (path.endsWith('/domain.mjs')) assert.notEqual(target, 'modules/ontology/application.mjs')
    }
  }
})

test('boundary scanner includes static exports, dynamic imports and CommonJS loads', () => {
  assert.deepEqual(imports(`import value from './a.js'; export { value } from './b.js'; await import('./c.js'); require('./d.js'); import './e.js'`), ['./a.js', './b.js', './c.js', './d.js', './e.js'])
  assert.deepEqual(imports("const fields = ['from', 'type', 'to']"), [])
  assert.throws(() => imports('import(selectedModule)'), /computed imports/)
})
