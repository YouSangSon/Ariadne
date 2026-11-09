import { instrumentToolRegistry as create } from "../application/tools/tool-registry-instrumentation.js";
import { toolRuntime } from "../composition/runtime/tool-runtime.js";
export function instrumentToolRegistry(input: Omit<Parameters<typeof create>[0], "runtime">) {
  return create({ ...input, runtime: toolRuntime });
}
