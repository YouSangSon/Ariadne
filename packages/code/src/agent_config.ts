

export { installCopilotAgentPackage,planCopilotAgentPackage } from "./composition/agent-setup.js";
export { addParallaxMcpServer } from "./domain/workspace/agent-setup.js";
export type { CopilotAgentPackageOptions,CopilotAgentPackagePlan,CopilotPackageFileAction,InstallResult,McpClientConfig,McpServerEntry,ParallaxMcpOptions,PlannedCopilotPackageFile } from "./domain/workspace/agent-setup.js";
export { installParallaxMcp } from "./infrastructure/config/agent-config.js";
