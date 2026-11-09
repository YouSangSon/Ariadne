import type { BackupEncryptionArtifacts } from "../ports/backup-artifacts.js";
import { type BackupArtifact, type BackupManifest, parseManifest } from "./backup-encryption-policy.js";
export type EncryptManifestRequest = { key: Buffer; now?: Date; keepPlaintext?: boolean; randomBytes?: (size: number) => Buffer };


export async function encryptManifestArtifacts(
  input: EncryptManifestRequest,
  artifacts: BackupEncryptionArtifacts,
): Promise<BackupManifest> {
  const manifest = parseManifest(
    await artifacts.readManifest(),
  );

  if (manifest.encryption) {
    return manifest;
  }

  const encryptedArtifacts: string[] = [];
  manifest.postgres = await encryptManifestArtifact({
    artifact: manifest.postgres,
    key: input.key,
    keepPlaintext: input.keepPlaintext ?? false,
    randomBytes: input.randomBytes,
  }, artifacts);
  encryptedArtifacts.push("postgres");

  if (manifest.qdrant) {
    manifest.qdrant = {
      ...manifest.qdrant,
      ...(await encryptManifestArtifact({
        artifact: manifest.qdrant,
        key: input.key,
        keepPlaintext: input.keepPlaintext ?? false,
        randomBytes: input.randomBytes,
      }, artifacts)),
    };
    encryptedArtifacts.push("qdrant");
  }

  manifest.encryption = {
    algorithm: "AES-256-GCM",
    keySource: "BACKUP_ENCRYPTION_KEY_FILE",
    encryptedAt: (input.now ?? new Date()).toISOString(),
    artifacts: encryptedArtifacts,
  };

  await artifacts.commitManifest(manifest);
  return manifest;
}

async function encryptManifestArtifact(input: {
  artifact: BackupArtifact;
  key: Buffer;
  keepPlaintext: boolean;
  randomBytes?: (size: number) => Buffer;
}, artifacts: BackupEncryptionArtifacts): Promise<BackupArtifact> {
  const encryptedFileName = `${input.artifact.fileName}.enc`;
  await artifacts.encryptArtifact({ sourceFileName: input.artifact.fileName, encryptedFileName, key: input.key, randomBytes: input.randomBytes });
  const sha256 = await artifacts.checksum(encryptedFileName);
  await artifacts.writeChecksum(encryptedFileName, sha256);
  if (!input.keepPlaintext) await artifacts.removePlainArtifact(input.artifact.fileName);

  return {
    fileName: encryptedFileName,
    sha256,
  };
}