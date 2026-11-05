import { createHash } from "node:crypto";
import { confidenceRank, dedupeEvidence, entityForPath, isBetterImpact, isJavaScriptTestPath, normalizeBoundedInteger, shellQuote, traverseImpact } from "../../domain/impact/analysis.js";
import type { ImpactNeighborReader, ImpactRow } from "../../domain/impact/analysis.js";
import type { AdapterRunInsight, AnalyzeOptions, Confidence, CrossRepoImpact, EntityRef, Evidence, ImpactAction, ImpactReport, ImpactTarget } from "../../domain/model.js";
import type { CrossRepoImpactLoadResult } from "../../domain/workspace/cross-repo-impact.js";

export interface AnalysisSession extends ImpactNeighborReader {
  readonly indexRunId: number;
  gitWarnings(): string[];
  adapterInsights(): AdapterRunInsight[];
  changedFile(file: string): { canonical: boolean; indexed: { contentHash: string } | null };
  legacyImpacts(file: string): ImpactRow[];
  outgoingEvidence(entityId: string, source: EntityRef): Evidence[];
  crossRepoImpacts(file: string): CrossRepoImpactLoadResult;
  saveReport(report: ImpactReport): void;
  close(): void;
}

export interface AnalysisPorts {
  normalizeRoot(root: string): string;
  changedPath(root: string, file: string): string;
  openSession(root: string, readOnly: boolean): AnalysisSession;
  currentFileHash(root: string, file: string): string | undefined;
  sourceEvidence(root: string, file: string, kind: string, confidence: Confidence, target?: EntityRef): Evidence;
  writeReport(root: string, report: ImpactReport): string;
}

export async function analyzeDiff(options: AnalyzeOptions, ports: AnalysisPorts): Promise<ImpactReport> {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  const session = ports.openSession(repoRoot, options.readOnly === true);
  try {
    const indexRunId = session.indexRunId;
    const maxDepth = normalizeBoundedInteger(options.maxDepth, 2, 1, 8);
    const maxFanout = normalizeBoundedInteger(options.maxFanout, 200, 1, 2_000);
    const changedFiles = options.changedFiles.map((file) => {
      return ports.changedPath(repoRoot, file);
    }).sort();

    const affected = new Map<string, {
      path: string;
      reason: string;
      confidence: Confidence;
      target: EntityRef;
      depth: number;
      relationPath: string[];
    }>();
    const evidence: Evidence[] = [];
    const warnings: string[] = [];
    const crossRepoImpacts: CrossRepoImpact[] = [];
    warnings.push(...session.gitWarnings());
    const adapterInsights = session.adapterInsights();

    for (const changedFile of changedFiles) {
      const changedEntityId = `file:${changedFile}`;
      const { canonical: changedEntityRow, indexed: indexedFileRow } = session.changedFile(changedFile);

      if (indexedFileRow) {
        const liveHash = ports.currentFileHash(repoRoot, changedFile);
        if (liveHash && liveHash !== indexedFileRow.contentHash) {
          warnings.push(`stale index: ${changedFile} differs from latest completed index run ${indexRunId}`);
        } else if (!liveHash) {
          warnings.push(`stale index: ${changedFile} is indexed but cannot be read from the working tree`);
        }
      }

      if (!changedEntityRow && !indexedFileRow) {
        affected.set(changedFile, {
          path: changedFile,
          reason: 'changed file not in index',
          confidence: 'unknown',
          target: entityForPath(changedFile),
          depth: 0,
          relationPath: []
        });
        warnings.push(`coverage gap: changed file is not present in index run ${indexRunId}: ${changedFile}`);
        continue;
      }

      const impactRows = changedEntityRow
        ? traverseImpact(session, changedEntityId, changedFile, maxDepth, maxFanout, warnings)
        : [];
      const rows = impactRows.length > 0
        ? impactRows
        : session.legacyImpacts(changedFile);

      if (changedEntityRow) {
        evidence.push(
          ...session.outgoingEvidence(changedEntityId, entityForPath(changedFile))
        );
      }

      for (const row of rows) {
        const next = {
          path: row.sourcePath,
          reason: row.reason,
          confidence: row.confidence,
          target: row.sourceEntity,
          depth: row.depth,
          relationPath: row.relationPath
        };
        const current = affected.get(row.sourcePath);
        if (!current || isBetterImpact(next, current)) {
          affected.set(row.sourcePath, next);
        }
        evidence.push(row.evidence);
      }

      const crossRepo = session.crossRepoImpacts(changedFile);
      for (const candidate of crossRepo.candidates) {
        const current = affected.get(candidate.affectedFile.path);
        const next = {
          path: candidate.affectedFile.path,
          reason: candidate.affectedFile.reason,
          confidence: candidate.affectedFile.confidence,
          target: candidate.affectedTarget.target,
          depth: candidate.affectedFile.depth ?? 1,
          relationPath: candidate.affectedFile.relationPath ?? candidate.affectedTarget.relations
        };
        if (!current || isBetterImpact(next, current)) {
          affected.set(candidate.affectedFile.path, next);
        }
        evidence.push(candidate.evidence);
        crossRepoImpacts.push(candidate.impact);
      }
      if (crossRepo.malformedLinkCount > 0) {
        warnings.push(
          `cross-repo impact: skipped ${crossRepo.malformedLinkCount} malformed BREAKS_COMPATIBILITY_WITH link`
          + `${crossRepo.malformedLinkCount === 1 ? '' : 's'}`
        );
      }

      evidence.push(ports.sourceEvidence(repoRoot, changedFile, 'changed-file', 'proven'));
    }

    const affectedFiles = [...affected.values()].sort((a, b) => {
      const byConfidence = confidenceRank(b.confidence) - confidenceRank(a.confidence);
      if (byConfidence !== 0) return byConfidence;
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.path.localeCompare(b.path);
    });
    const changed = changedFiles.map((file) => entityForPath(file));
    const affectedTargets: ImpactTarget[] = affectedFiles.map((file) => ({
      target: file.target,
      relations: file.relationPath.length > 0 ? file.relationPath : [file.reason],
      confidence: file.confidence
    }));
    const actions = affectedFiles
      .filter((file) => isJavaScriptTestPath(file.path))
      .map((file): ImpactAction => {
        const target = entityForPath(file.path);
        return {
          kind: 'verify',
          runnerId: 'npm',
          target,
          command: 'npm',
          args: ['test', '--', file.path],
          display: ['npm', 'test', '--', shellQuote(file.path)].join(' '),
          confidence: file.confidence
        };
      });
    const id = createHash('sha1').update(`${indexRunId}:${maxDepth}:${maxFanout}:${changedFiles.join(',')}`).digest('hex').slice(0, 12);
    const report: ImpactReport = {
      id,
      indexRunId,
      changedFiles,
      affectedFiles,
      changed,
      affected: affectedTargets,
      actions,
      testCommands: actions,
      evidence: dedupeEvidence(evidence),
      ...(crossRepoImpacts.length > 0 ? { crossRepoImpacts } : {}),
      ...(adapterInsights.length > 0 ? { adapterInsights } : {}),
      ...(warnings.length > 0 ? { warnings: [...new Set(warnings)].sort() } : {})
    };

    if (options.writeReport) {
      report.reportPath = ports.writeReport(repoRoot, report);
    }
    if (options.persistReport !== false && !options.readOnly) {
      session.saveReport(report);
    }

    return report;
  } finally {
    session.close();
  }
}
