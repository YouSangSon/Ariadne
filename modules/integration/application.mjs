import { INSTALL_AREAS, INSTALL_RUNTIME_FILES, MIRROR_DIRS, VERSION, capSource, countPlans, mirrorErrors, planAdapt, planGlobalPointer, planInstallFile, renderMirrorSource } from './domain.mjs'

export function renderMirror(store, name) {
  const relative = `skills/${name}/SKILL.md`
  const source = store.readSource(relative)
  return renderMirrorSource(source, relative, store.hash(source).slice(0, 12))
}

export function generateMirrors(store) {
  let written = 0
  let skipped = 0
  for (const name of store.listSkills()) {
    const content = renderMirror(store, name)
    for (const directory of MIRROR_DIRS) {
      const path = `${directory}/skills/${name}/SKILL.md`
      if (store.read(path) === content) { skipped++; continue }
      store.write(path, content)
      written++
    }
  }
  return { written, skipped }
}

export function checkMirrors(store) {
  const mirrors = []
  for (const name of store.listSkills()) {
    let expected
    try { expected = renderMirror(store, name) }
    catch (error) { mirrors.push({ error: error.message }); continue }
    for (const directory of MIRROR_DIRS) {
      const path = `${directory}/skills/${name}/SKILL.md`
      mirrors.push({ path, expected, actual: store.read(path) })
    }
  }
  return mirrorErrors(store.readSourceIf('core/AGENTS.core.md'), mirrors)
}

export function applyAdapt(store, verifyCommand) {
  const manifest = store.readManifest('.harness/adapt-manifest.json') ?? { version: VERSION, created: [], modified: [] }
  const lineCounts = store.listFiles().filter(capSource).map((path) => store.read(path).split('\n').length)
  const result = planAdapt({ agents: store.read('AGENTS.md'), claude: store.read('CLAUDE.md'), manifest, lineCounts, verifyCommand })
  for (const plan of result.plans) {
    if (plan.backup) store.copy(plan.path, `.harness/backup/${plan.path}.bak`)
    if (plan.state !== 'skipped') store.write(plan.path, plan.content)
  }
  store.write('.harness/adapt-manifest.json', JSON.stringify(result.manifest, null, 2) + '\n')
  return result
}

export function removeAdapt(store) {
  const manifest = store.readManifest('.harness/adapt-manifest.json')
  if (!manifest) return null
  for (const path of manifest.created) store.remove(path)
  for (const path of manifest.modified) {
    const backup = `.harness/backup/${path}.bak`
    if (store.exists(backup)) store.copy(backup, path)
  }
  store.remove('.harness/backup', { recursive: true })
  store.remove('.harness/adapt-manifest.json')
  store.prune('.harness')
  return { restored: manifest.modified.length, removed: manifest.created.length }
}

export function installRules(store, globalPointer) {
  const files = [...new Set([...INSTALL_AREAS.flatMap((area) => store.listSourceFiles(area)), ...(store.sourceExists('lib/context-pack.mjs') ? INSTALL_RUNTIME_FILES : [])])].sort()
  const plans = files.map((path) => planInstallFile(store.installFile(path)))
  for (const plan of plans) if (plan.state !== 'skipped') store.write(plan.path, plan.content)
  store.ensureRoot()
  const pointers = []
  if (globalPointer) {
    const previous = new Map((store.readManifest('manifest.json')?.globalPointer ?? []).map((entry) => [entry.path, entry]))
    const core = store.installedCore()
    for (const target of store.pointerTargets()) {
      const plan = planGlobalPointer(target, previous.get(target.path), core)
      if (plan.backupPath) store.backupPointer(plan.path, plan.backupPath)
      if (plan.state !== 'skipped') store.writePointer(plan.path, plan.content)
      pointers.push(plan.record)
      plans.push(plan)
    }
  }
  store.write('manifest.json', JSON.stringify({ version: VERSION, files, globalPointer: pointers }, null, 2) + '\n')
  return countPlans(plans)
}

export function uninstallRules(store) {
  const manifest = store.readManifest('manifest.json')
  if (!manifest) return null
  let removed = 0
  for (const entry of manifest.globalPointer ?? []) {
    if (entry.backup) store.restorePointer(entry.path, entry.backup)
    else store.removePointer(entry.path)
    removed++
  }
  store.prune('backup')
  for (const path of manifest.files) {
    if (store.exists(path)) { store.remove(path); removed++ }
    store.pruneParents(path)
  }
  store.remove('manifest.json')
  return { removed }
}
