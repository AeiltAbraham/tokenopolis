import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ACTS,
  BOON_ANIMS,
  DISASTER_ANIMS,
  COOLDOWN_MS,
  canAct,
  msUntilNextAct,
  drawAct,
  applyAct,
  performAct,
} from '../src/acts.js'
import { effectiveBuilt, step } from '../src/sim/condition.js'
import { economyFor } from '../src/sim/economy.js'
import { initState, loadState, saveState } from '../src/state.js'
import { runRandomAct } from '../bin/random-act.js'
import { DEFAULT_CONFIG } from '../src/config.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'tokenopolis-acts-'))
const FIXED = '2026-10-20T12:00:00.000Z'
// A real City (index 3), derived through step() so scale/peak match the ladder for 30M tokens.
const cityState = () => {
  const s = initState({ baselineLifetimeTokens: 0, installedAt: FIXED, citySeed: 7 })
  const sim = step(s.sim, { builtTokens: 30_000_000, burn24h: 0, burn7d: 0 }, FIXED)
  return { ...s, sim, stats: { ...s.stats, burn24h: 0, burn7d: 0 } }
}

test('catalog: exactly 50 well-formed acts, unique ids, sign matches kind', () => {
  assert.equal(ACTS.length, 50)
  assert.equal(new Set(ACTS.map((a) => a.id)).size, 50, 'ids must be unique')
  const boons = ACTS.filter((a) => a.kind === 'boon')
  const disasters = ACTS.filter((a) => a.kind === 'disaster')
  assert.ok(boons.length > 0 && disasters.length > 0, 'both kinds present')
  for (const a of ACTS) {
    assert.ok(a.id && a.name && a.blurb, `${a.id}: name/blurb required`)
    assert.ok(a.kind === 'boon' || a.kind === 'disaster', `${a.id}: kind`)
    if (a.kind === 'boon') {
      assert.ok(a.mag > 0, `${a.id}: boon mag must be positive`)
      assert.ok(BOON_ANIMS.includes(a.anim), `${a.id}: boon anim "${a.anim}" must be known`)
    } else {
      assert.ok(a.mag < 0, `${a.id}: disaster mag must be negative`)
      assert.ok(DISASTER_ANIMS.includes(a.anim), `${a.id}: disaster anim "${a.anim}" must be known`)
    }
  }
})

test('deck draws without replacement: all 50 occur once before any repeat, then it resets', () => {
  // rng → 0 always picks the first still-unused act, so the order is deterministic (ACTS order).
  const rng = () => 0
  let used = []
  const drawn = []
  for (let i = 0; i < 50; i++) {
    const r = drawAct(used, rng)
    drawn.push(r.act.id)
    used = r.usedIds
  }
  assert.equal(new Set(drawn).size, 50, 'every act occurs exactly once across a full deck')
  assert.equal(used.length, 50, 'all 50 marked used at deck end')

  const reset = drawAct(used, rng) // 51st draw: deck exhausted → reshuffle
  assert.equal(reset.usedIds.length, 1, 'deck resets to a single used id')
  assert.equal(reset.act.id, ACTS[0].id)
})

test('applyAct: a boon grows the city & treasury; a disaster shrinks them; never below empty', () => {
  const s = cityState()
  const before = economyFor(effectiveBuilt(s.sim), s.sim.vitality).treasury

  const boon = ACTS.find((a) => a.kind === 'boon')
  const up = applyAct(s, boon, [boon.id], FIXED)
  assert.ok(up.sim.actTokens > 0, 'boon raises the lever')
  assert.ok(up.sim.scaleIndex >= s.sim.scaleIndex, 'boon never shrinks scale')
  assert.ok(economyFor(effectiveBuilt(up.sim), up.sim.vitality).treasury > before, 'boon raises treasury')
  assert.equal(up.acts.last.kind, 'boon')
  assert.equal(up.acts.last.at, FIXED)
  assert.ok(up.acts.last.delta > 0)

  const disaster = ACTS.find((a) => a.kind === 'disaster')
  const down = applyAct(s, disaster, [disaster.id], FIXED)
  assert.ok(down.sim.actTokens < 0, 'disaster lowers the lever')
  assert.ok(down.sim.scaleIndex <= s.sim.scaleIndex, 'disaster never grows scale')
  assert.ok(economyFor(effectiveBuilt(down.sim), down.sim.vitality).treasury < before, 'disaster drops treasury')
  assert.ok(down.acts.last.delta < 0)
})

test('applyAct floor: the worst disaster on a tiny city never pushes effective below zero', () => {
  const s = initState({ baselineLifetimeTokens: 0, installedAt: FIXED, citySeed: 1 })
  const tiny = { ...s, sim: { ...s.sim, builtTokens: 50_000 } }
  const worst = ACTS.reduce((m, a) => (a.mag < m.mag ? a : m))
  const after = applyAct(tiny, worst, [worst.id], FIXED)
  assert.ok(effectiveBuilt(after.sim) >= 0, 'effective size floored at empty lot')
  assert.equal(after.sim.scaleIndex, 0)
})

test('cooldown: one act per hour', () => {
  const t0 = Date.parse(FIXED)
  assert.equal(canAct({ lastActAt: null }, t0), true, 'never acted → allowed')
  assert.equal(canAct({ lastActAt: FIXED }, t0), false, 'just acted → blocked')
  assert.equal(canAct({ lastActAt: FIXED }, t0 + COOLDOWN_MS), true, 'an hour later → allowed')
  assert.ok(msUntilNextAct({ lastActAt: FIXED }, t0) <= COOLDOWN_MS)
  assert.equal(msUntilNextAct({ lastActAt: FIXED }, t0 + COOLDOWN_MS), 0)
})

test('performAct is pure composition of draw + apply (does not reset the decay clock)', () => {
  const s = cityState()
  const out = performAct(s, FIXED, () => 0)
  assert.equal(out.acts.usedIds.length, 1)
  assert.equal(out.acts.lastActAt, FIXED)
  assert.equal(out.sim.builtTokens, s.sim.builtTokens, 'an act is not burn — builtTokens unchanged')
  assert.equal(out.sim.lastMeaningfulBurnAt, s.sim.lastMeaningfulBurnAt, 'decay clock untouched')
})

test('runRandomAct happy path: rolls, re-renders, opens, stamps cooldown', () => {
  const dir = tmp()
  saveState(dir, cityState())
  let opened = null
  const res = runRandomAct({ dir, nowIso: () => FIXED, rng: () => 0, open: (d) => (opened = d), config: DEFAULT_CONFIG })
  assert.equal(res.ok, true)
  assert.equal(opened, dir, 'the city is opened')
  const saved = loadState(dir)
  assert.equal(saved.acts.lastActAt, FIXED, 'cooldown stamped')
  assert.ok(saved.acts.last, 'occurrence recorded')
  assert.notEqual(saved.sim.actTokens, 0, 'the lever moved')
  assert.equal(saved.render.lastRenderedAt, FIXED, 'render stamped fresh so the artifact animates it')
})

test('runRandomAct on cooldown: no-op that reports the wait; state unchanged', () => {
  const dir = tmp()
  const s = { ...cityState(), acts: { usedIds: ['grand-opening'], lastActAt: FIXED, last: null } }
  saveState(dir, s)
  const soon = new Date(Date.parse(FIXED) + 30 * 60 * 1000).toISOString() // 30 min later
  let opened = false
  const res = runRandomAct({ dir, nowIso: () => soon, rng: () => 0, open: () => (opened = true), config: DEFAULT_CONFIG })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'cooldown')
  assert.ok(res.minutesLeft > 0 && res.minutesLeft <= 30)
  assert.equal(opened, true, 'cooldown still opens the city so the countdown button is visible')
  assert.deepEqual(loadState(dir).acts, s.acts, 'state untouched on cooldown')
})

test('runRandomAct with no city yet: reports and does nothing', () => {
  const res = runRandomAct({ dir: tmp(), nowIso: () => FIXED, open: () => {}, config: DEFAULT_CONFIG })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'no-state')
})
