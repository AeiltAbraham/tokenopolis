// Tick wiring. `advance` is the pure composition contract (the fix for the T-007 catch): step() MUST
// see the PRIOR sim + the NEW builtTokens, or the builtTokens delta is 0 and "meaningful burn" never
// registers. Everything routing stats → sim goes through here. `tick` adds the I/O (load/save/render),
// persisting + re-rendering only when the sim actually changed.

import { applyStatsRead, loadState, saveState, logLine } from './state.js'
import { step } from './sim/condition.js'
import { scaleName } from './sim/scale.js'
import { writeArtifact } from './artifact.js'

export function advance(prev, stats, now) {
  const afterStats = applyStatsRead(prev, stats) // stats block + new monotonic builtTokens
  const newSim = step(
    prev.sim, // PRIOR sim — so the delta is visible
    { builtTokens: afterStats.sim.builtTokens, burn24h: afterStats.stats.burn24h, burn7d: afterStats.stats.burn7d },
    now,
  )
  return { ...afterStats, sim: newSim }
}

export function tick(deps, now) {
  const { dir, readStats, config, nowIso = () => new Date().toISOString() } = deps
  const prev = loadState(dir, nowIso)
  if (!prev) return { changed: false, reason: 'no-state' } // first-run is the service's job

  const stats = readStats() // may be null (held last-known)
  const next = advance(prev, stats, now)
  const changed = JSON.stringify(prev.sim) !== JSON.stringify(next.sim)
  if (!changed) return { changed: false, state: prev }

  const rendered = { ...next, render: { ...next.render, lastRenderedAt: now } }
  saveState(dir, rendered)
  writeArtifact(rendered, config, dir)
  logLine(
    dir,
    stats
      ? `rendered ${scaleName(rendered.sim.scaleIndex)} ${rendered.sim.condition} (scale ${rendered.sim.scaleIndex}, built ${rendered.sim.builtTokens})`
      : `stats unavailable; held tokens; advanced decay; rendered ${rendered.sim.condition}`,
    nowIso,
  )
  return { changed: true, state: rendered }
}
