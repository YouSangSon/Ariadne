import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkOntologyGoldens } from '../scripts/ontology-node-goldens.mjs'

const expected = JSON.parse(readFileSync(new URL('../contracts/ontology/node-v1/expected.json', import.meta.url), 'utf8'))

test('actual original Node ontology functions reproduce literal offline migration goldens', () => {
  checkOntologyGoldens(expected)
})

test('fixtures retain raw fingerprint bytes, UTF-16 strings and validation-before-source-read evidence', () => {
  const entry = (id) => expected.cases.find((value) => value.id === id)
  assert.deepEqual(entry('source-order-unreviewed').source_reads, ['a.md', 'z.md', '😀.md', '\ue000.md'])
  for (const value of expected.cases) {
    assert.equal(value.document_reads, 1, value.id)
    if (value.load_error) {
      assert.deepEqual(value.source_reads, [], value.id)
      assert.deepEqual(value.fingerprints, [], value.id)
    } else assert.equal(value.fingerprints.length, 1, value.id)
  }
  assert.deepEqual(['review-current', 'review-stale-definition', 'review-stale-source'].map((id) => entry(id).inspect.review_status), ['current', 'stale', 'stale'])
  assert.equal(entry('source-order-unreviewed').inspect.digest, entry('review-current').inspect.digest)
  const raw = Buffer.from(entry('raw-fingerprint-escaping').fingerprints[0].utf8_hex, 'hex').toString('utf8')
  assert.ok(raw.includes('<>&\u2028\u2029'))
  assert.ok(raw.includes('e\u0301 ＦＯＯ İ'))
  assert.ok(raw.includes('\\ud800'))
  assert.ok(!raw.includes('reviewed_digest'))
  const searches = entry('lone-surrogates-and-astral-half-queries').searches.map(({ value }) => value)
  assert.deepEqual(searches.map((value) => value.terms.map((term) => term.id)), [['high'], ['low'], ['astral'], ['astral'], ['astral']])
  assert.equal(searches[0].terms[0].name.charCodeAt(0), 0xd800)
  assert.equal(searches[1].terms[0].name.charCodeAt(0), 0xdc00)
  assert.deepEqual(entry('json-invalid-sanitized').load_error, { name: 'SyntaxError' })
})

test('golden checks reject result, fingerprint and provenance mutations without rewriting fixtures', () => {
  for (const mutate of [
    (value) => { value.cases[0].inspect.term_count++ },
    (value) => { value.cases[0].fingerprints[0].sha256 = '0'.repeat(64) },
    (value) => { value.cases[0].fingerprints[0].utf8_hex += '00' },
    (value) => { value.cases[0].source_reads.reverse() },
    (value) => { value.provenance.runtime.unicode = 'changed' },
    (value) => { value.provenance.source_sha256['modules/ontology/domain.mjs'] = '0'.repeat(64) },
    (value) => { value.provenance.inputs_sha256 = '0'.repeat(64) },
    (value) => { value.provenance.oracle_sha256 = '0'.repeat(64) },
  ]) {
    const changed = structuredClone(expected)
    mutate(changed)
    assert.throws(() => checkOntologyGoldens(changed), /ontology golden drift/)
  }
  assert.deepEqual(JSON.parse(readFileSync(new URL('../contracts/ontology/node-v1/expected.json', import.meta.url), 'utf8')), expected)
})
