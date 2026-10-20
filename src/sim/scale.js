// Pure scale ladder. No I/O, no clock, no randomness. Same input → same output.
// The ladder is open-ended (no top) and front-loaded: the burn needed to climb one step grows
// geometrically, so equal token increments buy ever-fewer steps as the city grows.

import { SCALE, SCALE_NAMES } from '../tuning.js'

// Cumulative burn needed to BE at scale index n. index 0 = 0 tokens. Geometric thereafter.
export function tokensForIndex(n) {
  if (n <= 0) return 0
  return Math.floor(SCALE.baseTokens * SCALE.growth ** (n - 1))
}

export function scaleName(index) {
  if (index < SCALE_NAMES.length) return SCALE_NAMES[index]
  // Procedural, unbounded: "Megastructure 2", "Megastructure 3", …
  const last = SCALE_NAMES[SCALE_NAMES.length - 1]
  return `${last} ${index - (SCALE_NAMES.length - 1) + 1}`
}

// Underground tiers: 0 below Metropolis, then 1 at Metropolis and +1 per scale step above it.
export function undergroundTiers(index) {
  return index >= SCALE.undergroundFromIndex ? index - SCALE.undergroundFromIndex + 1 : 0
}

export function scaleFor(builtTokens) {
  const t = Math.max(0, builtTokens)
  let index = 0
  // Climb while the next step's threshold is affordable. Thresholds grow geometrically, so this
  // terminates in ~log(t) steps; the cap is only a pathological-input backstop.
  while (index < 100_000 && tokensForIndex(index + 1) <= t) index++
  return {
    scaleIndex: index,
    scaleName: scaleName(index),
    undergroundTiers: undergroundTiers(index),
  }
}
