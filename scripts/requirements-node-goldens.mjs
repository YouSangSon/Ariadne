import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseContract, slug, sourceFiles } from '../modules/requirements/domain.mjs'
import { loadContract, sourceState } from '../modules/requirements/application.mjs'

const root = new URL('../', import.meta.url)
const directory = new URL('contracts/requirements/node-v1/', root)
const read = (path) => readFileSync(new URL(path, root))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const profile = { node: 'v24.22.2', icu: '78.3', unicode: '17.0' }
const originalSources = {
  'modules/requirements/domain.mjs': 'd663579aa62b8781703475f271a8ceb8dfa1e92c09c933876764259bbe3d6bee',
  'modules/requirements/application.mjs': '27b2b40f93a0cf8df9c6d5b9ae5d4a44a2e75eab7d9262f8566ead31d0541e71',
  'core/domain/requirement-fields.mjs': 'b42ba8decc94483dca7affac81be03c3a977266cb2b16a4f20de6178675397de',
}
// Retained public/files boundaries are provenance, not exercised native-adapter contracts.
const originalReferences = {
  'modules/requirements/files.mjs': '90f29d5181eb3aabc66d06bd78e868fb6c4915c6e54b2df9f8df0358ddcda1e1',
  'modules/loop/contract.mjs': '4f39e0d188d0643a07b0dc0ce294e3416d856b143ed7582129ea33f122e1fe0e',
}

export function utf16Hex(text) {
  let result = ''
  for (let i = 0; i < text.length; i++) result += text.charCodeAt(i).toString(16).padStart(4, '0')
  return result
}
function stringUnits(value) {
  if (typeof value === 'string') return utf16Hex(value)
  if (Array.isArray(value)) return value.map(stringUnits)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stringUnits(item)]))
  return value
}
function pathsFor(entry) {
  const paths = [...(entry.paths ?? [])]
  if (entry.path_recipe) {
    const { count, prefix = 'file-', width = 5, duplicates = 0, excluded = 0 } = entry.path_recipe
    for (let i = 0; i < count; i++) paths.push(prefix + String(i).padStart(width, '0'))
    for (let i = 0; i < duplicates; i++) paths.push(paths[i % count])
    for (let i = 0; i < excluded; i++) paths.push('node_modules/generated-' + i)
  }
  return paths
}
function filesResult(files, compact) {
  if (!compact) return { value: files, utf16_hex: stringUnits(files) }
  // UTF16BE code-unit stream, with one 0000 terminator per path; paths contain no NUL in this recipe.
  const bytes = Buffer.from(files.map((path) => utf16Hex(path) + '0000').join(''), 'hex')
  return { count: files.length, utf16be_nul_sha256: sha256(bytes), first: files.slice(0, 2), last: files.slice(-2) }
}
function contentFor(input) {
  if (input.content_recipe) return Buffer.alloc(input.content_recipe.length, input.content_recipe.byte)
  return Buffer.from(input.content_hex ?? '', 'hex')
}
const errorResult = (error, injected) => ({ name: error.name, message: error.message, ...(injected ? { original_port_error: error === injected } : {}) })
function outcome(run, injected) {
  try { const value = run(); return { value, utf16_hex: stringUnits(value) } }
  catch (error) { return { error: errorResult(error, injected) } }
}
function observeContract(entry) {
  const result = { id: entry.id, op: entry.op, parse: outcome(() => parseContract(entry.yaml, entry.req_id)), events: [], payloads: [] }
  const injected = entry.fail ? new Error('injected ' + entry.fail) : undefined
  result.load = outcome(() => loadContract({
    readRequirement(reqId) {
      result.events.push({ call: 'readRequirement', req_id_utf16_hex: utf16Hex(reqId) })
      if (entry.fail === 'readRequirement') throw injected
      return entry.yaml
    },
    hash(text) {
      const bytes = Buffer.from(text, 'utf8')
      const payload = { utf8_hex: bytes.toString('hex'), sha256: sha256(bytes) }
      result.events.push({ call: 'hash' })
      result.payloads.push(payload)
      if (entry.fail === 'hash') throw injected
      return payload.sha256
    },
  }, entry.req_id), injected)
  return result
}
function observeState(entry) {
  const result = { id: entry.id, op: entry.op, events: [], updates: [] }
  const injected = entry.fail ? new Error('injected ' + entry.fail) : undefined
  let updates = 0
  let current
  let inspected
  const options = entry.req_id === undefined ? {} : { reqId: entry.req_id }
  result.result = outcome(() => sourceState({
    inspectGit() {
      result.events.push({ call: 'inspectGit' })
      if (entry.fail === 'inspectGit') throw injected
      if (entry.mutations?.inspect_req_id !== undefined) options.reqId = entry.mutations.inspect_req_id
      inspected = { head: entry.head ?? null, paths: pathsFor(entry) }
      return inspected
    },
    sourceHasher() {
      result.events.push({ call: 'sourceHasher' })
      if (entry.fail === 'sourceHasher') throw injected
      if (entry.mutations?.factory_head !== undefined) inspected.head = entry.mutations.factory_head
      const hash = createHash('sha256')
      return {
        update(value) {
          result.events.push({ call: 'update', index: updates++ })
          const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
          const frame = { type: Buffer.isBuffer(value) ? 'raw' : 'header', length: bytes.length, sha256: sha256(bytes) }
          if (Buffer.isBuffer(value) && current.content_recipe) frame.recipe = current.content_recipe
          else frame.hex = bytes.toString('hex')
          result.updates.push(frame)
          if (entry.fail === 'update' && updates - 1 === entry.fail_at) throw injected
          hash.update(value)
        },
        digest() {
          result.events.push({ call: 'digest' })
          if (entry.fail === 'digest') throw injected
          return hash.digest('hex')
        },
      }
    },
    readInput(path) {
      result.events.push({ call: 'readInput', path_utf16_hex: utf16Hex(path) })
      if (entry.fail === 'readInput' && (!entry.fail_path || path === entry.fail_path)) throw injected
      current = entry.inputs[path]
      assert.ok(current, 'missing offline input: ' + path)
      return { kind: current.kind, mode: current.mode ?? null, content: contentFor(current) }
    },
  }, options), injected)
  return result
}
function observe(entry) {
  switch (entry.op) {
    case 'contract': return observeContract(entry)
    case 'slug': return { id: entry.id, op: entry.op, result: outcome(() => slug(entry.req_id)) }
    case 'files': {
      const result = { id: entry.id, op: entry.op }
      try { result.result = filesResult(sourceFiles(pathsFor(entry), entry.req_id), Boolean(entry.path_recipe)) }
      catch (error) { result.error = errorResult(error) }
      return result
    }
    case 'state': return observeState(entry)
    default: throw new Error('unknown requirements oracle operation: ' + entry.op)
  }
}

export function generateRequirementsGoldens() {
  const runtime = { node: process.version, icu: process.versions.icu, unicode: process.versions.unicode }
  assert.deepEqual(runtime, profile, 'requirements oracle runtime drift; use the reviewed Node profile')
  const sourceSHA = Object.fromEntries(Object.keys(originalSources).map((path) => [path, sha256(read(path))]))
  const referenceSHA = Object.fromEntries(Object.keys(originalReferences).map((path) => [path, sha256(read(path))]))
  assert.deepEqual(sourceSHA, originalSources, 'requirements source drift; review frozen import closure')
  assert.deepEqual(referenceSHA, originalReferences, 'requirements reference source drift; review public/files boundary')
  const inputs = 'contracts/requirements/node-v1/cases.json'
  const oracle = 'scripts/requirements-node-goldens.mjs'
  const corpus = JSON.parse(read(inputs))
  assert.equal(corpus.fixture_version, 1)
  assert.equal(new Set(corpus.cases.map(({ id }) => id)).size, corpus.cases.length, 'duplicate fixture ID')
  const cases = corpus.cases.map(observe)
  const payloadSHA = Object.fromEntries(cases.filter((entry) => entry.payloads?.length).map((entry) => [entry.id, entry.payloads.map(({ sha256: digest }) => digest)]))
  return {
    fixture_version: 1,
    source_manifest: { runtime, import_closure_sha256: sourceSHA, retained_reference_sha256: referenceSHA },
    payload_manifest: { inputs_sha256: sha256(read(inputs)), oracle_sha256: sha256(read(oracle)), contract_payload_sha256: payloadSHA },
    cases,
  }
}
export function checkRequirementsGoldens(expected = JSON.parse(readFileSync(new URL('expected.json', directory), 'utf8'))) {
  assert.deepEqual(expected, generateRequirementsGoldens(), 'requirements golden drift; review source, runtime, recipes and literal outcomes before --write')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length <= 3 && [undefined, '--check', '--write'].includes(process.argv[2]), 'usage: requirements-node-goldens.mjs [--check|--write]')
  if (process.argv[2] === '--write') writeFileSync(new URL('expected.json', directory), JSON.stringify(generateRequirementsGoldens(), null, 2) + '\n')
  else checkRequirementsGoldens()
}
