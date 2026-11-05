import path from "node:path";
import ts from "typescript";

export type Layer = "domain" | "application" | "infrastructure" | "interfaces" | "composition" | "compatibility" | "tooling";
export type Ownership = { layer: Layer; context: string; target?: string };
export type ArchitectureMap = { schema_version: number; files: Record<string, Ownership> };

const inwardLayers: Record<Layer, readonly Layer[]> = {
  domain: ["domain"],
  application: ["domain", "application"],
  infrastructure: ["domain", "application", "infrastructure"],
  interfaces: ["domain", "application", "infrastructure", "interfaces", "composition"],
  composition: ["domain", "application", "infrastructure", "interfaces", "composition"],
  compatibility: ["domain", "application", "infrastructure", "interfaces", "composition"],
  tooling: ["domain", "application", "infrastructure", "interfaces", "composition", "tooling"],
};
const pureBuiltins = new Set(["node:path", "node:crypto", "node:util"]);

export function inspectArchitecture(input: {
  map: ArchitectureMap;
  files: ReadonlyMap<string, string>;
  compilerOptions?: ts.CompilerOptions;
  packageRoot?: string;
}): string[] {
  const violations: string[] = [];
  const { map, files } = input;
  if (map.schema_version !== 1) violations.push("unsupported architecture map schema");
  for (const file of files.keys()) if (!map.files[file]) violations.push(`unowned runtime file ${file}`);
  for (const [file, owner] of Object.entries(map.files)) {
    if (!files.has(file)) { violations.push(`stale ownership ${file}`); continue; }
    if (!inwardLayers[owner.layer]) { violations.push(`unknown layer ${file}`); continue; }
    if (owner.context !== "memory") violations.push(`unexpected context ${file}`);
    if (owner.layer === "compatibility" && (!owner.target || !map.files[owner.target] || map.files[owner.target]?.layer === "compatibility")) {
      violations.push(`compatibility target missing ${file}`);
    }
    if (!file.endsWith(".ts")) continue;
    const source = ts.createSourceFile(file, files.get(file)!, ts.ScriptTarget.Latest, true);
    const inner = owner.layer === "domain" || owner.layer === "application";
    function dependency(specifier: string): void {
      let resolved: string | undefined;
      if (specifier.startsWith(".")) {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        resolved = [base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}/index.ts`].find((candidate) => files.has(candidate));
        if (!resolved) { violations.push(`unresolved import ${file} -> ${specifier}`); return; }
      } else if (input.packageRoot) {
        const resolution = ts.resolveModuleName(specifier, path.join(input.packageRoot, file), input.compilerOptions ?? {}, ts.sys).resolvedModule;
        if (resolution && !resolution.isExternalLibraryImport) resolved = path.relative(input.packageRoot, resolution.resolvedFileName).split(path.sep).join("/");
      }
      if (resolved) {
        const target = map.files[resolved];
        if (!target) { violations.push(`unowned dependency ${file} -> ${resolved}`); return; }
        if (target.context !== owner.context) violations.push(`cross context import ${file} -> ${resolved}`);
        if (!inwardLayers[owner.layer].includes(target.layer)) violations.push(`outward import ${file} -> ${resolved}`);
        return;
      }
      if (specifier.startsWith("/") || specifier.startsWith("#") || specifier.startsWith("@ariadne/") || specifier.startsWith("packages/") || specifier.startsWith("modules/")) {
        violations.push(`unresolved context import ${file} -> ${specifier}`);
      } else if (inner && (!pureBuiltins.has(specifier) || owner.layer === "domain")) {
        violations.push(`external dependency in ${owner.layer} ${file} -> ${specifier}`);
      }
    }
    function moduleExpression(expression: ts.Node): void {
      if (ts.isStringLiteralLike(expression)) dependency(expression.text);
      else violations.push(`computed module dependency ${file}`);
    }
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) moduleExpression(node.moduleSpecifier);
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression) moduleExpression(node.moduleReference.expression);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) moduleExpression(node.argument.literal);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        if (node.arguments[0]) moduleExpression(node.arguments[0]);
      }
      if (inner && ts.isIdentifier(node) && ["process", "global", "globalThis", "fetch", "PgPool", "PgPoolClient", "PgQueryable", "PgQueryRow"].includes(node.text)) {
        violations.push(`host or SQL capability in ${owner.layer} ${file}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...new Set(violations)].sort();
}
