import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkComputeFixtures, reconstructPairs } from '../scripts/generate-compute-fixtures.js';
import { computeCoChanges } from '../src/domain/indexing/co-change.js';

test('committed numeric fixtures match actual TS semantics, provenance and identity', () => {
  checkComputeFixtures();
});

test('stable Unicode ties make the first-seen ordinal observable', () => {
  const index = JSON.parse(readFileSync(new URL('../../../contracts/compute/v1/fixtures/cases.json', import.meta.url), 'utf8'));
  const entry = index.valid.find((entry: { name: string }) => entry.name === 'unicode-ties');
  const counts = JSON.parse(readFileSync(new URL(`../../../contracts/compute/v1/fixtures/${entry.response}`, import.meta.url), 'utf8'));
  const actual = computeCoChanges(entry.semantic.commits, new Set(entry.semantic.included), entry.semantic.options);
  assert.deepEqual(reconstructPairs(counts, entry.semantic), actual);
  counts.pairs.forEach((pair: number[], index: number) => { pair[3] = index; });
  assert.notDeepEqual(reconstructPairs(counts, entry.semantic), actual);
});
