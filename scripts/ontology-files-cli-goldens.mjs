import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readProjectText } from '../core/infrastructure/project-files.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.version !== 'v24.22.2') throw new Error('Use project Node 24.22.2')
const fixture = join(root, 'contracts/ontology/files-cli-v1')
const input = JSON.parse(readFileSync(join(fixture, 'cases.json')))
const directory = mkdtempSync(join(tmpdir(), 'ariadne-files-cli-'))
try {
  for (const [name, body] of Object.entries(input.files)) writeFileSync(join(directory, name), body)
  for (const [name, body] of Object.entries(input.bytes)) writeFileSync(join(directory, name), Buffer.from(body, 'base64'))
  const reader = input.reader_paths.map(path => {
    try { const value = readProjectText(directory, path); return { path, sha256: value.sha256, bytes: Buffer.from(value.content).toString('hex') } }
    catch (error) { return { path, error: error.message } }
  })
  const cases = input.cases.map(({ name, args }) => {
    const result = spawnSync(process.execPath, [join(root, 'modules/ontology/cli.mjs'), ...args], { cwd: directory, encoding: 'utf8' })
    if (result.error) throw result.error
    return { name, status: result.status, stdout: result.stdout, stderr: result.stderr }
  })
  const owners = ['core/domain/project-files.mjs', 'core/infrastructure/project-files.mjs', 'modules/ontology/files.mjs', 'modules/ontology/cli.mjs', 'lib/scrub.mjs']
  const result = JSON.stringify({ node: process.version, icu: process.versions.icu, unicode: process.versions.unicode, inputs_sha256: createHash('sha256').update(readFileSync(join(fixture, 'cases.json'))).digest('hex'), oracle_sha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'), owners: Object.fromEntries(owners.map(file => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')])), reader, cases }, null, 2) + '\n'
  const target = join(fixture, 'expected.json')
  if (process.argv.includes('--write')) writeFileSync(target, result)
  else if (readFileSync(target, 'utf8') !== result) throw new Error('Files/CLI Node golden drift')
  console.log(`${cases.length} actual Node files/CLI cases verified`)
} finally { rmSync(directory, { recursive: true, force: true }) }
