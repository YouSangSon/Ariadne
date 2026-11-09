import { typedMcpError } from "../../application/context/errors.js";
import type { McpContext } from "../../application/context/request.js";
import type { EvidenceResourceRow, ExplainEntityRow, ExplainRelationRow } from "../../application/context/resource-model.js";
import type { EntityExplanationSession } from "../../application/context/resource-ports.js";
import { entityFromEvidenceRow } from "../../application/context/resource-projection.js";
import { contextPackResourceUri, evidenceResourceUri } from "../../domain/context/context-pack.js";
import type { ExplainEvidenceRow } from "../../domain/context/evidence.js";
import { asConfidence } from "../../domain/impact/confidence.js";
import { redactSecrets } from "../../domain/security/redaction.js";
import { evidenceSpanColumnSelect, mcpHasTable, withReadOnlyDb } from "./context-resources.js";
import { getRepoId, latestCompletedIndexRun, openDatabase } from "./store.js";

export { workspaceResources } from '../../domain/workspace/resources.js';

export function listReportResources(context: McpContext): Array<{ uri: string; name: string; mimeType: string }> {
  return withReadOnlyDb(context, (db, repoId) => {
    const rows = db
      .prepare('SELECT id FROM reports WHERE repo_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(repoId) as Array<{ id: string }>;
    return rows.map((row) => ({
      uri: `parallax://reports/${row.id}`,
      name: `Impact report ${row.id}`,
      mimeType: 'application/json'
    }));
  });
}

export function listEntityResources(context: McpContext): Array<{ uri: string; name: string; mimeType: string }> {
  return withReadOnlyDb(context, (db, repoId) => {
    const indexRunId = latestCompletedIndexRun(db, repoId);
    const rows = db
      .prepare(`
        SELECT id, display_name
        FROM entities
        WHERE repo_id = ? AND updated_index_run_id = ?
        ORDER BY display_name
        LIMIT 50
      `)
      .all(repoId, indexRunId) as Array<{ id: string; display_name: string }>;
    return rows.map((row) => ({
      uri: `parallax://entities/${encodeURIComponent(row.id)}`,
      name: row.display_name,
      mimeType: 'application/json'
    }));
  });
}

export function listEvidenceResources(context: McpContext): Array<{ uri: string; name: string; mimeType: string }> {
  return withReadOnlyDb(context, (db, repoId) => {
    const indexRunId = latestCompletedIndexRun(db, repoId);
    const rows = db
      .prepare(`
        SELECT id, file_path, kind
        FROM relation_evidence
        WHERE repo_id = ? AND index_run_id = ?
        ORDER BY file_path, kind, id
        LIMIT 50
      `)
      .all(repoId, indexRunId) as Array<{ id: string; file_path: string; kind: string }>;
    return rows.map((row) => ({
      uri: evidenceResourceUri(row.id),
      name: `${row.kind} evidence in ${row.file_path}`,
      mimeType: 'application/json'
    }));
  });
}

export function listContextPackResources(context: McpContext): Array<{ uri: string; name: string; mimeType: string }> {
  return withReadOnlyDb(context, (db, repoId) => {
    if (!mcpHasTable(db, 'context_packs')) return [];
    const rows = db
      .prepare(`
        SELECT id, budget, index_run_id
        FROM context_packs
        WHERE repo_id = ?
        ORDER BY last_accessed_at DESC, created_at DESC
        LIMIT 50
      `)
      .all(repoId) as Array<{ id: string; budget: string; index_run_id: number }>;
    return rows.map((row) => ({
      uri: contextPackResourceUri(row.id),
      name: `${row.budget} context pack for index run ${row.index_run_id}`,
      mimeType: 'application/json'
    }));
  });
}

export function listGraphResources(context: McpContext): Array<{ uri: string; name: string; mimeType: string }> {
  return withReadOnlyDb(context, (db, repoId) => {
    const rows = db
      .prepare('SELECT id FROM reports WHERE repo_id = ? ORDER BY created_at DESC LIMIT 10')
      .all(repoId) as Array<{ id: string }>;
    return rows.flatMap((row) => (['mermaid', 'json', 'dot'] as const).map((format) => ({
      uri: `parallax://reports/${row.id}/graph/${format}`,
      name: `Impact report ${row.id} graph (${format})`,
      mimeType: format === 'json' ? 'application/json' : 'text/plain'
    })));
  });
}

export function readReport(context: McpContext, reportId: string): unknown {
  return withReadOnlyDb(context, (db, repoId) => {
    const row = db.prepare('SELECT json FROM reports WHERE repo_id = ? AND id = ?').get(repoId, reportId) as { json: string } | undefined;
    if (!row) throw typedMcpError(new Error(`impact report not found: ${reportId}`), 'resource_not_found');
    return JSON.parse(row.json) as unknown;
  });
}

export function readContextPack(context: McpContext, contextPackId: string): unknown {
  return withReadOnlyDb(context, (db, repoId) => {
    if (!mcpHasTable(db, 'context_packs')) {
      throw typedMcpError(new Error(`impact context pack not found: ${contextPackId}`), 'resource_not_found');
    }
    const row = db
      .prepare('SELECT pack_json FROM context_packs WHERE repo_id = ? AND id = ?')
      .get(repoId, contextPackId) as { pack_json: string } | undefined;
    if (!row) {
      throw typedMcpError(new Error(`impact context pack not found: ${contextPackId}`), 'resource_not_found');
    }
    return JSON.parse(row.pack_json) as unknown;
  });
}

export function readEntity(context: McpContext, entityId: string): unknown {
  return withReadOnlyDb(context, (db, repoId) => {
    const indexRunId = latestCompletedIndexRun(db, repoId);
    const relationLimit = 100;
    const entity = db
      .prepare('SELECT * FROM entities WHERE repo_id = ? AND id = ? AND updated_index_run_id = ?')
      .get(repoId, entityId, indexRunId) as Record<string, unknown> | undefined;
    if (!entity) throw typedMcpError(new Error(`impact entity not found: ${entityId}`), 'resource_not_found');
    const outgoing = db
      .prepare('SELECT id, target_entity_id, kind, confidence, provenance FROM relations WHERE repo_id = ? AND source_entity_id = ? AND index_run_id = ? ORDER BY kind, target_entity_id LIMIT ?')
      .all(repoId, entityId, indexRunId, relationLimit + 1);
    const incoming = db
      .prepare('SELECT id, source_entity_id, kind, confidence, provenance FROM relations WHERE repo_id = ? AND target_entity_id = ? AND index_run_id = ? ORDER BY kind, source_entity_id LIMIT ?')
      .all(repoId, entityId, indexRunId, relationLimit + 1);
    return {
      entity,
      indexRunId,
      outgoing: outgoing.slice(0, relationLimit),
      incoming: incoming.slice(0, relationLimit),
      limits: {
        relations: relationLimit,
        outgoingTruncated: outgoing.length > relationLimit,
        incomingTruncated: incoming.length > relationLimit
      }
    };
  });
}

function relationCount(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  column: 'source_entity_id' | 'target_entity_id',
  entityId: string
): number {
  const row = db
    .prepare(`SELECT count(*) AS count FROM relations WHERE repo_id = ? AND index_run_id = ? AND ${column} = ?`)
    .get(repoId, indexRunId, entityId) as { count: number };
  return row.count;
}

function explainRelationRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  column: 'source_entity_id' | 'target_entity_id',
  entityId: string,
  limit: number
): ExplainRelationRow[] {
  return db
    .prepare(`
      SELECT
        relations.id AS relation_id,
        relations.kind AS relation_kind,
        relations.confidence AS relation_confidence,
        relations.provenance AS relation_provenance,
        source.id AS source_id,
        source.kind AS source_kind,
        source.path AS source_path,
        source.symbol AS source_symbol,
        source.language_id AS source_language_id,
        source.display_name AS source_display_name,
        target.id AS target_id,
        target.kind AS target_kind,
        target.path AS target_path,
        target.symbol AS target_symbol,
        target.language_id AS target_language_id,
        target.display_name AS target_display_name
      FROM relations
      INNER JOIN entities source ON source.id = relations.source_entity_id AND source.repo_id = relations.repo_id
      INNER JOIN entities target ON target.id = relations.target_entity_id AND target.repo_id = relations.repo_id
      WHERE relations.repo_id = ?
        AND relations.index_run_id = ?
        AND relations.${column} = ?
      ORDER BY relations.kind, source.display_name, target.display_name, relations.id
      LIMIT ?
    `)
    .all(repoId, indexRunId, entityId, limit) as ExplainRelationRow[];
}

function explainEvidenceRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  relationIds: string[],
  limit: number
): ExplainEvidenceRow[] {
  if (relationIds.length === 0 || limit <= 0) return [];
  const placeholders = relationIds.map(() => '?').join(', ');
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
        ${spanColumns}
      FROM relation_evidence evidence
      WHERE evidence.repo_id = ?
        AND evidence.index_run_id = ?
        AND evidence.relation_id IN (${placeholders})
      ORDER BY evidence.file_path, evidence.kind, evidence.id
      LIMIT ?
    `)
    .all(repoId, indexRunId, ...relationIds, limit) as ExplainEvidenceRow[];
}

function explainEvidenceCount(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  relationIds: string[]
): number {
  if (relationIds.length === 0) return 0;
  const placeholders = relationIds.map(() => '?').join(', ');
  const row = db
    .prepare(`
      SELECT count(*) AS count
      FROM relation_evidence
      WHERE repo_id = ?
        AND index_run_id = ?
        AND relation_id IN (${placeholders})
    `)
    .get(repoId, indexRunId, ...relationIds) as { count: number };
  return row.count;
}

export function readEvidence(context: McpContext, evidenceId: string): unknown {
  return withReadOnlyDb(context, (db, repoId) => {
    const indexRunId = latestCompletedIndexRun(db, repoId);
    const spanColumns = evidenceSpanColumnSelect(db, 'evidence');
    const row = db
      .prepare(`
        SELECT
          evidence.id AS evidence_id,
          evidence.file_path AS evidence_file_path,
          evidence.kind AS evidence_kind,
          evidence.snippet AS evidence_snippet,
          evidence.confidence AS evidence_confidence,
          evidence.index_run_id AS evidence_index_run_id,
          ${spanColumns},
          relations.id AS relation_id,
          relations.kind AS relation_kind,
          relations.confidence AS relation_confidence,
          relations.provenance AS relation_provenance,
          source.id AS source_id,
          source.kind AS source_kind,
          source.path AS source_path,
          source.symbol AS source_symbol,
          source.language_id AS source_language_id,
          source.display_name AS source_display_name,
          target.id AS target_id,
          target.kind AS target_kind,
          target.path AS target_path,
          target.symbol AS target_symbol,
          target.language_id AS target_language_id,
          target.display_name AS target_display_name
        FROM relation_evidence evidence
        INNER JOIN relations
          ON relations.id = evidence.relation_id
         AND relations.repo_id = evidence.repo_id
         AND relations.index_run_id = evidence.index_run_id
        INNER JOIN entities source
          ON source.id = relations.source_entity_id
         AND source.repo_id = evidence.repo_id
         AND source.updated_index_run_id = evidence.index_run_id
        INNER JOIN entities target
          ON target.id = relations.target_entity_id
         AND target.repo_id = evidence.repo_id
         AND target.updated_index_run_id = evidence.index_run_id
        WHERE evidence.repo_id = ? AND evidence.id = ? AND evidence.index_run_id = ?
      `)
      .get(repoId, evidenceId, indexRunId) as EvidenceResourceRow | undefined;
    if (!row) throw typedMcpError(new Error(`impact evidence not found: ${evidenceId}`), 'resource_not_found');
    return {
      id: row.evidence_id,
      file: row.evidence_file_path,
      kind: row.evidence_kind,
      snippet: redactSecrets(row.evidence_snippet),
      confidence: asConfidence(row.evidence_confidence),
      ...(row.evidence_start_line !== null ? { startLine: row.evidence_start_line } : {}),
      ...(row.evidence_end_line !== null ? { endLine: row.evidence_end_line } : {}),
      ...(row.evidence_start_col !== null ? { startCol: row.evidence_start_col } : {}),
      ...(row.evidence_end_col !== null ? { endCol: row.evidence_end_col } : {}),
      relation: {
        id: row.relation_id,
        kind: row.relation_kind,
        confidence: asConfidence(row.relation_confidence),
        provenance: row.relation_provenance
      },
      sourceEntity: row.source_id ? entityFromEvidenceRow(row, 'source') : null,
      targetEntity: row.target_id ? entityFromEvidenceRow(row, 'target') : null,
      indexRunId: row.evidence_index_run_id
    };
  });
}

export function readLatestCoverage(context: McpContext): unknown {
  return withReadOnlyDb(context, (db, repoId) => {
    const indexRunId = latestCompletedIndexRun(db, repoId);
    const coverageLimit = 500;
    const coverage = db
      .prepare('SELECT path, language_id, status, reason FROM index_coverage WHERE index_run_id = ? ORDER BY path LIMIT ?')
      .all(indexRunId, coverageLimit + 1);
    return {
      indexRunId,
      coverage: coverage.slice(0, coverageLimit),
      limit: coverageLimit,
      truncated: coverage.length > coverageLimit
    };
  });
}

export function openEntityExplanationSession(root: string): EntityExplanationSession {
  const db = openDatabase(root, { readOnly: true });
  try {
    const repoId = getRepoId(db, root);
    const indexRunId = latestCompletedIndexRun(db, repoId);
    const column = (direction: 'incoming' | 'outgoing') => direction === 'incoming' ? 'target_entity_id' : 'source_entity_id';
    return {
      indexRunId,
      entity: (id) => db.prepare(`SELECT id, kind, path, symbol, language_id, display_name FROM entities WHERE repo_id = ? AND id = ? AND updated_index_run_id = ?`)
        .get(repoId, id, indexRunId) as ExplainEntityRow | undefined,
      relationCount: (direction, id) => relationCount(db, repoId, indexRunId, column(direction), id),
      relations: (direction, id, limit) => explainRelationRows(db, repoId, indexRunId, column(direction), id, limit),
      evidence: (ids, limit) => explainEvidenceRows(db, repoId, indexRunId, ids, limit),
      evidenceCount: (ids) => explainEvidenceCount(db, repoId, indexRunId, ids),
      close: () => db.close()
    };
  } catch (error) { db.close(); throw error; }
}
