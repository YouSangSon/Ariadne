import type { ScipImportSession } from "../../application/indexing/scip.js";
import { contentHash } from "../../domain/identity.js";
import { entityKindForPath } from "../../domain/indexing/entity-classification.js";
import { appendScipExportRelations, appendScipExportSymbols, fileEntityId, languageIdsForDocuments, makeScipExportDocuments, relationEvidenceId, relationId, SCIP_IMPORT_ADAPTER_ID, SCIP_IMPORT_ADAPTER_VERSION, scipSemanticId, stableJson } from "../../domain/indexing/scip.js";
import type { ExportDocumentBucket, ScipDefinition, ScipDocument, ScipImportSnapshot, ScipReference } from "../../domain/indexing/scip.js";
import type { EntityKind } from "../../domain/model.js";
import { redactSecrets } from "../../domain/security/redaction.js";
import { ensureRepo, getRepoId, latestCompletedIndexRun, openDatabase } from "./store.js";
import type { Db } from "./store.js";

type Statement = ReturnType<Db['prepare']>;

type PreparedScipStatements = {
  selectAdapterRun: Statement;
  insertAdapterRun: Statement;
  updateAdapterRun: Statement;
  deletePriorEvidence: Statement;
  deletePriorRelations: Statement;
  deletePriorCoverage: Statement;
  deletePriorSymbols: Statement;
  insertFile: Statement;
  selectFile: Statement;
  upsertEntity: Statement;
  insertEntityVersion: Statement;
  insertCoverage: Statement;
  insertSymbol: Statement;
  insertRelation: Statement;
  insertRelationEvidence: Statement;
};

function loadScipExportDocuments(db: Db, repoId: number, indexRunId: number): Map<string, ExportDocumentBucket> {
  const rows = db.prepare(`
    SELECT path, language
    FROM files
    WHERE repo_id = ? AND index_run_id = ?
    ORDER BY path
  `).all(repoId, indexRunId) as Array<{ path: string; language: string }>;
  return makeScipExportDocuments(rows);
}

function addExportedSymbols(
  db: Db,
  repoId: number,
  indexRunId: number,
  documents: Map<string, ExportDocumentBucket>
): void {
  const rows = db.prepare(`
    SELECT files.path, symbols.name, symbols.kind
    FROM symbols
    INNER JOIN files ON files.id = symbols.file_id
    WHERE files.repo_id = ?
      AND symbols.index_run_id = ?
    ORDER BY files.path, symbols.name, symbols.kind
  `).all(repoId, indexRunId) as Array<{ path: string; name: string; kind: string }>;
  return appendScipExportSymbols(documents, rows);
}

function addExportedRelationOccurrences(
  db: Db,
  repoId: number,
  indexRunId: number,
  documents: Map<string, ExportDocumentBucket>
): void {
  const rows = db.prepare(`
    SELECT
      target.path AS target_path,
      target.id AS target_id,
      target.kind AS target_kind,
      target.symbol AS target_symbol,
      target.display_name AS target_display_name,
      evidence.file_path,
      evidence.start_line,
      evidence.end_line,
      evidence.start_col,
      evidence.end_col
    FROM relations relation
    INNER JOIN entities target ON target.id = relation.target_entity_id
    LEFT JOIN relation_evidence evidence ON evidence.relation_id = relation.id
    WHERE relation.repo_id = ?
      AND relation.index_run_id = ?
      AND relation.kind IN ('DEPENDS_ON', 'CALLS', 'REFERENCES', 'IMPLEMENTS')
      AND target.path IS NOT NULL
    ORDER BY evidence.file_path, relation.id, evidence.id
  `).all(repoId, indexRunId) as Array<{
    target_path: string;
    target_id: string;
    target_kind: string;
    target_symbol: string | null;
    target_display_name: string;
    file_path: string | null;
    start_line: number | null;
    end_line: number | null;
    start_col: number | null;
    end_col: number | null;
  }>;

  return appendScipExportRelations(documents, rows);
}

function loadScipImportSnapshot(
  db: Db,
  repoId: number,
  indexRunId: number
): ScipImportSnapshot {
  const run = db.prepare(`
    SELECT git_commit_sha, git_is_dirty
    FROM index_runs
    WHERE id = ? AND repo_id = ?
  `).get(indexRunId, repoId) as { git_commit_sha: string | null; git_is_dirty: number };
  const rows = db.prepare(`
    SELECT id, path, language, content_hash
    FROM files
    WHERE repo_id = ? AND index_run_id = ?
  `).all(repoId, indexRunId) as Array<{
    id: number;
    path: string;
    language: string;
    content_hash: string;
  }>;
  const commitSha = run.git_is_dirty === 0 && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(run.git_commit_sha ?? '')
    ? run.git_commit_sha!
    : undefined;
  return {
    ...(commitSha ? { commitSha } : {}),
    files: new Map(rows.map((row) => [row.path, {
      id: row.id,
      language: row.language,
      hash: row.content_hash
    }]))
  };
}

function prepareScipStatements(db: Db): PreparedScipStatements {
  return {
    selectAdapterRun: db.prepare('SELECT id FROM adapter_runs WHERE index_run_id = ? AND adapter_id = ?'),
    insertAdapterRun: db.prepare(`
      INSERT INTO adapter_runs (
        index_run_id, adapter_id, adapter_version, language_ids, confidence, known_gaps_json,
        status, started_at, finished_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'completed', datetime('now'), datetime('now'))
    `),
    updateAdapterRun: db.prepare(`
      UPDATE adapter_runs
      SET adapter_version = ?,
          language_ids = ?,
          confidence = ?,
          known_gaps_json = ?,
          status = 'completed',
          finished_at = datetime('now'),
          error_summary = NULL
      WHERE id = ?
    `),
    deletePriorEvidence: db.prepare(`
      DELETE FROM relation_evidence
      WHERE relation_id IN (SELECT id FROM relations WHERE adapter_run_id = ?)
    `),
    deletePriorRelations: db.prepare('DELETE FROM relations WHERE adapter_run_id = ?'),
    deletePriorCoverage: db.prepare('DELETE FROM index_coverage WHERE index_run_id = ? AND adapter_id = ?'),
    deletePriorSymbols: db.prepare("DELETE FROM symbols WHERE index_run_id = ? AND semantic_id LIKE '%#scip:%'"),
    insertFile: db.prepare(`
      INSERT INTO files (repo_id, path, language, content_hash, index_run_id)
      VALUES (?, ?, ?, ?, ?)
    `),
    selectFile: db.prepare('SELECT id FROM files WHERE repo_id = ? AND path = ?'),
    upsertEntity: db.prepare(`
      INSERT INTO entities (
        id, repo_id, kind, path, symbol, language_id, display_name, created_index_run_id, updated_index_run_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        path = excluded.path,
        symbol = excluded.symbol,
        language_id = excluded.language_id,
        display_name = excluded.display_name,
        updated_index_run_id = excluded.updated_index_run_id
    `),
    insertEntityVersion: db.prepare(`
      INSERT OR REPLACE INTO entity_versions (entity_id, index_run_id, content_hash, location_json, state)
      VALUES (?, ?, ?, ?, 'active')
    `),
    insertCoverage: db.prepare(`
      INSERT OR REPLACE INTO index_coverage (index_run_id, adapter_id, path, language_id, status, reason)
      VALUES (?, ?, ?, ?, 'indexed', 'SCIP import document')
    `),
    insertSymbol: db.prepare(`
      INSERT OR REPLACE INTO symbols (file_id, name, kind, exported, semantic_id, index_run_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    insertRelation: db.prepare(`
      INSERT OR REPLACE INTO relations (
        id, repo_id, source_entity_id, target_entity_id, kind, confidence, adapter_run_id, index_run_id, provenance
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertRelationEvidence: db.prepare(`
      INSERT OR REPLACE INTO relation_evidence (
        id, relation_id, repo_id, file_path, kind, snippet, confidence, index_run_id,
        start_line, end_line, start_col, end_col
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
  };
}

function upsertScipAdapterRun(
  stmts: PreparedScipStatements,
  indexRunId: number,
  languageIds: readonly string[]
): number {
  const existing = stmts.selectAdapterRun.get(indexRunId, SCIP_IMPORT_ADAPTER_ID) as { id: number } | undefined;
  const languageJson = JSON.stringify(languageIds);
  if (existing) {
    stmts.updateAdapterRun.run(
      SCIP_IMPORT_ADAPTER_VERSION,
      languageJson,
      'proven',
      JSON.stringify([]),
      existing.id
    );
    return existing.id;
  }
  const inserted = stmts.insertAdapterRun.run(
    indexRunId,
    SCIP_IMPORT_ADAPTER_ID,
    SCIP_IMPORT_ADAPTER_VERSION,
    languageJson,
    'proven',
    JSON.stringify([])
  );
  return Number(inserted.lastInsertRowid);
}

function cleanupPriorScipImport(
  stmts: PreparedScipStatements,
  indexRunId: number,
  adapterRunId: number
): void {
  stmts.deletePriorEvidence.run(adapterRunId);
  stmts.deletePriorRelations.run(adapterRunId);
  stmts.deletePriorCoverage.run(indexRunId, SCIP_IMPORT_ADAPTER_ID);
  stmts.deletePriorSymbols.run(indexRunId);
}

function persistScipFile(
  document: ScipDocument,
  input: {
    stmts: PreparedScipStatements;
    repoId: number;
    indexRunId: number;
    fileIds: Map<string, number>;
  }
): void {
  let fileId = document.existingFileId;
  if (fileId === undefined) {
    input.stmts.insertFile.run(input.repoId, document.path, document.language, document.hash, input.indexRunId);
    const fileRow = input.stmts.selectFile.get(input.repoId, document.path) as { id: number } | undefined;
    if (!fileRow) throw new Error(`SCIP import failed to persist file row: ${document.path}`);
    fileId = fileRow.id;
    persistEntity({
      id: fileEntityId(document.path),
      repoId: input.repoId,
      kind: entityKindForPath(document.path) ?? 'file',
      path: document.path,
      symbol: null,
      language: document.language,
      displayName: document.path,
      contentHash: contentHash('file', document.path, document.language, document.hash),
      location: { kind: 'file', path: document.path, languageId: document.language }
    }, input);
  }
  input.fileIds.set(document.path, fileId);
  input.stmts.insertCoverage.run(input.indexRunId, SCIP_IMPORT_ADAPTER_ID, document.path, document.language);
}

function persistScipSymbol(
  definition: ScipDefinition,
  input: {
    stmts: PreparedScipStatements;
    indexRunId: number;
    fileIds: Map<string, number>;
  }
): void {
  const fileId = input.fileIds.get(definition.path);
  if (fileId === undefined) return;
  input.stmts.insertSymbol.run(
    fileId,
    definition.displayName,
    definition.symbolKind,
    definition.symbol.startsWith('local ') ? 0 : 1,
    scipSemanticId(definition),
    input.indexRunId
  );
}

function persistScipReference(
  reference: ScipReference,
  input: {
    stmts: PreparedScipStatements;
    repoId: number;
    indexRunId: number;
    adapterRunId: number;
    relationIds: Set<string>;
  }
): void {
  const sourceEntityId = fileEntityId(reference.sourcePath);
  const targetEntityId = fileEntityId(reference.targetPath);
  const provenance = `scip:${reference.symbol}`;
  const relationIdValue = relationId('REFERENCES', sourceEntityId, targetEntityId, provenance);
  const redactedSnippet = redactSecrets(reference.snippet);
  const evidenceIdValue = relationEvidenceId(relationIdValue, reference, redactedSnippet);
  input.stmts.insertRelation.run(
    relationIdValue,
    input.repoId,
    sourceEntityId,
    targetEntityId,
    'REFERENCES',
    'proven',
    input.adapterRunId,
    input.indexRunId,
    provenance
  );
  input.stmts.insertRelationEvidence.run(
    evidenceIdValue,
    relationIdValue,
    input.repoId,
    reference.sourcePath,
    'REFERENCES',
    redactedSnippet,
    'proven',
    input.indexRunId,
    reference.startLine ?? null,
    reference.endLine ?? null,
    reference.startCol ?? null,
    reference.endCol ?? null
  );
  input.relationIds.add(relationIdValue);
}

function persistEntity(
  entity: {
    id: string;
    repoId: number;
    kind: EntityKind;
    path: string | null;
    symbol: string | null;
    language: string | null;
    displayName: string;
    contentHash: string;
    location: Record<string, unknown>;
  },
  input: {
    stmts: PreparedScipStatements;
    indexRunId: number;
  }
): void {
  input.stmts.upsertEntity.run(
    entity.id,
    entity.repoId,
    entity.kind,
    entity.path,
    entity.symbol,
    entity.language,
    entity.displayName,
    input.indexRunId,
    input.indexRunId
  );
  input.stmts.insertEntityVersion.run(
    entity.id,
    input.indexRunId,
    entity.contentHash,
    stableJson(entity.location)
  );
}
export type { ScipExportOptions,ScipExportResult,ScipImportOptions,ScipImportResult } from "../../domain/indexing/scip.js";

export function openScipImport(root: string): ScipImportSession {
  const db = openDatabase(root);
  let active = false;
  try {
    // Keep the indexed snapshot and augmentation under the same writer lock.
    db.exec('BEGIN IMMEDIATE');
    active = true;
    const repoId = ensureRepo(db, root);
    const indexRunId = latestCompletedIndexRun(db, repoId);
    const snapshot = loadScipImportSnapshot(db, repoId, indexRunId);
    return {
      indexRunId,
      snapshot,
      publish(documents, definitions, items) {
        const references = { items };
    const stmts = prepareScipStatements(db);

    const adapterRunId = upsertScipAdapterRun(stmts, indexRunId, languageIdsForDocuments(documents));
    cleanupPriorScipImport(stmts, indexRunId, adapterRunId);

    const fileIds = new Map<string, number>();
    for (const document of documents) {
      persistScipFile(document, {
        stmts,
        repoId,
        indexRunId,
        fileIds
      });
    }

    for (const definition of definitions.values()) {
      persistScipSymbol(definition, {
        stmts,
        indexRunId,
        fileIds
      });
    }

    const relationIds = new Set<string>();
    for (const reference of references.items) {
      persistScipReference(reference, {
        stmts,
        repoId,
        indexRunId,
        adapterRunId,
        relationIds
      });
    }

        db.exec('COMMIT');
        active = false;
        return { adapterRunId, relationsImported: relationIds.size };
      },
      close() {
        try { if (active && db.isTransaction) db.exec('ROLLBACK'); }
        finally { db.close(); }
      }
    };
  } catch (error) {
    try { if (active && db.isTransaction) db.exec('ROLLBACK'); } finally { db.close(); }
    throw error;
  }
}

export function readScipExportSnapshot(root: string) {
  const db = openDatabase(root, { readOnly: true });
  try {
    const repoId = getRepoId(db, root);
    const indexRunId = latestCompletedIndexRun(db, repoId);
    const documents = loadScipExportDocuments(db, repoId, indexRunId);
    addExportedSymbols(db, repoId, indexRunId, documents);
    addExportedRelationOccurrences(db, repoId, indexRunId, documents);
    return { indexRunId, documents };
  } finally { db.close(); }
}