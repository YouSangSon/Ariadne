import { createHash } from "node:crypto";
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import path from "node:path";
import { languageIdForPath } from "../../domain/indexing/entity-classification.js";
import type { ScanResult, SkippedFile } from "../../domain/indexing/index-model.js";
import { ignoredDirs, skippedFileContentSampleBytes } from "../../domain/indexing/index-policy.js";
import type { IndexScanReads, ScannedFile } from "../../domain/model.js";
import { toRelativePath } from "./security.js";

export function scanFiles(repoRoot: string, maxFileBytes: number): ScanResult {
  const out: ScannedFile[] = [];
  const skipped: SkippedFile[] = [];
  const reads: IndexScanReads = { bodyReads: 0, bodyBytes: 0, sampleReads: 0, sampleBytes: 0 };
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const absolutePath = path.join(dir, entry.name);
      const relativePath = toRelativePath(repoRoot, absolutePath);
      const language = languageIdForPath(relativePath);
      if (!language) continue;
      const noFollow = typeof fsConstants.O_NOFOLLOW === 'number';
      const flags = fsConstants.O_RDONLY |
        (noFollow ? fsConstants.O_NOFOLLOW : 0) |
        (typeof fsConstants.O_NONBLOCK === 'number' ? fsConstants.O_NONBLOCK : 0);
      const fd = openSync(absolutePath, flags);
      try {
        const checked = fstatSync(fd, { bigint: true });
        if (!checked.isFile()) throw new Error(`not a regular file: ${relativePath}`);
        if (!noFollow) {
          // Platforms without O_NOFOLLOW must validate leaf identity before reading.
          const leaf = lstatSync(absolutePath, { bigint: true });
          if (!leaf.isFile() || leaf.dev !== checked.dev || leaf.ino !== checked.ino) {
            throw new Error(`file changed while scanning: ${relativePath}`);
          }
        }
        const size = Number(checked.size);
        if (size > maxFileBytes) {
          const contentSample = readContentSample(fd, size);
          if (contentSample) {
            reads.sampleReads++;
            reads.sampleBytes += contentSample.bytesRead;
          }
          skipped.push({
            relativePath,
            language,
            reason: `file exceeds maxFileBytes (${size} > ${maxFileBytes})`,
            ...(contentSample
              ? { contentSample: contentSample.content, contentSampleHash: contentSample.hash }
              : {})
          });
          continue;
        }
        // Bound allocation and reads to the approved size even if the file grows.
        const buffer = Buffer.allocUnsafe(size);
        let offset = 0;
        while (offset < size) {
          const n = readSync(fd, buffer, offset, size - offset, offset);
          if (n === 0) break;
          offset += n;
        }
        const after = fstatSync(fd, { bigint: true });
        if (offset !== size || after.size !== checked.size ||
            after.mtimeNs !== checked.mtimeNs || after.ctimeNs !== checked.ctimeNs) {
          throw new Error(`file changed while scanning: ${relativePath}`);
        }
        reads.bodyReads++;
        reads.bodyBytes += offset;
        const content = buffer.toString('utf8');
        out.push({
          absolutePath,
          relativePath,
          content,
          hash: createHash('sha256').update(content).digest('hex'),
          language
        });
      } finally {
        closeSync(fd);
      }
    }
  };
  walk(repoRoot);
  return {
    files: out.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    skipped: skipped.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    reads
  };
}

export function readContentSample(
  fd: number,
  fileSize: number
): { content: string; hash: string; bytesRead: number } | undefined {
  const length = Math.min(fileSize, skippedFileContentSampleBytes);
  const buffer = Buffer.allocUnsafe(length);
  try {
    const bytesRead = readSync(fd, buffer, 0, length, 0);
    const content = buffer.subarray(0, bytesRead).toString('utf8');
    return {
      content,
      hash: createHash('sha256').update(content).digest('hex'),
      bytesRead
    };
  } catch {
    return undefined;
  }
}