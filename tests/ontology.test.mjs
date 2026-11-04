import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectOntology, loadOntology, searchOntology } from '../modules/ontology/application.mjs'
import { ontologyFiles } from '../modules/ontology/files.mjs'

const cli = fileURLToPath(new URL('../modules/ontology/cli.mjs', import.meta.url))
const hash = (text) => createHash('sha256').update(text).digest('hex')
const term = (id, extra = {}) => ({ id, name: id, description: `Definition of ${id}`, synonyms: [], sources: ['evidence.md'], ...extra })
const definition = () => ({ schema_version: 1, terms: [term('memory', { synonyms: ['기억', '记忆'] }), term('ontology')], relations: [{ from: 'ontology', type: 'describes', to: 'memory', sources: ['evidence.md'] }] })
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ariadne-ontology-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'ontology.json')
  const save = (data) => writeFileSync(file, JSON.stringify(data))
  writeFileSync(join(root, 'evidence.md'), 'Memory stores reusable evidence.\n')
  save(definition())
  return { root, file, save, load: () => loadOntology(ontologyFiles(file)) }
}
function run(root, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 10000 })
}

test('application works through ports without a filesystem or other modules', () => {
  const reads = []
  const snapshot = loadOntology({ readDocument: definition, readSource: (path) => { reads.push(path); return hash('evidence') }, hash })
  assert.deepEqual(reads, ['evidence.md'])
  const result = searchOntology(snapshot, '记忆')
  assert.equal(result.review_status, 'unreviewed')
  assert.deepEqual(result.terms.map((item) => item.id), ['memory'])
  assert.equal(result.relations[0].type, 'describes')
  assert.equal(inspectOntology(snapshot).relation_count, 1)
})

test('review follows definitions and current source bytes, not JSON formatting', (t) => {
  const f = fixture(t), data = definition()
  data.reviewed_digest = f.load().digest
  f.save(data)
  assert.equal(f.load().review_status, 'current')
  writeFileSync(f.file, JSON.stringify(data, null, 2))
  assert.equal(f.load().review_status, 'current')
  data.terms[0].description = 'A changed definition'
  f.save(data)
  assert.equal(f.load().review_status, 'stale')
  data.reviewed_digest = f.load().digest
  f.save(data)
  writeFileSync(join(f.root, 'evidence.md'), 'Changed source, unchanged definition')
  assert.equal(f.load().review_status, 'stale')
  rmSync(join(f.root, 'evidence.md'))
  assert.throws(f.load, /does not exist/)
})

test('shared aliases stay ambiguous before truncation and relations are bounded', (t) => {
  const f = fixture(t), data = definition()
  data.terms = [term('a', { synonyms: ['shared'] }), term('b', { synonyms: ['SHARED'] }), term('c')]
  data.relations = ['b', 'c'].map((to) => ({ from: 'a', type: 'relates_to', to, sources: [] }))
  f.save(data)
  const result = searchOntology(f.load(), 'shared', 1)
  assert.equal(result.ambiguous, true)
  assert.equal(result.total_matches, 2)
  assert.equal(result.truncated, true)
  assert.equal(result.terms[0].id, 'a')
  assert.equal(result.relations.length, 1)
  assert.equal(result.total_relations, 2)
  assert.equal(result.relations_truncated, true)
  assert.equal(searchOntology(f.load(), 'absent').total_matches, 0)
  assert.equal(inspectOntology(f.load()).relations_without_sources, 2)
  assert.throws(() => searchOntology(f.load(), ' ', 1), /query/)
  assert.throws(() => searchOntology(f.load(), 'a', 0), /limit/)
})

test('invalid schema, identity and dangling relations fail before source reads', () => {
  for (const change of [
    (d) => { d.schema_version = 2 }, (d) => { d.unrecognized = true },
    (d) => { d.terms.push(d.terms[0]) }, (d) => { d.relations[0].to = 'missing' },
    (d) => { d.terms[0].synonyms = ['same', 'SAME'] }, (d) => { d.reviewed_digest = 'approved' },
    (d) => { d.relations.push(d.relations[0]) }, (d) => { d.terms[0].sources = ['../outside'] },
    (d) => { d.terms[0].id = 'sk-' + 'a'.repeat(30) },
    (d) => { d.terms[0].sources = ['sk-' + 'a'.repeat(30)] },
  ]) {
    const data = definition(); change(data)
    assert.throws(() => loadOntology({ readDocument: () => data, readSource: () => assert.fail('must validate before I/O'), hash }))
  }
})

test('sources reject self, same-inode aliases, symlinks, protected paths and excessive input', (t) => {
  const f = fixture(t)
  linkSync(f.file, join(f.root, 'alias.json'))
  symlinkSync(join(f.root, 'evidence.md'), join(f.root, 'link.md'))
  for (const [path, message] of [['ontology.json', /own source/], ['alias.json', /own source/], ['link.md', /Symbolic/], ['.env', /Protected/]]) {
    const data = definition(); data.terms[0].sources = [path]; f.save(data)
    assert.throws(f.load, message)
  }
  f.save(definition())
  writeFileSync(join(f.root, 'evidence.md'), Buffer.alloc(1024 * 1024 + 1, 65))
  assert.throws(f.load, /1 MiB/)
  writeFileSync(join(f.root, 'evidence.md'), Buffer.from([0xff]))
  assert.throws(f.load, /UTF-8/)
  writeFileSync(f.file, Buffer.alloc(1024 * 1024 + 1, 65))
  assert.throws(f.load, /1 MiB/)
})

test('unique source count is bounded before any source I/O', () => {
  const data = definition()
  data.terms = Array.from({ length: 33 }, (_, i) => term(`term-${i}`, { sources: [`${i}.md`] }))
  data.relations = []
  assert.throws(() => loadOntology({ readDocument: () => data, readSource: () => assert.fail('over limit'), hash }), /32 unique/)
})

test('CLI from a different cwd returns scrubbed valid JSON and never changes authored data', (t) => {
  const f = fixture(t), data = definition()
  const secret = 'postgres://fixture:fixture@db.example.test'
  data.terms[0].description = `Quoted "value" and ${secret}`
  f.save(data)
  const original = readFileSync(f.file, 'utf8')
  const r = run(tmpdir(), 'search', '--file', f.file, '--query', 'memory')
  assert.equal(r.status, 0, r.stderr)
  const result = JSON.parse(r.stdout)
  assert.match(result.terms[0].description, /\[REDACTED_DB_URL\]/)
  assert.ok(!r.stdout.includes(secret))
  assert.equal(readFileSync(f.file, 'utf8'), original)
  const launcher = fileURLToPath(new URL('../bin/Ariadne.mjs', import.meta.url))
  const inspect = spawnSync(process.execPath, [launcher, 'ontology', 'inspect', '--file', f.file], { cwd: tmpdir(), encoding: 'utf8', timeout: 10000 })
  assert.equal(inspect.status, 0, inspect.stderr)
  assert.equal(JSON.parse(inspect.stdout).digest, f.load().digest)
  const digest = f.load().digest
  data.terms[0].description = 'postgres://different:password@db.example.test'
  f.save(data)
  assert.notEqual(f.load().digest, digest, 'raw authored text must be fingerprinted before redaction')
})

test('CLI rejects invalid options and hides malformed JSON source text', (t) => {
  const f = fixture(t)
  for (const args of [['search'], ['inspect', '--query', 'x'], ['inspect', '--file', f.file, '--file', f.file], ['search', '--query', 'x', '--limit', '1.5']]) {
    assert.equal(run(f.root, ...args).status, 2)
  }
  const secret = 'sk-' + 'z'.repeat(30)
  writeFileSync(f.file, `{invalid: "${secret}"}`)
  const r = run(f.root, 'inspect', '--file', f.file)
  assert.equal(r.status, 2)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /Invalid ontology JSON/)
  assert.ok(!r.stderr.includes(secret))
})
