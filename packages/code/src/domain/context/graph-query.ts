export type GraphQueryPathLength = { min: number; max: number };

export type GraphQueryNode = { variable: string; label?: string };

export type GraphQueryRel = { variable?: string; type?: string; pathLength?: GraphQueryPathLength };

export type GraphQueryCondition = {
  variable: string;
  property: string;
  op: '=' | 'CONTAINS';
  value: string;
};

export type GraphQueryReturn = { variable: string; property?: string; count?: boolean };

export type GraphQueryOrder = { column: string; direction: 'ASC' | 'DESC' };

export type ParsedGraphQuery = {
  source: GraphQueryNode;
  relationship?: GraphQueryRel;
  target?: GraphQueryNode;
  where: GraphQueryCondition[];
  returns: GraphQueryReturn[];
  orderBy?: GraphQueryOrder[];
  limit?: number;
};

export type GraphQueryResult = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  // The completed index run the query executed against — makes a query result
  // measurable and pins it to a point in graph history.
  indexRunId: number;
  // Distinct entity ids the result projected, navigable via the
  // `parallax://entities/{id}` resource template. Populated only when a node's
  // `id` is actually returned (`RETURN a` / `RETURN a.id`) — you can only
  // navigate ids you returned.
  resources: { entities: string[] };
};

export const DEFAULT_LIMIT = 1000;

export const MAX_LIMIT = 10_000;

export const MAX_HOPS = 8;

export function parseGraphQuery(input: string): ParsedGraphQuery {
  const text = input.trim().replace(/\s+/g, ' ');
  if (!/^MATCH\b/i.test(text)) {
    throw new Error('unsupported query: only read-only MATCH ... RETURN is supported');
  }
  if (/\b(CREATE|MERGE|DELETE|SET|REMOVE|DETACH|CALL|FOREACH|LOAD|UNWIND|WITH)\b/i.test(text)) {
    throw new Error('unsupported query: write, procedure, and projection clauses are not allowed (read-only subset)');
  }

  const returnSplit = text.split(/\bRETURN\b/i);
  if (returnSplit.length !== 2) {
    throw new Error('query must contain exactly one RETURN clause');
  }
  const matchPart = returnSplit[0]!.replace(/^MATCH\b/i, '').trim();
  let returnPart = returnSplit[1]!.trim();

  let limit: number | undefined;
  const limitMatch = returnPart.match(/\bLIMIT\s+(\d+)\s*$/i);
  if (limitMatch) {
    limit = Math.min(Number(limitMatch[1]), MAX_LIMIT);
    returnPart = returnPart.slice(0, limitMatch.index).trim();
  }

  // ORDER BY sits between RETURN and LIMIT; strip it before parsing return items.
  let orderByPart = '';
  const orderByMatch = returnPart.match(/\bORDER\s+BY\b/i);
  if (orderByMatch) {
    orderByPart = returnPart.slice(orderByMatch.index! + orderByMatch[0].length).trim();
    returnPart = returnPart.slice(0, orderByMatch.index).trim();
  }

  const whereSplit = matchPart.split(/\bWHERE\b/i);
  if (whereSplit.length > 2) throw new Error('unsupported query: multiple WHERE clauses');
  const patternPart = whereSplit[0]!.trim();
  const wherePart = whereSplit.length === 2 ? whereSplit[1]!.trim() : '';

  const pattern = parsePattern(patternPart);
  const where = parseWhere(wherePart);
  const returns = parseReturns(returnPart);

  // A variable-length path has no single relationship binding, so its rel
  // variable is not projectable — omit it so RETURN/WHERE references error.
  const relVariable = pattern.relationship?.pathLength ? undefined : pattern.relationship?.variable;
  const variables = new Set(
    [pattern.source.variable, relVariable, pattern.target?.variable].filter(
      (value): value is string => typeof value === 'string'
    )
  );
  for (const condition of where) {
    if (!variables.has(condition.variable)) {
      throw new Error(`unknown variable in WHERE: ${condition.variable}`);
    }
  }
  for (const item of returns) {
    if (!variables.has(item.variable)) {
      throw new Error(`unknown variable in RETURN: ${item.variable}`);
    }
  }

  // A variable-length path produces a transitive reachability set, not a stable
  // per-edge row set, so COUNT over it is ill-defined — reject it explicitly.
  if (pattern.relationship?.pathLength && returns.some((item) => item.count)) {
    throw new Error('unsupported query: COUNT is not supported on variable-length paths');
  }

  // ORDER BY may only reference projected columns — safe and deterministic.
  const projectedColumns = new Set(returns.map(returnColumnName));
  const orderBy = parseOrderBy(orderByPart);
  for (const order of orderBy) {
    if (!projectedColumns.has(order.column)) {
      throw new Error(`ORDER BY column must be in RETURN: ${order.column}`);
    }
  }

  return {
    source: pattern.source,
    ...(pattern.relationship ? { relationship: pattern.relationship } : {}),
    ...(pattern.target ? { target: pattern.target } : {}),
    where,
    returns,
    ...(orderBy.length > 0 ? { orderBy } : {}),
    ...(limit !== undefined ? { limit } : {})
  };
}

export function parseOrderBy(text: string): GraphQueryOrder[] {
  if (!text) return [];
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(
        /^(COUNT\s*\(\s*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\s*\)|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)(?:\s+(ASC|DESC))?$/i
      );
      if (!match) {
        throw new Error(
          `unsupported ORDER BY item: ${part} (expected var[.prop] or COUNT(var[.prop]) [ASC|DESC])`
        );
      }
      const direction = match[2]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      return { column: normalizeOrderColumn(match[1]!), direction };
    });
}

export function normalizeOrderColumn(raw: string): string {
  const count = raw.match(/^COUNT\s*\(\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*\)$/i);
  return count ? `COUNT(${count[1]})` : raw;
}

export const NODE = '\\(\\s*([A-Za-z_]\\w*)\\s*(?::\\s*([A-Za-z_]\\w*))?\\s*\\)';

export const REL = '\\[\\s*([A-Za-z_]\\w*)?\\s*(?::\\s*([A-Za-z_]\\w*))?\\s*(\\*\\d*(?:\\.\\.\\d+)?)?\\s*\\]';

export const FORWARD_HOP = new RegExp(`^${NODE}\\s*-\\s*${REL}\\s*->\\s*${NODE}$`);

export const REVERSE_HOP = new RegExp(`^${NODE}\\s*<-\\s*${REL}\\s*-\\s*${NODE}$`);

export const NODE_ONLY = new RegExp(`^${NODE}$`);

export function relationship(variable: string | undefined, type: string | undefined, pathToken: string | undefined): GraphQueryRel {
  const pathLength = parsePathLength(pathToken);
  return {
    ...(variable ? { variable } : {}),
    ...(type ? { type } : {}),
    ...(pathLength ? { pathLength } : {})
  };
}

export function parsePathLength(token: string | undefined): GraphQueryPathLength | undefined {
  if (!token) return undefined;
  const body = token.slice(1); // strip leading '*'
  if (body === '') return { min: 1, max: MAX_HOPS };
  const range = body.match(/^(\d*)\.\.(\d+)$/);
  if (range) {
    const min = range[1] === '' ? 1 : Number(range[1]);
    const max = Math.min(Number(range[2]), MAX_HOPS);
    if (min < 1 || max < min) throw new Error(`invalid path length: ${token}`);
    return { min, max };
  }
  const exact = Number(body);
  if (!Number.isInteger(exact) || exact < 1) throw new Error(`invalid path length: ${token}`);
  return { min: exact, max: Math.min(exact, MAX_HOPS) };
}

export function parsePattern(text: string): Pick<ParsedGraphQuery, 'source' | 'relationship' | 'target'> {
  if (text.includes('<-') && text.includes('->')) {
    throw new Error('unsupported query: bidirectional relationships are not supported');
  }
  const forward = text.match(FORWARD_HOP);
  if (forward) {
    return {
      source: { variable: forward[1]!, ...(forward[2] ? { label: forward[2] } : {}) },
      relationship: relationship(forward[3], forward[4], forward[5]),
      target: { variable: forward[6]!, ...(forward[7] ? { label: forward[7] } : {}) }
    };
  }
  // Reverse: (head)<-[r]-(tail) means tail -> head; normalize so the executor
  // sees the relation's true source (tail) and target (head).
  const reverse = text.match(REVERSE_HOP);
  if (reverse) {
    return {
      source: { variable: reverse[6]!, ...(reverse[7] ? { label: reverse[7] } : {}) },
      relationship: relationship(reverse[3], reverse[4], reverse[5]),
      target: { variable: reverse[1]!, ...(reverse[2] ? { label: reverse[2] } : {}) }
    };
  }
  const nodeOnly = text.match(NODE_ONLY);
  if (nodeOnly) {
    return { source: { variable: nodeOnly[1]!, ...(nodeOnly[2] ? { label: nodeOnly[2] } : {}) } };
  }
  throw new Error('unsupported MATCH pattern: expected (a), (a:Label), (a)-[r:TYPE]->(b), (a)<-[r:TYPE]-(b), or variable-length (a)-[r:TYPE*1..3]->(b)');
}

export function parseWhere(text: string): GraphQueryCondition[] {
  if (!text) return [];
  return text
    .split(/\bAND\b/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s+(=|CONTAINS)\s+'([^']*)'$/i);
      if (!match) {
        throw new Error(
          `unsupported WHERE condition: ${part} (expected var.prop = 'value' or var.prop CONTAINS 'value')`
        );
      }
      const op = match[3]!.toUpperCase() === 'CONTAINS' ? 'CONTAINS' : '=';
      return { variable: match[1]!, property: match[2]!, op, value: match[4]! };
    });
}

export function parseReturns(text: string): GraphQueryReturn[] {
  if (!text) throw new Error('RETURN requires at least one item');
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const countMatch = item.match(/^COUNT\s*\(\s*(.+?)\s*\)$/i);
      if (countMatch) {
        const inner = countMatch[1]!;
        const innerMatch = inner.match(/^([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?$/);
        if (!innerMatch) {
          throw new Error(
            `unsupported RETURN item: COUNT(${inner}) — only COUNT(<var>) or COUNT(<var>.<prop>) is supported (COUNT(*) is not)`
          );
        }
        return { variable: innerMatch[1]!, ...(innerMatch[2] ? { property: innerMatch[2] } : {}), count: true };
      }
      const match = item.match(/^([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?$/);
      if (!match) throw new Error(`unsupported RETURN item: ${item}`);
      return { variable: match[1]!, ...(match[2] ? { property: match[2] } : {}) };
    });
}

export function returnColumnName(item: GraphQueryReturn): string {
  const base = item.property ? `${item.variable}.${item.property}` : item.variable;
  return item.count ? `COUNT(${base})` : base;
}