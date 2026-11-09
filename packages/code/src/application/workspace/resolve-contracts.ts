import type { WorkspaceSummary } from "../../domain/workspace/catalog.js";
import { LINK_KIND, compareLinks, dedupeLinks, matchConsumerFiles } from "../../domain/workspace/resolution.js";
import type { PersistableLink, ProviderEndpoint, ResolveCrossRepoContractsOptions, ResolveCrossRepoContractsResult } from "../../domain/workspace/resolution.js";
import type { IndexedRepoReader, WorkspaceResolverPorts } from "./resolver-ports.js";

export function resolveCrossRepoContracts(
  options: ResolveCrossRepoContractsOptions,
  ports: WorkspaceResolverPorts
): ResolveCrossRepoContractsResult {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  const workspace = selectWorkspace(repoRoot, options.workspaceName, options.syncCatalog, ports);
  const warnings: string[] = [];
  const warnedFiles = new Set<string>();
  const indexedRepos = ports.openRepos(workspace, warnings);
  try {
    const providerEndpoints = indexedRepos.flatMap((repo) => repo.providerEndpoints(warnings, warnedFiles));
    const links = resolveLinks(providerEndpoints, indexedRepos, warnings, warnedFiles);
    if (options.persist !== false) {
      ports.persistLinks(repoRoot, workspace.name, links);
    }
    return {
      workspace,
      links: links.map(({ evidenceSnippet: _evidenceSnippet, ...link }) => link),
      warnings
    };
  } finally {
    for (const repo of indexedRepos) {
      repo.close();
    }
  }
}

export function selectWorkspace(repoRoot: string, workspaceName: string | undefined, syncCatalog: boolean | undefined, ports: WorkspaceResolverPorts): WorkspaceSummary {
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

export function resolveLinks(
  providerEndpoints: ProviderEndpoint[],
  repos: IndexedRepoReader[],
  warnings: string[],
  warnedFiles: Set<string>
): PersistableLink[] {
  const links: PersistableLink[] = [];
  for (const endpoint of providerEndpoints) {
    for (const repo of repos) {
      if (repo.info.repoPath === endpoint.repoPath) continue;
      const matches = matchConsumerFiles(repo.info, endpoint, repo.consumerFiles(endpoint, warnings, warnedFiles));
      for (const match of matches) {
        links.push({
          kind: LINK_KIND,
          confidence: 'heuristic',
          consumerService: match.serviceName,
          consumerRepoPath: match.repoPath,
          consumerPath: match.filePath,
          providerService: endpoint.serviceName,
          providerRepoPath: endpoint.repoPath,
          providerContractPath: endpoint.contractPath,
          providerEndpointId: endpoint.endpointId,
          httpMethod: endpoint.httpMethod,
          routePath: endpoint.routePath,
          evidenceSnippet: match.snippet,
          ...(match.eventTopology !== undefined ? { eventTopology: match.eventTopology } : {})
        });
      }
    }
  }
  return dedupeLinks(links).sort(compareLinks);
}
