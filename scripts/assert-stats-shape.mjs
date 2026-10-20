#!/usr/bin/env node
// T-001 — assert the `cornercase stats --json` contract src/stats.js depends on.
//
// Usage:
//   node scripts/assert-stats-shape.mjs             validate the LIVE `cornercase stats --json`
//   node scripts/assert-stats-shape.mjs <file.json> validate a saved JSON file (failure-mode probe)
//
// Exits 0 iff `since` is a string and every window in {total,24h,7d} has
// tokens.{in,out,cache_read,cache_write} present and numeric; non-zero (with a diagnostic) otherwise.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const REQUIRED_WINDOWS = ['total', '24h', '7d']
const TOKEN_FIELDS = ['in', 'out', 'cache_read', 'cache_write']

function loadStats(fileArg) {
  if (fileArg) return JSON.parse(readFileSync(fileArg, 'utf8'))
  const out = execFileSync('cornercase', ['stats', '--json'], { encoding: 'utf8' })
  return JSON.parse(out)
}

export function validateStatsShape(stats) {
  const errors = []
  if (typeof stats?.since !== 'string') errors.push('since: expected string')
  const windows = stats?.windows ?? {}
  for (const w of REQUIRED_WINDOWS) {
    const win = windows[w]
    if (!win || typeof win !== 'object') {
      errors.push(`windows.${w}: missing`)
      continue
    }
    const tokens = win.tokens ?? {}
    for (const f of TOKEN_FIELDS) {
      if (typeof tokens[f] !== 'number') errors.push(`windows.${w}.tokens.${f}: expected number`)
    }
  }
  return errors
}

const fileArg = process.argv[2]
let stats
try {
  stats = loadStats(fileArg)
} catch (err) {
  console.error(`FAIL: could not load stats (${fileArg ? `file ${fileArg}` : 'live CLI'}): ${err.message}`)
  process.exit(2)
}

const errors = validateStatsShape(stats)
if (errors.length) {
  console.error('FAIL: stats contract violated:')
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log('OK: cornercase stats --json contract satisfied (windows total/24h/7d, tokens in/out/cache_read/cache_write).')
process.exit(0)
