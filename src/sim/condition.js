// Pure vitality / decay / recovery. No I/O, no clock read, no randomness — `now` is a parameter
// (an ISO string). This is the two-axis heart: SCALE (built, high-water peak, can crumble into
// ruins) × CONDITION (days-since-burn). Condition always degrades before scale regresses, and
// rebuilding from ruins is ~1/recoveryFactor the token cost of the original climb.
//
// `burn24h` / `burn7d` are accepted for interface stability (the renderer/economy use them), but
// the decay core derives activity from the builtTokens delta + elapsed time (the recency signal).

import { DECAY, CONDITIONS, INFECTION, SINGULARITY, RECOVERY } from '../tuning.js'
import { scaleFromBuild, buildProgress, tokensForIndex } from './scale.js'

const DAY_MS = 86_400_000
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)

// The city's effective size = real burn + the signed "A Random Act" lever, floored at an empty lot.
// Boons raise it (grow), disasters lower it (shrink). Everything visual/economic keys off this.
export const effectiveBuilt = (sim) => Math.max(0, (sim?.builtTokens ?? 0) + (sim?.actTokens ?? 0))

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

// The Fallout era — the decay clock run backwards. After the nuclear fall the city is razed; here
// RESTRAINT heals it. Recovery (0..1) rises with idle time and a meaningful burn is a setback (resets
// the recovery clock, `justFell` anchors it at 0 on the fall tick). As recovery climbs the wasteland
// rebuilds — scale, condition and life all track it — until at 1.0 the city is REBORN green and
// thriving, the era loops back to 'build', and a fresh cycle can begin. Pure: same prev → same sim.
function falloutStep(prev, builtTokens, now, singularityAt, justFell, lifetimeDayElapsed = 0) {
  const peak = prev.peakScaleIndex ?? 0
  const nowMs = Date.parse(now)
  const meaningful = builtTokens - (prev.builtTokens ?? 0) >= DECAY.meaningfulTokens
  // The recovery anchor is DEDICATED (not lastMeaningfulBurnAt — a pre-Phase-4 fallout state persisted
  // that as a STALE build-era burn time). Reset to now on the fall tick (start at 0) or a meaningful-burn
  // setback; otherwise carried. A missing anchor — an upgraded pre-Phase-4 fallout state — backfills to
  // now, so recovery starts fresh from the upgrade instead of jumping straight to rebirth on stale idle time.
  const anchor = justFell || meaningful ? now : prev.recoveryAnchorAt ?? now
  const daysIdle = Math.max(0, (nowMs - Date.parse(anchor)) / DAY_MS)
  const recovery = clamp01(daysIdle / RECOVERY.healDays)

  // Rebirth: fully recovered → a fresh green thriving city, era back to 'build', singularity re-armed.
  if (recovery >= 1) {
    // Reborn at the city's LIFETIME maturity — grand again, since 30+ days have passed since install.
    const builtIndex = scaleFromBuild(buildProgress(Math.max(0, builtTokens), lifetimeDayElapsed)).scaleIndex
    return {
      builtTokens,
      actTokens: 0, // the act lever is wiped clean for the new life
      scaleIndex: builtIndex,
      peakScaleIndex: builtIndex, // a fresh high-water mark — the new beginning
      condition: CONDITIONS[0], // Thriving
      vitality: 1,
      lastMeaningfulBurnAt: now,
      ruinProgress: 0,
      recoveryCredit: 0,
      infection: { severity: 0, startedAt: null },
      era: 'build',
      recovery: 0,
      singularityAt: null, // re-armed: the next build cycle can ascend again
    }
  }

  // Healing: the wasteland rebuilds as recovery climbs — fewer ruins, a better condition, life returning.
  const healedScale = Math.round(recovery * peak)
  const condIndex = Math.round((1 - recovery) * (CONDITIONS.length - 1))
  return {
    builtTokens, // still counted (monotonic), but it no longer drives scale in fallout
    actTokens: prev.actTokens ?? 0,
    scaleIndex: healedScale,
    peakScaleIndex: peak, // the ruined-metropolis silhouette the land rebuilds back into
    condition: CONDITIONS[condIndex], // Buried at 0 → Thriving as it approaches rebirth
    vitality: recovery, // dead quiet when razed (stale → frames hold still); livelier as it heals
    lastMeaningfulBurnAt: anchor, // in fallout the decay clock shows "days resting" = recovery time
    recoveryAnchorAt: anchor, // the dedicated recovery clock (survives the pre-Phase-4 backfill above)
    ruinProgress: Math.max(0, peak - healedScale), // the gap that is still rubble
    recoveryCredit: 0,
    infection: { severity: 0, startedAt: null }, // the blast sterilizes any outbreak
    era: 'fallout',
    recovery,
    singularityAt: singularityAt ?? prev.singularityAt ?? now,
  }
}

// step(prevSim, {builtTokens, burn24h, burn7d, day}, nowIso) → full sim block (see plan §2.2).
// `day` (days since install, from tick.js) drives the Singularity; omitted → day 0 → stays in 'build'.
export function step(prevSim, { builtTokens, burn24h, burn7d, day = 1, lifetimeDay = 1, cycleStartTokens = 0 }, now) {
  const prev = prevSim ?? {}
  const nowMs = Date.parse(now)
  const dayElapsed = Math.max(0, day - 1) // `day` is 1-based (install = day 1); the meter counts ELAPSED days
  const lifetimeDayElapsed = Math.max(0, lifetimeDay - 1)

  // --- Era transitions, evaluated first. The Singularity fires when the PER-CYCLE build meter tops out
  // (1B real tokens OR 30 elapsed days, whichever first), then holds `holdDays` before the nuclear fall. ---
  let era = prev.era ?? 'build'
  let singularityAt = prev.singularityAt ?? null
  const realCycleTokens = Math.max(0, builtTokens - cycleStartTokens) // real burn THIS cycle — acts don't trigger the climax
  if (era === 'build' && buildProgress(realCycleTokens, dayElapsed) >= 1) {
    era = 'ascendant'
    singularityAt = singularityAt ?? now
  }
  if (era === 'ascendant' && singularityAt && nowMs - Date.parse(singularityAt) >= SINGULARITY.holdDays * DAY_MS) era = 'fallout'
  if (era === 'fallout') return falloutStep(prev, builtTokens, now, singularityAt, (prev.era ?? 'build') !== 'fallout', lifetimeDayElapsed)

  // Scale follows the LIFETIME build meter — effective size (real burn + the act lever) OR elapsed days
  // since install, mapped LINEARLY to the ladder (steady climb, no front-loaded slowdown). A boon grows
  // the city and a disaster shrinks it via the token term; peak is the high-water "bones" a disaster never lowers.
  const actTokens = prev.actTokens ?? 0
  const eff = Math.max(0, builtTokens + actTokens)
  const builtIndex = scaleFromBuild(buildProgress(eff, lifetimeDayElapsed)).scaleIndex
  const peakScaleIndex = Math.max(prev.peakScaleIndex ?? 0, builtIndex)

  const delta = builtTokens - (prev.builtTokens ?? 0) // real burn only — acts are not "burn"
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

  // Effective scale is bounded by BOTH the ruins model (idle decay) AND the act lever: a disaster
  // drops builtIndex below peak, so the city shrinks now and rebuilds as real burn catches up.
  const effectiveScaleIndex = Math.max(0, Math.min(peakScaleIndex - ruinProgress, builtIndex))
  const conditionIndex = conditionIndexFor(daysSinceBurn)

  // Outbreak: severity falls when you burn (you fight it off), creeps up when you neglect it.
  const prevInf = prev.infection ?? { severity: 0, startedAt: null }
  let infSeverity = clamp01(prevInf.severity ?? 0)
  if (infSeverity > 0) {
    infSeverity = meaningful ? clamp01(infSeverity - INFECTION.clearPerBurn) : clamp01(infSeverity + INFECTION.worsenPerIdleTick)
  }
  const infection = { severity: infSeverity, startedAt: infSeverity > 0 ? (prevInf.startedAt ?? now) : null }

  // The Ascension (era 'ascendant'): the city flares to its gleaming peak — no decay, no ruins, no
  // outbreak, full vitality — its proudest moment, held (SINGULARITY.holdDays) until the fall.
  if (era === 'ascendant') {
    return {
      builtTokens,
      actTokens,
      scaleIndex: peakScaleIndex,
      peakScaleIndex,
      condition: CONDITIONS[0], // Thriving
      vitality: 1,
      lastMeaningfulBurnAt,
      ruinProgress: 0,
      recoveryCredit: 0,
      infection: { severity: 0, startedAt: null },
      era,
      recovery: clamp01(prev.recovery ?? 0),
      singularityAt,
    }
  }

  return {
    builtTokens,
    actTokens,
    scaleIndex: effectiveScaleIndex,
    peakScaleIndex,
    condition: conditionName(conditionIndex),
    vitality: vitalityFor(daysSinceBurn),
    lastMeaningfulBurnAt,
    ruinProgress,
    recoveryCredit,
    infection,
    era,
    recovery: clamp01(prev.recovery ?? 0),
    singularityAt,
  }
}
