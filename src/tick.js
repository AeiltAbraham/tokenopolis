// Tick wiring. `advance` is the pure composition contract (the fix for the T-007 catch): step() MUST
// see the PRIOR sim + the NEW builtTokens, or the builtTokens delta is 0 and "meaningful burn" never
// registers. Everything routing stats → sim goes through here. `tick` adds the I/O (load/save/render),
// persisting + re-rendering only when the sim actually changed.

import { join } from 'node:path'
import { applyStatsRead, loadState, saveState, logLine } from './state.js'
import { step } from './sim/condition.js'
import { scaleName } from './sim/scale.js'
import { writeArtifact } from './artifact.js'
import { readClaudeDelta } from './claude-stats.js'
import { updateProgress, newlyEarned } from './progress.js'
import { dayOf, claimGiftsUpTo, defaultGifts } from './gifts.js'
import { appendEvent } from './history.js'
import { notifyAchievements } from './notify.js'

export function advance(prev, stats, now, claudeDelta = 0) {
  const afterStats = applyStatsRead(prev, stats, claudeDelta) // cornercase + Claude → monotonic builtTokens
  const newSim = step(
    prev.sim, // PRIOR sim — so the delta is visible
    { builtTokens: afterStats.sim.builtTokens, burn24h: afterStats.stats.burn24h, burn7d: afterStats.stats.burn7d },
    now,
  )
  // Chronicle: log scale-ups (one per level crossed) and ruin onset/clear. appendEvent caps + is immutable.
  let history = prev.history ?? []
  const oldScale = prev.sim?.scaleIndex ?? 0
  for (let i = oldScale + 1; i <= newSim.scaleIndex; i++) history = appendEvent(history, { at: now, type: 'scale', label: scaleName(i) })
  const oldRuin = prev.sim?.ruinProgress ?? 0
  if (oldRuin === 0 && newSim.ruinProgress > 0) history = appendEvent(history, { at: now, type: 'ruin', label: 'Ruins' })
  else if (oldRuin > 0 && newSim.ruinProgress === 0) history = appendEvent(history, { at: now, type: 'recovery', label: scaleName(newSim.scaleIndex) })
  // Outbreak contained: infection burned back down to zero.
  const oldInf = prev.sim?.infection?.severity ?? 0
  if (oldInf > 0 && (newSim.infection?.severity ?? 0) === 0) history = appendEvent(history, { at: now, type: 'milestone', label: 'Outbreak contained' })
  // Daily gifts: one per day since install (clamped to the 59-gift catalog). Claim any owed since the
  // last tick — one chronicle line + a banner per gift; `last` carries the claim time for freshness.
  const day = dayOf(prev.install?.installedAt, now)
  let gifts = prev.gifts ?? defaultGifts()
  const claim = claimGiftsUpTo(gifts, day)
  gifts = claim.gifts
  for (const g of claim.claimed) history = appendEvent(history, { at: now, type: 'gift', label: `Day ${g.day}: ${g.name}` })
  if (claim.claimed.length) gifts = { ...gifts, last: { ...gifts.last, at: now } }
  const progress = updateProgress({ ...afterStats, sim: newSim, history, progress: prev.progress }, now)
  return { ...afterStats, sim: newSim, history, progress, gifts }
}

export function tick(deps, now) {
  const {
    dir,
    readStats,
    config,
    nowIso = () => new Date().toISOString(),
    readClaude = () => readClaudeDelta(join(dir, 'claude-offsets.json')),
  } = deps
  const prev = loadState(dir, nowIso)
  if (!prev) return { changed: false, reason: 'no-state' } // first-run is the service's job

  const stats = readStats() // cornercase; may be null (held last-known)
  const claudeDelta = readClaude() // Claude Code burn since last tick (0 if unavailable)
  const next = advance(prev, stats, now, claudeDelta)
  const changed =
    JSON.stringify(prev.sim) !== JSON.stringify(next.sim) ||
    JSON.stringify(prev.history ?? []) !== JSON.stringify(next.history ?? []) ||
    JSON.stringify(prev.progress ?? {}) !== JSON.stringify(next.progress ?? {}) ||
    JSON.stringify(prev.gifts ?? {}) !== JSON.stringify(next.gifts ?? {})
  if (!changed) return { changed: false, state: prev }

  const rendered = { ...next, render: { ...next.render, lastRenderedAt: now } }
  saveState(dir, rendered)
  writeArtifact(rendered, config, dir)
  notifyAchievements(newlyEarned(prev.progress, next.progress)) // best-effort cornercase toast; no-op outside cornercase
  logLine(
    dir,
    stats
      ? `rendered ${scaleName(rendered.sim.scaleIndex)} ${rendered.sim.condition} (scale ${rendered.sim.scaleIndex}, built ${rendered.sim.builtTokens})`
      : `stats unavailable; held tokens; advanced decay; rendered ${rendered.sim.condition}`,
    nowIso,
  )
  return { changed: true, state: rendered }
}
