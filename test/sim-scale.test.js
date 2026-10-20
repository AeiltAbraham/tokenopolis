import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCALE_NAMES } from '../src/tuning.js'
import { scaleFor, tokensForIndex, scaleName, undergroundTiers } from '../src/sim/scale.js'
import { economyFor } from '../src/sim/economy.js'

test('index 0 at 0 tokens is Hamlet with no underground', () => {
  assert.deepEqual(scaleFor(0), { scaleIndex: 0, scaleName: 'Hamlet', undergroundTiers: 0 })
})

test('thresholds are front-loaded: the cost of one step strictly grows', () => {
  let prevStep = -1
  for (let n = 1; n <= 12; n++) {
    assert.ok(tokensForIndex(n) > tokensForIndex(n - 1), `tokensForIndex must increase at n=${n}`)
    const step = tokensForIndex(n + 1) - tokensForIndex(n)
    assert.ok(step > prevStep, `step cost must strictly grow at n=${n} (front-loaded)`)
    prevStep = step
  }
})

test('equal token increments buy strictly fewer scale levels as the city grows', () => {
  const inc = tokensForIndex(3) // a fixed, generous budget
  const early = scaleFor(inc).scaleIndex - scaleFor(0).scaleIndex
  const later = scaleFor(tokensForIndex(8) + inc).scaleIndex - scaleFor(tokensForIndex(8)).scaleIndex
  assert.ok(early > later, `front-loaded: early gain ${early} should exceed later gain ${later}`)
})

test('named ladder Hamlet→Megastructure maps exactly', () => {
  for (let i = 0; i < SCALE_NAMES.length; i++) {
    const s = scaleFor(tokensForIndex(i))
    assert.equal(s.scaleIndex, i)
    assert.equal(s.scaleName, SCALE_NAMES[i])
  }
})

test('procedural names past the ladder, with no upper bound', () => {
  assert.equal(scaleName(8), 'Megastructure 2')
  assert.equal(scaleName(9), 'Megastructure 3')
  const at20 = scaleFor(tokensForIndex(20))
  assert.equal(at20.scaleIndex, 20)
  assert.equal(at20.scaleName, 'Megastructure 14')
  assert.equal(scaleFor(tokensForIndex(50)).scaleIndex, 50) // no top
})

test('underground opens at Metropolis (index 4) and grows thereafter', () => {
  assert.equal(undergroundTiers(3), 0)
  assert.equal(undergroundTiers(4), 1)
  assert.ok(undergroundTiers(6) > undergroundTiers(5))
  assert.equal(scaleFor(tokensForIndex(3)).undergroundTiers, 0)
  assert.equal(scaleFor(tokensForIndex(4)).undergroundTiers, 1)
})

test('economy strictly increases in builtTokens at fixed vitality', () => {
  const levels = [0, 2_000_000, 50_000_000, 2_000_000_000]
  for (const v of [0, 0.5, 1]) {
    for (let i = 1; i < levels.length; i++) {
      const lo = economyFor(levels[i - 1], v)
      const hi = economyFor(levels[i], v)
      assert.ok(hi.population > lo.population, `population must rise with burn (v=${v})`)
      assert.ok(hi.treasury > lo.treasury, `treasury must rise with burn (v=${v})`)
      assert.ok(hi.economyRating > lo.economyRating, `rating must rise with burn (v=${v})`)
    }
  }
})

test('economy strictly increases in vitality at fixed scale', () => {
  for (const t of [0, 50_000_000, 2_000_000_000]) {
    const lo = economyFor(t, 0.2)
    const hi = economyFor(t, 0.9)
    assert.ok(hi.population > lo.population, `population must rise with vitality (t=${t})`)
    assert.ok(hi.treasury > lo.treasury, `treasury must rise with vitality (t=${t})`)
    assert.ok(hi.economyRating > lo.economyRating, `rating must rise with vitality (t=${t})`)
  }
})

test('pure and deterministic: same inputs → deep-equal outputs', () => {
  assert.deepEqual(scaleFor(123_456_789), scaleFor(123_456_789))
  assert.deepEqual(economyFor(123_456_789, 0.42), economyFor(123_456_789, 0.42))
})
