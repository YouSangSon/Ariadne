import { createGoalRunToolHandlers as create } from "../application/tools/goal-run-handlers.js";
import { toolRuntime } from "../composition/runtime/tool-runtime.js";
export function createGoalRunToolHandlers(input: Omit<Parameters<typeof create>[0], "runtime">) {
  return create({ ...input, runtime: toolRuntime });
}
