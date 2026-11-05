import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type VerifyBackupsInput = {
  now: Date;
  backupDir: string;
  readDir?: (directory: string) => Promise<string[]>;
  readTextFile?: (filePath: string) => Promise<string>;
  fileExists?: (filePath: string) => Promise<boolean>;
  sha256File?: (filePath: string) => Promise<string>;
  remoteReadTextFile: (fileName: string) => Promise<string>;
  remoteFileExists: (fileName: string) => Promise<boolean>;
  remoteSha256File: (fileName: string) => Promise<string>;
};

async function computeSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);

  stream.on("data", (chunk) => {
    hash.update(chunk);
  });

  await once(stream, "end");

  return hash.digest("hex");
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function runRemote(host: string, command: string): Promise<string> {
  const result = await execFileAsync(
    "ssh",
    [host, "sh", "-lc", command],
    { encoding: "utf8" },
  );

  return result.stdout.trim();
}
export function createBackupVerificationArtifacts(input: VerifyBackupsInput): { local: import("../../application/ports/backup-artifacts.js").LocalBackupArtifacts; remote: import("../../application/ports/backup-artifacts.js").BackupReplica } {
  const readDir = input.readDir ?? ((directory: string) => fsp.readdir(directory));
  const readTextFile = input.readTextFile ?? ((filePath: string) => fsp.readFile(filePath, "utf8"));
  const fileExists = input.fileExists ?? (async (filePath: string) => { try { await fsp.access(filePath, fs.constants.F_OK); return true; } catch (_err: unknown) { return false; } });
  const sha256File = input.sha256File ?? computeSha256;
  return {
    local: {
      manifestNames: () => readDir(input.backupDir),
      readManifest: (name) => readTextFile(path.join(input.backupDir, name)),
      artifactExists: (name) => fileExists(path.join(input.backupDir, name)),
      checksum: (name) => sha256File(path.join(input.backupDir, name)),
    },
    remote: { readManifest: input.remoteReadTextFile, artifactExists: input.remoteFileExists, checksum: input.remoteSha256File },
  };
}
