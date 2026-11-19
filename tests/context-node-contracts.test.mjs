import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { checkContextGoldens, fromHex, toHex } from '../scripts/context-node-goldens.mjs'

const corpus = JSON.parse(readFileSync(new URL('../contracts/context/node-v1/cases.json', import.meta.url)))
const expected = JSON.parse(readFileSync(new URL('../contracts/context/node-v1/expected.json', import.meta.url)))
const result = (id) => { const value = expected.cases.find((entry) => entry.id === id); assert.ok(value, id); return value }

test('actual Node Context exports and fake-store read trace preserve frozen goldens', () => checkContextGoldens(expected))
test('fixture format roundtrips isolated UTF-16 and distinguishes UTF-8 output replacement', () => {
  assert.equal(toHex(fromHex('d800d83dde00dfff')), 'd800d83dde00dfff')
  const pack = result('render-astral-cut').value
  assert.ok(pack.pack_utf16_hex.includes('d83d2026'))
  assert.ok(pack.pack_utf8_hex.includes('efbfbde280a6'))
  assert.equal(fromHex(pack.pack_utf16_hex).length, pack.pack_utf16_units)
})
test('compound errors retain the production read order and first failure', () => {
  assert.deepEqual(result('build-parse-all-before-duplicate').trace, [])
  assert.equal(result('build-parse-all-before-duplicate').error, 'skill selection requires slug@SHA256')
  assert.deepEqual(result('build-first-hash-stops').trace, ['readSkill:research'])
  assert.deepEqual(result('build-handoff-before-decisions').trace, ['readHandoff'])
  assert.deepEqual(result('build-two-active-later-invalid').trace, ['readHandoff', 'readDecisions', 'listRequirements', 'readRequirement:one', 'readRequirement:two', 'readRequirement:bad'])
  assert.match(result('build-two-active-later-invalid').error, /metadata.status/)
})
test('whole mandatory text and accepted optional LIFO removal use the final serialized budget', () => {
  assert.equal(result('render-brief-mandatory-limit-0').value.pack_utf16_units, 4000)
  assert.match(result('render-brief-mandatory-limit-1').error, /필수 컨텍스트/)
  const pack = fromHex(result('render-final-lifo-counter-9-to-10').value.pack_utf16_hex)
  assert.match(pack, /budget-omitted optional items: 12;/)
  assert.ok(!pack.includes('s'.repeat(300)))
  assert.match(result('render-over-verification').error, /필수 컨텍스트/)
  assert.match(result('render-over-skill').error, /필수 컨텍스트/)
})
test('catalog projects typed metadata and leaves body, cap, sorting and deduplication to their owners', () => {
  const skills = result('catalog-order-returned-name-duplicate').value.skills
  assert.deepEqual(skills.map((skill) => skill.name), ['returned-name', 'research', 'returned-name'])
  for (const skill of skills) assert.equal(Object.hasOwn(skill, 'content'), false)
  assert.equal(result('catalog-over100-pure-no-cap').value.skills.length, 101)
  assert.ok(corpus.cases.some((entry) => entry.id === 'build-explicit' && entry.store.skills.research.content_hex.includes(toHex('[REDACTED_ANTHROPIC_KEY]'))))
})
