import { contextForChange as build } from "../application/context/context-for-change.js";
import type { ContextForChangeOptions, ContextPackReusePolicy } from "../domain/model.js";
import { changedFileContentHash } from "../infrastructure/filesystem/context-sources.js";
import { normalizeRepoRoot } from "../infrastructure/filesystem/security.js";
import { readGitSnapshot } from "../infrastructure/git/snapshot.js";
import { indexRunAsOfIso, saveContextPack } from "../infrastructure/sqlite/context-packs.js";
import { queryCoChanges } from "./co-changes.js";
import { analysisPorts } from "./impact.js";

export function contextForChange(options: ContextForChangeOptions & { reusePolicy?: ContextPackReusePolicy }) {
  return build(options, {
    analysis: analysisPorts, asOfIso: (root, id) => indexRunAsOfIso({ repoRoot: root }, id), coChanges: queryCoChanges,
    packs: { normalizeRoot: normalizeRepoRoot, gitSnapshot: readGitSnapshot, fileContentHash: changedFileContentHash, savePack: saveContextPack }
  });
}
