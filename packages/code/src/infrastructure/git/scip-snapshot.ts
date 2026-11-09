import { execFileSync } from "node:child_process";

export function readScipGitBlob(repoRoot: string, commitSha: string, relativePath: string): string | undefined {
  // ponytail: one git process per textless unindexed document; batch cat-file if import throughput matters.
  try {
    return execFileSync(
      'git',
      ['--no-replace-objects', 'cat-file', 'blob', `${commitSha}:${relativePath}`],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 128 * 1024 * 1024
      }
    );
  } catch {
    return undefined;
  }
}