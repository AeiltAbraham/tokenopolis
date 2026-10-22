// Pure scene generator: cityState → a deterministic, renderer-agnostic scene description.
// No I/O, no clock, no Math.random (layout comes from a seeded PRNG). Same (cityState, seed) →
// deep-equal scene. The renderer (T-009) draws exactly the primitives listed here.
//
// Scene contract (the shape T-009 renders from):
//   {
//     scaleIndex, sizeIndex, scaleName, condition, vitality,  // sizeIndex = peak (the "bones")
//     conditionDamage (0..1), ruined (bool),                  // structural, NEVER color-only
//     footprint: { cols, rows },
//     buildings: [ { gx, gy, zone:'R'|'C'|'I'|'park', height, density, damage(0..1), collapsed } ],
//     underground: [ { level, extent } ], undergroundMore,     // deeper levels summarized
//     landmarks: [ { gx, gy, kind } ],
//     infrastructure: { power, water, transit, data },         // which tiers exist
//     aggregated (bool), lod:'detailed'|'aggregated', primitiveCount,
//   }
// Condition is encoded by STRUCTURE (damage/collapsed/height), so the city still reads correctly
// with the palette swapped for grayscale.

import { SCENE, CONDITIONS } from '../tuning.js'
import { scaleName as nameForScale, undergroundTiers } from '../sim/scale.js'

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const condIndexOf = (name) => Math.max(0, CONDITIONS.indexOf(name))
const DECLINING = CONDITIONS.indexOf('Declining')
const RUINS = CONDITIONS.indexOf('Ruins')

// Small, fast, deterministic PRNG (mulberry32).
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ZONE_BAG = ['R', 'R', 'R', 'C', 'C', 'I', 'park'] // rough RCI balance with the odd park

// Spatial hash (independent of the layout PRNG, so adding districts doesn't shift existing geometry).
const dhash = (a, b) => {
  let h = ((a * 73856093) ^ (b * 19349663)) >>> 0
  h ^= h >>> 13
  return ((h >>> 0) % 1000) / 1000
}

// sourceMix = fraction of burn from Claude Code (vs cornercase agents) → bigger "tech" district.
export function sceneFor(cityState, citySeed, sourceMix = 0.5) {
  const techShare = clamp01(sourceMix)
  const sizeIndex = Math.max(cityState.peakScaleIndex ?? cityState.scaleIndex ?? 0, 0) // bones = peak
  const effective = Math.max(0, cityState.scaleIndex ?? sizeIndex)
  const condIndex = condIndexOf(cityState.condition ?? 'Thriving')

  // Damage only from Declining onward; grows to 1 at Buried.
  const conditionDamage = condIndex < DECLINING ? 0 : clamp01((condIndex - (DECLINING - 1)) / (CONDITIONS.length - DECLINING))
  const ruined = condIndex >= RUINS
  // Collapse tracks how far the effective scale has fallen below the peak (the bones) — so a city
  // visibly rebuilds as it recovers, independent of the condition label.
  const collapseRatio = clamp01((sizeIndex - effective) / Math.max(1, sizeIndex))
  // Structural stress is the WORSE of slow decay (condition) and a sudden fall below peak — so a
  // disaster ("A Random Act") visibly wrecks buildings even while the condition label is still healthy.
  const stress = Math.max(conditionDamage, collapseRatio)
  // Survival signals (structural, grayscale-safe): windows get boarded up when the city is decaying
  // OR infected; nature reclaims it (overgrowth) when it's left stagnant or overrun by an outbreak.
  const infection = clamp01(cityState.infection?.severity ?? 0)
  const boardRatio = Math.max(conditionDamage, infection)
  const overgrowth = clamp01(Math.max((condIndex - condIndexOf('Stagnant')) / 3, infection * 0.7))

  // Conceptual building count can be astronomical; LOD caps the RENDERED primitives.
  const conceptual = Math.round(SCENE.baseBuildings * SCENE.buildingGrowth ** sizeIndex)
  const aggregated = conceptual > SCENE.lodDetailCap
  const count = Math.min(conceptual, SCENE.lodDetailCap)
  const perPrimitive = aggregated ? conceptual / count : 1
  const side = Math.max(1, Math.ceil(Math.sqrt(count)))
  const center = (side - 1) / 2

  const rnd = mulberry32((citySeed >>> 0) ^ 0x9e3779b9)
  const buildings = []
  for (let i = 0; i < count; i++) {
    const gx = i % side
    const gy = Math.floor(i / side)
    const dist = center > 0 ? Math.hypot(gx - center, gy - center) / center : 0
    const landValue = clamp01(1 - dist) // taller + denser toward the centre
    const zone = ZONE_BAG[Math.floor(rnd() * ZONE_BAG.length)]
    // Steeper height falloff: a towering downtown that steps down to low-rise outskirts.
    const baseHeight = zone === 'park' ? 0 : 1 + Math.round(landValue * landValue * (3 + sizeIndex * 1.25) + rnd() * 1.5)
    const dmgRnd = rnd()
    const vac = rnd()
    const damage = clamp01(stress * (0.6 + 0.8 * dmgRnd))
    const collapsed = dmgRnd < collapseRatio // buildings in the fallen gap become rubble (decay OR disaster)
    // Density gradient: the edge of the city is sparse — undeveloped lots thin out toward the outskirts
    // (common at the fringe, rare downtown), so the footprint reads as centre → outskirts, not a solid slab.
    const vacant = zone !== 'park' && !collapsed && vac > 0.42 + 0.5 * landValue
    // District (burn source): 3×3 blocks share a district → visible clusters; size scales with the mix.
    const district = dhash(Math.floor(gx / 3) * 131 + Math.floor(gy / 3), (citySeed >>> 0) ^ 0x51ed51ed) < techShare ? 'tech' : 'ops'
    const boarded = !collapsed && !vacant && baseHeight > 0 && dmgRnd < boardRatio // windows planked over (decay/outbreak)
    buildings.push({
      gx,
      gy,
      zone,
      district,
      height: vacant ? 0 : collapsed ? Math.max(0, Math.round(baseHeight * 0.3)) : baseHeight,
      density: aggregated ? Math.round(perPrimitive) : 1,
      damage,
      collapsed,
      boarded,
      vacant,
    })
  }

  const tiers = undergroundTiers(sizeIndex)
  const undergroundShown = Math.min(tiers, SCENE.undergroundRenderCap)
  const underground = []
  for (let l = 0; l < undergroundShown; l++) underground.push({ level: l + 1, extent: side })
  const undergroundMore = Math.max(0, tiers - undergroundShown)

  const landmarkCount = Math.min(SCENE.maxLandmarks, sizeIndex)
  const kinds = ['park', 'monument', 'stadium', 'tower']
  const landmarks = []
  for (let m = 0; m < landmarkCount; m++) {
    landmarks.push({ gx: Math.floor(rnd() * side), gy: Math.floor(rnd() * side), kind: kinds[m % kinds.length] })
  }
  // Gift landmarks (Phase 2): unlocked daily-gift structures, placed after the procedural ones so they
  // never shift existing geometry. Marked `gift` so the renderer draws them as distinct glyphs.
  const giftLandmarks = Array.isArray(cityState.giftLandmarks) ? cityState.giftLandmarks : []
  for (const kind of giftLandmarks) {
    landmarks.push({ gx: Math.floor(rnd() * side), gy: Math.floor(rnd() * side), kind, gift: true })
  }

  const infrastructure = {
    roads: true, // the first tier — present from the hamlet
    power: sizeIndex >= 1,
    water: sizeIndex >= 2,
    transit: sizeIndex >= 3,
    data: sizeIndex >= 4,
  }

  const primitiveCount = buildings.length + underground.length + landmarks.length
  return {
    seed: citySeed >>> 0, // exposed so the renderer can lay out this city's surrounding countryside deterministically
    scaleIndex: effective,
    sizeIndex,
    scaleName: nameForScale(sizeIndex),
    condition: cityState.condition ?? 'Thriving',
    vitality: cityState.vitality ?? 0,
    conditionDamage,
    ruined,
    overgrowth,
    infection,
    services: cityState.services ?? {}, // unlocked service gifts (harbour → boats, airport → planes, …)
    flags: cityState.giftFlags ?? {}, // gift entity boosts (aviary → birds, zoo → wildlife, festival → crowds)
    era: cityState.era ?? 'build', // 'build' | 'ascendant' (gleaming revamp) | 'fallout' (razed wasteland)
    pyromid: cityState.pyromid ?? null, // the datacenter landmark: { progress } (null → not placed)
    footprint: { cols: side, rows: Math.ceil(count / side) },
    buildings,
    underground,
    undergroundMore,
    landmarks,
    infrastructure,
    aggregated,
    lod: aggregated ? 'aggregated' : 'detailed',
    primitiveCount,
  }
}
