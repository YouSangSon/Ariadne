import type { GraphExport, GraphExportOptions } from "../../domain/model.js";
import type { UiGraphPreview } from "./ui-model.js";

export async function graphPreview(repoRoot: string, reportId: string, exportImpactGraph: (options: GraphExportOptions) => Promise<GraphExport>): Promise<UiGraphPreview | null> {
  try {
    const graph = await exportImpactGraph({ repoRoot, reportId, format: 'json' });
    return {
      nodes: graph.nodes.slice(0, 80),
      edges: graph.edges.slice(0, 80),
      totalNodes: graph.nodes.length,
      totalEdges: graph.edges.length
    };
  } catch {
    return null;
  }
}
