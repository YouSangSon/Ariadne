import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkVerificationGoldens } from '../scripts/core-verification-node-goldens.mjs'
const expected = JSON.parse(readFileSync(new URL('../contracts/core/verification-node-v1/expected.json', import.meta.url), 'utf8'))

test('actual Node verification exports reproduce lossless UTF-16 goldens', () => checkVerificationGoldens(expected))
test('verification oracle detects literal results, events, identity and provenance drift', () => {
  for (const mutate of [
    value => { value.cases.find(x => x.id === 'req-none').value = false },
    value => { value.cases.find(x => x.id === 'log-surrogateCut').value = '' },
    value => { value.cases.find(x => x.id === 'run-green').events.reverse() },
    value => { value.cases.find(x => x.id === 'error-runTests').sameError = false },
    value => { value.provenance.source_sha256['core/domain/commit.mjs'] = 'changed' },
    value => { value.provenance.inputs_sha256 = 'changed' },
    value => { value.provenance.oracle_sha256 = 'changed' },
    value => { value.provenance.runtime.icu = 'changed' },
    value => { value.provenance.runtime.node = 'changed' },
  ]) {
    const changed = structuredClone(expected)
    mutate(changed)
    assert.throws(() => checkVerificationGoldens(changed), /verification golden drift/)
  }
})
