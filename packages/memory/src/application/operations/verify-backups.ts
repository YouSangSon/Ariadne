import type { BackupReplica, LocalBackupArtifacts } from "../ports/backup-artifacts.js";
import { type BackupManifest, manifestsEqual, parseManifest } from "./backup-verify-policy.js";
export type VerifyBackupReplicasInput = { now: Date; local: LocalBackupArtifacts; remote: BackupReplica };


export async function verifyBackups(
  input: VerifyBackupReplicasInput,
): Promise<{ manifestFileName: string; manifest: BackupManifest }> {
  const manifestFileName = await findLatestManifestFile(await input.local.manifestNames());
  const manifest = parseManifest(await input.local.readManifest(manifestFileName));
  const ageMs = input.now.getTime() - new Date(manifest.createdAt).getTime();
  const maxAgeMs = 24 * 60 * 60 * 1000;

  if (Number.isNaN(ageMs)) {
    throw new Error("latest successful backup manifest has an invalid createdAt");
  }

  if (ageMs > maxAgeMs) {
    throw new Error("latest successful backup is older than 24 hours");
  }

  await verifyLocalArtifact({
    artifact: manifest.postgres,
    artifactLabel: "Postgres dump",
    store: input.local,
  });
  if (manifest.qdrant) {
    await verifyLocalArtifact({
      artifact: manifest.qdrant,
      artifactLabel: "Qdrant snapshot",
      store: input.local,
    });
  }

  const remoteManifest = parseManifest(
    await input.remote.readManifest(manifestFileName),
  );

  if (!manifestsEqual(manifest, remoteManifest)) {
    throw new Error("off-box backup manifest does not match the latest local manifest");
  }

  await verifyRemoteArtifact({
    artifact: manifest.postgres,
    artifactLabel: "Postgres dump",
    store: input.remote,
  });
  if (manifest.qdrant) {
    await verifyRemoteArtifact({
      artifact: manifest.qdrant,
      artifactLabel: "Qdrant snapshot",
      store: input.remote,
    });
  }

  return {
    manifestFileName,
    manifest,
  };
}

async function verifyLocalArtifact(input: {
  artifact: { fileName: string; sha256: string };
  artifactLabel: string;
  store: BackupReplica;
}) {
  if (!(await input.store.artifactExists(input.artifact.fileName))) {
    throw new Error(`latest local ${input.artifactLabel.toLowerCase()} is missing`);
  }

  const actualSha = await input.store.checksum(input.artifact.fileName);

  if (actualSha !== input.artifact.sha256) {
    throw new Error(`${input.artifactLabel} checksum does not match the manifest`);
  }
}

async function verifyRemoteArtifact(input: {
  artifact: { fileName: string; sha256: string };
  artifactLabel: string;
  store: BackupReplica;
}) {
  if (!(await input.store.artifactExists(input.artifact.fileName))) {
    throw new Error(`latest off-box ${input.artifactLabel.toLowerCase()} is missing`);
  }

  const remoteSha = await input.store.checksum(input.artifact.fileName);

  if (remoteSha !== input.artifact.sha256) {
    throw new Error(`off-box ${input.artifactLabel.toLowerCase()} checksum does not match the manifest`);
  }
}

async function findLatestManifestFile(
  files: string[],
): Promise<string> {
  const manifestFile = files
    .filter((fileName) => /^manifest-\d{8}-\d{4}\.json$/.test(fileName))
    .sort()
    .at(-1);

  if (!manifestFile) {
    throw new Error("no backup manifest found in BACKUP_DIR");
  }

  return manifestFile;
}