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

test('applyStatsRead: builtTokens = lifetime − baseline, clamped monotonic', () => {
  const s0 = initState({ baselineLifetimeTokens: 1_000_000, installedAt: '2026-10-19T00:00:00.000Z', citySeed: 1 })
  const s1 = applyStatsRead(s0, { lifetimeTotal: 1_500_000, burn24h: 10, burn7d: 20, readAt: 't1' })
  assert.equal(s1.sim.builtTokens, 500_000)
  assert.equal(s1.stats.lastLifetimeTokens, 1_500_000)
  // A regressed lifetime (stats hiccup) must NOT shrink builtTokens.
  const s2 = applyStatsRead(s1, { lifetimeTotal: 1_100_000, burn24h: 0, burn7d: 0, readAt: 't2' })
  assert.equal(s2.sim.builtTokens, 500_000)
  // Growth resumes.
  const s3 = applyStatsRead(s2, { lifetimeTotal: 3_000_000, burn24h: 0, burn7d: 0, readAt: 't3' })
  assert.equal(s3.sim.builtTokens, 2_000_000)
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
