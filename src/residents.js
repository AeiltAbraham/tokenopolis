// Named residents + flavoured chronicle vignettes. PURE: no I/O, no clock, no Math.random — same inputs
// → same output, so the chronicle stays deterministic and the self-contained, offline artifact can render
// it with no network and no AI. The cast is seeded by citySeed; the vignettes turn the sim's transitions
// into little resident-voiced headlines. The sim appends these; this module only produces strings.

const NAMES = [
  'Maya', 'Tom', 'Priya', 'Kees', 'Aya', 'Rafa', 'Nina', 'Sam', 'Lin', 'Omar',
  'Juno', 'Vera', 'Theo', 'Esen', 'Mara', 'Ivo', 'Suki', 'Bram', 'Noor', 'Dag',
  'Pim', 'Rosa', 'Yuki', 'Cass', 'Fenna', 'Hugo', 'Isa', 'Mila',
]
const ARCHETYPES = {
  tech: ['engineer', 'night-owl coder', 'data gardener', 'roboticist', 'tinkerer'],
  ops: ['café owner', 'shopkeeper', 'courier', 'baker', 'foreman', 'gardener'],
}

const hash = (a, b) => {
  let x = ((a * 73856093) ^ (b * 19349663)) >>> 0
  x ^= x >>> 13
  x = Math.imul(x, 0x5bd1e995) >>> 0
  return (x >>> 0) % 100000 / 100000
}

// A deterministic cast, sized to the city: 2 at a hamlet, up to 10 at a metropolis. Names are unique.
// district = the burn source the resident belongs to (tech = Claude Code, ops = cornercase agents).
export function residentsFor(citySeed, scaleIndex = 0, sourceMix = 0.5) {
  const seed = (citySeed >>> 0) || 1
  const count = Math.max(2, Math.min(10, 2 + Math.max(0, Math.floor(scaleIndex))))
  const used = new Set()
  const out = []
  for (let i = 0; i < count; i++) {
    let ni = Math.floor(hash(seed, i * 7 + 1) * NAMES.length) % NAMES.length
    while (used.has(ni)) ni = (ni + 1) % NAMES.length
    used.add(ni)
    const district = hash(seed, i * 7 + 3) < sourceMix ? 'tech' : 'ops'
    const pool = ARCHETYPES[district]
    const archetype = pool[Math.floor(hash(seed, i * 7 + 5) * pool.length) % pool.length]
    out.push({ name: NAMES[ni], archetype, district })
  }
  return out
}

const where = (d) => (d === 'tech' ? 'the tech quarter' : 'the old works')

// Turn a sim transition into a resident-voiced line (or null to keep the event's default headline).
// `ctx` is the event's noun (the scale tier reached, the gift name, …). Deterministic.
export function vignette(type, ctx, residents, seed) {
  if (!Array.isArray(residents) || residents.length === 0) return null
  const r = residents[Math.floor(hash(seed, 101) * residents.length) % residents.length]
  const w = where(r.district)
  const pools = {
    scale: [
      `${r.name} opened up shop as ${w} grew into ${ctx}`,
      `${w} swelled into ${ctx} — ${r.name} the ${r.archetype} couldn't be prouder`,
      `${r.name} watched ${ctx} rise over the rooftops`,
    ],
    gift: [`${r.name} cut the ribbon on the ${ctx}`, `${r.name} the ${r.archetype} threw a party for the new ${ctx}`],
    recovery: [`${r.name} swept the streets — ${w} is breathing again`, `the lights came back over ${w}, and ${r.name} smiled`],
    ruin: [`${r.name} boarded the windows as the decline set in`, `${w} emptied out, but ${r.name} stayed behind`],
    milestone: [`word spread through ${w}: ${ctx}`, `${r.name} raised a glass — ${ctx}`],
    singularity: [`${r.name} looked up as the Pyromid blazed; nothing would be the same`],
    downfall: [`${r.name} fled ${w} as the sky turned to ash`],
    rebirth: [`${r.name} planted the first garden in ${ctx}`],
  }
  const pool = pools[type]
  if (!pool) return null
  return pool[Math.floor(hash(seed, 103) * pool.length) % pool.length]
}

// A small "nothing much happened" line so a quiet day's feed still breathes. Deterministic.
export function ambientVignette(residents, seed) {
  if (!Array.isArray(residents) || residents.length === 0) return null
  const r = residents[Math.floor(hash(seed, 201) * residents.length) % residents.length]
  const lines = [
    `A quiet day. ${r.name} the ${r.archetype} repainted the shutters.`,
    `${r.name} planted tomatoes on the roof.`,
    `${r.name} fed the city cats again.`,
    `Washing day in ${where(r.district)} — ${r.name} was out early.`,
    `${r.name} swept the square and watched the clouds.`,
    `${r.name} opened late; it was that kind of day.`,
  ]
  return lines[Math.floor(hash(seed, 203) * lines.length) % lines.length]
}
