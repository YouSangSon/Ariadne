import { arrayField, collectDefinitions, collectReferences, loadScipDocuments, projectScipExport } from "../../domain/indexing/scip.js";
import type { ExportDocumentBucket, ScipDefinition, ScipDocument, ScipExportOptions, ScipExportResult, ScipImportOptions, ScipImportResult, ScipImportSnapshot, ScipReference } from "../../domain/indexing/scip.js";

export interface ScipImportSession {
  readonly indexRunId: number;
  readonly snapshot: ScipImportSnapshot;
  publish(documents: ScipDocument[], definitions: Map<string, ScipDefinition>, references: ScipReference[]): { adapterRunId: number; relationsImported: number };
  close(): void;
}
export interface ScipPorts {
  normalizeRoot(root: string): string;
  inputPath(root: string, file: string): string;
  parseInput(file: string): Record<string, unknown>;
  relativeInputPath(root: string, file: string): string;
  openImport(root: string): ScipImportSession;
  gitBlob(root: string, commitSha: string, file: string): string | undefined;
  exportSnapshot(root: string): { indexRunId: number; documents: Map<string, ExportDocumentBucket> };
  projectRootUri(root: string): string;
}

export function importScipJson(options: ScipImportOptions, ports: ScipPorts): ScipImportResult {
  const root = ports.normalizeRoot(options.repoRoot);
  const inputPath = ports.inputPath(root, options.file);
  const parsed = ports.parseInput(inputPath);
  const input = arrayField(parsed, 'documents');
  const session = ports.openImport(root);
  try {
    const warnings: string[] = [];
    const documents = loadScipDocuments(root, input, session.snapshot, warnings, ports.gitBlob);
    const definitions = collectDefinitions(documents);
    const references = collectReferences(documents, definitions);
    const published = session.publish(documents, definitions, references.items);
    return {
      indexRunId: session.indexRunId,
      adapterRunId: published.adapterRunId,
      file: ports.relativeInputPath(root, inputPath),
      documentsImported: documents.length,
      definitionsImported: definitions.size,
      referencesSeen: references.items.length + references.skipped,
      relationsImported: published.relationsImported,
      skippedReferences: references.skipped,
      warnings: [...new Set(warnings)].sort()
    };
  } finally { session.close(); }
}

export function exportScipJson(options: ScipExportOptions, ports: ScipPorts): ScipExportResult {
  const root = ports.normalizeRoot(options.repoRoot);
  const snapshot = ports.exportSnapshot(root);
  return projectScipExport(snapshot.indexRunId, snapshot.documents, ports.projectRootUri(root));
}
