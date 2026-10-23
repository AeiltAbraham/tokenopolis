// Pure scale ladder. No I/O, no clock, no randomness. Same input → same output.
// The city climbs LINEARLY toward its top tier as the build meter fills (burn OR elapsed time, whichever is
// further along), so equal progress buys equal steps — no front-loaded slowdown.

import { SCALE, SCALE_NAMES, BUILD } from '../tuning.js'

export function scaleName(index) {
  if (index < SCALE_NAMES.length) return SCALE_NAMES[index]
  // Procedural, unbounded: "Megastructure 2", "Megastructure 3", … (only reachable via the act lever past the cap)
  const last = SCALE_NAMES[SCALE_NAMES.length - 1]
  return `${last} ${index - (SCALE_NAMES.length - 1) + 1}`
}

// Underground tiers: 0 below Metropolis, then 1 at Metropolis and +1 per scale step above it.
export function undergroundTiers(index) {
  return index >= SCALE.undergroundFromIndex ? index - SCALE.undergroundFromIndex + 1 : 0
}

// Cumulative tokens to BE at scale index n by burn alone — LINEAR: each step costs an equal slice of the
// token cap (tokenCap / topIndex). Used by the ruins-recovery cost, so reclaiming any level costs the same.
export function tokensForIndex(n) {
  if (n <= 0) return 0
  return Math.floor((n / BUILD.topIndex) * BUILD.tokenCap)
}

// The unified build meter: how "built" the city is, 0..1 = whichever of its token budget or day horizon is
// further along (max). The two caps are calibrated to describe the same climb; capped at 1.0 = fully built.
export function buildProgress(tokens, daysElapsed) {
  const t = Math.max(0, tokens) / BUILD.tokenCap
  const d = Math.max(0, daysElapsed) / BUILD.dayCap
  const p = t > d ? t : d
  return p > 1 ? 1 : p
}

// buildProgress ∈ [0,1] → the scale tier, LINEARLY across the named ladder (0 = Hamlet, 1.0 = the top tier).
export function scaleFromBuild(progress) {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress
  const index = Math.round(p * BUILD.topIndex)
  return { scaleIndex: index, scaleName: scaleName(index), undergroundTiers: undergroundTiers(index) }
}

// Back-compat: the scale a cumulative-token total alone would reach (no time term). Capped at the top tier.
export function scaleFor(tokens) {
  return scaleFromBuild(buildProgress(tokens, 0))
}
