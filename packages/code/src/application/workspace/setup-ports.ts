import type { McpClientConfig } from "../../domain/workspace/agent-setup.js";
import type { ParallaxGitHookName } from "../../domain/workspace/git-hooks.js";

export interface AgentSetupPorts {
  exists(file: string): boolean;
  readConfig(file: string): McpClientConfig | undefined;
  writeFile(file: string, content: string): void;
}
export interface GitHookPorts {
  assertGitRepo(root: string): void;
  hookPath(root: string, hook: ParallaxGitHookName): string;
  readHook(file: string): string | null;
  writeHook(file: string, content: string): void;
}
