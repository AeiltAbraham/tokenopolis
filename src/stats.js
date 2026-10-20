// Adapter: the ONLY module that names raw `cornercase stats --json` fields. Everything downstream
// consumes the normalized shape { lifetimeTotal, burn24h, burn7d, readAt }. Not pure (it spawns a
// process) — but the spawn is injectable, and every failure path returns null so the caller can
// hold last-known state. It never throws. See stats-contract.md for the pinned field layout.

import { execFileSync } from 'node:child_process'

// cache_read (re-read context) is EXCLUDED — it's ~94% of the total and would balloon the city from
// re-reads of the same history, not new work. Burn = new tokens only: in + out + cache_write.
const TOKEN_FIELDS = ['in', 'out', 'cache_write']
// normalized key → window name in `cornercase stats --json`
const WINDOWS = { lifetimeTotal: 'total', burn24h: '24h', burn7d: '7d' }

function defaultExec() {
  return execFileSync('cornercase', ['stats', '--json'], { encoding: 'utf8' })
}

// burn = in + out + cache_write for one window; null if any field is missing/non-numeric.
function burnOf(win) {
  if (!win || typeof win !== 'object' || !win.tokens) return null
  let sum = 0
  for (const f of TOKEN_FIELDS) {
    const v = win.tokens[f]
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    sum += v
  }
  return sum
}

// readStats(exec?, nowIso?) → { lifetimeTotal, burn24h, burn7d, readAt } | null
// exec() returns the raw JSON string (or throws); nowIso() stamps readAt. Both injectable for tests.
export function readStats(exec = defaultExec, nowIso = () => new Date().toISOString()) {
  let raw
  try {
    raw = exec()
  } catch {
    return null // spawn failure / non-zero exit
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null // unparseable output
  }

  const windows = parsed?.windows ?? {}
  const result = { lifetimeTotal: 0, burn24h: 0, burn7d: 0, readAt: nowIso() }
  for (const [key, winName] of Object.entries(WINDOWS)) {
    const burn = burnOf(windows[winName])
    if (burn === null) return null // missing/invalid contract field
    result[key] = burn
  }
  return result
}
