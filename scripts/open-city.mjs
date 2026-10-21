#!/usr/bin/env node
// "Open Tokenopolis" action: open the rendered city.html with the platform opener. Resolves the
// artifact from CORNERCASE_PLUGIN_STATE. If the city hasn't been rendered yet, logs a clear message
// rather than failing silently.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Quick synchronous liveness probe (≤1s). A stale endpoint (keeper crashed, never ran stop()) would
// otherwise open a DEAD origin whose in-city buttons can't reach /act. If curl is unavailable we can't
// probe, so we assume live rather than needlessly dropping to the static file.
function endpointIsLive(url) {
  try {
    execFileSync('curl', ['-sS', '-m', '1', '-o', '/dev/null', url], { stdio: 'ignore' })
    return true
  } catch (e) {
    if (e && e.code === 'ENOENT') return true // curl missing — can't probe, assume live
    return false
  }
}

export function openCity(dir, platform = process.platform, spawnFn = spawn, isLive = endpointIsLive) {
  const base = dir ?? '.'
  // Prefer the live local server (its in-city button can trigger acts), but only if it actually answers.
  let url = null
  const endpointFile = join(base, 'endpoint')
  if (existsSync(endpointFile)) {
    try {
      url = readFileSync(endpointFile, 'utf8').trim() || null
    } catch {
      url = null
    }
  }
  let target = url && isLive(url) ? url : null
  if (!target) {
    const file = join(base, 'city.html')
    if (!existsSync(file)) {
      console.error(`Tokenopolis: no city yet at ${file} — is the city-keeper service running?`)
      return false
    }
    if (url) console.error('Tokenopolis: the city server is not responding — opening the static city. Its buttons need the live server; re-enable the plugin (cornercase plugin enable tokenopolis).')
    target = file
  }
  const opener = platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawnFn(opener, [target], { stdio: 'ignore', detached: true })
  if (child && typeof child.unref === 'function') child.unref()
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ok = openCity(process.env.CORNERCASE_PLUGIN_STATE || process.cwd())
  process.exit(ok ? 0 : 1)
}
