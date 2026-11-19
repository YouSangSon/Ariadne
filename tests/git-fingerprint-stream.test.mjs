import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { sourceState } from '../modules/requirements/application.mjs'
import { visitRegularFile } from '../modules/requirements/file-stream.mjs'

test('stable inputs with an unreliable stat size use actual length and bounded chunks', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ariadne-stream-test-'))
  const previous = process.env.TMPDIR
  process.env.TMPDIR = root
  t.after(() => {
    if (previous === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previous
    rmSync(root, { recursive: true, force: true })
  })
  const data = Buffer.from(Array.from({ length: 259 }, (_, i) => i % 251))
  const expected = createHash('sha256').update(data).digest('hex')
  const input = join(root, 'input')
  writeFileSync(input, data)
  const run = (reported, budget, visit) => {
    const fd = openSync(input, 'r')
    try { visitRegularFile(fd, reported, budget, Buffer.alloc(16), visit) }
    finally { closeSync(fd) }
  }
  for (const reported of [0, 100, 4096, data.length]) {
    run(reported, data.length, (length, write) => {
      assert.equal(length, data.length)
      const hash = createHash('sha256')
      write((chunk) => { assert.ok(chunk.length <= 16); hash.update(chunk) })
      assert.equal(hash.digest('hex'), expected)
    })
    assert.deepEqual(readdirSync(root), ['input'])
  }
  const failure = new Error('sink failed')
  assert.throws(() => run(0, data.length, (_, write) => write(() => { throw failure })), (error) => error === failure)
  assert.throws(() => run(0, data.length - 1, () => assert.fail('over-budget content delivered')), /64 MiB/)
  assert.deepEqual(readdirSync(root), ['input'])
})

test('an incomplete streamed input never returns a source fingerprint', () => {
  for (const delivered of [[], [Buffer.alloc(2)], [Buffer.alloc(4)]]) {
    let finalized = false
    const store = {
      inspectGit: () => ({ paths: ['tracked'], head: null }),
      sourceHasher: () => ({ update() {}, digest() { finalized = true; return 'partial' } }),
      visitInput(path, remaining, visit) {
        visit('file', 0o600, 3, (consume) => { for (const chunk of delivered) consume(chunk) })
      },
    }
    assert.throws(() => sourceState(store), /Source input/)
    assert.equal(finalized, false)
  }
})
