#!/usr/bin/env node
// Status-hook poke. cornercase kills a hook after 60s, so this does the minimum — drop a
// `refresh.request` touch-file into the plugin state dir — and exits immediately. The service
// watches for it and refreshes. Resolves the dir from CORNERCASE_PLUGIN_STATE, NEVER the hook's
// cwd (which is unverified; see README). Never errors out of a hook.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function poke(dir) {
  if (!dir) return false
  try {
    writeFileSync(join(dir, 'refresh.request'), String(Date.now()))
    return true
  } catch {
    return false // best effort — a hook must never throw
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  poke(process.env.CORNERCASE_PLUGIN_STATE)
  process.exit(0)
}
