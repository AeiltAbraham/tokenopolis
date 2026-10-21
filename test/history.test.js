import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendEvent, formatEvent, summarize, HISTORY_CAP } from '../src/history.js'

const ev = (over = {}) => ({ at: '2026-10-21T00:00:00.000Z', type: 'act', label: 'Tech Boom', kind: 'boon', ...over })

test('appendEvent prepends newest-first and returns a fresh, frozen array', () => {
  const a = ev({ label: 'A' })
  const b = ev({ label: 'B' })
  const h0 = appendEvent([], a)
  const h1 = appendEvent(h0, b)
  assert.deepEqual(h1.map((e) => e.label), ['B', 'A'], 'newest at the front')
  assert.notEqual(h1, h0, 'a new array is returned each call')
  assert.ok(Object.isFrozen(h1), 'the returned array is immutable')
})

test('appendEvent does not mutate the array passed in', () => {
  const input = [ev({ label: 'old' })]
  const snapshot = input.map((e) => ({ ...e }))
  const out = appendEvent(input, ev({ label: 'new' }))
  assert.deepEqual(input, snapshot, 'the caller array is left untouched')
  assert.equal(input.length, 1, 'no entry pushed onto the input')
  assert.equal(out.length, 2)
})

test('appendEvent enforces the default cap of 60, keeping the newest', () => {
  let h = []
  for (let i = 0; i < 100; i++) h = appendEvent(h, ev({ label: `e${i}` }))
  assert.equal(HISTORY_CAP, 60)
  assert.equal(h.length, 60, 'capped')
  assert.equal(h[0].label, 'e99', 'newest kept at the front')
  assert.equal(h[h.length - 1].label, 'e40', 'oldest within the 60-wide window')
})

test('appendEvent respects a custom cap', () => {
  let h = []
  for (let i = 0; i < 10; i++) h = appendEvent(h, ev({ label: `e${i}` }), 3)
  assert.equal(h.length, 3)
  assert.deepEqual(h.map((e) => e.label), ['e9', 'e8', 'e7'])
})

test('appendEvent tolerates a non-array history and a bad cap', () => {
  assert.deepEqual(appendEvent(undefined, ev({ label: 'x' })).map((e) => e.label), ['x'])
  const h = appendEvent([ev({ label: 'keep' })], ev({ label: 'new' }), NaN)
  assert.equal(h.length, 2, 'a non-finite cap falls back to the default rather than wiping the log')
})

test('formatEvent renders a distinct headline for each event type', () => {
  assert.equal(formatEvent({ type: 'act', kind: 'disaster', label: 'Tornado' }), '💥 Tornado struck')
  assert.equal(formatEvent({ type: 'act', kind: 'boon', label: 'Tech Boom' }), '🎉 Tech Boom lifted the city')
  assert.equal(formatEvent({ type: 'scale', label: 'City' }), '🏙️ Grew to City')
  assert.equal(formatEvent({ type: 'milestone', label: 'Underground opened' }), '🏆 Underground opened')
  assert.equal(formatEvent({ type: 'ruin', label: 'Ruins' }), '🧟 Fell into ruins')
  assert.equal(formatEvent({ type: 'recovery', label: 'City' }), '🌱 Rebuilt from the ruins')
})

test('every formatted headline leads with an emoji glyph', () => {
  const samples = [
    { type: 'act', kind: 'boon', label: 'X' },
    { type: 'act', kind: 'disaster', label: 'Y' },
    { type: 'scale', label: 'Town' },
    { type: 'milestone', label: 'Z' },
    { type: 'ruin', label: '' },
    { type: 'recovery', label: '' },
  ]
  for (const e of samples) {
    assert.ok(formatEvent(e).codePointAt(0) > 0x7f, `"${formatEvent(e)}" should lead with an emoji`)
  }
})

test('formatEvent never throws on a malformed event', () => {
  assert.doesNotThrow(() => formatEvent(undefined))
  assert.doesNotThrow(() => formatEvent({}))
  assert.doesNotThrow(() => formatEvent({ label: 42 }))
  assert.equal(formatEvent({ type: 'mystery', label: 'Omen' }), '📜 Omen')
})

test('summarize counts acts, disasters, milestones and legendaries by type/kind', () => {
  const history = [
    { type: 'act', kind: 'boon', label: 'Tech Boom' },
    { type: 'act', kind: 'disaster', label: 'Tornado' },
    { type: 'act', kind: 'disaster', label: 'Flood' },
    { type: 'scale', label: 'Town' },
    { type: 'scale', label: 'City' },
    { type: 'milestone', label: 'Underground opened' },
    { type: 'ruin', label: 'Ruins' },
    { type: 'recovery', label: 'City' },
  ]
  // acts: 3 (1 boon + 2 disaster). disasters: 3 (2 disaster acts + 1 ruin). milestones: 3 (2 scale +
  // 1 milestone). legendaries: 1 (recovery).
  assert.deepEqual(summarize(history), { acts: 3, disasters: 3, milestones: 3, legendaries: 1 })
})

test('summarize on an empty or non-array history is all zeros', () => {
  const zero = { acts: 0, disasters: 0, milestones: 0, legendaries: 0 }
  assert.deepEqual(summarize([]), zero)
  assert.deepEqual(summarize(undefined), zero)
  assert.deepEqual(summarize([null, 'junk', 7]), zero, 'malformed entries are skipped')
})
