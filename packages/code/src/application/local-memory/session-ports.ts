import type { PersistSessionInput, PersistSessionResult, ResolvedSessionFile } from "../../domain/local-memory/session.js";

export interface SessionImportPorts {
  normalizeRoot(root: string): string;
  hasDatabase(root: string): boolean;
  resolveSessionFile(root: string, file: string): ResolvedSessionFile;
  readText(path: string): Promise<string>;
  referencedFiles(root: string, text: string): string[];
  persist(root: string, input: PersistSessionInput): PersistSessionResult;
}
