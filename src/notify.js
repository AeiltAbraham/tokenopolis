// Best-effort cornercase desktop notifications for newly-earned achievements. Only fires when running
// under cornercase (CORNERCASE_BIN is set); a no-op (never throws) everywhere else, so tests and
// file-only runs stay silent. `cornercase notify <text>` shows a message + desktop notification.

import { spawn } from 'node:child_process'
import { ACHIEVEMENTS } from './progress.js'

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]))

export function notifyAchievements(ids, bin = process.env.CORNERCASE_BIN, spawnFn = spawn) {
  if (!bin || !Array.isArray(ids) || ids.length === 0) return
  for (const id of ids) {
    const a = BY_ID.get(id)
    if (!a) continue
    try {
      const child = spawnFn(bin, ['notify', `🏆 Tokenopolis: ${a.name} — ${a.desc}`], { stdio: 'ignore', detached: true })
      if (child && typeof child.unref === 'function') child.unref()
    } catch {
      /* best effort — a failed notification must never break a tick or an act */
    }
  }
}
