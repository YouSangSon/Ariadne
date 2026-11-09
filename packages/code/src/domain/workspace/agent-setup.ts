import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

export type McpServerEntry = { command: string; args: string[] };

export type McpClientConfig = {
  mcpServers?: Record<string, McpServerEntry>;
} & Record<string, unknown>;

export type ParallaxMcpOptions = {
  name?: string;
  command?: string;
  args?: string[];
};

export const DEFAULT_NAME = 'parallax';

export const DEFAULT_COMMAND = 'parallax';

export const DEFAULT_ARGS = ['mcp', 'serve'];

export function addParallaxMcpServer(
  config: McpClientConfig | undefined,
  options: ParallaxMcpOptions = {}
): McpClientConfig {
  const name = options.name ?? DEFAULT_NAME;
  const entry: McpServerEntry = {
    command: options.command ?? DEFAULT_COMMAND,
    args: options.args ?? [...DEFAULT_ARGS]
  };
  const base = config ?? {};
  return {
    ...base,
    mcpServers: {
      ...(base.mcpServers ?? {}),
      [name]: entry
    }
  };
}

export type InstallResult = {
  path: string;
  created: boolean;
  config: McpClientConfig;
};

export type CopilotPackageFileAction = 'create' | 'overwrite' | 'skip';

export type PlannedCopilotPackageFile = {
  path: string;
  content: string;
  action: CopilotPackageFileAction;
};

export type CopilotAgentPackageOptions = ParallaxMcpOptions & {
  targetRepo: string;
  config?: string;
  force?: boolean;
};

export type CopilotAgentPackagePlan = {
  targetRepo: string;
  files: PlannedCopilotPackageFile[];
};

export const COPILOT_INSTRUCTIONS_PATH = '.github/copilot-instructions.md';

export const COPILOT_AGENT_PATH = '.github/agents/parallax-impact.agent.md';

export function normalizeTargetRelativePath(path: string): string {
  if (isAbsolute(path)) {
    throw new Error(`Copilot package file path must be relative to the target repo: ${path}`);
  }
  const normalized = normalize(path).replaceAll(sep, '/');
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    throw new Error(`Copilot package file path must stay inside the target repo: ${path}`);
  }
  return normalized;
}

export function resolveTargetPath(targetRepo: string, path: string): string {
  const destination = resolve(targetRepo, path);
  const rel = relative(targetRepo, destination);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Copilot package file path escapes the target repo: ${path}`);
  }
  return destination;
}

export function copilotInstructionsTemplate(): string {
  return `# Parallax Agent Instructions

Before editing PR-impactful code, ask Parallax for impact context from the target repository.

- Run Parallax from the repository root after dependencies are available.
- Use \`parallax_context_for_change\` for changed files before broad edits.
- Use \`parallax_search_context\` when you need symbol, path, relation, or evidence context.
- Use \`parallax_query_entities\` to inspect directly connected indexed entities before changing callers, providers, or contracts.
- Prefer proven evidence over inferred or heuristic evidence, and mention known gaps when Parallax reports them.
- Treat Parallax actions as recommendations. Verify with the repository's normal tests, typecheck, and review flow.

For CI or pull-request annotation, generate SARIF and upload it with GitHub Code Scanning:

\`\`\`bash
parallax analyze --changed "$CHANGED_FILES" --sarif-output parallax.sarif --sarif-category parallax-pr --fail-on none
\`\`\`

Upload \`parallax.sarif\` separately, for example with \`github/codeql-action/upload-sarif\`.
`;
}

export function copilotAgentTemplate(): string {
  return `---
name: parallax-impact
description: Use Parallax impact analysis before editing code that may affect callers, contracts, tests, or PR review scope.
tools:
  - parallax_context_for_change
  - parallax_search_context
  - parallax_query_entities
---

Start by identifying the changed files or intended edit targets. Request Parallax context for those paths, inspect related entities, and summarize high-confidence impacted files, contracts, tests, known gaps, and recommended verification before making changes.

When CI feedback is useful, ask for SARIF generation with \`parallax analyze --changed "$CHANGED_FILES" --sarif-output parallax.sarif --sarif-category parallax-pr --fail-on none\` so GitHub Code Scanning can annotate the pull request.
`;
}