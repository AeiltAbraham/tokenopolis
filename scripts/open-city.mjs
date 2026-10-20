#!/usr/bin/env node
// "Open Tokenopolis" action: open the rendered city.html with the platform opener. Resolves the
// artifact from CORNERCASE_PLUGIN_STATE. If the city hasn't been rendered yet, logs a clear message
// rather than failing silently.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function openCity(dir, platform = process.platform, spawnFn = spawn) {
  const base = dir ?? '.'
  // Prefer the live local server (its in-city button can trigger acts); fall back to the static file.
  let target = null
  const endpointFile = join(base, 'endpoint')
  if (existsSync(endpointFile)) {
    try {
      target = readFileSync(endpointFile, 'utf8').trim() || null
    } catch {
      target = null
    }
  }
  if (!target) {
    const file = join(base, 'city.html')
    if (!existsSync(file)) {
      console.error(`Tokenopolis: no city yet at ${file} — is the city-keeper service running?`)
      return false
    }
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
