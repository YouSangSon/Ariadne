import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { MAX_REFERENCED_FILES, MAX_SESSION_BYTES, sessionPathCandidates } from "../../domain/local-memory/session.js";
import type { ResolvedSessionFile, SessionImportSource } from "../../domain/local-memory/session.js";
import { resolveInsideRoot, toRelativePath } from "./security.js";

export function resolveSessionFile(repoRoot: string, inputFile: string): ResolvedSessionFile {
  if (!inputFile || inputFile.includes('\0')) {
    throw new Error('invalid session file path');
  }
  if (/[*?[\]{}]/.test(inputFile)) {
    throw new Error('session file path must name one file; glob patterns are not supported');
  }

  let absolutePath: string;
  let sourceKind: SessionImportSource['kind'];
  if (path.isAbsolute(inputFile)) {
    absolutePath = realpathSync(inputFile);
    sourceKind = pathInside(repoRoot, absolutePath) ? 'repo' : 'external-explicit';
  } else {
    absolutePath = resolveInsideRoot(repoRoot, inputFile);
    sourceKind = 'repo';
  }

  const stat = statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error('session file must be a regular file');
  }
  if (stat.size > MAX_SESSION_BYTES) {
    throw new Error(`session file exceeds ${MAX_SESSION_BYTES} bytes`);
  }

  const sourcePath = sourceKind === 'repo' ? toRelativePath(repoRoot, absolutePath) : '[external-session-log]';
  return {
    absolutePath,
    source: {
      kind: sourceKind,
      path: sourcePath,
      bytes: stat.size
    }
  };
}

function pathInside(repoRoot: string, absolutePath: string): boolean {
  const relative = path.relative(repoRoot, absolutePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function extractReferencedRepoFiles(repoRoot: string, text: string): string[] {
  const candidates = new Set<string>();
  for (const candidate of sessionPathCandidates(text)) {
    try {
      const absolute = resolveInsideRoot(repoRoot, candidate);
      if (!statSync(absolute).isFile()) continue;
      candidates.add(toRelativePath(repoRoot, absolute));
    } catch {
      // Ignore non-repo paths and path-looking strings that do not exist.
    }
    if (candidates.size >= MAX_REFERENCED_FILES) break;
  }
  return [...candidates].sort();
}
export type { SessionImportFormat,SessionImportOptions,SessionImportResult,SessionImportSource } from "../../domain/local-memory/session.js";
