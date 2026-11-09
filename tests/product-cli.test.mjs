import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commandPlan } from '../core/domain/product.mjs'

const cli = fileURLToPath(new URL('../bin/Ariadne.mjs', import.meta.url))
function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PARALLAX_EMBEDDING_MODEL: 'stub-sha256' } })
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ariadne-product-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
test('one entry point explains capabilities and rejects unknown commands', (t) => {
  const dir = fixture(t)
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.bin, { Ariadne: 'bin/Ariadne.mjs' })
  symlinkSync(cli, join(dir, 'Ariadne'))
  const help = spawnSync(join(dir, 'Ariadne'), ['--help'], { cwd: dir, encoding: 'utf8', timeout: 60000 })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /Ariadne/)
  assert.match(help.stdout, /^  Ariadne code /m)
  for (const name of ['memory', 'code', 'context', 'knowledge', 'ontology', '--modules']) assert.match(help.stdout, new RegExp(name))
  const unknown = run(dir, 'not-a-command')
  assert.equal(unknown.status, 2, unknown.stderr)
  assert.match(unknown.stderr, /unknown command/)
})

test('memory ablation uses the offline evaluator and preserves caller arguments', () => {
  const args = ['memory-ablation', '--file', 'experiment.json', '--root', '/workspace']
  const plan = commandPlan('eval', args)
  assert.equal(plan.path, 'evaluation/memory-ablation-cli.mjs')
  assert.deepEqual(plan.args, args.slice(1))
  assert.equal(plan.cwd, undefined)
  assert.equal(commandPlan('eval', ['compare', '--file', 'runs.json']).path, 'evaluation/compare-cli.mjs')
})

test('memory ablation is usable through the product CLI from another directory', (t) => {
  const dir = fixture(t)
  const root = fileURLToPath(new URL('..', import.meta.url))
  const result = run(dir, 'eval', 'memory-ablation', '--root', root, '--file', 'evaluation/memory-ablation-example.json')
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.eligibility.comparable, true)
  assert.equal(report.source.path, 'evaluation/memory-ablation-example.json')
  assert.equal(report.observations[0].reported_outcome, 'improvement')
  assert.equal(report.costs.experiment_totals.cost_usd, null)
})
