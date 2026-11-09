import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommand } from '../lib/command.mjs'
import { runProduct } from '../core/application/product.mjs'
import { lifecycleEnvironment } from '../core/domain/product.mjs'
import { selectModules } from '../lib/module-selection.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const [action, ...extra] = process.argv.slice(2)
if (!['setup', 'build', 'test', 'verify'].includes(action)) {
  console.error('usage: node scripts/product.mjs setup|build|test|verify [--modules core,memory,code,ontology]')
  process.exit(2)
}
let modules
try { modules = selectModules(extra) }
catch (error) { console.error(`product: ${error.message}`); process.exit(2) }
const env = lifecycleEnvironment(action, process.env)
process.exitCode = await runProduct(action, modules, {
  report: (message) => console.log(message),
  run: ({ command, args, cwd }) => runCommand(
    command === 'node' ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm',
    command === 'node' ? [join(root, args[0]), ...args.slice(1)] : args,
    { cwd: join(root, cwd), env },
  ),
})
