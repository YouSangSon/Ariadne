import { pathToFileURL } from "node:url";
import { runOperator } from "../src/interfaces/operators/backup-encryption.js";
export { decryptFile, encryptFile, loadBackupEncryptionKeepPlaintextFromEnv, loadBackupEncryptionKeyFromEnv, parseEncryptionKey, type EncryptManifestArtifactsInput } from "../src/infrastructure/operations/backup-encryption.js";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOperator().catch((error: unknown) => { console.error(error); process.exit(1); });
}

export { encryptManifestArtifacts } from "../src/composition/runtime/backup-operations.js";
