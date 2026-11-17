import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { generate } from '../scripts/context-files-node-goldens.mjs'

test('actual Node Context file and CLI oracle remains frozen', () => {
  const expected = JSON.parse(readFileSync(new URL('../contracts/context/files-cli-v1/expected.json', import.meta.url)))
  assert.deepEqual(generate(), expected)
})
