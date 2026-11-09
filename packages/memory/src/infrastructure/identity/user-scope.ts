import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import { requireUserScopeId } from "../../application/tools/tool-utils.js";


export type ResolveUserScopeIdInput = {
  cwd: string;
  explicitUserScopeId?: string;
  defaultUserScopeId?: string;
};

export function resolveUserScopeId(input: ResolveUserScopeIdInput): string {
  assertResolveUserScopeIdInput(input);

  if (input.explicitUserScopeId !== undefined) {
    return requireUserScopeId(input.explicitUserScopeId);
  }

  if (input.defaultUserScopeId !== undefined) {
    return requireUserScopeId(input.defaultUserScopeId);
  }

  if (process.env.DEVELOPER_MEMORY_USER_ID !== undefined) {
    const configuredUserId = process.env.DEVELOPER_MEMORY_USER_ID.trim();
    if (configuredUserId.length === 0) {
      throw new Error(
        "DEVELOPER_MEMORY_USER_ID must contain non-whitespace text",
      );
    }
    return configuredUserId;
  }

  const gitEmail = readGitEmail(input.cwd);

  if (gitEmail) {
    return `git-${createHash("sha256").update(gitEmail).digest("hex").slice(0, 12)}`;
  }

  return `local-${sanitizeScopeId(os.userInfo().username)}`;
}

function assertResolveUserScopeIdInput(
  input: unknown,
): asserts input is ResolveUserScopeIdInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("resolveUserScopeId input must be an object");
  }

  const candidate = input as Record<string, unknown>;
  assertNonBlankString(candidate.cwd, "cwd");
  assertOptionalString(candidate.explicitUserScopeId, "explicitUserScopeId");
  assertOptionalString(candidate.defaultUserScopeId, "defaultUserScopeId");
}

function readGitEmail(cwd: string): string | null {
  try {
    return execFileSync("git", ["config", "user.email"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_err: unknown) {
    return null;
  }
}

function sanitizeScopeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function assertNonBlankString(value: unknown, fieldName: string): void { if (typeof value !== "string") throw new Error(`${fieldName} must be a string`); if (!value.trim()) throw new Error(`${fieldName} must contain non-whitespace text`); }
function assertOptionalString(value: unknown, fieldName: string): void { if (value !== undefined && typeof value !== "string") throw new Error(`${fieldName} must be a string`); }
