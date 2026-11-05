

export { contentHash } from "./domain/identity.js";
export { CURRENT_SCHEMA_VERSION,assertCurrentSchema,databasePath,ensureImpactDir,ensureRepo,ensureVecTable,getRepoId,hasVecTable,impactDir,isVectorExtensionLoaded,latestCompletedIndexRun,loadVectorExtension,openDatabase,vecTableName } from "./infrastructure/sqlite/store.js";
export type { Db } from "./infrastructure/sqlite/store.js";
