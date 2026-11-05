import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicExports = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/architecture/public-exports.json'), 'utf8')) as {
  base: string;
  modules: Record<string, string[]>;
};
type Layer = 'domain' | 'application' | 'infrastructure' | 'interfaces' | 'composition' | 'compatibility' | 'tooling';
type Ownership = { layer: Layer; context: 'code'; target?: string };
type ArchitectureMap = { schema_version: number; files: Record<string, Ownership> };
const architecture = JSON.parse(readFileSync(path.join(root, 'architecture-map.json'), 'utf8')) as ArchitectureMap;
const originalPaths = new Set(Object.keys(publicExports.modules).map((file) => `src/${file}`));
const pureBuiltins = new Set(['node:crypto', 'node:path']);
const sourceExtensions = /\.(?:[cm]?[jt]sx?|sh)$/;

function authoredFiles(directory: string): string[] {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return authoredFiles(file);
    return sourceExtensions.test(file) || (statSync(path.join(root, file)).mode & 0o111) !== 0 ? [file] : [];
  });
}

function expectedLayer(file: string): Layer | null {
  if (originalPaths.has(file)) return 'compatibility';
  if (file.startsWith('scripts/') || file.startsWith('bench/')) return 'tooling';
  const layer = file.split('/')[1];
  return ['domain', 'application', 'infrastructure', 'interfaces', 'composition'].includes(layer ?? '') ? layer as Layer : null;
}

function resolveSource(file: string, specifier: string, files: Record<string, Ownership>): string | null {
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  for (const candidate of [relative, relative.replace(/\.js$/, '.ts'), relative.replace(/\.mjs$/, '.mts'), `${relative}/index.ts`]) {
    if (files[candidate]) return candidate;
  }
  return null;
}

function inspectSource(file: string, text: string, files: Record<string, Ownership>): { errors: string[]; runtime: string[] } {
  const ownership = files[file];
  if (!ownership) return { errors: [`unclassified source: ${file}`], runtime: [] };
  const layer = ownership.layer;
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const errors: string[] = [];
  const runtime: string[] = [];
  const pure = layer === 'domain' || layer === 'application';
  const report = (problem: string) => errors.push(`${file}: ${problem}`);

  function dependency(specifier: string, typeOnly = false): void {
    if (!specifier.startsWith('.')) {
      if (path.isAbsolute(specifier) || (pure && !pureBuiltins.has(specifier))) report(`forbidden external dependency ${specifier}`);
      return;
    }
    const target = resolveSource(file, specifier, files);
    if (!target) { report(`unclassified or external relative dependency ${specifier}`); return; }
    const targetLayer = files[target]!.layer;
    if (layer !== 'compatibility' && targetLayer === 'compatibility') report(`imports legacy compatibility path ${target}`);
    if (layer === 'domain' && targetLayer !== 'domain') report(`domain depends on ${targetLayer}: ${target}`);
    if (layer === 'application' && !['domain', 'application'].includes(targetLayer)) report(`application depends on ${targetLayer}: ${target}`);
    if (layer === 'infrastructure' && ['interfaces', 'composition'].includes(targetLayer)) report(`infrastructure depends on ${targetLayer}: ${target}`);
    if (!typeOnly) runtime.push(target);
  }

  function walk(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      const typeOnly = node.importClause?.isTypeOnly === true || (!node.importClause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every((item) => item.isTypeOnly));
      dependency(node.moduleSpecifier.text, typeOnly === true);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      dependency(node.moduleSpecifier.text, node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      dependency(node.argument.literal.text, true);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const argument = node.arguments[0];
      if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) dependency(argument.text);
      else if (file === 'bench/config-extraction-profile.ts' && argument?.getText(ast) === "pathToFileURL(path.join(root, 'dist/src', `${file}.js`)).href") {
        const loads: string[] = [];
        function loadCalls(child: ts.Node): void {
          if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'load') {
            const value = child.arguments[0];
            if (!value || !ts.isStringLiteral(value)) report('profile runtime load must have a literal source target');
            else loads.push(`src/${value.text}.ts`);
          }
          ts.forEachChild(child, loadCalls);
        }
        loadCalls(ast);
        if (loads.length !== 4) report('profile runtime loader contract changed');
        for (const target of loads) {
          if (!files[target] || files[target]!.layer === 'compatibility') report(`unclassified profile runtime target ${target}`);
        }
      } else report('unresolved dynamic module dependency');
    }
    if (pure && ts.isIdentifier(node) && ['process', 'global', 'globalThis', 'fetch', 'XMLHttpRequest', 'WebSocket', 'eval'].includes(node.text)) {
      const parent = node.parent;
      const propertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || ((ts.isMethodSignature(parent) || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent) || ts.isPropertyAssignment(parent)) && parent.name === node);
      if (!propertyName || (ts.isPropertyAccessExpression(parent) && parent.expression.getText(ast) === 'globalThis')) report(`forbidden runtime capability ${node.text}`);
    }
    if (pure && ts.isElementAccessExpression(node) && node.expression.getText(ast) === 'globalThis' && ts.isStringLiteral(node.argumentExpression) && ['process', 'fetch'].includes(node.argumentExpression.text)) report(`forbidden runtime capability ${node.argumentExpression.text}`);
    const callableMember = ts.isMethodSignature(node) || ts.isMethodDeclaration(node) || (ts.isPropertySignature(node) && node.type && ts.isFunctionTypeNode(node.type));
    if (pure && callableMember && node.name && ['prepare', 'exec', 'query', 'transaction', 'raw'].includes(node.name.getText(ast))) report(`generic storage method ${node.name.getText(ast)}`);
    if (pure && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && /\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|BEGIN\s+(?:IMMEDIATE|DEFERRED)|SAVEPOINT)\b/i.test(node.getText(ast))) report('SQL belongs to infrastructure');
    ts.forEachChild(node, walk);
  }
  walk(ast);
  if (layer === 'compatibility') {
    for (const statement of ast.statements) {
      if (!ts.isExportDeclaration(statement) && !(file === 'src/cli.ts' && ts.isImportDeclaration(statement))) report('compatibility path contains executable implementation');
    }
  }
  return { errors, runtime };
}

test('the inventory owns every authored source and operator file exactly once', () => {
  assert.equal(architecture.schema_version, 1);
  const authored = ['src', 'scripts', 'bench'].flatMap(authoredFiles).sort();
  assert.deepEqual(Object.keys(architecture.files).sort(), authored);
  for (const [file, owner] of Object.entries(architecture.files)) {
    assert.equal(owner.context, 'code', file);
    assert.equal(owner.layer, expectedLayer(file), `${file} must have ownership independent of its map label`);
    if (owner.target) {
      assert.equal(owner.layer, 'compatibility', file);
      assert.ok(architecture.files[owner.target], `${file}: missing facade target`);
      assert.notEqual(architecture.files[owner.target]!.layer, 'compatibility', file);
    }
  }
});

test('all static, type, export and dynamic dependencies obey the inward boundaries', () => {
  const errors: string[] = [];
  const graph = new Map<string, string[]>();
  for (const file of Object.keys(architecture.files)) {
    assert.match(file, /\.[cm]?[jt]sx?$/, `add a boundary parser for ${file}`);
    const inspected = inspectSource(file, readFileSync(path.join(root, file), 'utf8'), architecture.files);
    errors.push(...inspected.errors);
    graph.set(file, inspected.runtime);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(file: string): void {
    if (visiting.has(file)) { errors.push(`runtime dependency cycle at ${file}`); return; }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const target of graph.get(file) ?? []) visit(target);
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file);
  assert.deepEqual(errors, []);
});

test('negative controls reject reverse imports, disguised SQL, globals and unclassified paths', () => {
  const files: Record<string, Ownership> = {
    'src/domain/control.ts': { layer: 'domain', context: 'code' },
    'src/application/control.ts': { layer: 'application', context: 'code' },
    'src/infrastructure/control.ts': { layer: 'infrastructure', context: 'code' },
    'src/store.ts': { layer: 'compatibility', context: 'code' }
  };
  for (const source of [
    "import type { Db } from '../infrastructure/control.js';",
    "export * from '../infrastructure/control.js';",
    "const module = import('../infrastructure/control.js');",
    "import { db } from '../store.js';",
    "import { readFileSync } from 'node:fs';",
    'const value = process.env.SECRET;',
    'const value = globalThis.process.env.SECRET;',
    'const value = global.process.env.SECRET;',
    'global.fetch(url);',
    "global['fetch'](url);",
    "const value = globalThis['process'].env.SECRET;",
    'interface HiddenDb { query(sql: string): unknown; }',
    'interface HiddenDb { query: (sql: string) => unknown; }',
    "const sql = 'SELECT * FROM facts';",
    "import { hidden } from './unclassified.js';"
  ]) assert.ok(inspectSource('src/domain/control.ts', source, files).errors.length > 0, source);
  assert.ok(inspectSource('src/application/control.ts', "import '../infrastructure/control.js';", files).errors.length > 0);
  assert.ok(inspectSource('src/unknown.ts', '', files).errors.length > 0);
  assert.equal(expectedLayer('src/domain/control.ts'), 'domain');
});

test('every original module preserves the exact baseline exported names', () => {
  assert.ok(readFileSync(path.join(root, 'src/cli.ts'), 'utf8').startsWith('#!/usr/bin/env node\n'));
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(Object.keys(publicExports.modules).map((file) => path.join(root, 'src', file)), parsed.options);
  const checker = program.getTypeChecker();
  for (const [file, expected] of Object.entries(publicExports.modules)) {
    const source = program.getSourceFile(path.join(root, 'src', file));
    const symbol = source && checker.getSymbolAtLocation(source);
    const actual = symbol ? checker.getExportsOfModule(symbol).map((item) => item.name).sort() : [];
    assert.deepEqual(actual, expected, `${file} changed its ${publicExports.base} export contract`);
  }
});
