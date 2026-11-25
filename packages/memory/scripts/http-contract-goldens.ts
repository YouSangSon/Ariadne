import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Request = {
  id: string; method: string; target: string; headers: [string, string][];
  body?: string; body_base64?: string; body_repeat?: { text: string; count: number; suffix?: string };
  http10?: boolean; omit_host?: boolean; expect_gate_passed?: boolean;
};
type Scenario = {
  id: string;
  server: {
    tokens: string;
    oauth_tokens?: Record<string, { organizationId?: string; scopes: string[] }>;
    protected_resource_env?: Record<string, string>;
    loopback_config?: boolean;
  };
  requests: Request[];
};

const RUNTIME = "v24.22.2";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const contract = (name: string) => resolve(repoRoot, "contracts/memory/http-node-v1", name);
const SOURCES = [
  "packages/memory/package-lock.json",
  "packages/memory/src/interfaces/http/server.ts",
  "packages/memory/src/interfaces/http/mcp-http.ts",
  "packages/memory/src/interfaces/http/routes/memory.ts",
  "packages/memory/src/interfaces/http/routes/tool-handler.ts",
  "packages/memory/src/interfaces/http/middleware/bearer-auth.ts",
  "packages/memory/src/interfaces/http/middleware/envelope.ts",
  "packages/memory/src/interfaces/http/middleware/json-body.ts",
  "packages/memory/src/interfaces/http/middleware/oauth-token-auth.ts",
  "packages/memory/src/interfaces/http/middleware/organization-resolution.ts",
  "packages/memory/src/interfaces/http/oauth-protected-resource.ts",
  "packages/memory/src/interfaces/mcp/tool-schemas.ts",
  "packages/memory/scripts/http-contract-goldens.ts",
];
const CONTEXT_TOOLS = ["list_workspace_roots", "add_memory_interactive", "classify_memory_candidate"];
// Only config.host matters here: a loopback bind enables the MCP Host allowlist. Nothing connects to these values.
const LOOPBACK_CONFIG = {
  host: "127.0.0.1",
  port: 8787,
  databaseUrl: "postgres://localhost/fixture",
  postgres: { pool: { max: 1, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 1_000 } },
  vectorBackend: "pgvector",
  embedding: { provider: "local", model: "fixture", dimensions: 384, version: "v1", chunkTargetTokens: 800, chunkOverlapTokens: 120 },
  backups: { directory: "/nonexistent/fixture-backups" },
};

// Environment-derived limits and credentials must not leak into the fixture server.
for (const key of Object.keys(process.env)) {
  if (/^(MEMORY_|MCP_|LEGACY_|RATE_LIMIT)/.test(key)) delete process.env[key];
}
const { createOperatorServer } = await import("../src/interfaces/http/server.js");
const { loadBearerTokens } = await import("../src/interfaces/http/middleware/bearer-auth.js");
const { loadOAuthProtectedResourceConfig } = await import("../src/interfaces/http/oauth-protected-resource.js");
const { TOOL_ROUTES } = await import("../src/interfaces/mcp/tool-schemas.js");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(resolve(repoRoot, path))).digest("hex");
}

function requestBody(request: Request): Buffer {
  if (request.body_base64 !== undefined) return Buffer.from(request.body_base64, "base64");
  if (request.body_repeat !== undefined) {
    const { text, count, suffix = "" } = request.body_repeat;
    return Buffer.from(text.repeat(count) + suffix, "utf8");
  }
  return Buffer.from(request.body ?? "", "utf8");
}

function dechunk(body: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const lineEnd = body.indexOf("\r\n", offset);
    const size = Number.parseInt(body.subarray(offset, lineEnd).toString("latin1"), 16);
    if (size === 0) return Buffer.concat(parts);
    parts.push(body.subarray(lineEnd + 2, lineEnd + 2 + size));
    offset = lineEnd + 2 + size + 2;
  }
}

async function send(port: number, request: Request): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const body = requestBody(request);
  const lines = [`${request.method} ${request.target} HTTP/1.${request.http10 ? 0 : 1}`];
  if (!request.omit_host && !request.headers.some(([name]) => name.toLowerCase() === "host")) lines.push(`Host: 127.0.0.1:${port}`);
  for (const [name, value] of request.headers) lines.push(`${name}: ${value}`);
  lines.push(`Content-Length: ${body.length}`, "Connection: close", "", "");
  const raw = await new Promise<Buffer>((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(Buffer.from(lines.join("\r\n"), "latin1"));
      socket.end(body);
    });
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => resolvePromise(Buffer.concat(chunks)));
    socket.on("error", reject);
  });
  const split = raw.indexOf("\r\n\r\n");
  const [statusLine, ...headerLines] = raw.subarray(0, split).toString("latin1").split("\r\n");
  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const colon = line.indexOf(":");
    headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  const content = raw.subarray(split + 4);
  return {
    status: Number(statusLine.split(" ")[1]),
    headers,
    body: headers["transfer-encoding"] === "chunked" ? dechunk(content) : content,
  };
}

function parsed(body: Buffer): Json {
  const text = body.toString("utf8");
  try {
    return JSON.parse(text) as Json;
  } catch {
    return text;
  }
}

async function observeScenario(scenario: Scenario): Promise<Json> {
  let handled: Json = null;
  const tools = [...TOOL_ROUTES.map(({ name }) => name), ...CONTEXT_TOOLS];
  const registry = Object.fromEntries(tools.map((tool) => [tool, async (input: Record<string, unknown>) => {
    handled = { tool, organizationId: (input.organizationId as string | undefined) ?? null };
    return handled;
  }]));
  const silent = { info() {}, warn() {}, error() {}, debug() {}, child() { return silent; } };
  const oauthTokens = scenario.server.oauth_tokens;
  const server = createOperatorServer({
    registry: registry as never,
    logger: silent as never,
    bearerTokens: loadBearerTokens({ MEMORY_API_TOKENS: scenario.server.tokens }),
    oauthTokenVerifier: oauthTokens === undefined ? null : {
      verify: async (token: string) => (oauthTokens[token] === undefined ? null : { token, ...oauthTokens[token] }),
    },
    oauthProtectedResource: scenario.server.protected_resource_env === undefined ? null : loadOAuthProtectedResourceConfig(scenario.server.protected_resource_env),
    backgroundQueueMetrics: null,
    ...(scenario.server.loopback_config ? { config: LOOPBACK_CONFIG as never } : {}),
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const port = (server.address() as AddressInfo).port;
    const results: Json[] = [];
    for (const request of scenario.requests) {
      handled = null;
      const response = await send(port, request);
      if (request.expect_gate_passed) {
        results.push({ id: request.id, gate_passed: response.status === 200 });
        continue;
      }
      results.push({
        id: request.id,
        status: response.status,
        content_type: response.headers["content-type"] ?? null,
        www_authenticate: response.headers["www-authenticate"] ?? null,
        body: parsed(response.body),
        handler: handled,
      });
    }
    return { id: scenario.id, requests: results };
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}

export async function generateHttpGoldens(): Promise<Json> {
  assert.equal(process.version, RUNTIME, "HTTP oracle runtime drift; use the reviewed Node profile");
  const corpus = JSON.parse(readFileSync(contract("cases.json"), "utf8")) as { fixture_version: number; scenarios: Scenario[] };
  assert.equal(corpus.fixture_version, 1);
  const ids = corpus.scenarios.flatMap((scenario) => scenario.requests.map(({ id }) => `${scenario.id}/${id}`));
  assert.equal(new Set(ids).size, ids.length, "duplicate fixture ID");
  const scenarios: Json[] = [];
  for (const scenario of corpus.scenarios) scenarios.push(await observeScenario(scenario));
  return {
    fixture_version: 1,
    source_manifest: {
      runtime: process.version,
      sources_sha256: Object.fromEntries(SOURCES.map((path) => [path, sha256(path)])),
      inputs_sha256: sha256("contracts/memory/http-node-v1/cases.json"),
    },
    scenarios,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  assert.ok(process.argv.length <= 3 && [undefined, "--check", "--write"].includes(mode), "usage: http-contract-goldens.ts [--check|--write]");
  const generated = await generateHttpGoldens();
  if (mode === "--write") writeFileSync(contract("expected.json"), JSON.stringify(generated, null, 2) + "\n");
  else assert.deepEqual(JSON.parse(readFileSync(contract("expected.json"), "utf8")), generated, "HTTP golden drift; review source, runtime and cases before --write");
}
