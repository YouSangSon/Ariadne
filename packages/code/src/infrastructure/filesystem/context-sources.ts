import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolveInsideRoot } from "./security.js";

export function changedFileContentHash(repoRoot: string, filePath: string): string {
  const absolutePath = resolveInsideRoot(repoRoot, filePath);
  if (!existsSync(absolutePath)) return 'missing';
  const hash = createHash('sha256');
  hash.update(readFileSync(absolutePath));
  return hash.digest('hex');
}