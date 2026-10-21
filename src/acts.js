// "A Random Act" — the once-an-hour wildcard. Pure sim logic (no I/O, no clock read, no Math.random):
// the clock and the PRNG are injected so this is fully testable and deterministic.
//
// Model: each act nudges a single signed lever, `sim.actTokens`, by a fraction of the city's current
// size. Boons push it up (the city grows / prettifies), disasters pull it down (the city shrinks into
// damage). The lever feeds `effectiveBuilt` → scale + economy, so the change is immediately visible in
// the skyline AND the treasury. Real burn keeps growing `builtTokens`, so an act's effect naturally
// dilutes over time — acts are events that matter NOW and fade as the city keeps building.
//
// The deck is drawn without replacement: every one of the 50 occurs exactly once before any repeats,
// then the used list clears and the deck is whole again.

import { SCALE } from './tuning.js'
import { step, effectiveBuilt } from './sim/condition.js'

export const COOLDOWN_MS = 60 * 60 * 1000 // one act per hour

// Animation archetypes the artifact knows how to play. Kept here so a catalog typo fails the test.
export const BOON_ANIMS = ['rise', 'boom', 'parade', 'bloom', 'sunrise', 'aurora', 'harvest', 'skyline', 'rainbow', 'fireworks']
export const DISASTER_ANIMS = ['quake', 'meteor', 'storm', 'flood', 'fire', 'blight', 'sinkhole', 'twister', 'eclipse', 'frost']

// mag = fraction of the city's current size (clamped reference floor) the act adds (+) or removes (−).
export const ACTS = [
  // ── Boons: grow / prettify ──────────────────────────────────────────────
  { id: 'grand-opening', name: 'Grand Opening', kind: 'boon', anim: 'rise', mag: 0.25, blurb: 'A ribbon is cut; a gleaming new tower opens downtown.' },
  { id: 'tech-boom', name: 'Tech Boom', kind: 'boon', anim: 'boom', mag: 0.4, blurb: 'Startups flood in — the treasury swells overnight.' },
  { id: 'city-festival', name: 'City Festival', kind: 'boon', anim: 'parade', mag: 0.15, blurb: 'Streets fill with music, confetti, and visitors.' },
  { id: 'green-initiative', name: 'Green Initiative', kind: 'boon', anim: 'bloom', mag: 0.18, blurb: 'Parks bloom; the skyline turns a little greener.' },
  { id: 'tourism-surge', name: 'Tourism Surge', kind: 'boon', anim: 'sunrise', mag: 0.22, blurb: 'Postcards everywhere — crowds pour through the gates.' },
  { id: 'gold-rush', name: 'Gold Rush', kind: 'boon', anim: 'boom', mag: 0.5, blurb: 'Someone struck it rich; prospectors build fast.' },
  { id: 'new-stadium', name: 'New Stadium', kind: 'boon', anim: 'rise', mag: 0.3, blurb: 'Floodlights blaze over a brand-new arena.' },
  { id: 'aurora-night', name: 'Aurora Night', kind: 'boon', anim: 'aurora', mag: 0.1, blurb: 'Ribbons of light draw dreamers and their wallets.' },
  { id: 'trade-deal', name: 'Trade Deal', kind: 'boon', anim: 'boom', mag: 0.35, blurb: 'A lucrative pact lands; cranes go up everywhere.' },
  { id: 'bumper-harvest', name: 'Bumper Harvest', kind: 'boon', anim: 'harvest', mag: 0.14, blurb: 'Granaries overflow; the markets hum.' },
  { id: 'blockbuster-shoot', name: 'Blockbuster Shoot', kind: 'boon', anim: 'parade', mag: 0.16, blurb: 'Cameras roll downtown; fame follows.' },
  { id: 'flash-skyscraper', name: 'Flash Skyscraper', kind: 'boon', anim: 'rise', mag: 0.6, blurb: 'Overnight, a megatower pierces the clouds.' },
  { id: 'generous-patron', name: 'Generous Patron', kind: 'boon', anim: 'bloom', mag: 0.2, blurb: 'A benefactor funds museums, parks, and plazas.' },
  { id: 'new-rail-link', name: 'New Rail Link', kind: 'boon', anim: 'skyline', mag: 0.28, blurb: 'Fresh track knits the districts together.' },
  { id: 'double-rainbow', name: 'Double Rainbow', kind: 'boon', anim: 'rainbow', mag: 0.08, blurb: 'A good omen; spirits (and property values) lift.' },
  { id: 'moon-contract', name: 'Moon Contract', kind: 'boon', anim: 'boom', mag: 0.45, blurb: 'The city wins an off-world contract — boomtime.' },
  { id: 'founders-day', name: "Founders' Day", kind: 'boon', anim: 'fireworks', mag: 0.12, blurb: 'Fireworks over a proud, growing skyline.' },
  { id: 'innovation-grant', name: 'Innovation Grant', kind: 'boon', anim: 'rise', mag: 0.26, blurb: 'Labs expand; prototypes become towers.' },
  { id: 'great-migration', name: 'Great Migration', kind: 'boon', anim: 'skyline', mag: 0.3, blurb: 'Newcomers arrive by the thousand; homes rise.' },
  { id: 'civic-renaissance', name: 'Civic Renaissance', kind: 'boon', anim: 'bloom', mag: 0.24, blurb: 'Art, gardens, and grand facades everywhere.' },
  { id: 'hyperscale-datacenter', name: 'Hyperscale Datacenter', kind: 'boon', anim: 'boom', mag: 0.38, blurb: 'Server farms light up; the economy computes.' },
  { id: 'port-expansion', name: 'Port Expansion', kind: 'boon', anim: 'skyline', mag: 0.32, blurb: 'New docks; the city trades with the world.' },
  { id: 'lottery-win', name: 'City Lottery Win', kind: 'boon', anim: 'boom', mag: 0.2, blurb: 'An improbable jackpot funds public works.' },
  { id: 'solar-farm', name: 'Solar Farm', kind: 'boon', anim: 'sunrise', mag: 0.18, blurb: 'Clean power hums; industry expands guilt-free.' },
  { id: 'world-expo', name: 'World Expo', kind: 'boon', anim: 'fireworks', mag: 0.42, blurb: 'The world visits; pavilions sprout overnight.' },

  // ── Disasters: shrink / damage ──────────────────────────────────────────
  { id: 'earthquake', name: 'Earthquake', kind: 'disaster', anim: 'quake', mag: -0.3, blurb: 'The ground heaves; towers crack and fall.' },
  { id: 'meteor-strike', name: 'Meteor Strike', kind: 'disaster', anim: 'meteor', mag: -0.45, blurb: 'A fireball slams downtown — a smoking crater remains.' },
  { id: 'hurricane', name: 'Hurricane', kind: 'disaster', anim: 'storm', mag: -0.28, blurb: 'Winds tear through the districts for days.' },
  { id: 'great-flood', name: 'Great Flood', kind: 'disaster', anim: 'flood', mag: -0.25, blurb: 'The river breaks its banks; streets go under.' },
  { id: 'wildfire', name: 'Wildfire', kind: 'disaster', anim: 'fire', mag: -0.3, blurb: 'Flames leap block to block on a dry wind.' },
  { id: 'recession', name: 'Recession', kind: 'disaster', anim: 'blight', mag: -0.22, blurb: 'Markets slump; cranes freeze mid-build.' },
  { id: 'outbreak', name: 'Outbreak', kind: 'disaster', anim: 'blight', mag: -0.26, blurb: 'Quarantine empties the streets; trade stalls.' },
  { id: 'sinkhole', name: 'Sinkhole', kind: 'disaster', anim: 'sinkhole', mag: -0.2, blurb: 'A whole block drops into the dark.' },
  { id: 'tornado', name: 'Tornado', kind: 'disaster', anim: 'twister', mag: -0.24, blurb: 'A funnel scours a ragged path through town.' },
  { id: 'blackout', name: 'City Blackout', kind: 'disaster', anim: 'eclipse', mag: -0.12, blurb: 'The grid fails; the city goes dark and quiet.' },
  { id: 'eruption', name: 'Volcanic Eruption', kind: 'disaster', anim: 'fire', mag: -0.4, blurb: 'Ash rains down; the outskirts burn.' },
  { id: 'blizzard', name: 'Blizzard', kind: 'disaster', anim: 'frost', mag: -0.18, blurb: 'Snow buries the city; everything grinds to a halt.' },
  { id: 'acid-rain', name: 'Acid Rain', kind: 'disaster', anim: 'blight', mag: -0.14, blurb: 'Facades pit and crumble under sour skies.' },
  { id: 'market-crash', name: 'Market Crash', kind: 'disaster', anim: 'blight', mag: -0.35, blurb: 'Fortunes vanish in an afternoon.' },
  { id: 'general-strike', name: 'General Strike', kind: 'disaster', anim: 'eclipse', mag: -0.1, blurb: 'The city stops; nothing gets built.' },
  { id: 'drought', name: 'Drought', kind: 'disaster', anim: 'blight', mag: -0.16, blurb: 'Reservoirs shrink; growth withers.' },
  { id: 'cyberattack', name: 'Cyberattack', kind: 'disaster', anim: 'eclipse', mag: -0.15, blurb: 'Systems seized; the smart city goes dumb.' },
  { id: 'tsunami', name: 'Tsunami', kind: 'disaster', anim: 'flood', mag: -0.42, blurb: 'A wall of water erases the waterfront.' },
  { id: 'subsidence', name: 'Subsidence', kind: 'disaster', anim: 'sinkhole', mag: -0.17, blurb: 'Foundations sag; towers lean and shed floors.' },
  { id: 'locust-swarm', name: 'Locust Swarm', kind: 'disaster', anim: 'blight', mag: -0.12, blurb: 'A living cloud strips the green belt bare.' },
  { id: 'reactor-scare', name: 'Reactor Scare', kind: 'disaster', anim: 'eclipse', mag: -0.2, blurb: 'A near-miss empties whole districts.' },
  { id: 'landslide', name: 'Landslide', kind: 'disaster', anim: 'sinkhole', mag: -0.22, blurb: 'The hillside gives way onto the suburbs.' },
  { id: 'heatwave', name: 'Heatwave', kind: 'disaster', anim: 'fire', mag: -0.14, blurb: 'The grid buckles; asphalt shimmers and softens.' },
  { id: 'ice-storm', name: 'Ice Storm', kind: 'disaster', anim: 'frost', mag: -0.2, blurb: 'Power lines snap under glittering ice.' },
  { id: 'great-quake', name: 'The Big One', kind: 'disaster', anim: 'quake', mag: -0.5, blurb: 'The big one — the skyline reshapes in minutes.' },
]

const ACT_BY_ID = new Map(ACTS.map((a) => [a.id, a]))

// ── Legendary: ultra-rare, outsized acts with their own one-off animations. ─────────────────────────
// NOT part of the 50-card deck — drawn WITH replacement (drawLegendary) and gated behind
// LEGENDARY_CHANCE inside performAct, so a legendary is a rare surprise, never a deck slot. Each carries
// its OWN distinct `anim` the artifact plays as a special (none overlaps the common BOON/DISASTER_ANIMS)
// and is tagged `tier: 'legendary'`. |mag| ∈ [0.6, 1.0] — an era-defining swing either way.
export const LEGENDARY = [
  { id: 'gold-rain', name: 'Rain of Gold', kind: 'boon', anim: 'goldrain', mag: 0.9, blurb: 'The sky opens and gold pours down — the treasury overflows overnight.', tier: 'legendary' },
  { id: 'utopia', name: 'Utopia Achieved', kind: 'boon', anim: 'utopia', mag: 1.0, blurb: 'Every district gleams; the city becomes the dream it was chasing.', tier: 'legendary' },
  { id: 'phoenix-rising', name: 'Phoenix Rising', kind: 'boon', anim: 'phoenix', mag: 0.7, blurb: 'From the ashes a radiant new city rises, grander than before.', tier: 'legendary' },
  { id: 'black-hole', name: 'Black Hole', kind: 'disaster', anim: 'blackhole', mag: -1.0, blurb: 'A singularity blooms downtown and swallows whole districts.', tier: 'legendary' },
  { id: 'alien-harvest', name: 'Alien Harvest', kind: 'disaster', anim: 'alien', mag: -0.8, blurb: 'Silent craft lift entire blocks into the sky and vanish.', tier: 'legendary' },
  { id: 'time-warp', name: 'Time Warp', kind: 'disaster', anim: 'timewarp', mag: -0.6, blurb: 'A rift unbuilds decades of progress in a single shuddering instant.', tier: 'legendary' },
]

// performAct rolls this FIRST (one rng() call). A hit (< LEGENDARY_CHANCE) swaps the common draw for a
// legendary; otherwise the existing without-replacement deck path runs unchanged.
export const LEGENDARY_CHANCE = 0.04

// Pick a legendary WITH replacement (legendaries are rare one-offs, not a deck). rng() ∈ [0,1).
export function drawLegendary(rng) {
  return LEGENDARY[Math.floor(rng() * LEGENDARY.length) % LEGENDARY.length]
}

// Cooldown gate. acts.lastActAt is an ISO string (or null/absent). nowMs is Date.now().
export function canAct(acts, nowMs) {
  const last = Date.parse(acts?.lastActAt ?? '')
  if (isNaN(last)) return true
  return nowMs - last >= COOLDOWN_MS
}

export function msUntilNextAct(acts, nowMs) {
  const last = Date.parse(acts?.lastActAt ?? '')
  if (isNaN(last)) return 0
  return Math.max(0, COOLDOWN_MS - (nowMs - last))
}

// Pick the next act WITHOUT replacement. Returns { act, usedIds } — usedIds is the new used list
// (the drawn id appended; reset to just that id when the deck was exhausted). rng() ∈ [0,1).
export function drawAct(usedIds, rng) {
  const used = Array.isArray(usedIds) ? usedIds.filter((id) => ACT_BY_ID.has(id)) : []
  let pool = ACTS.filter((a) => !used.includes(a.id))
  let base = used
  if (pool.length === 0) {
    pool = ACTS // deck exhausted → reshuffle the whole deck
    base = []
  }
  const act = pool[Math.floor(rng() * pool.length) % pool.length]
  return { act, usedIds: [...base, act.id] }
}

// Peek two DISTINCT common acts from the remaining deck WITHOUT consuming it (usedIds is never touched):
// the "choose your act" offer. The caller finalizes a pick by marking that id used and applying it —
// applyAct(state, choice.options[i], [...usedIds, choice.options[i].id], nowIso). rng() ∈ [0,1).
export function drawChoice(usedIds, rng) {
  const used = Array.isArray(usedIds) ? usedIds.filter((id) => ACT_BY_ID.has(id)) : []
  let pool = ACTS.filter((a) => !used.includes(a.id))
  if (pool.length < 2) pool = ACTS // deck down to its last card → offer from a fresh deck so two distinct options exist
  const a = pool[Math.floor(rng() * pool.length) % pool.length]
  const rest = pool.filter((x) => x.id !== a.id)
  const b = rest[Math.floor(rng() * rest.length) % rest.length]
  return { options: [a, b] }
}

// Apply an act's effect to state: move the actTokens lever, re-step the sim so scale/economy reflect
// it immediately, and record the occurrence (what the artifact animates + names) + the cooldown stamp.
// Pure: builtTokens is untouched (an act is not "burn"), so the decay clock does not reset.
export function applyAct(state, act, usedIds, nowIso) {
  const sim = state.sim
  const reference = Math.max(effectiveBuilt(sim), SCALE.baseTokens) // floor so even a tiny city feels it
  let rawDelta = Math.round(reference * act.mag)
  let actTokens = (sim.actTokens ?? 0) + rawDelta
  // Floor: the lever can shrink the city, but never below an empty lot.
  if ((sim.builtTokens ?? 0) + actTokens < 0) {
    actTokens = -(sim.builtTokens ?? 0)
    rawDelta = actTokens - (sim.actTokens ?? 0)
  }
  const newSim = step(
    { ...sim, actTokens },
    { builtTokens: sim.builtTokens ?? 0, burn24h: state.stats?.burn24h ?? 0, burn7d: state.stats?.burn7d ?? 0 },
    nowIso,
  )
  const occurrence = { id: act.id, name: act.name, kind: act.kind, anim: act.anim, blurb: act.blurb, at: nowIso, delta: rawDelta, tier: act.tier ?? 'common' }
  return { ...state, sim: newSim, acts: { usedIds, lastActAt: nowIso, last: occurrence } }
}

// Draw + apply in one pure step (the happy path the action script runs when off cooldown). Rolls the
// legendary gate FIRST (one rng() call): on a hit (< LEGENDARY_CHANCE) it applies a legendary and leaves
// the common deck untouched; otherwise it runs the existing without-replacement deck path unchanged.
export function performAct(state, nowIso, rng) {
  if (rng() < LEGENDARY_CHANCE) {
    const legend = drawLegendary(rng)
    // Leave the 50-card deck UNTOUCHED — a legendary is never a deck slot, so 'cycled-deck' counts
    // only the commons (appending the legendary id would inflate usedIds and award it one act early).
    return applyAct(state, legend, state.acts?.usedIds ?? [], nowIso)
  }
  const { act, usedIds } = drawAct(state.acts?.usedIds ?? [], rng)
  return applyAct(state, act, usedIds, nowIso)
}
