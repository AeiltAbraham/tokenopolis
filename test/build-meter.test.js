// Guards for the linear build meter (the 1B-token / 30-day Singularity). Each is mutation-checked: mutate the
// guarded code, observe the matching guard go RED, revert. A guard never observed to fail is a guard in name only.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProgress, scaleFromBuild } from '../src/sim/scale.js'
import { BUILD } from '../src/tuning.js'
import { step } from '../src/sim/condition.js'
import { advance } from '../src/tick.js'
import { initState } from '../src/state.js'

const DAY = 86_400_000
const base = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (d) => new Date(base + d * DAY).toISOString()

// GUARD — the build is LINEAR: equal progress buys equal scale steps (the fix for "quick build then slowdown").
// Mutant: make scaleFromBuild non-linear (e.g. square the progress) → the equal-steps assertion goes RED.
test('guard — scale climbs linearly with the build meter (equal progress → equal steps)', () => {
  const steps = []
  for (let i = 0; i <= BUILD.topIndex; i++) steps.push(scaleFromBuild(i / BUILD.topIndex).scaleIndex)
  assert.deepEqual(
    steps,
    Array.from({ length: BUILD.topIndex + 1 }, (_, i) => i),
    'each equal slice of progress = exactly one tier (linear)',
  )
  assert.equal(scaleFromBuild(0.5).scaleIndex, Math.round(0.5 * BUILD.topIndex), 'halfway through the meter is halfway up the ladder')
})

// GUARD — the meter is max(tokens/cap, days/cap), capped at 1 (whichever axis is further along).
// Mutant: use min() instead of max(), or drop an axis → one of these cases flips.
test('guard — buildProgress = whichever of tokens or days is further along, capped at 1', () => {
  assert.equal(buildProgress(BUILD.tokenCap, 0), 1, 'the token axis alone can fill the meter')
  assert.equal(buildProgress(0, BUILD.dayCap), 1, 'the day axis alone can fill the meter')
  assert.equal(buildProgress(BUILD.tokenCap / 2, 0), 0.5)
  assert.equal(buildProgress(BUILD.tokenCap * 2, BUILD.dayCap * 2), 1, 'capped at 1')
  assert.ok(buildProgress(BUILD.tokenCap, 0) > buildProgress(BUILD.tokenCap / 2, 0), 'max, not min: a full token axis wins with zero days')
})

// GUARD — the Singularity fires at 1B tokens OR 30 days, WHICHEVER FIRST. Mutant: drop the token axis (or the
// day axis) from the meter → the corresponding ascension stops happening.
test('guard — the Singularity fires on EITHER the token or the day axis (whichever first)', () => {
  const build = step({}, { builtTokens: 100e6, burn24h: 0, burn7d: 0, day: 2 }, iso(1))
  assert.equal(build.era, 'build')
  const byTokens = step(build, { builtTokens: BUILD.tokenCap, burn24h: 0, burn7d: 0, day: 2, cycleStartTokens: 0 }, iso(1))
  assert.equal(byTokens.era, 'ascendant', '1B cycle tokens ascends even on day 2')
  const byTime = step(build, { builtTokens: 100e6, burn24h: 0, burn7d: 0, day: 31, cycleStartTokens: 0 }, iso(30))
  assert.equal(byTime.era, 'ascendant', '30 elapsed days ascends even with few tokens')
  const neither = step(build, { builtTokens: 500e6, burn24h: 0, burn7d: 0, day: 15, cycleStartTokens: 0 }, iso(14))
  assert.equal(neither.era, 'build', 'below both axes → no Singularity')
})

// A heavy burner (> 1B lifetime) taken all the way through a full cycle to rebirth.
function heavyRebirth() {
  let state = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 1 })
  state = advance(state, { lifetimeTotal: 2_000_000_000, burn24h: 2e9, burn7d: 2e9, readAt: iso(1) }, iso(1)) // 2B cycle tokens → ascend
  state = advance(state, { lifetimeTotal: 2_000_000_000, burn24h: 0, burn7d: 0, readAt: iso(2) }, iso(2)) // hold-day → fall
  state = advance(state, { lifetimeTotal: 2_000_000_000, burn24h: 0, burn7d: 0, readAt: iso(12) }, iso(12)) // heal 10 days → rebirth
  return state
}

// GUARD — the per-cycle meter RESETS on rebirth: a heavy burner's accumulated lifetime tokens do NOT instantly
// re-trigger the Singularity. Mutant: don't reset cycleStartTokens on rebirth (tick.js) → the next tick sees
// 2B cumulative tokens ≥ the 1B cap and re-ascends immediately.
test('guard — the per-cycle meter resets on rebirth (a heavy burner does not instantly re-ascend)', () => {
  let state = heavyRebirth()
  assert.equal(state.sim.era, 'build', 'reborn into a fresh build cycle')
  const next = advance(state, { lifetimeTotal: 2_000_000_000, burn24h: 0, burn7d: 0, readAt: iso(14) }, iso(14))
  assert.equal(next.sim.era, 'build', 'the new cycle has its OWN 1B / 30-day budget — 2B cumulative does not re-ascend')
})
