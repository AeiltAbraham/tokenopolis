import { test } from 'node:test'
import assert from 'node:assert/strict'
import { step } from '../src/sim/condition.js'
import { advance } from '../src/tick.js'
import { initState } from '../src/state.js'
import { cityData } from '../src/artifact.js'
import { dayOf } from '../src/gifts.js'
import { RECOVERY } from '../src/tuning.js'

const DAY = 86_400_000
const base = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (d) => new Date(base + d * DAY).toISOString()

function metropolis() {
  let sim = step({}, { builtTokens: 0, burn24h: 0, burn7d: 0, day: 1 }, iso(0))
  let built = 0
  for (let d = 1; d <= 4; d++) {
    built += 150_000_000 // → 600M, scale 4 (built by burn)
    sim = step(sim, { builtTokens: built, burn24h: 150e6, burn7d: built, day: d }, iso(d))
  }
  return { sim, built }
}
// Ascend when the meter tops out (30 elapsed days), then fall after the hold → razed (fallout, recovery 0, at iso(31)).
const fallenSim = () => {
  const { sim, built } = metropolis()
  const asc = step(sim, { builtTokens: built, burn24h: 0, burn7d: 0, day: 31 }, iso(30))
  return step(asc, { builtTokens: built, burn24h: 0, burn7d: 0, day: 32 }, iso(31))
}

// Reach the fallout era through advance(): a catch-up jump ascends (+ all 59 gifts), then a hold-day later falls (at iso(71)).
function toFallout() {
  let state = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 1 })
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 40e6, burn7d: 160e6, readAt: iso(4) }, iso(4))
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(70) }, iso(70)) // day 71 → ascend + all gifts
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(71) }, iso(71)) // hold-day → fall
  return state
}

test('fallout: idleness heals — recovery rises with idle time, the city rebuilds', () => {
  const fall = fallenSim()
  assert.equal(fall.recovery, 0)
  assert.equal(fall.scaleIndex, 0)
  // Half of healDays (5 of 10) idle later → ~50% recovered, city partway rebuilt, life returning.
  const healing = step(fall, { builtTokens: fall.builtTokens, burn24h: 0, burn7d: 0, day: 36 }, iso(31 + RECOVERY.healDays / 2))
  assert.equal(healing.era, 'fallout')
  assert.ok(healing.recovery > 0.4 && healing.recovery < 0.6, `~50% recovered, got ${healing.recovery}`)
  assert.ok(healing.scaleIndex > 0 && healing.scaleIndex < healing.peakScaleIndex, 'partway rebuilt')
  assert.ok(healing.vitality > 0, 'life returns as it heals')
})

test('fallout: burning is a setback — a meaningful burn resets recovery', () => {
  const fall = fallenSim()
  const healing = step(fall, { builtTokens: fall.builtTokens, burn24h: 0, burn7d: 0, day: 36 }, iso(36))
  assert.ok(healing.recovery > 0.4, 'recovered partway while idle')
  const setback = step(healing, { builtTokens: healing.builtTokens + 1_000_000, burn24h: 1e6, burn7d: 1e6, day: 36 }, iso(36))
  assert.equal(setback.era, 'fallout')
  assert.equal(setback.recovery, 0, 'burning wipes the recovery progress')
  assert.equal(setback.scaleIndex, 0, 'and the wasteland falls back to rubble')
})

test('fallout: at 100% recovery the city is reborn — era flips back to build, fresh and thriving', () => {
  const fall = fallenSim()
  const reborn = step(fall, { builtTokens: fall.builtTokens, burn24h: 0, burn7d: 0, day: 41 }, iso(31 + RECOVERY.healDays))
  assert.equal(reborn.era, 'build', 'the era loops back to build')
  assert.equal(reborn.recovery, 0)
  assert.equal(reborn.condition, 'Thriving')
  assert.equal(reborn.vitality, 1)
  assert.equal(reborn.ruinProgress, 0)
  assert.equal(reborn.singularityAt, null, 're-armed for the next cycle')
  assert.ok(reborn.scaleIndex > 0, 'reborn as a real city (sized by accumulated burn)')
  assert.equal(reborn.scaleIndex, reborn.peakScaleIndex, 'intact — no ruins')
})

test('fallout step is deterministic while healing', () => {
  const fall = fallenSim()
  const a = step(fall, { builtTokens: fall.builtTokens, burn24h: 0, burn7d: 0, day: 36 }, iso(36))
  const b = step(fall, { builtTokens: fall.builtTokens, burn24h: 0, burn7d: 0, day: 36 }, iso(36))
  assert.deepEqual(a, b)
})

test('backward-compat: an upgraded pre-Phase-4 fallout state starts recovery fresh, not instant rebirth', () => {
  const { sim } = metropolis() // peak 4, last meaningful burn ~ iso(4)
  // A state persisted by committed Phase 3: in fallout, recovery 0, lastMeaningfulBurnAt = the STALE
  // build-era burn time, and NO recoveryAnchorAt (Phase 3 never wrote one).
  const prePhase4 = { ...sim, era: 'fallout', recovery: 0, scaleIndex: 0, ruinProgress: sim.peakScaleIndex, condition: 'Buried', vitality: 0, singularityAt: iso(60) }
  delete prePhase4.recoveryAnchorAt
  // First Phase-4 tick, ~58 idle days after that stale time — must NOT instant-rebirth.
  const first = step(prePhase4, { builtTokens: prePhase4.builtTokens, burn24h: 0, burn7d: 0, day: 62 }, iso(62))
  assert.equal(first.era, 'fallout', 'stays in fallout — no instant rebirth from stale idle time')
  assert.equal(first.recovery, 0, 'recovery restarts fresh from the upgrade')
  assert.ok(first.recoveryAnchorAt, 'a dedicated recovery anchor is now set')
  // From there it heals normally (5 of 10 healDays later → ~50%).
  const later = step(first, { builtTokens: first.builtTokens, burn24h: 0, burn7d: 0, day: 67 }, iso(67))
  assert.ok(later.recovery > 0.4 && later.recovery < 0.6, 'heals from the upgrade moment onward')
})

test('advance: rebirth chronicles it, re-arms the gift calendar, and resets the cycle anchor', () => {
  let state = toFallout()
  assert.equal(state.sim.era, 'fallout')
  assert.equal(Object.keys(state.gifts.unlocked).length, 59, 'all gifts earned before the fall')
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(81) }, iso(81)) // 10 idle days after the fall (iso71) → rebirth
  assert.equal(state.sim.era, 'build', 'reborn into a new build cycle')
  assert.equal(state.history[0].type, 'rebirth', 'the rebirth headlines the chronicle')
  assert.equal(state.climax.phase, 'rebirth')
  assert.equal(state.cycleStartAt, iso(81), 'the cycle anchor resets to the rebirth moment')
  assert.equal(state.gifts.claimedThroughDay, 0, 'the gift calendar re-arms')
  assert.equal(Object.keys(state.gifts.unlocked).length, 59, 'earned gifts persist as blueprints')
})

test('advance: the arc loops — after rebirth the new cycle ascends again at its own 30-day horizon', () => {
  let state = toFallout()
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(81) }, iso(81)) // rebirth; cycle anchor = iso(81)
  // 30 elapsed days into the NEW cycle (iso(81) + 30).
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(111) }, iso(111))
  assert.equal(dayOf(state.cycleStartAt, iso(111)), 31, 'the second cycle reaches its own 30-day horizon (day 31)')
  assert.equal(state.sim.era, 'ascendant', 'and ascends again — the loop closes')
})

test('cityData: the fallout readout tracks recovery (survivors return as it heals)', () => {
  const cfg = { cityName: 'X', theme: 'coastal', flag: '', districts: { tech: 'T', ops: 'O' } }
  let state = toFallout()
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(76) }, iso(76)) // ~50% recovered (fall at iso71)
  const d = cityData(state, cfg)
  assert.equal(d.era, 'fallout')
  assert.ok(d.recovery > 0.4 && d.recovery < 0.6, `~50%, got ${d.recovery}`)
  assert.ok(d.readout.recovery > 0.4)
  assert.ok(d.readout.population > 0, 'survivors return as the land heals')
  assert.equal(d.theme, 'wasteland')
})
