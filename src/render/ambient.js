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

// A full-canvas tint by time of day PLUS the sun / moon arcing across the sky: deep blue night, a warm
// horizon glow at dawn/dusk, a clear wash at noon, and the sun (day) or moon (night) riding an arc. Pure
// screen-space; tod ∈ [0,1] (0 = midnight). Only arc/fill/fillRect/gradients — no ctx.ellipse.
export function drawDayNight(ctx, w, h, tod) {
  const t = ((tod % 1) + 1) % 1
  const elevation = Math.sin((t - 0.25) * Math.PI * 2) // -1 deepest night .. 0 horizon .. +1 noon
  const night = elevation < 0 ? -elevation : 0
  const day = elevation > 0 ? elevation : 0
  const twilight = Math.max(0, 1 - Math.abs(elevation) * 2.2) // warm band around the horizon

  // Base wash: deep blue by night, a barely-there warm-white by day.
  const base = ctx.createLinearGradient(0, 0, 0, h)
  if (night > 0) {
    const a = 0.44 * night
    base.addColorStop(0, `rgba(7,14,44,${a})`) // deepest overhead
    base.addColorStop(0.6, `rgba(14,26,66,${a * 0.78})`)
    base.addColorStop(1, `rgba(26,42,92,${a * 0.5})`) // lifts toward the ground
  } else {
    const a = 0.06 * day
    base.addColorStop(0, `rgba(255,250,235,${a})`)
    base.addColorStop(1, `rgba(255,244,218,${a * 0.5})`)
  }
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  // Dawn/dusk: a warm glow strongest low on the canvas (the horizon).
  if (twilight > 0) {
    const a = 0.26 * twilight
    const warm = ctx.createLinearGradient(0, h * 0.12, 0, h)
    warm.addColorStop(0, 'rgba(255,150,70,0)')
    warm.addColorStop(0.68, `rgba(255,128,62,${a * 0.5})`)
    warm.addColorStop(1, `rgba(255,96,48,${a})`)
    ctx.fillStyle = warm
    ctx.fillRect(0, 0, w, h)
  }

  // The sun rides an arc across the daytime sky (low at dawn/dusk, high at noon); warmer near the horizon.
  if (day > 0.02) {
    const frac = Math.max(0, Math.min(1, (t - 0.25) / 0.5)) // 0 sunrise → 1 sunset
    const sx = w * (0.12 + 0.76 * frac)
    const sy = h * 0.3 - day * h * 0.22
    const warmth = twilight
    const halo = ctx.createRadialGradient(sx, sy, 2, sx, sy, 78)
    halo.addColorStop(0, `rgba(255,${Math.round(240 - warmth * 70)},${Math.round(208 - warmth * 130)},${(0.45 * day + 0.2).toFixed(3)})`)
    halo.addColorStop(1, 'rgba(255,220,160,0)')
    ctx.fillStyle = halo
    ctx.fillRect(sx - 78, sy - 78, 156, 156)
    ctx.fillStyle = `rgba(255,${Math.round(248 - warmth * 50)},${Math.round(226 - warmth * 110)},0.95)`
    ctx.beginPath()
    ctx.arc(sx, sy, 13, 0, 7)
    ctx.fill()
  }

  // The moon rides the night-time arc (opposite side), with a soft halo + a crescent shadow.
  if (night > 0.04) {
    const nf = t >= 0.75 ? (t - 0.75) / 0.5 : (t + 0.25) / 0.5 // 0 dusk → 1 dawn across the night
    const mx = w * (0.12 + 0.76 * nf)
    const my = h * 0.28 - night * h * 0.2
    const halo = ctx.createRadialGradient(mx, my, 1, mx, my, 54)
    halo.addColorStop(0, `rgba(208,222,255,${(0.3 * night).toFixed(3)})`)
    halo.addColorStop(1, 'rgba(208,222,255,0)')
    ctx.fillStyle = halo
    ctx.fillRect(mx - 54, my - 54, 108, 108)
    ctx.fillStyle = `rgba(228,234,248,${Math.min(1, night * 1.4).toFixed(3)})`
    ctx.beginPath()
    ctx.arc(mx, my, 10, 0, 7)
    ctx.fill()
    ctx.fillStyle = `rgba(12,24,60,${(0.62 * night).toFixed(3)})` // offset disc carves a crescent
    ctx.beginPath()
    ctx.arc(mx + 4.5, my - 2, 9, 0, 7)
    ctx.fill()
  }
}

// A stable daily weather, varied day to day (deterministic from the UTC date so it's testable): mostly
// clear, with spells of overcast / rain / fog, and snow on winter days. The viewer clock picks the day.
export function weatherOf(ms) {
  const day = Math.floor((((ms % AMBIENT_DAY_MS) >= 0 ? ms : ms - AMBIENT_DAY_MS) / AMBIENT_DAY_MS))
  let hsh = (day * 2654435761) >>> 0
  hsh ^= hsh >>> 13
  const r = ((hsh >>> 0) % 1000) / 1000
  if (seasonOf(ms) === 'winter' && r < 0.45) return 'snow'
  if (r < 0.16) return 'rain'
  if (r < 0.29) return 'fog'
  if (r < 0.5) return 'overcast'
  return 'clear'
}

// Screen-space weather, advanced by `tick` (the frame count) over a constant-seeded field so every frame
// is deterministic. Accepts a weather OR season label: snow/winter, leaves/autumn, rain, fog, overcast,
// and clear/spring/summer/anything → a few slow clouds.
export function drawWeather(ctx, w, h, weather, tick) {
  const t = tick || 0
  const rnd = ambientPrng(AMBIENT_SEED)

  if (weather === 'rain') {
    ctx.fillStyle = 'rgba(42,48,60,0.16)' // overcast darkening behind the rain
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(175,195,224,0.42)'
    ctx.lineWidth = 1
    for (let i = 0; i < 100; i++) {
      const bx = rnd() * w
      const by = rnd()
      const fall = 7 + rnd() * 6 // fast streaks
      const x = (bx + w) % w
      const y = (by * (h + 24) + t * fall) % (h + 24)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x - 2.5, y + 9) // slight diagonal
      ctx.stroke()
    }
    return
  }

  if (weather === 'fog') {
    for (let b = 0; b < 3; b++) {
      const y = h * (0.46 + b * 0.16)
      const g = ctx.createLinearGradient(0, y - 48, 0, y + 48)
      g.addColorStop(0, 'rgba(214,220,230,0)')
      g.addColorStop(0.5, `rgba(214,220,230,${(0.24 - b * 0.05).toFixed(3)})`)
      g.addColorStop(1, 'rgba(214,220,230,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, y - 48, w, 96)
    }
    ctx.fillStyle = 'rgba(222,228,234,0.09)' // overall soft haze
    ctx.fillRect(0, 0, w, h)
    return
  }

  if (weather === 'winter' || weather === 'snow') {
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

  if (weather === 'autumn' || weather === 'leaves') {
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

  // overcast adds a flat grey wash before the clouds; clear/spring/summer/anything → just slow clouds.
  const overcast = weather === 'overcast'
  if (overcast) {
    ctx.fillStyle = 'rgba(84,92,104,0.17)'
    ctx.fillRect(0, 0, w, h)
  }
  const puffs = [[0, 0, 22], [20, -7, 18], [40, 3, 20], [16, 7, 15]]
  const clouds = overcast ? 5 : 3
  for (let i = 0; i < clouds; i++) {
    const scale = 0.8 + rnd() * 0.8
    const speed = 0.06 + rnd() * 0.1 // px per tick (calmed)
    const by = 24 + rnd() * (h * (overcast ? 0.42 : 0.28))
    const span = w + 180
    const x = ((rnd() * span + t * speed) % span) - 90
    ctx.fillStyle = overcast ? 'rgba(210,214,222,0.16)' : 'rgba(255,255,255,0.1)'
    for (const [dx, dy, r] of puffs) {
      ctx.beginPath()
      ctx.arc(x + dx * scale, by + dy * scale, r * scale, 0, 7)
      ctx.fill()
    }
  }
}

// The Outbreak: a sickly green-brown haze over the city, deepening at the edges, scaled by severity.
// Screen-space only; severity ∈ [0,1]. A no-op at 0 so a healthy city is untouched.
export function drawInfection(ctx, w, h, severity) {
  const s = severity > 0 ? (severity < 1 ? severity : 1) : 0
  if (s <= 0) return
  const vig = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.18, w / 2, h * 0.55, w * 0.72)
  vig.addColorStop(0, 'rgba(90,110,56,0)')
  vig.addColorStop(1, `rgba(64,84,40,${(0.5 * s).toFixed(3)})`)
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = `rgba(120,138,78,${(0.1 * s).toFixed(3)})` // faint overall sickly cast
  ctx.fillRect(0, 0, w, h)
}
