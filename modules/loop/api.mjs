const RESPONSE_LIMIT = 1024 * 1024
const REQUEST_TIMEOUT_MS = 60_000

export class AdapterError extends Error {
  constructor(kind, message) {
    super(message)
    this.name = 'AdapterError'
    this.kind = kind
  }
}

export const FILE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file', description: 'Read a file inside the approved workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files', description: 'List files inside the approved workspace.',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file', description: 'Write a file only if its SHA matches; use null for a new file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' }, expectedSha: { type: ['string', 'null'] } },
        required: ['path', 'content', 'expectedSha'], additionalProperties: false,
      },
    },
  },
]

export function validateApiExecutor(executor) {
  let url
  try { url = new URL(executor?.endpoint) } catch { throw new AdapterError('rejected', 'Invalid API endpoint') }
  const endpoint = executor.endpoint
  const loopback = typeof endpoint === 'string' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:\/|$)/.test(endpoint)
  if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint) || endpoint !== endpoint.trim() ||
      url.username || url.password || endpoint.split('/')[2].includes('@') || endpoint.includes('?') || endpoint.includes('#') ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && executor.allowLoopbackHttp === true))) {
    throw new AdapterError('rejected', 'API endpoint is not approved for transport')
  }
  if (typeof executor.model !== 'string' || !executor.model.trim()) throw new AdapterError('rejected', 'API model is required')
  if (typeof executor.keyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(executor.keyEnv)) {
    throw new AdapterError('rejected', 'API key environment name is required')
  }
  return executor
}

function completionMessage(value) {
  const invalid = () => new AdapterError('unknown', 'Invalid completion response')
  if (!value || value.role !== 'assistant' || value.function_call != null ||
      (value.content !== undefined && value.content !== null && typeof value.content !== 'string')) throw invalid()
  const message = { role: 'assistant', content: value.content ?? null }
  if (value.tool_calls != null) {
    if (!Array.isArray(value.tool_calls)) throw invalid()
    const ids = new Set()
    message.tool_calls = value.tool_calls.map((call) => {
      if (!call || call.type !== 'function' || typeof call.id !== 'string' || !call.id || ids.has(call.id) ||
          typeof call.function?.arguments !== 'string') throw invalid()
      ids.add(call.id)
      const spec = FILE_TOOLS.find((tool) => tool.function.name === call.function.name)?.function.parameters
      if (!spec) throw invalid()
      let args
      try { args = JSON.parse(call.function.arguments) } catch { throw invalid() }
      if (!args || typeof args !== 'object' || Array.isArray(args) || spec.required.some((key) => !Object.hasOwn(args, key))) throw invalid()
      for (const [key, value] of Object.entries(args)) {
        if (!Object.hasOwn(spec.properties, key)) throw invalid()
        const types = spec.properties[key].type
        const type = value === null ? 'null' : typeof value
        if (!(Array.isArray(types) ? types : [types]).includes(type)) throw invalid()
      }
      return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } }
    })
  }
  if (message.content === null && !message.tool_calls?.length) throw invalid()
  return message
}

async function responseBody(response) {
  if (Number(response.headers.get('content-length')) > RESPONSE_LIMIT) {
    await response.body?.cancel()
    throw new AdapterError('unknown', 'Completion response exceeds byte limit')
  }
  const chunks = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.length
    if (bytes > RESPONSE_LIMIT) throw new AdapterError('unknown', 'Completion response exceeds byte limit')
    chunks.push(chunk)
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
}

export async function requestCompletion(executor, messages, { signal, maxOutputTokens = 1024 } = {}) {
  validateApiExecutor(executor)
  if (!Array.isArray(messages) || !messages.length || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 ||
      (signal !== undefined && !(signal instanceof AbortSignal)) || signal?.aborted) {
    throw new AdapterError('rejected', 'Invalid completion request or cancelled before send')
  }
  const key = process.env[executor.keyEnv]
  if (!key || !key.trim() || /[\r\n]/.test(key)) throw new AdapterError('rejected', 'API key is unavailable')
  let body
  try {
    body = JSON.stringify({ model: executor.model, messages, tools: FILE_TOOLS, stream: false, max_completion_tokens: maxOutputTokens })
  } catch { throw new AdapterError('rejected', 'Invalid completion messages') }
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(executor.endpoint, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      const kind = response.status === 429 ? 'rate_limit' : response.status === 408 ? 'unknown' : response.status >= 500 ? 'unavailable' : 'rejected'
      throw new AdapterError(kind, 'Completion endpoint returned an error')
    }
    const result = await responseBody(response)
    if (!Array.isArray(result?.choices) || !result.choices.length) throw new AdapterError('unknown', 'Invalid completion response')
    const message = completionMessage(result?.choices?.[0]?.message)
    const usage = result.usage
    const knownUsage = Number.isSafeInteger(usage?.prompt_tokens) && usage.prompt_tokens >= 0 &&
      Number.isSafeInteger(usage?.completion_tokens) && usage.completion_tokens >= 0
    return {
      message,
      usage: knownUsage ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } : null,
      requestId: response.headers.get('x-request-id') ?? (typeof result.id === 'string' ? result.id : null),
    }
  } catch (error) {
    if (error instanceof AdapterError) throw error
    // A sent request can consume usage even when its response cannot be observed.
    throw new AdapterError('unknown', 'Completion request outcome is unknown')
  }
}
