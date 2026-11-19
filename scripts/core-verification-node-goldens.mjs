import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkCommitCommand, REQ_LINE } from '../core/domain/commit.mjs'
import { sourceTests, commitErrors } from '../core/domain/verification.mjs'
import { verifySources } from '../core/application/verification.mjs'

const root = new URL('../', import.meta.url)
const dir = new URL('contracts/core/verification-node-v1/', root)
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const sources = ['core/domain/commit.mjs', 'core/domain/verification.mjs', 'core/application/verification.mjs', 'hooks/commit-message.mjs', 'scripts/verify.mjs', 'scripts/product.mjs', 'core/application/product.mjs']
export const encode = text => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16).padStart(4, '0')).join('')
const decode = hex => hex.match(/.{4}/g)?.map(unit => String.fromCharCode(parseInt(unit, 16))).join('') ?? ''
const token = value => value == null ? null : encode(value)

export function verificationGoldens() {
  assert.equal(process.version, 'v24.22.2', 'verification oracle requires pinned Node')
  assert.equal(process.versions.icu, '78.3')
  assert.equal(process.versions.unicode, '17.0')
  const inputs = readFileSync(new URL('cases.json', dir))
  const cases = JSON.parse(inputs).cases.map(input => {
    const before = structuredClone(input)
    const entry = { id: input.id }
    const original = new Error('original port failure')
    try {
      switch (input.op) {
        case 'command': {
          const decision = checkCommitCommand(decode(input.text))
          entry.value = { ...decision, ...(decision.reason === undefined ? {} : { reason: encode(decision.reason) }) }
          break
        }
        case 'req': entry.value = REQ_LINE.test(decode(input.text)); break
        case 'log': entry.value = token(commitErrors(decode(input.text))); break
        case 'sources': entry.value = sourceTests(input.names.map(decode), new Set(input.code ? ['code'] : [])).map(encode); break
        case 'run': {
          entry.events = []
          const modules = new Set(input.code ? ['code'] : [])
          let starts = 0, finishes = 0
          const fail = (name, index = 0) => { if (input.throwAt === name && (input.throwIndex ?? 0) === index) throw original }
          entry.value = verifySources(modules, {
            listTests() {
              entry.events.push({ type: 'listTests' })
              if ('listError' in input) throw new Error(decode(input.listError))
              if (input.listCode === true) modules.add('code')
              if (input.listCode === false) modules.delete('code')
              return input.names.map(decode)
            },
            runTests(names) { entry.events.push({ type: 'runTests', names: names.map(encode) }); fail('runTests'); return input.tokens?.[0] == null ? null : decode(input.tokens[0]) },
            checkMirrors() { entry.events.push({ type: 'checkMirrors' }); fail('checkMirrors'); return input.tokens?.[1] == null ? null : decode(input.tokens[1]) },
            commitLog() { entry.events.push({ type: 'commitLog' }); fail('commitLog'); return input.log === null ? null : decode(input.log) },
            start(name) { entry.events.push({ type: 'start', name: encode(name) }); fail('start', starts++) },
            finish(name, error) { entry.events.push({ type: 'finish', name: encode(name), token: token(error) }); fail('finish', finishes++) },
            report(message) { entry.events.push({ type: 'report', message: encode(message) }); fail('report') },
          })
          break
        }
        default: throw new Error(`unknown operation ${input.op}`)
      }
    } catch (error) {
      entry.error = encode(error.message)
      if (input.op === 'run') entry.sameError = error === original
    }
    assert.deepEqual(input, before, `oracle mutated ${input.id}`)
    return entry
  })
  return {
    provenance: {
      runtime: { node: process.version, icu: process.versions.icu, unicode: process.versions.unicode, v8: process.versions.v8 },
      profile: 'text heuristic and syntax predicate; lossless UTF-16 hex; injected synchronous ports; no shell execution or REQ authorization',
      source_sha256: Object.fromEntries(sources.map(path => [path, sha256(readFileSync(new URL(path, root)))])),
      inputs_sha256: sha256(inputs),
      oracle_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    },
    cases,
  }
}
export function checkVerificationGoldens(expected) { assert.deepEqual(verificationGoldens(), expected, 'verification golden drift') }
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const expectedURL = new URL('expected.json', dir)
  if (process.argv[2] === '--write') writeFileSync(expectedURL, JSON.stringify(verificationGoldens(), null, 2) + '\n')
  else checkVerificationGoldens(JSON.parse(readFileSync(expectedURL, 'utf8')))
}
