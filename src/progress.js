// Achievements, streaks & milestones. Pure — no I/O, no clock read, no randomness: `nowIso` is a
// parameter so everything is deterministic and testable (same input → same output), matching the
// sim/* modules. This is the "progress" layer that sits beside the sim: it reads live state (the
// monotonic fields — peakScaleIndex, builtTokens) and a small persisted `state.progress` block for
// the point-in-time moments that live state can no longer show (an act kind that's since changed, a
// deck that's since reset, a streak that's since broken, a ruin the city has since climbed out of).
//
// Two classes of achievement:
//   • threshold (live)      — re-derivable from current state every call (monotonic fields never
//                             regress, so once true they stay true). peakScaleIndex + builtTokens.
//   • point-in-time (event) — only observable at the instant they happen, so updateProgress() stamps
//                             them into state.progress.earned; achievementsFor() reads that map back.

import { SCALE_NAMES } from './tuning.js'

const DAY_MS = 86_400_000
const FULL_DECK = 50 // "A Random Act" deck size: usedIds reaching this = a full cycle (see src/acts.js)
const STREAK_TARGET = 7 // consecutive active days for the "Week of Fire" achievement

// ~13 achievements. Public shape is {id, name, desc}; the earn logic lives in the maps below, keyed by
// id, so the catalog stays pure data (the THEMES/resolveTheme split in render/themes.js is the model).
export const ACHIEVEMENTS = [
  { id: 'reach-village', name: 'Village', desc: 'Your settlement grew into a Village.' },
  { id: 'reach-town', name: 'Township', desc: 'The Village thickened into a Town.' },
  { id: 'reach-city', name: 'Cityhood', desc: 'A proper City now rises from the plain.' },
  { id: 'reach-metropolis', name: 'Metropolis', desc: 'The skyline reached Metropolis — the underground opens.' },
  { id: 'first-boon', name: 'Good Fortune', desc: 'You enjoyed your first boon.' },
  { id: 'first-disaster', name: 'Disaster Strikes', desc: 'You weathered your first disaster.' },
  { id: 'survived-legendary', name: 'Still Standing', desc: 'You came through a legendary act.' },
  { id: 'cycled-deck', name: 'Full Deck', desc: 'Every one of the 50 random acts has occurred.' },
  { id: 'burn-10m', name: 'Ten Million', desc: 'You burned 10,000,000 tokens into the city.' },
  { id: 'burn-100m', name: 'Hundred Million', desc: 'You burned 100,000,000 tokens into the city.' },
  { id: 'burn-1b', name: 'Billionaire Builder', desc: 'You burned 1,000,000,000 tokens into the city.' },
  { id: 'streak-7', name: 'Week of Fire', desc: 'Seven straight days of meaningful burn.' },
  { id: 'rose-from-ruins', name: 'Phoenix', desc: 'You rebuilt a city that had crumbled into ruins.' },
]

// Threshold gates on monotonic live fields. These are re-derived from state every call.
const SCALE_GATES = {
  'reach-village': SCALE_NAMES.indexOf('Village'),
  'reach-town': SCALE_NAMES.indexOf('Town'),
  'reach-city': SCALE_NAMES.indexOf('City'),
  'reach-metropolis': SCALE_NAMES.indexOf('Metropolis'),
}
const BURN_GATES = {
  'burn-10m': 10_000_000,
  'burn-100m': 100_000_000,
  'burn-1b': 1_000_000_000,
}

// The point-in-time ids — earned is known ONLY from the persisted map, never re-derived live.
const POINT_IN_TIME = new Set(['first-boon', 'first-disaster', 'survived-legendary', 'cycled-deck', 'streak-7', 'rose-from-ruins'])

// The persisted progress block. Safe, inert defaults: the integrator seeds this into initState() and
// updateProgress() always returns a complete block of this exact shape.
export function defaultProgress() {
  return {
    earned: {}, // achievement id -> ISO timestamp it was first earned (the point-in-time record)
    activeDays: [], // 'YYYY-MM-DD' (UTC) days that saw a meaningful burn — the streak's source data
    streakBest: 0, // longest consecutive active-day run ever observed (never decreases)
    sawRuins: false, // true while the city is in a ruined episode (ruinProgress was > 0 last tick)
  }
}

// ── internal date helpers (UTC day arithmetic) ──────────────────────────────
const isDayKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k)
function dayKey(iso) {
  const ms = Date.parse(iso)
  if (isNaN(ms)) return null
  return new Date(ms).toISOString().slice(0, 10)
}
function dayNumber(key) {
  const ms = Date.parse(`${key}T00:00:00.000Z`)
  if (isNaN(ms)) return null
  return Math.round(ms / DAY_MS)
}

// Coerce any stored (or absent) progress into the canonical shape without mutating the input.
function normalizeProgress(progress) {
  const p = progress && typeof progress === 'object' ? progress : {}
  return {
    earned: p.earned && typeof p.earned === 'object' ? { ...p.earned } : {},
    activeDays: Array.isArray(p.activeDays) ? p.activeDays.filter(isDayKey) : [],
    streakBest: Number.isFinite(p.streakBest) ? p.streakBest : 0,
    sawRuins: p.sawRuins === true,
  }
}

// True when live state is earnable for a threshold achievement; false for point-in-time ids (they are
// never live-derivable — their truth lives in the persisted map).
function liveEarned(id, state) {
  const sim = state?.sim ?? {}
  if (id in SCALE_GATES) return (sim.peakScaleIndex ?? 0) >= SCALE_GATES[id]
  if (id in BURN_GATES) return (sim.builtTokens ?? 0) >= BURN_GATES[id]
  return false
}

// {current, best} consecutive active-day streak, computed purely from persisted active-day data.
// `current` counts the run ending today, or yesterday (one grace day — today isn't over yet); an
// older last-active day means the streak is broken (0). `best` is the longest run ever (floored by
// the persisted streakBest so a future prune of activeDays can never lower it).
function computeStreak(activeDays, nowIso, priorBest = 0) {
  const nums = [...new Set(activeDays.filter(isDayKey).map(dayNumber))].filter((n) => n !== null).sort((a, b) => a - b)

  let best = 0
  let run = 0
  let prev = null
  for (const n of nums) {
    run = prev !== null && n === prev + 1 ? run + 1 : 1
    if (run > best) best = run
    prev = n
  }
  best = Math.max(best, Number.isFinite(priorBest) ? priorBest : 0)

  let current = 0
  const today = dayNumber(dayKey(nowIso))
  if (today !== null) {
    const set = new Set(nums)
    let anchor = set.has(today) ? today : set.has(today - 1) ? today - 1 : null
    if (anchor !== null) {
      for (let n = anchor; set.has(n); n--) current++
    }
  }
  return { current, best }
}

export function streakFor(state, nowIso) {
  const prog = normalizeProgress(state?.progress)
  return computeStreak(prog.activeDays, nowIso, prog.streakBest)
}

// A day is "active" when a meaningful burn landed on it. The sim already decides what counts as a
// meaningful burn (DECAY.meaningfulTokens, via condition.js) and stamps sim.lastMeaningfulBurnAt to
// that tick's time — so "today is active" is exactly "the last meaningful burn was today". The
// builtTokens>0 guard rejects the install-day seed (lastMeaningfulBurnAt === installedAt, no burn).
function isActiveDay(state, nowIso) {
  const sim = state?.sim ?? {}
  if ((sim.builtTokens ?? 0) <= 0) return false
  const burn = dayKey(sim.lastMeaningfulBurnAt)
  const now = dayKey(nowIso)
  return burn !== null && now !== null && burn === now
}

// The present report: every achievement with a live earned flag and, when stamped, its earnedAt.
// Threshold ones are earned if the persisted stamp exists OR live state already clears the gate;
// point-in-time ones are earned only when the persisted stamp exists.
export function achievementsFor(state) {
  const earnedMap = normalizeProgress(state?.progress).earned
  return ACHIEVEMENTS.map((a) => {
    const earnedAt = earnedMap[a.id]
    const earned = Boolean(earnedAt) || liveEarned(a.id, state)
    const row = { id: a.id, name: a.name, desc: a.desc, earned }
    if (earnedAt) row.earnedAt = earnedAt
    return row
  })
}

// Did a point-in-time achievement's trigger condition fire on THIS tick?
function eventTriggered(id, { acts, streakCurrent, roseFromRuins }) {
  switch (id) {
    case 'first-boon':
      return acts?.last?.kind === 'boon'
    case 'first-disaster':
      return acts?.last?.kind === 'disaster'
    case 'survived-legendary':
      return acts?.last?.tier === 'legendary'
    case 'cycled-deck':
      return (acts?.usedIds?.length ?? 0) >= FULL_DECK
    case 'streak-7':
      return streakCurrent >= STREAK_TARGET
    case 'rose-from-ruins':
      return roseFromRuins
    default:
      return false
  }
}

// Pure: fold this tick into a NEW progress block. Marks today active (if a meaningful burn landed),
// refreshes the streak best, tracks the ruin episode, and stamps earnedAt for every newly-earned
// achievement (threshold ones the moment live state clears the gate; point-in-time ones the moment
// their transient trigger fires). Call it every tick with the tick's own `nowIso`, and again right
// after an act resolves (so first-boon / first-disaster / survived-legendary / cycled-deck are caught
// before the next act mutates acts.last / resets the deck). Already-earned stamps are never rewritten.
export function updateProgress(state, nowIso) {
  const prev = normalizeProgress(state?.progress)
  const sim = state?.sim ?? {}
  const acts = state?.acts ?? {}

  // 1) active day → streak source data
  const activeDays = prev.activeDays.slice()
  if (isActiveDay(state, nowIso)) {
    const key = dayKey(nowIso)
    if (key && !activeDays.includes(key)) activeDays.push(key)
  }
  activeDays.sort()

  // 2) streak (today already folded in, so `current` can reach the target on its qualifying day)
  const { current, best } = computeStreak(activeDays, nowIso, prev.streakBest)

  // 3) ruin episode: sawRuins mirrors "ruinProgress > 0 as of this tick"; the falling edge
  //    (was ruined last tick, back to 0 now) is a genuine recovery — ruinProgress only reaches 0 via
  //    the recovery path in condition.js, never spuriously.
  const ruin = sim.ruinProgress ?? 0
  const roseFromRuins = prev.sawRuins === true && ruin === 0
  const sawRuins = ruin > 0

  // 4) stamp newly-earned achievements (keep any existing stamp untouched)
  const earned = { ...prev.earned }
  for (const a of ACHIEVEMENTS) {
    if (earned[a.id]) continue
    const now = POINT_IN_TIME.has(a.id)
      ? eventTriggered(a.id, { acts, streakCurrent: current, roseFromRuins })
      : liveEarned(a.id, state)
    if (now) earned[a.id] = nowIso
  }

  return { earned, activeDays, streakBest: best, sawRuins }
}

// The ids present in next.earned but not in prev.earned, in ACHIEVEMENTS order (stable for notifying).
export function newlyEarned(prevProgress, nextProgress) {
  const prev = prevProgress?.earned && typeof prevProgress.earned === 'object' ? prevProgress.earned : {}
  const next = nextProgress?.earned && typeof nextProgress.earned === 'object' ? nextProgress.earned : {}
  return ACHIEVEMENTS.map((a) => a.id).filter((id) => next[id] && !prev[id])
}
