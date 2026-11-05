export type TypedMcpErrorEnvelope = {
  error: {
    code: string;
    problem: string;
    cause: string;
    fix: string;
    evidence: Array<{ kind: string; id?: string; uri?: string }>;
  };
};

export function typedMcpError(error: unknown, fallbackCode = 'parallax_error'): Error {
  return new Error(JSON.stringify(typedMcpErrorEnvelope(error, fallbackCode)));
}

export function typedMcpErrorEnvelope(error: unknown, fallbackCode = 'parallax_error'): TypedMcpErrorEnvelope {
  const message = errorMessage(error);
  const existing = parseTypedMcpError(message);
  if (existing) return existing;

  const normalized = message.toLowerCase();
  let code = fallbackCode;
  let cause = 'Parallax could not complete the requested MCP operation.';
  let fix = 'Check the request arguments, refresh the local index if needed, then retry the MCP call.';

  if (normalized.includes('outside repo root') || normalized.includes('resolves outside')) {
    code = 'path_outside_repo';
    cause = 'A requested path resolves outside the current repository root.';
    fix = 'Use a repo-relative path inside the current repository and rerun the request.';
  } else if (normalized.includes('not found')) {
    code = 'resource_not_found';
    cause = 'The requested Parallax resource was not found in the local index or report store.';
    fix = 'Refresh resources/list, rerun index/analyze if needed, and use a current resource URI.';
  } else if (normalized.includes('graph resource format')) {
    code = 'invalid_resource_format';
    cause = 'The graph resource format is not one of the formats Parallax can render.';
    fix = 'Use one of: mermaid, json, dot.';
  } else if (normalized.includes('graph page limit') || normalized.includes('graph page cursor')) {
    code = 'invalid_pagination';
    cause = 'The graph JSON resource pagination query is malformed.';
    fix = 'Use a positive integer limit up to 500 and pass cursor values returned by the previous page.';
  } else if (
    normalized.includes('search query must not be empty') ||
    (normalized.includes('parallax_search_context') && normalized.includes('query') && normalized.includes('too small'))
  ) {
    code = 'empty_search_query';
    cause = 'The search context tool received an empty query after trimming whitespace.';
    fix = 'Provide a non-empty keyword, path, symbol, relation kind, or evidence snippet.';
  } else if (normalized.includes('no completed index found') || normalized.includes('repo is not indexed')) {
    code = 'index_not_ready';
    cause = 'The repository does not have a completed Parallax index yet.';
    fix = 'Run parallax init and parallax index, then retry the MCP request.';
  } else if (normalized.includes('requires parallax schema v') || normalized.includes('database schema is v')) {
    code = 'schema_outdated';
    cause = 'The local Parallax database is older than the current tool contract.';
    fix = 'Run parallax init with the current build to apply additive migrations.';
  } else if (normalized.includes('must be') || normalized.includes('between')) {
    code = 'invalid_tool_input';
    cause = 'The MCP tool arguments do not match the Parallax input contract.';
    fix = 'Correct the argument type or allowed range, then retry the tool call.';
  }

  return {
    error: {
      code,
      problem: message,
      cause,
      fix,
      evidence: []
    }
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown Parallax MCP error';
}

export function parseTypedMcpError(message: string): TypedMcpErrorEnvelope | null {
  try {
    const parsed = JSON.parse(message) as Partial<TypedMcpErrorEnvelope>;
    if (
      parsed.error &&
      typeof parsed.error.code === 'string' &&
      typeof parsed.error.problem === 'string' &&
      typeof parsed.error.cause === 'string' &&
      typeof parsed.error.fix === 'string' &&
      Array.isArray(parsed.error.evidence)
    ) {
      return parsed as TypedMcpErrorEnvelope;
    }
  } catch {
    return null;
  }
  return null;
}