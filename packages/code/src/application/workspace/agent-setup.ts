import { resolve } from "node:path";
import { addParallaxMcpServer, COPILOT_AGENT_PATH, COPILOT_INSTRUCTIONS_PATH, copilotAgentTemplate, copilotInstructionsTemplate, normalizeTargetRelativePath, resolveTargetPath } from "../../domain/workspace/agent-setup.js";
import type { CopilotAgentPackageOptions, CopilotAgentPackagePlan, CopilotPackageFileAction, ParallaxMcpOptions, PlannedCopilotPackageFile } from "../../domain/workspace/agent-setup.js";
import type { AgentSetupPorts } from "./setup-ports.js";

export function planCopilotAgentPackage(options: CopilotAgentPackageOptions, ports: AgentSetupPorts): CopilotAgentPackagePlan {
  const targetRepo = resolve(options.targetRepo);
  const files: PlannedCopilotPackageFile[] = [
    plannedCopilotFile(targetRepo, COPILOT_INSTRUCTIONS_PATH, copilotInstructionsTemplate(), options.force ?? false, ports),
    plannedCopilotFile(targetRepo, COPILOT_AGENT_PATH, copilotAgentTemplate(), options.force ?? false, ports)
  ];

  if (options.config !== undefined) {
    const configPath = normalizeTargetRelativePath(options.config);
    files.push(plannedCopilotMcpConfigFile(targetRepo, configPath, options, options.force ?? false, ports));
  }

  return { targetRepo, files };
}

export function installCopilotAgentPackage(options: CopilotAgentPackageOptions, ports: AgentSetupPorts): CopilotAgentPackagePlan {
  const plan = planCopilotAgentPackage(options, ports);
  for (const file of plan.files) {
    if (file.action === 'skip') continue;
    const destination = resolveTargetPath(plan.targetRepo, file.path);
    ports.writeFile(destination, file.content);
  }
  return plan;
}

export function plannedCopilotFile(targetRepo: string, path: string, content: string, force: boolean, ports: AgentSetupPorts): PlannedCopilotPackageFile {
  const relativePath = normalizeTargetRelativePath(path);
  const destination = resolveTargetPath(targetRepo, relativePath);
  const exists = ports.exists(destination);
  const action: CopilotPackageFileAction = exists ? (force ? 'overwrite' : 'skip') : 'create';
  return { path: relativePath, content, action };
}

export function plannedCopilotMcpConfigFile(
  targetRepo: string,
  path: string,
  options: ParallaxMcpOptions,
  force: boolean,
  ports: AgentSetupPorts
): PlannedCopilotPackageFile {
  const relativePath = normalizeTargetRelativePath(path);
  const destination = resolveTargetPath(targetRepo, relativePath);
  const exists = ports.exists(destination);
  const action: CopilotPackageFileAction = exists ? (force ? 'overwrite' : 'skip') : 'create';
  const existing = action === 'skip' ? undefined : ports.readConfig(destination);
  const content = action === 'skip' ? '' : `${JSON.stringify(addParallaxMcpServer(existing, options), null, 2)}\n`;
  return { path: relativePath, content, action };
}