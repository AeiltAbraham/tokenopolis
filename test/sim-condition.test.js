import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONDITIONS } from '../src/tuning.js'
import { step, conditionIndexFor } from '../src/sim/condition.js'
import { tokensForIndex } from '../src/sim/scale.js'

const DAY = 86_400_000
const base = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (days) => new Date(base + days * DAY).toISOString()
const condIdx = (name) => CONDITIONS.indexOf(name)

const FRESH = {
  builtTokens: 0,
  scaleIndex: 0,
  peakScaleIndex: 0,
  condition: 'Thriving',
  vitality: 1,
  lastMeaningfulBurnAt: iso(0),
  ruinProgress: 0,
  recoveryCredit: 0,
}

// Build up to a Metropolis (index 4 needs tokensForIndex(4) = 125M) over days 1..4, ~35M/day.
function buildToMetropolis() {
  let sim = FRESH
  let built = 0
  for (let day = 1; day <= 4; day++) {
    built += 35_000_000
    sim = step(sim, { builtTokens: built, burn24h: 35_000_000, burn7d: built }, iso(day))
  }
  return { sim, built, lastBurnDay: 4 }
}

test('step is pure/deterministic and returns a well-formed sim block', () => {
  const a = step(FRESH, { builtTokens: 50_000_000, burn24h: 1, burn7d: 1 }, iso(1))
  const b = step(FRESH, { builtTokens: 50_000_000, burn24h: 1, burn7d: 1 }, iso(1))
  assert.deepEqual(a, b)
  assert.ok(a.vitality >= 0 && a.vitality <= 1)
  assert.ok(CONDITIONS.includes(a.condition))
  for (const k of ['builtTokens', 'scaleIndex', 'peakScaleIndex', 'condition', 'vitality', 'lastMeaningfulBurnAt', 'ruinProgress', 'recoveryCredit']) {
    assert.ok(k in a, `sim block missing ${k}`)
  }
})

test('building reaches Metropolis and Thriving', () => {
  const { sim } = buildToMetropolis()
  assert.equal(sim.peakScaleIndex, 4)
  assert.equal(sim.scaleIndex, 4)
  assert.equal(sim.condition, 'Thriving')
})

test('condition: unchanged under 3 quiet days, then monotonically worsens; Ruins after a week+, Buried later', () => {
  const { sim, built } = buildToMetropolis()
  let prevIdx = -1
  const seen = {}
  for (let d = 0; d <= 16; d++) {
    const s = step(sim, { builtTokens: built, burn24h: 0, burn7d: 0 }, iso(4 + d)) // d = days since last burn
    const idx = condIdx(s.condition)
    if (d < 3) assert.equal(s.condition, 'Thriving', `day ${d} quiet should still be Thriving`)
    assert.ok(idx >= prevIdx, `condition must not improve while idle (day ${d})`)
    prevIdx = idx
    seen[s.condition] ??= d
  }
  assert.ok(seen['Ruins'] >= 8, `Ruins should appear only after a week+ (first at day ${seen['Ruins']})`)
  assert.ok(seen['Buried'] > seen['Ruins'], 'Buried must come after Ruins')
})

test('condition degrades BEFORE scale regresses (Ruins reached while scale still at peak)', () => {
  const { sim, built } = buildToMetropolis()
  // At exactly the ruins threshold (daysSince 10): condition is Ruins but no scale loss yet.
  const atRuins = step(sim, { builtTokens: built, burn24h: 0, burn7d: 0 }, iso(4 + 10))
  assert.equal(atRuins.condition, 'Ruins')
  assert.equal(atRuins.ruinProgress, 0)
  assert.equal(atRuins.scaleIndex, atRuins.peakScaleIndex, 'scale must still be at peak when Ruins first hits')
  // One day deeper: scale finally regresses below peak.
  const deeper = step(sim, { builtTokens: built, burn24h: 0, burn7d: 0 }, iso(4 + 11))
  assert.ok(deeper.ruinProgress >= 1, 'scale should regress only after Ruins')
  assert.ok(deeper.scaleIndex < deeper.peakScaleIndex)
})

test('recovery from ruins restores scale to peak using ≤ 1/5 of the original climb cost', () => {
  const { sim, built } = buildToMetropolis() // peak 4, built = 140M
  // Idle 12 days → Ruins + 2 levels collapsed (effective 2).
  const ruined = step(sim, { builtTokens: built, burn24h: 0, burn7d: 0 }, iso(4 + 12))
  assert.equal(ruined.peakScaleIndex, 4)
  assert.equal(ruined.ruinProgress, 2)
  assert.equal(ruined.scaleIndex, 2)

  // Original first-climb cost of the two collapsed levels (index 2→4):
  const originalClimb = tokensForIndex(4) - tokensForIndex(2) // 125M - 5M = 120M
  // Resume burning in 1M chunks (each meaningful); count tokens until effective scale is back to peak.
  let s = ruined
  let recoveryTokens = 0
  let b = built
  let day = 4 + 12
  for (let i = 0; i < 200 && s.scaleIndex < s.peakScaleIndex; i++) {
    b += 1_000_000
    recoveryTokens += 1_000_000
    day += 0.01 // same "recovering" window; keeps daysSinceBurn ~0
    s = step(s, { builtTokens: b, burn24h: 1_000_000, burn7d: 1_000_000 }, iso(day))
  }
  assert.equal(s.scaleIndex, s.peakScaleIndex, 'recovery should reach peak')
  assert.ok(recoveryTokens <= originalClimb / 5, `recovery cost ${recoveryTokens} must be ≤ 1/5 of ${originalClimb}`)
  assert.ok(recoveryTokens < originalClimb / 4, 'recovery must be dramatically cheaper than the first climb')

  // Beyond peak: growth proceeds at the NORMAL rate (index 5 needs tokensForIndex(5) of builtTokens).
  const beyond = step(s, { builtTokens: tokensForIndex(5), burn24h: 1, burn7d: 1 }, iso(day + 0.01))
  assert.equal(beyond.scaleIndex, 5)
  assert.equal(beyond.peakScaleIndex, 5)
})

test('30-day arc: Thriving → decline → Ruins → fast recovery to peak, in order', () => {
  const { sim, built } = buildToMetropolis()
  const transitions = []
  let s = sim
  // Days 5..24 quiet (observe decline).
  for (let d = 5; d <= 24; d++) {
    s = step(s, { builtTokens: built, burn24h: 0, burn7d: 0 }, iso(d))
    if (transitions.at(-1) !== s.condition) transitions.push(s.condition)
  }
  // Recovery burst on day 25.
  const recovered = step(s, { builtTokens: built + 200_000_000, burn24h: 2e8, burn7d: 2e8 }, iso(25))
  // Decline order must be monotonic down the ladder…
  for (let i = 1; i < transitions.length; i++) {
    assert.ok(condIdx(transitions[i]) > condIdx(transitions[i - 1]), `decline must be monotonic: ${transitions.join('→')}`)
  }
  assert.equal(transitions[0], 'Thriving')
  assert.equal(transitions.at(-1), 'Buried')
  // …and the recovery burst snaps condition back up and restores scale to peak.
  assert.ok(condIdx(recovered.condition) < condIdx('Ruins'))
  assert.equal(recovered.scaleIndex, recovered.peakScaleIndex)
})

test('infection: burning clears it, idle worsens it, zero ends the episode', () => {
  const infected = { ...FRESH, builtTokens: 30_000_000, infection: { severity: 0.5, startedAt: iso(0) } }
  const burned = step(infected, { builtTokens: 31_000_000, burn24h: 0, burn7d: 0 }, iso(0.0007))
  assert.ok(burned.infection.severity < 0.5, 'a meaningful burn fights the infection down')
  const idle = step(infected, { builtTokens: 30_000_000, burn24h: 0, burn7d: 0 }, iso(0.04))
  assert.ok(idle.infection.severity > 0.5, 'neglect lets it spread')
  const cleared = step({ ...infected, infection: { severity: 0.1, startedAt: iso(0) } }, { builtTokens: 31_000_000, burn24h: 0, burn7d: 0 }, iso(0.0007))
  assert.equal(cleared.infection.severity, 0)
  assert.equal(cleared.infection.startedAt, null)
})
