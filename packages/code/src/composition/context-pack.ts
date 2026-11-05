import { selectCoChangePartners as select } from "../application/context/co-change-partners.js";
import { queryCoChanges } from "./co-changes.js";

export function selectCoChangePartners(root: string, changedFiles: string[]) {
  return select(root, changedFiles, queryCoChanges);
}
export * from '../domain/context/context-pack.js';
export { changedFileContentHash } from '../infrastructure/filesystem/context-sources.js';
