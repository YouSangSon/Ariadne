import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { commandPlan, lifecycleEnvironment, lifecycleSteps } from '../core/domain/product.mjs'
import { runProduct } from '../core/application/product.mjs'
import { selectModules } from '../lib/module-selection.mjs'

const root = new URL('../', import.meta.url)
const inputsURL = new URL('contracts/core/product-node-v1/cases.json', root)
const expectedURL = new URL('contracts/core/product-node-v1/expected.json', root)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sources = ['core/domain/product.mjs', 'core/application/product.mjs', 'lib/module-selection.mjs', 'bin/Ariadne.mjs', 'scripts/product.mjs', 'scripts/verify.mjs']

export async function productGoldens() {
  assert.equal(process.version, 'v24.22.2', 'product oracle requires pinned Node')
  const inputs = readFileSync(inputsURL)
  const cases = []
  for (const input of JSON.parse(inputs).cases) {
    const before = structuredClone(input)
    const entry = { id: input.id }
    try {
      switch (input.op) {
        case 'plan': entry.value = commandPlan(input.command, input.args, input.codeCommand); break
        case 'select': entry.value = [...selectModules(input.args, input.defaults)]; break
        case 'environment': entry.value = lifecycleEnvironment(input.action, input.environment); break
        case 'steps': entry.value = lifecycleSteps(input.action, new Set(input.modules)); break
        case 'run': {
          entry.events = []
          let runs = 0, reports = 0
          entry.value = await runProduct(input.action, new Set(input.modules), {
            report: (message) => {
              entry.events.push({ type: 'report', message })
              if (reports++ === input.reportErrorAt) throw new Error('report failed')
            },
            run: async (step) => {
              entry.events.push({ type: 'run', step })
              const index = runs++
              if (index === input.runErrorAt) throw new Error('run failed')
              return input.statuses?.[index] ?? 0
            },
          })
          break
        }
        default: throw new Error(`unknown oracle operation: ${input.op}`)
      }
    } catch (error) { entry.error = error.message }
    assert.deepEqual(input, before, `oracle mutated ${input.id}`)
    cases.push(entry)
  }
  return {
    provenance: {
      runtime: { node: process.version, unicode: process.versions.unicode, v8: process.versions.v8 },
      profile: 'typed argv strings, ordered Set modules, string environment, injected sequential run/report; no process launch',
      source_sha256: Object.fromEntries(sources.map((path) => [path, sha256(readFileSync(new URL(path, root)))])),
      inputs_sha256: sha256(inputs),
      oracle_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    },
    cases,
  }
}

export async function checkProductGoldens(expected) {
  assert.deepEqual(await productGoldens(), expected, 'product golden drift')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') writeFileSync(expectedURL, JSON.stringify(await productGoldens(), null, 2) + '\n')
  else await checkProductGoldens(JSON.parse(readFileSync(expectedURL, 'utf8')))
}
