import { PACKAGE_NAME } from "../../domain/branding.js";
import type { InitOptions, InitResult } from "../../domain/model.js";

export interface InitPorts {
  normalizeRoot(root: string): string;
  initializeConfig(root: string, content: string): { created: boolean; configPath: string };
  initializeStore(root: string): string;
}
export async function initProject(options: InitOptions, ports: InitPorts): Promise<InitResult> {
  const root = ports.normalizeRoot(options.repoRoot);
  const config = ports.initializeConfig(root, `${JSON.stringify({
    schemaVersion: 3, project: PACKAGE_NAME, mcp: { readOnly: true }, redaction: { enabled: true }
  }, null, 2)}\n`);
  return { ...config, databasePath: ports.initializeStore(root) };
}
