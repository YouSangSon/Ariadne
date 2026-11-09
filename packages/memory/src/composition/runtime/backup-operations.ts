import { encryptManifestArtifacts as encrypt } from "../../application/operations/encrypt-backups.js";
import { verifyBackups as verify } from "../../application/operations/verify-backups.js";
import { createBackupEncryptionArtifacts, type EncryptManifestArtifactsInput } from "../../infrastructure/operations/backup-encryption.js";
import { createBackupVerificationArtifacts, type VerifyBackupsInput } from "../../infrastructure/operations/backup-verify.js";
export async function encryptManifestArtifacts(input: EncryptManifestArtifactsInput) { return encrypt(input, createBackupEncryptionArtifacts(input)); }
export async function verifyBackups(input: VerifyBackupsInput) { return verify({ now: input.now, ...createBackupVerificationArtifacts(input) }); }
export type { EncryptManifestArtifactsInput, VerifyBackupsInput };
