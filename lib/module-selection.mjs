export const ALL_MODULES = Object.freeze(['core', 'memory', 'code', 'ontology'])

export function selectModules(args, defaults = ALL_MODULES) {
  if (!args.length) return new Set(defaults)
  let value
  if (args.length === 2 && args[0] === '--modules') value = args[1]
  else if (args.length === 1 && args[0].startsWith('--modules=')) value = args[0].slice('--modules='.length)
  else throw new Error('expected --modules core,memory,code,ontology')

  const names = value.split(',')
  if (names.some((name) => !ALL_MODULES.includes(name))) throw new Error('modules must be a nonempty list of core,memory,code,ontology')
  if (new Set(names).size !== names.length) throw new Error('duplicate modules are not allowed')
  return new Set(['core', ...names])
}
