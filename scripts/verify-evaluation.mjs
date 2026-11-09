import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { verifyEvaluation } from '../evaluation/application.mjs'
import { evaluationFiles, probe } from '../evaluation/files.mjs'
import { repoRootFromArgs } from './mirror-lib.mjs'

if (process.argv[2] === '--probe') {
  await probe(process.argv[3])
} else {
  try {
    const args = process.argv.slice(2)
    assert.ok(!args.length || (args.length === 2 && args[0] === '--root' && args[1] && !args[1].startsWith('--')), 'usage: verify-evaluation.mjs [--root <dir>]')
    console.log(JSON.stringify(verifyEvaluation(evaluationFiles(repoRootFromArgs(process.argv), fileURLToPath(import.meta.url))), null, 2))
  } catch (error) {
    console.error(`verify-evaluation: ${error.message}`)
    process.exitCode = 1
  }
}
