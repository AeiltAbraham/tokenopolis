import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACHIEVEMENTS,
  defaultProgress,
  achievementsFor,
  streakFor,
  updateProgress,
  newlyEarned,
} from '../src/progress.js'
import { SCALE_NAMES } from '../src/tuning.js'

const DAY = 86_400_000
const base = Date.parse('2026-06-01T00:00:00.000Z')
const iso = (day, hour = 12) => new Date(base + day * DAY + hour * 3_600_000).toISOString()

// Minimal hand-built state (updateProgress reads only state.sim / state.acts / state.progress).
function makeState({ sim = {}, acts = {}, progress } = {}) {
  return {
    sim: { builtTokens: 0, peakScaleIndex: 0, ruinProgress: 0, lastMeaningfulBurnAt: null, ...sim },
    acts: { usedIds: [], last: null, ...acts },
    ...(progress !== undefined ? { progress } : {}),
  }
}
// A state whose meaningful burn landed on `day` (active that UTC day), small enough to earn no
// scale/burn milestones so streak behaviour can be observed in isolation.
const burnDay = (day, progress) =>
  makeState({ sim: { builtTokens: 1_000_000, peakScaleIndex: 0, lastMeaningfulBurnAt: iso(day) }, progress })

const row = (list, id) => list.find((r) => r.id === id)

test('catalog: ~12 well-formed achievements with unique ids and the required coverage', () => {
  assert.ok(ACHIEVEMENTS.length >= 12 && ACHIEVEMENTS.length <= 14, `expected ~12, got ${ACHIEVEMENTS.length}`)
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length, 'ids unique')
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.id && a.name && a.desc, `${a.id}: id/name/desc required`)
  }
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id))
  for (const need of [
    'reach-village', 'reach-town', 'reach-city', 'reach-metropolis',
    'first-boon', 'first-disaster', 'survived-legendary', 'cycled-deck',
    'burn-10m', 'burn-100m', 'burn-1b', 'streak-7', 'rose-from-ruins',
  ]) {
    assert.ok(ids.has(need), `missing achievement "${need}"`)
  }
})

test('defaultProgress is the inert, safe-default shape', () => {
  assert.deepEqual(defaultProgress(), { earned: {}, activeDays: [], streakBest: 0, sawRuins: false, sawOutbreak: false })
  // Two calls do not share references (no accidental shared mutable state).
  const a = defaultProgress()
  a.earned['x'] = '1'
  assert.deepEqual(defaultProgress().earned, {})
})

test('achievementsFor: live threshold derivation + point-in-time stays map-only', () => {
  // Peak Town (index 2), 10M burned, no progress block at all.
  const s = makeState({ sim: { peakScaleIndex: SCALE_NAMES.indexOf('Town'), builtTokens: 10_000_000 } })
  const list = achievementsFor(s)
  assert.equal(list.length, ACHIEVEMENTS.length)
  assert.equal(row(list, 'reach-village').earned, true, 'village derived live')
  assert.equal(row(list, 'reach-town').earned, true, 'town derived live')
  assert.equal(row(list, 'reach-city').earned, false, 'city not yet')
  assert.equal(row(list, 'burn-10m').earned, true, '10M derived live')
  assert.equal(row(list, 'burn-100m').earned, false, '100M not yet')
  // Point-in-time ones are never derived from live state — only from the persisted map.
  assert.equal(row(list, 'first-boon').earned, false)
  assert.equal(row(list, 'rose-from-ruins').earned, false)
  // No earnedAt key on rows without a stamp.
  assert.ok(!('earnedAt' in row(list, 'reach-village')), 'live-only earn carries no earnedAt')
})

test('achievementsFor: a persisted stamp surfaces earned + earnedAt', () => {
  const s = makeState({ progress: { ...defaultProgress(), earned: { 'first-boon': iso(0) } } })
  const r = row(achievementsFor(s), 'first-boon')
  assert.equal(r.earned, true)
  assert.equal(r.earnedAt, iso(0))
})

test('threshold triggers: reaching Metropolis stamps the whole scale ladder', () => {
  const s = makeState({ sim: { peakScaleIndex: SCALE_NAMES.indexOf('Metropolis') } })
  const next = updateProgress(s, iso(0))
  for (const id of ['reach-village', 'reach-town', 'reach-city', 'reach-metropolis']) {
    assert.equal(next.earned[id], iso(0), `${id} stamped on reaching Metropolis`)
  }
})

test('threshold triggers: burn milestones gate at 10M / 100M / 1B', () => {
  const at100m = updateProgress(makeState({ sim: { builtTokens: 100_000_000 } }), iso(1))
  assert.ok(at100m.earned['burn-10m'] && at100m.earned['burn-100m'], '10M + 100M earned')
  assert.ok(!at100m.earned['burn-1b'], '1B not yet')
  const at1b = updateProgress(makeState({ sim: { builtTokens: 1_000_000_000 } }), iso(2))
  assert.ok(at1b.earned['burn-1b'], '1B earned at a billion')
})

test('act triggers: first boon, first disaster, legendary tier', () => {
  const boon = updateProgress(makeState({ acts: { last: { kind: 'boon' } } }), iso(0))
  assert.ok(boon.earned['first-boon'] && !boon.earned['first-disaster'])

  const dis = updateProgress(makeState({ acts: { last: { kind: 'disaster' } } }), iso(0))
  assert.ok(dis.earned['first-disaster'] && !dis.earned['first-boon'])

  const legendary = updateProgress(makeState({ acts: { last: { kind: 'disaster', tier: 'legendary' } } }), iso(0))
  assert.ok(legendary.earned['survived-legendary'], 'tier==="legendary" earns survived-legendary')
  // A non-legendary act does not earn it.
  const ordinary = updateProgress(makeState({ acts: { last: { kind: 'boon', tier: 'common' } } }), iso(0))
  assert.ok(!ordinary.earned['survived-legendary'])
})

test('deck trigger: cycled-deck earns only once usedIds has hit the full 50', () => {
  const partial = updateProgress(makeState({ acts: { usedIds: Array.from({ length: 49 }, (_, i) => `a${i}`) } }), iso(0))
  assert.ok(!partial.earned['cycled-deck'], '49 drawn is not a full deck')
  const full = updateProgress(makeState({ acts: { usedIds: Array.from({ length: 50 }, (_, i) => `a${i}`) } }), iso(0))
  assert.ok(full.earned['cycled-deck'], '50 drawn cycles the deck')
})

test('streak: increments across consecutive active days, earns streak-7 on the 7th', () => {
  let progress = defaultProgress()
  for (let day = 0; day < 7; day++) {
    progress = updateProgress(burnDay(day, progress), iso(day))
    const { current } = streakFor(burnDay(day, progress), iso(day))
    assert.equal(current, day + 1, `day ${day}: current streak ${day + 1}`)
  }
  assert.equal(progress.streakBest, 7, 'best reached 7')
  assert.ok(progress.earned['streak-7'], 'streak-7 earned on the 7th straight day')
  assert.equal(progress.earned['streak-7'], iso(6), 'stamped on day 6 (the 7th day)')
})

test('streak: a missed day resets current but best is retained', () => {
  let progress = defaultProgress()
  for (const day of [0, 1, 2]) progress = updateProgress(burnDay(day, progress), iso(day))
  assert.equal(streakFor(burnDay(2, progress), iso(2)).current, 3)

  // Skip days 3 and 4; burn again on day 5.
  progress = updateProgress(burnDay(5, progress), iso(5))
  const s = streakFor(burnDay(5, progress), iso(5))
  assert.equal(s.current, 1, 'a two-day gap breaks the run')
  assert.equal(s.best, 3, 'best is retained')
})

test('streak: a non-active tick (no meaningful burn today) does not extend the run', () => {
  let progress = updateProgress(burnDay(0, defaultProgress()), iso(0))
  // Day 1 tick, but the last meaningful burn was still day 0 (sub-threshold day) → not active.
  const idle = makeState({ sim: { builtTokens: 1_000_000, lastMeaningfulBurnAt: iso(0) }, progress })
  progress = updateProgress(idle, iso(1))
  assert.deepEqual(progress.activeDays, [iso(0).slice(0, 10)], 'only day 0 is active')
  // And the install-day seed (builtTokens 0) is never active.
  const seed = makeState({ sim: { builtTokens: 0, lastMeaningfulBurnAt: iso(2) } })
  assert.deepEqual(updateProgress(seed, iso(2)).activeDays, [], 'zero-burn seed day is not active')
})

test('rose-from-ruins: fires on the tick ruinProgress returns to 0 after having been > 0', () => {
  // Tick 1: ruined → sawRuins latches, achievement not yet earned.
  const ruined = updateProgress(makeState({ sim: { ruinProgress: 2 } }), iso(0))
  assert.equal(ruined.sawRuins, true)
  assert.ok(!ruined.earned['rose-from-ruins'], 'being in ruins is not the achievement')
  // Tick 2: recovered to 0 → the falling edge earns it.
  const recovered = updateProgress(makeState({ sim: { ruinProgress: 0 }, progress: ruined }), iso(1))
  assert.equal(recovered.sawRuins, false, 'episode closed')
  assert.equal(recovered.earned['rose-from-ruins'], iso(1))
  // A city that was never ruined does not earn it on a plain zero-ruin tick.
  const neverRuined = updateProgress(makeState({ sim: { ruinProgress: 0 } }), iso(0))
  assert.ok(!neverRuined.earned['rose-from-ruins'])
})

test('earnedAt is stamped once and never rewritten on later ticks', () => {
  const first = updateProgress(makeState({ sim: { peakScaleIndex: 1 } }), iso(0))
  assert.equal(first.earned['reach-village'], iso(0))
  const later = updateProgress(makeState({ sim: { peakScaleIndex: 1 }, progress: first }), iso(3))
  assert.equal(later.earned['reach-village'], iso(0), 'original stamp preserved')
})

test('newlyEarned: ids in next but not prev, in catalog order', () => {
  const prev = { earned: { 'reach-village': iso(0) } }
  const next = { earned: { 'reach-village': iso(0), 'reach-town': iso(1), 'first-boon': iso(1) } }
  assert.deepEqual(newlyEarned(prev, next), ['reach-town', 'first-boon'])
  assert.deepEqual(newlyEarned(null, next), ['reach-village', 'reach-town', 'first-boon'], 'null prev = everything new')
  assert.deepEqual(newlyEarned(next, next), [], 'no change = nothing new')
})

test('updateProgress is pure: it does not mutate the input state or progress', () => {
  const progress = { ...defaultProgress(), earned: { 'reach-village': iso(0) }, activeDays: [iso(0).slice(0, 10)] }
  const snapshot = structuredClone(progress)
  const state = makeState({ sim: { peakScaleIndex: 4, builtTokens: 50_000_000, lastMeaningfulBurnAt: iso(0) }, progress })
  const result = updateProgress(state, iso(0))
  assert.deepEqual(progress, snapshot, 'input progress untouched')
  assert.notStrictEqual(result, progress, 'a new object is returned')
  assert.notStrictEqual(result.earned, progress.earned, 'earned map is a fresh object')
})

test('handles a state with no progress block at all (safe defaults)', () => {
  const next = updateProgress(makeState({ sim: { peakScaleIndex: 1 } }), iso(0))
  assert.deepEqual(Object.keys(next).sort(), ['activeDays', 'earned', 'sawOutbreak', 'sawRuins', 'streakBest'])
  assert.equal(next.earned['reach-village'], iso(0))
  // achievementsFor / streakFor also tolerate a bare state.
  assert.equal(achievementsFor({ sim: {} }).length, ACHIEVEMENTS.length)
  assert.deepEqual(streakFor({}, iso(0)), { current: 0, best: 0 })
})

test('quarantine-lifted: earned on the falling edge of an outbreak, not otherwise', () => {
  const after = updateProgress(makeState({ sim: { infection: { severity: 0 } }, progress: { ...defaultProgress(), sawOutbreak: true } }), iso(0))
  assert.ok(after.earned['quarantine-lifted'], 'cleared after an outbreak -> earned')
  const never = updateProgress(makeState({ sim: { infection: { severity: 0 } } }), iso(0))
  assert.ok(!never.earned['quarantine-lifted'], 'never infected -> not earned')
})
