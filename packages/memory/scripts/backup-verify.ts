import { pathToFileURL } from "node:url";
import { runOperator } from "../src/interfaces/operators/backup-verify.js";
export { resolveBackupTargetDir } from "../src/application/operations/backup-verify-policy.js";
export { type VerifyBackupsInput } from "../src/infrastructure/operations/backup-verify.js";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOperator().catch((error: unknown) => { console.error(error); process.exit(1); });
}

export { verifyBackups } from "../src/composition/runtime/backup-operations.js";
