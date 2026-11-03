#!/usr/bin/env node
// Existing hook contracts accept one executable; keep argv out of shell strings.
process.argv.splice(2, 0, 'code')
await import('./Ariadne.mjs')
