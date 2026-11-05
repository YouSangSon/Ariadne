import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { importSession as importUseCase } from "../application/local-memory/import-session.js";
import type { SessionImportOptions } from "../domain/local-memory/session.js";
import { normalizeRepoRoot } from "../infrastructure/filesystem/security.js";
import { extractReferencedRepoFiles, resolveSessionFile } from "../infrastructure/filesystem/session-import.js";
import { persistSessionFacts } from "../infrastructure/sqlite/session-import.js";
import { databasePath } from "../infrastructure/sqlite/store.js";

export function importSession(options: SessionImportOptions) {
  return importUseCase(options, {
    normalizeRoot: normalizeRepoRoot,
    hasDatabase: (root) => existsSync(databasePath(root)),
    resolveSessionFile,
    readText: (file) => readFile(file, 'utf8'),
    referencedFiles: extractReferencedRepoFiles,
    persist: persistSessionFacts
  });
}
export type { SessionImportFormat,SessionImportOptions,SessionImportResult,SessionImportSource } from '../domain/local-memory/session.js';
