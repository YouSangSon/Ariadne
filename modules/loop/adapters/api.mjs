import { AdapterError } from '../domain.mjs'
import { FILE_TOOLS, completionMessage, validateApiExecutor } from './api-wire.mjs'

const RESPONSE_LIMIT = 1024 * 1024
const REQUEST_TIMEOUT_MS = 60_000

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
