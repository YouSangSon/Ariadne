import { encryptManifestArtifacts } from "../../composition/runtime/backup-operations.js";
import { decryptFile, loadBackupEncryptionKeepPlaintextFromEnv, loadBackupEncryptionKeyFromEnv } from "../../infrastructure/operations/backup-encryption.js";


export async function runOperator() {
  const command = process.argv[2];
  const key = await loadBackupEncryptionKeyFromEnv();

  if (!key) {
    throw new Error("BACKUP_ENCRYPTION_KEY_FILE is required");
  }

  if (command === "encrypt-manifest") {
    const backupDir = requireEnv("BACKUP_DIR");
    const manifestPath = requireEnv("BACKUP_MANIFEST_PATH");
    await encryptManifestArtifacts({
      backupDir,
      manifestPath,
      key,
      keepPlaintext: loadBackupEncryptionKeepPlaintextFromEnv(),
    });
    return;
  }

  if (command === "decrypt-file") {
    const inputPath = requireEnv("BACKUP_ENCRYPTED_INPUT");
    const outputPath = requireEnv("BACKUP_DECRYPTED_OUTPUT");
    await decryptFile({ inputPath, outputPath, key });
    return;
  }

  throw new Error("Usage: backup-encryption encrypt-manifest | decrypt-file");
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
