import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { contextFiles } from '../modules/context/files.mjs'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { buildPack, skillCatalog } from '../modules/context/application.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const corpusPath = 'contracts/context/files-cli-v1/cases.json'
const expectedPath = 'contracts/context/files-cli-v1/expected.json'
const sources = ['modules/context/files.mjs', 'modules/context/application.mjs', 'modules/context/domain.mjs', 'modules/context/skills.mjs', 'core/domain/project-files.mjs', 'core/infrastructure/project-files.mjs', 'core/domain/requirement-fields.mjs', 'lib/scrub.mjs', 'lib/budget.mjs', 'lib/context-pack.mjs', 'lib/skill-catalog.mjs']
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const read = (path) => readFileSync(join(root, path))
const units = (s) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).padStart(4, '0')).join('')
function record(value) {
  return { name: value.name, path: value.path, sha256: value.sha256, chars: value.chars, description: units(value.description), content: units(value.content) }
}
function materialize(directory, files) {
  for (const file of files) {
    const path = file.raw_path_hex ? Buffer.concat([Buffer.from(directory + '/'), Buffer.from(file.raw_path_hex, 'hex')]) : join(directory, file.path)
    mkdirSync(Buffer.isBuffer(path) ? path.subarray(0, path.lastIndexOf(47)) : dirname(path), { recursive: true })
    if (file.kind === 'dir') mkdirSync(path)
    else if (file.kind === 'symlink') symlinkSync(file.target, path)
    else writeFileSync(path, file.size ? Buffer.concat([Buffer.from(file.prefix), Buffer.alloc(file.size - Buffer.byteLength(file.prefix), Buffer.from(file.fill_hex, 'hex'))]) : Buffer.from(file.hex, 'hex'))
  }
}
export function generate() {
  const runtime = { node: process.version, icu: process.versions.icu, unicode: process.versions.unicode }
  assert.deepEqual(runtime, { node: 'v24.22.2', icu: '78.3', unicode: '17.0' })
  const input = JSON.parse(read(corpusPath))
  const directory = mkdtempSync(join(tmpdir(), 'ariadne-context-oracle-'))
  try {
    const cases = input.cases.map((entry, i) => {
      const local = join(directory, `store-${i}`)
      mkdirSync(local)
      materialize(local, entry.files)
      const store = contextFiles(entry.missing_root ? join(local, 'absent') : local)
      const result = { id: entry.id }
      const originalExists = fs.existsSync
      if (entry.probe_race) {
        fs.existsSync = (path) => { const found = originalExists(path); if (found) fs.unlinkSync(path); return found }
        syncBuiltinESMExports()
      }
      try {
        let value
        if (entry.method === 'pack') value = units(buildPack({ store }))
        else if (entry.method === 'catalog') {
          const c = skillCatalog(store)
          value = { schema_version: c.schema_version, trust: c.trust, skills: c.skills.map((s) => ({ ...s, description: units(s.description) })) }
        } else {
          value = store[entry.method](entry.arg)
          if (entry.method === 'readSkill') value = record(value)
          else if (typeof value === 'string') value = units(value)
        }
        result.value = value
      } catch (error) { if (entry.probe_race) result.error_code = error.code; else result.error = error.message }
      finally { if (entry.probe_race) { fs.existsSync = originalExists; syncBuiltinESMExports() } }
      return result
    })
    const cli = input.cli.map((entry, i) => {
      const cwd = join(directory, `cli-${i}`)
      mkdirSync(cwd)
      materialize(cwd, entry.files)
      const script = entry.command === 'context' ? 'lib/context-pack.mjs' : 'lib/skill-catalog.mjs'
      const result = spawnSync(process.execPath, [join(root, script), ...entry.args], { cwd, encoding: 'utf8' })
      assert.ifError(result.error)
      return { id: entry.id, status: result.status, stdout: result.stdout, stderr: result.stderr }
    })
    return { fixture_version: 1, provenance: { runtime, source_sha256: Object.fromEntries(sources.map((p) => [p, sha(read(p))])), inputs_sha256: sha(read(corpusPath)), oracle_sha256: sha(read('scripts/context-files-node-goldens.mjs')) }, cases, cli }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length <= 3 && ['--write', '--check', undefined].includes(process.argv[2]))
  const result = generate()
  if (process.argv[2] === '--write') writeFileSync(join(root, expectedPath), JSON.stringify(result, null, 2) + '\n')
  else assert.deepEqual(JSON.parse(read(expectedPath)), result, 'actual Node file/CLI oracle drift')
}
