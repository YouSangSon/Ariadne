import path from "node:path";
import { isInsidePath, makeInitialCatalog, normalizeTrustPolicy, resolveCatalogRepos, toPortableRelativePath } from "../../domain/workspace/catalog.js";
import type { AddWorkspaceRepoOptions, DiscoverWorkspacePackagesOptions, DiscoverWorkspacePackagesResult, InitWorkspaceOptions, InitWorkspaceResult, ListWorkspacesOptions, ListWorkspacesResult, SyncWorkspaceCatalogOptions, SyncWorkspaceCatalogResult, WorkspaceCatalogRepo } from "../../domain/workspace/catalog.js";
import type { WorkspacePorts } from "./ports.js";

export function initWorkspace(options: InitWorkspaceOptions, ports: WorkspacePorts): InitWorkspaceResult {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  const catalogPath = ports.catalogPath(repoRoot);
  ports.ensureDataDir(repoRoot);

  const created = !ports.exists(catalogPath);
  if (created || options.force === true) {
    const catalog = makeInitialCatalog(repoRoot, catalogPath, options);
    ports.writeCatalog(catalogPath, catalog);
  }

  const synced = syncWorkspaceCatalog({ repoRoot, file: catalogPath }, ports);
  return { created, catalogPath, workspace: synced.workspace };
}

export function addWorkspaceRepo(options: AddWorkspaceRepoOptions, ports: WorkspacePorts): SyncWorkspaceCatalogResult {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  const catalogPath = ports.catalogPath(repoRoot);
  if (!ports.exists(catalogPath)) {
    initWorkspace({
      repoRoot,
      ...(options.workspaceName !== undefined ? { name: options.workspaceName } : {})
    }, ports);
  }

  const catalog = ports.loadCatalog({ repoRoot, file: catalogPath });
  if (options.workspaceName !== undefined && options.workspaceName !== catalog.name) {
    throw new Error(`workspace catalog is named '${catalog.name}', not '${options.workspaceName}'`);
  }

  const resolvedPath = ports.resolveRepoPath(repoRoot, options.localPath);
  const catalogLocalPath = toPortableRelativePath(path.dirname(catalogPath), resolvedPath);
  const existing = catalog.repos.find((repo) =>
    ports.resolveRepoPath(path.dirname(catalogPath), repo.localPath) === resolvedPath
  );
  const nextRepo: WorkspaceCatalogRepo = {
    localPath: catalogLocalPath,
    serviceName: options.serviceName ?? existing?.serviceName ?? path.basename(resolvedPath),
    remoteUrl: options.remoteUrl ?? existing?.remoteUrl ?? null,
    trustPolicy: normalizeTrustPolicy(options.trustPolicy ?? existing?.trustPolicy)
  };
  const repos = catalog.repos.filter((repo) =>
    ports.resolveRepoPath(path.dirname(catalogPath), repo.localPath) !== resolvedPath
  );
  repos.push(nextRepo);
  repos.sort((left, right) =>
    ports.resolveRepoPath(path.dirname(catalogPath), left.localPath)
      .localeCompare(ports.resolveRepoPath(path.dirname(catalogPath), right.localPath))
  );

  ports.writeCatalog(catalogPath, { ...catalog, repos });
  return syncWorkspaceCatalog({ repoRoot, file: catalogPath }, ports);
}

export function discoverWorkspacePackages(options: DiscoverWorkspacePackagesOptions, ports: WorkspacePorts): DiscoverWorkspacePackagesResult {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  const catalogPath = ports.catalogPath(repoRoot);
  if (!ports.exists(catalogPath)) {
    initWorkspace({
      repoRoot,
      ...(options.workspaceName !== undefined ? { name: options.workspaceName } : {})
    }, ports);
  }

  const catalog = ports.loadCatalog({ repoRoot, file: catalogPath });
  if (options.workspaceName !== undefined && options.workspaceName !== catalog.name) {
    throw new Error(`workspace catalog is named '${catalog.name}', not '${options.workspaceName}'`);
  }

  const { definitions: workspaceDefinitions, discovered } = ports.discoverMembers(repoRoot);
  if (discovered.length > 0) {
    const baseDir = path.dirname(catalogPath);
    const existingByPath = new Map<string, WorkspaceCatalogRepo>();
    for (const repo of catalog.repos) {
      existingByPath.set(ports.resolveRepoPath(baseDir, repo.localPath), repo);
    }
    const outsideRepos = catalog.repos.filter((repo) => {
      const resolvedPath = ports.resolveRepoPath(baseDir, repo.localPath);
      return !isInsidePath(repoRoot, resolvedPath);
    });
    const packageRepos = discovered.map((member) => {
      const existing = existingByPath.get(member.localPath);
      return {
        localPath: toPortableRelativePath(baseDir, member.localPath),
        serviceName: existing?.serviceName ?? member.serviceName,
        remoteUrl: existing?.remoteUrl ?? null,
        trustPolicy: normalizeTrustPolicy(existing?.trustPolicy)
      };
    });
    const repos = [...outsideRepos, ...packageRepos].sort((left, right) =>
      ports.resolveRepoPath(baseDir, left.localPath)
        .localeCompare(ports.resolveRepoPath(baseDir, right.localPath))
    );
    ports.writeCatalog(catalogPath, { ...catalog, repos });
  }

  const synced = syncWorkspaceCatalog({ repoRoot, file: catalogPath }, ports);
  return {
    catalogPath,
    workspace: synced.workspace,
    sources: workspaceDefinitions.sources,
    packages: discovered
  };
}

export function syncWorkspaceCatalog(options: SyncWorkspaceCatalogOptions, ports: WorkspacePorts): SyncWorkspaceCatalogResult {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  const catalogPath = options.file === undefined
    ? ports.catalogPath(repoRoot)
    : ports.resolveCatalogFile(repoRoot, options.file);
  const catalog = ports.loadCatalog({ repoRoot, file: catalogPath });
  const resolvedRepos = resolveCatalogRepos(catalogPath, catalog, ports.resolveRepoPath);

  ports.persistCatalog(repoRoot, catalog, resolvedRepos);

  return { catalogPath, workspace: ports.readWorkspace(repoRoot, catalog.name) };
}

export function listWorkspaces(options: ListWorkspacesOptions, ports: WorkspacePorts): ListWorkspacesResult {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  if (options.syncCatalog !== false && ports.exists(ports.catalogPath(repoRoot))) {
    syncWorkspaceCatalog({ repoRoot }, ports);
  }
  return ports.listWorkspaces(repoRoot, options.name);
}
