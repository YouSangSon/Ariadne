import type { AnalysisSession } from "../../application/impact/analyze.js";
import { entityForPath, evidenceFromContextRow, reasonForLegacyRelation } from "../../domain/impact/analysis.js";
import type { CanonicalContextEvidenceRow, CanonicalImpactRow, ImpactRow } from "../../domain/impact/analysis.js";
import { asConfidence } from "../../domain/impact/confidence.js";
import type { AdapterRunInsight, EntityRef, Evidence } from "../../domain/model.js";
import { redactSecrets } from "../../domain/security/redaction.js";
import { makeEvidence } from "../filesystem/impact-sources.js";
import { readGitSnapshot } from "../git/snapshot.js";
import { loadCrossRepoImpactsForChangedContract } from "./cross-repo-impact.js";
import { ensureRepo, getRepoId, latestCompletedIndexRun, openDatabase } from "./store.js";

type AdapterRunRow = {
  adapter_id: string;
  adapter_version: string;
  language_ids: string;
  confidence?: string;
  known_gaps_json?: string;
  status: string;
  error_summary: string | null;
};

type LegacyImpactRow = {
  source_path: string;
  kind: string;
  confidence: 'proven' | 'inferred' | 'heuristic';
  provenance: string;
};

type IndexedFileRow = {
  id: number;
  content_hash: string;
};

type IndexRunSnapshotRow = {
  git_commit_sha: string | null;
  git_branch_name: string | null;
  git_is_dirty: number;
};

type AnalyzerSchemaFeatures = {
  adapterRunMetadataColumns: boolean;
  gitSnapshotColumns: boolean;
  relationEvidenceSpanColumns: boolean;
};

function detectAnalyzerSchemaFeatures(db: ReturnType<typeof openDatabase>): AnalyzerSchemaFeatures {
  return {
    adapterRunMetadataColumns: hasColumns(db, 'adapter_runs', ['confidence', 'known_gaps_json']),
    gitSnapshotColumns: hasColumn(db, 'index_runs', 'git_commit_sha'),
    relationEvidenceSpanColumns: hasColumn(db, 'relation_evidence', 'start_line')
  };
}

function hasColumns(db: ReturnType<typeof openDatabase>, table: string, columns: readonly string[]): boolean {
  return columns.every((column) => hasColumn(db, table, column));
}

function hasColumn(db: ReturnType<typeof openDatabase>, table: string, column: string): boolean {
  return db
    .prepare('SELECT 1 AS one FROM pragma_table_info(?) WHERE name = ?')
    .get(table, column) !== undefined;
}

function loadAdapterInsights(
  db: ReturnType<typeof openDatabase>,
  indexRunId: number,
  schemaFeatures: AnalyzerSchemaFeatures
): AdapterRunInsight[] {
  const rows = schemaFeatures.adapterRunMetadataColumns
    ? db
      .prepare(
        `SELECT adapter_id, adapter_version, language_ids, confidence, known_gaps_json, status, error_summary
           FROM adapter_runs
          WHERE index_run_id = ?
          ORDER BY adapter_id`
      )
      .all(indexRunId) as AdapterRunRow[]
    : db
      .prepare(
        `SELECT adapter_id, adapter_version, language_ids, status, error_summary
           FROM adapter_runs
          WHERE index_run_id = ?
          ORDER BY adapter_id`
      )
      .all(indexRunId) as AdapterRunRow[];

  return rows.map((row) => {
    const confidence = schemaFeatures.adapterRunMetadataColumns
      ? asConfidence(row.confidence ?? 'unknown')
      : 'unknown';
    const knownGaps = schemaFeatures.adapterRunMetadataColumns
      ? parseStringArray(row.known_gaps_json ?? '[]')
      : [];
    return {
      id: row.adapter_id,
      version: row.adapter_version,
      languageIds: parseStringArray(row.language_ids),
      status: row.status,
      confidence,
      knownGaps,
      ...(row.error_summary ? { errorSummary: redactSecrets(row.error_summary) } : {})
    };
  });
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function appendGitSnapshotWarnings(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  repoRoot: string,
  warnings: string[]
): void {
  const indexedSnapshot = db
    .prepare('SELECT git_commit_sha, git_branch_name, git_is_dirty FROM index_runs WHERE repo_id = ? AND id = ?')
    .get(repoId, indexRunId) as IndexRunSnapshotRow | undefined;
  if (!indexedSnapshot) return;
  if (!hasCapturedGitSnapshot(indexedSnapshot)) return;

  const currentSnapshot = readGitSnapshot(repoRoot);
  if (
    indexedSnapshot.git_commit_sha &&
    currentSnapshot.commitSha &&
    indexedSnapshot.git_commit_sha !== currentSnapshot.commitSha
  ) {
    warnings.push(
      `git HEAD changed since index run ${indexRunId}: ${shortSha(indexedSnapshot.git_commit_sha)} -> ${shortSha(currentSnapshot.commitSha)}`
    );
  }

  if (indexedSnapshot.git_is_dirty === 0 && currentSnapshot.isDirty) {
    warnings.push(`working tree is dirty but index run ${indexRunId} was clean`);
  }
  if (indexedSnapshot.git_is_dirty !== 0) {
    warnings.push(`index run ${indexRunId} was created from a dirty working tree`);
  }
}

function hasCapturedGitSnapshot(indexedSnapshot: IndexRunSnapshotRow): boolean {
  return indexedSnapshot.git_commit_sha !== null || indexedSnapshot.git_branch_name !== null;
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

function loadCanonicalOutgoingEvidence(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  changedEntityId: string,
  sourceEntity: EntityRef,
  schemaFeatures: AnalyzerSchemaFeatures
): Evidence[] {
  const spanColumns = evidenceSpanColumnSelect(schemaFeatures, 'evidence');
  const rows = db
    .prepare(`
      SELECT
        r.id AS relation_id,
        r.kind AS relation_kind,
        r.confidence AS relation_confidence,
        target.id AS target_entity_id,
        target.kind AS target_kind,
        target.path AS target_path,
        target.symbol AS target_symbol,
        target.language_id AS target_language_id,
        target.display_name AS target_display_name,
        evidence.id AS evidence_id,
        evidence.file_path AS evidence_file_path,
        evidence.kind AS evidence_kind,
        evidence.snippet AS evidence_snippet,
        evidence.confidence AS evidence_confidence,
        ${spanColumns}
      FROM relations r
      JOIN entities target ON target.id = r.target_entity_id
      INNER JOIN relation_evidence evidence ON evidence.relation_id = r.id
      WHERE r.repo_id = ?
        AND r.source_entity_id = ?
        AND r.index_run_id = ?
        AND evidence.repo_id = ?
        AND evidence.index_run_id = ?
      ORDER BY r.kind, r.id, evidence.file_path, evidence.kind, evidence.id
    `)
    .all(repoId, changedEntityId, indexRunId, repoId, indexRunId) as CanonicalContextEvidenceRow[];

  return rows.map((row) => evidenceFromContextRow(row, sourceEntity));
}

function loadCanonicalReverseRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  targetEntityId: string,
  limit: number,
  schemaFeatures: AnalyzerSchemaFeatures
): CanonicalImpactRow[] {
  const spanColumns = evidenceSpanColumnSelect(schemaFeatures, 'evidence');
  return db
    .prepare(`
      WITH bounded_relations AS (
        SELECT
          r.id AS relation_id,
          r.kind AS relation_kind,
          r.confidence AS relation_confidence,
          r.provenance AS provenance,
          source.id AS source_entity_id,
          source.kind AS source_kind,
          source.path AS source_path,
          source.symbol AS source_symbol,
          source.language_id AS source_language_id,
          source.display_name AS source_display_name,
          target.id AS target_entity_id,
          target.kind AS target_kind,
          target.path AS target_path,
          target.symbol AS target_symbol,
          target.language_id AS target_language_id,
          target.display_name AS target_display_name
        FROM relations r
        JOIN entities source ON source.id = r.source_entity_id
        JOIN entities target ON target.id = r.target_entity_id
        WHERE r.repo_id = ?
          AND r.target_entity_id = ?
          AND r.index_run_id = ?
          AND source.path IS NOT NULL
        ORDER BY source.path, r.kind, r.id
        LIMIT ?
      )
      SELECT
        bounded.relation_id AS relation_id,
        bounded.relation_kind AS relation_kind,
        bounded.relation_confidence AS relation_confidence,
        bounded.provenance AS provenance,
        bounded.source_entity_id AS source_entity_id,
        bounded.source_kind AS source_kind,
        bounded.source_path AS source_path,
        bounded.source_symbol AS source_symbol,
        bounded.source_language_id AS source_language_id,
        bounded.source_display_name AS source_display_name,
        bounded.target_entity_id AS target_entity_id,
        bounded.target_kind AS target_kind,
        bounded.target_path AS target_path,
        bounded.target_symbol AS target_symbol,
        bounded.target_language_id AS target_language_id,
        bounded.target_display_name AS target_display_name,
        evidence.id AS evidence_id,
        evidence.file_path AS evidence_file_path,
        evidence.kind AS evidence_kind,
        evidence.snippet AS evidence_snippet,
        evidence.confidence AS evidence_confidence,
        ${spanColumns}
      FROM bounded_relations bounded
      LEFT JOIN relation_evidence evidence ON evidence.id = (
        SELECT selected_evidence.id
        FROM relation_evidence selected_evidence
        WHERE selected_evidence.relation_id = bounded.relation_id
          AND selected_evidence.repo_id = ?
          AND selected_evidence.index_run_id = ?
        ORDER BY selected_evidence.file_path, selected_evidence.kind, selected_evidence.id
        LIMIT 1
      )
      ORDER BY bounded.source_path, bounded.relation_kind, bounded.relation_id
    `)
    .all(repoId, targetEntityId, indexRunId, limit, repoId, indexRunId) as CanonicalImpactRow[];
}

function evidenceSpanColumnSelect(
  schemaFeatures: AnalyzerSchemaFeatures,
  alias: string
): string {
  if (!schemaFeatures.relationEvidenceSpanColumns) {
    return [
      'NULL AS evidence_start_line',
      'NULL AS evidence_end_line',
      'NULL AS evidence_start_col',
      'NULL AS evidence_end_col'
    ].join(',\n        ');
  }
  return [
    `${alias}.start_line AS evidence_start_line`,
    `${alias}.end_line AS evidence_end_line`,
    `${alias}.start_col AS evidence_start_col`,
    `${alias}.end_col AS evidence_end_col`
  ].join(',\n        ');
}

function loadLegacyImpactRows(
  db: ReturnType<typeof openDatabase>,
  repoRoot: string,
  repoId: number,
  indexRunId: number,
  changedFile: string
): ImpactRow[] {
  const rows = db
    .prepare(`
      SELECT f.path AS source_path, e.kind, e.confidence, e.provenance
      FROM edges e
      JOIN files f ON f.id = e.source_file_id
      WHERE e.repo_id = ?
        AND e.target_path = ?
        AND e.index_run_id = ?
      ORDER BY f.path
    `)
    .all(repoId, changedFile, indexRunId) as LegacyImpactRow[];

  return rows.map((row) => {
    const sourceEntity = entityForPath(row.source_path);
    return {
      sourcePath: row.source_path,
      sourceEntity,
      reason: reasonForLegacyRelation(row.kind, changedFile),
      relationKind: row.kind,
      confidence: row.confidence,
      evidence: makeEvidence(repoRoot, row.source_path, row.kind, row.confidence, entityForPath(changedFile)),
      depth: 1,
      relationPath: [reasonForLegacyRelation(row.kind, changedFile)]
    };
  });
}

export function openAnalysisSession(repoRoot: string, readOnly: boolean): AnalysisSession {
  const db = openDatabase(repoRoot, readOnly ? { readOnly: true } : {});
  try {
    const repoId = readOnly ? getRepoId(db, repoRoot) : ensureRepo(db, repoRoot);
    const indexRunId = latestCompletedIndexRun(db, repoId);
    const features = detectAnalyzerSchemaFeatures(db);
    return {
      indexRunId,
      gitWarnings() {
        const warnings: string[] = [];
        if (features.gitSnapshotColumns) appendGitSnapshotWarnings(db, repoId, indexRunId, repoRoot, warnings);
        return warnings;
      },
      adapterInsights: () => loadAdapterInsights(db, indexRunId, features),
      changedFile(file) {
        const entity = db.prepare('SELECT id FROM entities WHERE repo_id = ? AND id = ? AND updated_index_run_id = ?')
          .get(repoId, `file:${file}`, indexRunId);
        const indexed = db.prepare('SELECT id, content_hash FROM files WHERE repo_id = ? AND path = ? AND index_run_id = ?')
          .get(repoId, file, indexRunId) as IndexedFileRow | undefined;
        return { canonical: entity !== undefined, indexed: indexed ? { contentHash: indexed.content_hash } : null };
      },
      inboundRelations: (entityId, limit) => loadCanonicalReverseRows(db, repoId, indexRunId, entityId, limit, features),
      legacyImpacts: (file) => loadLegacyImpactRows(db, repoRoot, repoId, indexRunId, file),
      outgoingEvidence: (entityId, source) => loadCanonicalOutgoingEvidence(db, repoId, indexRunId, entityId, source, features),
      crossRepoImpacts: (file) => loadCrossRepoImpactsForChangedContract({ db, repoRoot, repoId, indexRunId, changedFile: file }),
      saveReport: (report) => {
        db.prepare("INSERT OR REPLACE INTO reports (id, repo_id, index_run_id, json, created_at) VALUES (?, ?, ?, ?, datetime('now'))")
          .run(report.id, repoId, indexRunId, JSON.stringify(report));
      },
      close: () => db.close()
    };
  } catch (error) {
    db.close();
    throw error;
  }
}