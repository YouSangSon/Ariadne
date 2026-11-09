export const GUARDED_ENVIRONMENT = ['POSTGRES_HOST', 'PGVECTOR_TEST_URL', 'AKASHA_WRITE_CONCURRENCY_TEST', 'RUN_EVAL', 'DATABASE_URL', 'ARIADNE_SMOKE_DATABASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY']

export function lifecycleEnvironment(action, environment) {
  const env = { ...environment, ONNXRUNTIME_NODE_INSTALL: 'skip' }
  if (['test', 'verify'].includes(action)) for (const key of GUARDED_ENVIRONMENT) delete env[key]
  return env
}

export function lifecycleSteps(action, modules) {
  const steps = []
  const packages = ['memory', 'code'].filter((name) => modules.has(name))
  const npm = (name, args) => steps.push({ command: 'npm', args, cwd: `packages/${name}` })
  if (action === 'setup') for (const name of packages) npm(name, ['ci'])
  if (['setup', 'build'].includes(action)) for (const name of packages) npm(name, ['run', 'build'])
  if (['test', 'verify'].includes(action)) {
    steps.push({ command: 'node', args: ['scripts/verify.mjs', '--modules', [...modules].join(',')], cwd: '' })
    if (modules.has('memory')) {
      npm('memory', ['run', 'typecheck'])
      npm('memory', ['test', '--', '--maxWorkers=1'])
      if (action === 'verify') npm('memory', ['run', 'audit:dependencies'])
    }
    if (modules.has('code')) npm('code', action === 'verify' ? ['run', 'verify'] : ['test'])
  }
  return steps
}

export function commandPlan(command, args, codeCommand) {
  if (!command || ['--help', '-h', 'help'].includes(command)) return { kind: 'help' }
  const node = (path, args, options = {}) => ({ kind: 'process', command: 'node', path, args, ...options })
  if (['setup', 'verify'].includes(command)) return node('scripts/product.mjs', [command, ...args], { cwd: '' })
  if (command === 'context') return node('lib/context-pack.mjs', args)
  if (command === 'skills') return node('lib/skill-catalog.mjs', args)
  if (command === 'eval') {
    const script = { compare: 'compare-cli.mjs', 'memory-ablation': 'memory-ablation-cli.mjs' }[args[0]]
    if (!script) throw new Error('eval requires compare or memory-ablation --file <path>')
    return node(`evaluation/${script}`, args.slice(1))
  }
  if (command === 'ontology') return node('modules/ontology/cli.mjs', args)
  if (command === 'install-rules') return { ...node('scripts/install.mjs', args), installRoot: true }
  if (command === 'knowledge') {
    const script = { promote: 'promote.mjs', index: 'graph-index.mjs' }[args[0]]
    if (!script) throw new Error('knowledge requires promote or index')
    return node(`modules/llm-wiki/${script}`, args.slice(1))
  }
  if (command === 'code') {
    const forwarded = [...args]
    if (['install-agent', 'install-hook'].includes(args[0])) {
      if (!args.includes('--command')) forwarded.push('--command', codeCommand)
      if (args[0] === 'install-agent' && !args.includes('--name')) forwarded.push('--name', 'ariadne-code')
    }
    return node('packages/code/dist/src/cli.js', forwarded, { module: 'code' })
  }
  if (command === 'memory') {
    if (!args.length || ['--help', '-h'].includes(args[0])) return { kind: 'help' }
    if (args[0] === 'init') return { kind: 'memory-init', path: 'packages/memory/dist/src/cli.js', args, module: 'memory' }
    if (args[0] === 'backup-create') return { kind: 'process', command: 'sh', path: 'packages/memory/scripts/create-backup.sh', args: args.slice(1), cwd: 'packages/memory' }
    const service = {
      serve: 'src/app/server.js', worker: 'src/app/worker.js', mcp: 'src/mcp/server.js',
      migrate: 'src/db/migrate.js', 'backup-verify': 'scripts/backup-verify.js',
      'restore-smoke': 'scripts/restore-smoke.js',
    }[args[0]]
    if (service) return node(`packages/memory/dist/${service}`, args.slice(1), { module: 'memory', ...(args[0] === 'restore-smoke' ? { cwd: 'packages/memory' } : {}) })
    return node('packages/memory/dist/src/cli.js', args, { module: 'memory' })
  }
  throw new Error(`unknown command: ${command}`)
}
