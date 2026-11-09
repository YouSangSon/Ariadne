import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { DATA_DIR } from "../../domain/branding.js";
import { IGNORED_DISCOVERY_DIRS, expandBracePatterns, isRecord, parseWorkspaceCatalog, stableStringify, toPortableRelativePath, workspaceGlobMatches, workspacePatternsFromPackageJson } from "../../domain/workspace/catalog.js";
import type { DiscoveredWorkspacePackageMember, PackageManifestCandidate, SyncWorkspaceCatalogOptions, WorkspaceCatalog, WorkspacePackageDefinitions } from "../../domain/workspace/catalog.js";
import { normalizeRepoRoot } from "../filesystem/security.js";
import { impactDir } from "../sqlite/store.js";

export function workspaceCatalogPath(repoRoot: string): string {
  return path.join(impactDir(normalizeRepoRoot(repoRoot)), 'workspace.json');
}

export function loadWorkspaceCatalog(options: SyncWorkspaceCatalogOptions): WorkspaceCatalog {
  const repoRoot = normalizeRepoRoot(options.repoRoot);
  const catalogPath = options.file === undefined
    ? workspaceCatalogPath(repoRoot)
    : resolveCatalogFile(repoRoot, options.file);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`workspace catalog could not be read: ${detail}`);
  }
  return parseWorkspaceCatalog(raw);
}

export function writeCatalog(catalogPath: string, catalog: WorkspaceCatalog): void {
  const dir = path.dirname(catalogPath);
  mkdirSync(dir, { recursive: true });
  assertCatalogIsRegularPath(catalogPath);
  const tempPath = path.join(dir, `.workspace.json.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tempPath, `${stableStringify(catalog, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    assertCatalogIsRegularPath(catalogPath);
    renameSync(tempPath, catalogPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

export function resolveCatalogFile(repoRoot: string, inputPath: string): string {
  if (!inputPath || inputPath.includes('\0')) {
    throw new Error('invalid workspace catalog path');
  }
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(repoRoot, inputPath);
  if (candidate !== workspaceCatalogPath(repoRoot)) {
    throw new Error(`workspace catalog file must be ${DATA_DIR}/workspace.json`);
  }
  assertCatalogIsRegularPath(candidate);
  const resolved = realpathSync(candidate);
  const relative = path.relative(repoRoot, resolved);
  if (relative !== '' && (relative.startsWith('..') || path.isAbsolute(relative))) {
    throw new Error('workspace catalog file must resolve inside repo root');
  }
  return resolved;
}

function assertCatalogIsRegularPath(catalogPath: string): void {
  if (!existsSync(catalogPath)) return;
  const stat = lstatSync(catalogPath);
  if (stat.isSymbolicLink()) {
    throw new Error('workspace catalog must not be a symlink');
  }
  if (!stat.isFile()) {
    throw new Error('workspace catalog path must be a regular file');
  }
}

export function resolveWorkspaceRepoPath(baseDir: string, inputPath: string): string {
  if (!inputPath || inputPath.includes('\0')) {
    throw new Error('invalid workspace repo localPath');
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(inputPath)) {
    throw new Error('workspace repo localPath must not be URL-like; use a local filesystem path');
  }
  if (/^[^@\s]+@[^:\s]+:.+/.test(inputPath)) {
    throw new Error('workspace repo localPath must not be git-style; use a local filesystem path');
  }

  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(baseDir, inputPath);
  let resolved: string;
  try {
    resolved = realpathSync(candidate);
  } catch {
    throw new Error(`workspace repo path does not exist or is not accessible: ${inputPath}`);
  }
  if (!lstatSync(resolved).isDirectory()) {
    throw new Error(`workspace repo path is not a directory: ${inputPath}`);
  }
  return resolved;
}

export function readWorkspacePackageDefinitions(repoRoot: string): WorkspacePackageDefinitions {
  const sources: string[] = [];
  const patterns: string[] = [];

  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (existsSync(packageJsonPath)) {
    const packageJson = parseJsonObject(packageJsonPath, 'package.json');
    const npmPatterns = workspacePatternsFromPackageJson(packageJson.workspaces);
    if (npmPatterns.length > 0) {
      sources.push('package.json');
      patterns.push(...npmPatterns);
    }
  }

  const pnpmWorkspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');
  if (existsSync(pnpmWorkspacePath)) {
    const parsed = parseYaml(readFileSync(pnpmWorkspacePath, 'utf8')) as unknown;
    if (!isRecord(parsed)) {
      throw new Error('pnpm-workspace.yaml must be a YAML object');
    }
    if (parsed.packages !== undefined) {
      if (!Array.isArray(parsed.packages) || parsed.packages.some((item) => typeof item !== 'string')) {
        throw new Error('pnpm-workspace.yaml packages must be an array of strings');
      }
      sources.push('pnpm-workspace.yaml');
      patterns.push(...parsed.packages.map((item) => item.trim()).filter(Boolean));
    }
  }

  const nxJsonPath = path.join(repoRoot, 'nx.json');
  const includeNxProjects = existsSync(nxJsonPath);
  if (includeNxProjects) {
    parseJsonObject(nxJsonPath, 'nx.json');
    sources.push('nx.json');
  }

  return { sources, patterns, includeNxProjects };
}

export function discoverWorkspacePackageMembers(
  repoRoot: string,
  definitions: WorkspacePackageDefinitions
): DiscoveredWorkspacePackageMember[] {
  const members = new Map<string, DiscoveredWorkspacePackageMember>();
  for (const member of discoverPackageManifestMembers(repoRoot, definitions.patterns)) {
    members.set(member.localPath, member);
  }
  if (definitions.includeNxProjects) {
    for (const member of discoverNxProjectMembers(repoRoot)) {
      if (!members.has(member.localPath)) {
        members.set(member.localPath, member);
      }
    }
  }
  return [...members.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function discoverPackageManifestMembers(
  repoRoot: string,
  patterns: readonly string[]
): DiscoveredWorkspacePackageMember[] {
  if (patterns.length === 0) return [];
  const expandedPatterns = patterns.flatMap((pattern) => expandBracePatterns(pattern));
  const includePatterns = expandedPatterns.filter((pattern) => !pattern.startsWith('!'));
  const excludePatterns = expandedPatterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => pattern.slice(1));
  const candidates = scanPackageManifestDirs(repoRoot);
  const members = candidates
    .filter((candidate) => candidate.relativePath !== '.')
    .filter((candidate) => includePatterns.some((pattern) => workspaceGlobMatches(pattern, candidate.relativePath)))
    .filter((candidate) => !excludePatterns.some((pattern) => workspaceGlobMatches(pattern, candidate.relativePath)))
    .map((candidate) => {
      const manifest = parseJsonObject(candidate.manifestPath, candidate.relativeManifestPath);
      const packageName = typeof manifest.name === 'string' && manifest.name.trim() !== ''
        ? manifest.name.trim()
        : undefined;
      return {
        localPath: candidate.localPath,
        relativePath: candidate.relativePath,
        manifestPath: candidate.relativeManifestPath,
        serviceName: packageName ?? path.basename(candidate.localPath)
      };
    });
  members.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return members;
}

function discoverNxProjectMembers(repoRoot: string): DiscoveredWorkspacePackageMember[] {
  const candidates = scanNxProjectConfigDirs(repoRoot);
  const members = candidates
    .filter((candidate) => candidate.relativePath !== '.')
    .map((candidate) => {
      const manifest = parseJsonObject(candidate.manifestPath, candidate.relativeManifestPath);
      const configuredName = typeof manifest.name === 'string' && manifest.name.trim() !== ''
        ? manifest.name.trim()
        : undefined;
      return {
        localPath: candidate.localPath,
        relativePath: candidate.relativePath,
        manifestPath: candidate.relativeManifestPath,
        serviceName: configuredName ?? path.basename(candidate.localPath)
      };
    });
  members.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return members;
}

function scanPackageManifestDirs(repoRoot: string): PackageManifestCandidate[] {
  const candidates: PackageManifestCandidate[] = [];
  const visit = (dir: string): void => {
    const relativePath = toPortableRelativePath(repoRoot, dir);
    const manifestPath = path.join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      candidates.push({
        localPath: realpathSync(dir),
        relativePath,
        manifestPath,
        relativeManifestPath: relativePath === '.' ? 'package.json' : `${relativePath}/package.json`
      });
    }

    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (IGNORED_DISCOVERY_DIRS.has(entry.name)) continue;
      visit(path.join(dir, entry.name));
    }
  };
  visit(repoRoot);
  return candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function scanNxProjectConfigDirs(repoRoot: string): PackageManifestCandidate[] {
  const candidates: PackageManifestCandidate[] = [];
  const visit = (dir: string): void => {
    const relativePath = toPortableRelativePath(repoRoot, dir);
    const projectJsonPath = path.join(dir, 'project.json');
    if (existsSync(projectJsonPath)) {
      candidates.push({
        localPath: realpathSync(dir),
        relativePath,
        manifestPath: projectJsonPath,
        relativeManifestPath: relativePath === '.' ? 'project.json' : `${relativePath}/project.json`
      });
    } else {
      const packageJsonPath = path.join(dir, 'package.json');
      if (existsSync(packageJsonPath)) {
        let packageJson: Record<string, unknown> | undefined;
        try {
          packageJson = parseJsonObject(packageJsonPath, relativePath === '.' ? 'package.json' : `${relativePath}/package.json`);
        } catch {
          packageJson = undefined;
        }
        if (packageJson !== undefined && isRecord(packageJson.nx)) {
          candidates.push({
            localPath: realpathSync(dir),
            relativePath,
            manifestPath: packageJsonPath,
            relativeManifestPath: relativePath === '.' ? 'package.json' : `${relativePath}/package.json`
          });
        }
      }
    }

    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (IGNORED_DISCOVERY_DIRS.has(entry.name)) continue;
      visit(path.join(dir, entry.name));
    }
  };
  visit(repoRoot);
  return candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function parseJsonObject(filePath: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (!isRecord(parsed)) {
      throw new Error('must be a JSON object');
    }
    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} parse failed: ${detail}`);
  }
}
export type { AddWorkspaceRepoOptions,DiscoverWorkspacePackagesOptions,DiscoverWorkspacePackagesResult,DiscoveredWorkspacePackage,InitWorkspaceOptions,InitWorkspaceResult,ListWorkspacesOptions,ListWorkspacesResult,SyncWorkspaceCatalogOptions,SyncWorkspaceCatalogResult,WorkspaceCatalog,WorkspaceCatalogRepo,WorkspaceRepoSummary,WorkspaceSummary,WorkspaceTrustPolicy } from "../../domain/workspace/catalog.js";
