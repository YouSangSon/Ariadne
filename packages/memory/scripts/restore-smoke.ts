import { pathToFileURL } from "node:url";
import { runOperator } from "../src/interfaces/operators/restore-smoke.js";
export { buildRestoreSmokeToolInput, parseRestoreBackupManifest, readRestoreSmokeToolResult, resolveOptionalRestoreSmokeTextEnv, resolveRestoreSmokeTextEnv, runRestoreSmoke, type BackupManifest, type RestoreSmokeToolInput, type RunRestoreSmokeInput } from "../src/application/operations/restore-smoke-policy.js";
export { buildRestoreSmokeCommandEnv, type BuildRestoreSmokeCommandEnvInput } from "../src/infrastructure/operations/restore-smoke.js";
export { resolveRestoreAppPort } from "../src/interfaces/operators/restore-smoke.js";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOperator().catch((error: unknown) => { console.error(error); process.exit(1); });
}
