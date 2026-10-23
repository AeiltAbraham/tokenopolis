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
import { updatePyromid, newlyUnlocked, defaultPyromid } from './pyromid.js'
import { treasuryFor } from './sim/economy.js'
import { appendEvent } from './history.js'
import { residentsFor, vignette, ambientVignette } from './residents.js'
import { notifyAchievements } from './notify.js'

export function advance(prev, stats, now, claudeDelta = 0) {
  const afterStats = applyStatsRead(prev, stats, claudeDelta) // cornercase + Claude → monotonic builtTokens
  const cycleStart = prev.cycleStartAt ?? prev.install?.installedAt // the current cycle's anchor (resets on rebirth)
  const day = dayOf(cycleStart, now) // days since the cycle began — drives gifts AND the per-cycle Singularity meter
  const lifetimeDay = dayOf(prev.install?.installedAt ?? cycleStart, now) // days since install — drives the city's size (maturity)
  const cycleStartTokens = prev.cycleStartTokens ?? 0 // the cycle's burn baseline (resets on rebirth) — the meter's token axis
  const newSim = step(
    prev.sim, // PRIOR sim — so the delta is visible
    { builtTokens: afterStats.sim.builtTokens, burn24h: afterStats.stats.burn24h, burn7d: afterStats.stats.burn7d, day, lifetimeDay, cycleStartTokens },
    now,
  )
  let history = prev.history ?? []
  // Named residents voice the chronicle: a deterministic cast (seeded by citySeed, sized to the city) and
  // a per-transition vignette. `ev` flavours an event's headline with a resident line when one exists; the
  // event's `label` is left intact (so type/label assertions + the data stay stable). Pure: `now` is passed.
  const history0 = history // the untouched log; if any append reassigns `history`, we chronicled something
  const sourceMix = afterStats.sim.builtTokens > 0 ? Math.max(0, Math.min(1, (afterStats.claude?.cumulativeTokens ?? 0) / afterStats.sim.builtTokens)) : 0.5
  const residents = residentsFor(prev.citySeed, newSim.scaleIndex, sourceMix)
  const vseed = (Date.parse(now) >>> 0) || 1
  const ev = (type, label, ctx, salt = 0) => {
    const line = vignette(type, ctx, residents, (vseed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0)
    return line ? { at: now, type, label, line } : { at: now, type, label }
  }
  // The Day-60 Singularity → Fallout: the climax is the headline, so the normal decay/scale lines are
  // suppressed on the transition tick. A single tick that jumps past both days chronicles both climax lines.
  const fromEra = prev.sim?.era ?? 'build'
  const toEra = newSim.era ?? 'build'
  const climaxHappened = fromEra !== toEra
  const rebirthHappened = fromEra === 'fallout' && toEra === 'build' // recovery hit 100% → the city returns
  let climax = prev.climax ?? null
  if (climaxHappened) {
    if (fromEra === 'build') climax = { phase: 'ascension', at: now }
    if (toEra === 'fallout') climax = { phase: 'fall', at: now }
    if (rebirthHappened) climax = { phase: 'rebirth', at: now }
  } else {
    // Normal build-era chronicle: scale-ups (one per level crossed) + ruin onset/clear + outbreak cleared.
    const oldScale = prev.sim?.scaleIndex ?? 0
    for (let i = oldScale + 1; i <= newSim.scaleIndex; i++) history = appendEvent(history, ev('scale', scaleName(i), scaleName(i), i))
    const oldRuin = prev.sim?.ruinProgress ?? 0
    if (oldRuin === 0 && newSim.ruinProgress > 0) history = appendEvent(history, ev('ruin', 'Ruins', null, 0))
    else if (oldRuin > 0 && newSim.ruinProgress === 0) history = appendEvent(history, ev('recovery', scaleName(newSim.scaleIndex), scaleName(newSim.scaleIndex), 1))
    const oldInf = prev.sim?.infection?.severity ?? 0
    if (oldInf > 0 && (newSim.infection?.severity ?? 0) === 0) history = appendEvent(history, ev('milestone', 'Outbreak contained', 'Outbreak contained', 2))
  }
  // Daily gifts: one per day of the current cycle (clamped to the 59-gift catalog; Day 60 is the climax).
  // Rebirth re-arms the calendar — earned gifts persist as blueprints and their daily banners replay.
  let gifts = prev.gifts ?? defaultGifts()
  let cycleStartAt = prev.cycleStartAt ?? null
  let cycleStartTokensNext = prev.cycleStartTokens ?? 0
  if (rebirthHappened) {
    cycleStartAt = now
    cycleStartTokensNext = afterStats.sim.builtTokens // the new cycle's burn baseline — the Singularity meter restarts
    gifts = { ...gifts, claimedThroughDay: 0 }
  } else {
    const claim = claimGiftsUpTo(gifts, day)
    gifts = claim.gifts
    for (const g of claim.claimed) history = appendEvent(history, ev('gift', `Day ${g.day}: ${g.name}`, g.name, g.day))
    if (claim.claimed.length) gifts = { ...gifts, last: { ...gifts.last, at: now } }
  }
  // The Pyromid: build it from the current treasury (which already includes its click bonus), high-water,
  // and chronicle each new line of lore it reveals as it rises.
  const prevPyro = prev.pyromid ?? defaultPyromid()
  const pyromid = updatePyromid(prevPyro, treasuryFor(newSim, prevPyro.bonus))
  for (const line of newlyUnlocked(prevPyro.infoLevel, pyromid.infoLevel)) history = appendEvent(history, { at: now, type: 'pyromid', label: line })
  // The climax lines go in LAST so they stay newest-first — the headline sits atop the chronicle and a
  // big gift catch-up (Day 4 → Day 61 in one tick) can never bury or cap them out.
  if (climaxHappened) {
    if (fromEra === 'build') history = appendEvent(history, ev('singularity', 'AI Reached Consciousness', 'the Singularity', 5))
    if (toEra === 'fallout') history = appendEvent(history, ev('downfall', 'Nuclear Downfall', 'the ash', 6))
    if (rebirthHappened) history = appendEvent(history, ev('rebirth', 'The City Reborn', 'the new city', 7))
  }
  // A quiet day (nothing else chronicled) still breathes: one ambient resident line on a day rollover.
  const prevDay = dayOf(cycleStart, prev.render?.lastRenderedAt ?? cycleStart)
  if (history === history0 && day > prevDay) {
    const line = ambientVignette(residents, (vseed ^ Math.imul(day + 1, 0x85ebca6b)) >>> 0)
    if (line) history = appendEvent(history, { at: now, type: 'vignette', label: line, line })
  }
  const progress = updateProgress({ ...afterStats, sim: newSim, history, progress: prev.progress }, now)
  return { ...afterStats, sim: newSim, history, progress, gifts, pyromid, climax, cycleStartAt, cycleStartTokens: cycleStartTokensNext }
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
    JSON.stringify(prev.gifts ?? {}) !== JSON.stringify(next.gifts ?? {}) ||
    JSON.stringify(prev.pyromid ?? {}) !== JSON.stringify(next.pyromid ?? {}) ||
    JSON.stringify(prev.climax ?? null) !== JSON.stringify(next.climax ?? null) ||
    (prev.cycleStartAt ?? null) !== (next.cycleStartAt ?? null) ||
    (prev.cycleStartTokens ?? 0) !== (next.cycleStartTokens ?? 0)
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
