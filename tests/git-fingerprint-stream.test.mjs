import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
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

test('a streaming adapter cannot turn a rejected input into a successful fingerprint', () => {
  const failure = new Error('hash rejected bytes')
  for (const fault of ['short', 'duplicate', 'update']) {
    let finalized = false
    const store = {
      inspectGit: () => ({ head: null, paths: ['f'] }),
      sourceHasher: () => ({
        update(chunk) { if (fault === 'update' && Buffer.isBuffer(chunk)) throw failure },
        digest() { finalized = true; return 'partial' },
      }),
      visitInput(path, remaining, visit) {
        try {
          visit('file', 0o600, 1, (consume) => {
            if (fault !== 'short') {
              try { consume(Buffer.from('x')) } catch { /* provider reports success */ }
            }
          })
          if (fault === 'duplicate') visit('file', 0o600, 0, () => {})
        } catch { /* provider reports success */ }
      },
    }
    assert.throws(() => sourceState(store), (e) => fault === 'update' ? e === failure : e instanceof Error)
    assert.equal(finalized, false)
  }
})

test('a file truncated after its header never yields a complete fingerprint', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ariadne-stream-truncate-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const input = join(root, 'input')
  const size = 128 * 1024
  writeFileSync(input, Buffer.alloc(size))
  const fd = openSync(input, 'r')
  try {
    assert.throws(() => visitRegularFile(fd, size, size, Buffer.alloc(64 * 1024), (length, write) => {
      assert.equal(length, size)
      truncateSync(input, 0)
      write(() => {})
    }), /changed during read/)
  } finally { closeSync(fd) }
})
