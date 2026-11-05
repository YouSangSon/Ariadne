import { lifecycleSteps } from '../domain/product.mjs'

export async function runProduct(action, modules, { run, report }) {
  const scope = [...modules].join(',')
  report(`product: ${action} modules=${scope}`)
  for (const step of lifecycleSteps(action, modules)) {
    const status = await run(step)
    if (status !== 0) return status
  }
  report(`product: ${action} complete modules=${scope}`)
  return 0
}
