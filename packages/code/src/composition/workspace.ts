import { existsSync } from "node:fs";
import * as useCases from "../application/workspace/catalog.js";
import type { WorkspacePorts } from "../application/workspace/ports.js";
import type { AddWorkspaceRepoOptions, DiscoverWorkspacePackagesOptions, InitWorkspaceOptions, ListWorkspacesOptions, SyncWorkspaceCatalogOptions } from "../domain/workspace/catalog.js";
import { normalizeRepoRoot } from "../infrastructure/filesystem/security.js";
import { ensureImpactDir } from "../infrastructure/sqlite/store.js";
import { listWorkspacesFromDatabase, persistWorkspaceCatalog, readWorkspace } from "../infrastructure/sqlite/workspace-catalog.js";
import { discoverWorkspacePackageMembers, loadWorkspaceCatalog, readWorkspacePackageDefinitions, resolveCatalogFile, resolveWorkspaceRepoPath, workspaceCatalogPath, writeCatalog } from "../infrastructure/workspace/catalog.js";

const ports: WorkspacePorts = {
  normalizeRoot: normalizeRepoRoot, catalogPath: workspaceCatalogPath, ensureDataDir: ensureImpactDir, exists: existsSync,
  loadCatalog: loadWorkspaceCatalog, writeCatalog, resolveRepoPath: resolveWorkspaceRepoPath, resolveCatalogFile,
  persistCatalog: persistWorkspaceCatalog, readWorkspace, listWorkspaces: listWorkspacesFromDatabase,
  discoverMembers(root) { const definitions = readWorkspacePackageDefinitions(root); return { definitions, discovered: discoverWorkspacePackageMembers(root, definitions) }; }
};
export const initWorkspace = (options: InitWorkspaceOptions) => useCases.initWorkspace(options, ports);
export const addWorkspaceRepo = (options: AddWorkspaceRepoOptions) => useCases.addWorkspaceRepo(options, ports);
export const discoverWorkspacePackages = (options: DiscoverWorkspacePackagesOptions) => useCases.discoverWorkspacePackages(options, ports);
export const syncWorkspaceCatalog = (options: SyncWorkspaceCatalogOptions) => useCases.syncWorkspaceCatalog(options, ports);
export const listWorkspaces = (options: ListWorkspacesOptions) => useCases.listWorkspaces(options, ports);
export * from '../domain/workspace/catalog.js';
export { loadWorkspaceCatalog,workspaceCatalogPath } from '../infrastructure/workspace/catalog.js';
