import { existsSync } from "node:fs";
import { installCopilotAgentPackage as installPackage, planCopilotAgentPackage as planPackage } from "../application/workspace/agent-setup.js";
import { installParallaxGitHooks as installHooks, planParallaxGitHooks as planHooks } from "../application/workspace/git-hooks.js";
import type { CopilotAgentPackageOptions } from "../domain/workspace/agent-setup.js";
import type { ParallaxGitHookOptions } from "../domain/workspace/git-hooks.js";
import { readExistingMcpConfig, writeAgentPackageFile } from "../infrastructure/config/agent-config.js";
import { assertGitRepo, readHook, resolveHookPath, writeHook } from "../infrastructure/git/hooks.js";

const packagePorts = { exists: existsSync, readConfig: readExistingMcpConfig, writeFile: writeAgentPackageFile };
const hookPorts = { assertGitRepo, hookPath: resolveHookPath, readHook, writeHook };
export const planCopilotAgentPackage = (options: CopilotAgentPackageOptions) => planPackage(options, packagePorts);
export const installCopilotAgentPackage = (options: CopilotAgentPackageOptions) => installPackage(options, packagePorts);
export const planParallaxGitHooks = (options: ParallaxGitHookOptions) => planHooks(options, hookPorts);
export const installParallaxGitHooks = (options: ParallaxGitHookOptions) => installHooks(options, hookPorts);
export * from '../domain/workspace/agent-setup.js';
export * from '../domain/workspace/git-hooks.js';
export { installParallaxMcp } from '../infrastructure/config/agent-config.js';
