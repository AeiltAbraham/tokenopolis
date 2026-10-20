// Pure vitality / decay / recovery. No I/O, no clock read, no randomness — `now` is a parameter
// (an ISO string). This is the two-axis heart: SCALE (built, high-water peak, can crumble into
// ruins) × CONDITION (days-since-burn). Condition always degrades before scale regresses, and
// rebuilding from ruins is ~1/recoveryFactor the token cost of the original climb.
//
// `burn24h` / `burn7d` are accepted for interface stability (the renderer/economy use them), but
// the decay core derives activity from the builtTokens delta + elapsed time (the recency signal).

import { DECAY, CONDITIONS } from '../tuning.js'
import { scaleFor, tokensForIndex } from './scale.js'

const DAY_MS = 86_400_000
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)

export function conditionIndexFor(daysSinceBurn) {
  let idx = 0
  for (let i = 0; i < DECAY.conditionDays.length; i++) {
    if (daysSinceBurn >= DECAY.conditionDays[i]) idx = i
  }
  return idx
}

export function conditionName(index) {
  return CONDITIONS[Math.max(0, Math.min(index, CONDITIONS.length - 1))]
}

function vitalityFor(days) {
  if (days <= DECAY.vitalityFullDays) return 1
  return clamp01(1 - (days - DECAY.vitalityFullDays) / (DECAY.vitalityZeroDays - DECAY.vitalityFullDays))
}

// Tokens to reclaim the level fromIndex → fromIndex+1 during recovery: 1/recoveryFactor of its
// original (first-climb) incremental cost.
function recoveryCostForLevel(fromIndex) {
  return (tokensForIndex(fromIndex + 1) - tokensForIndex(fromIndex)) / DECAY.recoveryFactor
}

// step(prevSim, {builtTokens, burn24h, burn7d}, nowIso) → full sim block (see plan §2.2).
export function step(prevSim, { builtTokens, burn24h, burn7d }, now) {
  const prev = prevSim ?? {}
  const nowMs = Date.parse(now)

  const builtIndex = scaleFor(builtTokens).scaleIndex
  const peakScaleIndex = Math.max(prev.peakScaleIndex ?? 0, builtIndex)

  const delta = builtTokens - (prev.builtTokens ?? 0)
  const meaningful = delta >= DECAY.meaningfulTokens
  const prevLast = prev.lastMeaningfulBurnAt ?? now
  const lastMeaningfulBurnAt = meaningful ? now : prevLast
  const daysSinceBurn = Math.max(0, (nowMs - Date.parse(lastMeaningfulBurnAt)) / DAY_MS)

  let ruinProgress = prev.ruinProgress ?? 0
  let recoveryCredit = prev.recoveryCredit ?? 0

  if (meaningful) {
    // Recovering: spend burned tokens to reclaim collapsed levels at 1/recoveryFactor cost.
    recoveryCredit += delta
    while (ruinProgress > 0) {
      const reclaimFrom = peakScaleIndex - ruinProgress // level we'd restore up FROM
      const cost = recoveryCostForLevel(reclaimFrom)
      if (recoveryCredit >= cost) {
        recoveryCredit -= cost
        ruinProgress -= 1
      } else break
    }
    if (ruinProgress === 0) recoveryCredit = 0
  } else if (daysSinceBurn >= DECAY.ruinsThresholdDays) {
    // Idle past the ruins threshold: crumble further, one effective-scale level at a time.
    const lost = Math.floor((daysSinceBurn - DECAY.ruinsThresholdDays) / DECAY.daysPerRuinLevel)
    ruinProgress = Math.min(peakScaleIndex, Math.max(ruinProgress, lost))
  }

  const effectiveScaleIndex = Math.max(0, peakScaleIndex - ruinProgress)
  const conditionIndex = conditionIndexFor(daysSinceBurn)

  return {
    builtTokens,
    scaleIndex: effectiveScaleIndex,
    peakScaleIndex,
    condition: conditionName(conditionIndex),
    vitality: vitalityFor(daysSinceBurn),
    lastMeaningfulBurnAt,
    ruinProgress,
    recoveryCredit,
  }
}
