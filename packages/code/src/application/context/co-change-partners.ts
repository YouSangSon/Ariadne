import type { CoChangePartner } from "../../domain/context/co-change.js";
import { entityForContextPath, entityResourceUri } from "../../domain/context/context-pack.js";
import type { Confidence, ContextPackCoChange } from "../../domain/model.js";

type CoChangeReader = (root: string, file: string) => { partners: CoChangePartner[] };
export function normalizeCoChangeConfidence(value: string): Confidence {
  return value === 'proven' || value === 'inferred' || value === 'unknown' ? value : 'heuristic';
}

export function selectCoChangePartners(
  repoRoot: string,
  changedFiles: string[],
  queryCoChanges: CoChangeReader
): ContextPackCoChange[] {
  const changedSet = new Set(changedFiles);
  const strongest = new Map<string, ContextPackCoChange>();
  for (const changedFile of changedFiles) {
    let partners;
    try {
      partners = queryCoChanges(repoRoot, changedFile).partners;
    } catch {
      continue;
    }
    for (const partner of partners) {
      if (changedSet.has(partner.path)) continue;
      const entry: ContextPackCoChange = {
        changedFile,
        partner: partner.path,
        coChangeCount: partner.coChangeCount,
        couplingScore: partner.couplingScore,
        confidence: normalizeCoChangeConfidence(partner.confidence),
        resourceUri: entityResourceUri(entityForContextPath(partner.path))
      };
      const existing = strongest.get(partner.path);
      if (!existing || entry.couplingScore > existing.couplingScore) {
        strongest.set(partner.path, entry);
      }
    }
  }
  return [...strongest.values()].sort(
    (a, b) =>
      b.couplingScore - a.couplingScore ||
      b.coChangeCount - a.coChangeCount ||
      a.partner.localeCompare(b.partner)
  );
}
