import type { DiscoveredWorkspacePackageMember, ListWorkspacesResult, ResolvedCatalogRepo, SyncWorkspaceCatalogOptions, WorkspaceCatalog, WorkspacePackageDefinitions, WorkspaceSummary } from "../../domain/workspace/catalog.js";

export interface WorkspacePorts {
  normalizeRoot(root: string): string;
  catalogPath(root: string): string;
  ensureDataDir(root: string): unknown;
  exists(file: string): boolean;
  loadCatalog(options: SyncWorkspaceCatalogOptions): WorkspaceCatalog;
  writeCatalog(file: string, catalog: WorkspaceCatalog): void;
  resolveRepoPath(base: string, input: string): string;
  resolveCatalogFile(root: string, input: string): string;
  persistCatalog(root: string, catalog: WorkspaceCatalog, repos: ResolvedCatalogRepo[]): void;
  readWorkspace(root: string, name: string): WorkspaceSummary;
  listWorkspaces(root: string, name?: string): ListWorkspacesResult;
  discoverMembers(root: string): { definitions: WorkspacePackageDefinitions; discovered: DiscoveredWorkspacePackageMember[] };
}
