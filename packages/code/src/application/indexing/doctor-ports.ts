import type { IndexRunColumnState } from "../../domain/indexing/diagnostics-state.js";
import type { DoctorAdapterRun, DoctorCoverage, DoctorIndexRun, DoctorReport, DoctorTableState } from "../../domain/indexing/diagnostics.js";

export interface DoctorSession {
  tables(): DoctorTableState;
  schemaVersion(tables: DoctorTableState): number | null;
  vectorLoaded(): boolean;
  vecTables(): string[];
  factEmbeddingRows(): number;
  embeddingModels(): Array<{ model: string; rows: number; dim: number }>;
  repoId(): number | null;
  indexRunColumns(): IndexRunColumnState;
  latestIndexRun(repoId: number, completed: boolean, columns: IndexRunColumnState): DoctorIndexRun | null;
  coverage(id: number): DoctorCoverage;
  adapterRuns(id: number): DoctorAdapterRun[];
  canReadTelemetry(): boolean;
  telemetry(): DoctorReport['telemetry'];
  close(): void;
}
export interface DoctorPorts {
  requiredSchemaVersion: number;
  normalizeRoot(root: string): string;
  databasePath(root: string): string;
  exists(file: string): boolean;
  openSession(root: string): DoctorSession;
}
