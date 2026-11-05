import { PACKAGE_NAME } from "../../domain/branding.js";
import { contentHash } from "../../domain/identity.js";
import type { RememberValue } from "../../domain/local-memory/model.js";
import { MAX_EXTRACT_TEXT_CHARS, MAX_REFERENCED_FILES, parseSessionText, sessionSummary, sha256, validateFormat } from "../../domain/local-memory/session.js";
import type { SessionImportOptions, SessionImportResult, SessionImportSource } from "../../domain/local-memory/session.js";
import { redactSecrets } from "../../domain/security/redaction.js";
import type { SessionImportPorts } from "./session-ports.js";

export async function importSession(options: SessionImportOptions, ports: SessionImportPorts): Promise<SessionImportResult> {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  validateFormat(options.format);
  if (!ports.hasDatabase(repoRoot)) {
    throw new Error(`parallax database not found; run ${PACKAGE_NAME} init first`);
  }

  const resolved = ports.resolveSessionFile(repoRoot, options.file);
  const raw = await ports.readText(resolved.absolutePath);
  const source: SessionImportSource = {
    ...resolved.source,
    sha256: sha256(raw)
  };
  const redacted = redactSecrets(raw, MAX_EXTRACT_TEXT_CHARS);
  const parsed = parseSessionText(redacted, options.format);
  const referencedFiles = ports.referencedFiles(repoRoot, parsed.textForExtraction);
  const sessionId = contentHash(options.format, source.sha256, referencedFiles.join('\n'));
  const sessionEntityId = `session:${options.format}:${sessionId.slice(0, 16)}`;
  const agent = options.agent ?? 'cli:import-session';
  const warnings: string[] = [];
  if (referencedFiles.length >= MAX_REFERENCED_FILES) {
    warnings.push(`referenced files capped at ${MAX_REFERENCED_FILES}`);
  }

  const summaryValue: RememberValue = {
    format: options.format,
    sourceKind: source.kind,
    source,
    messageCount: parsed.messageCount,
    toolUseCount: parsed.toolUseCount,
    referencedFiles,
    rawContentStored: false,
    summary: sessionSummary(options.format, parsed, referencedFiles)
  };
  const persisted = ports.persist(repoRoot, {
    sessionId,
    sessionEntityId,
    summaryValue,
    referencedFiles,
    agent,
    ...(options.branch !== undefined ? { branch: options.branch } : {})
  });

  return {
    sessionId,
    sessionEntityId,
    format: options.format,
    source,
    messageCount: parsed.messageCount,
    toolUseCount: parsed.toolUseCount,
    referencedFiles,
    summaryFactId: persisted.summaryFactId,
    referenceFactIds: persisted.referenceFactIds,
    factsWritten: persisted.factsWritten,
    warnings
  };
}
