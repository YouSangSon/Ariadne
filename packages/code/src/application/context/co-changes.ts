import { coChangeResult, DEFAULT_LIMIT, FILE_PREFIX, MAX_LIMIT } from "../../domain/context/co-change.js";
import type { CoChangeQueryOptions, CoChangeQueryResult, CoChangeRow } from "../../domain/context/co-change.js";

export type CoChangeRowsReader = (root: string, target: string) => { indexRunId: number; rows: CoChangeRow[] };
export function queryCoChanges(root: string, file: string, options: CoChangeQueryOptions, read: CoChangeRowsReader): CoChangeQueryResult {
  const target = file.startsWith(FILE_PREFIX) ? file.slice(FILE_PREFIX.length) : file;
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const snapshot = read(root, target);
  return coChangeResult(snapshot.rows, target, snapshot.indexRunId, limit);
}
