import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { AdapterError, FILE_TOOLS, requestCompletion, validateApiExecutor } from '../modules/loop/api.mjs'

const reply = (message = { role: 'assistant', content: 'done' }, usage = { prompt_tokens: 12, completion_tokens: 3 }) => ({
  id: 'completion-local', choices: [{ message }], ...(usage === undefined ? {} : { usage }),
})
const toolCall = (name, args, id = 'call-1') => ({
  id, type: 'function', function: { name, arguments: JSON.stringify(args) },
})

async function fixture(t, handle) {
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests.push({ url: req.url, method: req.method, headers: req.headers, body })
    handle(req, res, body)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections()
  }))
  const keyEnv = `ARIADNE_TEST_${randomUUID().replaceAll('-', '_')}`
  process.env[keyEnv] = 'local-test-token-first'
  t.after(() => { delete process.env[keyEnv] })
  return {
    executor: { endpoint: `http://127.0.0.1:${server.address().port}/custom/v1/chat/completions`, model: 'fixture-model', keyEnv, allowLoopbackHttp: true },
    requests,
  }
}

function classified(kind) {
  return (error) => {
    assert.ok(error instanceof AdapterError)
    assert.equal(error.kind, kind)
    assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /local-test-token|private-response|private-model-text/)
    return true
  }
}

test('file tool definitions expose only the three bounded file operations', () => {
  assert.deepEqual(FILE_TOOLS.map((tool) => tool.function.name), ['read_file', 'list_files', 'write_file'])
  for (const tool of FILE_TOOLS) {
    assert.equal(tool.type, 'function')
    assert.equal(tool.function.parameters.additionalProperties, false)
  }
  const write = FILE_TOOLS[2].function.parameters
  assert.deepEqual(write.required, ['path', 'content', 'expectedSha'])
  assert.deepEqual(write.properties.expectedSha.type, ['string', 'null'])
})

test('registration validates the full endpoint without resolving a key or changing it', () => {
  const executor = { endpoint: 'https://api.example.test/custom/v1/chat/completions', model: 'approved-model', keyEnv: 'ARIADNE_UNSET_TEST_KEY' }
  assert.equal(validateApiExecutor(executor), executor)
  for (const endpoint of [
    'http://example.test/v1/chat/completions', 'http://127.0.0.1/v1/chat/completions',
    'https://user:password@example.test/v1/chat/completions', 'https://example.test/v1/chat/completions?x=1',
    'https://example.test/v1/chat/completions#part', 'https://example.test/v1/chat/completions?',
    'https://example.test/v1/chat/completions#', '/v1/chat/completions',
  ]) assert.throws(() => validateApiExecutor({ ...executor, endpoint }), classified('rejected'))
  for (const endpoint of ['http://localhost/v1/chat/completions', 'http://127.0.0.1/v1/chat/completions', 'http://[::1]/v1/chat/completions']) {
    assert.doesNotThrow(() => validateApiExecutor({ ...executor, endpoint, allowLoopbackHttp: true }))
  }
  for (const endpoint of ['http://127.0.0.2/v1/chat/completions', 'http://localhost.example.test/v1/chat/completions', 'http://2130706433/v1/chat/completions']) {
    assert.throws(() => validateApiExecutor({ ...executor, endpoint, allowLoopbackHttp: true }), classified('rejected'))
  }
  assert.throws(() => validateApiExecutor({ ...executor, model: '' }), classified('rejected'))
  assert.throws(() => validateApiExecutor({ ...executor, keyEnv: 'not an env name' }), classified('rejected'))
})

test('real local HTTP request and tool-result replay preserve the approved endpoint, model and messages', async (t) => {
  const calls = [toolCall('read_file', { path: 'README.md' }, 'read-1'), toolCall('list_files', {}, 'list-1'), toolCall('write_file', { path: 'new.txt', content: 'hello', expectedSha: null }, 'write-1')]
  const message = { role: 'assistant', content: null, tool_calls: calls }
  const f = await fixture(t, (req, res, body) => {
    res.setHeader('content-type', 'application/json')
    res.setHeader('x-request-id', 'request-local')
    res.end(JSON.stringify(reply(body.messages.some((item) => item.role === 'tool') ? undefined : message)))
  })
  const messages = [{ role: 'system', content: 'approved scope' }, { role: 'user', content: 'inspect and edit' }]
  const first = await requestCompletion(f.executor, messages, { maxOutputTokens: 64 })
  assert.deepEqual(first, { message, usage: { inputTokens: 12, outputTokens: 3 }, requestId: 'request-local' })
  assert.equal(f.requests[0].url, '/custom/v1/chat/completions')
  assert.equal(f.requests[0].method, 'POST')
  assert.equal(f.requests[0].headers.authorization, 'Bearer local-test-token-first')
  assert.deepEqual(f.requests[0].body, { model: 'fixture-model', messages, tools: FILE_TOOLS, stream: false, max_completion_tokens: 64 })
  process.env[f.executor.keyEnv] = 'local-test-token-next'
  const replay = [...messages, first.message, ...calls.map((call) => ({ role: 'tool', tool_call_id: call.id, content: '{"ok":true}' }))]
  const second = await requestCompletion(f.executor, replay)
  assert.equal(second.message.content, 'done')
  assert.equal(f.requests[1].headers.authorization, 'Bearer local-test-token-next')
  assert.deepEqual(f.requests[1].body.messages, replay)
  assert.equal(f.requests[1].body.max_completion_tokens, 1024)
})

test('missing or malformed usage stays unknown rather than becoming zero', async (t) => {
  const usages = [undefined, null, { prompt_tokens: 1 }, { prompt_tokens: -1, completion_tokens: 2 }, { prompt_tokens: 1, completion_tokens: 0.5 }]
  const f = await fixture(t, (req, res) => {
    const usage = usages.shift()
    res.end(JSON.stringify({ id: 'completion-local', choices: [{ message: { role: 'assistant', content: 'done' } }], ...(usage === undefined ? {} : { usage }) }))
  })
  while (usages.length) {
    const result = await requestCompletion(f.executor, [{ role: 'user', content: 'test' }])
    assert.equal(result.usage, null)
    assert.equal(result.requestId, 'completion-local')
  }
})

test('standard nullable or empty optional tool fields remain replayable text responses', async (t) => {
  const optionalFields = [null, []]
  const f = await fixture(t, (req, res) => {
    res.end(JSON.stringify(reply({ role: 'assistant', content: 'done', function_call: null, tool_calls: optionalFields.shift() })))
  })
  while (optionalFields.length) {
    const result = await requestCompletion(f.executor, [{ role: 'user', content: 'test' }])
    assert.equal(result.message.content, 'done')
    assert.equal(result.message.role, 'assistant')
  }
})

test('malformed responses and disallowed tool calls are ambiguous and never returned for execution', async (t) => {
  const invalid = [
    '{private-response', {}, { choices: [] }, { choices: { 0: { message: { role: 'assistant', content: 'done' } } } },
    reply({ role: 'user', content: 'private-model-text' }),
    reply({ role: 'assistant', content: 3 }), reply({ role: 'assistant', content: null }),
    reply({ role: 'assistant', content: null, tool_calls: [toolCall('shell', { command: 'pwd' })] }),
    reply({ role: 'assistant', content: null, tool_calls: [{ ...toolCall('list_files', {}), type: 'custom' }] }),
    reply({ role: 'assistant', content: null, tool_calls: [{ ...toolCall('read_file', {}), function: { name: 'read_file', arguments: '{private-response' } }] }),
    reply({ role: 'assistant', content: null, tool_calls: [toolCall('read_file', [])] }),
    reply({ role: 'assistant', content: null, tool_calls: [toolCall('read_file', { path: 5 })] }),
    reply({ role: 'assistant', content: null, tool_calls: [toolCall('list_files', { shell: 'pwd' })] }),
    reply({ role: 'assistant', content: null, tool_calls: [toolCall('write_file', { path: 'a', content: 'x' })] }),
    reply({ role: 'assistant', content: null, tool_calls: [toolCall('write_file', { path: 'a', content: 'x', expectedSha: false })] }),
    reply({ role: 'assistant', content: null, tool_calls: [toolCall('list_files', {}, '')] }),
    reply({ role: 'assistant', content: null, tool_calls: [toolCall('list_files', {}), toolCall('list_files', {})] }),
  ]
  const f = await fixture(t, (req, res) => {
    const body = invalid.shift()
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
  while (invalid.length) await assert.rejects(requestCompletion(f.executor, [{ role: 'user', content: 'test' }]), classified('unknown'))
})

test('redirect is not followed and cannot forward credentials to another endpoint', async (t) => {
  let redirectedHits = 0
  const destination = await fixture(t, (req, res) => { redirectedHits++; res.end(JSON.stringify(reply())) })
  const source = await fixture(t, (req, res) => {
    res.writeHead(307, { location: destination.executor.endpoint })
    res.end('private-response')
  })
  await assert.rejects(requestCompletion(source.executor, [{ role: 'user', content: 'test' }]), classified('unknown'))
  assert.equal(redirectedHits, 0)
  assert.equal(source.requests.length, 1)
})

test('HTTP failures are classified without returning provider text or retrying', async (t) => {
  const statuses = [[400, 'rejected'], [401, 'rejected'], [403, 'rejected'], [408, 'unknown'], [429, 'rate_limit'], [500, 'unavailable'], [503, 'unavailable']]
  let status
  const f = await fixture(t, (req, res) => {
    res.writeHead(status)
    res.end('private-response local-test-token-first')
  })
  for (const [code, kind] of statuses) {
    status = code
    await assert.rejects(requestCompletion(f.executor, [{ role: 'user', content: 'test' }]), classified(kind))
  }
  assert.equal(f.requests.length, statuses.length)
})

test('response byte cap applies to declared and chunked bodies', async (t) => {
  let declared = true
  const f = await fixture(t, (req, res) => {
    if (declared) res.setHeader('content-length', 1024 * 1024 + 1)
    res.write('x'.repeat(700 * 1024))
    res.end('x'.repeat(400 * 1024))
  })
  await assert.rejects(requestCompletion(f.executor, [{ role: 'user', content: 'test' }]), classified('unknown'))
  declared = false
  await assert.rejects(requestCompletion(f.executor, [{ role: 'user', content: 'test' }]), classified('unknown'))
})

test('abort after request admission and socket loss keep an ambiguous outcome', async (t) => {
  const controller = new AbortController()
  let abort = true
  const f = await fixture(t, (req, res) => {
    if (abort) controller.abort(new Error('private-response'))
    else req.socket.destroy()
  })
  await assert.rejects(requestCompletion(f.executor, [{ role: 'user', content: 'test' }], { signal: controller.signal }), classified('unknown'))
  abort = false
  await assert.rejects(requestCompletion(f.executor, [{ role: 'user', content: 'test' }]), classified('unknown'))
  assert.equal(f.requests.length, 2)
})

test('missing key, invalid token limit and pre-aborted signal are rejected before sending', async (t) => {
  const f = await fixture(t, (req, res) => res.end(JSON.stringify(reply())))
  delete process.env[f.executor.keyEnv]
  await assert.rejects(requestCompletion(f.executor, [{ role: 'user', content: 'test' }]), classified('rejected'))
  process.env[f.executor.keyEnv] = 'local-test-token-first'
  for (const maxOutputTokens of [0, -1, 1.5, '1', null]) {
    await assert.rejects(requestCompletion(f.executor, [{ role: 'user', content: 'test' }], { maxOutputTokens }), classified('rejected'))
  }
  await assert.rejects(requestCompletion(f.executor, [{ role: 'user', content: 'test' }], { signal: AbortSignal.abort(new Error('private-response')) }), classified('rejected'))
  assert.equal(f.requests.length, 0)
})
