import type { ListWorkspacesOptions, ListWorkspacesResult, WorkspaceSummary } from "../../domain/workspace/catalog.js";
import type { IndexedRepoInfo, PersistableLink, ProviderEndpoint, ResolvedConsumerFile } from "../../domain/workspace/resolution.js";

export interface IndexedRepoReader {
  info: IndexedRepoInfo;
  providerEndpoints(warnings: string[], warnedFiles: Set<string>): ProviderEndpoint[];
  consumerFiles(endpoint: ProviderEndpoint, warnings: string[], warnedFiles: Set<string>): ResolvedConsumerFile[];
  close(): void;
}
export interface WorkspaceResolverPorts {
  normalizeRoot(root: string): string;
  listWorkspaces(options: ListWorkspacesOptions): ListWorkspacesResult;
  openRepos(workspace: WorkspaceSummary, warnings: string[]): IndexedRepoReader[];
  persistLinks(root: string, name: string, links: PersistableLink[]): void;
}
