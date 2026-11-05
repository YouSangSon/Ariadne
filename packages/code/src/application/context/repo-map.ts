import type { CoChangePartner } from "../../domain/context/co-change.js";
import { buildContextPack } from "../../domain/context/context-pack.js";
import { fitRepoMapToBudget, normalizeRepoMapBudget, repoMapFromContextPack } from "../../domain/context/repo-map.js";
import type { RepoMap, RepoMapOptions, RepoMapQueryMatch } from "../../domain/model.js";
import { analyzeDiff } from "../impact/analyze.js";
import type { AnalysisPorts } from "../impact/analyze.js";
import { selectCoChangePartners } from "./co-change-partners.js";
import type { ContextSearchPorts } from "./search-ports.js";
import { searchContext } from "./search.js";

export interface RepoMapPorts {
  normalizeRoot(root: string): string;
  analysis: AnalysisPorts;
  search: ContextSearchPorts;
  coChanges(root: string, file: string): { partners: CoChangePartner[] };
  packageRoots(root: string): (file: string) => string;
}
export async function buildRepoMap(options: RepoMapOptions, ports: RepoMapPorts): Promise<RepoMap> {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  const budgetTokens = normalizeRepoMapBudget(options.budgetTokens);
  const report = await analyzeDiff({
    repoRoot,
    changedFiles: options.changedFiles,
    persistReport: false,
    readOnly: true,
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.maxFanout === undefined ? {} : { maxFanout: options.maxFanout })
  }, ports.analysis);
  const pack = buildContextPack(
    report,
    'deep',
    new Date().toISOString(),
    selectCoChangePartners(repoRoot, report.changedFiles, ports.coChanges)
  );
  const queryResult = options.query ? repoMapQueryMatches(repoRoot, options.query, ports.search) : { matches: [], omitted: 0 };
  const map = repoMapFromContextPack(pack, {
    rootForPath: ports.packageRoots(repoRoot),
    changedFiles: report.changedFiles,
    query: options.query,
    queryMatches: queryResult.matches,
    omittedQueryMatches: queryResult.omitted,
    budgetTokens
  });
  return fitRepoMapToBudget(map, budgetTokens);
}

export function repoMapQueryMatches(repoRoot: string, query: string, searchPorts: ContextSearchPorts): { matches: RepoMapQueryMatch[]; omitted: number } {
  const result = searchContext({ repoRoot }, {
    query,
    k: 8,
    includeEvidence: true,
    budget: 'brief',
    disabledStreams: new Set(),
    semanticEmbedding: null
  }, searchPorts) as {
    results?: Array<RepoMapQueryMatch & { score?: number }>;
    omittedCounts?: { entities?: number; evidence?: number };
  };
  const matches = (result.results ?? []).map((item) => ({
    entity: item.entity,
    ...(item.score === undefined ? {} : { score: item.score }),
    ...(item.reasons === undefined ? {} : { reasons: item.reasons }),
    resourceUri: item.resourceUri,
    ...(item.evidence === undefined ? {} : { evidence: item.evidence })
  }));
  return {
    matches,
    omitted: result.omittedCounts?.entities ?? 0
  };
}
