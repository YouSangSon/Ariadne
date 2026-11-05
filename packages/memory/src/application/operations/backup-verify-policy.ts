

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

export function parseManifest(raw: string): BackupManifest {
  const parsed = JSON.parse(raw) as Partial<BackupManifest>;
  const createdAt = requireManifestText(parsed.createdAt, "createdAt");
  const postgres = {
    fileName: requireManifestText(
      parsed.postgres?.fileName,
      "postgres.fileName",
    ),
    sha256: requireManifestText(parsed.postgres?.sha256, "postgres.sha256"),
  };

  let qdrant: BackupManifest["qdrant"];

  if (parsed.qdrant !== undefined || parsed.vectorBackend !== "pgvector") {
    qdrant = {
      ...(parsed.qdrant ?? {}),
      fileName: requireManifestText(
        parsed.qdrant?.fileName,
        "qdrant.fileName",
      ),
      sha256: requireManifestText(parsed.qdrant?.sha256, "qdrant.sha256"),
    };
  }

  return {
    ...parsed,
    createdAt,
    postgres,
    ...(qdrant ? { qdrant } : {}),
  };
}

export function requireManifestText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`backup manifest ${label} must contain non-whitespace text`);
  }
  return value;
}

export function manifestsEqual(left: BackupManifest, right: BackupManifest): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function resolveBackupTargetDir(
  env: Record<string, string | undefined>,
  backupDir: string,
): string {
  const targetDir = env.BACKUP_TARGET_DIR;
  if (targetDir === undefined) {
    return backupDir;
  }
  if (targetDir.trim().length === 0) {
    throw new Error("BACKUP_TARGET_DIR must contain non-whitespace text");
  }
  return targetDir;
}