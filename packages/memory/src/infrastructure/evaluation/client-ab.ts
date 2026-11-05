import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import type { ClientAbProfile, ClientCommand, ClientCondition, ClientVendor, ClientWorkspace, CodexSubscriptionStatus, LiveMcpServer } from "../../application/evaluation/client-policy.js";
import { object, parseCodexSubscriptionStatus, positive, text, trackedPath } from "../../application/evaluation/client-policy.js";
function git(repoDir: string, args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], { cwd: repoDir, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (_error: unknown) {
    throw new Error("client A/B evaluation could not inspect the fixed repository SHA");
  }
}
function gitHasTrackedChanges(repoDir: string, args: readonly string[]): boolean {
  try {
    execFileSync("git", [...args], { cwd: repoDir, stdio: "ignore" });
    return false;
  } catch (error: unknown) {
    if ((error as { status?: unknown }).status === 1) return true;
    throw new Error("client A/B evaluation could not inspect tracked repository changes");
  }
}
function readTracked(repoDir: string, sha: string, sourcePath: string): string {
  trackedPath(sourcePath, "client A/B source path");
  return git(repoDir, ["show", `${sha}:${sourcePath}`]);
}
export async function createClientWorkspace(claimKeys: readonly string[] = []): Promise<ClientWorkspace> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "akasha-client-ab-"));
  const cwd = path.join(rootDir, "client");
  const schemaPath = path.join(cwd, "result.schema.json");
  await mkdir(cwd);
  const schema = {
    type: "object", additionalProperties: false, required: ["claims"],
    properties: { claims: { type: "object", additionalProperties: false, required: [...claimKeys], properties: Object.fromEntries(claimKeys.map((key) => [key, { type: "string" }])) } },
  };
  await writeFile(schemaPath, `${JSON.stringify(schema)}\n`, { mode: 0o600 });
  return { rootDir, cwd, schemaPath };
}
// Account RPC has no --ignore-user-config; pin its auth store and service URL to the exec path.
const CODEX_SUBSCRIPTION_CONFIG = ["-c", 'model_provider="openai"', "-c", 'cli_auth_credentials_store="file"', "-c", 'chatgpt_base_url="https://chatgpt.com/backend-api/"'];
function clientEnvironment(vendor: ClientVendor, subscription = false): NodeJS.ProcessEnv {
  const auth = vendor === "codex"
    ? { ...(!subscription ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY, CODEX_API_KEY: process.env.CODEX_API_KEY } : {}), CODEX_HOME: process.env.CODEX_HOME }
    : { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  return { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, LC_ALL: process.env.LC_ALL, NO_COLOR: "1", ...auth };
}
function mcpConfigOverrides(server: LiveMcpServer): string[] {
  const overrides = [
    'mcp_servers.akasha.enabled_tools=["build_context_pack"]',
    'mcp_servers.akasha.tools.build_context_pack.approval_mode="approve"',
    `mcp_servers.akasha.command=${JSON.stringify(server.command)}`,
    `mcp_servers.akasha.args=${JSON.stringify(server.args)}`,
  ];
  for (const [name, value] of Object.entries(server.env ?? {})) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error("client A/B MCP environment name is invalid");
    overrides.push(`mcp_servers.akasha.env.${name}=${JSON.stringify(value)}`);
  }
  return overrides;
}
export async function buildClientCommand(input: { vendor: ClientVendor; condition: ClientCondition; profile?: ClientAbProfile; workspace: ClientWorkspace; prompt: string; expectedModel: string; effort?: string; maxBudgetUsd?: number; mcpServer?: LiveMcpServer; executeSubscription?: boolean }): Promise<ClientCommand> {
  text(input.expectedModel, "expectedModel");
  const usesMcp = input.condition === "on" && input.profile !== "cli-prefetch";
  if (usesMcp && input.mcpServer === undefined) throw new Error("client A/B on condition requires an Akasha MCP server configuration");
  const finalOutputPath = path.join(input.workspace.cwd, "final-output.json");
  const mcpServer = usesMcp ? input.mcpServer : undefined;
  if (input.vendor === "codex") {
    const args = ["exec", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only", "--json", "--model", input.expectedModel, "--output-schema", input.workspace.schemaPath, "--output-last-message", finalOutputPath];
    if (input.executeSubscription) args.push(...CODEX_SUBSCRIPTION_CONFIG, "-c", 'forced_login_method="chatgpt"');
    args.push("-c", "features.shell_tool=false", "-c", 'web_search="disabled"');
    if (input.effort !== undefined) args.push("-c", `model_reasoning_effort=${JSON.stringify(input.effort)}`);
    if (mcpServer !== undefined) {
      for (const override of mcpConfigOverrides(mcpServer)) args.push("-c", override);
    }
    args.push("--");
    return { binary: "codex", args, env: clientEnvironment("codex", input.executeSubscription), cwd: input.workspace.cwd, stdin: input.prompt, finalOutputPath };
  }
  const maxBudget = input.maxBudgetUsd ?? 0.20;
  if (!Number.isFinite(maxBudget) || maxBudget <= 0 || maxBudget > 0.20) throw new Error("Claude client A/B budget must be a positive amount no greater than USD 0.20");
  const args = ["--print", "--bare", "--restricted", "--permission-mode", "dontAsk", "--strict-mcp-config", "--no-session-persistence", "--verbose", "--output-format", "stream-json", "--json-schema", await readFile(input.workspace.schemaPath, "utf8"), "--max-budget-usd", String(maxBudget), "--model", input.expectedModel, "--tools", ""];
  if (input.effort !== undefined) args.push("--effort", input.effort);
  if (mcpServer === undefined) {
    args.push("--tools", "");
  } else {
    const configPath = path.join(input.workspace.rootDir, "claude-mcp.json");
    await writeFile(configPath, `${JSON.stringify({ mcpServers: { akasha: mcpServer } })}\n`, { mode: 0o600 });
    args.push("--mcp-config", configPath, "--allowedTools", "mcp__akasha__build_context_pack");
  }
  return { binary: "claude", args, env: clientEnvironment("claude"), cwd: input.workspace.cwd, stdin: input.prompt, finalOutputPath };
}
function signalOwnedChild(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, signal); return; } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  child.kill(signal);
}
export async function runClientCommand(command: ClientCommand, timeoutMs = 120_000, exchange?: (line: string) => string | null | undefined): Promise<{ stdout: string; stderr: string }> {
  positive(timeoutMs, "client A/B timeoutMs");
  return await new Promise((resolve, reject) => {
    const child = spawn(command.binary, command.args, { cwd: command.cwd, env: command.env, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let stopped: Error | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: string) => {
      if (stopped) return;
      stopped = new Error(reason);
      signalOwnedChild(child, "SIGTERM");
      escalation = setTimeout(() => signalOwnedChild(child, "SIGKILL"), 2000);
    };
    const onInterrupt = () => stop("client A/B client command interrupted");
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, onInterrupt);
    const timer = setTimeout(() => stop("client A/B client command timed out"), timeoutMs);
    const lines = exchange === undefined ? undefined : createInterface({ input: child.stdout });
    lines?.on("line", (line) => {
      try {
        const reply = exchange!(line);
        if (reply === null) child.stdin.end();
        else if (reply !== undefined) child.stdin.write(reply);
      } catch (error: unknown) { stop(error instanceof Error ? error.message : "Codex account query failed"); }
    });
    const cleanup = () => {
      lines?.close();
      clearTimeout(timer);
      clearTimeout(escalation);
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.removeListener(signal, onInterrupt);
    };
    child.stdin.on("error", () => stop("client A/B client stdin failed"));
    if (exchange === undefined) child.stdin.end(command.stdin);
    else child.stdin.write(command.stdin);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => { stopped = error; });
    child.once("close", (code) => {
      // The parent may exit before detached descendants close their own streams.
      signalOwnedChild(child, "SIGKILL");
      cleanup();
      if (stopped) { reject(stopped); return; }
      if (code !== 0) { reject(new Error(`client A/B client command failed with exit code ${code ?? "signal"}`, { cause: { stdout, stderr } })); return; }
      resolve({ stdout, stderr });
    });
  });
}
export async function writeResultAtomically(destination: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
}
async function cliVersion(binary: string): Promise<string> {
  const command: ClientCommand = { binary, args: ["--version"], env: clientEnvironment(binary === "codex" ? "codex" : "claude"), cwd: process.cwd(), stdin: "", finalOutputPath: "" };
  const result = await runClientCommand(command, 10_000);
  const version = result.stdout.trim();
  if (!version) throw new Error(`${binary} did not report a CLI version`);
  return version;
}
export async function readCodexSubscriptionStatus(execute = runClientCommand): Promise<CodexSubscriptionStatus> {
  const rpc = (id: number, method: string, params: unknown) => `${JSON.stringify({ id, method, params })}\n`;
  let account: unknown;
  let status: CodexSubscriptionStatus | undefined;
  await execute({
    binary: "codex", args: ["app-server", "--stdio", ...CODEX_SUBSCRIPTION_CONFIG],
    env: clientEnvironment("codex", true), cwd: os.tmpdir(), finalOutputPath: "",
    stdin: rpc(1, "initialize", { clientInfo: { name: "akasha_client_eval", version: "1.0.0" }, capabilities: { experimentalApi: false } }),
  }, 60_000, (line) => {
    const event: unknown = JSON.parse(line);
    object(event, "Codex account event");
    if (event.error !== undefined) throw new Error("Codex account or usage query failed");
    if (event.id === 1) return '{"method":"initialized"}\n' + rpc(2, "account/read", { refreshToken: false });
    if (event.id === 2) { account = event.result; return rpc(3, "account/rateLimits/read", {}); }
    if (event.id === 3) { status = parseCodexSubscriptionStatus(account, event.result); return null; }
    return undefined;
  });
  if (status === undefined) throw new Error("Codex subscription status is unavailable");
  return status;
}
export function createEvaluationCorpusSource(repoDir: string): import("../../application/evaluation/ports.js").EvaluationCorpusSource {
  return {
    headSha: () => git(repoDir, ["rev-parse", "HEAD"]),
    hasTrackedChanges: () => gitHasTrackedChanges(repoDir, ["diff", "--quiet", "--no-ext-diff", "--"]) || gitHasTrackedChanges(repoDir, ["diff", "--cached", "--quiet", "--no-ext-diff", "--"]),
    readAtRevision: (sha, sourcePath) => readTracked(repoDir, sha, sourcePath),
  };
}
export function createClientEvaluationPorts(): import("../../application/evaluation/ports.js").ClientEvaluationPorts {
  return {
    executionPolicy: () => ({ paidEvaluationEnabled: process.env.AKASHA_ALLOW_PAID_CLIENT_EVAL === "1", claudeCredentialsAvailable: typeof process.env.ANTHROPIC_API_KEY === "string" && Boolean(process.env.ANTHROPIC_API_KEY.trim()) }),
    async reserveResultDirectory(directory) { await mkdir(path.dirname(directory), { recursive: true }); await mkdir(directory); },
    saveEvidence: writeResultAtomically,
    createWorkspace: createClientWorkspace,
    removeWorkspace: (workspace) => rm(workspace.rootDir, { recursive: true, force: true }),
    buildCommand: buildClientCommand,
    executeClient: runClientCommand,
    readFinalOutput: (command) => readFile(command.finalOutputPath, "utf8"),
    cliVersion,
    readSubscriptionStatus: readCodexSubscriptionStatus,
    nowMilliseconds: () => performance.now(),
  };
}
