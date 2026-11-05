import type { WorkspaceSummary } from "../../domain/workspace/catalog.js";
import { compareConsumerRows, orphanBreakingDiagnostics, recordToConsumer, staleDiagnostic } from "../../domain/workspace/links.js";
import type { CrossRepoConsumersOptions, CrossRepoConsumersResult, CrossRepoLinkVerifyOptions, CrossRepoLinkVerifyResult, CrossRepoProvidersOptions, CrossRepoProvidersResult } from "../../domain/workspace/links.js";
import { workspaceResources } from "../../domain/workspace/resources.js";
import type { WorkspaceLinksPorts } from "./links-ports.js";

export function verifyCrossRepoLinks(options: CrossRepoLinkVerifyOptions, ports: WorkspaceLinksPorts): CrossRepoLinkVerifyResult {
  const workspace = selectWorkspace(options.repoRoot, options.workspaceName, options.syncCatalog, ports);
  const loaded = ports.loadLinks(options.repoRoot, workspace.name);
  const malformedLinks = loaded.malformed;
  const staleWorkspaceLinks = loaded.records
    .filter((record) => !record.source.inWorkspace || !record.target.inWorkspace)
    .map((record) => staleDiagnostic(record));
  const orphanBreakingLinks = orphanBreakingDiagnostics(loaded.records);
  return {
    version: 0,
    workspace,
    summary: {
      passed: malformedLinks.length === 0 && staleWorkspaceLinks.length === 0 && orphanBreakingLinks.length === 0,
      totalLinks: loaded.rowsSeen,
      consumesLinks: loaded.records.filter((record) => record.kind === 'CONSUMES_HTTP_ENDPOINT').length,
      breakingLinks: loaded.records.filter((record) => record.kind === 'BREAKS_COMPATIBILITY_WITH').length,
      malformedLinks: malformedLinks.length,
      staleWorkspaceLinks: staleWorkspaceLinks.length,
      orphanBreakingLinks: orphanBreakingLinks.length
    },
    diagnostics: { malformedLinks, staleWorkspaceLinks, orphanBreakingLinks },
    resources: workspaceResources(workspace.name)
  };
}

export function consumersOf(options: CrossRepoConsumersOptions, ports: WorkspaceLinksPorts): CrossRepoConsumersResult {
  const workspace = selectWorkspace(options.repoRoot, options.workspaceName, options.syncCatalog, ports);
  const loaded = ports.loadLinks(options.repoRoot, workspace.name);
  const method = options.method?.toUpperCase();
  const consumers = loaded.records
    .filter((record) => record.kind === 'CONSUMES_HTTP_ENDPOINT')
    .filter((record) => record.target.serviceName === options.providerServiceName)
    .filter((record) => options.providerContractPath === undefined || record.target.contractPath === options.providerContractPath)
    .filter((record) => method === undefined || record.endpoint?.method.toUpperCase() === method)
    .filter((record) => options.routePath === undefined || record.endpoint?.path === options.routePath)
    .map(recordToConsumer)
    .sort(compareConsumerRows);
  return {
    version: 0,
    workspace,
    consumers,
    warnings: consumers.length === 0 ? ['no persisted cross-repo consumers matched; run parallax workspace resolve-contracts if links are stale'] : [],
    resources: workspaceResources(workspace.name)
  };
}

export function providersFor(options: CrossRepoProvidersOptions, ports: WorkspaceLinksPorts): CrossRepoProvidersResult {
  const workspace = selectWorkspace(options.repoRoot, options.workspaceName, options.syncCatalog, ports);
  const loaded = ports.loadLinks(options.repoRoot, workspace.name);
  const providers = loaded.records
    .filter((record) => record.kind === 'CONSUMES_HTTP_ENDPOINT')
    .filter((record) => record.source.serviceName === options.consumerServiceName)
    .filter((record) => options.consumerPath === undefined || record.source.path === options.consumerPath)
    .map(recordToConsumer)
    .sort(compareConsumerRows);
  return {
    version: 0,
    workspace,
    providers,
    warnings: providers.length === 0 ? ['no persisted cross-repo providers matched; run parallax workspace resolve-contracts if links are stale'] : [],
    resources: workspaceResources(workspace.name)
  };
}

export function selectWorkspace(repoRoot: string, workspaceName: string | undefined, syncCatalog: boolean | undefined, ports: WorkspaceLinksPorts): WorkspaceSummary {
  const listed = ports.listWorkspaces({
    repoRoot,
    ...(workspaceName !== undefined ? { name: workspaceName } : {}),
    ...(syncCatalog !== undefined ? { syncCatalog } : {})
  });
  const workspace = listed.workspaces[0];
  if (!workspace) {
    throw new Error(workspaceName === undefined ? 'workspace catalog is empty' : `workspace not found: ${workspaceName}`);
  }
  return workspace;
}
