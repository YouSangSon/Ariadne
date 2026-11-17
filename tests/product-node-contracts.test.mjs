import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkProductGoldens } from '../scripts/product-node-goldens.mjs'

const expected = JSON.parse(readFileSync(new URL('../contracts/core/product-node-v1/expected.json', import.meta.url), 'utf8'))

test('actual Node product exports reproduce pinned migration goldens', async () => {
  await checkProductGoldens(expected)
})

test('product oracle detects result, events and provenance drift', async () => {
  for (const mutate of [
    (value) => { value.cases.find(({ id }) => id === 'plan-setup').value.cwd = 'changed' },
    (value) => { value.cases.find(({ id }) => id === 'run-verify-success').events.reverse() },
    (value) => { value.provenance.source_sha256['core/domain/product.mjs'] = '0'.repeat(64) },
    (value) => { value.provenance.inputs_sha256 = '0'.repeat(64) },
    (value) => { value.provenance.oracle_sha256 = '0'.repeat(64) },
    (value) => { value.provenance.runtime.node = 'changed' },
  ]) {
    const changed = structuredClone(expected)
    mutate(changed)
    await assert.rejects(() => checkProductGoldens(changed), /product golden drift/)
  }
})
