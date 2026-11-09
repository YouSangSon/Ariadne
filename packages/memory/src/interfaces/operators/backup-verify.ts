import path from "node:path";
import { resolveBackupTargetDir } from "../../application/operations/backup-verify-policy.js";
import { verifyBackups } from "../../composition/runtime/backup-operations.js";
import { runRemote, shellQuote, } from "../../infrastructure/operations/backup-verify.js";


export async function runOperator() {
  const backupDir = requireEnv("BACKUP_DIR");
  const targetHost = requireEnv("BACKUP_TARGET_HOST");
  const targetDir = resolveBackupTargetDir(process.env, backupDir);
  const remotePath = (fileName: string) => path.posix.join(targetDir, fileName);

  await verifyBackups({
    now: new Date(),
    backupDir,
    remoteReadTextFile(fileName) {
      return runRemote(targetHost, `cat ${shellQuote(remotePath(fileName))}`);
    },
    async remoteFileExists(fileName) {
      try {
        await runRemote(
          targetHost,
          `test -f ${shellQuote(remotePath(fileName))} && printf ok`,
        );
        return true;
      } catch (_err: unknown) {
        return false;
      }
    },
    remoteSha256File(fileName) {
      return runRemote(
        targetHost,
        `if command -v sha256sum >/dev/null 2>&1; then sha256sum ${shellQuote(remotePath(fileName))} | awk '{print $1}'; else shasum -a 256 ${shellQuote(remotePath(fileName))} | awk '{print $1}'; fi`,
      );
    },
  });

  console.log("backup verification passed");
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}
