import { createToolHandlers as createHandlers } from "../application/tools/tool-handlers.js";
import { assertObject } from "../application/tools/tool-registry-validation.js";
import { toolRuntime } from "../composition/runtime/tool-runtime.js";
export function createToolHandlers(input: Omit<Parameters<typeof createHandlers>[0], "runtime">) {
  assertObject(input, "tool handlers input");
  return createHandlers({ ...input, runtime: toolRuntime });
}
