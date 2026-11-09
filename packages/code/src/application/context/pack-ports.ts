import type { GitSnapshot } from "../../domain/indexing/git-snapshot.js";
import type { ContextPack } from "../../domain/model.js";

export interface ContextPackWrite {
  contextPackId: string;
  pack: ContextPack;
  request: { changedFiles: string[]; maxDepth: number; maxFanout: number };
  requestHash: string;
  hash: string;
  packJson: string;
  fullBytes: number;
  resourceCount: number;
}
export interface ContextPackPorts {
  normalizeRoot(root: string): string;
  gitSnapshot(root: string): GitSnapshot;
  fileContentHash(root: string, file: string): string;
  savePack(root: string, input: ContextPackWrite): boolean;
}
