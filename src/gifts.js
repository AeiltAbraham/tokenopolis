// Daily gifts: one per day since install (Days 1..59; Day 60 is the Singularity — handled by the arc,
// not here). Pure, no I/O. A gift may `grant` a service (harbour → boats, airport → planes), a landmark
// (a new structure on the plate), and/or a flag (an entity boost the renderer reads). Many are pure
// flavor — a banner + a chronicle line. Gifts persist in state.gifts and accumulate.

export const DAY_MS = 86_400_000

// 59 gifts, day index = position + 1. grants: { service?, landmark?, flag? } — all optional.
export const GIFTS = [
  { id: 'founding-charter', name: 'Founding Charter' },
  { id: 'street-lamps', name: 'Street Lamps' },
  { id: 'food-trucks', name: 'Food Trucks', grants: { flag: 'festival' } },
  { id: 'park-benches', name: 'Park Benches' },
  { id: 'town-fountain', name: 'Town Fountain', grants: { landmark: 'fountain' } },
  { id: 'bike-lanes', name: 'Bike Lanes' },
  { id: 'farmers-market', name: 'Farmers Market', grants: { flag: 'festival' } },
  { id: 'public-library', name: 'Public Library', grants: { landmark: 'dome' } },
  { id: 'bus-fleet', name: 'Bus Fleet' },
  { id: 'harbour', name: 'Harbour', grants: { service: 'harbour' } },
  { id: 'fishing-fleet', name: 'Fishing Fleet' },
  { id: 'lighthouse', name: 'Lighthouse', grants: { landmark: 'lighthouse' } },
  { id: 'aviary', name: 'Aviary', grants: { flag: 'aviary' } },
  { id: 'botanical-gardens', name: 'Botanical Gardens', grants: { landmark: 'park' } },
  { id: 'tram-line', name: 'Tram Line' },
  { id: 'stadium', name: 'Stadium', grants: { landmark: 'stadium' } },
  { id: 'city-marathon', name: 'City Marathon', grants: { flag: 'festival' } },
  { id: 'city-zoo', name: 'City Zoo', grants: { flag: 'zoo' } },
  { id: 'ferris-wheel', name: 'Ferris Wheel', grants: { landmark: 'tower' } },
  { id: 'airport', name: 'Airport', grants: { service: 'airport' } },
  { id: 'air-show', name: 'Air Show' },
  { id: 'university', name: 'University', grants: { landmark: 'dome' } },
  { id: 'observatory', name: 'Observatory', grants: { landmark: 'observatory' } },
  { id: 'cathedral', name: 'Cathedral', grants: { landmark: 'spire' } },
  { id: 'night-market', name: 'Night Market', grants: { flag: 'nightlife' } },
  { id: 'limousine-service', name: 'Limousine Service' },
  { id: 'cable-car', name: 'Cable Car' },
  { id: 'power-plant', name: 'Power Plant' },
  { id: 'metro-expansion', name: 'Metro Expansion' },
  { id: 'opera-house', name: 'Opera House', grants: { landmark: 'dome' } },
  { id: 'vintage-rally', name: 'Vintage Car Rally', grants: { flag: 'rally' } },
  { id: 'grand-museum', name: 'Grand Museum', grants: { landmark: 'monument' } },
  { id: 'skyline-tower', name: 'Skyline Tower', grants: { landmark: 'tower' } },
  { id: 'river-bridge', name: 'River Bridge', grants: { landmark: 'bridge' } },
  { id: 'drone-delivery', name: 'Drone Delivery' },
  { id: 'solar-array', name: 'Solar Array' },
  { id: 'conservatory', name: 'Conservatory', grants: { landmark: 'park' } },
  { id: 'aquarium', name: 'Aquarium', grants: { flag: 'zoo' } },
  { id: 'planetarium', name: 'Planetarium', grants: { landmark: 'observatory' } },
  { id: 'fireworks-guild', name: 'Fireworks Guild' },
  { id: 'grand-plaza', name: 'Grand Plaza', grants: { landmark: 'fountain' } },
  { id: 'monorail', name: 'Monorail' },
  { id: 'arcology-spire', name: 'Arcology Spire', grants: { landmark: 'spire' } },
  { id: 'worlds-fair', name: "World's Fair", grants: { flag: 'festival' } },
  { id: 'maglev-line', name: 'Maglev Line' },
  { id: 'spaceport', name: 'Spaceport', grants: { landmark: 'tower' } },
  { id: 'vertical-farm', name: 'Vertical Farm', grants: { landmark: 'dome' } },
  { id: 'holo-billboards', name: 'Holo Billboards', grants: { flag: 'nightlife' } },
  { id: 'sky-gardens', name: 'Sky Gardens', grants: { landmark: 'park' } },
  { id: 'fusion-plant', name: 'Fusion Plant' },
  { id: 'quantum-lab', name: 'Quantum Lab' },
  { id: 'orbital-ring', name: 'Orbital Ring' },
  { id: 'ai-foundry', name: 'AI Foundry' },
  { id: 'neural-grid', name: 'Neural Grid' },
  { id: 'sentient-transit', name: 'Sentient Transit' },
  { id: 'dream-engine', name: 'Dream Engine' },
  { id: 'the-archive', name: 'The Archive', grants: { landmark: 'monument' } },
  { id: 'the-spire', name: 'The Spire', grants: { landmark: 'spire' } },
  { id: 'the-countdown', name: 'The Countdown Begins' },
]

const BY_ID = new Map(GIFTS.map((g, i) => [g.id, { ...g, day: i + 1 }]))

export function defaultGifts() {
  return { claimedThroughDay: 0, unlocked: {}, last: null }
}

// 1-based day since install. Day 1 = install day. Clamped to >= 1; NaN inputs → day 1.
export function dayOf(installedAt, nowIso) {
  const a = Date.parse(installedAt)
  const n = Date.parse(nowIso)
  if (isNaN(a) || isNaN(n)) return 1
  return Math.max(1, Math.floor((n - a) / DAY_MS) + 1)
}

// Claim every unclaimed gift up to `day` (catches up after time away). Days beyond the catalog (60+)
// are NOT claimed here — the arc owns Day 60. Returns the new gifts block + the gifts just claimed.
export function claimGiftsUpTo(giftsState, day) {
  const prev = normalizeGifts(giftsState)
  const target = Math.min(day, GIFTS.length)
  if (target <= prev.claimedThroughDay) return { gifts: prev, claimed: [] }
  const unlocked = { ...prev.unlocked }
  const claimed = []
  for (let d = prev.claimedThroughDay + 1; d <= target; d++) {
    const g = { ...GIFTS[d - 1], day: d }
    unlocked[g.id] = true
    claimed.push(g)
  }
  const last = claimed.length ? claimed[claimed.length - 1] : prev.last
  return { gifts: { claimedThroughDay: target, unlocked, last }, claimed }
}

// Aggregate what the unlocked gifts grant: services (for boats/planes), landmark kinds, entity flags.
export function unlockedGrants(giftsState) {
  const { unlocked } = normalizeGifts(giftsState)
  const services = {}
  const landmarks = []
  const flags = {}
  for (const id of Object.keys(unlocked)) {
    const g = BY_ID.get(id)
    if (!g || !g.grants) continue
    if (g.grants.service) services[g.grants.service] = true
    if (g.grants.landmark) landmarks.push(g.grants.landmark)
    if (g.grants.flag) flags[g.grants.flag] = true
  }
  return { services, landmarks, flags }
}

function normalizeGifts(g) {
  const o = g && typeof g === 'object' ? g : {}
  return {
    claimedThroughDay: Number.isFinite(o.claimedThroughDay) ? o.claimedThroughDay : 0,
    unlocked: o.unlocked && typeof o.unlocked === 'object' ? { ...o.unlocked } : {},
    last: o.last ?? null,
  }
}
