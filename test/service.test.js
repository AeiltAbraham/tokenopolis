import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureState } from '../service/main.js'
import { loadState } from '../src/state.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'tokenopolis-'))
const config = { cityName: 'Test', theme: 'temperate' }
const now = () => '2026-10-20T00:00:00.000Z'

// Regression guard for the review finding: a null first stats read must NOT fabricate baseline 0.
test('ensureState DEFERS when the first stats read fails — no baseline-0 state is created', () => {
  const dir = tmp()
  assert.equal(ensureState(dir, () => null, now, config), false)
  assert.equal(existsSync(join(dir, 'state.json')), false, 'no state persisted on a failed first read')
  assert.match(readFileSync(join(dir, 'plugin.log'), 'utf8'), /deferring baseline/)
})

test('ensureState captures the real baseline on a successful read (grow-from-zero)', () => {
  const dir = tmp()
  assert.equal(ensureState(dir, () => ({ lifetimeTotal: 18_800_000, burn24h: 1, burn7d: 1, readAt: 'r' }), now, config), true)
  const s = loadState(dir)
  assert.equal(s.install.baselineLifetimeTokens, 18_800_000)
  assert.equal(s.sim.builtTokens, 0, 'Hamlet — the machine history is NOT seeded')
  assert.ok(existsSync(join(dir, 'city.html')))
})

test('null first read then success: baseline comes from the SUCCESS, never 0', () => {
  const dir = tmp()
  assert.equal(ensureState(dir, () => null, now, config), false)
  assert.equal(ensureState(dir, () => ({ lifetimeTotal: 9_000_000, burn24h: 1, burn7d: 1, readAt: 'r' }), now, config), true)
  assert.equal(loadState(dir).install.baselineLifetimeTokens, 9_000_000)
})
