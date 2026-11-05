

export type BackupArtifact = {
  fileName: string;
  sha256: string;
};

export type BackupManifest = {
  createdAt: string;
  vectorBackend?: "qdrant" | "pgvector";
  postgres: BackupArtifact;
  qdrant?: BackupArtifact & {
    metadataFileName?: string;
    collectionName?: string;
  };
  encryption?: {
    algorithm: "AES-256-GCM";
    keySource: "BACKUP_ENCRYPTION_KEY_FILE";
    encryptedAt: string;
    artifacts: string[];
  };
};

export function parseManifest(raw: string): BackupManifest {
  const parsed = JSON.parse(raw) as Partial<BackupManifest> | null;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("backup manifest must be a JSON object");
  }

  const vectorBackend = optionalManifestVectorBackend(parsed.vectorBackend);
  const createdAt = requireManifestText(parsed.createdAt, "createdAt");
  const postgresFileName = requireManifestText(
    parsed.postgres?.fileName,
    "postgres.fileName",
  );
  const postgresSha256 = requireManifestText(
    parsed.postgres?.sha256,
    "postgres.sha256",
  );

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
      ...(parsed.qdrant ?? {}),
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
    postgres: {
      ...(parsed.postgres ?? {}),
      fileName: postgresFileName,
      sha256: postgresSha256,
    },
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