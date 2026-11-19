import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { requirementFiles } from '../modules/requirements/files.mjs'
import { loadContract } from '../modules/loop/contract.mjs'

test('REQ decoding consumes a single BOM and normalizes only CRLF', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ariadne-req-reader-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, '.harness', 'reqs')
  const ports = requirementFiles(root)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'demo.yaml')
  writeFileSync(path, '\uFEFF\uFEFFa\r\nb\r\0')
  assert.equal(ports.readRequirement('demo'), '\uFEFFa\nb\r\0')
  assert.throws(() => loadContract(root, 'demo'), /REQ unsupported control character/)
  writeFileSync(path, Buffer.from([0xff]))
  assert.throws(() => ports.readRequirement('demo'), { message: 'REQ must be UTF-8 text' })
})

test('the application rejects an invalid slug before resolving the root', () => {
  assert.throws(() => loadContract('/unavailable-root', '../demo'), /REQ slug/)
})
