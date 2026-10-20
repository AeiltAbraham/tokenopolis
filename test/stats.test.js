import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readStats } from '../src/stats.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(join(here, 'fixtures', 'stats.live.json'), 'utf8')
const fixtureExec = () => fixture
const FIXED = '2026-10-19T12:00:00.000Z'
const at = () => FIXED

// Hand-computed from the fixture (in + out + cache_write per window — cache_read is NOT counted):
//   total: 5000 + 120000 + 250000 = 375_000
//   24h:   1000 +  30000 +  60000 =  91_000
//   7d:    3000 +  90000 + 180000 = 273_000
test('normalizes the fixture to the exact expected burns (cache_read excluded)', () => {
  assert.deepEqual(readStats(fixtureExec, at), {
    lifetimeTotal: 375_000,
    burn24h: 91_000,
    burn7d: 273_000,
    readAt: FIXED,
  })
})

test('output exposes only normalized keys — no raw CLI field names leak', () => {
  const out = readStats(fixtureExec, at)
  assert.deepEqual(Object.keys(out).sort(), ['burn24h', 'burn7d', 'lifetimeTotal', 'readAt'])
})

test('spawn failure → null, never throws', () => {
  const throwingExec = () => {
    throw new Error('cornercase not found')
  }
  assert.equal(readStats(throwingExec, at), null)
})

test('unparseable output → null', () => {
  assert.equal(readStats(() => 'not json at all', at), null)
})

test('missing contract field → null', () => {
  const broken = JSON.parse(fixture)
  delete broken.windows.total.tokens.out
  assert.equal(readStats(() => JSON.stringify(broken), at), null)
})

test('non-numeric contract field → null', () => {
  const broken = JSON.parse(fixture)
  broken.windows['24h'].tokens.cache_write = 'lots'
  assert.equal(readStats(() => JSON.stringify(broken), at), null)
})
