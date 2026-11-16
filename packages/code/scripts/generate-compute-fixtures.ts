import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCoChanges, DEFAULT_CO_CHANGE_OPTIONS, type CoChangeOptions, type CoChangePair } from '../src/domain/indexing/co-change.js';
import { fileEntityId, relationId } from '../src/domain/indexing/index-policy.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixtures = resolve(repoRoot, 'contracts/compute/v1/fixtures');
const read = (name: string): string => readFileSync(resolve(fixtures, name), 'utf8');
type Counts = { frequencies: number[]; pairs: [number, number, number, number][] };
type Semantic = { paths: string[]; commits: string[][]; included: string[]; options: Partial<CoChangeOptions> };
type Case = { name: string; request: string; response: string; canonicalPayload: string; sha256: string; semantic?: Semantic };

export function reconstructPairs(counts: Counts, semantic: Semantic): CoChangePair[] {
  const options = { ...DEFAULT_CO_CHANGE_OPTIONS, ...semantic.options };
  const pairs: CoChangePair[] = [];
  for (const [a, b, count] of [...counts.pairs].sort((x, y) => x[3] - y[3])) {
    const couplingScore = count / Math.max(counts.frequencies[a]!, counts.frequencies[b]!);
    if (count < options.minCoChanges || couplingScore < options.minCouplingScore) continue;
    const source = semantic.paths[a]!;
    const target = semantic.paths[b]!;
    pairs.push({ source, target, coChangeCount: count, couplingScore });
    pairs.push({ source: target, target: source, coChangeCount: count, couplingScore });
  }
  return pairs.sort((x, y) => x.source.localeCompare(y.source) || x.target.localeCompare(y.target));
}
function identities(pairs: CoChangePair[]) {
  return pairs.map((pair) => {
    const sourceEntityId = fileEntityId(pair.source);
    const targetEntityId = fileEntityId(pair.target);
    const provenance = `co-change:${pair.coChangeCount}:${pair.couplingScore.toFixed(2)}`;
    return { sourceEntityId, targetEntityId, provenance,
      relationId: relationId('CO_CHANGES', sourceEntityId, targetEntityId, provenance),
      snippet: `co-changed with ${pair.target} in ${pair.coChangeCount} commits (coupling ${pair.couplingScore.toFixed(2)})` };
  });
}
export function generateComputeFixtures() {
  const sources = [
    'packages/code/src/domain/indexing/co-change.ts',
    'packages/code/src/domain/indexing/index-policy.ts',
    'packages/code/src/infrastructure/sqlite/indexing.ts'
  ];
  const sourceHashes = Object.fromEntries(sources.map((source) => [source,
    createHash('sha256').update(readFileSync(resolve(repoRoot, source))).digest('hex')]));
  assert.equal(sourceHashes[sources[0]!], '5d295d3dff0dd80b51e6c0b8f218a9ec7cf1c1b0753d525f659d626d4324ae27');
  const publication = readFileSync(resolve(repoRoot, sources[2]!), 'utf8');
  assert.ok(publication.includes('provenance: `co-change:${pair.coChangeCount}:${pair.couplingScore.toFixed(2)}`'));
  assert.ok(publication.includes('snippet: `co-changed with ${pair.target} in ${pair.coChangeCount} commits (coupling ${pair.couplingScore.toFixed(2)})`'));
  const index = JSON.parse(read('cases.json')) as { valid: Case[] };
  const cases = index.valid.filter((entry) => entry.semantic).map((entry) => {
    const semantic = entry.semantic!;
    const included = new Set(semantic.included);
    const accepted = semantic.commits.map((commit) => [...new Set(commit)])
      .filter((commit) => commit.length <= DEFAULT_CO_CHANGE_OPTIONS.maxFilesPerCommit)
      .map((commit) => commit.filter((path) => included.has(path)).sort());
    const paths = [...new Set(accepted.flat())].sort();
    assert.deepEqual(paths, semantic.paths, `${entry.name}: UTF-16 ID table`);
    const payload = { fileCount: paths.length, commits: accepted.map((commit) => commit.map((path) => paths.indexOf(path))) };
    assert.equal(JSON.stringify(payload), read(entry.canonicalPayload), `${entry.name}: preprocessing`);
    assert.equal(createHash('sha256').update(JSON.stringify(payload)).digest('hex'), entry.sha256);
    assert.deepEqual(JSON.parse(read(entry.request)).payload, payload);
    const literal = JSON.parse(read(entry.response)) as Counts;
    const reconstructed = reconstructPairs(literal, semantic);
    const actual = computeCoChanges(semantic.commits, included, semantic.options);
    assert.deepEqual(reconstructed, actual, `${entry.name}: actual TypeScript oracle`);
    assert.deepEqual(identities(reconstructed), identities(actual), `${entry.name}: provenance and IDs`);
    return { name: entry.name, pairs: actual, identities: identities(actual) };
  });
  const rounding = cases.find((entry) => entry.name === 'rounding-five-eighths')!;
  assert.equal(rounding.identities[0]!.provenance, 'co-change:5:0.63');
  assert.equal(rounding.identities[0]!.relationId, '5aa78f18b028979867bb');
  return { sourceHashes, node: process.version, icu: process.versions.icu,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    scope: 'Offline numeric counts, actual TS ordering, provenance and IDs; no Go locale, DB publication or subprocess proof.', cases };
}
export function checkComputeFixtures(): void {
  assert.equal(JSON.stringify(generateComputeFixtures(), null, 2) + '\n', read('ts-oracle.json'), 'compute fixture drift; review source/runtime/contract changes before regenerating');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--check')) throw new Error('usage: generate-compute-fixtures.ts [--check]');
  if (process.argv[2] === '--check') checkComputeFixtures();
  else writeFileSync(resolve(fixtures, 'ts-oracle.json'), JSON.stringify(generateComputeFixtures(), null, 2) + '\n');
}
