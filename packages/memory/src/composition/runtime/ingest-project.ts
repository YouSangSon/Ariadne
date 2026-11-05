import type { IngestProjectArtifactsInput } from "../../application/ingest/project-ingest.js";
import { ingestProjectArtifacts as ingest } from "../../application/ingest/project-ingest.js";
import { collectProjectSources } from "../../infrastructure/files/readers.js";
export function ingestProjectArtifacts(input: IngestProjectArtifactsInput) { return ingest(input, { collect: collectProjectSources }); }
export type { IngestProjectArtifactsInput } from "../../application/ingest/project-ingest.js";
