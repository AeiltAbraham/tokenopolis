// Persistent state store (I/O layer). Lives under CORNERCASE_PLUGIN_STATE, survives reinstalls.
// Captures the install baseline (grow-from-zero: builtTokens counts forward from install, NOT from
// the 26-week history), clamps builtTokens monotonic, and never throws on bad input.

import { readFileSync, writeFileSync, renameSync, appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const SCHEMA_VERSION = 1

const statePath = (dir) => join(dir, 'state.json')

export function initState({ baselineLifetimeTokens, installedAt, citySeed }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    install: { installedAt, baselineLifetimeTokens },
    stats: { lastReadAt: null, lastLifetimeTokens: baselineLifetimeTokens, burn24h: 0, burn7d: 0 },
    sim: {
      builtTokens: 0,
      scaleIndex: 0,
      peakScaleIndex: 0,
      condition: 'Thriving',
      vitality: 1,
      lastMeaningfulBurnAt: installedAt,
      ruinProgress: 0,
      recoveryCredit: 0,
    },
    citySeed,
    render: { lastRenderedAt: null, artifactFile: 'city.html' },
  }
}

export function logLine(dir, message, nowIso = () => new Date().toISOString()) {
  try {
    appendFileSync(join(dir, 'plugin.log'), `${nowIso()} ${message}\n`)
  } catch {
    /* logging must never throw */
  }
}

// Returns the parsed state, or null for first-run (no file) OR corrupt file (which is backed up aside).
export function loadState(dir, nowIso = () => new Date().toISOString()) {
  const path = statePath(dir)
  if (!existsSync(path)) return null
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    const backup = `${path}.corrupt-${nowIso().replace(/[:.]/g, '-')}`
    try {
      renameSync(path, backup)
    } catch {
      /* best effort */
    }
    logLine(dir, `state.json unparseable; backed up to ${backup}; treating as first run`, nowIso)
    return null
  }
}

export function saveState(dir, state) {
  writeFileSync(statePath(dir), JSON.stringify(state, null, 2), { mode: 0o600 })
}

// Pure. Refreshes the stats block and clamps builtTokens monotonic (a stats hiccup can never
// shrink history). stats === null → state returned unchanged (hold last-known). Never throws.
export function applyStatsRead(state, stats) {
  if (!stats) return state
  const builtTokens = Math.max(
    state.sim.builtTokens,
    stats.lifetimeTotal - state.install.baselineLifetimeTokens,
    0,
  )
  return {
    ...state,
    stats: {
      lastReadAt: stats.readAt,
      lastLifetimeTokens: stats.lifetimeTotal,
      burn24h: stats.burn24h,
      burn7d: stats.burn7d,
    },
    sim: { ...state.sim, builtTokens },
  }
}
