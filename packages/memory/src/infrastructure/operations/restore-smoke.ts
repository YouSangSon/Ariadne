import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseRestoreBackupManifest, resolveQdrantCollectionName, type BackupManifest } from "../../application/operations/restore-smoke-policy.js";

const execFileAsync = promisify(execFile);

export type BuildRestoreSmokeCommandEnvInput = {
  env?: NodeJS.ProcessEnv;
  databaseUrl: string;
  vectorBackend: "qdrant" | "pgvector";
  qdrantUrl?: string;
  manifest: BackupManifest;
  manifestPath: string;
  postgresArtifactPath: string;
  qdrantArtifactPath: string;
  qdrantMetadataPath: string;
};

export function buildRestoreSmokeCommandEnv(
  input: BuildRestoreSmokeCommandEnvInput,
): NodeJS.ProcessEnv {
  const env = input.env ?? process.env;
  const qdrantCollectionName =
    input.vectorBackend === "qdrant"
      ? resolveQdrantCollectionName(input.manifest, env)
      : undefined;

  return {
    ...env,
    DATABASE_URL: input.databaseUrl,
    VECTOR_BACKEND: input.vectorBackend,
    ...(input.qdrantUrl ? { QDRANT_URL: input.qdrantUrl } : {}),
    ...(qdrantCollectionName
      ? {
          QDRANT_COLLECTION_NAME: qdrantCollectionName,
          RESTORE_SMOKE_QDRANT_COLLECTION_NAME: qdrantCollectionName,
        }
      : {}),
    RESTORE_SMOKE_MANIFEST_PATH: input.manifestPath,
    RESTORE_SMOKE_POSTGRES_ARTIFACT_PATH: input.postgresArtifactPath,
    RESTORE_SMOKE_QDRANT_ARTIFACT_PATH: input.qdrantArtifactPath,
    RESTORE_SMOKE_QDRANT_METADATA_PATH: input.qdrantMetadataPath,
  };
}

export async function execShell(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const result = await execFileAsync("sh", ["-lc", command], {
    encoding: "utf8",
    env,
  });

  return result.stdout.trim();
}

export async function findLatestManifest(backupDir: string): Promise<{
  fileName: string;
  manifest: BackupManifest;
}> {
  const files = await fsp.readdir(backupDir);
  const fileName = files
    .filter((candidate) => /^manifest-\d{8}-\d{4}\.json$/.test(candidate))
    .sort()
    .at(-1);

  if (!fileName) {
    throw new Error("no backup manifest found in BACKUP_DIR");
  }

  const manifest = parseRestoreBackupManifest(
    await fsp.readFile(path.join(backupDir, fileName), "utf8"),
  );

  return {
    fileName,
    manifest,
  };
}

export async function waitForHealth(url: string, headers?: HeadersInit): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });

      if (response.ok) {
        return;
      }

      lastError = new Error(`health check returned ${response.status}`);
    } catch (error: unknown) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw lastError ?? new Error("health check did not succeed");
}