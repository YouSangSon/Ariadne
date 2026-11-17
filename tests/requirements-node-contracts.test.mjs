import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { checkRequirementsGoldens } from '../scripts/requirements-node-goldens.mjs'

const expectedURL = new URL('../contracts/requirements/node-v1/expected.json', import.meta.url)
const expected = JSON.parse(readFileSync(expectedURL, 'utf8'))
const entry = (id) => {
  const value = expected.cases.find((item) => item.id === id)
  assert.ok(value, 'missing contract case: ' + id)
  return value
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const calls = (id) => entry(id).events.map(({ call }) => call)

test('actual Node Requirements sources reproduce the portable oracle', () => {
  checkRequirementsGoldens(expected)
})

test('contract results preserve lossless UTF16, raw scope and exact JSON payload bytes', () => {
  assert.equal(entry('scalar-lone-high').parse.utf16_hex.criteria[0].statement, 'd800')
  assert.equal(entry('scalar-lone-low').parse.utf16_hex.criteria[0].statement, 'dfff')
  assert.equal(entry('scalar-literal-lone-high').parse.utf16_hex.criteria[0].statement, 'd800')
  assert.equal(entry('scalar-surrogate-pair').parse.utf16_hex.criteria[0].statement, 'd83dde00')
  assert.equal(entry('scalar-double-escape').parse.value.criteria[0].statement, 'quote " slash \\ solidus / tab \t back \b form \f return \r newline \n')
  assert.equal(entry('scalar-folded-strip').parse.value.criteria[0].statement, 'First second\nparagraph\n  indented\nlast')
  assert.equal(entry('scalar-nel').parse.utf16_hex.criteria[0].statement, '0085')
  assert.equal(entry('scalar-trim-nonline-es-whitespace').parse.value.criteria[0].statement, 'result')
  assert.equal(entry('double-quoted-es-whitespace-empty').parse.error.message, 'REQ AC statement must not be empty')
  assert.equal(entry('scalar-ls-ps').parse.error.message, 'REQ unsupported AC indentation or mapping')
  assert.equal(entry('direct-crlf').parse.error.message, 'REQ requires canonical plain mapping keys')
  assert.equal(entry('direct-bom-metadata').parse.error.message, 'REQ metadata: 템플릿의 2칸 들여쓰기 mapping이 필요하다')
  assert.deepEqual(entry('canonical-missing-scope').parse.value.scope, ['', '', '', '', '', '', '', '', '', ''])
  assert.deepEqual(entry('all-scope-blocks').parse.value.scope, [
    '  user_intent: Original intent # retained', '  desired_outcome: Original outcome',
    '  confirmed_facts: []', '  assumptions: []', '  boundary_rules: []', '  must_not_implement: []',
    '  commands: [node --test]', '  verify_gate_required: true', '  verify_gate_reason: Gate reason', '  escalate_after: 3',
  ])
  assert.equal(entry('scope-interior-crlf').parse.value.scope[0], '  user_intent: |-\r\n    first\r\n    next')
  assert.equal(entry('nonhashed-fields-change').load.value.hash, entry('all-scope-blocks').load.value.hash)
  assert.notEqual(entry('scope-comment-spacing').load.value.hash, entry('all-scope-blocks').load.value.hash)
  assert.equal(entry('schema-kind-not-validated').load.value.hash, entry('canonical-missing-scope').load.value.hash)
  assert.equal(entry('optional-priority-passes-omitted').load.value.hash, entry('canonical-missing-scope').load.value.hash)
  const lonePayload = Buffer.from(entry('scalar-lone-high').payloads[0].utf8_hex, 'hex').toString('utf8')
  assert.ok(lonePayload.includes('"statement":"\\ud800"'))
  const rawPayload = Buffer.from(entry('scalar-escaped-ls-ps').payloads[0].utf8_hex, 'hex').toString('utf8')
  assert.ok(rawPayload.includes('line\u2028paragraph\u2029end'))
  assert.ok(Buffer.from(entry('scalar-json-html-escaping').payloads[0].utf8_hex, 'hex').toString('utf8').includes('<>& /'))
  assert.ok(rawPayload.startsWith('{"req_id":"demo","criteria":'))
  assert.ok(!rawPayload.includes('"status"'))
  for (const value of expected.cases) for (const payload of value.payloads ?? []) {
    assert.equal(sha256(Buffer.from(payload.utf8_hex, 'hex')), payload.sha256, value.id)
  }
})

test('error precedence and failed load ports stop at the observed boundary', () => {
  const messages = {
    'slug-before-control': 'REQ slug must use lowercase letters, digits, and hyphens',
    'control-before-top': 'REQ unsupported control character or indentation',
    'top-before-metadata': 'REQ requires canonical plain mapping keys',
    'reqid-before-status': 'REQ metadata.req_id must match the filename slug',
    'status-before-ac': 'REQ metadata.status is unknown',
    'ac-field-collection-before-scalars': 'REQ unsupported AC field',
    'ac-duplicate-field-before-missing': 'REQ duplicate AC field',
    'ac-missing-statement-before-verification': 'REQ AC statement is required',
    'ac-duplicate-id-before-priority': 'REQ invalid or duplicate AC ID',
    'priority-before-passes': 'REQ unsupported AC priority',
    'scope-after-ac': 'REQ unsupported or empty string scalar',
    'scope-duplicate': 'REQ requirement.user_intent: 중복 필드',
  }
  for (const [id, message] of Object.entries(messages)) assert.equal(entry(id).parse.error.message, message, id)
  assert.deepEqual(calls('slug-before-control'), [])
  assert.deepEqual(calls('status-before-ac'), ['readRequirement'])
  assert.deepEqual(calls('read-error'), ['readRequirement'])
  assert.deepEqual(calls('hash-error'), ['readRequirement', 'hash'])
  assert.equal(entry('read-error').load.error.original_port_error, true)
  assert.equal(entry('hash-error').load.error.original_port_error, true)
})

test('source selection uses exact components and UTF16 order before its count cap', () => {
  assert.deepEqual(entry('files-exact-exclusions-utf16').result.value, [
    '../raw', './.harness/handoff/a', '.gitignore', '.harness/handoffx/a', '.harness/reqs/demo.yaml.more',
    '.harness/reqs/other.yaml', 'UPPER', 'a', 'a/.git-more/b', 'a//b', 'a\\b',
    'nested/.harness/handoff/a', 'node_modulesx/a', 'upper', 'z', '\ud800', '😀', '\udc00', '\ue000',
  ])
  assert.deepEqual(entry('files-invalid-reqid-is-not-validated').result.value, ['keep'])
  assert.deepEqual(entry('files-no-selected-req').result.value, ['.harness/reqs/demo.yaml', '.harness/reqs/undefined.yaml'])
  for (const id of ['files-limit-10000', 'files-filter-before-limit', 'files-selected-filter-before-limit']) assert.equal(entry(id).result.count, 10000)
  assert.equal(entry('files-limit-10001').error.message, 'Source input file count exceeds 10000')
  assert.equal(entry('state-filecount-before-factory').result.error.message, 'Source input file count exceeds 10000')
  assert.deepEqual(calls('state-filecount-before-factory'), ['inspectGit'])
})

test('source frames preserve raw bytes, nullable HEAD, mode and empty update calls', () => {
  const value = entry('state-raw-bytes-null-head')
  assert.deepEqual(value.result.value.files, ['a', 'missing', 'z'])
  assert.equal(value.result.value.head, null)
  assert.equal(value.result.value.hash, entry('state-head-is-provenance').result.value.hash)
  assert.equal(value.updates[1].hex, '00ff0a')
  assert.equal(value.updates[3].hex, '')
  assert.equal(value.updates[3].length, 0)
  assert.equal(Buffer.from(value.updates[2].hex, 'hex').toString('utf8'), '["missing","missing",null,0]\n')
  assert.equal(Buffer.from(entry('state-raw-kind-and-mode').updates[0].hex, 'hex').toString('utf8'), '["a","custom",-123456,0]\n')
  assert.equal(Buffer.from(entry('state-mode-65535').updates[0].hex, 'hex').toString('utf8'), '["a","file",65535,0]\n')
  assert.deepEqual(calls('state-empty'), ['inspectGit', 'sourceHasher', 'digest'])
  assert.equal(entry('state-empty').result.value.hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.deepEqual(calls('state-invalid-slug'), [])
  for (const item of expected.cases.filter((item) => item.op === 'state')) for (const frame of item.updates) {
    const bytes = frame.recipe ? Buffer.alloc(frame.recipe.length, frame.recipe.byte) : Buffer.from(frame.hex, 'hex')
    assert.equal(bytes.length, frame.length, item.id)
    assert.equal(sha256(bytes), frame.sha256, item.id)
  }
})

test('source failures retain original error identity and do not call the next port', () => {
  const endings = {
    'state-fail-inspectGit': ['inspectGit'],
    'state-fail-sourceHasher': ['inspectGit', 'sourceHasher'],
    'state-fail-readInput': ['inspectGit', 'sourceHasher', 'readInput'],
    'state-fail-update-0': ['inspectGit', 'sourceHasher', 'readInput', 'update'],
    'state-fail-update-1': ['inspectGit', 'sourceHasher', 'readInput', 'update', 'update'],
    'state-fail-read-second': ['inspectGit', 'sourceHasher', 'readInput', 'update', 'update', 'readInput'],
  }
  for (const [id, events] of Object.entries(endings)) assert.deepEqual(calls(id), events, id)
  for (const item of expected.cases.filter((item) => item.id.startsWith('state-fail-'))) {
    assert.equal(item.result.error.original_port_error, true, item.id)
    assert.equal(item.events.at(-1).call, item.id === 'state-fail-digest' ? 'digest' : item.id.includes('update') ? 'update' : item.id.includes('read') ? 'readInput' : item.id.slice('state-fail-'.length), item.id)
  }
})

test('64MiB recipes prove aggregate raw-byte cap and read-before-reject order', () => {
  assert.ok(entry('state-limit-exact').result.value)
  assert.ok(entry('state-limit-exact-multifile').result.value)
  assert.equal(entry('state-limit-exact').updates[1].recipe.length, 64 * 1024 * 1024)
  assert.deepEqual(calls('state-limit-plus-one'), ['inspectGit', 'sourceHasher', 'readInput', 'update', 'update', 'readInput'])
  assert.equal(entry('state-limit-plus-one').updates.length, 2)
  assert.deepEqual(calls('state-limit-first-file-over'), ['inspectGit', 'sourceHasher', 'readInput'])
  assert.deepEqual(entry('state-limit-first-file-over').updates, [])
  for (const id of ['state-limit-plus-one', 'state-limit-first-file-over']) assert.equal(entry(id).result.error.message, 'Source input size exceeds 64 MiB')
})

test('check rejects result, bytes, event and independent manifest drift without writes', () => {
  const original = readFileSync(expectedURL)
  for (const mutate of [
    (value) => { value.cases[0].parse.value.criteria[0].statement = 'changed' },
    (value) => { value.cases[0].payloads[0].utf8_hex += '00' },
    (value) => { value.cases.find(({ id }) => id === 'state-empty').events.reverse() },
    (value) => { value.source_manifest.runtime.unicode = 'changed' },
    (value) => { value.source_manifest.import_closure_sha256['modules/requirements/domain.mjs'] = '0'.repeat(64) },
    (value) => { value.payload_manifest.inputs_sha256 = '0'.repeat(64) },
    (value) => { value.payload_manifest.oracle_sha256 = '0'.repeat(64) },
  ]) {
    const changed = structuredClone(expected)
    mutate(changed)
    assert.throws(() => checkRequirementsGoldens(changed), /requirements golden drift/)
  }
  assert.deepEqual(readFileSync(expectedURL), original)
})
