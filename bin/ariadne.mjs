#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommand } from '../lib/command.mjs'
import { scrub } from '../lib/scrub.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const memory = join(root, 'packages/memory')
const code = join(root, 'packages/code')
const [command, ...args] = process.argv.slice(2)
const help = `Ariadne — one harness, one checkout

  ariadne setup                       Install locked internal dependencies and build
  ariadne verify                      Core + memory + code verification
  ariadne context [--root path] [--req slug] [--budget brief|standard|deep]
  ariadne code <command>               Code impact, local facts, MCP and UI (--help)
  ariadne memory init|pack|remember|reindex <options>
  ariadne memory serve|worker|mcp|migrate
  ariadne memory backup-create|backup-verify|restore-smoke
  ariadne knowledge promote|index --vault path --project name
  ariadne install-rules [--prefix path] [--global-pointer]

Run from your target project. No external model is selected by this launcher.
Memory configuration: node --env-file=/path/to/ariadne/.env /path/to/ariadne/bin/ariadne.mjs memory ...
`

function built(path) {
  if (!existsSync(path)) throw new Error('Build missing. Run Ariadne setup in the Ariadne checkout first.')
  return path
}
async function main() {
  if (!command || ['--help', '-h', 'help'].includes(command)) { console.log(help); return 0 }
  if (['setup', 'verify'].includes(command)) {
    return runCommand(process.execPath, [join(root, 'scripts/product.mjs'), command, ...args], { cwd: root })
  }
  if (command === 'context') return runCommand(process.execPath, [join(root, 'lib/context-pack.mjs'), ...args])
  if (command === 'install-rules') return runCommand(process.execPath, [join(root, 'scripts/install.mjs'), '--root', root, ...args])
  if (command === 'knowledge') {
    const script = { promote: 'promote.mjs', index: 'graph-index.mjs' }[args[0]]
    if (!script) throw new Error('knowledge requires promote or index')
    return runCommand(process.execPath, [join(root, 'modules/llm-wiki', script), ...args.slice(1)])
  }
  if (command === 'code') {
    const forwarded = [...args]
    if (['install-agent', 'install-hook'].includes(args[0])) {
      if (!args.includes('--command')) forwarded.push('--command', join(root, 'bin/code.mjs'))
      if (args[0] === 'install-agent' && !args.includes('--name')) forwarded.push('--name', 'ariadne-code')
    }
    return runCommand(process.execPath, [built(join(code, 'dist/src/cli.js')), ...forwarded])
  }
  if (command === 'memory') {
    if (!args.length || ['--help', '-h'].includes(args[0])) { console.log(help); return 0 }
    if (args[0] === 'init') {
      const { runCli } = await import(built(join(memory, 'dist/src/cli.js')))
      console.log(await runCli(args, { runtimeDir: memory, envFile: join(root, '.env') }))
      return 0
    }
    if (args[0] === 'backup-create') return runCommand('sh', [join(memory, 'scripts/create-backup.sh'), ...args.slice(1)], { cwd: memory })
    const service = {
      serve: 'src/app/server.js', worker: 'src/app/worker.js', mcp: 'src/mcp/server.js',
      migrate: 'src/db/migrate.js', 'backup-verify': 'scripts/backup-verify.js',
      'restore-smoke': 'scripts/restore-smoke.js',
    }[args[0]]
    if (service) return runCommand(process.execPath, [built(join(memory, 'dist', service)), ...args.slice(1)], args[0] === 'restore-smoke' ? { cwd: memory } : {})
    return runCommand(process.execPath, [built(join(memory, 'dist/src/cli.js')), ...args])
  }
  throw new Error(`unknown command: ${command}`)
}

try { process.exitCode = await main() }
catch (error) { console.error(`ariadne: ${scrub(error.message).text}`); process.exitCode = 2 }
