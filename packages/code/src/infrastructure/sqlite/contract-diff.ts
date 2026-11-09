import { realpathSync } from "node:fs";
import path from "node:path";
import type { ContractProviderSession } from "../../application/contracts/ports.js";
import { breakingLinkId, breakingLinkProvenance, BREAKS_LINK_KIND, CONSUMES_LINK_KIND, endpointDisplayForContractKind, impactedConsumersForLinks, objectAt, planBreakingLinks, stringAt } from "../../domain/contracts/contract-diff.js";
import type { AnalyzeContractDiffOptions, ConsumesLinkRow, ContractBaselineRow, ContractProviderBaseline, EndpointRow, ImpactedContractConsumer, WorkspaceRow } from "../../domain/contracts/contract-diff.js";
import { endpointKey, errorMessage, parseJsonObject } from "../../domain/contracts/diff/shared.js";
import type { ContractDiffChange, ContractEndpoint } from "../../domain/contracts/diff/types.js";
import type { Confidence } from "../../domain/model.js";
import type { WorkspaceSummary } from "../../domain/workspace/catalog.js";
import { normalizeRepoRoot } from "../filesystem/security.js";
import { ensureRepo, getRepoId, latestCompletedIndexRun, openDatabase } from "./store.js";

export type { AnalyzeContractDiffOptions,AnalyzeContractDiffResult,ContractDiffContract,ContractDiffProvider,EventTopologyProvenance,EventTopologySummary,ImpactedContractConsumer } from "../../domain/contracts/contract-diff.js";
export type {
ContractDiffChange,
ContractDiffChangeKind,
ContractDiffClassification
} from '../../domain/contracts/diff/types.js';

type IndexedProvider = {
  repoPath: string;
  serviceName: string;
  db: ReturnType<typeof openDatabase>;
  repoId: number;
  indexRunId: number;
  contract: ContractBaselineRow;
};


function selectProvider(
  workspace: WorkspaceSummary,
  options: AnalyzeContractDiffOptions,
  contractPath: string,
  warnings: string[]
): IndexedProvider {
  const repoRoot = normalizeRepoRoot(options.repoRoot);
  const requestedProviderPath = options.providerRepoPath === undefined
    ? undefined
    : realpathSync(
      path.isAbsolute(options.providerRepoPath)
        ? path.resolve(options.providerRepoPath)
        : path.resolve(repoRoot, options.providerRepoPath)
    );
  const candidates: IndexedProvider[] = [];
  for (const repo of workspace.repos) {
    let db: ReturnType<typeof openDatabase> | undefined;
    try {
      const repoPath = realpathSync(repo.localPath);
      if (requestedProviderPath !== undefined && repoPath !== requestedProviderPath) continue;
      if (options.providerServiceName !== undefined && repo.serviceName !== options.providerServiceName) continue;
      db = openDatabase(repoPath, { readOnly: true });
      const repoId = getRepoId(db, repoPath);
      const indexRunId = latestCompletedIndexRun(db, repoId);
      const contract = loadContractBaseline(db, repoId, indexRunId, contractPath);
      if (!contract) {
        db.close();
        db = undefined;
        continue;
      }
      candidates.push({
        repoPath,
        serviceName: repo.serviceName,
        db,
        repoId,
        indexRunId,
        contract
      });
      db = undefined;
    } catch (error) {
      db?.close();
      warnings.push(`workspace provider skipped: ${repo.localPath}: ${errorMessage(error)}`);
    }
  }

  if (candidates.length === 0) {
    throw new Error(`indexed contract not found in workspace: ${contractPath}`);
  }
  if (candidates.length > 1) {
    for (const candidate of candidates) candidate.db.close();
    throw new Error(`multiple workspace providers contain ${contractPath}; pass --provider or --provider-path`);
  }
  return candidates[0]!;
}

function loadContractBaseline(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  contractPath: string
): ContractBaselineRow | undefined {
  return db
    .prepare(
      `SELECT c.id, c.kind, c.service_name, c.path, v.schema_version, v.content_hash, v.compatibility_json
       FROM contracts c
       INNER JOIN contract_versions v
          ON v.contract_id = c.id
         AND v.index_run_id = ?
       WHERE c.repo_id = ?
         AND c.path = ?`
    )
    .get(indexRunId, repoId, contractPath) as ContractBaselineRow | undefined;
}

function loadPreviousEndpoints(provider: IndexedProvider): ContractEndpoint[] {
  const rows = provider.db
    .prepare(
      `SELECT target.id AS endpoint_id, target.display_name AS endpoint_display_name
       FROM relations relation
       INNER JOIN entities source
          ON source.id = relation.source_entity_id
         AND source.repo_id = relation.repo_id
       INNER JOIN entities target
          ON target.id = relation.target_entity_id
         AND target.repo_id = relation.repo_id
       WHERE relation.repo_id = ?
         AND relation.index_run_id = ?
         AND relation.kind = 'DECLARES'
         AND source.kind = 'contract'
         AND source.path = ?
         AND target.kind = 'endpoint'
       ORDER BY target.display_name, target.id`
    )
    .all(provider.repoId, provider.indexRunId, provider.contract.path) as EndpointRow[];
  return rows.flatMap((row) => {
    const parsed = endpointDisplayForContractKind(provider.contract.kind, row.endpoint_display_name);
    if (!parsed) return [];
    return [{
      endpointId: row.endpoint_id,
      httpMethod: parsed.method,
      routePath: parsed.path
    }];
  });
}

function impactedConsumersForChanges(
  db: ReturnType<typeof openDatabase>,
  workspaceId: number,
  provider: ContractProviderBaseline,
  contractPath: string,
  changes: ContractDiffChange[]
): ImpactedContractConsumer[] {
  const breakingEndpointKeys = new Set(
    changes
      .filter((change) => change.classification === 'breaking' && change.httpMethod && change.routePath)
      .map((change) => endpointKey(change.httpMethod!, change.routePath!))
  );
  if (breakingEndpointKeys.size === 0) return [];

  const rows = db
    .prepare(
      `SELECT link.provenance AS provenance
       FROM cross_repo_links link
       INNER JOIN workspace_repos source_member
          ON source_member.workspace_id = link.workspace_id
         AND source_member.repo_id = link.source_repo_id
       INNER JOIN workspace_repos target_member
          ON target_member.workspace_id = link.workspace_id
         AND target_member.repo_id = link.target_repo_id
       WHERE link.workspace_id = ?
         AND link.kind = ?
       ORDER BY link.id`
    )
    .all(workspaceId, CONSUMES_LINK_KIND) as ConsumesLinkRow[];
  return impactedConsumersForLinks(rows, provider, contractPath, breakingEndpointKeys);
}

function persistBreakingLinks(
  db: ReturnType<typeof openDatabase>,
  workspaceId: number,
  provider: ContractProviderBaseline,
  contractPath: string,
  impactedConsumers: ImpactedContractConsumer[],
  changes: ContractDiffChange[]
): void {
  const links = planBreakingLinks(impactedConsumers, changes);

  db.exec('BEGIN');
  try {
    deleteExistingBreakingLinksForContract(db, workspaceId, provider, contractPath);
    const insert = db.prepare(
      `INSERT OR REPLACE INTO cross_repo_links (
         id, workspace_id, source_repo_id, target_repo_id, source_entity_id,
         target_entity_id, kind, confidence, provenance, index_run_id
       )
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL)`
    );
    for (const link of links) {
      const sourceRepoId = ensureRepo(db, link.consumer.consumerRepoPath);
      const targetRepoId = ensureRepo(db, provider.repoPath);
      insert.run(
        breakingLinkId(workspaceId, link),
        workspaceId,
        sourceRepoId,
        targetRepoId,
        BREAKS_LINK_KIND,
        'heuristic' satisfies Confidence,
        breakingLinkProvenance(link)
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function deleteExistingBreakingLinksForContract(
  db: ReturnType<typeof openDatabase>,
  workspaceId: number,
  provider: ContractProviderBaseline,
  contractPath: string
): void {
  const rows = db
    .prepare(
      `SELECT id, provenance
       FROM cross_repo_links
       WHERE workspace_id = ?
         AND kind = ?`
    )
    .all(workspaceId, BREAKS_LINK_KIND) as Array<{ id: string; provenance: string }>;
  const deleteRow = db.prepare('DELETE FROM cross_repo_links WHERE id = ?');
  for (const row of rows) {
    const provenance = parseJsonObject(row.provenance);
    const providerObject = objectAt(provenance, 'provider');
    if (
      stringAt(providerObject, 'repoPath') === provider.repoPath &&
      stringAt(providerObject, 'contractPath') === contractPath
    ) {
      deleteRow.run(row.id);
    }
  }
}

function readWorkspaceRow(db: ReturnType<typeof openDatabase>, workspaceName: string): WorkspaceRow {
  const workspace = db
    .prepare('SELECT id, name FROM workspaces WHERE name = ?')
    .get(workspaceName) as WorkspaceRow | undefined;
  if (!workspace) {
    throw new Error(`workspace not found after sync: ${workspaceName}`);
  }
  return workspace;
}

export function openContractProvider(workspace: WorkspaceSummary, options: AnalyzeContractDiffOptions, contractPath: string, warnings: string[]): ContractProviderSession {
  const provider = selectProvider(workspace, options, contractPath, warnings);
  const { db: _db, ...baseline } = provider;
  return { baseline, previousEndpoints: () => loadPreviousEndpoints(provider), close: () => provider.db.close() };
}

export function projectContractImpacts(repoRoot: string, workspaceName: string, provider: ContractProviderBaseline, contractPath: string, changes: ContractDiffChange[], options: { readOnly: boolean; persist: boolean }): ImpactedContractConsumer[] {
  const db = openDatabase(repoRoot, { readOnly: options.readOnly });
  try {
    const workspace = readWorkspaceRow(db, workspaceName);
    const consumers = impactedConsumersForChanges(db, workspace.id, provider, contractPath, changes);
    if (options.persist) persistBreakingLinks(db, workspace.id, provider, contractPath, consumers, changes);
    return consumers;
  } finally { db.close(); }
}