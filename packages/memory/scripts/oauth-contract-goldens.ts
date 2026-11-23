import assert from "node:assert/strict";
import {
  constants,
  createHash,
  createHmac,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createOAuthTokenVerifier,
  loadOAuthTokenVerifierConfig,
} from "../src/interfaces/http/middleware/oauth-token-auth.js";
import { loadOAuthProtectedResourceConfig } from "../src/interfaces/http/oauth-protected-resource.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
type Env = Record<string, string | null>;
type Reply = { status: number; jwks?: string; json?: Json; body?: string };
type TokenSpec = {
  raw?: string; key?: string; alg?: string; header?: JsonObject; payload?: JsonObject;
  header_json?: string; payload_json?: string; transform?: string; sign_with?: string; signature?: string;
};
type Corpus = {
  fixture_version: number; now: number; default_env: Env; default_responses: Record<string, Reply[]>;
  keys: Record<string, { type: "rsa" | "ec" | "ed25519"; bits?: number; curve?: string }>;
  jwks: Record<string, { key: string; kid?: string; members?: JsonObject; private?: boolean }[]>;
  tokens: Record<string, TokenSpec>;
  cases: { id: string; op: "config" | "verify"; env?: Env; responses?: Record<string, Reply[]>; steps?: { advance?: number; token: string }[] }[];
};
type Material = { keys: Record<string, JsonObject>; private_jwks: Record<string, JsonObject>; tokens: Record<string, string> };

const RUNTIME = "v24.22.2";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const contract = (name: string) => resolve(repoRoot, "contracts/memory/oauth-node-v1", name);
const SOURCES = [
  "packages/memory/src/interfaces/http/middleware/oauth-token-auth.ts",
  "packages/memory/src/interfaces/http/oauth-protected-resource.ts",
  "packages/memory/package-lock.json",
  "packages/memory/scripts/oauth-contract-goldens.ts",
];
const HASH: Record<string, string> = { "256": "sha256", "384": "sha384", "512": "sha512" };

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

// jose and the verifier read Date.now() and new Date(); the fixture clock replaces both.
let clockMs = 0;
const RealDate = Date;
class FixtureDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(clockMs);
    else super(...(args as [number]));
  }
  static override now(): number {
    return clockMs;
  }
}
globalThis.Date = FixtureDate as DateConstructor;

function withNow(value: Json, now: number): Json {
  if (Array.isArray(value)) return value.map((item) => withNow(item, now));
  if (value !== null && typeof value === "object") {
    const offset = (value as JsonObject).$now;
    if (typeof offset === "number" && Object.keys(value).length === 1) return now + offset;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withNow(item, now)]));
  }
  return value;
}

function merged(base: JsonObject, overrides: JsonObject | undefined): JsonObject {
  const result: JsonObject = { ...base, ...overrides };
  for (const [key, value] of Object.entries(result)) if (value === null) delete result[key];
  return result;
}

function signSegments(input: string, spec: TokenSpec, privateKeys: Record<string, KeyObject>): string {
  const alg = spec.alg!;
  const data = Buffer.from(input, "ascii");
  const key = privateKeys[spec.sign_with ?? spec.key!];
  if (spec.signature === "") return "";
  if (spec.signature === "hmac") return createHmac("sha256", "fixture-secret").update(data).digest("base64url");
  let raw: Buffer;
  if (alg.startsWith("RS")) raw = sign(HASH[alg.slice(2)], data, key);
  else if (alg.startsWith("PS")) raw = sign(HASH[alg.slice(2)], data, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: Number(alg.slice(2)) / 8 });
  else if (alg.startsWith("ES")) raw = sign(HASH[alg.slice(2)], data, { key, dsaEncoding: spec.signature === "der" ? "der" : "ieee-p1363" });
  else raw = sign(null, data, key);
  if (spec.signature === "truncate") raw = raw.subarray(0, raw.length - 1);
  const encoded = raw.toString("base64url");
  return spec.signature === "plus" ? "+" + encoded.slice(1) : encoded;
}

function buildToken(spec: TokenSpec, now: number, privateKeys: Record<string, KeyObject>): string {
  if (spec.raw !== undefined) return spec.raw;
  const header = spec.header_json ?? JSON.stringify(merged({ alg: spec.alg!, kid: `k-${spec.key}` }, spec.header));
  const claims = merged({
    iss: "https://issuer.example/", aud: "https://memory.example/mcp", sub: "user-1",
    iat: now - 10, exp: now + 3600, scope: "akasha:read akasha:write", organization_id: "org-a",
  }, withNow(spec.payload ?? {}, now) as JsonObject);
  let payload = Buffer.from(spec.payload_json ?? JSON.stringify(claims), "utf8").toString("base64url");
  if (spec.transform === "pad_payload") {
    for (let pad = ""; payload.length % 4 === 0; pad += "x") {
      payload = Buffer.from(JSON.stringify({ ...claims, pad }), "utf8").toString("base64url");
    }
    payload += "=".repeat(4 - (payload.length % 4));
  }
  if (spec.transform === "space_payload") payload = `${payload.slice(0, 8)} ${payload.slice(8)}`;
  if (spec.transform === "plus_payload") payload = `${payload[0]}+${payload.slice(2)}`;
  const signingInput = `${Buffer.from(header, "utf8").toString("base64url")}.${payload}`;
  return `${signingInput}.${signSegments(signingInput, spec, privateKeys)}`;
}

function generateMaterial(corpus: Corpus): Material {
  const privateKeys: Record<string, KeyObject> = {};
  const material: Material = { keys: {}, private_jwks: {}, tokens: {} };
  for (const [name, spec] of Object.entries(corpus.keys)) {
    const pair = spec.type === "rsa"
      ? generateKeyPairSync("rsa", { modulusLength: spec.bits! })
      : spec.type === "ec" ? generateKeyPairSync("ec", { namedCurve: spec.curve! }) : generateKeyPairSync("ed25519");
    privateKeys[name] = pair.privateKey;
    material.keys[name] = pair.publicKey.export({ format: "jwk" }) as JsonObject;
  }
  for (const entries of Object.values(corpus.jwks)) {
    for (const entry of entries) {
      if (entry.private) material.private_jwks[entry.key] = privateKeys[entry.key].export({ format: "jwk" }) as JsonObject;
    }
  }
  for (const [id, spec] of Object.entries(corpus.tokens)) material.tokens[id] = buildToken(spec, corpus.now, privateKeys);
  return material;
}

function jwksDocument(corpus: Corpus, material: Material, name: string): Json {
  return {
    keys: corpus.jwks[name].map((entry) => ({
      ...(entry.private ? material.private_jwks[entry.key] : material.keys[entry.key]),
      ...(entry.kid === undefined ? {} : { kid: entry.kid }),
      ...entry.members,
    })),
  };
}

function caseEnv(corpus: Corpus, env: Env | undefined): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...corpus.default_env, ...env })) if (value !== null) values[key] = value;
  return values;
}

function observeConfig(env: Record<string, string>): Json {
  try {
    const protectedResource = loadOAuthProtectedResourceConfig(env);
    const verifier = loadOAuthTokenVerifierConfig(env, protectedResource);
    return JSON.parse(JSON.stringify({ protected_resource: protectedResource, verifier })) as Json;
  } catch (error) {
    assert.ok(error instanceof Error);
    return { error: error.message };
  }
}

async function observeVerify(corpus: Corpus, material: Material, entry: Corpus["cases"][number]): Promise<Json> {
  const responses = { ...corpus.default_responses, ...entry.responses };
  const served: Record<string, number> = {};
  let fetches: Json[] = [];
  const fixtureFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    fetches.push({ url, accept: new Headers(init?.headers).get("accept") });
    const replies = responses[url] ?? [];
    if (replies.length === 0) throw new TypeError("fetch failed");
    const reply = replies[Math.min(served[url] ?? 0, replies.length - 1)];
    served[url] = (served[url] ?? 0) + 1;
    if (init?.redirect === "error" && reply.status >= 300 && reply.status < 400) throw new TypeError("fetch failed: redirect");
    const body = reply.jwks !== undefined ? JSON.stringify(jwksDocument(corpus, material, reply.jwks))
      : reply.json !== undefined ? JSON.stringify(reply.json) : reply.body ?? "";
    return new Response(body, { status: reply.status });
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = fixtureFetch as typeof fetch;
  try {
    const env = caseEnv(corpus, entry.env);
    const verifier = createOAuthTokenVerifier(loadOAuthTokenVerifierConfig(env, loadOAuthProtectedResourceConfig(env)), { fetch: fixtureFetch as never });
    assert.ok(verifier, `${entry.id}: OAuth verifier must be configured`);
    clockMs = corpus.now * 1000;
    const steps: Json[] = [];
    for (const step of entry.steps ?? []) {
      clockMs += (step.advance ?? 0) * 1000;
      fetches = [];
      const result = await verifier.verify(material.tokens[step.token]);
      steps.push({
        token: step.token,
        identity: result === null ? null : { organizationId: result.organizationId ?? null, scopes: [...(result.scopes ?? [])] },
        fetches,
      });
    }
    return { steps };
  } finally {
    globalThis.fetch = realFetch;
  }
}

export async function generateOAuthGoldens(material: Material): Promise<Json> {
  assert.equal(process.version, RUNTIME, "OAuth oracle runtime drift; use the reviewed Node profile");
  const corpus = readJson<Corpus>(contract("cases.json"));
  assert.equal(corpus.fixture_version, 1);
  assert.equal(new Set(corpus.cases.map(({ id }) => id)).size, corpus.cases.length, "duplicate fixture ID");
  const cases: Json[] = [];
  for (const entry of corpus.cases) {
    const result = entry.op === "config" ? observeConfig(caseEnv(corpus, entry.env)) : await observeVerify(corpus, material, entry);
    cases.push({ id: entry.id, ...(result as JsonObject) });
  }
  return {
    fixture_version: 1,
    source_manifest: {
      runtime: process.version,
      sources_sha256: Object.fromEntries(SOURCES.map((path) => [path, sha256(resolve(repoRoot, path))])),
      inputs_sha256: sha256(contract("cases.json")),
      material_sha256: sha256(contract("material.json")),
    },
    cases,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  assert.ok(process.argv.length <= 3 && [undefined, "--check", "--write", "--write-material"].includes(mode), "usage: oauth-contract-goldens.ts [--check|--write|--write-material]");
  if (mode === "--write-material") {
    writeFileSync(contract("material.json"), JSON.stringify(generateMaterial(readJson<Corpus>(contract("cases.json"))), null, 2) + "\n");
  }
  const generated = await generateOAuthGoldens(readJson<Material>(contract("material.json")));
  if (mode === "--write" || mode === "--write-material") {
    writeFileSync(contract("expected.json"), JSON.stringify(generated, null, 2) + "\n");
  } else {
    assert.deepEqual(readJson(contract("expected.json")), generated, "OAuth golden drift; review source, runtime, cases and material before --write");
  }
}
