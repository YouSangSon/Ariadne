import path from "node:path";
import { pathToFileURL } from "node:url";
import { exportScipJson as exportIndex, importScipJson as importIndex } from "../application/indexing/scip.js";
import type { ScipPorts } from "../application/indexing/scip.js";
import { resolveScipInputPath } from "../domain/indexing/scip.js";
import type { ScipExportOptions, ScipImportOptions } from "../domain/indexing/scip.js";
import { parseScipInputFile } from "../infrastructure/filesystem/scip-input.js";
import { normalizeRepoRoot } from "../infrastructure/filesystem/security.js";
import { readScipGitBlob } from "../infrastructure/git/scip-snapshot.js";
import { openScipImport, readScipExportSnapshot } from "../infrastructure/sqlite/scip.js";

const ports: ScipPorts = {
  normalizeRoot: normalizeRepoRoot, inputPath: resolveScipInputPath, parseInput: parseScipInputFile,
  relativeInputPath: (root, file) => path.relative(root, file).split(path.sep).join('/'),
  openImport: openScipImport, gitBlob: readScipGitBlob, exportSnapshot: readScipExportSnapshot,
  projectRootUri: (root) => pathToFileURL(root.endsWith(path.sep) ? root : `${root}${path.sep}`).href
};
export function importScipJson(options: ScipImportOptions) { return importIndex(options, ports); }
export function exportScipJson(options: ScipExportOptions) { return exportIndex(options, ports); }
export type { ScipExportOptions,ScipExportResult,ScipImportOptions,ScipImportResult } from '../domain/indexing/scip.js';
