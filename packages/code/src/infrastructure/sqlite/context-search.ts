import type { SearchReader } from "../../application/context/search-ports.js";
import { rankGraphProximity, rankSemanticEntities, searchContextGraphSeedLimit, searchContextSemanticOverFetchFactor, searchContextSemanticOverFetchMin, searchContextStreamLimit } from "../../domain/context/search.js";
import type { SearchContextDisabledStream, SearchEntityRow, SearchEvidenceRow } from "../../domain/context/search.js";
import type { EmbeddingResult } from "../../domain/local-memory/embedding.js";
import { normalizeRepoRoot } from "../filesystem/security.js";
import { evidenceSpanColumnSelect, mcpHasTable, withReadOnlyDb } from "./context-resources.js";
import { assertCurrentSchema, getRepoId, hasVecTable, isVectorExtensionLoaded, latestCompletedIndexRun, openDatabase, vecTableName } from "./store.js";

function searchKeywordEntityRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  query: string,
  likeQuery: string
): SearchEntityRow[] {
  const ftsRows = searchFtsKeywordEntityRows(db, repoId, indexRunId, query, likeQuery);
  if (ftsRows.length > 0) return ftsRows;
  return searchLikeKeywordEntityRows(db, repoId, indexRunId, likeQuery);
}

function searchFtsKeywordEntityRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  query: string,
  likeQuery: string
): SearchEntityRow[] {
  if (!mcpHasTable(db, 'search_entities_fts')) return [];
  const ftsQuery = ftsMatchExpression(query);
  if (!ftsQuery) return [];
  try {
    return db
      .prepare(`
        SELECT
          entities.id AS entity_id,
          entities.kind AS entity_kind,
          entities.path AS entity_path,
          entities.symbol AS entity_symbol,
          entities.language_id AS entity_language_id,
          entities.display_name AS entity_display_name,
          NULL AS relation_kind_bucket,
          CASE WHEN entities.id LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END AS id_match,
          CASE WHEN entities.display_name LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END AS display_match,
          CASE WHEN COALESCE(entities.path, '') LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END AS path_match,
          CASE WHEN COALESCE(entities.symbol, '') LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END AS symbol_match,
          0 AS relation_match_count,
          0 AS evidence_match_count,
          0 AS fact_match_count
        FROM search_entities_fts fts
        INNER JOIN entities
          ON entities.id = fts.entity_id
         AND entities.repo_id = ?
         AND entities.updated_index_run_id = ?
        WHERE search_entities_fts MATCH ?
        ORDER BY bm25(search_entities_fts), entities.display_name, entities.id
        LIMIT ?
      `)
      .all(
        likeQuery,
        likeQuery,
        likeQuery,
        likeQuery,
        repoId,
        indexRunId,
        ftsQuery,
        searchContextStreamLimit
      ) as SearchEntityRow[];
  } catch {
    return [];
  }
}

function searchLikeKeywordEntityRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  likeQuery: string
): SearchEntityRow[] {
  return db
    .prepare(`
      SELECT
        entities.id AS entity_id,
        entities.kind AS entity_kind,
        entities.path AS entity_path,
        entities.symbol AS entity_symbol,
        entities.language_id AS entity_language_id,
        entities.display_name AS entity_display_name,
        NULL AS relation_kind_bucket,
        CASE WHEN entities.id LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END AS id_match,
        CASE WHEN entities.display_name LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END AS display_match,
        CASE WHEN COALESCE(entities.path, '') LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END AS path_match,
        CASE WHEN COALESCE(entities.symbol, '') LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END AS symbol_match,
        0 AS relation_match_count,
        0 AS evidence_match_count,
        0 AS fact_match_count
      FROM entities
      WHERE entities.repo_id = ?
        AND entities.updated_index_run_id = ?
        AND (
          entities.id LIKE ? ESCAPE '\\'
          OR entities.display_name LIKE ? ESCAPE '\\'
          OR COALESCE(entities.path, '') LIKE ? ESCAPE '\\'
          OR COALESCE(entities.symbol, '') LIKE ? ESCAPE '\\'
        )
      ORDER BY
        id_match DESC,
        path_match DESC,
        display_match DESC,
        symbol_match DESC,
        relation_match_count DESC,
        evidence_match_count DESC,
        CASE WHEN entities.kind = 'file' THEN 1 ELSE 0 END DESC,
        entities.display_name,
        entities.id
      LIMIT ?
    `)
    .all(
      likeQuery,
      likeQuery,
      likeQuery,
      likeQuery,
      repoId,
      indexRunId,
      likeQuery,
      likeQuery,
      likeQuery,
      likeQuery,
      searchContextStreamLimit
    ) as SearchEntityRow[];
}

function ftsMatchExpression(query: string): string | null {
  if (/[\\%_./:]/.test(query)) return null;
  const terms = query
    .toLocaleLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((term) => term.length > 0)
    .slice(0, 8);
  if (!terms || terms.length === 0) return null;
  return terms.map((term) => `${term}*`).join(' AND ');
}

function searchRelationEntityRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  likeQuery: string
): SearchEntityRow[] {
  return db
    .prepare(`
      SELECT
        entities.id AS entity_id,
        entities.kind AS entity_kind,
        entities.path AS entity_path,
        entities.symbol AS entity_symbol,
        entities.language_id AS entity_language_id,
        entities.display_name AS entity_display_name,
        min(relations.kind) AS relation_kind_bucket,
        0 AS id_match,
        0 AS display_match,
        0 AS path_match,
        0 AS symbol_match,
        count(relations.id) AS relation_match_count,
        0 AS evidence_match_count,
        0 AS fact_match_count
      FROM entities
      INNER JOIN relations
        ON relations.repo_id = entities.repo_id
       AND relations.index_run_id = entities.updated_index_run_id
       AND (relations.source_entity_id = entities.id OR relations.target_entity_id = entities.id)
       AND (relations.kind LIKE ? ESCAPE '\\' OR relations.provenance LIKE ? ESCAPE '\\')
      WHERE entities.repo_id = ?
        AND entities.updated_index_run_id = ?
      GROUP BY entities.id
      ORDER BY relation_match_count DESC, entities.display_name, entities.id
      LIMIT ?
    `)
    .all(likeQuery, likeQuery, repoId, indexRunId, searchContextStreamLimit) as SearchEntityRow[];
}

function searchEvidenceEntityRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  query: string,
  likeQuery: string,
  disabledStreams: ReadonlySet<SearchContextDisabledStream>
): SearchEntityRow[] {
  const ftsRows = disabledStreams.has('evidenceFts')
    ? []
    : searchEvidenceFtsEntityRows(db, repoId, indexRunId, query);
  if (ftsRows.length > 0) return ftsRows;
  return searchEvidenceLikeEntityRows(db, repoId, indexRunId, likeQuery);
}

function searchEvidenceFtsEntityRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  query: string
): SearchEntityRow[] {
  if (!mcpHasTable(db, 'search_relation_evidence_fts')) return [];
  const ftsQuery = ftsMatchExpression(query);
  if (!ftsQuery) return [];
  try {
    return db
      .prepare(`
        WITH matches AS (
          SELECT evidence_id
          FROM search_relation_evidence_fts
          WHERE search_relation_evidence_fts MATCH ?
        )
        SELECT
          entities.id AS entity_id,
          entities.kind AS entity_kind,
          entities.path AS entity_path,
          entities.symbol AS entity_symbol,
          entities.language_id AS entity_language_id,
          entities.display_name AS entity_display_name,
          min(relations.kind) AS relation_kind_bucket,
          0 AS id_match,
          0 AS display_match,
          0 AS path_match,
          0 AS symbol_match,
          0 AS relation_match_count,
          count(DISTINCT evidence.id) AS evidence_match_count,
          0 AS fact_match_count
        FROM matches
        INNER JOIN relation_evidence evidence
          ON evidence.id = matches.evidence_id
        INNER JOIN relations
          ON relations.id = evidence.relation_id
         AND relations.repo_id = evidence.repo_id
         AND relations.index_run_id = evidence.index_run_id
        INNER JOIN entities
          ON entities.repo_id = relations.repo_id
         AND entities.updated_index_run_id = relations.index_run_id
         AND (entities.id = relations.source_entity_id OR entities.id = relations.target_entity_id)
        WHERE evidence.repo_id = ?
          AND evidence.index_run_id = ?
        GROUP BY entities.id
        ORDER BY evidence_match_count DESC, entities.display_name, entities.id
        LIMIT ?
      `)
      .all(ftsQuery, repoId, indexRunId, searchContextStreamLimit) as SearchEntityRow[];
  } catch {
    return [];
  }
}

function searchEvidenceLikeEntityRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  likeQuery: string
): SearchEntityRow[] {
  return db
    .prepare(`
      SELECT
        entities.id AS entity_id,
        entities.kind AS entity_kind,
        entities.path AS entity_path,
        entities.symbol AS entity_symbol,
        entities.language_id AS entity_language_id,
        entities.display_name AS entity_display_name,
        min(relations.kind) AS relation_kind_bucket,
        0 AS id_match,
        0 AS display_match,
        0 AS path_match,
        0 AS symbol_match,
        0 AS relation_match_count,
        count(evidence.id) AS evidence_match_count,
        0 AS fact_match_count
      FROM entities
      INNER JOIN relations
        ON relations.repo_id = entities.repo_id
       AND relations.index_run_id = entities.updated_index_run_id
       AND (relations.source_entity_id = entities.id OR relations.target_entity_id = entities.id)
      INNER JOIN relation_evidence evidence
        ON evidence.relation_id = relations.id
       AND evidence.repo_id = relations.repo_id
       AND evidence.index_run_id = relations.index_run_id
       AND (
         evidence.file_path LIKE ? ESCAPE '\\'
         OR evidence.kind LIKE ? ESCAPE '\\'
         OR evidence.snippet LIKE ? ESCAPE '\\'
       )
      WHERE entities.repo_id = ?
        AND entities.updated_index_run_id = ?
      GROUP BY entities.id
      ORDER BY evidence_match_count DESC, entities.display_name, entities.id
      LIMIT ?
    `)
    .all(likeQuery, likeQuery, likeQuery, repoId, indexRunId, searchContextStreamLimit) as SearchEntityRow[];
}

function searchFactEntityRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  query: string,
  disabledStreams: ReadonlySet<SearchContextDisabledStream>
): SearchEntityRow[] {
  if (disabledStreams.has('factsFts')) return [];
  if (!mcpHasTable(db, 'search_facts_fts')) return [];
  const ftsQuery = ftsMatchExpression(query);
  if (!ftsQuery) return [];
  try {
    return db
      .prepare(`
        WITH matches AS (
          SELECT fact_id
          FROM search_facts_fts
          WHERE search_facts_fts MATCH ?
        )
        SELECT
          entities.id AS entity_id,
          entities.kind AS entity_kind,
          entities.path AS entity_path,
          entities.symbol AS entity_symbol,
          entities.language_id AS entity_language_id,
          entities.display_name AS entity_display_name,
          NULL AS relation_kind_bucket,
          0 AS id_match,
          0 AS display_match,
          0 AS path_match,
          0 AS symbol_match,
          0 AS relation_match_count,
          0 AS evidence_match_count,
          count(DISTINCT facts.id) AS fact_match_count
        FROM matches
        INNER JOIN facts
          ON facts.id = matches.fact_id
        INNER JOIN transactions
          ON transactions.id = facts.tx_id
        INNER JOIN entities
          ON entities.id = facts.entity_id
         AND entities.repo_id = ?
         AND entities.updated_index_run_id = ?
        WHERE facts.op = 'assert'
          AND facts.redacted = 0
          AND (
            (
              transactions.archived = 0
              AND transactions.branch_id = (SELECT id FROM branches WHERE name = 'main')
            )
            OR EXISTS (
              SELECT 1
              FROM fact_provenance visibility_fp
              INNER JOIN transactions visibility_tx
                ON visibility_tx.id = visibility_fp.tx_id
              WHERE visibility_fp.fact_id = facts.id
                AND visibility_fp.kind = 'supersedes'
                AND visibility_tx.archived = 0
                AND visibility_tx.branch_id = (SELECT id FROM branches WHERE name = 'main')
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM fact_provenance supersession_fp
            INNER JOIN facts superseding_fact
              ON superseding_fact.id = supersession_fp.fact_id
            INNER JOIN transactions supersession_tx
              ON supersession_tx.id = supersession_fp.tx_id
            WHERE supersession_fp.source_fact_id = facts.id
              AND supersession_fp.kind = 'supersedes'
              AND superseding_fact.op = 'assert'
              AND supersession_tx.archived = 0
              AND supersession_tx.branch_id = (SELECT id FROM branches WHERE name = 'main')
          )
        GROUP BY entities.id
        ORDER BY fact_match_count DESC, entities.display_name, entities.id
        LIMIT ?
      `)
      .all(ftsQuery, repoId, indexRunId, searchContextStreamLimit) as SearchEntityRow[];
  } catch {
    return [];
  }
}

function searchSemanticEntityRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  queryEmbedding: EmbeddingResult
): SearchEntityRow[] {
  const annRows = searchSemanticEntityRowsAnn(db, repoId, indexRunId, queryEmbedding);
  if (annRows !== null && annRows.length > 0) return annRows;
  return searchSemanticEntityRowsBruteForce(db, repoId, indexRunId, queryEmbedding);
}

function searchSemanticEntityRowsAnn(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  queryEmbedding: EmbeddingResult
): SearchEntityRow[] | null {
  if (!isVectorExtensionLoaded(db) || !hasVecTable(db, queryEmbedding.model)) return null;
  const tableName = vecTableName(queryEmbedding.model);
  const overFetch = Math.max(
    searchContextStreamLimit * searchContextSemanticOverFetchFactor,
    searchContextSemanticOverFetchMin
  );
  try {
    const rows = db
      .prepare(`
        WITH ranked AS (
          SELECT fact_id, distance
          FROM ${tableName}
          WHERE embedding MATCH vec_int8(?) AND k = ?
        )
        SELECT
          entities.id AS entity_id,
          entities.kind AS entity_kind,
          entities.path AS entity_path,
          entities.symbol AS entity_symbol,
          entities.language_id AS entity_language_id,
          entities.display_name AS entity_display_name,
          NULL AS relation_kind_bucket,
          min(ranked.distance) AS distance
        FROM ranked
        INNER JOIN facts
          ON facts.id = ranked.fact_id
        INNER JOIN transactions
          ON transactions.id = facts.tx_id
        INNER JOIN entities
          ON entities.id = facts.entity_id
         AND entities.repo_id = ?
         AND entities.updated_index_run_id = ?
        WHERE facts.op = 'assert'
          AND facts.redacted = 0
          AND (
            (
              transactions.archived = 0
              AND transactions.branch_id = (SELECT id FROM branches WHERE name = 'main')
            )
            OR EXISTS (
              SELECT 1
              FROM fact_provenance visibility_fp
              INNER JOIN transactions visibility_tx
                ON visibility_tx.id = visibility_fp.tx_id
              WHERE visibility_fp.fact_id = facts.id
                AND visibility_fp.kind = 'supersedes'
                AND visibility_tx.archived = 0
                AND visibility_tx.branch_id = (SELECT id FROM branches WHERE name = 'main')
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM fact_provenance supersession_fp
            INNER JOIN facts superseding_fact
              ON superseding_fact.id = supersession_fp.fact_id
            INNER JOIN transactions supersession_tx
              ON supersession_tx.id = supersession_fp.tx_id
            WHERE supersession_fp.source_fact_id = facts.id
              AND supersession_fp.kind = 'supersedes'
              AND superseding_fact.op = 'assert'
              AND supersession_tx.archived = 0
              AND supersession_tx.branch_id = (SELECT id FROM branches WHERE name = 'main')
          )
        GROUP BY entities.id
        ORDER BY distance ASC, entities.display_name, entities.id
        LIMIT ?
      `)
      .all(queryEmbedding.vector, overFetch, repoId, indexRunId, searchContextStreamLimit) as Array<
        SearchEntityRow & { distance: number }
      >;
    return rows.map((row) => ({
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
    }));
  } catch {
    return null;
  }
}

function searchSemanticEntityRowsBruteForce(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  queryEmbedding: EmbeddingResult
): SearchEntityRow[] {
  if (!mcpHasTable(db, 'fact_embeddings')) return [];
  const rows = db
    .prepare(`
      SELECT
        entities.id AS entity_id,
        entities.kind AS entity_kind,
        entities.path AS entity_path,
        entities.symbol AS entity_symbol,
        entities.language_id AS entity_language_id,
        entities.display_name AS entity_display_name,
        NULL AS relation_kind_bucket,
        fact_embeddings.vector AS vector
      FROM fact_embeddings
      INNER JOIN facts
        ON facts.id = fact_embeddings.fact_id
      INNER JOIN transactions
        ON transactions.id = facts.tx_id
      INNER JOIN entities
        ON entities.id = facts.entity_id
       AND entities.repo_id = ?
       AND entities.updated_index_run_id = ?
      WHERE fact_embeddings.model = ?
        AND fact_embeddings.dim = ?
        AND facts.op = 'assert'
        AND facts.redacted = 0
        AND (
          (
            transactions.archived = 0
            AND transactions.branch_id = (SELECT id FROM branches WHERE name = 'main')
          )
          OR EXISTS (
            SELECT 1
            FROM fact_provenance visibility_fp
            INNER JOIN transactions visibility_tx
              ON visibility_tx.id = visibility_fp.tx_id
            WHERE visibility_fp.fact_id = facts.id
              AND visibility_fp.kind = 'supersedes'
              AND visibility_tx.archived = 0
              AND visibility_tx.branch_id = (SELECT id FROM branches WHERE name = 'main')
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM fact_provenance supersession_fp
          INNER JOIN facts superseding_fact
            ON superseding_fact.id = supersession_fp.fact_id
          INNER JOIN transactions supersession_tx
            ON supersession_tx.id = supersession_fp.tx_id
          WHERE supersession_fp.source_fact_id = facts.id
            AND supersession_fp.kind = 'supersedes'
            AND superseding_fact.op = 'assert'
            AND supersession_tx.archived = 0
            AND supersession_tx.branch_id = (SELECT id FROM branches WHERE name = 'main')
        )
    `)
    .all(repoId, indexRunId, queryEmbedding.model, queryEmbedding.dim) as Array<
      SearchEntityRow & { vector: Buffer }
    >;

  return rankSemanticEntities(rows, queryEmbedding);
}

function searchGraphProximityEntityRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  seedRows: SearchEntityRow[],
  k: number
): SearchEntityRow[] {
  const seedIds = [...new Set(seedRows.map((row) => row.entity_id))].slice(0, searchContextGraphSeedLimit);
  if (seedIds.length === 0) return [];

  const neighborRows = db
    .prepare(`
      SELECT
        relations.source_entity_id AS source_id,
        relations.target_entity_id AS target_id,
        neighbor.id AS entity_id,
        neighbor.kind AS entity_kind,
        neighbor.path AS entity_path,
        neighbor.symbol AS entity_symbol,
        neighbor.language_id AS entity_language_id,
        neighbor.display_name AS entity_display_name,
        min(relations.kind) AS relation_kind_bucket,
        count(relations.id) AS relation_match_count,
        0 AS evidence_match_count,
        0 AS fact_match_count
      FROM relations
      INNER JOIN entities seed
        ON seed.repo_id = relations.repo_id
       AND seed.updated_index_run_id = relations.index_run_id
       AND (seed.id = relations.source_entity_id OR seed.id = relations.target_entity_id)
      INNER JOIN entities neighbor
        ON neighbor.repo_id = relations.repo_id
       AND neighbor.updated_index_run_id = relations.index_run_id
       AND neighbor.id = CASE
         WHEN seed.id = relations.source_entity_id THEN relations.target_entity_id
         ELSE relations.source_entity_id
       END
      WHERE relations.repo_id = ?
        AND relations.index_run_id = ?
        AND seed.id = ?
        AND neighbor.id <> seed.id
      GROUP BY neighbor.id
      ORDER BY relation_match_count DESC, neighbor.display_name, neighbor.id
      LIMIT ?
    `);

  return rankGraphProximity(seedRows, k, (seedId, limit) => neighborRows.all(repoId, indexRunId, seedId, limit) as SearchEntityRow[]);
}

function searchEvidenceRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  entityId: string,
  likeQuery: string,
  limit: number
): SearchEvidenceRow[] {
  if (limit <= 0) return [];
  const spanColumns = evidenceSpanColumnSelect(db, 'evidence');
  return db
    .prepare(`
      SELECT
        evidence.id AS evidence_id,
        evidence.relation_id AS relation_id,
        evidence.file_path AS evidence_file_path,
        evidence.kind AS evidence_kind,
        evidence.snippet AS evidence_snippet,
        evidence.confidence AS evidence_confidence,
        ${spanColumns},
        CASE
          WHEN evidence.file_path LIKE ? ESCAPE '\\'
            OR evidence.kind LIKE ? ESCAPE '\\'
            OR evidence.snippet LIKE ? ESCAPE '\\'
          THEN 1 ELSE 0
        END AS query_match
      FROM relation_evidence evidence
      INNER JOIN relations
        ON relations.id = evidence.relation_id
       AND relations.repo_id = evidence.repo_id
       AND relations.index_run_id = evidence.index_run_id
      WHERE evidence.repo_id = ?
        AND evidence.index_run_id = ?
        AND (relations.source_entity_id = ? OR relations.target_entity_id = ?)
      ORDER BY query_match DESC, evidence.file_path, evidence.kind, evidence.id
      LIMIT ?
    `)
    .all(likeQuery, likeQuery, likeQuery, repoId, indexRunId, entityId, entityId, limit) as SearchEvidenceRow[];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
export type { SearchContextForRepoOptions } from "../../domain/context/search.js";

export function hasSearchEmbeddings(root: string, model: string): boolean {
  const context = { repoRoot: root };
  return withReadOnlyDb(context, (db, repoId) => {
    assertCurrentSchema(db, 'parallax_search_context');
    if (!mcpHasTable(db, 'fact_embeddings')) return false;
    const row = db
      .prepare(`
        SELECT 1 AS one
        FROM fact_embeddings fe
        INNER JOIN facts f ON f.id = fe.fact_id
        INNER JOIN transactions t ON t.id = f.tx_id
        INNER JOIN entities e ON e.id = f.entity_id
        WHERE fe.model = ?
          AND (
            (
              t.archived = 0
              AND t.branch_id = (SELECT id FROM branches WHERE name = 'main')
            )
            OR EXISTS (
              SELECT 1
              FROM fact_provenance visibility_fp
              INNER JOIN transactions visibility_tx
                ON visibility_tx.id = visibility_fp.tx_id
              WHERE visibility_fp.fact_id = f.id
                AND visibility_fp.kind = 'supersedes'
                AND visibility_tx.archived = 0
                AND visibility_tx.branch_id = (SELECT id FROM branches WHERE name = 'main')
            )
          )
          AND f.op = 'assert'
          AND f.redacted = 0
          AND e.repo_id = ?
        LIMIT 1
      `)
      .get(model, repoId) as { one: number } | undefined;
    return row !== undefined;
  });
}

export function openSearchSession(root: string): SearchReader {
  const repoRoot = normalizeRepoRoot(root);
  const db = openDatabase(repoRoot, { readOnly: true });
  try {
    const repoId = getRepoId(db, repoRoot);
    assertCurrentSchema(db, 'parallax_search_context');
    const indexRunId = latestCompletedIndexRun(db, repoId);
    const like = (query: string) => `%${escapeLike(query)}%`;
    return {
      indexRunId,
      keyword: (query) => searchKeywordEntityRows(db, repoId, indexRunId, query, like(query)),
      relations: (query) => searchRelationEntityRows(db, repoId, indexRunId, like(query)),
      evidence: (query, disabled) => searchEvidenceEntityRows(db, repoId, indexRunId, query, like(query), disabled),
      facts: (query, disabled) => searchFactEntityRows(db, repoId, indexRunId, query, disabled),
      semantic: (embedding) => searchSemanticEntityRows(db, repoId, indexRunId, embedding),
      graphProximity: (seeds, k) => searchGraphProximityEntityRows(db, repoId, indexRunId, seeds, k),
      entityEvidence: (entityId, query, limit) => searchEvidenceRows(db, repoId, indexRunId, entityId, like(query), limit),
      close: () => db.close()
    };
  } catch (error) {
    db.close();
    throw error;
  }
}