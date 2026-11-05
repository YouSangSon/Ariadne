import { AdapterError } from '../domain.mjs'

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

export function completionMessage(value) {
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
