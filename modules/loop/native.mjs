import { AdapterError } from './api.mjs'

const COMMANDS = new Set(['codex', 'claude', 'gemini'])

export function nativeHandoff(executor, packet) {
  const provider = executor?.kind
  if (!COMMANDS.has(provider)) throw new AdapterError('rejected', 'Unsupported native provider')
  return {
    provider,
    instructions: `Open a terminal in the approved workspace and run \`${provider}\` interactively. Paste the handoff packet into the conversation and confirm the task scope and permission prompts. Unattended execution has not been qualified.`,
    packet,
    unattended: false,
  }
}
