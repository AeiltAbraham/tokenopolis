import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureState } from '../service/main.js'
import { loadState } from '../src/state.js'
import { readClaudeDelta } from '../src/claude-stats.js'

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
  assert.equal(ensureState(dir, () => ({ lifetimeTotal: 18_800_000, burn24h: 1, burn7d: 1, readAt: 'r' }), now, config, tmp()), true)
  const s = loadState(dir)
  assert.equal(s.install.baselineLifetimeTokens, 18_800_000)
  assert.equal(s.sim.builtTokens, 0, 'Hamlet — the machine history is NOT seeded')
  assert.ok(existsSync(join(dir, 'city.html')))
})

test('null first read then success: baseline comes from the SUCCESS, never 0', () => {
  const dir = tmp()
  assert.equal(ensureState(dir, () => null, now, config), false)
  assert.equal(ensureState(dir, () => ({ lifetimeTotal: 9_000_000, burn24h: 1, burn7d: 1, readAt: 'r' }), now, config, tmp()), true)
  assert.equal(loadState(dir).install.baselineLifetimeTokens, 9_000_000)
})

test('upgrade path: existing install gets Claude offsets initialized — history is NOT counted', () => {
  const dir = tmp()
  saveStateLike(dir) // an existing install with NO claude-offsets.json
  const cdir = tmp()
  const proj = join(cdir, 'p')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'h.jsonl'), JSON.stringify({ message: { usage: { input_tokens: 9_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n')
  assert.equal(existsSync(join(dir, 'claude-offsets.json')), false)
  ensureState(dir, () => ({ lifetimeTotal: 5_000_000, burn24h: 0, burn7d: 0, readAt: 'r' }), now, config, cdir)
  assert.ok(existsSync(join(dir, 'claude-offsets.json')), 'offsets initialized on upgrade')
  assert.equal(readClaudeDelta(join(dir, 'claude-offsets.json'), cdir), 0, '2GB of history must not be counted')
})

function saveStateLike(dir) {
  // minimal existing state.json (as a pre-combined-burn install would have)
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    schemaVersion: 1,
    install: { installedAt: now(), baselineLifetimeTokens: 5_000_000 },
    stats: { lastReadAt: null, lastLifetimeTokens: 5_000_000, burn24h: 0, burn7d: 0 },
    sim: { builtTokens: 0, scaleIndex: 0, peakScaleIndex: 0, condition: 'Thriving', vitality: 1, lastMeaningfulBurnAt: now(), ruinProgress: 0, recoveryCredit: 0 },
    citySeed: 1,
    render: { lastRenderedAt: null, artifactFile: 'city.html' },
  }))
}
