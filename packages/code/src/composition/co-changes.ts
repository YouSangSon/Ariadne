import { queryCoChanges as query } from "../application/context/co-changes.js";
import type { CoChangeQueryOptions } from "../domain/context/co-change.js";
import { readCoChangeRows } from "../infrastructure/sqlite/co-change-query.js";

export function queryCoChanges(root: string, file: string, options: CoChangeQueryOptions = {}) { return query(root, file, options, readCoChangeRows); }
export type { CoChangePartner,CoChangeQueryOptions,CoChangeQueryResult } from '../domain/context/co-change.js';
