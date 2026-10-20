// Invariant guards — the load-bearing properties of the sim. Each is mutation-checked at this task
// (see tasks.md T-007 outcome): mutate the guarded code, observe the matching guard go RED, revert.
// A guard that has never been observed to fail is a guard in name only.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONDITIONS } from '../src/tuning.js'
import { initState, applyStatsRead } from '../src/state.js'
import { step } from '../src/sim/condition.js'
import { scaleFor, tokensForIndex } from '../src/sim/scale.js'

const DAY = 86_400_000
const base = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (d) => new Date(base + d * DAY).toISOString()
const condIdx = (n) => CONDITIONS.indexOf(n)

// Correct composition: step() must see the PRIOR sim (old builtTokens) + the NEW builtTokens, or it
// can't detect "meaningful burn" and the decay clock never resets. This is the tick contract (T-011).
function buildToMetropolis() {
  let state = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 1 })
  for (let day = 1; day <= 4; day++) {
    const prevSim = state.sim
    const next = applyStatsRead(state, { lifetimeTotal: day * 35_000_000, burn24h: 35e6, burn7d: 35e6, readAt: iso(day) })
    state = { ...next, sim: step(prevSim, { builtTokens: next.sim.builtTokens, burn24h: 35e6, burn7d: 35e6 }, iso(day)) }
  }
  return state // peak 4 (Metropolis), lastMeaningfulBurnAt = day 4
}

// GUARD 1 — era never seeds from history. Mutant: drop the baseline subtraction in src/state.js.
test('guard 1 — era never seeds from history (grow-from-zero)', () => {
  const s = initState({ baselineLifetimeTokens: 50_000_000_000, installedAt: iso(0), citySeed: 1 })
  assert.equal(s.sim.builtTokens, 0)
  const after = applyStatsRead(s, { lifetimeTotal: 50_000_000_000, burn24h: 1, burn7d: 1, readAt: iso(0.1) })
  assert.equal(after.sim.builtTokens, 0, 'no burn since install ⇒ builtTokens 0 despite huge history')
  assert.equal(scaleFor(after.sim.builtTokens).scaleIndex, 0)
})

// GUARD 2 — monotonic while active. Mutant: drop the Math.max clamp in src/state.js.
test('guard 2 — builtTokens & effective scale never decrease while active', () => {
  let state = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 1 })
  const lifetimes = [200e6, 150e6, 500e6, 400e6, 900e6] // deliberately includes regressions
  let prevBuilt = 0
  let prevScale = 0
  let day = 0
  for (const lifetime of lifetimes) {
    day += 0.1 // all within the decay onset (<3 days): active, no decay
    const prevSim = state.sim
    const next = applyStatsRead(state, { lifetimeTotal: lifetime, burn24h: 1e6, burn7d: 1e6, readAt: iso(day) })
    state = { ...next, sim: step(prevSim, { builtTokens: next.sim.builtTokens, burn24h: 1e6, burn7d: 1e6 }, iso(day)) }
    assert.ok(state.sim.builtTokens >= prevBuilt, `builtTokens dropped ${prevBuilt}→${state.sim.builtTokens}`)
    assert.ok(state.sim.scaleIndex >= prevScale, `scale dropped while active ${prevScale}→${state.sim.scaleIndex}`)
    prevBuilt = state.sim.builtTokens
    prevScale = state.sim.scaleIndex
  }
})

// GUARD 3a — scale regresses only once condition is Ruins or worse. Mutant: regress earlier (Declining).
test('guard 3a — scale regresses only when condition is Ruins or worse', () => {
  const built = buildToMetropolis()
  let sawRegression = false
  for (let d = 0; d <= 20; d++) {
    const sim = step(built.sim, { builtTokens: built.sim.builtTokens, burn24h: 0, burn7d: 0 }, iso(4 + d))
    if (sim.ruinProgress > 0) {
      sawRegression = true
      assert.ok(condIdx(sim.condition) >= condIdx('Ruins'), `scale regressed while condition=${sim.condition} (day ${d})`)
    }
  }
  assert.ok(sawRegression, 'scenario must actually reach regression')
})

// GUARD 3b — recovery from ruins costs ≤ 1/5 of the original climb. Mutant: drop the recovery divisor.
test('guard 3b — recovery from ruins costs ≤ 1/5 of the original climb', () => {
  const built = buildToMetropolis()
  const ruined = step(built.sim, { builtTokens: built.sim.builtTokens, burn24h: 0, burn7d: 0 }, iso(4 + 12))
  assert.ok(ruined.ruinProgress >= 1 && ruined.scaleIndex < ruined.peakScaleIndex, 'precondition: must be regressed')
  const originalClimb = tokensForIndex(ruined.peakScaleIndex) - tokensForIndex(ruined.scaleIndex)
  let s = ruined
  let b = built.sim.builtTokens
  let spent = 0
  let t = 4 + 12
  for (let i = 0; i < 1000 && s.scaleIndex < s.peakScaleIndex; i++) {
    b += 1_000_000
    spent += 1_000_000
    t += 0.001
    s = step(s, { builtTokens: b, burn24h: 1e6, burn7d: 1e6 }, iso(t))
  }
  assert.equal(s.scaleIndex, s.peakScaleIndex, 'recovery must reach peak')
  assert.ok(spent <= originalClimb / 5, `recovery ${spent} must be ≤ 1/5 of ${originalClimb}`)
})
