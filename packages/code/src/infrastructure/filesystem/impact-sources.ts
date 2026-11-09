import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { entityForPath } from "../../domain/impact/analysis.js";
import type { EntityRef, Evidence, ImpactReport } from "../../domain/model.js";
import { redactSecrets } from "../../domain/security/redaction.js";
import { renderMarkdown } from "../reporting/markdown.js";
import { impactDir } from "../sqlite/store.js";
import { resolveInsideRoot } from "./security.js";

export function currentFileHash(repoRoot: string, relativePath: string): string | undefined {
  try {
    const absolutePath = resolveInsideRoot(repoRoot, relativePath);
    return createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
  } catch {
    return undefined;
  }
}

export function makeEvidence(
  repoRoot: string,
  relativePath: string,
  kind: string,
  confidence: Evidence['confidence'],
  target?: EntityRef
): Evidence {
  const id = createHash('sha1').update(`${kind}:${relativePath}:${target?.id ?? ''}`).digest('hex').slice(0, 16);
  const subject = entityForPath(relativePath);
  let content: string;
  try {
    const absolutePath = resolveInsideRoot(repoRoot, relativePath);
    content = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    return {
      id,
      file: relativePath,
      kind: 'evidence-unavailable',
      snippet: redactSecrets(error instanceof Error ? error.message : String(error)),
      confidence: 'unknown',
      subject,
      ...(target ? { target } : {}),
      relationKind: kind,
      extractorId: 'mvp-file-edge'
    };
  }

  return {
    id,
    file: relativePath,
    kind,
    snippet: redactSecrets(content),
    confidence,
    subject,
    ...(target ? { target } : {}),
    relationKind: kind,
    extractorId: 'mvp-file-edge'
  };
}
export function writeImpactReport(repoRoot: string, report: ImpactReport): string {
  const reportDir = path.join(impactDir(repoRoot), 'reports');
  mkdirSync(reportDir, { recursive: true });
  const reportPath = path.relative(repoRoot, path.join(reportDir, `${report.id}.md`));
  writeFileSync(path.join(repoRoot, reportPath), renderMarkdown(report), 'utf8');
  return reportPath.split(path.sep).join('/');
}