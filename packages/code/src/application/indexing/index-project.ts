import { AdapterRegistry } from "../../domain/indexing/adapter-registry.js";
import type { AdapterOutputOwnership, ExtractCtx, SemanticAdapter } from "../../domain/indexing/adapter.js";
import { computeIndexDelta } from "../../domain/indexing/index-delta.js";
import type { IndexDelta } from "../../domain/indexing/index-delta.js";
import type { AdapterGroup, CollectedIndexEvent, CollectedIndexRun, ScanResult } from "../../domain/indexing/index-model.js";
import { adapterGroupsInRegistryOrder, adapterIdForSkippedFile, defaultMaxFileBytes, extractorVersionFor, hashIndexInputs, immutableIndexedFilesSnapshot, languageIdsForSkippedAndUnsupported, validateOutputOwnership } from "../../domain/indexing/index-policy.js";
import type { IndexOptions, IndexResult, ScannedFile } from "../../domain/model.js";
import { redactSecrets } from "../../domain/security/redaction.js";
import type { ExtractionAudit, IndexingPorts } from "./ports.js";

export async function indexProjectInternal(
  options: IndexOptions,
  registry: AdapterRegistry,
  ports: IndexingPorts
): Promise<IndexResult> {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  const session = ports.openSession(repoRoot);
  try {
    const gitSnapshot = ports.gitSnapshot(repoRoot);

    const registeredAdapters = registry.list();
    if (registeredAdapters.length === 0) {
      throw new Error('no adapter registered');
    }
    const outputOwnership = new Map(registeredAdapters.map((adapter) =>
      [adapter, adapter.outputOwnership ?? 'unrestricted'] as const
    ));
    const extractorVersion = extractorVersionFor(registeredAdapters, outputOwnership);
    const reusableCleanIndex = session.reuseCleanIndex(gitSnapshot, extractorVersion, options);
    if (reusableCleanIndex) return reusableCleanIndex;
    const indexRunId = session.startRun(gitSnapshot, extractorVersion);
    try {
      const scan = timeIndexPhase(options, 'scan', () =>
        ports.scanFiles(repoRoot, options.maxFileBytes ?? defaultMaxFileBytes)
      );
      const commitHistory = ports.commitHistory(repoRoot);
      // Capture actual scanner inputs before legacy adapter callbacks can mutate them.
      const inputSnapshotHash = hashIndexInputs(scan, commitHistory);
      const files = scan.files;
      const classified = registry.classify(files);
      const skippedCoverage = scan.skipped.map((file) => ({
        file,
        adapterId: adapterIdForSkippedFile(registry, repoRoot, file)
      }));
      const adapterGroups = adapterGroupsInRegistryOrder(
        registeredAdapters,
        classified,
        skippedCoverage
      );
      const fileAdapterByPath = new Map<string, SemanticAdapter>();
      for (const group of adapterGroups) {
        for (const file of group.files) {
          fileAdapterByPath.set(file.relativePath, group.adapter);
        }
      }
      const indexedFiles = files.filter((file) => fileAdapterByPath.has(file.relativePath));
      const unsupportedFiles = files.filter((file) => !fileAdapterByPath.has(file.relativePath));
      const unsupportedLanguageIds = languageIdsForSkippedAndUnsupported(
        skippedCoverage,
        unsupportedFiles
      );

      // First classify the content/path delta. Changed bodies are then promoted to
      // full extraction because content scope does not prove emitted-row ownership;
      // only a zero-change cohort is safe to carry forward today.
      const priorRun = session.priorCompletedRun();
      const delta: IndexDelta = computeIndexDelta({
        prior: priorRun?.files ?? null,
        current: {
          extractorVersion,
          files: new Map(indexedFiles.map((file) => [file.relativePath, file.hash]))
        }
      });
      const effectiveDelta: IndexDelta =
        delta.mode === 'incremental' && (delta.changed.length > 0 ||
          priorRun?.inputSnapshotHash !== inputSnapshotHash)
          ? {
            ...delta,
            mode: 'full',
            reason: 'changed or unverified index inputs require full extraction',
            unchanged: [],
            changed: []
          }
          : delta;
      const isIncremental = effectiveDelta.mode === 'incremental';
      const changedSet = new Set(effectiveDelta.changed);

      const adapterRunIds = session.prepareExtraction(indexRunId, {
        adapterGroups, skippedCoverage, unsupportedFiles,
        indexedCoverageFiles: isIncremental
          ? indexedFiles.filter((file) => changedSet.has(file.relativePath))
          : indexedFiles,
        fileAdapterByPath
      });

      const collected = await collectAdapterEvents({
        repoRoot,
        indexRunId,
        indexedFiles,
        adapterGroups,
        adapterRunIds,
        outputOwnership,
        fileAdapterByPath,
        isIncremental,
        changedSet,
        audit: session.audit(indexRunId)
      });

      const result = session.publish({
        indexRunId,
        indexedFiles,
        unsupportedFiles,
        unsupportedLanguageIds,
        scan,
        adapterGroups,
        fileAdapterByPath,
        collected,
        priorRun,
        delta: effectiveDelta,
        commitHistory,
        inputSnapshotHash,
      });
      return result;
    } catch (error) {
      // Persistence already rolls back atomically; retain only the failed-run audit.
      session.failRun(indexRunId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  } finally {
    session.close();
  }

}

export function timeIndexPhase(options: IndexOptions, phase: 'scan', fn: () => ScanResult): ScanResult {
  if (!options.perfObserver) return fn();
  const start = performance.now();
  let result: ScanResult | undefined;
  try {
    result = fn();
    return result;
  } finally {
    options.perfObserver(phase, performance.now() - start, result?.reads);
  }
}

export async function collectAdapterEvents(input: {
  repoRoot: string;
  indexRunId: number;
  indexedFiles: readonly ScannedFile[];
  adapterGroups: readonly AdapterGroup[];
  adapterRunIds: ReadonlyMap<SemanticAdapter, number>;
  outputOwnership: ReadonlyMap<SemanticAdapter, AdapterOutputOwnership>;
  fileAdapterByPath: ReadonlyMap<string, SemanticAdapter>;
  isIncremental: boolean;
  changedSet: ReadonlySet<string>;
  audit: ExtractionAudit;
}): Promise<CollectedIndexRun> {
  const events: CollectedIndexEvent[] = [];
  const indexedPaths = new Set(input.indexedFiles.map((file) => file.relativePath));
  const completedFilePathsByAdapterId = new Map<string, Set<string>>();
  const completedAdapterRuns: Array<{ adapterId: string; adapterRunId: number }> = [];
  void input.fileAdapterByPath;

  for (let groupIndex = 0; groupIndex < input.adapterGroups.length; groupIndex++) {
    const { adapter, files } = input.adapterGroups[groupIndex]!;
    const ownsProcessedFile = input.outputOwnership.get(adapter) === 'processed-file';
    const adapterFiles = ownsProcessedFile ? immutableIndexedFilesSnapshot(files) : files;
    const adapterRunId = input.adapterRunIds.get(adapter);
    if (adapterRunId === undefined) {
      throw new Error(`adapter run missing for ${adapter.id}`);
    }
    if (adapterFiles.length === 0) {
      input.audit.finish(adapterRunId, 'skipped');
      completedFilePathsByAdapterId.set(adapter.id, new Set<string>());
      continue;
    }
    if (input.isIncremental && adapterFiles.every((file) => !input.changedSet.has(file.relativePath))) {
      input.audit.finish(adapterRunId, 'completed');
      const completedFilePaths = new Set(adapterFiles.map((file) => file.relativePath));
      completedFilePathsByAdapterId.set(adapter.id, completedFilePaths);
      completedAdapterRuns.push({ adapterId: adapter.id, adapterRunId });
      continue;
    }
    const ctx: ExtractCtx = {
      repoRoot: input.repoRoot,
      indexRunId: input.indexRunId,
      adapterRunId,
      indexedFiles: immutableIndexedFilesSnapshot(input.indexedFiles)
    };
    const completedFilePaths = new Set<string>();
    completedFilePathsByAdapterId.set(adapter.id, completedFilePaths);
    try {
      const run = await adapter.start(ctx, adapterFiles);
      try {
        for (const file of adapterFiles) {
          // Incremental: unchanged graph rows and indexed coverage are carried
          // forward during successful persistence, so extraction is skipped.
          if (input.isIncremental && !input.changedSet.has(file.relativePath)) {
            completedFilePaths.add(file.relativePath);
            continue;
          }
          for await (const emitted of run.process(file)) {
            // Isolate each yield before the generator or dispose can mutate it.
            const event = ownsProcessedFile ? structuredClone(emitted) : emitted;
            if (ownsProcessedFile) validateOutputOwnership(event, file, indexedPaths, adapter.id);
            if (event.kind === 'diagnostic') {
              input.audit.diagnostic(event, file, adapter.id, adapterRunId);
              continue;
            }
            events.push({ adapter, adapterRunId, adapterId: adapter.id, file, event });
          }
          completedFilePaths.add(file.relativePath);
        }
      } finally {
        if (run.dispose) {
          await run.dispose();
        }
      }
      completedAdapterRuns.push({ adapterId: adapter.id, adapterRunId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const completedRun of completedAdapterRuns) {
        input.audit.finish(completedRun.adapterRunId, 'completed');
      }
      input.audit.finish(adapterRunId, 'failed', message);
      input.audit.skipCoverage(
        adapter,
        adapterFiles.filter((file) => !completedFilePaths.has(file.relativePath)),
        `adapter failed: ${redactSecrets(message)}`
      );
      input.audit.skipUnstarted(input.adapterGroups.slice(groupIndex + 1), input.adapterRunIds, adapter.id);
      throw error;
    }
  }

  return { events, completedFilePathsByAdapterId, completedAdapterRuns };
}
