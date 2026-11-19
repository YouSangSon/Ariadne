import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runCommand } from '../lib/command.mjs'
import { scrub } from '../lib/scrub.mjs'

const [output, ...extra] = process.argv.slice(2)
if (!output || extra.length) {
  console.error('usage: node scripts/build-go-checkout.mjs OUTPUT')
  process.exit(2)
}
if (!['darwin', 'linux'].includes(process.platform)) {
  console.error('Ariadne: the Go checkout launcher build requires macOS or Linux')
  process.exit(2)
}

try {
  const root = realpathSync(new URL('..', import.meta.url))
  const node = realpathSync(process.execPath)
  // Hex keeps checkout and Node paths out of the linker's argument parsing.
  const hex = (path) => Buffer.from(path).toString('hex')
  const bindings = `-X main.checkoutRootHex=${hex(root)} -X main.checkoutNodeHex=${hex(node)}`
  process.exitCode = await runCommand('go', [
    'build', '-mod=readonly', '-o', resolve(output), '-ldflags', bindings, './cmd/Ariadne',
  ], { cwd: join(root, 'runtime/go'), env: { ...process.env, GOOS: process.platform } })
} catch (error) {
  console.error(`Ariadne: ${scrub(error.message).text}`)
  process.exitCode = 2
}
