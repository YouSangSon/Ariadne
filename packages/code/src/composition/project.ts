import { existsSync } from "node:fs";
import { ingestTraces as ingest } from "../application/impact/promote-traces.js";
import { doctorProject as doctor } from "../application/indexing/doctor.js";
import { initProject as initialize } from "../application/indexing/init-project.js";
import type { ObservedEdge } from "../domain/impact/traces.js";
import type { DoctorOptions } from "../domain/indexing/diagnostics.js";
import type { InitOptions } from "../domain/model.js";
import { initializeConfig, initializeStore } from "../infrastructure/filesystem/init.js";
import { normalizeRepoRoot } from "../infrastructure/filesystem/security.js";
import { openDoctorSession, REQUIRED_SCHEMA_VERSION } from "../infrastructure/sqlite/doctor.js";
import { databasePath } from "../infrastructure/sqlite/store.js";
import { openTraceWriter } from "../infrastructure/sqlite/trace-ingest.js";

export function doctorProject(options: DoctorOptions) {
  return doctor(options, { normalizeRoot: normalizeRepoRoot, requiredSchemaVersion: REQUIRED_SCHEMA_VERSION, databasePath, exists: existsSync, openSession: openDoctorSession });
}
export function initProject(options: InitOptions) {
  return initialize(options, { normalizeRoot: normalizeRepoRoot, initializeConfig, initializeStore });
}
export function ingestTraces(root: string, edges: readonly ObservedEdge[]) { return ingest(root, edges, openTraceWriter); }
export { parseTraceInput } from '../domain/impact/traces.js';
export type { ObservedEdge,TraceIngestSummary } from '../domain/impact/traces.js';
export { hasDoctorErrors,redactDoctorReportForMcp } from '../domain/indexing/diagnostics.js';
export type { DoctorFinding,DoctorOptions,DoctorReport } from '../domain/indexing/diagnostics.js';
export { REQUIRED_SCHEMA_VERSION } from '../infrastructure/sqlite/doctor.js';
