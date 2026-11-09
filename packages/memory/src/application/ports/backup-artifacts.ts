import type { BackupManifest } from "../operations/backup-encryption-policy.js";
export type BackupReplica = {
  readManifest(name: string): Promise<string>;
  artifactExists(name: string): Promise<boolean>;
  checksum(name: string): Promise<string>;
};
export type LocalBackupArtifacts = BackupReplica & { manifestNames(): Promise<string[]> };
export type BackupEncryptionArtifacts = {
  readManifest(): Promise<string>;
  encryptArtifact(input: { sourceFileName: string; encryptedFileName: string; key: Buffer; randomBytes?: (size: number) => Buffer }): Promise<void>;
  checksum(name: string): Promise<string>;
  writeChecksum(name: string, checksum: string): Promise<void>;
  removePlainArtifact(name: string): Promise<void>;
  commitManifest(manifest: BackupManifest): Promise<void>;
};
