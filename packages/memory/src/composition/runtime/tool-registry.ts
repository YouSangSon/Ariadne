import type {
  CreateToolRegistryOptions,
  ToolRegistry,
} from "../../application/contracts/tools.js";
import { createToolHandlers } from "../../application/tools/tool-handlers.js";
import { instrumentToolRegistry } from "../../application/tools/tool-registry-instrumentation.js";
import { assertCreateToolRegistryOptions } from "../../application/tools/tool-registry-validation.js";
import { createCanonicalServicesResolver } from "./canonical-services.js";
import { toolRuntime } from "./tool-runtime.js";

export function createToolRegistry(
  options: CreateToolRegistryOptions = {},
): ToolRegistry {
  assertCreateToolRegistryOptions(options);

  const cwd = options.cwd ?? process.cwd();
  const withCanonicalServices =
    options.withCanonicalServices ??
    createCanonicalServicesResolver({
      resolveCanonicalServices: options.resolveCanonicalServices,
    });
  const handlers = createToolHandlers({ options, cwd, withCanonicalServices, runtime: toolRuntime });

  return instrumentToolRegistry({ options, handlers, withCanonicalServices, runtime: toolRuntime });
}
