import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { errorMessage, isRecord, parseScipJsonText } from "../../domain/indexing/scip.js";

export function parseScipInputFile(inputPath: string): Record<string, unknown> {
  const rawInput = readFileSync(inputPath, 'utf8');
  const parsedInput = parseScipJsonText(rawInput);
  if (parsedInput.ok) return parsedInput.value;

  if (inputPath.endsWith('.json')) {
    throw new Error(
      `SCIP import expects JSON from 'scip print --json'; failed to parse ${inputPath}: ${parsedInput.error}`
    );
  }

  const printed = printScipBinaryAsJson(inputPath, parsedInput.error);
  const parsedPrinted = parseScipJsonText(printed);
  if (parsedPrinted.ok) return parsedPrinted.value;

  throw new Error(
    `SCIP import could not parse JSON emitted by 'scip print --json ${inputPath}': ${parsedPrinted.error}`
  );
}

export function printScipBinaryAsJson(inputPath: string, parseError: string): string {
  try {
    return execFileSync('scip', ['print', '--json', inputPath], {
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      maxBuffer: 128 * 1024 * 1024
    });
  } catch (error) {
    const stderr = isRecord(error) && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const detail = stderr || errorMessage(error);
    throw new Error(
      `SCIP import could not parse ${inputPath} as JSON (${parseError}) and could not run ` +
        `'scip print --json ${inputPath}' for binary import: ${detail}. ` +
        `Install the official scip CLI, or run 'scip print --json ${inputPath} > index.scip.json' and import that JSON file.`
    );
  }
}