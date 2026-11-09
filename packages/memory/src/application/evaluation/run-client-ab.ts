import path from "node:path";
import { assertObservedPackBudget } from "../../domain/evaluation/payload-metrics.js";
import type { ClientEvaluationPorts } from "./ports.js";
import type { ClaudeStreamResult, ClientAbExperiment, ClientAbPreflight, ClientAbPreflightTask, ClientAbRegistry, ClientAbRunInput, ClientAbRunSummary, ClientCondition, ClientConditionResult, ClientExecutor, ClientPair, ClientPrefetchPack, ClientVendor, CodexSubscriptionStatus } from "./client-policy.js";
import { aggregateClientPairs, assertClientContextPack, assertPaidClientExecutionAllowed, buildClientPrompt, clientAbRunPlan, creditDeclined, gradeClientAnswer, observedCodexModel, parseClaudeStream, parseCodexEvents, parseCodexFinalOutput, positive, preflightInput, text, verifyToolTrace, wordEstimate } from "./client-policy.js";

export async function seedAndPreflightClientAb(input: {
  experiment: ClientAbExperiment; registry: ClientAbRegistry; resultPath?: string;
  maxOutputBytes?: number;
}, ports: Pick<ClientEvaluationPorts, "saveEvidence">): Promise<ClientAbPreflight> {
  if (input.maxOutputBytes !== undefined) positive(input.maxOutputBytes, "maxOutputBytes");
  const memoryIds = new Map<string, string>();
  try {
    for (const record of input.experiment.seedRecords) {
      const seeded = await input.registry.add_memory({
        organizationId: record.organizationId,
        projectKey: input.experiment.projectKey,
        scope: record.scope,
        userScopeId: record.scope === "user" ? input.experiment.userScopeId : undefined,
        kind: record.kind,
        content: record.content,
      });
      const scopeId = record.scope === "project" ? input.experiment.projectKey : input.experiment.userScopeId;
      memoryIds.set(record.id, `${record.scope}:${scopeId}:${seeded.memoryId}`);
    }
    const foreignMemoryId = memoryIds.get("foreign-sentinel");
    if (foreignMemoryId === undefined) throw new Error("client A/B preflight did not seed its foreign decoy");
    const tasks: ClientAbPreflightTask[] = [];
    for (const task of input.experiment.tasks) {
      const pack = await input.registry.build_context_pack(preflightInput(input.experiment, task, input.maxOutputBytes));
      assertObservedPackBudget(pack, input.maxOutputBytes);
      const requiredMemoryIds = task.contextRecords.map((record) => {
        const memoryId = memoryIds.get(record.id);
        if (memoryId === undefined) throw new Error(`client A/B preflight is missing seeded memory ${record.id}`);
        return memoryId;
      });
      const selectedMemoryIds = [...pack.selectedMemoryIds];
      assertClientContextPack(task, pack, input.experiment.targetRecords.map((record) => memoryIds.get(record.id)!), requiredMemoryIds);
      tasks.push({
        taskId: task.id,
        selectedMemoryIds,
        requiredMemoryIds,
        rawInputWordEstimate: wordEstimate(input.experiment.rawCanonicalContext),
        contextPackWordEstimate: wordEstimate(pack.packMarkdown),
        rawCanonicalUtf8Bytes: Buffer.byteLength(input.experiment.rawCanonicalContext, "utf8"),
        contextPackMarkdownUtf8Bytes: Buffer.byteLength(pack.packMarkdown, "utf8"),
        contextPackStructuredJsonUtf8Bytes: Buffer.byteLength(JSON.stringify(pack), "utf8"),
        foreignLeakageCount: 0,
      });
    }
    const result: ClientAbPreflight = {
      ...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }),
      sourceSha: input.experiment.sourceSha,
      corpusVersion: input.experiment.corpusVersion,
      seededRecordCount: input.experiment.seedRecords.length,
      rawCanonicalWordEstimate: wordEstimate(input.experiment.rawCanonicalContext),
      allowedMemoryIds: input.experiment.targetRecords.map((record) => memoryIds.get(record.id)!),
      foreignLeakageCount: 0,
      tasks,
    };
    if (input.resultPath !== undefined) await ports.saveEvidence(input.resultPath, result);
    return result;
  } catch (error: unknown) {
    if (input.resultPath !== undefined) {
      await ports.saveEvidence(input.resultPath, {
        status: "failed",
        ...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }),
        sourceSha: input.experiment.sourceSha,
        error: error instanceof Error ? error.message : "client A/B preflight failed",
      });
    }
    throw error;
  }
}
function conditionResultPath(resultDir: string, vendor: ClientVendor, taskId: string, repeat: number, condition: ClientCondition): string {
  return path.join(resultDir, `${vendor}-${taskId}-r${repeat}-${condition}.json`);
}
function assertClientAuthentication(input: ClientAbRunInput, ports: ClientEvaluationPorts): void {
  if (input.execute !== undefined || input.vendor !== "claude") return;
  if (!ports.executionPolicy().claudeCredentialsAvailable) {
    throw new Error("Claude paid client A/B execution requires ANTHROPIC_API_KEY; no alternate credential source is accepted in bare mode");
  }
}
export async function runClientAb(input: ClientAbRunInput, ports: ClientEvaluationPorts): Promise<ClientAbRunSummary> {
  const profile = input.profile ?? "mcp-roundtrip";
  if (input.maxOutputBytes !== undefined) {
    positive(input.maxOutputBytes, "maxOutputBytes");
    if (profile !== "mcp-roundtrip") throw new Error("maxOutputBytes is supported only by the MCP roundtrip profile");
  }
  if (profile === "cli-prefetch" && (input.vendor !== "codex" || input.prefetch === undefined)) throw new Error("CLI prefetch requires Codex and an actual CLI pack provider");
  if (input.executeSubscription) {
    if (input.executePaid || input.vendor !== "codex" || !input.effort) throw new Error("subscription evaluation requires Codex, explicit effort, and no paid mode");
  } else {
    assertPaidClientExecutionAllowed(input.env ?? { AKASHA_ALLOW_PAID_CLIENT_EVAL: ports.executionPolicy().paidEvaluationEnabled ? "1" : undefined }, input.executePaid);
    if (input.vendor === "codex" && input.execute === undefined) throw new Error("paid Codex A/B execution fails closed; use the explicit subscription mode");
  }
  text(input.model, "client A/B model");
  text(input.resultDir, "client A/B resultDir");
  assertClientAuthentication(input, ports);
  await ports.reserveResultDirectory(input.resultDir);
  const execute: ClientExecutor = input.execute ?? ports.executeClient;
  const getCliVersion = input.getCliVersion ?? ports.cliVersion;
  const version = await getCliVersion(input.vendor);
  const outcomes = new Map<string, ClientConditionResult>();
  const prefetched = new Map<string, ClientPrefetchPack>();
  const usageChecks: CodexSubscriptionStatus[] = [];
  const checkSubscription = async () => {
    if (!input.executeSubscription) return;
    const status = await (input.readSubscriptionStatus ?? ports.readSubscriptionStatus)();
    const previous = usageChecks.at(-1);
    usageChecks.push(status);
    await ports.saveEvidence(path.join(input.resultDir, "codex-subscription-usage.json"), usageChecks);
    if (previous !== undefined && creditDeclined(previous.creditBalance, status.creditBalance)) throw new Error("Codex credits declined during this evaluation; further execution stopped");
  };
  let runIndex = 0;
  try {
    for (const entry of clientAbRunPlan(input.experiment)) {
      runIndex += 1;
      const workspace = await ports.createWorkspace(entry.task.claimKeys);
      const resultPath = conditionResultPath(input.resultDir, input.vendor, entry.task.id, entry.repeat, entry.condition);
      let executionStarted = false;
      let outcomeWritten = false;
      let clientStdinUtf8Bytes: number | undefined;
      let clientDurationMs: number | undefined;
      try {
        const pairKey = `${entry.task.id}:${entry.repeat}`;
        if (profile === "cli-prefetch" && !prefetched.has(pairKey)) {
          // Validate a fresh CLI pack before either side of this pair can invoke a model.
          const pack = await input.prefetch!(entry.task);
          await ports.saveEvidence(path.join(input.resultDir, `cli-${entry.task.id}-r${entry.repeat}.json`), { profile, sourceSha: input.experiment.sourceSha, taskId: entry.task.id, repeat: entry.repeat, ...pack.receipt });
          prefetched.set(pairKey, pack);
        }
        const prompt = buildClientPrompt(entry.task, entry.condition, {
          rawCanonicalContext: input.experiment.rawCanonicalContext,
          scope: input.experiment,
          packMarkdown: profile === "cli-prefetch" ? prefetched.get(pairKey)!.packMarkdown : undefined,
          maxOutputBytes: input.maxOutputBytes,
        });
        const command = await ports.buildCommand({
          vendor: input.vendor,
          condition: entry.condition,
          profile,
          workspace,
          prompt,
          expectedModel: input.model,
          effort: input.effort,
          maxBudgetUsd: input.maxBudgetUsd,
          executeSubscription: input.executeSubscription,
          mcpServer: profile === "mcp-roundtrip" && entry.condition === "on" ? input.mcpServer : undefined,
        });
        await checkSubscription();
        executionStarted = true;
        clientStdinUtf8Bytes = Buffer.byteLength(command.stdin, "utf8");
        const started = ports.nowMilliseconds();
        let executed: Awaited<ReturnType<ClientExecutor>>;
        try { executed = await execute(command); }
        finally { clientDurationMs = ports.nowMilliseconds() - started; }
        const parsed = input.vendor === "codex"
          ? parseCodexEvents(executed.stdout)
          : parseClaudeStream(executed.stdout, input.model);
        verifyToolTrace(profile === "cli-prefetch" ? "off" : entry.condition, parsed.toolCalls, preflightInput(input.experiment, entry.task, input.maxOutputBytes), input.allowedMemoryIds);
        const rawOutput = input.vendor === "codex"
          ? executed.finalOutput ?? await ports.readFinalOutput(command)
          : JSON.stringify((parsed as ClaudeStreamResult).structuredOutput);
        if (input.vendor === "codex") parseCodexFinalOutput(rawOutput);
        const grade = gradeClientAnswer(entry.task, rawOutput);
        const observed = input.vendor === "codex" ? observedCodexModel(executed.stdout) : (parsed as ClaudeStreamResult).observedModel;
        if (observed !== null && observed !== input.model) throw new Error("client A/B observed model differs from the requested model");
        const outcome: ClientConditionResult = {
          profile,
          vendor: input.vendor, taskId: entry.task.id, repeat: entry.repeat, condition: entry.condition,
          runIndex, success: grade.success, inputTokens: parsed.inputTokens, cachedInputTokens: parsed.cachedInputTokens,
          toolCalls: parsed.toolCalls, grade, model: { requested: input.model, observed }, cliVersion: version,
          clientStdinUtf8Bytes, clientDurationMs,
          ...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }),
        };
        await ports.saveEvidence(resultPath, outcome);
        outcomeWritten = true;
        if (!outcome.success) throw new Error(`client A/B ${entry.task.id} ${entry.condition} answer failed grading`);
        outcomes.set(`${entry.task.id}:${entry.repeat}:${entry.condition}`, outcome);
      } catch (error: unknown) {
        // Keep raw diagnostics local for debugging; summaries never include client logs.
        if (error instanceof Error && error.cause !== undefined) await ports.saveEvidence(`${resultPath}.private-diagnostics`, error.cause);
        if (!outcomeWritten) await ports.saveEvidence(resultPath, {
          profile,
          vendor: input.vendor, taskId: entry.task.id, repeat: entry.repeat, condition: entry.condition, runIndex,
          success: false, cliVersion: version,
          clientStdinUtf8Bytes, clientDurationMs,
          ...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }),
          error: error instanceof Error ? error.message : "client A/B condition failed",
        });
        throw error;
      } finally {
        try { if (executionStarted) await checkSubscription(); }
        finally { await ports.removeWorkspace(workspace); }
      }
    }
    const pairs: ClientPair[] = input.experiment.tasks.flatMap((task) => [1, 2, 3].map((repeat) => {
      const off = outcomes.get(`${task.id}:${repeat}:off`);
      const on = outcomes.get(`${task.id}:${repeat}:on`);
      if (off === undefined || on === undefined) throw new Error("client A/B run lost a paired condition result");
      return { vendor: input.vendor, taskId: task.id, repeat, off: { success: off.success, inputTokens: off.inputTokens }, on: { success: on.success, inputTokens: on.inputTokens } };
    }));
    const aggregate = aggregateClientPairs(input.vendor, pairs);
    const all = [...outcomes.values()];
    const model = { requested: input.model, observed: all.every((outcome) => outcome.model.observed === input.model) ? input.model : null };
    const summary: ClientAbRunSummary = {
      profile,
      ...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }),
      vendor: input.vendor, sourceSha: input.experiment.sourceSha, corpusVersion: input.experiment.corpusVersion,
      cliVersion: version, model, pairs, aggregate,
      totals: {
        offInputTokens: all.filter((outcome) => outcome.condition === "off").reduce((sum, outcome) => sum + outcome.inputTokens, 0),
        onInputTokens: all.filter((outcome) => outcome.condition === "on").reduce((sum, outcome) => sum + outcome.inputTokens, 0),
        offCachedInputTokens: all.filter((outcome) => outcome.condition === "off").reduce((sum, outcome) => sum + outcome.cachedInputTokens, 0),
        onCachedInputTokens: all.filter((outcome) => outcome.condition === "on").reduce((sum, outcome) => sum + outcome.cachedInputTokens, 0),
      },
    };
    await ports.saveEvidence(path.join(input.resultDir, `${input.vendor}-summary.json`), summary);
    return summary;
  } catch (error: unknown) {
    await ports.saveEvidence(path.join(input.resultDir, `${input.vendor}-failure.json`), {
      profile,
      ...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }),
      status: "failed", sourceSha: input.experiment.sourceSha, completedConditions: outcomes.size,
      error: error instanceof Error ? error.message : "client A/B execution failed",
    });
    throw error;
  }
}