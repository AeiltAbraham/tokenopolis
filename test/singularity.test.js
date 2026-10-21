import { test } from 'node:test'
import assert from 'node:assert/strict'
import { step } from '../src/sim/condition.js'
import { advance } from '../src/tick.js'
import { initState } from '../src/state.js'
import { cityData } from '../src/artifact.js'
import { SINGULARITY } from '../src/tuning.js'

const DAY = 86_400_000
const base = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (d) => new Date(base + d * DAY).toISOString()

// A built-up Metropolis (peak 4) so the raze is visible.
function metropolis() {
  let sim = step({}, { builtTokens: 0, burn24h: 0, burn7d: 0, day: 1 }, iso(0))
  let built = 0
  for (let d = 1; d <= 4; d++) {
    built += 40_000_000
    sim = step(sim, { builtTokens: built, burn24h: 40e6, burn7d: built, day: d }, iso(d))
  }
  return { sim, built }
}

test('era defaults to build; a step with no day stays in build (backward-compatible)', () => {
  const s = step({}, { builtTokens: 50e6, burn24h: 1, burn7d: 1 }, iso(1)) // no day param
  assert.equal(s.era, 'build')
  assert.equal(s.recovery, 0)
  assert.equal(s.singularityAt, null)
})

test('Day 60: build → ascendant — the city flares to its gleaming peak', () => {
  const { sim } = metropolis()
  const asc = step(sim, { builtTokens: sim.builtTokens, burn24h: 0, burn7d: 0, day: SINGULARITY.ascendDay }, iso(60))
  assert.equal(asc.era, 'ascendant')
  assert.equal(asc.condition, 'Thriving')
  assert.equal(asc.vitality, 1)
  assert.equal(asc.ruinProgress, 0)
  assert.equal(asc.scaleIndex, asc.peakScaleIndex, 'ascended to full peak')
  assert.equal(asc.singularityAt, iso(60))
})

test('Day 61: ascendant → fallout — the city is razed to a wasteland', () => {
  const { sim } = metropolis()
  const asc = step(sim, { builtTokens: sim.builtTokens, burn24h: 0, burn7d: 0, day: 60 }, iso(60))
  const fall = step(asc, { builtTokens: asc.builtTokens, burn24h: 0, burn7d: 0, day: 61 }, iso(61))
  assert.equal(fall.era, 'fallout')
  assert.equal(fall.scaleIndex, 0)
  assert.equal(fall.peakScaleIndex, 4, 'the ruined-metropolis bones remain')
  assert.equal(fall.ruinProgress, 4)
  assert.equal(fall.vitality, 0)
  assert.equal(fall.condition, 'Buried')
  assert.equal(fall.recovery, 0)
  assert.equal(fall.singularityAt, iso(60), 'keeps the ascension timestamp through the fall')
})

test('a single tick that jumps past both days goes straight to fallout (catch-up)', () => {
  const { sim } = metropolis()
  const fall = step(sim, { builtTokens: sim.builtTokens, burn24h: 0, burn7d: 0, day: 65 }, iso(65))
  assert.equal(fall.era, 'fallout')
  assert.equal(fall.scaleIndex, 0)
})

test('fallout holds the razed state — burning no longer rebuilds (Phase 4 flips recovery)', () => {
  const { sim } = metropolis()
  let s = step(sim, { builtTokens: sim.builtTokens, burn24h: 0, burn7d: 0, day: 61 }, iso(61))
  s = step(s, { builtTokens: sim.builtTokens + 500e6, burn24h: 500e6, burn7d: 500e6, day: 62 }, iso(62))
  assert.equal(s.era, 'fallout')
  assert.equal(s.scaleIndex, 0, 'burning does not rebuild in fallout')
  assert.equal(s.recovery, 0)
})

test('step is deterministic across the era transition', () => {
  const { sim } = metropolis()
  const a = step(sim, { builtTokens: sim.builtTokens, burn24h: 0, burn7d: 0, day: 61 }, iso(61))
  const b = step(sim, { builtTokens: sim.builtTokens, burn24h: 0, burn7d: 0, day: 61 }, iso(61))
  assert.deepEqual(a, b)
})

// ---- The transition as wired through advance() (chronicle + climax marker) ----

function grown() {
  let state = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 1 })
  return advance(state, { lifetimeTotal: 160e6, burn24h: 40e6, burn7d: 160e6, readAt: iso(4) }, iso(4))
}

test('advance: Day 60 chronicles the Singularity + stamps the ascension climax', () => {
  let state = grown()
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(59) }, iso(59)) // day 60
  assert.equal(state.sim.era, 'ascendant')
  assert.ok(state.history.some((e) => e.type === 'singularity'), 'a Singularity line is chronicled')
  assert.equal(state.climax.phase, 'ascension')
  assert.equal(state.climax.at, iso(59))
})

test('advance: Day 61 chronicles the Downfall + flips to fallout', () => {
  let state = grown()
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(59) }, iso(59)) // day 60
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(60) }, iso(60)) // day 61
  assert.equal(state.sim.era, 'fallout')
  assert.ok(state.history.some((e) => e.type === 'downfall'), 'a Downfall line is chronicled')
  assert.equal(state.climax.phase, 'fall')
})

test('advance: a jump past both days chronicles Singularity AND Downfall, climax = fall', () => {
  let state = grown()
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(70) }, iso(70)) // day 71
  assert.equal(state.sim.era, 'fallout')
  assert.ok(state.history.some((e) => e.type === 'singularity'))
  assert.ok(state.history.some((e) => e.type === 'downfall'))
  assert.equal(state.climax.phase, 'fall')
})

test('on a catch-up jump the climax stays the newest chronicle entry (not buried by the gift backlog)', () => {
  let state = grown()
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(70) }, iso(70)) // day 71: both climaxes + all 59 gifts in one tick
  assert.equal(state.history[0].type, 'downfall', 'the Downfall headlines the chronicle')
  assert.ok(state.history.some((e) => e.type === 'singularity'), 'the Singularity survives the 60-entry cap')
})

test('cityData: era snaps the theme and reframes the fallout readout', () => {
  const cfg = { cityName: 'X', theme: 'coastal', flag: '', districts: { tech: 'T', ops: 'O' } }
  let state = grown()
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(59) }, iso(59)) // ascendant
  const asc = cityData(state, cfg)
  assert.equal(asc.era, 'ascendant')
  assert.equal(asc.theme, 'ascension', 'ascendant snaps to the ascension theme (overriding config)')
  assert.equal(asc.climax.phase, 'ascension')
  state = advance(state, { lifetimeTotal: 160e6, burn24h: 0, burn7d: 0, readAt: iso(60) }, iso(60)) // fallout
  const fall = cityData(state, cfg)
  assert.equal(fall.era, 'fallout')
  assert.equal(fall.theme, 'wasteland', 'fallout snaps to the wasteland theme (overriding config)')
  assert.equal(fall.scene.era, 'fallout')
  assert.equal(fall.readout.population, 0, 'recovery 0 → no survivors yet')
  assert.equal(fall.readout.treasury, 0)
  assert.equal(fall.readout.recovery, 0)
})
