import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runCli } from '../src/interfaces/cli/cli.js';

it('generated hooks separate runtime paths from the caller workspace without copying credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ariadne-memory-relocation-'));
  try {
    const runtimeDir = join(dir, "runtime with 'quotes");
    const cwd = join(dir, 'project');
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'ONLY_LOCAL=fixture-value\n');
    mkdirSync(cwd);
    mkdirSync(join(dir, 'bin'));
    const node = join(dir, 'bin/node');
    writeFileSync(node, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$DMO_CWD" "$ONLY_LOCAL" "$@"\n');
    chmodSync(node, 0o755);
    await runCli(['init', '--project', 'example'], { cwd, runtimeDir, envFile });
    for (const [file, suffix, args] of [
      ['bin/mcp-server.sh', 'dist/src/mcp/server.js', []],
      ['hooks/session-start.sh', 'dist/src/cli.js', []],
      ['hooks/session-end.sh', 'dist/src/cli.js', ['summary']],
    ] as const) {
      const script = join(cwd, '.akasha', file);
      const result = spawnSync(script, [...args], { encoding: 'utf8', env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, TMPDIR: dir } });
      expect(result.status, result.stderr).toBe(0);
      const lines = result.stdout.split('\n');
      expect(lines.slice(0, 2)).toEqual([cwd, cwd]);
      expect(lines[2]).toBe('fixture-value');
      expect(lines[3]).toBe(join(runtimeDir, suffix));
      expect(readFileSync(script, 'utf8')).not.toContain('fixture-value');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
