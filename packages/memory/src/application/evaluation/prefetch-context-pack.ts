import { createHash } from "node:crypto";
import { assertClientContextPack, type ClientAbExperiment, type ClientAbPreflight, type ClientPrefetchPack, type PreparedClientTask } from "./client-policy.js";

export type ContextPackReceipt = { id: string; selectedMemoryIds: string[]; packMarkdown: string };
export type ContextPackReceipts = {
  cursor(): Promise<string>;
  since(cursor: string, scope: { organizationId: string; projectKey: string; task: string }): Promise<ContextPackReceipt[]>;
};
export type ContextPackCommand = { execute(): Promise<{ stdout: string; durationMs: number }> };

export async function prefetchContextPack(input: {
  experiment: ClientAbExperiment; task: PreparedClientTask; preflight: ClientAbPreflight;
  receipts: ContextPackReceipts; command: ContextPackCommand;
}): Promise<ClientPrefetchPack> {
  const required = input.preflight.tasks.find((task) => task.taskId === input.task.id)?.requiredMemoryIds;
  if (!required?.length) throw new Error("CLI prefetch requires the seeded task identities");
  const cursor = await input.receipts.cursor();
  if (typeof cursor !== "string" || !/^\d+$/.test(cursor)) throw new Error("CLI prefetch receipt cursor is unavailable");
  const output = await input.command.execute();
  const rows = await input.receipts.since(cursor, {
    organizationId: input.experiment.organizationId,
    projectKey: input.experiment.projectKey,
    task: input.task.task,
  });
  const row = rows[0];
  if (rows.length !== 1 || row === undefined || typeof row.packMarkdown !== "string" || output.stdout !== row.packMarkdown + "\n") {
    throw new Error("CLI prefetch requires exactly one fresh receipt matching stdout byte for byte");
  }
  assertClientContextPack(input.task, row, input.preflight.allowedMemoryIds, required);
  return {
    packMarkdown: row.packMarkdown,
    receipt: { contextPackRunId: row.id, selectedMemoryIds: row.selectedMemoryIds, packSha256: createHash("sha256").update(row.packMarkdown).digest("hex"), cliDurationMs: output.durationMs },
  };
}
