import { errorMessage } from "../../../domain/contracts/diff/shared.js";
import type { ContractEndpoint, CurrentContractParse } from "../../../domain/contracts/diff/types.js";
import { extractOpenApiJsonCompatibility, parseOpenApiYamlCompatibility } from "./openapi.js";

export type CurrentYamlRoute = {
  path: string;
  indent: number;
  childIndent?: number;
};

export const OPENAPI_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

export function parseCurrentOpenApiContract(content: string, contractPath: string): CurrentContractParse {
  if (contractPath.toLowerCase().endsWith('.json')) {
    return parseOpenApiJsonEndpoints(content);
  }
  const parsed = parseOpenApiYamlEndpoints(content);
  if (!parsed.ok) return parsed;
  const compatibility = parseOpenApiYamlCompatibility(content);
  if (!compatibility.ok) {
    return {
      ok: false,
      endpoints: [],
      warning: compatibility.warning
    };
  }
  return {
    ...parsed,
    ...(compatibility.compatibility !== undefined ? { compatibility: compatibility.compatibility } : {})
  };
}

export function parseOpenApiJsonEndpoints(content: string): CurrentContractParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return {
      ok: false,
      endpoints: [],
      warning: `current OpenAPI JSON could not be parsed: ${errorMessage(error)}`
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      endpoints: [],
      warning: 'current OpenAPI JSON could not be parsed: root document must be an object'
    };
  }
  const marker = (parsed as { openapi?: unknown; swagger?: unknown }).openapi ??
    (parsed as { openapi?: unknown; swagger?: unknown }).swagger;
  if (typeof marker !== 'string' || marker.length === 0) {
    return {
      ok: false,
      endpoints: [],
      warning: 'current OpenAPI JSON could not be parsed: missing OpenAPI version marker'
    };
  }
  const paths = (parsed as { paths?: unknown }).paths;
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) {
    return {
      ok: false,
      endpoints: [],
      warning: 'current OpenAPI JSON could not be parsed: paths must be an object'
    };
  }
  const endpoints: ContractEndpoint[] = [];
  for (const [routePath, pathItem] of Object.entries(paths as Record<string, unknown>)) {
    if (!routePath.startsWith('/')) continue;
    if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) {
      return {
        ok: false,
        endpoints: [],
        warning: `current OpenAPI JSON could not be parsed: path item must be an object for ${routePath}`
      };
    }
    for (const method of Object.keys(pathItem as Record<string, unknown>)) {
      const normalizedMethod = method.toLowerCase();
      if (!OPENAPI_METHODS.has(normalizedMethod)) continue;
      const operation = (pathItem as Record<string, unknown>)[method];
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
        return {
          ok: false,
          endpoints: [],
          warning: `current OpenAPI JSON could not be parsed: operation must be an object for ${normalizedMethod.toUpperCase()} ${routePath}`
        };
      }
      endpoints.push({
        httpMethod: normalizedMethod.toUpperCase(),
        routePath
      });
    }
  }
  const compatibility = extractOpenApiJsonCompatibility(content);
  return {
    ok: true,
    endpoints,
    ...(compatibility !== undefined ? { compatibility } : {})
  };
}

export function parseOpenApiYamlEndpoints(content: string): CurrentContractParse {
  if (!/^\s*(?:openapi|swagger)\s*:/im.test(content)) {
    return {
      ok: false,
      endpoints: [],
      warning: 'current OpenAPI YAML could not be parsed: missing OpenAPI version marker'
    };
  }

  const lines = content.split(/\r?\n/);
  const endpoints: ContractEndpoint[] = [];
  let inPaths = false;
  let pathsIndent = -1;
  let currentRoute: CurrentYamlRoute | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (line.includes('\t')) {
      return {
        ok: false,
        endpoints: [],
        warning: 'current OpenAPI YAML could not be parsed: tabs are not supported for indentation'
      };
    }
    const trimmed = stripYamlComment(line).trim();
    if (trimmed.length === 0) continue;
    const indent = leadingSpaces(line);
    if (!inPaths) {
      if (indent !== 0) continue;
      if (/^paths\s*:\s*\{\s*\}\s*(?:#.*)?$/.test(trimmed)) {
        return { ok: true, endpoints: [] };
      }
      if (/^paths\s*:\s*(?:#.*)?$/.test(trimmed)) {
        inPaths = true;
        pathsIndent = indent;
      }
      continue;
    }

    if (indent <= pathsIndent) break;
    const routePath = parseYamlPathEntry(trimmed);
    if (routePath !== undefined) {
      currentRoute = {
        path: routePath,
        indent
      };
      continue;
    }

    if (/^['"]?\//.test(trimmed)) {
      return {
        ok: false,
        endpoints: [],
        warning: 'current OpenAPI YAML could not be parsed: malformed path entry under paths'
      };
    }

    const methodWithoutColon = /^([a-zA-Z]+)\s*$/.exec(trimmed);
    if (methodWithoutColon && OPENAPI_METHODS.has(methodWithoutColon[1]!.toLowerCase())) {
      return {
        ok: false,
        endpoints: [],
        warning: 'current OpenAPI YAML could not be parsed: malformed method entry under paths'
      };
    }

    if (!currentRoute || indent <= currentRoute.indent) {
      const methodBeforePath = /^([a-zA-Z]+)\s*:/.exec(trimmed);
      if (methodBeforePath && OPENAPI_METHODS.has(methodBeforePath[1]!.toLowerCase())) {
        return {
          ok: false,
          endpoints: [],
          warning: 'current OpenAPI YAML could not be parsed: method entry appears before a path'
        };
      }
      continue;
    }
    if (currentRoute.childIndent === undefined || indent < currentRoute.childIndent) {
      currentRoute.childIndent = indent;
    }
    const methodMatch = /^([a-zA-Z]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!methodMatch) continue;
    if (indent !== currentRoute.childIndent) continue;
    const method = methodMatch[1]!.toLowerCase();
    if (!OPENAPI_METHODS.has(method)) continue;
    const inlineValue = methodMatch[2]!.trim();
    if (inlineValue.length > 0 && !(inlineValue.startsWith('{') && inlineValue.endsWith('}'))) {
      return {
        ok: false,
        endpoints: [],
        warning: 'current OpenAPI YAML could not be parsed: operation must be an object under paths'
      };
    }
    if (inlineValue.length === 0 && !hasYamlMappingChild(lines, lineIndex, indent)) {
      return {
        ok: false,
        endpoints: [],
        warning: 'current OpenAPI YAML could not be parsed: operation must be an object under paths'
      };
    }
    endpoints.push({
      httpMethod: method.toUpperCase(),
      routePath: currentRoute.path
    });
  }

  if (!inPaths) {
    return {
      ok: false,
      endpoints: [],
      warning: 'current OpenAPI YAML could not be parsed: missing paths object'
    };
  }

  return { ok: true, endpoints };
}

export function stripYamlComment(line: string): string {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = index > 0 ? line[index - 1] : undefined;
    if (quote === undefined && (char === '"' || char === "'")) {
      quote = char;
      continue;
    }
    if (quote !== undefined && char === quote && previous !== '\\') {
      quote = undefined;
      continue;
    }
    if (quote === undefined && char === '#') {
      return line.slice(0, index);
    }
  }
  return line;
}

export function leadingSpaces(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

export function parseYamlPathEntry(trimmed: string): string | undefined {
  const quoted = /^(['"])(\/.*?)\1\s*:\s*(?:#.*)?$/.exec(trimmed);
  if (quoted) return quoted[2]!;
  const unquoted = /^(\/.*)\s*:\s*(?:#.*)?$/.exec(trimmed);
  return unquoted?.[1]?.trimEnd();
}

export function hasYamlMappingChild(lines: string[], parentLineIndex: number, parentIndent: number): boolean {
  for (const line of lines.slice(parentLineIndex + 1)) {
    const trimmed = stripYamlComment(line).trim();
    if (trimmed.length === 0) continue;
    if (leadingSpaces(line) <= parentIndent) return false;
    return /^['"]?[A-Za-z0-9_$.-]+['"]?\s*:/.test(trimmed);
  }
  return false;
}