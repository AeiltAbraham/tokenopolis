import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PYROMID } from '../src/tuning.js'
import { defaultPyromid, infoLevelFor, loreFor, newlyUnlocked, boostFor, updatePyromid, burn, PYROMID_LORE } from '../src/pyromid.js'
import { advance } from '../src/tick.js'
import { initState, saveState, loadState } from '../src/state.js'
import { cityData } from '../src/artifact.js'
import { runPyromidBurn } from '../service/main.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'tok-pyro-'))
const DAY = 86_400_000
const base = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (d) => new Date(base + d * DAY).toISOString()
const cfg = { cityName: 'X', theme: 'temperate', flag: '', districts: { tech: 'T', ops: 'O' } }

test('catalog + defaults: 7 lore lines ending on the reveal', () => {
  assert.equal(PYROMID_LORE.length, 7)
  assert.deepEqual(defaultPyromid(), { progress: 0, bonus: 0, infoLevel: 1 })
  assert.match(PYROMID_LORE[PYROMID_LORE.length - 1].text, /heart of the AI|dust|simulation/i)
})

test('infoLevel + lore unlock at thresholds', () => {
  assert.equal(infoLevelFor(0), 1)
  assert.equal(infoLevelFor(0.1), 2)
  assert.equal(infoLevelFor(0.5), 4)
  assert.equal(infoLevelFor(1), PYROMID_LORE.length)
  assert.equal(loreFor(1), PYROMID_LORE[0].text)
  assert.equal(loreFor(99), PYROMID_LORE[PYROMID_LORE.length - 1].text) // clamped
  assert.deepEqual(newlyUnlocked(1, 3), [PYROMID_LORE[1].text, PYROMID_LORE[2].text])
  assert.deepEqual(newlyUnlocked(3, 3), [])
})

test('boost scales with build progress', () => {
  assert.deepEqual(boostFor(0), { economyMult: 1, popBonus: 0 })
  const full = boostFor(1)
  assert.ok(full.economyMult > 1 && full.popBonus > 0)
})

test('updatePyromid: progress from treasury, high-water, infoLevel latches', () => {
  const half = updatePyromid(defaultPyromid(), PYROMID.target / 2)
  assert.ok(Math.abs(half.progress - 0.5) < 1e-9)
  assert.equal(half.infoLevel, infoLevelFor(0.5))
  // Treasury craters (the wasteland) → progress does NOT fall back (high-water).
  const held = updatePyromid(half, 0)
  assert.equal(held.progress, half.progress)
  assert.equal(held.infoLevel, half.infoLevel)
  // Completion locks in the final lore.
  const done = updatePyromid(half, PYROMID.target * 2)
  assert.equal(done.progress, 1)
  assert.equal(done.infoLevel, PYROMID_LORE.length)
})

test('burn deposits the click value into the bonus', () => {
  const p = burn(burn(defaultPyromid()))
  assert.equal(p.bonus, 2 * PYROMID.clickValue)
})

test('advance builds the Pyromid from treasury and chronicles the lore reveals', () => {
  let state = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 1 })
  // A giant burn → treasury crosses several Pyromid thresholds in one tick.
  state = advance(state, { lifetimeTotal: 6_000_000_000, burn24h: 6e9, burn7d: 6e9, readAt: iso(1) }, iso(1))
  assert.ok(state.pyromid.progress > 0.5, `built past half, got ${state.pyromid.progress}`)
  assert.ok(state.pyromid.infoLevel >= 4)
  assert.ok(state.history.some((e) => e.type === 'pyromid'), 'lore reveals are chronicled')
})

test('runPyromidBurn: a click adds the deposit, high-waters, and re-renders', () => {
  const dir = tmp()
  let state = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 1 })
  state = advance(state, { lifetimeTotal: 50_000_000, burn24h: 50e6, burn7d: 50e6, readAt: iso(1) }, iso(1))
  saveState(dir, state)
  const before = loadState(dir).pyromid.bonus
  const res = runPyromidBurn({ dir, nowIso: () => iso(1), config: cfg })
  assert.equal(res.ok, true)
  assert.equal(loadState(dir).pyromid.bonus, before + PYROMID.clickValue)
  assert.ok(res.treasury >= PYROMID.clickValue)
})

test('cityData embeds the Pyromid, feeds the landmark, and applies its boost', () => {
  let bare = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 1 })
  bare = advance(bare, { lifetimeTotal: 8_000_000_000, burn24h: 8e9, burn7d: 8e9, readAt: iso(1) }, iso(1))
  const d = cityData(bare, cfg)
  assert.ok(d.pyromid.progress > 0.5)
  assert.equal(d.pyromid.lore, loreFor(bare.pyromid.infoLevel))
  assert.equal(d.pyromid.target, PYROMID.target)
  assert.equal(d.scene.pyromid.progress, bare.pyromid.progress, 'the landmark gets the build progress')
  // The boost lifts the economy over the un-boosted baseline.
  let noPyro = advance(initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 1 }), { lifetimeTotal: 8_000_000_000, burn24h: 8e9, burn7d: 8e9, readAt: iso(1) }, iso(1))
  noPyro = { ...noPyro, pyromid: defaultPyromid() } // same sim, Pyromid not built
  assert.ok(cityData(bare, cfg).readout.economyRating > cityData(noPyro, cfg).readout.economyRating, 'a built Pyromid boosts the economy')
})
