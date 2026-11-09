import { graphFromReport } from "../../domain/impact/graph.js";
import type { GraphSnapshotReader } from "../../domain/impact/graph.js";
import type { GraphExport, GraphExportOptions, ImpactReport } from "../../domain/model.js";

export interface GraphSession extends GraphSnapshotReader {
  report(id: string): ImpactReport | null;
  close(): void;
}
export interface GraphExportPorts {
  normalizeRoot(root: string): string;
  openSession(root: string): GraphSession;
}
export async function exportImpactGraph(options: GraphExportOptions, ports: GraphExportPorts): Promise<GraphExport> {
  const root = ports.normalizeRoot(options.repoRoot);
  const session = ports.openSession(root);
  try {
    const report = session.report(options.reportId);
    if (!report) throw new Error(`impact report not found: ${options.reportId}`);
    return graphFromReport(report, options.format, session);
  } finally { session.close(); }
}
