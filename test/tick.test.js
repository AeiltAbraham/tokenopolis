import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { advance, tick } from '../src/tick.js'
import { initState, saveState, loadState } from '../src/state.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'tokenopolis-'))
const DAY = 86_400_000
const base = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (d) => new Date(base + d * DAY).toISOString()
const config = { cityName: 'Test', theme: 'temperate' }

test('advance keeps an actively-burning city OUT of decay (tick composition contract)', () => {
  // Regression guard for the T-007 catch: step() must see the prior sim + the new builtTokens.
  let state = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 1 })
  let lifetime = 0
  for (let d = 1; d <= 8; d++) {
    lifetime += 50_000_000
    state = advance(state, { lifetimeTotal: lifetime, burn24h: 50e6, burn7d: 50e6, readAt: iso(d) }, iso(d))
    assert.equal(state.sim.condition, 'Thriving', `day ${d} actively burning must stay Thriving`)
  }
  assert.ok(state.sim.builtTokens > 0)
})

test('tick change path: growing stats → state.json + city.html written, changed', () => {
  const dir = tmp()
  saveState(dir, initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 5 }))
  const readStats = () => ({ lifetimeTotal: 200_000_000, burn24h: 40e6, burn7d: 200e6, readAt: iso(0.01) })
  const res = tick({ dir, readStats, config, nowIso: () => iso(0.01), readClaude: () => 0 }, iso(0.01))
  assert.equal(res.changed, true)
  assert.ok(existsSync(join(dir, 'state.json')) && existsSync(join(dir, 'city.html')))
  assert.equal(loadState(dir).sim.builtTokens, 200_000_000)
})

test('tick no-change path: identical stats & time → no change, no re-render', () => {
  const dir = tmp()
  const readStats = () => ({ lifetimeTotal: 1000, burn24h: 0, burn7d: 0, readAt: iso(0) })
  // Settle the state first (the install-day gift is claimed here), so the probe tick below — identical
  // stats, same instant, no new day — is a genuine no-op and the no-render invariant still holds.
  const settled = advance(initState({ baselineLifetimeTokens: 1000, installedAt: iso(0), citySeed: 5 }), readStats(), iso(0))
  saveState(dir, settled)
  const res = tick({ dir, readStats, config, nowIso: () => iso(0), readClaude: () => 0 }, iso(0))
  assert.equal(res.changed, false)
  assert.equal(existsSync(join(dir, 'city.html')), false) // nothing rendered on a no-op tick
})

test('tick stats-null path: holds tokens, advances decay, logs', () => {
  const dir = tmp()
  let s = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 5 })
  s = advance(s, { lifetimeTotal: 140_000_000, burn24h: 40e6, burn7d: 140e6, readAt: iso(1) }, iso(1))
  saveState(dir, s)
  const res = tick({ dir, readStats: () => null, config, nowIso: () => iso(13), readClaude: () => 0 }, iso(13)) // 12 quiet days later
  assert.equal(res.changed, true) // condition decayed with time
  assert.equal(res.state.sim.builtTokens, s.sim.builtTokens) // tokens held
  assert.notEqual(res.state.sim.condition, 'Thriving')
  assert.match(readFileSync(join(dir, 'plugin.log'), 'utf8'), /stats unavailable/)
})

test('daily gifts: advance claims one gift per day since install, with a chronicle line each', () => {
  let state = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 1 })
  assert.equal(state.gifts.claimedThroughDay, 0)
  // Day 1 (install day): the first gift lands.
  state = advance(state, { lifetimeTotal: 10e6, burn24h: 10e6, burn7d: 10e6, readAt: iso(0) }, iso(0))
  assert.equal(state.gifts.claimedThroughDay, 1)
  assert.equal(Object.keys(state.gifts.unlocked).length, 1)
  assert.ok(state.history.some((e) => e.type === 'gift' && /Day 1:/.test(e.label)), 'a gift chronicle line is recorded')
  // Three days on → gifts 2,3,4 claimed (catches up), last carries a claim timestamp.
  state = advance(state, { lifetimeTotal: 20e6, burn24h: 10e6, burn7d: 20e6, readAt: iso(3) }, iso(3))
  assert.equal(state.gifts.claimedThroughDay, 4)
  assert.equal(Object.keys(state.gifts.unlocked).length, 4)
  assert.equal(state.gifts.last.day, 4)
  assert.equal(state.gifts.last.at, iso(3))
})

test('daily gifts: the full catalog is claimed by day 59 and never overruns into Day 60', () => {
  let state = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 1 })
  state = advance(state, { lifetimeTotal: 10e6, burn24h: 10e6, burn7d: 10e6, readAt: iso(500) }, iso(500))
  assert.equal(state.gifts.claimedThroughDay, 59, 'clamped to the 59-gift catalog (Day 60 is the arc)')
  assert.equal(Object.keys(state.gifts.unlocked).length, 59)
})

test('Claude burn counts toward builtTokens even when cornercase is flat (combined sources)', () => {
  const dir = tmp()
  saveState(dir, initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 5 }))
  const readStats = () => ({ lifetimeTotal: 0, burn24h: 0, burn7d: 0, readAt: iso(0.01) }) // no cornercase burn
  const res = tick({ dir, readStats, config, nowIso: () => iso(0.01), readClaude: () => 30_000_000 }, iso(0.01))
  assert.equal(res.changed, true)
  assert.equal(loadState(dir).sim.builtTokens, 30_000_000) // grew from Claude alone
  assert.equal(loadState(dir).claude.cumulativeTokens, 30_000_000)
})
