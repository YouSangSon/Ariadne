import { existsSync } from "node:fs";
import path from "node:path";

export function packageRootResolver(repoRoot: string): (relativePath: string) => string {
  const cache = new Map<string, string>();
  return (relativePath: string): string => {
    const normalized = relativePath.split('\\').join('/');
    const cached = cache.get(normalized);
    if (cached !== undefined) return cached;
    const resolved = nearestPackageRoot(repoRoot, normalized);
    cache.set(normalized, resolved);
    return resolved;
  };
}

export function nearestPackageRoot(repoRoot: string, relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.split('\\').join('/'));
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return '.';
  const dirname = normalized.endsWith('/package.json')
    ? path.posix.dirname(normalized)
    : path.posix.dirname(normalized);
  const parts = dirname === '.' ? [] : dirname.split('/').filter(Boolean);
  for (let length = parts.length; length >= 0; length -= 1) {
    const packageRoot = parts.slice(0, length).join('/') || '.';
    const manifestPath = safeRepoRelativePath(repoRoot, packageRoot === '.' ? 'package.json' : `${packageRoot}/package.json`);
    if (manifestPath && existsSync(manifestPath)) return packageRoot;
  }
  return '.';
}

export function safeRepoRelativePath(repoRoot: string, relativePath: string): string | undefined {
  const absolute = path.resolve(repoRoot, ...relativePath.split('/'));
  const relative = path.relative(repoRoot, absolute);
  if (relative !== '' && (relative.startsWith('..') || path.isAbsolute(relative))) return undefined;
  return absolute;
}