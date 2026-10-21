import { test } from 'node:test'
import assert from 'node:assert/strict'
import { timeOfDay, seasonOf, drawDayNight, drawWeather } from '../src/render/ambient.js'

// A recording ctx stub modeled on test/artifact.test.js: every method is a no-op that counts as a
// draw; createLinearGradient returns a stub gradient; `canvas` reports a size.
function makeCtx() {
  const calls = { paints: 0, total: 0 }
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'canvas') return { width: 960, height: 640 }
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return () => ({ addColorStop() {} })
        }
        return (..._args) => {
          calls.total++
          if (prop === 'fillRect' || prop === 'fill' || prop === 'stroke') calls.paints++
        }
      },
      set() {
        return true
      },
    },
  )
  return { ctx, calls }
}

const at = (iso) => Date.parse(iso)

test('timeOfDay: 0 = midnight, 0.5 = noon; quarter marks; always in [0,1)', () => {
  assert.equal(timeOfDay(0), 0) // epoch is midnight UTC
  assert.equal(timeOfDay(at('2026-06-15T00:00:00.000Z')), 0)
  assert.equal(timeOfDay(at('2026-06-15T06:00:00.000Z')), 0.25)
  assert.equal(timeOfDay(at('2026-06-15T12:00:00.000Z')), 0.5)
  assert.equal(timeOfDay(at('2026-06-15T18:00:00.000Z')), 0.75)

  for (const iso of ['1999-12-31T23:59:59.000Z', '2026-10-21T09:13:27.000Z', '2030-02-28T14:00:00.000Z']) {
    const v = timeOfDay(at(iso))
    assert.ok(v >= 0 && v < 1, `${iso} → ${v} must be in [0,1)`)
  }
  // Negative timestamps (before epoch) normalize cleanly.
  const neg = timeOfDay(-6 * 60 * 60 * 1000) // 6h before epoch = 18:00 the prior day
  assert.ok(neg >= 0 && neg < 1)
  assert.equal(neg, 0.75)
})

test('seasonOf: northern-hemisphere season by month, each timestamp maps correctly', () => {
  assert.equal(seasonOf(at('2026-01-15T00:00:00.000Z')), 'winter')
  assert.equal(seasonOf(at('2026-02-15T00:00:00.000Z')), 'winter')
  assert.equal(seasonOf(at('2026-12-15T00:00:00.000Z')), 'winter')
  assert.equal(seasonOf(at('2026-03-15T00:00:00.000Z')), 'spring')
  assert.equal(seasonOf(at('2026-05-15T00:00:00.000Z')), 'spring')
  assert.equal(seasonOf(at('2026-06-15T00:00:00.000Z')), 'summer')
  assert.equal(seasonOf(at('2026-08-15T00:00:00.000Z')), 'summer')
  assert.equal(seasonOf(at('2026-09-15T00:00:00.000Z')), 'autumn')
  assert.equal(seasonOf(at('2026-10-21T00:00:00.000Z')), 'autumn')
  assert.equal(seasonOf(at('2026-11-15T00:00:00.000Z')), 'autumn')
})

test('drawDayNight: does not throw and paints a full-canvas overlay at every phase', () => {
  for (const tod of [0, 0.25, 0.5, 0.75, 0.95, 1, -0.1]) {
    const { ctx, calls } = makeCtx()
    assert.doesNotThrow(() => drawDayNight(ctx, 960, 640, tod))
    assert.ok(calls.paints > 0, `tod=${tod} should issue at least one paint`)
  }
})

test('drawWeather: each season (and an unknown one) draws without throwing and paints something', () => {
  for (const season of ['winter', 'autumn', 'spring', 'summer', 'mystery']) {
    const { ctx, calls } = makeCtx()
    assert.doesNotThrow(() => drawWeather(ctx, 960, 640, season, 42))
    assert.ok(calls.paints > 0, `season=${season} should issue at least one paint`)
  }
})

test('drawWeather is deterministic: same ctx calls for the same (season, tick)', () => {
  const run = () => {
    const { ctx, calls } = makeCtx()
    drawWeather(ctx, 960, 640, 'winter', 7)
    return calls.total
  }
  assert.equal(run(), run(), 'constant-seeded PRNG → identical draw-call count every frame')
})
