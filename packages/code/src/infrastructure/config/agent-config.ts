import { randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { addParallaxMcpServer } from "../../domain/workspace/agent-setup.js";
import type { InstallResult, McpClientConfig, ParallaxMcpOptions } from "../../domain/workspace/agent-setup.js";

export function installParallaxMcp(
  configPath: string,
  options: ParallaxMcpOptions = {}
): InstallResult {
  mkdirSync(dirname(configPath), { recursive: true });
  const targetPath = mcpConfigTarget(configPath);
  const lockPath = `${targetPath}.lock`;
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  const lockFd = openSync(lockPath, 'wx', 0o600);
  let tempCreated = false;
  try {
    const original = readMcpConfigSnapshot(targetPath);
    let existing: McpClientConfig | undefined;
    const raw = original?.bytes.toString('utf8').trim() ?? '';
    if (raw.length > 0) {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`existing MCP config is not a JSON object: ${configPath}`);
      }
      existing = parsed as McpClientConfig;
    }
    const config = addParallaxMcpServer(existing, options);
    const tempFd = openSync(tempPath, 'wx', 0o600);
    tempCreated = true;
    try {
      writeFileSync(tempFd, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      fchmodSync(tempFd, original ? original.stat.mode & 0o777 : 0o600);
    } finally {
      closeSync(tempFd);
    }
    const current = readMcpConfigSnapshot(targetPath);
    if (original ? !current || original.stat.dev !== current.stat.dev || original.stat.ino !== current.stat.ino
      || original.stat.mode !== current.stat.mode || !original.bytes.equals(current.bytes) : current) {
      throw new Error(`MCP config changed during installation: ${configPath}`);
    }
    if (mcpConfigTarget(configPath) !== targetPath) {
      throw new Error(`MCP config changed during installation: ${configPath}`);
    }
    // shortcut: outside writers can race this check; they must share the lock protocol for exclusion.
    renameSync(tempPath, targetPath);
    tempCreated = false;
    return { path: configPath, created: original === undefined, config };
  } finally {
    try {
      if (tempCreated) rmSync(tempPath, { force: true });
    } finally {
      try { closeSync(lockFd); }
      finally { unlinkSync(lockPath); }
    }
  }
}

function mcpConfigTarget(configPath: string): string {
  return lstatSync(configPath, { throwIfNoEntry: false })
    ? realpathSync(configPath)
    : resolve(realpathSync(dirname(configPath)), basename(configPath));
}

function readMcpConfigSnapshot(configPath: string) {
  let fd: number;
  try {
    fd = openSync(configPath, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`existing MCP config is not a regular file: ${configPath}`);
    const bytes = readFileSync(fd);
    const current = lstatSync(configPath, { throwIfNoEntry: false });
    if (!current || stat.dev !== current.dev || stat.ino !== current.ino || stat.mode !== current.mode
      || stat.size !== current.size || stat.mtimeMs !== current.mtimeMs || stat.ctimeMs !== current.ctimeMs) {
      throw new Error(`MCP config changed during installation: ${configPath}`);
    }
    return { stat, bytes };
  } finally {
    closeSync(fd);
  }
}

export function readExistingMcpConfig(configPath: string): McpClientConfig | undefined {
  if (!existsSync(configPath)) return undefined;
  const raw = readFileSync(configPath, 'utf8').trim();
  if (raw.length === 0) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`existing MCP config is not a JSON object: ${configPath}`);
  }
  return parsed as McpClientConfig;
}
export { addParallaxMcpServer } from "../../domain/workspace/agent-setup.js";
export type { CopilotAgentPackageOptions,CopilotAgentPackagePlan,CopilotPackageFileAction,InstallResult,McpClientConfig,McpServerEntry,ParallaxMcpOptions,PlannedCopilotPackageFile } from "../../domain/workspace/agent-setup.js";

export function writeAgentPackageFile(destination: string, content: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}