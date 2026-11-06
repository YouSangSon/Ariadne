#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommand } from '../lib/command.mjs'
import { commandPlan } from '../core/domain/product.mjs'
import { scrub } from '../lib/scrub.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const memory = join(root, 'packages/memory')
const [command, ...args] = process.argv.slice(2)
const help = `Ariadne — integrated agent harness

  Ariadne setup [--modules list]       Install and build selected modules (default: all)
  Ariadne verify [--modules list]      Verify selected modules (default: all)
                                     Modules: core,memory,code,ontology (core is always included)
  Ariadne context [--root path] [--req slug] [--budget brief|standard|deep]
                  [--skill slug@sha256 ...]
  Ariadne skills [--root path]        List local skill metadata and pinned selections
  Ariadne eval compare --file path [--root path]  Compare recorded runs offline
  Ariadne code <command>               Code impact, local facts, MCP and UI (--help)
  Ariadne ontology <command>           Ontology operations (--help)
  Ariadne memory init|pack|remember|reindex <options>
  Ariadne memory serve|worker|mcp|migrate
  Ariadne memory backup-create|backup-verify|restore-smoke
  Ariadne knowledge promote|index --vault path --project name
  Ariadne install-rules [--prefix path] [--global-pointer]

Run from your target project. No external model is selected by this launcher.
Memory configuration: node --env-file=/path/to/Ariadne/.env /path/to/Ariadne/bin/Ariadne.mjs memory ...
`

function built(path, module) {
  if (!existsSync(path)) throw new Error(`Build missing. Run Ariadne setup --modules ${module} in the Ariadne checkout first.`)
  return path
}
async function main() {
  const plan = commandPlan(command, args, join(root, 'bin/code.mjs'))
  if (plan.kind === 'help') { console.log(help); return 0 }
  const path = plan.module ? built(join(root, plan.path), plan.module) : join(root, plan.path)
  if (plan.kind === 'memory-init') {
    const { runCli } = await import(path)
    console.log(await runCli(plan.args, { runtimeDir: memory, envFile: join(root, '.env') }))
    return 0
  }
  const forwarded = plan.installRoot ? ['--root', root, ...plan.args] : plan.args
  return runCommand(plan.command === 'node' ? process.execPath : plan.command, [path, ...forwarded], plan.cwd === undefined ? {} : { cwd: join(root, plan.cwd) })
}

try { process.exitCode = await main() }
catch (error) { console.error(`Ariadne: ${scrub(error.message).text}`); process.exitCode = 2 }
