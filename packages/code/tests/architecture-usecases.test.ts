import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeDiff, type AnalysisPorts, type AnalysisSession } from '../src/application/impact/analyze.js';
import { indexProjectInternal } from '../src/application/indexing/index-project.js';
import type { IndexingSession } from '../src/application/indexing/ports.js';
import { rememberOnRepo } from '../src/application/local-memory/operations.js';
import type { LocalMemoryPorts } from '../src/application/local-memory/ports.js';
import { AdapterRegistry } from '../src/domain/indexing/adapter-registry.js';
import type { CanonicalImpactRow } from '../src/domain/impact/analysis.js';
import type { ImpactReport, IndexResult } from '../src/domain/model.js';

function unavailable(): never { throw new Error('unexpected adapter operation'); }

function inbound(source: string, target: string): CanonicalImpactRow {
  return {
    relation_id: `${source}->${target}`, relation_kind: 'DEPENDS_ON', relation_confidence: 'proven', provenance: 'test',
    source_entity_id: `file:${source}`, source_kind: 'file', source_path: source,
    source_symbol: null, source_language_id: 'typescript', source_display_name: source,
    target_entity_id: `file:${target}`, target_kind: 'file', target_path: target,
    target_symbol: null, target_language_id: 'typescript', target_display_name: target,
    evidence_id: `evidence:${source}`, evidence_file_path: source, evidence_kind: 'imports',
    evidence_snippet: 'an import', evidence_confidence: 'proven', evidence_start_line: null,
    evidence_end_line: null, evidence_start_col: null, evidence_end_col: null
  };
}

test('analysis coordinates semantic readers, report persistence and cleanup without storage capabilities', async () => {
  const reads: Array<[string, number]> = [];
  const saved: ImpactReport[] = [];
  let closed = 0;
  const session: AnalysisSession = {
    indexRunId: 17,
    gitWarnings: () => [], adapterInsights: () => [],
    changedFile: () => ({ canonical: true, indexed: { contentHash: 'same' } }),
    inboundRelations(id, limit) {
      reads.push([id, limit]);
      return id === 'file:src/core.ts' ? [inbound('tests/core.test.ts', 'src/core.ts')] : [];
    },
    legacyImpacts: () => [], outgoingEvidence: () => [],
    crossRepoImpacts: () => ({ candidates: [], malformedLinkCount: 0 }),
    saveReport: (report) => saved.push(structuredClone(report)),
    close: () => { closed++; }
  };
  const ports: AnalysisPorts = {
    normalizeRoot: () => '/virtual', changedPath: (_root, file) => file,
    openSession: () => session, currentFileHash: () => 'same',
    sourceEvidence: (_root, file) => ({ id: 'changed', file, kind: 'changed-file', snippet: '', confidence: 'proven' }),
    writeReport: () => '.parallax/reports/report.md'
  };
  const report = await analyzeDiff({ repoRoot: '/virtual', changedFiles: ['src/core.ts'], maxFanout: 3, writeReport: true }, ports);
  assert.deepEqual(reads, [['file:src/core.ts', 4], ['file:tests/core.test.ts', 4]]);
  assert.equal(report.affectedFiles[0]?.path, 'tests/core.test.ts');
  assert.equal(report.actions[0]?.target.path, 'tests/core.test.ts');
  assert.equal(saved[0]?.reportPath, '.parallax/reports/report.md');
  assert.equal(closed, 1);

  ports.changedPath = () => { throw new Error('invalid path'); };
  await assert.rejects(analyzeDiff({ repoRoot: '/virtual', changedFiles: ['../secret'] }, ports), /invalid path/);
  assert.equal(closed, 2);
});

test('a validated clean index returns before extraction or publication and closes its session', async () => {
  let closed = 0;
  const result: IndexResult = { indexRunId: 9, mode: 'incremental', filesIndexed: 1, symbolsIndexed: 0, edgesIndexed: 0 };
  const session: IndexingSession = {
    reuseCleanIndex: () => result, startRun: unavailable, priorCompletedRun: unavailable,
    prepareExtraction: unavailable, audit: unavailable, publish: unavailable, failRun: unavailable,
    close: () => { closed++; }
  };
  const registry = new AdapterRegistry();
  registry.register({ id: 'test', version: '1', capabilities: [], supports: () => true, start: unavailable });
  const actual = await indexProjectInternal({ repoRoot: '/virtual' }, registry, {
    normalizeRoot: (root) => root, openSession: () => session,
    gitSnapshot: () => ({ commitSha: 'abc', branchName: 'main', isDirty: false }),
    commitHistory: unavailable, scanFiles: unavailable
  });
  assert.equal(actual, result);
  assert.equal(closed, 1);
});

test('remember completes model work before the atomic repository call and skips redacted embeddings', async () => {
  const order: string[] = [];
  const embedding = { model: 'stub', vector: Buffer.from([1]), dim: 1 };
  const ports: LocalMemoryPorts = {
    embeddingModel: () => 'stub', embedBatchForModel: unavailable,
    embed: async () => { order.push('embed'); return embedding; },
    repository: {
      recall: unavailable, recallSemantic: unavailable, reembedCandidates: unavailable, replaceFactEmbeddings: unavailable,
      remember: (_root, _input, value) => {
        order.push(value === null ? 'write without embedding' : 'write with embedding');
        if (value !== null) assert.equal(value, embedding);
        return { factId: 'fact', txId: 'tx' };
      }
    }
  };
  await rememberOnRepo('/virtual', { entity: 'file:a', attribute: 'decision', value: 'keep this' }, ports);
  await rememberOnRepo('/virtual', { entity: 'file:a', attribute: 'decision', value: `sk-${'a'.repeat(24)}` }, ports);
  assert.deepEqual(order, ['embed', 'write with embedding', 'write without embedding']);
});
