import { contextPackResourceUri } from "../../domain/context/context-pack.js";
import type { PersistedContextPack } from "../../domain/context/context-pack.js";
import { byteLength } from "../../domain/context/evidence.js";
import { resourceCountOf } from "../../domain/context/telemetry.js";
import { contentHash } from "../../domain/identity.js";
import type { ContextPack } from "../../domain/model.js";
import type { ContextPackPorts } from "./pack-ports.js";
import type { McpContext } from "./request.js";

export function persistContextPackForReuse(
  context: McpContext,
  pack: ContextPack,
  request: {
    changedFiles: string[];
    maxDepth: number;
    maxFanout: number;
  },
  ports: ContextPackPorts
): { pack: PersistedContextPack; wasReused: boolean; fullBytes: number } {
  const packJsonForHash = JSON.stringify(pack);
  const hash = contentHash('context-pack-v0', packJsonForHash);
  const requestHash = contextPackRequestHash(context, pack, request, ports);
  const contextPackId = `ctxpack:${requestHash.slice(0, 32)}`;
  const resourceUri = contextPackResourceUri(contextPackId);
  const persistedPack: PersistedContextPack = {
    ...pack,
    contextPackId,
    resourceUri,
    contentHash: hash,
    reused: false,
    resources: {
      contextPack: resourceUri,
      ...pack.resources
    }
  };
  const packJson = JSON.stringify(persistedPack);
  const fullBytes = byteLength(packJson);
  const wasReused = ports.savePack(context.repoRoot, {
    contextPackId, pack, request, requestHash, hash, packJson, fullBytes,
    resourceCount: resourceCountOf(persistedPack)
  });

  return { pack: persistedPack, wasReused, fullBytes };
}

export const CONTEXT_PACK_CACHE_VERSION = 'context-pack-cache-v2';

export function contextPackRequestHash(
  context: McpContext,
  pack: ContextPack,
  request: {
    changedFiles: string[];
    maxDepth: number;
    maxFanout: number;
  },
  ports: ContextPackPorts
): string {
  const repoRoot = ports.normalizeRoot(context.repoRoot);
  const gitSnapshot = ports.gitSnapshot(repoRoot);
  const fileHashes = request.changedFiles
    .map((filePath) => ({
      path: filePath,
      hash: ports.fileContentHash(repoRoot, filePath)
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return contentHash(
    CONTEXT_PACK_CACHE_VERSION,
    String(pack.indexRunId),
    pack.budget,
    String(request.maxDepth),
    String(request.maxFanout),
    JSON.stringify(fileHashes),
    JSON.stringify(gitSnapshot)
  );
}