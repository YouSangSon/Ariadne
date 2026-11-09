import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { buildRestoreSmokeToolInput, readRestoreSmokeToolResult, resolveOptionalRestoreSmokeTextEnv, resolveRestoreAppPort as resolvePort, resolveQdrantCollectionName, resolveRestoreSmokeTextEnv, runRestoreSmoke } from "../../application/operations/restore-smoke-policy.js";
import { buildRestoreSmokeCommandEnv, execShell, findLatestManifest, waitForHealth } from "../../infrastructure/operations/restore-smoke.js";


function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export async function runOperator() {
  const backupDir = requireEnv("BACKUP_DIR");
  const restorePostgresUrl = requireEnv("RESTORE_POSTGRES_URL");
  const restorePostgresCommand = requireEnv("RESTORE_SMOKE_POSTGRES_RESTORE_CMD");
  const projectName = resolveRestoreSmokeTextEnv(
    process.env,
    "RESTORE_SMOKE_PROJECT",
    "restore-smoke",
  );
  const projectKey = resolveRestoreSmokeTextEnv(
    process.env,
    "RESTORE_SMOKE_PROJECT_KEY",
    "project-alpha",
  );
  const userScopeId = resolveOptionalRestoreSmokeTextEnv(
    process.env,
    "RESTORE_SMOKE_USER_SCOPE_ID",
  );
  const organizationId = resolveOptionalRestoreSmokeTextEnv(
    process.env,
    "RESTORE_SMOKE_ORGANIZATION_ID",
  );
  const searchQuery = resolveRestoreSmokeTextEnv(
    process.env,
    "RESTORE_SMOKE_SEARCH_QUERY",
    "continue work",
  );
  const packTask = resolveRestoreSmokeTextEnv(
    process.env,
    "RESTORE_SMOKE_PACK_TASK",
    "continue work",
  );
  const appPort = resolveRestoreAppPort(process.env);
  const { fileName: manifestFileName, manifest } = await findLatestManifest(backupDir);
  const vectorBackend = manifest.vectorBackend ?? "qdrant";
  const restoreQdrantUrl =
    vectorBackend === "qdrant" ? requireEnv("RESTORE_QDRANT_URL") : undefined;
  const restoreQdrantCommand =
    vectorBackend === "qdrant"
      ? requireEnv("RESTORE_SMOKE_QDRANT_RESTORE_CMD")
      : undefined;
  const manifestPath = path.join(backupDir, manifestFileName);
  const postgresArtifactPath = path.join(backupDir, manifest.postgres.fileName);
  const qdrantArtifactPath = manifest.qdrant?.fileName
    ? path.join(backupDir, manifest.qdrant.fileName)
    : "";
  const qdrantMetadataPath = manifest.qdrant?.metadataFileName
    ? path.join(backupDir, manifest.qdrant.metadataFileName)
    : "";
  const qdrantCollectionName =
    vectorBackend === "qdrant"
      ? resolveQdrantCollectionName(manifest, process.env)
      : undefined;
  const composeArgs = [
    "compose",
    "-f",
    "compose.yaml",
    ...(vectorBackend === "pgvector" ? ["-f", "compose.pgvector.yaml"] : []),
    "-f",
    "compose.restore-smoke.yaml",
    "-p",
    projectName,
  ];
  const composeEnv = {
    ...process.env,
    VECTOR_BACKEND: vectorBackend,
    QDRANT_URL: "http://qdrant:6333",
    ...(qdrantCollectionName
      ? { QDRANT_COLLECTION_NAME: qdrantCollectionName }
      : {}),
  };
  const restoreCommandEnv = buildRestoreSmokeCommandEnv({
    databaseUrl: restorePostgresUrl,
    vectorBackend,
    qdrantUrl: restoreQdrantUrl,
    manifest,
    manifestPath,
    postgresArtifactPath,
    qdrantArtifactPath,
    qdrantMetadataPath,
  });

  const client = new Client({ name: "akasha-restore-smoke", version: "1.0.0" });
  const apiToken = process.env.RESTORE_SMOKE_API_TOKEN?.trim();
  const toolInput = buildRestoreSmokeToolInput({ projectKey, userScopeId, organizationId });

  await runRestoreSmoke({
    expectedContent: resolveOptionalRestoreSmokeTextEnv(process.env, "RESTORE_SMOKE_EXPECTED_CONTENT"),
    async startEnvironment() {
      await execFileAsync("docker", [
        ...composeArgs,
        "up",
        "-d",
        "--wait",
        "--wait-timeout",
        "60",
        "postgres",
        ...(vectorBackend === "qdrant" ? ["qdrant"] : []),
      ], {
        env: composeEnv,
      });
      if (restoreQdrantUrl) {
        await waitForHealth(`${restoreQdrantUrl}/collections`, { "api-key": process.env.QDRANT_API_KEY ?? "" });
      }
    },
    restorePostgres() {
      return execShell(restorePostgresCommand, restoreCommandEnv).then(
        () => undefined,
      );
    },
    ...(restoreQdrantCommand
      ? {
          restoreQdrant() {
            return execShell(restoreQdrantCommand, restoreCommandEnv).then(
              () => undefined,
            );
          },
        }
      : {}),
    async startApp() {
      const startup = execFileAsync("docker", [...composeArgs, "up", "-d", "app"], { env: composeEnv, maxBuffer: 16 * 1024 * 1024 });
      startup.child.stdout?.pipe(process.stdout);
      startup.child.stderr?.pipe(process.stderr);
      await startup;
      await waitForHealth(`http://127.0.0.1:${appPort}/readyz`);
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${appPort}/mcp`), {
        requestInit: apiToken ? { headers: { authorization: `Bearer ${apiToken}` } } : undefined,
      }));
    },
    async callSearch() {
      const result = readRestoreSmokeToolResult(await client.callTool({
        name: "search_memory",
        arguments: { ...toolInput, query: searchQuery },
      }));
      if (!Array.isArray(result.results)) throw new Error("restore smoke search returned invalid results");
      return result.results;
    },
    async callPack() {
      const result = readRestoreSmokeToolResult(await client.callTool({
        name: "build_context_pack",
        arguments: { ...toolInput, task: packTask },
      }));
      if (typeof result.packMarkdown !== "string") throw new Error("restore smoke context pack returned invalid content");
      if (!Array.isArray(result.selectedMemoryIds) || !result.selectedMemoryIds.every((id) => typeof id === "string")) throw new Error("restore smoke context pack returned invalid memory IDs");
      return { ok: true, packMarkdown: result.packMarkdown, selectedMemoryIds: result.selectedMemoryIds };
    },
    async stopEnvironment() {
      try {
        await client.close();
      } finally {
        await execFileAsync("docker", [...composeArgs, "down", "-v"], { env: composeEnv });
      }
    },
  });

  console.log("restore smoke passed");
}
const execFileAsync = promisify(execFile);

export function resolveRestoreAppPort(env: NodeJS.ProcessEnv = process.env): string { return resolvePort(env); }
