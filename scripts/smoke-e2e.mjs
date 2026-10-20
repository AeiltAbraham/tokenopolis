#!/usr/bin/env node
// End-to-end smoke: from a CLEAN state dir, run the real service against the real `cornercase stats`,
// and prove grow-from-zero — the first render is a Hamlet with builtTokens 0 even though the machine
// has a large lifetime total (the install baseline is captured, history is NOT seeded). Also checks
// the artifact is self-contained and ≤ 300 KB. Exits non-zero on any failure.

import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startService } from '../service/main.js'

const dir = mkdtempSync(join(tmpdir(), 'tokenopolis-e2e-'))
console.log('e2e state dir:', dir)

const svc = startService({ dir, tickMs: 300 }) // default readStats = real cornercase CLI
await new Promise((r) => setTimeout(r, 900))
svc.stop()

let ok = true
const fail = (m) => {
  console.error('FAIL:', m)
  ok = false
}

if (!existsSync(join(dir, 'state.json'))) fail('no state.json')
const htmlPath = join(dir, 'city.html')
if (!existsSync(htmlPath)) {
  fail('no city.html')
} else {
  const html = readFileSync(htmlPath, 'utf8')
  const bytes = statSync(htmlPath).size
  if (bytes > 300 * 1024) fail(`city.html ${bytes} bytes > 300KB`)
  if (/https?:\/\//i.test(html)) fail('city.html contains external references')
  const data = JSON.parse(html.match(/<script id="city-data"[^>]*>([\s\S]*?)<\/script>/)[1])
  if (data.readout.builtTokens !== 0) fail(`grow-from-zero violated: builtTokens ${data.readout.builtTokens}`)
  if (data.readout.scaleName !== 'Hamlet') fail(`expected Hamlet at install, got ${data.readout.scaleName}`)
  console.log(`city.html: ${bytes} bytes, self-contained, builtTokens ${data.readout.builtTokens} (${data.readout.scaleName})`)
}

const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
console.log('install baseline lifetime:', state.install.baselineLifetimeTokens, '| builtTokens:', state.sim.builtTokens)

if (!ok) {
  console.error('E2E SMOKE FAILED')
  process.exit(1)
}
console.log('E2E SMOKE OK — grow-from-zero confirmed against the real cornercase CLI')
process.exit(0)
