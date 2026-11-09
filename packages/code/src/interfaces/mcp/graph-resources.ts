import { typedMcpError } from "../../application/context/errors.js";
import { GraphPaginationInputError, paginateGraph } from "../../domain/impact/graph-pagination.js";
import type { GraphExport, GraphExportFormat } from "../../domain/model.js";

export function graphFormatVariable(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? value;
}

export function graphResourceText(uri: URL, graph: GraphExport, format: GraphExportFormat): string {
  if (format !== 'json') return graph.rendered;
  const requirePagination = uri.searchParams.has('limit') || uri.searchParams.has('cursor');
  try {
    const payload = paginateGraph(graph, {
      limit: uri.searchParams.get('limit'),
      cursor: uri.searchParams.get('cursor'),
      requirePagination
    });
    if (!requirePagination) return graph.rendered;
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    if (error instanceof GraphPaginationInputError) {
      throw typedMcpError(error, 'invalid_pagination');
    }
    throw error;
  }
}

export function parseGraphFormat(value: string): GraphExportFormat {
  if (value === 'json' || value === 'mermaid' || value === 'dot') return value;
  throw typedMcpError(new Error('graph resource format must be mermaid, json, or dot'), 'invalid_resource_format');
}