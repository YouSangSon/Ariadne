import { existsSync } from "node:fs";
import { graphPreview as previewGraph } from "../application/context/ui-graph.js";
import type { UiOptions } from "../application/context/ui-model.js";
import { buildUiSnapshot as snapshot } from "../application/context/ui-snapshot.js";
import { normalizeRepoRoot } from "../infrastructure/filesystem/security.js";
import { readReportDeltaPolicy } from "../infrastructure/filesystem/ui-config.js";
import { databasePath } from "../infrastructure/sqlite/store.js";
import { openUiSession } from "../infrastructure/sqlite/ui-read-model.js";
import { exportImpactGraph } from "./graph.js";
import { doctorProject } from "./project.js";

export function buildUiSnapshot(options: UiOptions) {
  return snapshot(options, {
    normalizeRoot: normalizeRepoRoot, doctor: doctorProject,
    hasDatabase: (root) => existsSync(databasePath(root)), openSession: openUiSession,
    graphPreview: (root, id) => previewGraph(root, id, exportImpactGraph), deltaPolicy: readReportDeltaPolicy
  });
}

export function graphPreview(root: string, reportId: string) { return previewGraph(root, reportId, exportImpactGraph); }
