import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GIFTS, DAY_MS, defaultGifts, dayOf, claimGiftsUpTo, unlockedGrants } from '../src/gifts.js'

const at = (installed, days) => new Date(Date.parse(installed) + days * DAY_MS).toISOString()
const INSTALL = '2026-01-01T00:00:00.000Z'

test('catalog: 59 gifts, unique ids, well-formed grants', () => {
  assert.equal(GIFTS.length, 59)
  const ids = new Set(GIFTS.map((g) => g.id))
  assert.equal(ids.size, 59, 'ids are unique')
  const SERVICES = new Set(['harbour', 'airport'])
  const LANDMARKS = new Set(['park', 'monument', 'stadium', 'tower', 'spire', 'dome', 'observatory', 'lighthouse', 'fountain', 'bridge'])
  const FLAGS = new Set(['festival', 'aviary', 'zoo', 'nightlife', 'rally'])
  for (const g of GIFTS) {
    assert.ok(typeof g.id === 'string' && typeof g.name === 'string', `${g.id} has id + name`)
    if (g.grants) {
      if (g.grants.service) assert.ok(SERVICES.has(g.grants.service), `${g.id} service ${g.grants.service} is known`)
      if (g.grants.landmark) assert.ok(LANDMARKS.has(g.grants.landmark), `${g.id} landmark ${g.grants.landmark} is known`)
      if (g.grants.flag) assert.ok(FLAGS.has(g.grants.flag), `${g.id} flag ${g.grants.flag} is known`)
    }
  }
  // Boats + planes must be reachable (the headline visible gifts).
  assert.ok(GIFTS.some((g) => g.grants?.service === 'harbour'))
  assert.ok(GIFTS.some((g) => g.grants?.service === 'airport'))
})

test('dayOf: 1-based, install day = 1, clamps to >= 1, NaN → 1', () => {
  assert.equal(dayOf(INSTALL, INSTALL), 1)
  assert.equal(dayOf(INSTALL, at(INSTALL, 0.5)), 1) // same day
  assert.equal(dayOf(INSTALL, at(INSTALL, 1)), 2)
  assert.equal(dayOf(INSTALL, at(INSTALL, 58)), 59)
  assert.equal(dayOf(INSTALL, at(INSTALL, -5)), 1) // clock skew can't go below day 1
  assert.equal(dayOf('not-a-date', INSTALL), 1)
  assert.equal(dayOf(INSTALL, 'not-a-date'), 1)
})

test('claimGiftsUpTo: claims the owed range, accumulates, is idempotent', () => {
  const r1 = claimGiftsUpTo(defaultGifts(), 3)
  assert.deepEqual(r1.claimed.map((g) => g.day), [1, 2, 3])
  assert.equal(r1.gifts.claimedThroughDay, 3)
  assert.equal(Object.keys(r1.gifts.unlocked).length, 3)
  assert.equal(r1.gifts.last.day, 3)
  // A later day claims only the newly-owed gifts.
  const r2 = claimGiftsUpTo(r1.gifts, 5)
  assert.deepEqual(r2.claimed.map((g) => g.day), [4, 5])
  assert.equal(Object.keys(r2.gifts.unlocked).length, 5)
  // Same day again → nothing new, state unchanged.
  const r3 = claimGiftsUpTo(r2.gifts, 5)
  assert.equal(r3.claimed.length, 0)
  assert.equal(r3.gifts.claimedThroughDay, 5)
})

test('claimGiftsUpTo: never claims past the 59-gift catalog (Day 60 belongs to the arc)', () => {
  const r = claimGiftsUpTo(defaultGifts(), 200)
  assert.equal(r.claimed.length, 59)
  assert.equal(r.gifts.claimedThroughDay, 59)
  assert.ok(r.gifts.unlocked['the-countdown'], 'the final catalog gift (day 59) is unlocked')
  // Already at 59 → a bigger day adds nothing.
  const again = claimGiftsUpTo(r.gifts, 999)
  assert.equal(again.claimed.length, 0)
})

test('unlockedGrants: aggregates services, landmarks, flags from the unlocked set', () => {
  // Through day 20 we have crossed the harbour (10) and the airport (20).
  const { gifts } = claimGiftsUpTo(defaultGifts(), 20)
  const grants = unlockedGrants(gifts)
  assert.equal(grants.services.harbour, true)
  assert.equal(grants.services.airport, true)
  assert.ok(grants.landmarks.includes('fountain'), 'town fountain (day 5) is a landmark')
  assert.ok(grants.landmarks.includes('lighthouse'), 'lighthouse (day 12) is a landmark')
  assert.equal(grants.flags.festival, true) // food trucks / market
  assert.equal(grants.flags.aviary, true) // aviary (day 13)
  // Empty / malformed state → empty grants, never throws.
  assert.deepEqual(unlockedGrants(undefined), { services: {}, landmarks: [], flags: {} })
})

test('defaultGifts: zeroed, JSON-safe shape', () => {
  assert.deepEqual(defaultGifts(), { claimedThroughDay: 0, unlocked: {}, last: null })
})
