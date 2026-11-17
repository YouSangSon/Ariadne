import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
test('actual pinned Node files and CLI reproduce separate portable G1b goldens', () => {
 const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/ontology-files-cli-goldens.mjs', import.meta.url))], { encoding: 'utf8' })
 assert.equal(result.status, 0, result.stderr)
})
