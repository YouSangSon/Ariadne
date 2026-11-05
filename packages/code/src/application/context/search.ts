import { entityResourceUri, numericCompare } from "../../domain/context/context-pack.js";
import { compactEvidenceResource } from "../../domain/context/evidence.js";
import type { CompactEvidenceResource } from "../../domain/context/evidence.js";
import { applySearchContextBudget, diversifyRankedRows, entityFromSearchRow, mergeSearchStream, searchContextEvidencePerEntity, searchContextSnippetChars, searchEntityReasons, searchRankSignals, searchRawRrfScore } from "../../domain/context/search.js";
import type { SearchCandidate, SearchContextDisabledStream, SearchContextForRepoOptions, SearchContextOptions, SearchRanking } from "../../domain/context/search.js";
import type { EmbeddingResult } from "../../domain/local-memory/embedding.js";
import type { McpContext } from "./request.js";
import type { ContextSearchPorts, SearchReader } from "./search-ports.js";

export async function searchContextSemanticEmbedding(context: McpContext, query: string, ports: ContextSearchPorts): Promise<EmbeddingResult | null> {
  const model = ports.embeddingModel();
  const hasEmbeddings = ports.hasEmbeddings(context.repoRoot, model);

  if (!hasEmbeddings) return null;
  try {
    return await ports.embed(query);
  } catch {
    return null;
  }
}

export async function searchContextForRepo(options: SearchContextForRepoOptions, ports: ContextSearchPorts): Promise<unknown> {
  const context = { repoRoot: ports.normalizeRoot(options.repoRoot) };
  const semanticEmbedding = await searchContextSemanticEmbedding(context, options.query, ports);
  return searchContext(context, {
    query: options.query,
    k: options.k ?? 10,
    includeEvidence: options.includeEvidence ?? true,
    budget: options.budget ?? null,
    disabledStreams: new Set(options.disabledStreams ?? []),
    semanticEmbedding
  }, ports);
}

export function searchContext(context: McpContext, options: SearchContextOptions, ports: ContextSearchPorts): unknown {
  const query = options.query.trim();
  if (!query) throw new Error('search query must not be empty');

  const reader = ports.openSession(context.repoRoot);
  try {
    const indexRunId = reader.indexRunId;
    const ranking = searchRankedEntities(
      reader,
      query,
      options.k,
      options.semanticEmbedding,
      options.disabledStreams
    );
    const selected = diversifyRankedRows(ranking.rankedRows, options.k).slice(0, options.k);
    const evidenceByEntity = new Map<string, CompactEvidenceResource[]>();
    const evidenceUris: string[] = [];

    if (options.includeEvidence) {
      for (const item of selected) {
        const evidenceRows = reader.entityEvidence(item.row.entity_id, query, searchContextEvidencePerEntity);
        const evidence = evidenceRows.map((row) => compactEvidenceResource(row, searchContextSnippetChars));
        evidenceByEntity.set(item.row.entity_id, evidence);
        evidenceUris.push(...evidence.map((row) => row.resourceUri));
      }
    }

    const unbudgetedResults = selected.map((item) => {
      const entity = entityFromSearchRow(item.row);
      return {
        entity,
        score: item.score,
        reasons: item.reasons,
        rankSignals: item.rankSignals,
        resourceUri: entityResourceUri(entity),
        evidence: evidenceByEntity.get(item.row.entity_id) ?? []
      };
    });
    const budgeted = applySearchContextBudget({
      query,
      indexRunId,
      results: unbudgetedResults,
      budget: options.budget,
      k: options.k,
      includeEvidence: options.includeEvidence,
      ranking,
      evidenceUris
    });

    return budgeted;
  } finally {
    reader.close();
  }
}

export function searchRankedEntities(
  reader: SearchReader,
  query: string,
  k: number,
  semanticEmbedding: EmbeddingResult | null,
  disabledStreams: ReadonlySet<SearchContextDisabledStream>
): SearchRanking {
  const keywordRows = reader.keyword(query);
  const relationRows = reader.relations(query);
  const evidenceRows = reader.evidence(query, disabledStreams);
  const factRows = reader.facts(query, disabledStreams);
  const contextEvidenceRows = [...evidenceRows, ...factRows];
  const semanticRows = semanticEmbedding
    ? reader.semantic(semanticEmbedding)
    : [];
  const graphRows = reader.graphProximity(
    [...keywordRows, ...relationRows, ...contextEvidenceRows, ...semanticRows],
    k
  );
  const candidates = new Map<string, SearchCandidate>();

  mergeSearchStream(candidates, keywordRows, 'keywordRank');
  mergeSearchStream(candidates, relationRows, 'relationRank');
  mergeSearchStream(candidates, contextEvidenceRows, 'evidenceRank');
  mergeSearchStream(candidates, semanticRows, 'semanticRank');
  mergeSearchStream(candidates, graphRows, 'graphProximityRank');

  const rankedRows = [...candidates.values()]
    .map((candidate) => {
      const rawScore = searchRawRrfScore(candidate);
      const rankSignals = searchRankSignals(candidate, rawScore);
      return {
        row: candidate.row,
        score: rankSignals.rrfScore,
        rawScore,
        reasons: searchEntityReasons(candidate),
        rankSignals
      };
    })
    .sort((left, right) =>
      numericCompare(right.rawScore, left.rawScore)
      || left.row.entity_display_name.localeCompare(right.row.entity_display_name)
      || left.row.entity_id.localeCompare(right.row.entity_id)
    );

  return {
    rankedRows,
    matchedEntitiesLowerBound: candidates.size,
    truncated: candidates.size > k
  };
}
