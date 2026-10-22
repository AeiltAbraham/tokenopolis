// Pure economy readout. No I/O, no clock, no randomness.
// population / treasury / economyRating are each strictly increasing in builtTokens (at fixed
// vitality) and strictly increasing in vitality (at fixed builtTokens). A vitality-only term keeps
// the vitality response alive even at zero burn; a (builtTokens × vitality) term makes a busy big
// city outshine a sleepy one of the same size.

import { ECONOMY, INFECTION } from '../tuning.js'

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)

export function economyFor(builtTokens, vitality) {
  const v = clamp01(vitality)
  const t = Math.max(0, builtTokens)

  const population = Math.floor(ECONOMY.popBase + ECONOMY.popVitality * v + ECONOMY.popPerToken * t * (0.3 + 0.7 * v))
  const treasury = Math.floor(ECONOMY.treasuryBase + ECONOMY.treasuryVitality * v + ECONOMY.treasuryPerToken * t * (0.2 + 0.8 * v))
  const economyRating = Math.floor(ECONOMY.ratingBase + ECONOMY.ratingVitality * v + ECONOMY.ratingPerToken * t * (0.4 + 0.6 * v))

  return { population, treasury, economyRating }
}

// The city's treasury the way the HUD shows it: the economy treasury at the sim's effective size +
// vitality (outbreak-dampened), plus the Pyromid's click bonus. The single source of truth the
// Pyromid build, the click handler, and the readout all share.
export function treasuryFor(sim, bonus = 0) {
  const eff = Math.max(0, (sim?.builtTokens ?? 0) + (sim?.actTokens ?? 0))
  const infection = sim?.infection?.severity ?? 0
  const vitality = (sim?.vitality ?? 0) * (1 - INFECTION.economyDrop * infection)
  return economyFor(eff, vitality).treasury + Math.max(0, Number(bonus) || 0)
}
