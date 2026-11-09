import { AdapterRegistry } from "../domain/indexing/adapter-registry.js";
import { BuildSystemPackageAdapter } from "../infrastructure/extractors/build-system-package.js";
import { ConfigInfraSemanticAdapter } from "../infrastructure/extractors/config-infra.js";
import { GoSemanticAdapter, JvmSpringSemanticAdapter, MultiLanguageRegexAdapter, PythonSemanticAdapter, RustSemanticAdapter, TypeScriptJavaScriptSemanticAdapter } from "../infrastructure/extractors/multi-language-regex.js";

export function createDefaultRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(new BuildSystemPackageAdapter());
  registry.register(new ConfigInfraSemanticAdapter());
  registry.register(new TypeScriptJavaScriptSemanticAdapter());
  registry.register(new JvmSpringSemanticAdapter());
  registry.register(new PythonSemanticAdapter());
  registry.register(new GoSemanticAdapter());
  registry.register(new RustSemanticAdapter());
  registry.register(new MultiLanguageRegexAdapter());
  return registry;
}