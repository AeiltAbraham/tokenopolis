#!/usr/bin/env node
// "Show/Hide Skyline" action: flip `visible` in settings.json; the window process watches the file.
// The only way back after "Hide skyline" in the window's own menu.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function toggleSkyline(dir) {
  const path = join(dir, 'settings.json')
  let settings = {}
  try {
    settings = JSON.parse(readFileSync(path, 'utf8')) ?? {}
  } catch {
    settings = {}
  }
  settings.visible = settings.visible === false
  writeFileSync(path, JSON.stringify(settings, null, 2))
  return settings.visible
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  toggleSkyline(process.env.CORNERCASE_PLUGIN_STATE || process.cwd())
}
