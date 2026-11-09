import { REQ_LINE } from './commit.mjs'

export function sourceTests(names, modules) {
  const tests = names.filter((name) => name.endsWith('.test.mjs') && name !== 'product-mcp.test.mjs' && (name !== 'product-code.test.mjs' || modules.has('code'))).sort()
  if (!tests.length) throw new Error('core tests가 없다')
  if (modules.has('code') && !tests.includes('product-code.test.mjs')) throw new Error('code integration test is missing')
  return tests
}

export function commitErrors(log) {
  const bad = log.split('\0').map((message) => message.trim()).filter(Boolean).filter((message) => !REQ_LINE.test(message))
  return bad.length === 0 ? null : `REQ 참조 없는 커밋 ${bad.length}개: ${bad.map((message) => message.slice(0, 7)).join(', ')}`
}
