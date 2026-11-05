import { statSync } from "node:fs";
import path from "node:path";
import { timeIndexPhase } from "../../application/indexing/index-project.js";
import type { IndexingSession } from "../../application/indexing/ports.js";
import { contentHash } from "../../domain/identity.js";
import type { EntityDescriptor, IndexEvent, PendingEntity, PendingRelation, SemanticAdapter } from "../../domain/indexing/adapter.js";
import { computeCoChanges } from "../../domain/indexing/co-change.js";
import { entityKindForPath } from "../../domain/indexing/entity-classification.js";
import type { IndexDelta } from "../../domain/indexing/index-delta.js";
import type { AdapterGroup, AdapterRunStatus, CollectedIndexRun, PriorIndexRun, RelationEvidenceInput, ScanResult } from "../../domain/indexing/index-model.js";
import { adapterConfidence, adapterKnownGaps, compatibilityJsonForContractVersion, contractFileMetadata, contractMetadataForPersistence, defaultMaxFileBytes, diagnosticCoveragePath, diagnosticLanguageId, diagnosticReason, displayNameForEntityDescriptor, entityIdFromDescriptor, entityLocationJson, entityVersionContentHash, evidenceId, fileEntityId, hashIndexInputs, isScannablePath, legacyEdgeKindFor, pathBeforeDiagnosticMarker, relationEvidenceForPersistence, relationEvidenceId, relationId, relationKindToAttribute, stableJson, stringMetadata, unsupportedAdapterId } from "../../domain/indexing/index-policy.js";
import type { AdapterUsage, Confidence, EntityKind, IndexOptions, IndexResult, ScannedFile } from "../../domain/model.js";
import { redactSecrets } from "../../domain/security/redaction.js";
import { scanFiles } from "../filesystem/index-scan.js";
import { readCommitHistory } from "../git/co-change.js";
import { readIgnoredGitPaths, readTrackedGitPaths } from "../git/snapshot.js";
import { ensureRepo, openDatabase } from "./store.js";
import type { Db } from "./store.js";

type Statement = ReturnType<Db['prepare']>;

interface PreparedStatements {
  upsertAttributeDef: Statement;
  upsertTextAttribute: Statement;
  insertFact: Statement;
  insertFactProvenance: Statement;
  upsertFile: Statement;
  upsertEntity: Statement;
  insertEntityIfMissing: Statement;
  updateEntityFreshness: Statement;
  insertEntityVersion: Statement;
  insertEntityVersionIfMissing: Statement;
  upsertContract: Statement;
  insertContractVersion: Statement;
  insertCoverage: Statement;
  insertRelation: Statement;
  insertRelationEvidence: Statement;
  insertSymbol: Statement;
  insertEdge: Statement;
  insertEvidence: Statement;
  appendAdapterRunErrorSummary: Statement;
}

interface PersistContext {
  stmts: PreparedStatements;
  repoId: number;
  indexRunId: number;
  adapterRunId: number;
  adapterId: string;
  memoryTxId: string;
  fileIdByPath: Map<string, number>;
  fileContentHashByPath: Map<string, string>;
  canonicalEntityIds: Set<string>;
  canonicalRelationIds: Set<string>;
  counters: { symbolsIndexed: number; edgesIndexed: number };
}

function persistCollectedIndexRun(input: {
  db: Db;
  repoId: number;
  repoRoot: string;
  indexRunId: number;
  indexedFiles: readonly ScannedFile[];
  unsupportedFiles: readonly ScannedFile[];
  unsupportedLanguageIds: readonly string[];
  scan: ScanResult;
  adapterGroups: readonly AdapterGroup[];
  fileAdapterByPath: ReadonlyMap<string, SemanticAdapter>;
  collected: CollectedIndexRun;
  priorRun: PriorIndexRun | null;
  delta: IndexDelta;
  mainBranch: { id: string; head_tx_id: string | null };
  memoryTxId: string;
  memoryTs: string;
  commitHistory: readonly (readonly string[])[];
  inputSnapshotHash: string;
}): IndexResult {
  if (input.delta.mode === 'incremental' && input.delta.changed.length > 0) {
    throw new Error('carry-forward requires unchanged indexed content');
  }
  const stmts = prepareStatements(input.db);
  const persistCtx: Omit<PersistContext, 'adapterRunId' | 'adapterId'> = {
    stmts,
    repoId: input.repoId,
    indexRunId: input.indexRunId,
    memoryTxId: input.memoryTxId,
    fileIdByPath: new Map<string, number>(),
    fileContentHashByPath: new Map(
      input.indexedFiles.map((file) => [file.relativePath, file.hash])
    ),
    canonicalEntityIds: new Set<string>(),
    canonicalRelationIds: new Set<string>(),
    counters: { symbolsIndexed: 0, edgesIndexed: 0 },
  };
  const indexedPaths = new Set(input.indexedFiles.map((file) => file.relativePath));
  const coChangePairs = computeCoChanges(input.commitHistory, indexedPaths);
  const coChangeRunId =
    coChangePairs.length > 0
      ? Number(
          input.db
            .prepare(
              `INSERT INTO adapter_runs (
                 index_run_id, adapter_id, adapter_version, language_ids, confidence, known_gaps_json, status, started_at
               )
               VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
            )
            .run(
              input.indexRunId,
              'co-change',
              '1',
              JSON.stringify([]),
              'heuristic',
              JSON.stringify([
                'co-change relations are derived from git commit history, not code semantics — coupling is correlational, not a proven dependency',
                'squashed/rebased history, renames, and history-poor repos may miss or distort couplings'
              ]),
              'running'
            ).lastInsertRowid
        )
      : null;

  withIndexWriteTransaction(input.db, () => {
    // The writer lock cannot validate a plan collected before another publication.
    const currentRun = input.db.prepare(
      "SELECT id FROM index_runs WHERE repo_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1"
    ).get(input.repoId) as { id: number } | undefined;
    const currentBranch = input.db.prepare(
      "SELECT id, head_tx_id FROM branches WHERE name = 'main'"
    ).get() as { id: string; head_tx_id: string | null } | undefined;
    if ((currentRun?.id ?? null) !== (input.priorRun?.runId ?? null) ||
        (currentRun !== undefined && currentRun.id >= input.indexRunId) ||
        !currentBranch || currentBranch.id !== input.mainBranch.id ||
        currentBranch.head_tx_id !== input.mainBranch.head_tx_id) {
      throw new Error('index publication baseline changed; retry indexing');
    }
    input.db
      .prepare(
        'INSERT OR IGNORE INTO transactions (id, parent_tx_id, branch_id, ts, agent, index_run_id) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        input.memoryTxId,
        input.mainBranch.head_tx_id,
        input.mainBranch.id,
        input.memoryTs,
        'indexer',
        input.indexRunId
      );
    if (input.mainBranch.head_tx_id) {
      input.db
        .prepare('INSERT OR IGNORE INTO transaction_parents (tx_id, parent_tx_id) VALUES (?, ?)')
        .run(input.memoryTxId, input.mainBranch.head_tx_id);
    }

    const filesToReplay = input.delta.mode === 'incremental' ? [] : input.indexedFiles;
    for (const file of filesToReplay) {
      stmts.upsertFile.run(input.repoId, file.relativePath, file.language, file.hash, input.indexRunId);
      const fileEntId = fileEntityId(file.relativePath);
      const kind = entityKindForPath(file.relativePath, file.language);
      stmts.upsertEntity.run(
        fileEntId,
        input.repoId,
        kind,
        file.relativePath,
        null,
        file.language,
        file.relativePath,
        input.indexRunId,
        input.indexRunId
      );
      stmts.insertEntityVersion.run(
        fileEntId,
        input.indexRunId,
        file.hash,
        JSON.stringify({ path: file.relativePath }),
        'active'
      );
      persistContractDescriptor(
        {
          id: fileEntId,
          kind,
          path: file.relativePath,
          languageId: file.language,
          displayName: file.relativePath,
          metadata: contractFileMetadata(file.relativePath, file.language),
          contentHash: file.hash
        },
        persistCtx
      );
      persistCtx.canonicalEntityIds.add(fileEntId);
    }
    for (const row of input.db
      .prepare('SELECT id, path FROM files WHERE repo_id = ?')
      .all(input.repoId) as Array<{ id: number; path: string }>) {
      if (indexedPaths.has(row.path)) persistCtx.fileIdByPath.set(row.path, row.id);
    }

    for (const collectedEvent of input.collected.events) {
      const adapterPersistCtx: PersistContext = {
        ...persistCtx,
        adapterRunId: collectedEvent.adapterRunId,
        adapterId: collectedEvent.adapterId
      };
      handleEvent(collectedEvent.event, collectedEvent.file, adapterPersistCtx);
    }
    for (const completedRun of input.collected.completedAdapterRuns) {
      updateAdapterRun(input.db, completedRun.adapterRunId, 'completed');
    }

    const extractedFiles =
      input.delta.mode === 'incremental'
        ? input.indexedFiles.filter((file) => input.delta.changed.includes(file.relativePath))
        : input.indexedFiles;
    for (const file of extractedFiles) {
      const scanEvidenceId = evidenceId(file.relativePath, 'scan');
      stmts.insertEvidence.run(
        scanEvidenceId,
        input.repoId,
        file.relativePath,
        'scan',
        redactSecrets(file.content),
        'proven',
        input.indexRunId
      );
    }

    // Only unchanged indexed content may carry the prior extraction cohort.
    if (input.delta.mode === 'incremental' && input.priorRun) {
      carryForwardUnchanged(
        input.db,
        input.repoId,
        input.priorRun.runId,
        input.indexRunId
      );
    }

    let completeInputs = true;
    if (coChangeRunId !== null) {
      input.db.exec('SAVEPOINT s2_co_change_graph');
      try {
        // Refresh git evidence without downgrading runtime proof on unchanged files.
        const carriedProof = input.delta.mode === 'incremental' ? input.db.prepare(`
          SELECT 1 FROM relations WHERE repo_id = ? AND index_run_id = ?
            AND source_entity_id = ? AND target_entity_id = ?
            AND kind = 'CO_CHANGES' AND confidence = 'proven'`) : undefined;
        for (const pair of coChangePairs) {
          insertCanonicalRelation({
            repoId: input.repoId,
            sourceEntityId: fileEntityId(pair.source),
            targetEntityId: fileEntityId(pair.target),
            kind: 'CO_CHANGES',
            confidence: carriedProof?.get(input.repoId, input.indexRunId,
              fileEntityId(pair.source), fileEntityId(pair.target)) ? 'proven' : 'heuristic',
            provenance: `co-change:${pair.coChangeCount}:${pair.couplingScore.toFixed(2)}`,
            adapterRunId: coChangeRunId,
            indexRunId: input.indexRunId,
            evidence: [
              {
                file: pair.source,
                snippet: `co-changed with ${pair.target} in ${pair.coChangeCount} commits (coupling ${pair.couplingScore.toFixed(2)})`,
                confidence: 'heuristic',
                startLine: 1,
                endLine: 1,
                startCol: 1,
                endCol: 1
              }
            ],
            insertRelation: stmts.insertRelation,
            insertRelationEvidence: stmts.insertRelationEvidence,
            canonicalRelationIds: persistCtx.canonicalRelationIds,
            upsertAttributeDef: stmts.upsertAttributeDef,
            insertFact: stmts.insertFact,
            memoryTxId: input.memoryTxId,
            upsertTextAttribute: stmts.upsertTextAttribute,
            insertFactProvenance: stmts.insertFactProvenance,
          });
        }
        input.db.exec('RELEASE SAVEPOINT s2_co_change_graph');
        updateAdapterRun(input.db, coChangeRunId, 'completed');
      } catch (error) {
        completeInputs = false;
        input.db.exec('ROLLBACK TO SAVEPOINT s2_co_change_graph');
        input.db.exec('RELEASE SAVEPOINT s2_co_change_graph');
        updateAdapterRun(
          input.db,
          coChangeRunId,
          'failed',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    input.db
      .prepare(`UPDATE index_runs SET status = ?, finished_at = datetime('now'),
        input_snapshot_hash = ? WHERE id = ?`)
      .run('completed', completeInputs ? input.inputSnapshotHash : null, input.indexRunId);
    input.db
      .prepare('UPDATE branches SET head_tx_id = ? WHERE id = ?')
      .run(input.memoryTxId, input.mainBranch.id);
  });

  void input.fileAdapterByPath;
  void input.collected.completedFilePathsByAdapterId;
  return {
    indexRunId: input.indexRunId,
    mode: input.delta.mode,
    filesIndexed: input.indexedFiles.length,
    symbolsIndexed: persistCtx.counters.symbolsIndexed,
    edgesIndexed: persistCtx.counters.edgesIndexed,
    entitiesIndexed: persistCtx.canonicalEntityIds.size,
    relationsIndexed: persistCtx.canonicalRelationIds.size,
    adaptersUsed: input.adapterGroups.map((group) => ({
      id: group.adapter.id,
      version: group.adapter.version,
      languageIds: group.languageIds,
      confidence: adapterConfidence(group.adapter),
      knownGaps: adapterKnownGaps(group.adapter)
    })),
    coverage: {
      indexedPaths: input.indexedFiles.length,
      skippedPaths: input.scan.skipped.length + input.unsupportedFiles.length,
      unsupportedLanguageIds: [...input.unsupportedLanguageIds],
      skipped: [
        ...input.scan.skipped.map((file) => ({
          path: file.relativePath,
          ...(file.language ? { languageId: file.language } : {}),
          status: 'skipped',
          reason: file.reason
        }) as const),
        ...input.unsupportedFiles.map((file) => ({
          path: file.relativePath,
          languageId: file.language,
          status: 'skipped',
          reason: 'no registered adapter supports language'
        }) as const)
      ]
    }
  };
}

function updateAdapterRun(
  db: Db,
  adapterRunId: number,
  status: AdapterRunStatus,
  errorSummary?: string | null
): void {
  if (errorSummary === undefined) {
    db.prepare(
      "UPDATE adapter_runs SET status = ?, finished_at = datetime('now') WHERE id = ?"
    ).run(status, adapterRunId);
    return;
  }
  const storedErrorSummary = redactAdapterErrorSummary(errorSummary);
  if (status === 'failed' && errorSummary !== null) {
    db.prepare(
      `UPDATE adapter_runs
       SET status = ?,
           finished_at = datetime('now'),
           error_summary = CASE
             WHEN error_summary IS NULL OR error_summary = '' THEN ?
             ELSE error_summary || char(10) || ?
           END
       WHERE id = ?`
    ).run(status, storedErrorSummary, storedErrorSummary, adapterRunId);
    return;
  }
  db.prepare(
    "UPDATE adapter_runs SET status = ?, finished_at = datetime('now'), error_summary = ? WHERE id = ?"
  ).run(status, storedErrorSummary, adapterRunId);
}

function redactAdapterErrorSummary(errorSummary: string | null): string | null {
  return errorSummary === null ? null : redactSecrets(errorSummary);
}

function markUnstartedAdapterRunsSkipped(
  db: Db,
  insertCoverage: Statement,
  indexRunId: number,
  groups: readonly AdapterGroup[],
  adapterRunIds: ReadonlyMap<SemanticAdapter, number>,
  failedAdapterId: string
): void {
  const reason = `not run because ${failedAdapterId} failed`;
  for (const group of groups) {
    const adapterRunId = adapterRunIds.get(group.adapter);
    if (adapterRunId !== undefined) {
      updateAdapterRun(db, adapterRunId, 'skipped', reason);
    }
    markAdapterCoverageSkipped(insertCoverage, indexRunId, group.adapter, group.files, reason);
  }
}

function markAdapterCoverageSkipped(
  insertCoverage: Statement,
  indexRunId: number,
  adapter: SemanticAdapter,
  files: readonly ScannedFile[],
  reason: string
): void {
  for (const file of files) {
    insertCoverage.run(indexRunId, adapter.id, file.relativePath, file.language, 'skipped', reason);
  }
}

function failRunningAdapterRuns(db: Db, indexRunId: number, errorSummary: string): void {
  db.prepare(
    `UPDATE adapter_runs
     SET status = ?, finished_at = datetime('now'), error_summary = ?
     WHERE index_run_id = ? AND status = ?`
  ).run('failed', redactSecrets(errorSummary), indexRunId, 'running');
}

function withIndexWriteTransaction<T>(db: Db, body: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = body();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function loadPriorCompletedRun(db: Db, repoId: number): PriorIndexRun | null {
  const priorRun = db
    .prepare(
      "SELECT id, extractor_version, input_snapshot_hash FROM index_runs WHERE repo_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1"
    )
    .get(repoId) as { id: number; extractor_version: string; input_snapshot_hash: string | null } | undefined;
  if (!priorRun) return null;
  const rows = db
    .prepare('SELECT path, content_hash FROM files WHERE repo_id = ? AND index_run_id = ?')
    .all(repoId, priorRun.id) as Array<{ path: string; content_hash: string }>;
  const files = new Map<string, string>();
  for (const row of rows) files.set(row.path, row.content_hash);
  return { runId: priorRun.id, files: { extractorVersion: priorRun.extractor_version, files },
    inputSnapshotHash: priorRun.input_snapshot_hash };
}

function reuseCleanGitIndexIfUnchanged(
  db: Db,
  repoId: number,
  repoRoot: string,
  commitSha: string | null,
  isDirty: boolean,
  extractorVersion: string,
  options: IndexOptions
): IndexResult | null {
  if (!commitSha || isDirty || options.maxFileBytes !== undefined) return null;
  let reusable: IndexResult | null = null;
  // Keep the candidate and its mutable cohort rows in one reader snapshot.
  db.exec('BEGIN DEFERRED');
  try {
    const prior = db.prepare(
      `SELECT id, extractor_version, git_commit_sha, git_is_dirty, input_snapshot_hash
       FROM index_runs WHERE repo_id = ? AND status = 'completed'
       ORDER BY id DESC LIMIT 1`
    ).get(repoId) as {
      id: number; extractor_version: string; git_commit_sha: string | null; git_is_dirty: number | null;
      input_snapshot_hash: string | null;
    } | undefined;
    if (!prior || prior.extractor_version !== extractorVersion ||
        prior.git_commit_sha !== commitSha || prior.git_is_dirty !== 0 || !prior.input_snapshot_hash) return null;
    if (!indexRunFitsDefaultScanLimit(db, repoId, repoRoot, prior.id)) return null;
    const scan = timeIndexPhase(options, 'scan', () => scanFiles(repoRoot, defaultMaxFileBytes));
    if (hashIndexInputs(scan, readCommitHistory(repoRoot)) !== prior.input_snapshot_hash) return null;
    reusable = loadIndexResultForRun(db, repoId, prior.id);
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK');
  }
  if (!reusable) return null;
  // A retained reader snapshot cannot see a cohort published during validation.
  const latest = db.prepare(`SELECT id FROM index_runs
    WHERE repo_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1`)
    .get(repoId) as { id: number } | undefined;
  return latest?.id === reusable.indexRunId ? reusable : null;
}

function indexRunFitsDefaultScanLimit(
  db: Db,
  repoId: number,
  repoRoot: string,
  indexRunId: number
): boolean {
  const trackedPaths = readTrackedGitPaths(repoRoot);
  if (!trackedPaths) return false;
  const ignoredPaths = readIgnoredGitPaths(repoRoot);
  if (!ignoredPaths || [...ignoredPaths].some(isScannablePath)) return false;
  const resourceSkip = db
    .prepare(
      `SELECT 1 AS one
       FROM index_coverage
       WHERE index_run_id = ? AND reason LIKE 'file exceeds maxFileBytes%'
       LIMIT 1`
    )
    .get(indexRunId) as { one: number } | undefined;
  if (resourceSkip) return false;
  const files = db
    .prepare('SELECT path FROM files WHERE repo_id = ? AND index_run_id = ?')
    .all(repoId, indexRunId) as Array<{ path: string }>;
  const coveragePaths = db
    .prepare('SELECT path FROM index_coverage WHERE index_run_id = ?')
    .all(indexRunId) as Array<{ path: string }>;
  for (const file of files) {
    if (!trackedPaths.has(file.path)) return false;
    try {
      if (statSync(path.join(repoRoot, file.path)).size > defaultMaxFileBytes) return false;
    } catch {
      return false;
    }
  }
  return coveragePaths.every((coverage) => trackedPaths.has(pathBeforeDiagnosticMarker(coverage.path)));
}

function loadIndexResultForRun(db: Db, repoId: number, indexRunId: number): IndexResult {
  const counts = db
    .prepare(
      `SELECT
         (SELECT count(*) FROM files WHERE repo_id = ? AND index_run_id = ?) AS filesIndexed,
         (SELECT count(*) FROM symbols WHERE index_run_id = ?) AS symbolsIndexed,
         (SELECT count(*) FROM edges WHERE repo_id = ? AND index_run_id = ?) AS edgesIndexed,
         (SELECT count(*) FROM entities WHERE repo_id = ? AND updated_index_run_id = ?) AS entitiesIndexed,
         (SELECT count(*) FROM relations WHERE repo_id = ? AND index_run_id = ?) AS relationsIndexed`
    )
    .get(
      repoId,
      indexRunId,
      indexRunId,
      repoId,
      indexRunId,
      repoId,
      indexRunId,
      repoId,
      indexRunId
    ) as {
    filesIndexed: number;
    symbolsIndexed: number;
    edgesIndexed: number;
    entitiesIndexed: number;
    relationsIndexed: number;
  };
  const adaptersUsed = db
    .prepare(
      `SELECT adapter_id, adapter_version, language_ids, confidence, known_gaps_json
       FROM adapter_runs
       WHERE index_run_id = ? AND adapter_id != 'co-change'
       ORDER BY id`
    )
    .all(indexRunId)
    .map((row) => {
      const adapter = row as {
        adapter_id: string;
        adapter_version: string;
        language_ids: string;
        confidence: Confidence;
        known_gaps_json: string;
      };
      return {
        id: adapter.adapter_id,
        version: adapter.adapter_version,
        languageIds: parseStringArray(adapter.language_ids),
        confidence: adapter.confidence,
        knownGaps: parseStringArray(adapter.known_gaps_json)
      };
    }) as AdapterUsage[];
  const coverageRows = db
    .prepare(
      `SELECT path, language_id, status, reason
       FROM index_coverage
       WHERE index_run_id = ?
       ORDER BY path`
    )
    .all(indexRunId) as Array<{
    path: string;
    language_id: string | null;
    status: 'indexed' | 'skipped';
    reason: string;
  }>;
  const skipped = coverageRows
    .filter((row) => row.status === 'skipped')
    .map((row) => ({
      path: row.path,
      ...(row.language_id !== null ? { languageId: row.language_id } : {}),
      status: row.status,
      reason: row.reason
    }));
  return {
    indexRunId,
    mode: 'incremental',
    filesIndexed: counts.filesIndexed,
    symbolsIndexed: counts.symbolsIndexed,
    edgesIndexed: counts.edgesIndexed,
    entitiesIndexed: counts.entitiesIndexed,
    relationsIndexed: counts.relationsIndexed,
    adaptersUsed,
    coverage: {
      indexedPaths: coverageRows.filter((row) => row.status === 'indexed').length,
      skippedPaths: skipped.length,
      unsupportedLanguageIds: [
        ...new Set(skipped.flatMap((row) => row.languageId === undefined ? [] : [row.languageId]))
      ].sort(),
      skipped
    }
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

// No-op runs preserve extraction output exactly; scanner skips are freshly written.
// Audit ownership moves with relations so later SCIP imports can replace old rows.
function carryForwardUnchanged(
  db: Db,
  repoId: number,
  priorRunId: number,
  newRunId: number
): void {
  db.prepare(`UPDATE files SET index_run_id = ?
    WHERE repo_id = ? AND index_run_id = ?`).run(newRunId, repoId, priorRunId);

  db.prepare(`INSERT INTO index_coverage (index_run_id, adapter_id, path, language_id, status, reason)
    SELECT ?, adapter_id, path, language_id, status, reason FROM index_coverage
    WHERE index_run_id = ? AND (status = 'indexed' OR
      (status = 'skipped' AND (reason GLOB 'diagnostic warning: *' OR reason GLOB 'diagnostic error: *')))
    ON CONFLICT(index_run_id, adapter_id, path) DO NOTHING`).run(newRunId, priorRunId);

  db.prepare(`UPDATE entities SET updated_index_run_id = ?
    WHERE repo_id = ? AND updated_index_run_id = ?`).run(newRunId, repoId, priorRunId);

  db.prepare(`INSERT INTO entity_versions (entity_id, index_run_id, content_hash, location_json, state)
    SELECT entity_id, ?, content_hash, location_json, state FROM entity_versions
    WHERE index_run_id = ?`).run(newRunId, priorRunId);

  db.prepare(`INSERT INTO contract_versions (id, contract_id, index_run_id, content_hash,
      schema_version, compatibility_json, breaking_change_summary, created_at)
    SELECT contract_id || ':' || ?, contract_id, ?, content_hash,
      schema_version, compatibility_json, breaking_change_summary, created_at
    FROM contract_versions WHERE index_run_id = ?`).run(newRunId, newRunId, priorRunId);

  db.prepare(`INSERT INTO adapter_runs (index_run_id, adapter_id, adapter_version, language_ids,
      confidence, known_gaps_json, status, started_at, finished_at, error_summary)
    SELECT ?, adapter_id, adapter_version, language_ids, confidence, known_gaps_json,
      status, started_at, finished_at, error_summary FROM adapter_runs WHERE index_run_id = ?
    ON CONFLICT(index_run_id, adapter_id) DO UPDATE SET error_summary = excluded.error_summary
      WHERE adapter_runs.status = 'completed'`).run(newRunId, priorRunId);

  db.prepare(`UPDATE relations SET index_run_id = ?, adapter_run_id = COALESCE((
      SELECT current.id FROM adapter_runs prior JOIN adapter_runs current
        ON current.adapter_id = prior.adapter_id AND current.index_run_id = ?
      WHERE prior.id = relations.adapter_run_id), adapter_run_id)
    WHERE repo_id = ? AND index_run_id = ?`).run(newRunId, newRunId, repoId, priorRunId);

  db.prepare(`UPDATE relation_evidence SET index_run_id = ?
    WHERE repo_id = ? AND index_run_id = ?`).run(newRunId, repoId, priorRunId);

  db.prepare(`UPDATE evidence SET index_run_id = ?
    WHERE repo_id = ? AND index_run_id = ?`).run(newRunId, repoId, priorRunId);

  db.prepare(`UPDATE edges SET index_run_id = ?
    WHERE repo_id = ? AND index_run_id = ?`).run(newRunId, repoId, priorRunId);

  db.prepare(`UPDATE symbols SET index_run_id = ?
    WHERE index_run_id = ?`).run(newRunId, priorRunId);
}

function prepareStatements(db: Db): PreparedStatements {
  return {
    upsertAttributeDef: db.prepare(
      `INSERT INTO attribute_defs (name, value_type, is_code_relation, description)
       VALUES (?, 'entity_ref', 1, '')
       ON CONFLICT(name) DO UPDATE SET
         value_type = 'entity_ref',
         is_code_relation = 1`
    ),
    upsertTextAttribute: db.prepare(
      "INSERT OR IGNORE INTO attribute_defs (name, value_type, is_code_relation, description) VALUES (?, 'text', 0, '')"
    ),
    insertFact: db.prepare(
      'INSERT OR IGNORE INTO facts (id, entity_id, attribute, value_blob, op, tx_id, redacted) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ),
    insertFactProvenance: db.prepare(
      "INSERT OR IGNORE INTO fact_provenance (id, fact_id, source_fact_id, kind, tx_id) VALUES (?, ?, ?, 'evidence', ?)"
    ),
    upsertFile: db.prepare(`
      INSERT INTO files (repo_id, path, language, content_hash, index_run_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(repo_id, path) DO UPDATE SET
        language = excluded.language,
        content_hash = excluded.content_hash,
        index_run_id = excluded.index_run_id
    `),
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
    insertEntityIfMissing: db.prepare(`
      INSERT OR IGNORE INTO entities (
        id, repo_id, kind, path, symbol, language_id, display_name, created_index_run_id, updated_index_run_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateEntityFreshness: db.prepare(`
      UPDATE entities
      SET updated_index_run_id = ?
      WHERE id = ? AND updated_index_run_id <> ?
    `),
    insertEntityVersion: db.prepare(`
      INSERT OR REPLACE INTO entity_versions (entity_id, index_run_id, content_hash, location_json, state)
      VALUES (?, ?, ?, ?, ?)
    `),
    insertEntityVersionIfMissing: db.prepare(`
      INSERT OR IGNORE INTO entity_versions (entity_id, index_run_id, content_hash, location_json, state)
      VALUES (?, ?, ?, ?, ?)
    `),
    upsertContract: db.prepare(`
      INSERT INTO contracts (id, repo_id, kind, service_name, path, display_name, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        repo_id = excluded.repo_id,
        kind = excluded.kind,
        service_name = excluded.service_name,
        path = excluded.path,
        display_name = excluded.display_name,
        metadata_json = excluded.metadata_json
    `),
    insertContractVersion: db.prepare(`
      INSERT OR REPLACE INTO contract_versions (
        id, contract_id, index_run_id, content_hash, schema_version, compatibility_json,
        breaking_change_summary, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, datetime('now'))
    `),
    insertCoverage: db.prepare(`
      INSERT OR REPLACE INTO index_coverage (index_run_id, adapter_id, path, language_id, status, reason)
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
    `),
    insertSymbol: db.prepare(`
      INSERT OR REPLACE INTO symbols (file_id, name, kind, exported, semantic_id, index_run_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    insertEdge: db.prepare(`
      INSERT OR REPLACE INTO edges (repo_id, source_file_id, target_file_id, kind, target_path, confidence, provenance, index_run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertEvidence: db.prepare(`
      INSERT OR REPLACE INTO evidence (id, repo_id, file_path, kind, snippet, confidence, index_run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    appendAdapterRunErrorSummary: db.prepare(`
      UPDATE adapter_runs
      SET error_summary = CASE
        WHEN error_summary IS NULL OR error_summary = '' THEN ?
        ELSE error_summary || char(10) || ?
      END
      WHERE id = ?
    `)
  };
}

function handleEvent(event: IndexEvent, file: ScannedFile, ctx: PersistContext): void {
  if (event.kind === 'entity') {
    persistEntity(event.entity, ctx);
  } else if (event.kind === 'relation') {
    persistRelation(event.relation, file, ctx);
  } else {
    persistDiagnostic(event, file, ctx);
  }
}

function persistDiagnostic(
  event: Extract<IndexEvent, { kind: 'diagnostic' }>,
  file: ScannedFile,
  ctx: PersistContext
): void {
  recordDiagnostic(event, file, {
    insertCoverage: ctx.stmts.insertCoverage,
    appendAdapterRunErrorSummary: ctx.stmts.appendAdapterRunErrorSummary,
    indexRunId: ctx.indexRunId,
    adapterId: ctx.adapterId,
    adapterRunId: ctx.adapterRunId
  });
}

function recordDiagnostic(
  event: Extract<IndexEvent, { kind: 'diagnostic' }>,
  file: ScannedFile,
  ctx: {
    insertCoverage: Statement;
    appendAdapterRunErrorSummary: Statement;
    indexRunId: number;
    adapterId: string;
    adapterRunId: number;
  }
): void {
  const reason = diagnosticReason(event.level, event.message);
  if (event.file) {
    ctx.insertCoverage.run(
      ctx.indexRunId,
      ctx.adapterId,
      diagnosticCoveragePath(event.file, event.level, reason),
      diagnosticLanguageId(event.file, file),
      'skipped',
      reason
    );
    return;
  }
  ctx.appendAdapterRunErrorSummary.run(reason, reason, ctx.adapterRunId);
}

function persistEntity(entity: PendingEntity, ctx: PersistContext): void {
  const entityId = persistEntityDescriptor(entity, ctx, 'explicit');
  if (entity.kind === 'symbol') {
    const meta = entity.metadata as { exported?: boolean } | undefined;
    if (entity.path) {
      const fileId = ctx.fileIdByPath.get(entity.path);
      if (fileId !== undefined) {
        const semanticId = `${entity.path}#${entity.symbolKind ?? ''}:${entity.symbol ?? ''}`;
        ctx.stmts.insertSymbol.run(
          fileId,
          entity.symbol ?? '',
          entity.symbolKind ?? '',
          meta?.exported ? 1 : 0,
          semanticId,
          ctx.indexRunId
        );
      }
    }
    ctx.counters.symbolsIndexed++;
  }
  ctx.canonicalEntityIds.add(entityId);
}

function persistEntityDescriptor(
  entity: EntityDescriptor | PendingEntity,
  ctx: PersistContext,
  mode: 'explicit' | 'placeholder'
): string {
  const metadata = 'metadata' in entity ? entity.metadata : undefined;
  const entityId = entityIdFromDescriptor(entity, metadata);
  const displayName = displayNameForEntityDescriptor(entity, entityId, metadata);
  const contentHashValue = entityVersionContentHash(entity, ctx, metadata);
  const locationJson = entityLocationJson(entity, metadata);

  const entityValues = [
    entityId,
    ctx.repoId,
    entity.kind,
    entity.path ?? null,
    entity.symbol ?? null,
    entity.languageId ?? null,
    displayName,
    ctx.indexRunId,
    ctx.indexRunId
  ] as const;
  const versionValues = [
    entityId,
    ctx.indexRunId,
    contentHashValue,
    locationJson,
    'active'
  ] as const;

  if (mode === 'placeholder') {
    ctx.stmts.insertEntityIfMissing.run(...entityValues);
    ctx.stmts.updateEntityFreshness.run(ctx.indexRunId, entityId, ctx.indexRunId);
    ctx.stmts.insertEntityVersionIfMissing.run(...versionValues);
  } else {
    ctx.stmts.upsertEntity.run(...entityValues);
    ctx.stmts.insertEntityVersion.run(...versionValues);
  }
  if (mode === 'explicit') {
    persistContractDescriptor(
      {
        id: entityId,
        kind: entity.kind,
        path: entity.path,
        languageId: entity.languageId,
        displayName,
        metadata: metadata ?? {},
        contentHash: contentHashValue
      },
      ctx
    );
  }
  return entityId;
}

function persistContractDescriptor(
  contract: {
    id: string;
    kind: EntityKind;
    path: string | undefined;
    languageId: string | undefined;
    displayName: string;
    metadata: Readonly<Record<string, unknown>>;
    contentHash: string;
  },
  ctx: Pick<PersistContext, 'stmts' | 'repoId' | 'indexRunId' | 'fileContentHashByPath'>
): void {
  if (contract.kind !== 'contract' || !contract.path) return;
  const serviceName = stringMetadata(contract.metadata, 'serviceName', 'service_name');
  const schemaVersion = stringMetadata(contract.metadata, 'schemaVersion', 'schema_version');
  const contractKind =
    stringMetadata(contract.metadata, 'contractKind', 'contract_kind') ??
    contract.languageId ??
    contract.kind;
  const contractContentHash = ctx.fileContentHashByPath.get(contract.path) ?? contract.contentHash;
  const contractMetadata = contractMetadataForPersistence(contract.metadata);
  const compatibilityJson = compatibilityJsonForContractVersion(contract.metadata);
  ctx.stmts.upsertContract.run(
    contract.id,
    ctx.repoId,
    contractKind,
    serviceName ?? null,
    contract.path,
    contract.displayName,
    stableJson(contractMetadata)
  );
  ctx.stmts.insertContractVersion.run(
    `${contract.id}:${ctx.indexRunId}`,
    contract.id,
    ctx.indexRunId,
    contractContentHash,
    schemaVersion ?? null,
    compatibilityJson
  );
}

function persistRelation(
  relation: PendingRelation,
  file: ScannedFile,
  ctx: PersistContext
): void {
  const sourceId = ensureRelationEndpointEntity(relation.source, ctx);
  const targetId = ensureRelationEndpointEntity(relation.target, ctx);
  const meta = relation.metadata as
    | { provenance?: string; confidence?: Confidence }
    | undefined;
  const provenance = meta?.provenance ?? '';
  const confidence: Confidence =
    meta?.confidence ?? relation.evidence?.[0]?.confidence ?? 'heuristic';

  if (
    relation.source.kind !== 'symbol' &&
    relation.target.kind !== 'symbol' &&
    relation.source.path
  ) {
    const sourceFileId = ctx.fileIdByPath.get(relation.source.path);
    if (sourceFileId !== undefined) {
      const targetFileId =
        relation.target.kind === 'file' && relation.target.path
          ? ctx.fileIdByPath.get(relation.target.path) ?? null
          : null;
      const targetPath =
        relation.target.kind === 'file' && relation.target.path
          ? relation.target.path
          : relation.target.displayName ?? '';
      const edgeKind = legacyEdgeKindFor(relation.kind);
      ctx.stmts.insertEdge.run(
        ctx.repoId,
        sourceFileId,
        targetFileId,
        edgeKind,
        targetPath,
        confidence,
        provenance,
        ctx.indexRunId
      );
      ctx.counters.edgesIndexed++;
    }
  }

  insertCanonicalRelation({
    repoId: ctx.repoId,
    sourceEntityId: sourceId,
    targetEntityId: targetId,
    kind: relation.kind,
    confidence,
    provenance,
    adapterRunId: ctx.adapterRunId,
    indexRunId: ctx.indexRunId,
    evidence: relationEvidenceForPersistence(relation, file, confidence),
    insertRelation: ctx.stmts.insertRelation,
    insertRelationEvidence: ctx.stmts.insertRelationEvidence,
    canonicalRelationIds: ctx.canonicalRelationIds,
    upsertAttributeDef: ctx.stmts.upsertAttributeDef,
    insertFact: ctx.stmts.insertFact,
    memoryTxId: ctx.memoryTxId,
    upsertTextAttribute: ctx.stmts.upsertTextAttribute,
    insertFactProvenance: ctx.stmts.insertFactProvenance,
  });
}

function ensureRelationEndpointEntity(entity: EntityDescriptor, ctx: PersistContext): string {
  const entityId = persistEntityDescriptor(entity, ctx, 'placeholder');
  ctx.canonicalEntityIds.add(entityId);
  return entityId;
}

function insertCanonicalRelation(input: {
  repoId: number;
  sourceEntityId: string;
  targetEntityId: string;
  kind: string;
  confidence: string;
  provenance: string;
  adapterRunId: number;
  indexRunId: number;
  evidence: readonly RelationEvidenceInput[];
  insertRelation: Statement;
  insertRelationEvidence: Statement;
  canonicalRelationIds: Set<string>;
  upsertAttributeDef: Statement;
  insertFact: Statement;
  memoryTxId: string;
  upsertTextAttribute: Statement;
  insertFactProvenance: Statement;
}): void {
  const id = relationId(input.kind, input.sourceEntityId, input.targetEntityId, input.provenance);

  input.insertRelation.run(
    id,
    input.repoId,
    input.sourceEntityId,
    input.targetEntityId,
    input.kind,
    input.confidence,
    input.adapterRunId,
    input.indexRunId,
    input.provenance
  );
  input.canonicalRelationIds.add(id);

  const attribute = relationKindToAttribute(input.kind);
  input.upsertAttributeDef.run(attribute);
  const valueBlob = JSON.stringify(input.targetEntityId);
  const factId = contentHash(input.sourceEntityId, attribute, valueBlob, 'assert');
  input.insertFact.run(
    factId,
    input.sourceEntityId,
    attribute,
    valueBlob,
    'assert',
    input.memoryTxId,
    0
  );

  input.upsertTextAttribute.run('evidence_snippet');
  input.evidence.forEach((evidence) => {
    const redactedSnippet = redactSecrets(evidence.snippet);
    const isSnippetRedacted = redactedSnippet !== evidence.snippet;
    const relationEvidenceIdValue = relationEvidenceId(id, evidence, redactedSnippet);
    input.insertRelationEvidence.run(
      relationEvidenceIdValue,
      id,
      input.repoId,
      evidence.file,
      input.kind,
      redactedSnippet,
      evidence.confidence,
      input.indexRunId,
      evidence.startLine ?? null,
      evidence.endLine ?? null,
      evidence.startCol ?? null,
      evidence.endCol ?? null
    );

    const evidenceEntity = `file:${evidence.file}`;
    const evidenceValueBlob = JSON.stringify(redactedSnippet);
    const evidenceFactId = contentHash(
      evidenceEntity,
      'evidence_snippet',
      evidenceValueBlob,
      'assert'
    );
    input.insertFact.run(
      evidenceFactId,
      evidenceEntity,
      'evidence_snippet',
      evidenceValueBlob,
      'assert',
      input.memoryTxId,
      isSnippetRedacted ? 1 : 0
    );
    const provenanceId = contentHash(factId, evidenceFactId);
    input.insertFactProvenance.run(provenanceId, factId, evidenceFactId, input.memoryTxId);
  });
}

export { scanFiles } from "../filesystem/index-scan.js";

export function openIndexingSession(repoRoot: string): IndexingSession {
  const db = openDatabase(repoRoot);
  let repoId: number;
  try { repoId = ensureRepo(db, repoRoot); } catch (error) { db.close(); throw error; }
  let baseline: { mainBranch: { id: string; head_tx_id: string | null }; memoryTs: string; memoryTxId: string } | null = null;
  return {
    reuseCleanIndex: (snapshot, extractorVersion, options) => reuseCleanGitIndexIfUnchanged(
      db, repoId, repoRoot, snapshot.commitSha, snapshot.isDirty, extractorVersion, options
    ),
    startRun(snapshot, extractorVersion) {
      return Number(db.prepare(`INSERT INTO index_runs (
        repo_id, status, started_at, extractor_version, git_commit_sha, git_branch_name, git_is_dirty
      ) VALUES (?, ?, datetime('now'), ?, ?, ?, ?)`)
        .run(repoId, 'running', extractorVersion, snapshot.commitSha, snapshot.branchName, snapshot.isDirty ? 1 : 0).lastInsertRowid);
    },
    priorCompletedRun: () => loadPriorCompletedRun(db, repoId),
    prepareExtraction(indexRunId, input) {
      const { adapterGroups, skippedCoverage, unsupportedFiles, indexedCoverageFiles, fileAdapterByPath } = input;
    const adapterRunIds = new Map<SemanticAdapter, number>();
    const insertAdapterRun = db.prepare(`
        INSERT INTO adapter_runs (
          index_run_id, adapter_id, adapter_version, language_ids, confidence, known_gaps_json, status, started_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);
    for (const group of adapterGroups) {
      const adapterRunInsert = insertAdapterRun.run(
        indexRunId,
        group.adapter.id,
        group.adapter.version,
        JSON.stringify(group.languageIds),
        adapterConfidence(group.adapter),
        JSON.stringify(adapterKnownGaps(group.adapter)),
        'running'
      );
      adapterRunIds.set(group.adapter, Number(adapterRunInsert.lastInsertRowid));
    }

    const mainBranch = db
      .prepare("SELECT id, head_tx_id FROM branches WHERE name = 'main'")
      .get() as { id: string; head_tx_id: string | null } | undefined;
    if (!mainBranch) {
      throw new Error('main branch missing from agent memory schema (schema v4 not applied)');
    }
    const memoryTs = new Date().toISOString();
    const memoryTxId = contentHash(
      mainBranch.head_tx_id ?? '',
      mainBranch.id,
      memoryTs,
      'indexer'
    );
    const stmts = prepareStatements(db);
    for (const { file: skipped, adapterId } of skippedCoverage) {
      stmts.insertCoverage.run(
        indexRunId,
        adapterId,
        skipped.relativePath,
        skipped.language ?? null,
        'skipped',
        skipped.reason
      );
    }

    for (const file of unsupportedFiles) {
      stmts.insertCoverage.run(
        indexRunId,
        unsupportedAdapterId,
        file.relativePath,
        file.language,
        'skipped',
        'no registered adapter supports language'
      );
    }

    for (const file of indexedCoverageFiles) {
      const adapter = fileAdapterByPath.get(file.relativePath);
      if (!adapter) continue;
      stmts.insertCoverage.run(
        indexRunId,
        adapter.id,
        file.relativePath,
        file.language,
        'indexed',
        'matched source extension'
      );
    }

      baseline = { mainBranch, memoryTs, memoryTxId };
      return adapterRunIds;
    },
    audit(indexRunId) {
      const stmts = prepareStatements(db);
      return {
        finish: (id, status, message) => updateAdapterRun(db, id, status, message),
        diagnostic: (event, file, adapterId, adapterRunId) => recordDiagnostic(event, file, {
          insertCoverage: stmts.insertCoverage,
          appendAdapterRunErrorSummary: stmts.appendAdapterRunErrorSummary,
          indexRunId, adapterId, adapterRunId
        }),
        skipCoverage: (adapter, files, reason) => markAdapterCoverageSkipped(stmts.insertCoverage, indexRunId, adapter, files, reason),
        skipUnstarted: (groups, ids, failedId) => markUnstartedAdapterRunsSkipped(db, stmts.insertCoverage, indexRunId, groups, ids, failedId)
      };
    },
    publish(input) {
      if (!baseline) throw new Error('index publication has no prepared baseline');
      return persistCollectedIndexRun({ ...input, db, repoId, repoRoot, ...baseline });
    },
    failRun(indexRunId, message) {
      failRunningAdapterRuns(db, indexRunId, message);
      db.prepare("UPDATE index_runs SET status = ?, finished_at = datetime('now') WHERE id = ?").run('failed', indexRunId);
    },
    close: () => db.close()
  };
}