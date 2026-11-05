import { canPersistDiff, classifyChanges, normalizeContractPath, summarizeChanges } from "../../domain/contracts/contract-diff.js";
import type { AnalyzeContractDiffOptions, AnalyzeContractDiffResult } from "../../domain/contracts/contract-diff.js";
import type { ListWorkspacesOptions, ListWorkspacesResult, WorkspaceSummary } from "../../domain/workspace/catalog.js";
import type { ContractDiffPorts } from "./ports.js";

export function analyzeContractDiff(options: AnalyzeContractDiffOptions, ports: ContractDiffPorts): AnalyzeContractDiffResult {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  const contractPath = normalizeContractPath(options.contractPath);
  const workspace = ports.workspace(repoRoot, options.workspaceName);
  const warnings: string[] = [];
  const provider = ports.openProvider(workspace, options, contractPath, warnings);
  try {
    const baseline = provider.baseline;
    const previousEndpoints = provider.previousEndpoints();
    const current = ports.currentContract(baseline.repoPath, contractPath, baseline.contract.kind, warnings);
    const changes = classifyChanges(baseline, previousEndpoints, current, contractPath, warnings);
    const impactedConsumers = ports.projectImpacts(repoRoot, workspace.name, baseline, contractPath, changes, {
      readOnly: options.persist === false,
      persist: options.persist !== false && canPersistDiff(changes)
    });
    return {
      workspace,
      provider: {
        serviceName: baseline.serviceName,
        repoPath: baseline.repoPath
      },
      contract: {
        path: contractPath,
        id: baseline.contract.id,
        kind: baseline.contract.kind,
        ...(baseline.contract.schema_version !== null ? { schemaVersion: baseline.contract.schema_version } : {}),
        previousContentHash: baseline.contract.content_hash,
        ...(current.contentHash !== undefined ? { currentContentHash: current.contentHash } : {}),
        indexRunId: baseline.indexRunId
      },
      summary: summarizeChanges(changes, impactedConsumers),
      changes,
      impactedConsumers,
      warnings
    };
  } finally {
    provider.close();
  }
}

export function selectWorkspace(repoRoot: string, workspaceName: string | undefined, listWorkspaces: (options: ListWorkspacesOptions) => ListWorkspacesResult): WorkspaceSummary {
  const listed = listWorkspaces({
    repoRoot,
    ...(workspaceName !== undefined ? { name: workspaceName } : {})
  });
  const workspace = listed.workspaces[0];
  if (!workspace) {
    throw new Error(workspaceName === undefined ? 'workspace catalog is empty' : `workspace not found: ${workspaceName}`);
  }
  return workspace;
}
