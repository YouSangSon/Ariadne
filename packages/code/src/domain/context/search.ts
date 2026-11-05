import type { EmbeddingResult } from "../local-memory/embedding.js";
import type { ContextBudget, EntityRef } from "../model.js";
import { numericCompare } from "./context-pack.js";
import { byteLength } from "./evidence.js";
import type { CompactEvidenceResource, ExplainEvidenceRow } from "./evidence.js";

export type SearchContextOptions = {
  query: string;
  k: number;
  includeEvidence: boolean;
  budget: ContextBudget | null;
  disabledStreams: ReadonlySet<SearchContextDisabledStream>;
  semanticEmbedding: EmbeddingResult | null;
};

export type SearchContextDisabledStream = 'evidenceFts' | 'factsFts';

export type SearchContextForRepoOptions = {
  repoRoot: string;
  query: string;
  k?: number;
  includeEvidence?: boolean;
  budget?: ContextBudget | null;
  disabledStreams?: SearchContextDisabledStream[];
};

export type SearchEntityRow = {
  entity_id: string;
  entity_kind: string;
  entity_path: string | null;
  entity_symbol: string | null;
  entity_language_id: string | null;
  entity_display_name: string;
  relation_kind_bucket: string | null;
  id_match: number;
  display_match: number;
  path_match: number;
  symbol_match: number;
  relation_match_count: number;
  evidence_match_count: number;
  fact_match_count: number;
};

export type SearchEvidenceRow = ExplainEvidenceRow & {
  query_match: number;
};

export type SearchRankSignals = {
  algorithm: 'rrf';
  keywordRank: number | null;
  relationRank: number | null;
  evidenceRank: number | null;
  semanticRank: number | null;
  graphProximityRank: number | null;
  rrfScore: number;
};

export type RankedSearchEntity = {
  row: SearchEntityRow;
  score: number;
  rawScore: number;
  reasons: string[];
  rankSignals: SearchRankSignals;
};

export type SearchRanking = {
  rankedRows: RankedSearchEntity[];
  matchedEntitiesLowerBound: number;
  truncated: boolean;
};

export type SearchCandidate = {
  row: SearchEntityRow;
  keywordRank: number | null;
  relationRank: number | null;
  evidenceRank: number | null;
  semanticRank: number | null;
  graphProximityRank: number | null;
};

export const searchContextEvidencePerEntity = 2;

export const searchContextSnippetChars = 240;

export const searchContextRrfK = 60;

export const searchContextStreamLimit = 500;

export const searchContextGraphSeedLimit = 25;

export const searchContextSemanticOverFetchFactor = 5;

export const searchContextSemanticOverFetchMin = 100;

export type SearchContextBudgetPreset = {
  returnedBytesLimit: number;
  estimatedTokensLimit: number;
};

export const searchContextBudgetPresets: Record<ContextBudget, SearchContextBudgetPreset> = {
  brief: { returnedBytesLimit: 5_000, estimatedTokensLimit: 1_250 },
  standard: { returnedBytesLimit: 12_000, estimatedTokensLimit: 3_000 },
  deep: { returnedBytesLimit: 30_000, estimatedTokensLimit: 7_500 }
};

export function applySearchContextBudget(input: {
  query: string;
  indexRunId: number;
  results: Array<{
    entity: EntityRef;
    score: number;
    reasons: string[];
    rankSignals: SearchRankSignals;
    resourceUri: string;
    evidence: CompactEvidenceResource[];
  }>;
  budget: ContextBudget | null;
  k: number;
  includeEvidence: boolean;
  ranking: SearchRanking;
  evidenceUris: string[];
}): unknown {
  const preset = input.budget ? searchContextBudgetPresets[input.budget] : null;
  let results = input.results;
  let evidenceUris = input.evidenceUris;
  let omittedEntities = Math.max(input.ranking.matchedEntitiesLowerBound - results.length, 0);
  let omittedEvidence = 0;

  const build = (currentResults: typeof results, currentEvidenceUris: string[]) => ({
    query: input.query,
    indexRunId: input.indexRunId,
    results: currentResults,
    resources: {
      entities: currentResults.map((item) => item.resourceUri).sort(),
      evidence: [...new Set(currentEvidenceUris)].sort()
    },
    limits: {
      k: input.k,
      includeEvidence: input.includeEvidence,
      evidencePerEntity: searchContextEvidencePerEntity,
      snippetChars: searchContextSnippetChars,
      truncated: input.ranking.truncated || omittedEntities > 0,
      budget: input.budget,
      returnedBytes: 0,
      returnedBytesLimit: preset?.returnedBytesLimit ?? null,
      estimatedTokens: 0,
      estimatedTokensLimit: preset?.estimatedTokensLimit ?? null,
      budgetExceeded: false
    },
    counts: {
      returnedEntities: currentResults.length,
      matchedEntitiesLowerBound: input.ranking.matchedEntitiesLowerBound,
      evidence: new Set(currentEvidenceUris).size
    },
    omittedCounts: {
      entities: omittedEntities,
      evidence: omittedEvidence
    }
  });

  if (preset) {
    let current = build(results, evidenceUris);
    stabilizeSearchContextSize(current);
    let returnedBytes = current.limits.returnedBytes;
    while (returnedBytes > preset.returnedBytesLimit && results.some((item) => item.evidence.length > 0)) {
      for (let index = results.length - 1; index >= 0; index -= 1) {
        const item = results[index]!;
        if (item.evidence.length === 0) continue;
        omittedEvidence += item.evidence.length;
        results = results.map((result, resultIndex) =>
          resultIndex === index ? { ...result, evidence: [] } : result
        );
        break;
      }
      const keptEvidenceIds = new Set(results.flatMap((item) => item.evidence.map((evidence) => evidence.resourceUri)));
      evidenceUris = evidenceUris.filter((uri) => keptEvidenceIds.has(uri));
      current = build(results, evidenceUris);
      stabilizeSearchContextSize(current);
      returnedBytes = current.limits.returnedBytes;
    }
    while (returnedBytes > preset.returnedBytesLimit && results.length > 1) {
      const removed = results[results.length - 1]!;
      omittedEntities += 1;
      omittedEvidence += removed.evidence.length;
      results = results.slice(0, -1);
      const keptEvidenceIds = new Set(results.flatMap((item) => item.evidence.map((evidence) => evidence.resourceUri)));
      evidenceUris = evidenceUris.filter((uri) => keptEvidenceIds.has(uri));
      current = build(results, evidenceUris);
      stabilizeSearchContextSize(current);
      returnedBytes = current.limits.returnedBytes;
    }
  }

  const finalResult = build(results, evidenceUris);
  finalizeSearchContextSize(finalResult, preset);
  return finalResult;
}

export function stabilizeSearchContextSize(result: { limits: { returnedBytes: number; estimatedTokens: number } }): void {
  for (let index = 0; index < 8; index += 1) {
    const returnedBytes = byteLength(JSON.stringify(result));
    const estimatedTokens = Math.ceil(returnedBytes / 4);
    if (result.limits.returnedBytes === returnedBytes && result.limits.estimatedTokens === estimatedTokens) {
      return;
    }
    result.limits.returnedBytes = returnedBytes;
    result.limits.estimatedTokens = estimatedTokens;
  }
}

export function finalizeSearchContextSize(
  result: { limits: { returnedBytes: number; returnedBytesLimit: number | null; estimatedTokens: number; budgetExceeded: boolean } },
  preset: { returnedBytesLimit: number } | null
): void {
  stabilizeSearchContextSize(result);
  if (!preset) return;

  const withinBudgetRepresentationFits = result.limits.returnedBytes <= preset.returnedBytesLimit;
  if (withinBudgetRepresentationFits) return;

  result.limits.budgetExceeded = true;
  stabilizeSearchContextSize(result);
}

export function diversifyRankedRows(rows: RankedSearchEntity[], k: number): RankedSearchEntity[] {
  if (k < 3 || rows.length <= 1) return rows;
  const buckets = new Map<string, RankedSearchEntity[]>();
  for (const row of rows) {
    const key = searchDiversityBucket(row.row);
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  if (buckets.size <= 1) return rows;

  const diversified: RankedSearchEntity[] = [];
  const queues = [...buckets.values()];
  while (diversified.length < rows.length) {
    let moved = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (!next) continue;
      diversified.push(next);
      moved = true;
    }
    if (!moved) break;
  }
  return diversified;
}

export function searchDiversityBucket(row: SearchEntityRow): string {
  return [
    pathPrefixBucket(row.entity_path),
    row.entity_kind,
    row.relation_kind_bucket ?? 'no-relation'
  ].join('|');
}

export function pathPrefixBucket(filePath: string | null): string {
  if (!filePath) return '[no-path]';
  return filePath.split('/')[0] || filePath;
}

export function mergeSearchStream(
  candidates: Map<string, SearchCandidate>,
  rows: SearchEntityRow[],
  rankField: 'keywordRank' | 'relationRank' | 'evidenceRank' | 'semanticRank' | 'graphProximityRank'
): void {
  rows.forEach((row, index) => {
    const existing = candidates.get(row.entity_id);
    const candidate = existing ?? {
      row: { ...row },
      keywordRank: null,
      relationRank: null,
      evidenceRank: null,
      semanticRank: null,
      graphProximityRank: null
    };
    candidate.row.id_match = Math.max(candidate.row.id_match, row.id_match);
    candidate.row.display_match = Math.max(candidate.row.display_match, row.display_match);
    candidate.row.path_match = Math.max(candidate.row.path_match, row.path_match);
    candidate.row.symbol_match = Math.max(candidate.row.symbol_match, row.symbol_match);
    candidate.row.relation_match_count = Math.max(candidate.row.relation_match_count, row.relation_match_count);
    candidate.row.evidence_match_count = Math.max(candidate.row.evidence_match_count, row.evidence_match_count);
    candidate.row.fact_match_count = Math.max(candidate.row.fact_match_count, row.fact_match_count);
    candidate.row.relation_kind_bucket = candidate.row.relation_kind_bucket ?? row.relation_kind_bucket;
    candidate[rankField] = candidate[rankField] === null ? index + 1 : Math.min(candidate[rankField], index + 1);
    candidates.set(row.entity_id, candidate);
  });
}

export function searchRawRrfScore(candidate: SearchCandidate): number {
  return reciprocalRank(candidate.keywordRank)
    + reciprocalRank(candidate.relationRank)
    + reciprocalRank(candidate.evidenceRank)
    + reciprocalRank(candidate.semanticRank)
    + reciprocalRank(candidate.graphProximityRank);
}

export function searchRankSignals(candidate: SearchCandidate, rawScore: number): SearchRankSignals {
  return {
    algorithm: 'rrf',
    keywordRank: candidate.keywordRank,
    relationRank: candidate.relationRank,
    evidenceRank: candidate.evidenceRank,
    semanticRank: candidate.semanticRank,
    graphProximityRank: candidate.graphProximityRank,
    rrfScore: Number(rawScore.toFixed(8))
  };
}

export function reciprocalRank(rank: number | null): number {
  return rank === null ? 0 : 1 / (searchContextRrfK + rank);
}

export function int8Vector(value: Buffer): Int8Array {
  return new Int8Array(value.buffer, value.byteOffset, value.byteLength);
}

export function int8DotScore(left: Int8Array, right: Int8Array): number {
  const len = Math.min(left.length, right.length);
  let total = 0;
  for (let index = 0; index < len; index += 1) {
    total += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return total;
}

export function searchEntityReasons(candidate: SearchCandidate): string[] {
  const row = candidate.row;
  const reasons: string[] = [];
  if (candidate.keywordRank !== null) reasons.push('keyword');
  if (row.id_match > 0) reasons.push('entity-id');
  if (row.path_match > 0) reasons.push('path');
  if (row.display_match > 0) reasons.push('display-name');
  if (row.symbol_match > 0) reasons.push('symbol');
  if (row.relation_match_count > 0) reasons.push(`relations:${row.relation_match_count}`);
  if (row.evidence_match_count > 0) reasons.push(`evidence:${row.evidence_match_count}`);
  if (row.fact_match_count > 0) reasons.push(`facts:${row.fact_match_count}`);
  if (candidate.semanticRank !== null) reasons.push('semantic');
  if (candidate.graphProximityRank !== null) reasons.push('graph-proximity');
  return reasons;
}

export function entityFromSearchRow(row: SearchEntityRow): EntityRef {
  return {
    id: row.entity_id,
    kind: row.entity_kind as EntityRef['kind'],
    ...(row.entity_path !== null ? { path: row.entity_path } : {}),
    ...(row.entity_symbol !== null ? { symbol: row.entity_symbol } : {}),
    ...(row.entity_language_id !== null ? { languageId: row.entity_language_id } : {}),
    displayName: row.entity_display_name
  };
}
export function rankSemanticEntities(rows: Array<SearchEntityRow & { vector: Buffer }>, queryEmbedding: EmbeddingResult): SearchEntityRow[] {
  const queryVector = int8Vector(queryEmbedding.vector);
  const bestByEntity = new Map<string, { row: SearchEntityRow; score: number }>();
  for (const row of rows) {
    const score = int8DotScore(queryVector, int8Vector(row.vector));
    const existing = bestByEntity.get(row.entity_id);
    if (!existing || score > existing.score) {
      bestByEntity.set(row.entity_id, {
        row: {
          entity_id: row.entity_id,
          entity_kind: row.entity_kind,
          entity_path: row.entity_path,
          entity_symbol: row.entity_symbol,
          entity_language_id: row.entity_language_id,
          entity_display_name: row.entity_display_name,
          relation_kind_bucket: null,
          id_match: 0,
          display_match: 0,
          path_match: 0,
          symbol_match: 0,
          relation_match_count: 0,
          evidence_match_count: 0,
          fact_match_count: 0
        },
        score
      });
    }
  }

  return [...bestByEntity.values()]
    .sort((left, right) =>
      numericCompare(right.score, left.score)
      || left.row.entity_display_name.localeCompare(right.row.entity_display_name)
      || left.row.entity_id.localeCompare(right.row.entity_id)
    )
    .slice(0, searchContextStreamLimit)
    .map((entry) => entry.row);
}

export function rankGraphProximity(seedRows: SearchEntityRow[], k: number, neighbors: (seedId: string, limit: number) => SearchEntityRow[]): SearchEntityRow[] {
  const seedIds = [...new Set(seedRows.map((row) => row.entity_id))].slice(0, searchContextGraphSeedLimit);
  if (seedIds.length === 0) return [];
  const best = new Map<string, { row: SearchEntityRow; seedRank: number; relationCount: number }>();
  seedIds.forEach((seedId, index) => {
    const rows = neighbors(seedId, Math.max(k * 3, 10));
    for (const row of rows) {
      if (seedIds.includes(row.entity_id)) continue;
      const existing = best.get(row.entity_id);
      const relationCount = row.relation_match_count;
      if (
        !existing
        || index < existing.seedRank
        || (index === existing.seedRank && relationCount > existing.relationCount)
      ) {
        best.set(row.entity_id, {
          row: {
            ...row,
            id_match: 0,
            display_match: 0,
            path_match: 0,
            symbol_match: 0,
            evidence_match_count: 0,
            fact_match_count: 0
          },
          seedRank: index,
          relationCount
        });
      }
    }
  });

  return [...best.values()]
    .sort((left, right) =>
      numericCompare(left.seedRank, right.seedRank)
      || numericCompare(right.relationCount, left.relationCount)
      || left.row.entity_display_name.localeCompare(right.row.entity_display_name)
      || left.row.entity_id.localeCompare(right.row.entity_id)
    )
    .slice(0, searchContextStreamLimit)
    .map((entry) => entry.row);
}
