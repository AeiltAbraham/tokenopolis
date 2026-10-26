import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initState, loadState, saveState, applyStatsRead, logLine, SCHEMA_VERSION } from '../src/state.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'tokenopolis-'))

test('first run: no state.json → loadState null; initState baselines at install, builtTokens 0', () => {
  const dir = tmp()
  assert.equal(loadState(dir), null)
  const s = initState({ baselineLifetimeTokens: 9_000_000, installedAt: '2026-10-19T00:00:00.000Z', citySeed: 42 })
  assert.equal(s.schemaVersion, SCHEMA_VERSION)
  assert.equal(s.sim.builtTokens, 0) // grow-from-zero: history is NOT seeded
  assert.equal(s.install.baselineLifetimeTokens, 9_000_000)
  assert.equal(s.citySeed, 42)
  assert.equal(s.sim.lastMeaningfulBurnAt, '2026-10-19T00:00:00.000Z')
})

test('save/load round-trips the full shape', () => {
  const dir = tmp()
  const s = initState({ baselineLifetimeTokens: 1000, installedAt: '2026-10-19T00:00:00.000Z', citySeed: 7 })
  saveState(dir, s)
  assert.deepEqual(loadState(dir), s)
})

test('applyStatsRead: builtTokens grows by the lifetime\'s rise since the last read, never shrinks', () => {
  const s0 = initState({ baselineLifetimeTokens: 1_000_000, installedAt: '2026-10-19T00:00:00.000Z', citySeed: 1 })
  const s1 = applyStatsRead(s0, { lifetimeTotal: 1_500_000, burn24h: 10, burn7d: 20, readAt: 't1' })
  assert.equal(s1.sim.builtTokens, 500_000)
  assert.equal(s1.stats.lastLifetimeTokens, 1_500_000)
  // A regressed lifetime (stats hiccup) must NOT shrink builtTokens.
  const s2 = applyStatsRead(s1, { lifetimeTotal: 1_100_000, burn24h: 0, burn7d: 0, readAt: 't2' })
  assert.equal(s2.sim.builtTokens, 500_000)
  // Growth resumes from the regressed value: what was burned since that read counts.
  const s3 = applyStatsRead(s2, { lifetimeTotal: 3_000_000, burn24h: 0, burn7d: 0, readAt: 't3' })
  assert.equal(s3.sim.builtTokens, 2_400_000)
})

test('applyStatsRead(null): sim and stats blocks unchanged (hold last-known)', () => {
  const seeded = applyStatsRead(
    initState({ baselineLifetimeTokens: 1, installedAt: 'x', citySeed: 1 }),
    { lifetimeTotal: 100, burn24h: 1, burn7d: 1, readAt: 'r' },
  )
  const held = applyStatsRead(seeded, null)
  assert.deepEqual(held.sim, seeded.sim)
  assert.deepEqual(held.stats, seeded.stats)
})

test('corrupt state.json: backed up aside, treated as first run, logged', () => {
  const dir = tmp()
  writeFileSync(join(dir, 'state.json'), '{ not valid json ')
  assert.equal(loadState(dir, () => '2026-10-19T00:00:00.000Z'), null)
  assert.ok(readdirSync(dir).some((f) => f.startsWith('state.json.corrupt-')), 'corrupt backup must exist')
  assert.ok(existsSync(join(dir, 'plugin.log')))
  assert.match(readFileSync(join(dir, 'plugin.log'), 'utf8'), /unparseable/)
})

test('logLine appends timestamped lines and never throws', () => {
  const dir = tmp()
  logLine(dir, 'hello', () => '2026-10-19T00:00:00.000Z')
  assert.match(readFileSync(join(dir, 'plugin.log'), 'utf8'), /2026-10-19T00:00:00\.000Z hello/)
})

test('applyStatsRead: a lifetime that changes scale (cache reads dropped) keeps growing the city', () => {
  // A 0.1.0 install: baseline and builtTokens were taken while lifetime still counted cache reads.
  const old = initState({ baselineLifetimeTokens: 4_306_093_697, installedAt: '2026-10-20T11:55:56.848Z', citySeed: 1 })
  const before = { ...old, sim: { ...old.sim, builtTokens: 385_556_438 }, stats: { ...old.stats, lastLifetimeTokens: 188_571_747 } }
  // From here lifetime excludes cache reads, so it sits far below the baseline but still grows.
  const after = applyStatsRead(before, { lifetimeTotal: 249_848_985, burn24h: 0, burn7d: 0, readAt: 't1' })
  assert.equal(after.sim.builtTokens, 385_556_438 + (249_848_985 - 188_571_747))
})

test('applyStatsRead: the read that switches metric adds nothing, and growth resumes after it', () => {
  const s0 = initState({ baselineLifetimeTokens: 1_000_000, installedAt: 'x', citySeed: 1 })
  const s1 = applyStatsRead(s0, { lifetimeTotal: 5_000_000, burn24h: 0, burn7d: 0, readAt: 't1' })
  assert.equal(s1.sim.builtTokens, 4_000_000)
  const switched = applyStatsRead(s1, { lifetimeTotal: 300_000, burn24h: 0, burn7d: 0, readAt: 't2' })
  assert.equal(switched.sim.builtTokens, 4_000_000)
  const grown = applyStatsRead(switched, { lifetimeTotal: 800_000, burn24h: 0, burn7d: 0, readAt: 't3' })
  assert.equal(grown.sim.builtTokens, 4_500_000)
})
