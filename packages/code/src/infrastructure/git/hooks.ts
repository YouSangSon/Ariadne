import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ParallaxGitHookName } from "../../domain/workspace/git-hooks.js";

export function assertGitRepo(repoRoot: string): void {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoRoot, stdio: 'ignore' });
  } catch {
    throw new Error(`install-hook requires a git repository: ${repoRoot}`);
  }
}

export function resolveHookPath(repoRoot: string, hook: ParallaxGitHookName): string {
  const raw = execFileSync('git', ['rev-parse', '--git-path', `hooks/${hook}`], {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim();
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw);
}
export type { ParallaxGitHookAction,ParallaxGitHookName,ParallaxGitHookOptions,ParallaxGitHookPlan,PlannedParallaxGitHook } from "../../domain/workspace/git-hooks.js";

export function readHook(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}
export function writeHook(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  chmodSync(file, 0o755);
}