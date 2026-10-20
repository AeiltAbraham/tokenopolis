#!/usr/bin/env node
// Smoke: run the REAL service for a few fast ticks against the real `cornercase stats` in a temp
// state dir, then assert state.json + city.html exist and plugin.log has entries. Exits non-zero on
// failure. (A quick `tickMs` keeps it to ~1s; production ticks every 60s.)

import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startService } from '../service/main.js'

const dir = mkdtempSync(join(tmpdir(), 'tokenopolis-smoke-'))
console.log('smoke state dir:', dir)

const svc = startService({ dir, tickMs: 300 }) // default readStats = real cornercase CLI
await new Promise((r) => setTimeout(r, 900)) // ~3 ticks
svc.stop()

const stateOk = existsSync(join(dir, 'state.json'))
const htmlOk = existsSync(join(dir, 'city.html'))
const log = existsSync(join(dir, 'plugin.log')) ? readFileSync(join(dir, 'plugin.log'), 'utf8') : ''
const logOk = /initialized|rendered|service started/.test(log)

console.log({ stateOk, htmlOk, logOk })
if (!(stateOk && htmlOk && logOk)) {
  console.error('SMOKE FAILED')
  process.exit(1)
}
console.log('SMOKE OK')
process.exit(0)
