// Day/night + seasonal weather ambience — pure screen-space overlays painted ON TOP of the rendered
// city (never scene geometry). No imports, no Node APIs: only the canvas 2D context and Math/Date, so
// this inlines into the artifact bundle alongside themes.js + draw.js (the inliner strips `export `).
// Alphas stay low so the skyline, lit windows and HUD remain readable through the wash.
//
// timeOfDay/seasonOf are pure functions of an epoch-ms timestamp (UTC, so they are deterministic and
// testable) — the artifact feeds them the viewer clock, Date.now(). drawWeather is deterministic too:
// its particle field is laid out by an internal PRNG seeded from a constant, then animated by `tick`,
// so every frame draws the same flakes/leaves/clouds advanced in time (no Math.random drift).

const AMBIENT_DAY_MS = 86_400_000
const AMBIENT_SEED = 0x9e3779b9 // golden-ratio constant — fixed so the field is identical every frame

// Fraction of the day in [0,1): 0 = midnight (UTC), 0.5 = noon. Safe for negative/large timestamps.
export function timeOfDay(ms) {
  const m = ((ms % AMBIENT_DAY_MS) + AMBIENT_DAY_MS) % AMBIENT_DAY_MS
  return m / AMBIENT_DAY_MS
}

// Northern-hemisphere meteorological season by UTC month.
export function seasonOf(ms) {
  const month = new Date(ms).getUTCMonth() // 0 = Jan
  if (month <= 1 || month === 11) return 'winter' // Dec, Jan, Feb
  if (month <= 4) return 'spring' // Mar, Apr, May
  if (month <= 7) return 'summer' // Jun, Jul, Aug
  return 'autumn' // Sep, Oct, Nov
}

// mulberry32 — a tiny, self-contained PRNG. Seeded from a constant so drawWeather is deterministic.
function ambientPrng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A subtle full-canvas tint by time of day: cool blue at night, a warm horizon glow at dawn/dusk, a
// faint clear wash at noon. Vertical gradients add depth; it paints screen-space only. tod ∈ [0,1].
export function drawDayNight(ctx, w, h, tod) {
  const t = ((tod % 1) + 1) % 1
  const elevation = Math.sin((t - 0.25) * Math.PI * 2) // -1 deepest night .. 0 horizon .. +1 noon
  const night = elevation < 0 ? -elevation : 0
  const day = elevation > 0 ? elevation : 0
  const twilight = Math.max(0, 1 - Math.abs(elevation) * 2.2) // warm band around the horizon

  // Base wash: cool blue by night, a barely-there warm-white by day.
  const base = ctx.createLinearGradient(0, 0, 0, h)
  if (night > 0) {
    const a = 0.3 * night
    base.addColorStop(0, `rgba(12,24,64,${a})`) // deeper blue up high
    base.addColorStop(1, `rgba(24,40,92,${a * 0.6})`) // lifts toward the ground
  } else {
    const a = 0.05 * day
    base.addColorStop(0, `rgba(255,250,235,${a})`)
    base.addColorStop(1, `rgba(255,244,218,${a * 0.5})`)
  }
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  // Dawn/dusk: a warm glow strongest low on the canvas (the horizon).
  if (twilight > 0) {
    const a = 0.18 * twilight
    const warm = ctx.createLinearGradient(0, 0, 0, h)
    warm.addColorStop(0, 'rgba(255,150,70,0)')
    warm.addColorStop(1, `rgba(255,138,58,${a})`)
    ctx.fillStyle = warm
    ctx.fillRect(0, 0, w, h)
  }
}

// Subtle seasonal particles, screen-space: snow in winter, drifting leaves in autumn, a couple of
// slow clouds otherwise. The field is seeded from a constant and advanced by `tick` (the frame count).
export function drawWeather(ctx, w, h, season, tick) {
  const t = tick || 0
  const rnd = ambientPrng(AMBIENT_SEED)

  if (season === 'winter') {
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    for (let i = 0; i < 46; i++) {
      const bx = rnd() * w
      const by = rnd()
      const fall = 0.5 + rnd() * 1.1 // px per tick
      const swayPhase = rnd() * Math.PI * 2
      const sz = 1 + Math.floor(rnd() * 2) // 1–2 px flakes
      const y = (by * (h + 8) + t * fall) % (h + 8)
      const x = (bx + Math.sin(t * 0.05 + swayPhase) * 7 + w) % w
      ctx.fillRect(x, y, sz, sz)
    }
    return
  }

  if (season === 'autumn') {
    const palette = ['#c9702a', '#b4532a', '#d9a441', '#9a6b2f']
    for (let i = 0; i < 26; i++) {
      const bx = rnd() * w
      const by = rnd()
      const fall = 0.35 + rnd() * 0.75
      const swayPhase = rnd() * Math.PI * 2
      const hue = Math.floor(rnd() * palette.length)
      const y = (by * (h + 10) + t * fall) % (h + 10)
      const x = (bx + Math.sin(t * 0.04 + swayPhase) * 14 + w) % w
      ctx.globalAlpha = 0.5
      ctx.fillStyle = palette[hue]
      ctx.fillRect(x, y, 3, 2) // a small flat leaf
      ctx.globalAlpha = 1
    }
    return
  }

  // spring / summer / anything else: a couple of slow drifting clouds.
  const puffs = [[0, 0, 22], [20, -7, 18], [40, 3, 20], [16, 7, 15]]
  for (let i = 0; i < 3; i++) {
    const scale = 0.8 + rnd() * 0.8
    const speed = 0.08 + rnd() * 0.14 // px per tick
    const by = 28 + rnd() * (h * 0.28)
    const span = w + 180
    const x = ((rnd() * span + t * speed) % span) - 90
    ctx.fillStyle = 'rgba(255,255,255,0.1)'
    for (const [dx, dy, r] of puffs) {
      ctx.beginPath()
      ctx.arc(x + dx * scale, by + dy * scale, r * scale, 0, 7)
      ctx.fill()
    }
  }
}
