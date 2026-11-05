import { execFileSync } from "node:child_process";
import { DEFAULT_HISTORY_OPTIONS, parseGitLogNameOnly } from "../../domain/indexing/co-change.js";
import type { CommitHistoryOptions } from "../../domain/indexing/co-change.js";

export function readCommitHistory(
  repoRoot: string,
  options: Partial<CommitHistoryOptions> = {}
): string[][] {
  const opts = { ...DEFAULT_HISTORY_OPTIONS, ...options };
  try {
    const inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (inside !== 'true') return [];

    const output = execFileSync(
      'git',
      [
        'log',
        `--since=${opts.sinceMonths}.months`,
        `--max-count=${opts.maxCommits}`,
        '--no-merges',
        '--name-only',
        '--format=%x00'
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024
      }
    );
    return parseGitLogNameOnly(output);
  } catch {
    return [];
  }
}
export { DEFAULT_CO_CHANGE_OPTIONS,DEFAULT_HISTORY_OPTIONS,computeCoChanges,parseGitLogNameOnly } from "../../domain/indexing/co-change.js";
export type { CoChangeOptions,CoChangePair,CommitHistoryOptions } from "../../domain/indexing/co-change.js";
