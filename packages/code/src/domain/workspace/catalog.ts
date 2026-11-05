import path from "node:path";
import { DATA_DIR } from "../branding.js";

export type WorkspaceTrustPolicy = {
  readOnly: boolean;
  [key: string]: unknown;
};

export type WorkspaceCatalogRepo = {
  localPath: string;
  serviceName?: string;
  remoteUrl?: string | null;
  trustPolicy?: WorkspaceTrustPolicy;
};

export type WorkspaceCatalog = {
  schemaVersion: 1;
  name: string;
  repos: WorkspaceCatalogRepo[];
};

export type WorkspaceRepoSummary = {
  localPath: string;
  serviceName: string;
  remoteUrl: string | null;
  trustPolicy: WorkspaceTrustPolicy;
};

export type WorkspaceSummary = {
  name: string;
  repos: WorkspaceRepoSummary[];
};

export type InitWorkspaceOptions = {
  repoRoot: string;
  name?: string;
  serviceName?: string;
  force?: boolean;
};

export type InitWorkspaceResult = {
  created: boolean;
  catalogPath: string;
  workspace: WorkspaceSummary;
};

export type AddWorkspaceRepoOptions = {
  repoRoot: string;
  workspaceName?: string;
  localPath: string;
  serviceName?: string;
  remoteUrl?: string | null;
  trustPolicy?: WorkspaceTrustPolicy;
};

export type DiscoverWorkspacePackagesOptions = {
  repoRoot: string;
  workspaceName?: string;
};

export type DiscoveredWorkspacePackage = {
  localPath: string;
  relativePath: string;
  manifestPath: string;
  serviceName: string;
};

export type DiscoverWorkspacePackagesResult = {
  catalogPath: string;
  workspace: WorkspaceSummary;
  sources: string[];
  packages: DiscoveredWorkspacePackage[];
};

export type SyncWorkspaceCatalogOptions = {
  repoRoot: string;
  file?: string;
};

export type SyncWorkspaceCatalogResult = {
  catalogPath: string;
  workspace: WorkspaceSummary;
};

export type ListWorkspacesOptions = {
  repoRoot: string;
  name?: string;
  syncCatalog?: boolean;
};

export type ListWorkspacesResult = {
  workspaces: WorkspaceSummary[];
};

export type ResolvedCatalogRepo = {
  localPath: string;
  serviceName: string;
  remoteUrl: string | null;
  trustPolicy: WorkspaceTrustPolicy;
};

export const WORKSPACE_SCHEMA_VERSION = 1;

export const DEFAULT_TRUST_POLICY: WorkspaceTrustPolicy = { readOnly: true };

export const IGNORED_DISCOVERY_DIRS = new Set([
  '.git',
  DATA_DIR,
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.nx',
  '.turbo',
  '.yarn',
  '.pnpm-store'
]);

export function makeInitialCatalog(repoRoot: string, catalogPath: string, options: InitWorkspaceOptions): WorkspaceCatalog {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    name: options.name ?? path.basename(repoRoot),
    repos: [
      {
        localPath: toPortableRelativePath(path.dirname(catalogPath), repoRoot),
        serviceName: options.serviceName ?? path.basename(repoRoot),
        remoteUrl: null,
        trustPolicy: { ...DEFAULT_TRUST_POLICY }
      }
    ]
  };
}

export function parseWorkspaceCatalog(raw: unknown): WorkspaceCatalog {
  if (!isRecord(raw)) {
    throw new Error('workspace catalog must be a JSON object');
  }
  if (raw.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new Error(`workspace catalog schemaVersion must be ${WORKSPACE_SCHEMA_VERSION}`);
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new Error('workspace catalog name must be a non-empty string');
  }
  if (!Array.isArray(raw.repos)) {
    throw new Error('workspace catalog repos must be an array');
  }
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    name: raw.name.trim(),
    repos: raw.repos.map((repo, index) => parseCatalogRepo(repo, index))
  };
}

export function parseCatalogRepo(raw: unknown, index: number): WorkspaceCatalogRepo {
  if (!isRecord(raw)) {
    throw new Error(`workspace catalog repos[${index}] must be an object`);
  }
  if (typeof raw.localPath !== 'string') {
    throw new Error(`workspace catalog repos[${index}].localPath must be a string`);
  }
  const repo: WorkspaceCatalogRepo = { localPath: raw.localPath };
  if (raw.serviceName !== undefined) {
    if (typeof raw.serviceName !== 'string' || raw.serviceName.trim() === '') {
      throw new Error(`workspace catalog repos[${index}].serviceName must be a non-empty string`);
    }
    repo.serviceName = raw.serviceName.trim();
  }
  if (raw.remoteUrl !== undefined) {
    if (raw.remoteUrl !== null && typeof raw.remoteUrl !== 'string') {
      throw new Error(`workspace catalog repos[${index}].remoteUrl must be a string or null`);
    }
    repo.remoteUrl = raw.remoteUrl;
  }
  if (raw.trustPolicy !== undefined) {
    repo.trustPolicy = normalizeTrustPolicy(raw.trustPolicy);
  }
  return repo;
}

export function resolveCatalogRepos(catalogPath: string, catalog: WorkspaceCatalog, resolveWorkspaceRepoPath: (baseDir: string, input: string) => string): ResolvedCatalogRepo[] {
  const baseDir = path.dirname(catalogPath);
  const seen = new Set<string>();
  return catalog.repos.map((repo, index) => {
    const localPath = resolveWorkspaceRepoPath(baseDir, repo.localPath);
    if (seen.has(localPath)) {
      throw new Error(`duplicate resolved local path in workspace catalog: ${repo.localPath}`);
    }
    seen.add(localPath);
    return {
      localPath,
      serviceName: repo.serviceName ?? (path.basename(localPath) || `repo-${index + 1}`),
      remoteUrl: repo.remoteUrl ?? null,
      trustPolicy: normalizeTrustPolicy(repo.trustPolicy)
    };
  });
}

export function normalizeTrustPolicy(raw: unknown): WorkspaceTrustPolicy {
  if (raw === undefined) return { ...DEFAULT_TRUST_POLICY };
  if (!isRecord(raw)) {
    throw new Error('workspace repo trustPolicy must be an object');
  }
  return { ...sortRecord(raw), readOnly: raw.readOnly === false ? false : true } as WorkspaceTrustPolicy;
}

export type WorkspacePackageDefinitions = {
  sources: string[];
  patterns: string[];
  includeNxProjects: boolean;
};

export type DiscoveredWorkspacePackageMember = DiscoveredWorkspacePackage;

export function workspacePatternsFromPackageJson(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) {
    if (raw.some((item) => typeof item !== 'string')) {
      throw new Error('package.json workspaces must be an array of strings');
    }
    return raw.map((item) => item.trim()).filter(Boolean);
  }
  if (isRecord(raw) && raw.packages !== undefined) {
    if (!Array.isArray(raw.packages) || raw.packages.some((item) => typeof item !== 'string')) {
      throw new Error('package.json workspaces.packages must be an array of strings');
    }
    return raw.packages.map((item) => item.trim()).filter(Boolean);
  }
  throw new Error('package.json workspaces must be an array or an object with packages');
}

export type PackageManifestCandidate = {
  localPath: string;
  relativePath: string;
  manifestPath: string;
  relativeManifestPath: string;
};

export function expandBracePatterns(pattern: string): string[] {
  const start = pattern.indexOf('{');
  const end = pattern.indexOf('}', start + 1);
  if (start < 0 || end < 0) return [pattern];
  const before = pattern.slice(0, start);
  const after = pattern.slice(end + 1);
  return pattern
    .slice(start + 1, end)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => expandBracePatterns(`${before}${item}${after}`));
}

export function workspaceGlobMatches(rawPattern: string, candidate: string): boolean {
  const pattern = normalizeWorkspacePattern(rawPattern);
  if (pattern === undefined) return false;
  const patternSegments = pattern === '.' ? [] : pattern.split('/');
  const candidateSegments = candidate === '.' ? [] : candidate.split('/');
  return matchGlobSegments(patternSegments, candidateSegments, 0, 0);
}

export function normalizeWorkspacePattern(rawPattern: string): string | undefined {
  const pattern = rawPattern.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!pattern || pattern.includes('\0')) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pattern)) return undefined;
  if (path.posix.isAbsolute(pattern)) return undefined;
  const withoutDot = pattern.startsWith('./') ? pattern.slice(2) : pattern;
  if (withoutDot === '') return '.';
  return withoutDot.endsWith('/package.json')
    ? withoutDot.slice(0, -'/package.json'.length) || '.'
    : withoutDot;
}

export function matchGlobSegments(
  patternSegments: readonly string[],
  candidateSegments: readonly string[],
  patternIndex: number,
  candidateIndex: number
): boolean {
  if (patternIndex === patternSegments.length) {
    return candidateIndex === candidateSegments.length;
  }
  const segment = patternSegments[patternIndex]!;
  if (segment === '**') {
    for (let nextIndex = candidateIndex; nextIndex <= candidateSegments.length; nextIndex++) {
      if (matchGlobSegments(patternSegments, candidateSegments, patternIndex + 1, nextIndex)) return true;
    }
    return false;
  }
  if (candidateIndex >= candidateSegments.length) return false;
  return segmentGlobMatches(segment, candidateSegments[candidateIndex]!)
    && matchGlobSegments(patternSegments, candidateSegments, patternIndex + 1, candidateIndex + 1);
}

export function segmentGlobMatches(pattern: string, candidate: string): boolean {
  let regex = '^';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === '*') {
      regex += '[^/]*';
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += escapeRegExp(char);
    }
  }
  regex += '$';
  return new RegExp(regex).test(candidate);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

export function parseTrustPolicy(raw: string): WorkspaceTrustPolicy {
  try {
    return normalizeTrustPolicy(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_TRUST_POLICY };
  }
}

export function isInsidePath(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function toPortableRelativePath(fromDir: string, targetPath: string): string {
  const relative = path.relative(fromDir, targetPath);
  return (relative === '' ? '.' : relative).split(path.sep).join('/');
}

export function stableStringify(value: unknown, space?: number): string {
  return JSON.stringify(sortJson(value), null, space);
}

export function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson(value[key]);
  }
  return sorted;
}

export function sortRecord(value: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return sorted;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}