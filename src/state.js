// Persistent state store (I/O layer). Lives under CORNERCASE_PLUGIN_STATE, survives reinstalls.
// Captures the install baseline (grow-from-zero: builtTokens counts forward from install, NOT from
// the 26-week history), clamps builtTokens monotonic, and never throws on bad input.

import { readFileSync, writeFileSync, renameSync, appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { defaultProgress } from './progress.js'
import { defaultGifts } from './gifts.js'

export const SCHEMA_VERSION = 1

const statePath = (dir) => join(dir, 'state.json')

export function initState({ baselineLifetimeTokens, installedAt, citySeed }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    install: { installedAt, baselineLifetimeTokens },
    stats: { lastReadAt: null, lastLifetimeTokens: baselineLifetimeTokens, burn24h: 0, burn7d: 0 },
    sim: {
      builtTokens: 0,
      actTokens: 0, // signed "A Random Act" lever: boons raise it, disasters lower it
      scaleIndex: 0,
      peakScaleIndex: 0,
      condition: 'Thriving',
      vitality: 1,
      lastMeaningfulBurnAt: installedAt,
      ruinProgress: 0,
      recoveryCredit: 0,
      infection: { severity: 0, startedAt: null }, // the Outbreak: 0 = healthy, 1 = overrun
      era: 'build', // the arc: 'build' → 'ascendant' (Day 60) → 'fallout' (Day 61, the nuclear fall)
      recovery: 0, // Fallout-era healing meter 0..1 (Phase 4 raises it on idle); 0 in 'build'/'ascendant'
      singularityAt: null, // ISO stamp when the Singularity (Ascension) began; null until Day 60
    },
    claude: { cumulativeTokens: 0 }, // Claude Code (desktop/CLI) burn, counted forward from install
    // "A Random Act" deck: usedIds drawn-without-replacement (reset when all 50 used), lastActAt =
    // hourly cooldown stamp, last = the most recent occurrence (what the artifact names + animates).
    acts: { usedIds: [], lastActAt: null, last: null },
    progress: defaultProgress(), // achievements earned + active-day streak (grow-from-zero)
    gifts: defaultGifts(), // daily gifts: one per day since install (Days 1..59), unlocked set accumulates
    climax: null, // the climax marker { phase: 'ascension'|'fall'|'rebirth', at: ISO } — drives the one-time animation
    cycleStartAt: installedAt, // the current build→ascend→fall→recover cycle's day anchor (resets on rebirth)
    history: [], // chronicle: newest-first capped event log (acts, scale-ups, ruin/recovery, gifts, singularity)
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

// Pure. Accumulates the Claude burn delta, refreshes the cornercase stats block, and clamps
// builtTokens monotonic. builtTokens = (cornercase lifetime − baseline) + Claude-since-install — the
// two sources summed. stats === null AND no Claude delta → state returned unchanged (hold). Never throws.
export function applyStatsRead(state, stats, claudeDelta = 0) {
  const added = Math.max(0, Number(claudeDelta) || 0)
  if (!stats && added === 0) return state
  const claudeCumulative = (state.claude?.cumulativeTokens ?? 0) + added
  const lifetime = stats ? stats.lifetimeTotal : state.stats.lastLifetimeTokens
  const cornercaseBurn = Math.max(0, lifetime - state.install.baselineLifetimeTokens)
  const builtTokens = Math.max(state.sim.builtTokens, cornercaseBurn + claudeCumulative, 0)
  return {
    ...state,
    claude: { ...(state.claude ?? {}), cumulativeTokens: claudeCumulative },
    stats: stats
      ? { lastReadAt: stats.readAt, lastLifetimeTokens: stats.lifetimeTotal, burn24h: stats.burn24h, burn7d: stats.burn7d }
      : state.stats,
    sim: { ...state.sim, builtTokens },
  }
}
