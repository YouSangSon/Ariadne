import { realpathSync } from "node:fs";
import path from "node:path";

export function normalizeRepoRoot(repoRoot: string): string {
  return realpathSync(path.resolve(repoRoot));
}

export function resolveInsideRoot(root: string, inputPath: string): string {
  if (!inputPath || inputPath.includes('\0')) {
    throw new Error('invalid path');
  }

  const rootReal = normalizeRepoRoot(root);
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(rootReal, inputPath);
  const lexicalRelative = path.relative(rootReal, candidate);
  if (lexicalRelative !== '' && (lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative))) {
    throw new Error(`path resolves outside repo root: ${inputPath}`);
  }
  const resolved = realpathSync(candidate);
  const relative = path.relative(rootReal, resolved);

  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolved;
  }

  throw new Error(`path resolves outside repo root: ${inputPath}`);
}

export function toRelativePath(repoRoot: string, absolutePath: string): string {
  return path.relative(normalizeRepoRoot(repoRoot), realpathSync(absolutePath)).split(path.sep).join('/');
}
export { redactSecrets } from "../../domain/security/redaction.js";
