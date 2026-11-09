import type { DoctorOptions, DoctorReport } from "../../domain/indexing/diagnostics.js";
import type { ReportRow, UiContextPackSummary, UiCoverageSnapshot, UiGraphPreview, UiReportDeltaPolicy, UiWorkspaceSnapshot } from "./ui-model.js";

export interface UiReadSession {
  reports(): ReportRow[];
  report(id: string): ReportRow | null;
  previousReport(selected: ReportRow): ReportRow | null;
  coverage(): UiCoverageSnapshot | null;
  contextPacks(): UiContextPackSummary[];
  workspaces(): UiWorkspaceSnapshot[];
  close(): void;
}
export interface UiSnapshotPorts {
  normalizeRoot(root: string): string;
  doctor(options: DoctorOptions): DoctorReport;
  hasDatabase(root: string): boolean;
  openSession(root: string): UiReadSession;
  graphPreview(root: string, id: string): Promise<UiGraphPreview | null>;
  deltaPolicy(root: string): UiReportDeltaPolicy;
}
