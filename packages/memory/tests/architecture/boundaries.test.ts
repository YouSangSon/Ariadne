import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { inspectArchitecture, type ArchitectureMap, type Layer } from "./check-boundaries.js";

function runtimeFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? runtimeFiles(file) : /\.(ts|sql|sh)$/.test(entry.name) ? [file] : [];
  });
}

function fixture(files: Record<string, [Layer, string]>, changes: (map: ArchitectureMap) => void = () => {}) {
  const map: ArchitectureMap = { schema_version: 1, files: Object.fromEntries(Object.entries(files).map(([file, [layer]]) => [file, { layer, context: "memory" }])) };
  changes(map);
  return inspectArchitecture({ map, files: new Map(Object.entries(files).map(([file, [, source]]) => [file, source])) });
}

describe("memory architecture", () => {
  it("owns every runtime module, migration asset and operator entry and enforces inward dependencies", () => {
    const map = JSON.parse(fs.readFileSync("architecture-map.json", "utf8")) as ArchitectureMap;
    const files = new Map([...runtimeFiles("src"), ...runtimeFiles("scripts")].map((file) => [file, fs.readFileSync(file, "utf8")]));
    const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
    const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
    expect(inspectArchitecture({ map, files, compilerOptions: options, packageRoot: process.cwd() })).toEqual([]);
  }, 30_000);

  it.each([
    ["type import", 'import type { Adapter } from "../infrastructure/adapter.js";'],
    ["type query", 'type Adapter = import("../infrastructure/adapter.js").Adapter;'],
    ["re-export", 'export { Adapter } from "../infrastructure/adapter.js";'],
    ["dynamic import", 'const adapter = import("../infrastructure/adapter.js");'],
  ])("rejects application to adapter %s", (_kind, source) => {
    expect(fixture({ "src/application/usecase.ts": ["application", source], "src/infrastructure/adapter.ts": ["infrastructure", "export type Adapter = string;"] })).toContain("outward import src/application/usecase.ts -> src/infrastructure/adapter.ts");
  });

  it("rejects domain to application and inner imports through a compatibility facade", () => {
    expect(fixture({ "src/domain/model.ts": ["domain", 'import "../application/usecase.js";'], "src/application/usecase.ts": ["application", 'import "../legacy.js";'], "src/legacy.ts": ["compatibility", 'export * from "./infrastructure/adapter.js";'], "src/infrastructure/adapter.ts": ["infrastructure", ""] }, (map) => { map.files["src/legacy.ts"]!.target = "src/infrastructure/adapter.ts"; })).toEqual(expect.arrayContaining(["outward import src/domain/model.ts -> src/application/usecase.ts", "outward import src/application/usecase.ts -> src/legacy.ts"]));
  });

  it("rejects omitted files, cross-context imports and unresolved aliases", () => {
    expect(fixture({ "src/application/usecase.ts": ["application", 'import "../foreign.js"; import "@ariadne/code/internal";'], "src/foreign.ts": ["application", ""], "src/omitted.ts": ["domain", ""] }, (map) => { map.files["src/foreign.ts"]!.context = "code"; delete map.files["src/omitted.ts"]; })).toEqual(expect.arrayContaining(["unowned runtime file src/omitted.ts", "cross context import src/application/usecase.ts -> src/foreign.ts", "unresolved context import src/application/usecase.ts -> @ariadne/code/internal"]));
  });

  it("rejects host IO and SQL capabilities in application code", () => {
    expect(fixture({ "src/application/usecase.ts": ["application", 'import fs from "node:fs"; type Port = { pool: PgPool }; const token = process.env.TOKEN; fetch("http://localhost"); globalThis.process;'] })).toEqual(expect.arrayContaining(["external dependency in application src/application/usecase.ts -> node:fs", "host or SQL capability in application src/application/usecase.ts: PgPool", "host or SQL capability in application src/application/usecase.ts: process", "host or SQL capability in application src/application/usecase.ts: fetch", "host or SQL capability in application src/application/usecase.ts: globalThis"]));
  });

  it("rejects Node global capability aliases", () => {
    expect(fixture({ "src/application/usecase.ts": ["application", 'global["fetch"]("https://example.invalid");'] })).toContain("host or SQL capability in application src/application/usecase.ts: global");
  });
});
