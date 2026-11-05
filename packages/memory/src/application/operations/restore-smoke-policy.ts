

export const DEFAULT_QDRANT_COLLECTION_NAME = "memory_chunks_v1";
export const DEFAULT_RESTORE_APP_PORT = "18787";

export type BackupManifest = {
  createdAt: string;
  vectorBackend?: "qdrant" | "pgvector";
  postgres: {
    fileName: string;
    sha256: string;
  };
  qdrant?: {
    fileName: string;
    sha256: string;
    metadataFileName?: string;
    collectionName?: string;
  };
};

export type RunRestoreSmokeInput = {
  startEnvironment: () => Promise<void>;
  restorePostgres: () => Promise<void>;
  restoreQdrant?: () => Promise<void>;
  startApp: () => Promise<void>;
  callSearch: () => Promise<unknown[]>;
  callPack: () => Promise<{ ok: boolean; packMarkdown?: string; selectedMemoryIds?: string[] }>;
  expectedContent?: string;
  stopEnvironment: () => Promise<void>;
};

export type RestoreSmokeToolInput = {
  projectKey: string;
  userScopeId?: string;
  organizationId?: string;
};

export function buildRestoreSmokeToolInput(input: RestoreSmokeToolInput) {
  const projectKey = requireRestoreSmokeText(input.projectKey, "projectKey");
  const userScopeId = optionalRestoreSmokeText(input.userScopeId, "userScopeId");
  const organizationId = optionalRestoreSmokeText(
    input.organizationId,
    "organizationId",
  );

  return {
    projectKey,
    ...(userScopeId !== undefined ? { userScopeId } : {}),
    ...(organizationId !== undefined ? { organizationId } : {}),
  };
}

export function resolveRestoreAppPort(
  env: Record<string, string | undefined>,
): string {
  const raw = env.RESTORE_APP_PORT ?? DEFAULT_RESTORE_APP_PORT;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid RESTORE_APP_PORT: ${raw}`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`Invalid RESTORE_APP_PORT: ${raw}`);
  }
  return raw;
}

export function resolveRestoreSmokeTextEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: string,
): string {
  const value = env[name];
  if (value === undefined) {
    return fallback;
  }
  return requireRestoreSmokeText(value, name);
}

export function resolveOptionalRestoreSmokeTextEnv(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  return optionalTrimmedRestoreSmokeText(env[name], name);
}

export function requireRestoreSmokeText(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${name} must contain non-whitespace text`);
  }
  return value;
}

export function optionalRestoreSmokeText(
  value: string | undefined,
  name: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireRestoreSmokeText(value, name);
}

export function resolveQdrantCollectionName(
  manifest: BackupManifest,
  env: Record<string, string | undefined>,
): string {
  const manifestCollection = optionalTrimmedRestoreSmokeText(
    manifest.qdrant?.collectionName,
    "manifest qdrant.collectionName",
  );
  if (manifestCollection !== undefined) {
    return manifestCollection;
  }

  const envCollection = optionalTrimmedRestoreSmokeText(
    env.QDRANT_COLLECTION_NAME,
    "QDRANT_COLLECTION_NAME",
  );
  return envCollection ?? DEFAULT_QDRANT_COLLECTION_NAME;
}

export function optionalTrimmedRestoreSmokeText(
  value: string | undefined,
  name: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} must contain non-whitespace text`);
  }
  return trimmed;
}

export function parseRestoreBackupManifest(raw: string): BackupManifest {
  const parsed = JSON.parse(raw) as Partial<BackupManifest> | null;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("backup manifest must be a JSON object");
  }

  const vectorBackend = optionalManifestVectorBackend(parsed.vectorBackend);
  const createdAt = requireManifestText(parsed.createdAt, "createdAt");
  const postgres = {
    fileName: requireManifestText(
      parsed.postgres?.fileName,
      "postgres.fileName",
    ),
    sha256: requireManifestText(parsed.postgres?.sha256, "postgres.sha256"),
  };

  let qdrant: BackupManifest["qdrant"];
  if (parsed.qdrant !== undefined || vectorBackend !== "pgvector") {
    const metadataFileName = optionalManifestText(
      parsed.qdrant?.metadataFileName,
      "qdrant.metadataFileName",
    );
    const collectionName = optionalManifestText(
      parsed.qdrant?.collectionName,
      "qdrant.collectionName",
    );

    qdrant = {
      fileName: requireManifestText(
        parsed.qdrant?.fileName,
        "qdrant.fileName",
      ),
      sha256: requireManifestText(parsed.qdrant?.sha256, "qdrant.sha256"),
      ...(metadataFileName !== undefined ? { metadataFileName } : {}),
      ...(collectionName !== undefined ? { collectionName } : {}),
    };
  }

  return {
    ...parsed,
    ...(vectorBackend !== undefined ? { vectorBackend } : {}),
    createdAt,
    postgres,
    ...(qdrant !== undefined ? { qdrant } : {}),
  };
}

export function optionalManifestVectorBackend(
  value: unknown,
): BackupManifest["vectorBackend"] {
  if (value === undefined) {
    return undefined;
  }
  if (value === "qdrant" || value === "pgvector") {
    return value;
  }
  throw new Error("backup manifest vectorBackend must be qdrant or pgvector");
}

export function requireManifestText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`backup manifest ${name} must contain non-whitespace text`);
  }
  return value;
}

export function optionalManifestText(
  value: unknown,
  name: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireManifestText(value, name);
}

export async function runRestoreSmoke(input: RunRestoreSmokeInput) {
  try {
    await input.startEnvironment();
    await input.restorePostgres();
    if (input.restoreQdrant) {
      await input.restoreQdrant();
    }
    await input.startApp();

    const searchResults = await input.callSearch();

    if (searchResults.length === 0) {
      throw new Error("restore smoke search returned no results");
    }

    const packResult = await input.callPack();

    if (input.expectedContent !== undefined) {
      const recovered = searchResults.find((result) => typeof result === "object" && result !== null && "content" in result && result.content === input.expectedContent);
      if (typeof recovered !== "object" || recovered === null ||
          !("id" in recovered) || typeof recovered.id !== "number" || !Number.isSafeInteger(recovered.id) || recovered.id <= 0 ||
          !("scopeType" in recovered) || (recovered.scopeType !== "project" && recovered.scopeType !== "user") ||
          !("scopeId" in recovered) || typeof recovered.scopeId !== "string" || !recovered.scopeId.trim()) {
        throw new Error("restore smoke search did not recover the expected content");
      }
      const contextMemoryId = `${recovered.scopeType}:${recovered.scopeId}:${recovered.id}`;
      if (!packResult.selectedMemoryIds?.includes(contextMemoryId) || !packResult.packMarkdown?.includes(input.expectedContent)) {
        throw new Error("restore smoke context pack did not recover the expected content");
      }
    }

    if (!packResult.ok) {
      throw new Error("restore smoke context pack failed");
    }
  } finally {
    await input.stopEnvironment();
  }
}

export function readRestoreSmokeToolResult(result: Record<string, unknown>): Record<string, unknown> {
  const content = result.structuredContent;
  if (result.isError || typeof content !== "object" || content === null || Array.isArray(content) || !("ok" in content) || content.ok !== true) {
    throw new Error("restore smoke MCP tool call failed");
  }
  return content as Record<string, unknown>;
}