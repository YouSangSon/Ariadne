import { executeGraphQuery as query } from "../application/context/query-graph.js";
import { exportImpactGraph as exportGraph } from "../application/impact/export-graph.js";
import type { GraphExportOptions } from "../domain/model.js";
import { normalizeRepoRoot } from "../infrastructure/filesystem/security.js";
import { executeParsedGraphQuery } from "../infrastructure/sqlite/graph-query.js";
import { openGraphSession } from "../infrastructure/sqlite/graph.js";

export function exportImpactGraph(options: GraphExportOptions) {
  return exportGraph(options, { normalizeRoot: normalizeRepoRoot, openSession: openGraphSession });
}
export function executeGraphQuery(root: string, input: string) {
  return query(root, input, executeParsedGraphQuery);
}
export { parseGraphQuery } from '../domain/context/graph-query.js';
export type { GraphQueryResult,ParsedGraphQuery } from '../domain/context/graph-query.js';
