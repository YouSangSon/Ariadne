import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDefinition } from '../modules/ontology/domain.mjs'
import { inspectOntology, loadOntology, searchOntology } from '../modules/ontology/application.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = resolve(root, 'contracts/ontology/node-v1')
const read = (path) => readFileSync(resolve(root, path))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const profile = { node: 'v24.22.2', icu: '78.3', unicode: '17.0' }
const originalSources = {
  'modules/ontology/domain.mjs': 'cf68cacb4b69e6cf71ab2decb57fbe1536b2dc487394473c4636a751708ea416',
  'modules/ontology/application.mjs': '10dc974179343796ed9ad91ab299b295f243655ab3ff5c90613e92d099e9d3bf',
  'lib/scrub.mjs': '9c9b1b233e2af96e3ef106e8c85d7efb94f06d3acd14d70a8959ee1c2990fb7a',
}

// JSON.parse diagnostics may contain authored text; only the error class is a fixture contract.
const errorResult = (error) => error instanceof SyntaxError ? { name: error.name } : { name: error.name, message: error.message }

function observe(entry) {
  const result = { id: entry.id, document_reads: 0, source_reads: [], fingerprints: [] }
  try { result.validation = { value: validateDefinition(JSON.parse(entry.document_json)) } }
  catch (error) { result.validation = { error: errorResult(error) } }
  let snapshot
  try {
    snapshot = loadOntology({
      readDocument() { result.document_reads++; return JSON.parse(entry.document_json) },
      readSource(path) {
        result.source_reads.push(path)
        assert.ok(Object.hasOwn(entry.sources, path), 'Missing offline source')
        return sha256(Buffer.from(entry.sources[path], 'utf8'))
      },
      hash(text) {
        const bytes = Buffer.from(text, 'utf8')
        const digest = sha256(bytes)
        result.fingerprints.push({ utf8_hex: bytes.toString('hex'), sha256: digest })
        return digest
      },
    })
  } catch (error) {
    result.load_error = errorResult(error)
    return result
  }
  result.inspect = inspectOntology(snapshot)
  result.searches = entry.searches.map(({ query, limit }) => {
    try { return { value: searchOntology(snapshot, query, limit) } }
    catch (error) { return { error: errorResult(error) } }
  })
  return result
}

export function generateOntologyGoldens() {
  const runtime = { node: process.version, icu: process.versions.icu, unicode: process.versions.unicode }
  assert.deepEqual(runtime, profile, 'ontology oracle runtime drift; use the reviewed Node profile')
  const sources = Object.fromEntries(Object.keys(originalSources).map((path) => [path, sha256(read(path))]))
  assert.deepEqual(sources, originalSources, 'ontology source drift; review before updating the frozen source hashes')
  const inputs = 'contracts/ontology/node-v1/cases.json'
  const oracle = 'scripts/ontology-node-goldens.mjs'
  const corpus = JSON.parse(read(inputs))
  assert.equal(corpus.fixture_version, 1)
  assert.equal(new Set(corpus.cases.map((entry) => entry.id)).size, corpus.cases.length, 'duplicate fixture ID')
  return {
    fixture_version: 1,
    provenance: { runtime, source_sha256: sources, inputs_sha256: sha256(read(inputs)), oracle_sha256: sha256(read(oracle)) },
    cases: corpus.cases.map(observe),
  }
}

export function checkOntologyGoldens(expected = JSON.parse(readFileSync(resolve(directory, 'expected.json'), 'utf8'))) {
  assert.deepEqual(expected, generateOntologyGoldens(), 'ontology golden drift; review source, runtime, inputs and literal outcomes before --write')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length <= 3 && [undefined, '--check', '--write'].includes(process.argv[2]), 'usage: ontology-node-goldens.mjs [--check|--write]')
  if (process.argv[2] === '--write') writeFileSync(resolve(directory, 'expected.json'), JSON.stringify(generateOntologyGoldens(), null, 2) + '\n')
  else checkOntologyGoldens()
}
