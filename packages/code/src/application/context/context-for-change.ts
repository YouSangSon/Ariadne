import type { CoChangePartner } from "../../domain/context/co-change.js";
import { buildContextPack, contextBudgetPreset, contextPackReference, normalizeContextBudget, normalizeContextPackReusePolicy } from "../../domain/context/context-pack.js";
import type { ContextForChangeOptions, ContextPackReusePolicy } from "../../domain/model.js";
import { analyzeDiff } from "../impact/analyze.js";
import type { AnalysisPorts } from "../impact/analyze.js";
import { selectCoChangePartners } from "./co-change-partners.js";
import type { ContextPackPorts } from "./pack-ports.js";
import { persistContextPackForReuse } from "./persist-pack.js";

export interface ContextForChangePorts {
  analysis: AnalysisPorts;
  packs: ContextPackPorts;
  asOfIso(root: string, runId: number): string;
  coChanges(root: string, file: string): { partners: CoChangePartner[] };
}
export async function contextForChange(options: ContextForChangeOptions & { reusePolicy?: ContextPackReusePolicy }, ports: ContextForChangePorts) {
  const budget = normalizeContextBudget(options.budget);
  const reusePolicy = normalizeContextPackReusePolicy(options.reusePolicy);
  const preset = contextBudgetPreset(budget);
  const report = await analyzeDiff({
    repoRoot: options.repoRoot, changedFiles: options.changedFiles, persistReport: false, readOnly: true,
    maxDepth: options.maxDepth ?? preset.maxDepth, maxFanout: options.maxFanout ?? preset.maxFanout
  }, ports.analysis);
  const pack = buildContextPack(report, budget, ports.asOfIso(options.repoRoot, report.indexRunId), selectCoChangePartners(options.repoRoot, report.changedFiles, ports.coChanges));
  const persisted = persistContextPackForReuse({ repoRoot: options.repoRoot }, pack, {
    changedFiles: report.changedFiles, maxDepth: options.maxDepth ?? preset.maxDepth, maxFanout: options.maxFanout ?? preset.maxFanout
  }, ports.packs);
  const response = reusePolicy === 'reference' || (reusePolicy === 'auto' && persisted.wasReused)
    ? contextPackReference(persisted.pack, report.changedFiles, persisted.fullBytes) : persisted.pack;
  return { response, changedFiles: report.changedFiles };
}
