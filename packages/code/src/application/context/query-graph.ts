import { parseGraphQuery } from "../../domain/context/graph-query.js";
import type { GraphQueryResult, ParsedGraphQuery } from "../../domain/context/graph-query.js";

export type GraphQueryExecutor = (root: string, query: ParsedGraphQuery) => GraphQueryResult;
export function executeGraphQuery(root: string, input: string, execute: GraphQueryExecutor): GraphQueryResult {
  return execute(root, parseGraphQuery(input));
}
