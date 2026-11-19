import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handoffSections, renderPack } from '../modules/context/domain.mjs'
import { buildPack, skillCatalog } from '../modules/context/application.mjs'
import { skillMetadata, skillSelection } from '../modules/context/skills.mjs'
import { fieldBlock } from '../core/domain/requirement-fields.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFileSync(resolve(root, path))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const profile = { node: 'v24.22.2', icu: '78.3', unicode: '17.0' }
const originalSources = {
  "modules/context/domain.mjs": "359fe560faca88f94fc306d4fe1b30e2859ea18d804674a000c12c67f06786bb",
  "modules/context/application.mjs": "03e7b6eb70cfec1c83d5013c966b6860f64d1dffe21eea3909c5b2453650bae3",
  "modules/context/skills.mjs": "e27e10d64b692baae22720c1d316e843548b99381a925646a070eb3445daf1ea",
  "core/domain/requirement-fields.mjs": "b42ba8decc94483dca7affac81be03c3a977266cb2b16a4f20de6178675397de",
  "lib/budget.mjs": "bc58a2627e8175e2458d55bed81ff1ff454231e0e2f9187975322c29e9beb5e9"
}

// UTF-16BE hex is the fixture boundary; UTF-8 would replace isolated surrogates.
export function fromHex(hex = '') {
  assert.match(hex, /^(?:[a-f0-9]{4})*$/)
  const units = hex.match(/.{4}/g) ?? []
  return units.map((unit) => String.fromCharCode(parseInt(unit, 16))).join('')
}
export const toHex = (text) => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16).padStart(4, '0')).join('')
const packed = (text) => ({ pack_utf16_hex: toHex(text), pack_utf16_units: text.length, pack_utf8_hex: Buffer.from(text, 'utf8').toString('hex') })
const handoff = (input = {}) => Object.fromEntries(['state', 'constraints', 'blockers', 'legacy'].map((key) => [key, fromHex(input[`${key}_hex`])]))
const record = (input) => ({ name: input.name, description: fromHex(input.description_hex), path: input.path, sha256: input.sha256, chars: input.chars, content: fromHex(input.content_hex) })

export function observeContext(entry) {
  const trace = []
  const input = entry.store ?? {}
  const call = (name, fallback) => {
    trace.push(name)
    if (Object.hasOwn(input.errors ?? {}, name)) throw new Error(input.errors[name])
    return fallback()
  }
  const store = {
    readSkill: (id) => call(`readSkill:${id}`, () => { assert.ok(Object.hasOwn(input.skills ?? {}, id), `offline skill missing: ${id}`); return record(input.skills[id]) }),
    readHandoff: () => call('readHandoff', () => fromHex(input.handoff_hex)),
    readDecisions: () => call('readDecisions', () => fromHex(input.decisions_hex)),
    hasRequirement: (slug) => call(`hasRequirement:${slug}`, () => Object.hasOwn(input.requirements ?? {}, slug)),
    readRequirement: (slug) => call(`readRequirement:${slug}`, () => { assert.ok(Object.hasOwn(input.requirements ?? {}, slug), `offline REQ missing: ${slug}`); return fromHex(input.requirements[slug]) }),
    listRequirements: () => call('listRequirements', () => input.requirement_order ?? Object.keys(input.requirements ?? {})),
    listSkills: () => call('listSkills', () => input.skill_order ?? Object.keys(input.skills ?? {})),
  }
  const result = { id: entry.id, kind: entry.kind, trace }
  try {
    switch (entry.kind) {
      case 'handoff': result.value = Object.fromEntries(Object.entries(handoffSections(fromHex(entry.text_hex))).map(([key, text]) => [`${key}_hex`, toHex(text)])); break
      case 'field': result.value = { text_hex: toHex(fieldBlock(fromHex(entry.text_hex), entry.path)) }; break
      case 'selection': result.value = skillSelection(entry.selection); break
      case 'metadata': { const value = skillMetadata(entry.skill_id, fromHex(entry.text_hex)); result.value = { name: value.name, description_hex: toHex(value.description) }; break }
      case 'render': result.value = packed(renderPack({ requirement: fromHex(entry.requirement_hex), handoff: handoff(entry.handoff), decisions: fromHex(entry.decisions_hex), budget: entry.budget, selectedSkills: (entry.selected_skills ?? []).map((skill) => ({ selection: skill.selection, path: skill.path, content: fromHex(skill.content_hex) })) })); break
      case 'build': result.value = packed(buildPack({ store, budget: entry.budget, reqSlug: entry.req_slug ?? null, skills: entry.skills ?? [] })); break
      case 'catalog': {
        const catalog = skillCatalog(store)
        result.value = { schema_version: catalog.schema_version, trust: catalog.trust, skills: catalog.skills.map(({ description, ...skill }) => { assert.equal(Object.hasOwn(skill, 'content'), false); return { ...skill, description_hex: toHex(description) } }) }
        break
      }
      default: throw new Error(`unknown fixture kind ${entry.kind}`)
    }
  } catch (error) { result.error = error.message }
  return result
}

export function generateContextGoldens() {
  const runtime = { node: process.version, icu: process.versions.icu, unicode: process.versions.unicode }
  assert.deepEqual(runtime, profile, 'context oracle runtime drift')
  const sources = Object.fromEntries(Object.keys(originalSources).map((path) => [path, sha256(read(path))]))
  assert.deepEqual(sources, originalSources, 'context production source drift; review before changing frozen hashes')
  const inputs = 'contracts/context/node-v1/cases.json'
  const oracle = 'scripts/context-node-goldens.mjs'
  const corpus = JSON.parse(read(inputs))
  assert.equal(corpus.fixture_version, 1)
  assert.equal(new Set(corpus.cases.map(({ id }) => id)).size, corpus.cases.length, 'duplicate fixture ID')
  return { fixture_version: 1, provenance: { runtime, source_sha256: sources, inputs_sha256: sha256(read(inputs)), oracle_sha256: sha256(read(oracle)) }, cases: corpus.cases.map(observeContext) }
}
export function checkContextGoldens(expected = JSON.parse(read('contracts/context/node-v1/expected.json'))) {
  assert.deepEqual(expected, generateContextGoldens(), 'context golden drift; expected results come only from actual Node')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length <= 3 && [undefined, '--check', '--write'].includes(process.argv[2]), 'usage: context-node-goldens.mjs [--check|--write]')
  if (process.argv[2] === '--write') writeFileSync(resolve(root, 'contracts/context/node-v1/expected.json'), JSON.stringify(generateContextGoldens(), null, 2) + '\n')
  else checkContextGoldens()
}
