import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("preserves every historical module export recorded before the refactor", () => {
  const fixture = JSON.parse(fs.readFileSync("tests/architecture/public-exports.json", "utf8")) as { baseline: string; modules: Record<string, string[]> };
  const rootNames = Object.keys(fixture.modules).map((file) => path.resolve(file));
  const program = ts.createProgram(rootNames, { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const changes: string[] = [];
  for (const [file, expected] of Object.entries(fixture.modules)) {
    const source = program.getSourceFile(path.resolve(file));
    const symbol = source && checker.getSymbolAtLocation(source);
    const actual = symbol ? checker.getExportsOfModule(symbol).map((item) => item.name).sort() : [];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) changes.push(`${file}: expected ${expected.join(", ")}; got ${actual.join(", ")}`);
  }
  expect(changes).toEqual([]);
}, 30_000);
