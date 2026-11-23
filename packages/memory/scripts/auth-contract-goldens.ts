import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertOrganizationId } from "../src/domain/policies/assert-organization-id.js";
import {
  authenticateBearer,
  loadBearerTokens,
  type BearerToken,
} from "../src/interfaces/http/middleware/bearer-auth.js";
import {
  createMcpToolAuthorizer,
  withAuthenticatedRegistry,
} from "../src/interfaces/http/middleware/mcp-http-auth.js";
import {
  checkOAuthScopes,
  requiredScopeKindForTool,
} from "../src/interfaces/http/middleware/oauth-token-auth.js";
import { resolveOrganizationId } from "../src/interfaces/http/middleware/organization-resolution.js";
import {
  buildOAuthInsufficientScopeHeader,
  buildOAuthWwwAuthenticateHeader,
  type OAuthProtectedResourceConfig,
} from "../src/interfaces/http/oauth-protected-resource.js";
import { assertSafeAuthConfig, isLoopbackHost } from "../src/interfaces/http/server.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Case = { id: string; op: string; [key: string]: Json };
type AuthInput = { authType: "static" | "oauth"; organizationId?: string; scopes?: string[] } | null;

const RUNTIME = "v24.22.2";
const CHALLENGE_METADATA_URL = "https://memory.example/.well-known/oauth-protected-resource/mcp";
const memoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(memoryRoot, "../..");
const contractDir = resolve(repoRoot, "contracts/memory/auth-node-v1");
const SOURCES = [
  "packages/memory/src/domain/policies/assert-organization-id.ts",
  "packages/memory/src/domain/policies/memory-content.ts",
  "packages/memory/src/application/tools/tool-registry-validation.ts",
  "packages/memory/src/interfaces/http/middleware/bearer-auth.ts",
  "packages/memory/src/interfaces/http/middleware/mcp-http-auth.ts",
  "packages/memory/src/interfaces/http/middleware/oauth-token-auth.ts",
  "packages/memory/src/interfaces/http/middleware/organization-resolution.ts",
  "packages/memory/src/interfaces/http/oauth-protected-resource.ts",
  "packages/memory/src/interfaces/http/server.ts",
  "packages/memory/scripts/auth-contract-goldens.ts",
];
// Every registry entry withAuthenticatedRegistry wraps; the stub echoes the input it receives.
const SERVICE_TOOLS = [
  "add_memory", "search_memory", "build_context_pack", "reindex_memory", "compact_memory",
  "list_memory", "inspect_memory_graph", "inspect_memory_impact", "update_memory",
  "delete_memory", "tag_memory", "list_audit_log", "unarchive_memory", "start_goal_run",
  "record_iteration", "get_goal_run", "list_goal_runs", "complete_goal_run",
  "abandon_goal_run", "build_goal_context", "check_repeat_attempt",
];

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(resolve(repoRoot, path))).digest("hex");
}

function message(error: unknown): string {
  assert.ok(error instanceof Error, "oracle expects Error values");
  return error.message;
}

function protectedResource(metadataUrl: string, scopes: Json): OAuthProtectedResourceConfig {
  return {
    metadata: {
      resource: "https://memory.example/mcp",
      authorization_servers: ["https://issuer.example/"],
      bearer_methods_supported: ["header"],
      scopes_supported: scopes as string[],
    },
    metadataUrl,
  };
}

function challengeConfig(scopes: Json): OAuthProtectedResourceConfig | null {
  return scopes === null ? null : protectedResource(CHALLENGE_METADATA_URL, scopes);
}

function bearer(auth: AuthInput): BearerToken | null {
  return auth === null ? null : { token: "fixture-token", ...auth };
}

function headerRecorder() {
  const headers: Record<string, string> = {};
  const res = { setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; } };
  return { headers, res: res as never };
}

async function authenticate(entry: Case): Promise<Json> {
  const tokens = loadBearerTokens({ MEMORY_API_TOKENS: entry.tokens as string });
  const calls: string[] = [];
  const oauth = entry.oauth as { result: Json } | undefined;
  const verifier = oauth === undefined ? null : {
    verify: async (token: string) => {
      calls.push(token);
      return oauth.result === null ? null : { token: "verifier-token", ...(oauth.result as object) };
    },
  };
  const principal = await authenticateBearer((entry.authorization ?? undefined) as string | undefined, tokens, verifier);
  return {
    principal: principal === null ? null : {
      token: principal.token,
      organizationId: principal.organizationId ?? null,
      authType: principal.authType ?? null,
      scopes: principal.scopes === undefined ? null : [...principal.scopes],
    },
    verifier_calls: calls,
  };
}

function resolveOrganization(entry: Case): Json {
  const headers: Record<string, string> = {};
  const rawHeaders: string[] = [];
  for (const [name, value] of entry.headers as [string, string][]) {
    const key = name.toLowerCase();
    headers[key] = key in headers ? `${headers[key]}, ${value}` : value;
    rawHeaders.push(name, value);
  }
  const body = entry.body as Record<string, Json>;
  const auth = entry.auth_organization === null ? null : { token: "t", organizationId: entry.auth_organization as string };
  const resolved = resolveOrganizationId({ headers, rawHeaders } as never, body.organizationId, auth);
  return {
    organizationId: resolved.organizationId ?? null,
    conflict: resolved.conflict,
    validationError: resolved.validationError ?? null,
  };
}

function checkScopes(entry: Case): Json {
  const config = challengeConfig(entry.scopes_supported);
  const check = checkOAuthScopes(bearer(entry.auth as AuthInput), entry.tool as never, entry.input as never, config);
  if (check.ok) return { ok: true };
  return {
    ok: false,
    kind: check.kind,
    challengeScope: check.challengeScope,
    insufficient_scope_header: config === null ? null : buildOAuthInsufficientScopeHeader(config, check.challengeScope),
  };
}

function mcpContext(entry: Case): Json {
  const { headers, res } = headerRecorder();
  const authorize = createMcpToolAuthorizer(bearer(entry.auth as AuthInput)!, challengeConfig(entry.scopes_supported), res);
  try {
    authorize({ toolName: entry.tool as never, input: entry.input as never });
    return { ok: true };
  } catch (error) {
    return { error: message(error), www_authenticate: headers["www-authenticate"] ?? null };
  }
}

async function mcpService(entry: Case): Promise<Json> {
  const { headers, res } = headerRecorder();
  const registry = Object.fromEntries(SERVICE_TOOLS.map((name) => [name, async (input: Json) => input]));
  const guarded = withAuthenticatedRegistry(registry as never, bearer(entry.auth as AuthInput)!, challengeConfig(entry.scopes_supported), res);
  try {
    const handler = (guarded as unknown as Record<string, (input: Json) => Promise<Json>>)[entry.tool as string];
    return { input: await handler(entry.input) };
  } catch (error) {
    return { error: message(error), www_authenticate: headers["www-authenticate"] ?? null };
  }
}

function attempt(run: () => Json): Json {
  try {
    return run();
  } catch (error) {
    return { error: message(error) };
  }
}

async function observe(entry: Case): Promise<Json> {
  switch (entry.op) {
    case "static_tokens":
      return attempt(() => ({
        tokens: loadBearerTokens(entry.raw === null ? {} : { MEMORY_API_TOKENS: entry.raw as string })
          .map(({ token, organizationId }) => ({ token, organizationId: organizationId ?? null })),
      }));
    case "authenticate":
      return authenticate(entry);
    case "resolve_organization":
      return resolveOrganization(entry);
    case "scope_kind":
      return attempt(() => ({ kind: requiredScopeKindForTool(entry.tool as never, entry.input as never) }));
    case "check_scopes":
      return attempt(() => checkScopes(entry));
    case "mcp_context":
      return mcpContext(entry);
    case "mcp_service":
      return mcpService(entry);
    case "www_authenticate":
      return { header: buildOAuthWwwAuthenticateHeader(protectedResource(entry.metadata_url as string, entry.scopes_supported)) };
    case "safe_auth_config":
      return {
        loopback: isLoopbackHost(entry.host as string),
        ...attempt(() => {
          assertSafeAuthConfig({ tokenCount: entry.token_count as number, host: entry.host as string, oauthTokenValidationEnabled: entry.oauth as boolean });
          return { ok: true };
        }) as object,
      };
    case "assert_organization":
      return attempt(() => {
        assertOrganizationId(
          (entry.organization_id ?? undefined) as string | undefined,
          (entry.allow_legacy_anonymous ?? undefined) as boolean | undefined,
          entry.fn as string,
        );
        return { ok: true };
      });
  }
  throw new Error(`unknown auth oracle operation: ${entry.op}`);
}

export async function generateAuthGoldens(): Promise<Json> {
  assert.equal(process.version, RUNTIME, "auth oracle runtime drift; use the reviewed Node profile");
  const inputs = "contracts/memory/auth-node-v1/cases.json";
  const corpus = JSON.parse(readFileSync(resolve(repoRoot, inputs), "utf8")) as { fixture_version: number; cases: Case[] };
  assert.equal(corpus.fixture_version, 1);
  assert.equal(new Set(corpus.cases.map(({ id }) => id)).size, corpus.cases.length, "duplicate fixture ID");
  const cases: Json[] = [];
  for (const entry of corpus.cases) {
    cases.push({ id: entry.id, ...(await observe(entry)) as object });
  }
  return {
    fixture_version: 1,
    source_manifest: {
      runtime: process.version,
      sources_sha256: Object.fromEntries(SOURCES.map((path) => [path, sha256(path)])),
      inputs_sha256: sha256(inputs),
    },
    challenge_metadata_url: CHALLENGE_METADATA_URL,
    cases,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  assert.ok(process.argv.length <= 3 && [undefined, "--check", "--write"].includes(mode), "usage: auth-contract-goldens.ts [--check|--write]");
  const generated = await generateAuthGoldens();
  const target = resolve(contractDir, "expected.json");
  if (mode === "--write") {
    writeFileSync(target, JSON.stringify(generated, null, 2) + "\n");
  } else {
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), generated, "auth golden drift; review source, runtime and cases before --write");
  }
}
