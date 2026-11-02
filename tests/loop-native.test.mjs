import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nativeHandoff } from '../modules/loop/native.mjs'

test('native handoff preserves actual task source and AC references for all interactive providers', () => {
  const packet = {
    task: { id: 'task-17', source: '.harness/reqs/approved-change.yaml', goal: 'preserve expected behavior' },
    acceptanceCriteria: [{ id: 'AC1', source: '.harness/reqs/approved-change.yaml#AC1', statement: 'focused check passes' }],
    verification: ['node --test tests/approved-change.test.mjs'],
  }
  for (const kind of ['codex', 'claude', 'gemini']) {
    const handoff = nativeHandoff({ kind }, packet)
    assert.equal(handoff.provider, kind)
    assert.equal(handoff.unattended, false)
    assert.equal(handoff.packet, packet)
    assert.match(handoff.instructions, new RegExp('`' + kind + '`'))
    assert.match(handoff.instructions, /paste/i)
    assert.match(handoff.instructions, /workspace/i)
    assert.doesNotMatch(handoff.instructions, /--dangerously|--yolo|--full-auto|--add-dir|codex exec|claude -p|gemini -p|~\/|\/Users\//)
    assert.match(JSON.stringify(handoff), /approved-change\.yaml#AC1/)
    assert.match(JSON.stringify(handoff), /focused check passes/)
  }
})

test('unregistered native kinds cannot become commands', () => {
  for (const kind of ['sh', 'codex --yolo', '$(pwd)', '', undefined]) {
    assert.throws(() => nativeHandoff({ kind }, { task: 'test' }), /Unsupported native provider/)
  }
})
