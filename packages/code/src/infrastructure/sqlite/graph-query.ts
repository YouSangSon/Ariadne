import { DEFAULT_LIMIT, returnColumnName } from "../../domain/context/graph-query.js";
import type { GraphQueryNode, GraphQueryResult, ParsedGraphQuery } from "../../domain/context/graph-query.js";
import { normalizeRepoRoot } from "../filesystem/security.js";
import { getRepoId, latestCompletedIndexRun, openDatabase } from "./store.js";

function entityColumn(property: string | undefined): string {
  switch (property) {
    case undefined:
    case 'id':
      return 'id';
    case 'path':
      return 'path';
    case 'kind':
      return 'kind';
    case 'name':
    case 'displayName':
    case 'display_name':
      return 'display_name';
    case 'symbol':
      return 'symbol';
    case 'language':
    case 'languageId':
      return 'language_id';
    default:
      throw new Error(`unsupported node property: ${property}`);
  }
}

function relationshipColumn(property: string | undefined): string {
  switch (property) {
    case undefined:
    case 'kind':
      return 'kind';
    case 'confidence':
      return 'confidence';
    case 'provenance':
      return 'provenance';
    default:
      throw new Error(`unsupported relationship property: ${property}`);
  }
}

export function executeParsedGraphQuery(repoRoot: string, query: ParsedGraphQuery): GraphQueryResult {
  const root = normalizeRepoRoot(repoRoot);
  const db = openDatabase(root, { readOnly: true });
  try {
    const repoId = getRepoId(db, root);
    const indexRunId = latestCompletedIndexRun(db, repoId);
    const params: Array<string | number> = [];

    const aliasFor = (variable: string): { alias: string; table: 'entity' | 'relationship' } => {
      if (variable === query.source.variable) return { alias: 'src', table: 'entity' };
      if (query.target && variable === query.target.variable) return { alias: 'tgt', table: 'entity' };
      if (query.relationship && variable === query.relationship.variable) {
        return { alias: 'r', table: 'relationship' };
      }
      throw new Error(`unknown variable: ${variable}`);
    };

    const columnExpr = (variable: string, property: string | undefined): string => {
      const { alias, table } = aliasFor(variable);
      return `${alias}.${table === 'entity' ? entityColumn(property) : relationshipColumn(property)}`;
    };

    const columns = query.returns.map(returnColumnName);
    const selectList = query.returns
      .map((item, index) => {
        const expr = columnExpr(item.variable, item.property);
        return `${item.count ? `COUNT(${expr})` : expr} AS c${index}`;
      })
      .join(', ');

    // Aggregation: any COUNT(...) makes the non-aggregate RETURN items the
    // implicit grouping keys (Cypher has no explicit GROUP BY keyword).
    const hasAggregate = query.returns.some((item) => item.count);
    const groupKeyIndexes = query.returns
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.count)
      .map(({ index }) => index);
    const groupByClause =
      hasAggregate && groupKeyIndexes.length > 0
        ? `GROUP BY ${groupKeyIndexes
            .map((index) => columnExpr(query.returns[index]!.variable, query.returns[index]!.property))
            .join(', ')}`
        : '';

    // A user ORDER BY references projected columns by their cN alias (validated
    // at parse time to be in RETURN), so it is injection-safe and deterministic.
    const userOrderBy = query.orderBy
      ? `ORDER BY ${query.orderBy
          .map((order) => `c${columns.indexOf(order.column)} ${order.direction}`)
          .join(', ')}`
      : null;
    // The per-branch defaults order by ungrouped columns, invalid in an
    // aggregate query — order by the group keys instead (nothing when there are
    // none, i.e. a single all-aggregate row).
    const aggregateOrderBy = hasAggregate
      ? groupKeyIndexes.length > 0
        ? `ORDER BY ${groupKeyIndexes.map((index) => `c${index}`).join(', ')}`
        : ''
      : null;
    const effectiveOrder = (branchDefault: string): string =>
      userOrderBy ?? aggregateOrderBy ?? branchDefault;
    const withGroupAndOrder = (branchDefault: string): string =>
      [groupByClause, effectiveOrder(branchDefault)].filter(Boolean).join(' ');

    const conditions: string[] = [];
    const addLabel = (target: string[], node: GraphQueryNode | undefined, alias: string): void => {
      if (node?.label) {
        target.push(`LOWER(${alias}.kind) = LOWER(?)`);
        params.push(node.label);
      }
    };
    const addWhere = (target: string[]): void => {
      for (const condition of query.where) {
        const { alias, table } = aliasFor(condition.variable);
        const column = `${alias}.${
          table === 'entity'
            ? entityColumn(condition.property)
            : relationshipColumn(condition.property)
        }`;
        if (condition.op === 'CONTAINS') {
          target.push(`${column} LIKE ?`);
          params.push(`%${condition.value}%`);
        } else {
          target.push(`${column} = ?`);
          params.push(condition.value);
        }
      }
    };

    let sql: string;
    if (query.relationship?.pathLength && query.target) {
      // Variable-length path: transitive closure of `kind` from src to a
      // reachable node, bounded by [min, max]. UNION (not UNION ALL) dedups and
      // stops cycles; the depth cap is a hard backstop.
      const { min, max } = query.relationship.pathLength;
      const typeClause = query.relationship.type ? ' AND UPPER(r.kind) = UPPER(?)' : '';
      params.push(repoId, indexRunId);
      if (query.relationship.type) params.push(query.relationship.type);
      params.push(repoId, indexRunId);
      if (query.relationship.type) params.push(query.relationship.type);
      params.push(max);
      const outer: string[] = ['reach.depth >= ?'];
      params.push(min);
      addLabel(outer, query.source, 'src');
      addLabel(outer, query.target, 'tgt');
      addWhere(outer);
      sql =
        'WITH RECURSIVE reach(start_id, node_id, depth) AS ( ' +
        'SELECT r.source_entity_id, r.target_entity_id, 1 FROM relations r ' +
        `WHERE r.repo_id = ? AND r.index_run_id = ?${typeClause} ` +
        'UNION ' +
        'SELECT reach.start_id, r.target_entity_id, reach.depth + 1 FROM reach ' +
        'JOIN relations r ON r.source_entity_id = reach.node_id ' +
        `WHERE r.repo_id = ? AND r.index_run_id = ?${typeClause} AND reach.depth < ? ` +
        ') ' +
        `SELECT ${selectList} FROM reach ` +
        'JOIN entities src ON src.id = reach.start_id ' +
        'JOIN entities tgt ON tgt.id = reach.node_id ' +
        `WHERE ${outer.join(' AND ')} ` +
        effectiveOrder('ORDER BY src.path, tgt.path');
    } else if (query.relationship && query.target) {
      conditions.push('r.repo_id = ?');
      params.push(repoId);
      conditions.push('r.index_run_id = ?');
      params.push(indexRunId);
      if (query.relationship.type) {
        conditions.push('UPPER(r.kind) = UPPER(?)');
        params.push(query.relationship.type);
      }
      addLabel(conditions, query.source, 'src');
      addLabel(conditions, query.target, 'tgt');
      addWhere(conditions);
      sql =
        `SELECT ${selectList} FROM relations r ` +
        'JOIN entities src ON src.id = r.source_entity_id ' +
        'JOIN entities tgt ON tgt.id = r.target_entity_id ' +
        `WHERE ${conditions.join(' AND ')} ` +
        withGroupAndOrder('ORDER BY src.path, tgt.path, r.kind');
    } else {
      conditions.push('src.repo_id = ?');
      params.push(repoId);
      conditions.push('src.updated_index_run_id = ?');
      params.push(indexRunId);
      addLabel(conditions, query.source, 'src');
      addWhere(conditions);
      sql =
        `SELECT ${selectList} FROM entities src WHERE ${conditions.join(' AND ')} ${withGroupAndOrder('ORDER BY src.path')}`;
    }

    const limit = query.limit ?? DEFAULT_LIMIT;
    sql += ' LIMIT ?';
    params.push(limit);

    const raw = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    const rows = raw.map((row) => {
      const mapped: Record<string, unknown> = {};
      columns.forEach((name, index) => {
        mapped[name] = row[`c${index}`];
      });
      return mapped;
    });

    // Which projected columns are entity ids? Those map to an entity table and
    // resolve to the `id` column. Their values are navigable resource ids.
    const entityIdColumnIndexes = query.returns
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.count && aliasFor(item.variable).table === 'entity' && entityColumn(item.property) === 'id')
      .map(({ index }) => index);
    const entities: string[] = [];
    const seen = new Set<string>();
    for (const row of raw) {
      for (const index of entityIdColumnIndexes) {
        const value = row[`c${index}`];
        if (typeof value === 'string' && value.length > 0 && !seen.has(value)) {
          seen.add(value);
          entities.push(value);
        }
      }
    }

    return { columns, rows, indexRunId, resources: { entities } };
  } finally {
    db.close();
  }
}
export { parseGraphQuery } from "../../domain/context/graph-query.js";
export type { GraphQueryCondition,GraphQueryNode,GraphQueryOrder,GraphQueryPathLength,GraphQueryRel,GraphQueryResult,GraphQueryReturn,ParsedGraphQuery } from "../../domain/context/graph-query.js";
