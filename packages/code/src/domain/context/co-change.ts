export type CoChangePartner = {
  path: string;
  coChangeCount: number;
  couplingScore: number;
  confidence: string;
};

export type CoChangeQueryResult = {
  file: string;
  indexRunId: number;
  partners: CoChangePartner[];
  // Partner entity ids, navigable via the `parallax://entities/{id}` template.
  resources: { entities: string[] };
};

export type CoChangeQueryOptions = {
  // Cap on partners returned, ranked by coupling strength.
  limit?: number;
};

export const DEFAULT_LIMIT = 20;

export const MAX_LIMIT = 200;

export const FILE_PREFIX = 'file:';

export const PROVENANCE = /^co-change:(\d+):(\d+(?:\.\d+)?)$/;

export function parseCoChangeProvenance(
  provenance: string
): { coChangeCount: number; couplingScore: number } | null {
  const match = PROVENANCE.exec(provenance);
  if (!match) return null;
  return { coChangeCount: Number(match[1]), couplingScore: Number(match[2]) };
}
export type CoChangeRow = { path: string; provenance: string; confidence: string };
export function coChangeResult(rows: CoChangeRow[], target: string, indexRunId: number, limit: number): CoChangeQueryResult {
  const partners: CoChangePartner[] = [];
  for (const row of rows) {
    const parsed = parseCoChangeProvenance(row.provenance);
    if (!parsed) continue;
    partners.push({
      path: row.path,
      coChangeCount: parsed.coChangeCount,
      couplingScore: parsed.couplingScore,
      confidence: row.confidence
    });
  }
  // Strongest coupling first; ties broken deterministically by count then path.
  partners.sort(
    (a, b) =>
      b.couplingScore - a.couplingScore ||
      b.coChangeCount - a.coChangeCount ||
      a.path.localeCompare(b.path)
  );
  const limited = partners.slice(0, limit);
  return {
    file: target,
    indexRunId,
    partners: limited,
    resources: { entities: limited.map((partner) => `${FILE_PREFIX}${partner.path}`) }
  };
}
