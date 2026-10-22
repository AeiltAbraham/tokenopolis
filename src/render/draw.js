// Isometric renderer. Draws a scene (from scene.js) onto a canvas 2D context — in the browser inside
// the artifact, and under a recording-stub ctx in tests. Only import is ./themes.js (both are inlined
// into the artifact). GEOMETRY depends on the scene + tick ONLY (never the palette): colors/gradients
// are style, so the city stays legible in grayscale and condition shows through STRUCTURE (height,
// damage cracks, collapsed rubble, lit-window bloom). Layer order is marked via the optional
// ctx.__layer hook (a no-op in the browser) so tests can assert z-order.

import { resolveTheme } from './themes.js'

const TILE_W = 32
const TILE_H = 16
const FLOOR_H = 10

const mark = (ctx, layer) => {
  if (typeof ctx.__layer === 'function') ctx.__layer(layer)
}
const iso = (gx, gy, ox, oy) => ({ x: ox + (gx - gy) * (TILE_W / 2), y: oy + (gx + gy) * (TILE_H / 2) })
// Window lighting (and street activity) track the LOCAL CLOCK, not the frame tick — so lights hold steady
// and never flicker. hourOf maps a 0..1 time-of-day to 0..24; kfLerp interpolates piecewise-linear
// keyframes [hour, value]. Both curves are pure + exported for unit tests.
const hourOf = (tod) => ((((tod % 1) + 1) % 1) * 24)
const kfLerp = (kf, x) => {
  if (x <= kf[0][0]) return kf[0][1]
  for (let i = 1; i < kf.length; i++) {
    if (x <= kf[i][0]) return kf[i - 1][1] + (kf[i][1] - kf[i - 1][1]) * ((x - kf[i - 1][0]) / (kf[i][0] - kf[i - 1][0]))
  }
  return kf[kf.length - 1][1]
}
// Fraction of a building's windows lit as the clock turns: near-dark by day (a few always-on lights),
// filling in through dusk to an evening peak, then thinning after ~23:00 as people go to sleep.
const LAMP_KF = [[0, 0.14], [3, 0.07], [5, 0.1], [7, 0.11], [10, 0.05], [13, 0.05], [16, 0.08], [18, 0.26], [20, 0.52], [22, 0.6], [23, 0.5], [24, 0.14]]
// How busy the streets are: full by day, winding down through the evening, quiet from ~23:00 through the
// small hours, picking back up at dawn. Scales citizen + flock counts so movement dies down at night.
const ACTIVITY_KF = [[0, 0.25], [5, 0.22], [7, 0.9], [9, 1], [17, 1], [19, 0.85], [21, 0.7], [23, 0.45], [24, 0.25]]
export const lampFraction = (tod) => kfLerp(LAMP_KF, hourOf(tod))
export const streetActivity = (tod) => kfLerp(ACTIVITY_KF, hourOf(tod))
// A window is lit when its fixed "personality" (base) falls under the hour's lit fraction — so a window
// that comes on at dusk stays on into the evening, then goes dark as the fraction falls (steady, not
// random). A slow 5-minute wobble flips the odd window on/off. Depends on the CLOCK, never the tick.
const litWindow = (gx, gy, f, tod) => {
  const base = srnd(gx * 7 + gy * 13 + f * 17, 2)
  const slot = Math.floor(hourOf(tod) * 12) // 5-minute slots (12/hour) — the occasional, slow flip
  const jitter = (srnd(gx * 131 + gy * 57 + f * 19, slot) - 0.5) * 0.1
  return base < lampFraction(tod) + jitter
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  const clamp = (v) => Math.max(0, Math.min(255, v))
  const r = clamp((n >> 16) + amt)
  const g = clamp(((n >> 8) & 255) + amt)
  const b = clamp((n & 255) + amt)
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}
// Blend two hex colors (t=0 → a, t=1 → b) — used to tint roofs by district.
function mix(a, b, t) {
  const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16)
  const ch = (sh) => Math.round(((na >> sh) & 255) * (1 - t) + ((nb >> sh) & 255) * t)
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')
}
// District roof hue: Claude Code "tech" (cyan) vs cornercase-agent "ops/industry" (amber).
const DISTRICT_HUE = { tech: '#39d0ff', ops: '#ffb347' }
const isNight = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return (n >> 16) + ((n >> 8) & 255) + (n & 255) < 320
}
const srnd = (a, b) => {
  let h = ((a * 73856093) ^ (b * 19349663)) >>> 0
  h ^= h >>> 13
  return (h >>> 0) % 1000 / 1000
}

function diamond(ctx, x, y, hw, hh) {
  ctx.beginPath()
  ctx.moveTo(x, y - hh)
  ctx.lineTo(x + hw, y)
  ctx.lineTo(x, y + hh)
  ctx.lineTo(x - hw, y)
  ctx.closePath()
}
function vgrad(ctx, x0, y0, x1, y1, c0, c1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  g.addColorStop(0, c0)
  g.addColorStop(1, c1)
  return g
}

// Logical render space. The city is always drawn in 960×640 logical units; the artifact's frame() scales
// that onto a higher-resolution backing canvas (and through the zoom) via ctx.setTransform, so the whole
// scene — including the Pyromid anchor and the zoom math — shares ONE coordinate system.
export const LOGICAL_W = 960
export const LOGICAL_H = 640

export function drawCity(ctx, scene, theme, tick = 0, tod = 0.5) {
  const p = theme && typeof theme === 'object' ? theme : resolveTheme(theme)
  const W = LOGICAL_W
  const H = LOGICAL_H
  const ox = W / 2
  const oy = H * 0.3
  const stale = (scene.vitality ?? 0) < 0.34
  const night = isNight(p.sky)

  // --- sky (vertical gradient) ---
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, shade(p.sky, night ? 16 : -40))
  sky.addColorStop(0.62, p.sky)
  sky.addColorStop(1, shade(p.sky, night ? -10 : 22))
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)
  if (night) {
    for (let i = 0; i < 70; i++) {
      if (srnd(i + tick, 3) > 0.55) {
        ctx.fillStyle = rgba('#ffffff', 0.5 + 0.4 * srnd(i, 9))
        ctx.fillRect(Math.floor(srnd(i, 1) * W), Math.floor(srnd(i, 2) * H * 0.5), 1, 1)
      }
    }
  }

  mark(ctx, 'underground')
  for (const u of scene.underground) {
    const bandY = oy + scene.footprint.rows * (TILE_H / 2) + 10 + u.level * 9
    const ux = ox - u.extent * (TILE_W / 2)
    ctx.fillStyle = vgrad(ctx, ox, bandY, ox, bandY + 8, shade(p.underground, 10), shade(p.underground, -22))
    ctx.fillRect(ux, bandY, u.extent * TILE_W, 8)
    ctx.fillStyle = rgba(p.accent, 0.5)
    for (let k = 1; k < u.extent; k += 2) ctx.fillRect(ux + k * TILE_W, bandY + 3, 2, 2)
  }

  mark(ctx, 'ground')
  const span = Math.max(scene.footprint.cols, scene.footprint.rows)
  const gcy = oy + span * (TILE_H / 2)
  const ghw = span * (TILE_W / 2) + TILE_W
  const ghh = span * (TILE_H / 2) + TILE_H
  drawCountryside(ctx, scene, p, ox, gcy, ghw, ghh) // the landscape the city sits in: fields, forest, water, roads out, distant towns
  ctx.fillStyle = shade(p.ground, -48) // plate rim for depth
  diamond(ctx, ox, gcy + 6, ghw, ghh)
  ctx.fill()
  ctx.fillStyle = vgrad(ctx, ox, gcy - ghh, ox, gcy + ghh, shade(p.ground, 16), shade(p.ground, -18))
  diamond(ctx, ox, gcy, ghw, ghh)
  ctx.fill()

  mark(ctx, 'roads')
  if (scene.infrastructure.roads) {
    // paved streets tied to the ground palette and kept soft, so the grid reads as avenues between
    // blocks rather than a hard grey lattice (very visible now the outskirts have open lots).
    ctx.strokeStyle = rgba(shade(p.ground, -20), 0.5)
    ctx.lineWidth = 2
    const n = Math.max(scene.footprint.cols, scene.footprint.rows)
    for (let g = 0; g <= n; g++) {
      const a = iso(g, 0, ox, oy)
      const b = iso(g, n, ox, oy)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      const c = iso(0, g, ox, oy)
      const d = iso(n, g, ox, oy)
      ctx.beginPath()
      ctx.moveTo(c.x, c.y)
      ctx.lineTo(d.x, d.y)
      ctx.stroke()
    }
    ctx.lineWidth = 1
    const tiers = ['power', 'water', 'transit', 'data'].filter((t) => scene.infrastructure[t])
    for (let i = 0; i < tiers.length; i++) {
      ctx.fillStyle = p.accent
      ctx.fillRect(10 + i * 11, H - 16, 6, 6)
    }
  }

  mark(ctx, 'buildings')
  const order = [...scene.buildings].sort((a, b) => a.gx + a.gy - (b.gx + b.gy))
  // Pass 1: cast shadows pool on the ground (the sun is upper-left), so each building sits atop its own
  // AND its neighbours' shadows — a big depth cue. Flat parks and rubble cast nothing.
  for (const b of order) if (b.height > 0 && !b.collapsed && b.zone !== 'park') drawShadow(ctx, b, ox, oy)
  // Pass 2: the buildings themselves, back-to-front.
  for (const b of order) drawBuilding(ctx, b, p, ox, oy, tick, stale, scene.infection ?? 0, tod)

  mark(ctx, 'landmarks')
  for (const l of scene.landmarks) drawLandmark(ctx, l, p, ox, oy, tick)
  drawPyromid(ctx, scene, tick) // the datacenter centrepiece — rises with its build progress
  drawOvergrowth(ctx, scene, ox, oy) // nature reclaims a stagnant/overrun city

  mark(ctx, 'citizens')
  drawStreetFurniture(ctx, scene, ox, oy) // static trees + lamps lining the avenues (behind the moving life)
  drawCitizens(ctx, scene, p, ox, oy, tick, stale, tod)
  drawAnimals(ctx, scene, ox, oy, tick, stale, tod)
  drawVehicles(ctx, scene, ox, oy, tick, stale)

  mark(ctx, 'overlay')
  // --- post-process: a warm key-light wash from the sun side, then a vignette for depth/mood ---
  const sun = ctx.createRadialGradient(ox - W * 0.22, oy - H * 0.05, 10, ox - W * 0.22, oy - H * 0.05, W * 0.72)
  sun.addColorStop(0, night ? 'rgba(150,170,255,0.06)' : 'rgba(255,238,200,0.13)')
  sun.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sun
  ctx.fillRect(0, 0, W, H)
  const vg = ctx.createRadialGradient(ox, oy + H * 0.2, H * 0.16, ox, oy + H * 0.2, H * 0.85)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(0.68, 'rgba(0,0,0,0)')
  vg.addColorStop(1, night ? 'rgba(0,0,0,0.56)' : 'rgba(10,12,22,0.34)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, W, H)
}

// Life signal: pedestrians (small accent dots) and the odd car move along the road grid, animated by
// tick. Count scales with the footprint, capped for LOD. Deterministic per-citizen via srnd (no state).
const CAR_COLORS = ['#ffd76a', '#ff6a8a', '#6ad7ff', '#e8ecf2']
function drawCitizens(ctx, scene, p, ox, oy, tick, stale, tod = 0.5) {
  if (stale) return // a stale/decaying city empties its streets — and keeps frames still
  const n = Math.max(scene.footprint?.cols ?? 0, scene.footprint?.rows ?? 0)
  if (n < 1) return
  if ((scene.infection ?? 0) >= 0.5) { drawShamblers(ctx, scene, ox, oy, tick); return } // outbreak: traffic gone, a few shamblers
  // Density scales with the metrics: a bigger, livelier city teems; a sleepy one goes quiet.
  // A festival gift (market, marathon, World's Fair) thickens the crowd.
  const vit = scene.vitality ?? 1
  const fest = scene.flags && scene.flags.festival ? 1.4 : 1
  // Streets thin out at night and refill by day (the clock, not the tick → the thinning is steady).
  const count = Math.min(240, Math.round((10 + n * 8) * (0.35 + 0.65 * vit) * (1 + (scene.scaleIndex ?? 0) * 0.14) * fest * streetActivity(tod)))
  for (let i = 0; i < count; i++) {
    const onX = srnd(i, 1) < 0.5 // move along the gx axis (true) or the gy axis (false)
    const lane = Math.round(srnd(i, 2) * n) // which road (grid line)
    const car = srnd(i, 3) > 0.74
    const dir = srnd(i, 5) > 0.5 ? 1 : -1
    const speed = car ? 0.008 : 0.004
    const f = (((srnd(i, 6) + dir * tick * speed) % 1) + 1) % 1
    const pos = onX ? iso(f * n, lane, ox, oy) : iso(lane, f * n, ox, oy)
    if (car) {
      ctx.fillStyle = rgba('#05070c', 0.3) // little contact shadow
      ctx.fillRect(pos.x - 2, pos.y, 5, 2)
      ctx.fillStyle = CAR_COLORS[i % CAR_COLORS.length] // body
      ctx.fillRect(pos.x - 2, pos.y - 2, 5, 3)
      ctx.fillStyle = 'rgba(255,255,255,0.35)' // roof/windshield glint
      ctx.fillRect(pos.x - 1, pos.y - 2, 3, 1)
      ctx.fillStyle = dir > 0 ? 'rgba(255,240,180,0.95)' : 'rgba(255,90,80,0.9)' // head/tail light
      ctx.fillRect(pos.x + (dir > 0 ? 2 : -2), pos.y - 1, 1, 1)
    } else {
      ctx.fillStyle = rgba(p.accent, 0.9)
      ctx.fillRect(pos.x - 1, pos.y - 2, 2, 3) // a taller dot reads more as a person
    }
  }
}

// Static street dressing: trees and warm streetlights punctuate the avenues. Tick-independent (seeded by
// position) so stale frames hold still; thinned as nature reclaims an overgrown city.
function drawStreetFurniture(ctx, scene, ox, oy) {
  const n = Math.max(scene.footprint?.cols ?? 0, scene.footprint?.rows ?? 0)
  if (n < 2) return
  const keep = 0.85 - Math.min(0.72, (scene.overgrowth ?? 0) * 0.85) // nature reclaims it: more overgrowth → fewer survive
  for (let gx = 0; gx <= n; gx++) {
    for (let gy = 0; gy <= n; gy++) {
      const r = srnd(gx * 2 + 1, gy * 2 + 3)
      if (r > keep) continue
      const pt = iso(gx, gy, ox, oy)
      if (r < keep * 0.5) {
        // a tree: trunk + a two-tone canopy
        ctx.fillStyle = 'rgba(70,52,34,0.9)'; ctx.fillRect(pt.x - 1, pt.y - 5, 2, 5)
        ctx.fillStyle = 'rgba(54,104,50,0.92)'; ctx.beginPath(); ctx.arc(pt.x, pt.y - 7, 4, 0, 6.3); ctx.fill()
        ctx.fillStyle = 'rgba(100,154,84,0.85)'; ctx.beginPath(); ctx.arc(pt.x - 1.2, pt.y - 8, 2, 0, 6.3); ctx.fill()
      } else {
        // a streetlight: a thin pole + a warm lamp head
        ctx.strokeStyle = 'rgba(38,42,52,0.85)'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(pt.x, pt.y - 9); ctx.stroke()
        ctx.fillStyle = 'rgba(255,214,120,0.95)'; ctx.fillRect(pt.x - 1, pt.y - 10, 2, 2)
        ctx.fillStyle = 'rgba(255,214,120,0.22)'; ctx.beginPath(); ctx.arc(pt.x, pt.y - 9, 4, 0, 6.3); ctx.fill()
      }
    }
  }
}

// Outbreak: a few sickly-green figures shuffle the empty roads, slow and erratic.
function drawShamblers(ctx, scene, ox, oy, tick) {
  const n = Math.max(scene.footprint?.cols ?? 0, scene.footprint?.rows ?? 0)
  if (n < 1) return
  const count = Math.round(4 + (scene.infection ?? 0) * 12)
  for (let i = 0; i < count; i++) {
    const onX = srnd(i, 29) < 0.5
    const lane = Math.round(srnd(i, 31) * n)
    const dir = srnd(i, 41) > 0.5 ? 1 : -1
    const wobble = Math.sin(tick * 0.09 + i) * 0.015
    const f = (((srnd(i, 37) + dir * tick * 0.0025 + wobble) % 1) + 1) % 1
    const pos = onX ? iso(f * n, lane, ox, oy) : iso(lane, f * n, ox, oy)
    ctx.fillStyle = 'rgba(122,150,86,0.92)'
    ctx.fillRect(pos.x - 1, pos.y - 2, 2, 3)
  }
}

// Nature reclaims a stagnant or overrun city: moss patches on the ground + a scatter of saplings.
function drawOvergrowth(ctx, scene, ox, oy) {
  const og = scene.overgrowth || 0
  if (og <= 0) return
  const n = Math.max(scene.footprint?.cols ?? 0, scene.footprint?.rows ?? 0)
  const patches = Math.round(og * n * n * 0.6)
  for (let i = 0; i < patches; i++) {
    const gx = Math.floor(srnd(i, 7) * n)
    const gy = Math.floor(srnd(i, 11) * n)
    const pt = iso(gx, gy, ox, oy)
    ctx.fillStyle = rgba('#3f7a34', 0.5)
    ctx.beginPath()
    ctx.arc(pt.x, pt.y + 2, 4, 0, 6.3)
    ctx.fill()
    if (srnd(i, 13) > 0.5) {
      ctx.fillStyle = rgba('#5ea34a', 0.65)
      ctx.fillRect(pt.x - 1, pt.y - 4, 2, 5) // a sapling
    }
  }
}

// Life above the streets: bird flocks drift the sky (more when lively) and a little wildlife wanders the
// green ground (more when overgrown). Quiet when the city is stale or during an outbreak.
function drawAnimals(ctx, scene, ox, oy, tick, stale, tod = 0.5) {
  if (stale || (scene.infection ?? 0) >= 0.5) return
  const n = Math.max(scene.footprint?.cols ?? 0, scene.footprint?.rows ?? 0)
  if (n < 1) return
  const W = LOGICAL_W
  const vit = scene.vitality ?? 1
  // An aviary gift fills the sky with more flocks; a zoo/aquarium gift puts wildlife on the ground.
  const aviary = scene.flags && scene.flags.aviary ? 1.8 : 1
  const flocks = Math.round((2 + vit * 4) * aviary * streetActivity(tod)) // fewer birds aloft at night
  ctx.strokeStyle = 'rgba(40,40,52,0.55)'
  ctx.lineWidth = 1
  for (let i = 0; i < flocks; i++) {
    const r = srnd(i, 51), r2 = srnd(i, 57)
    const baseY = 16 + r * 70
    const cx = (((srnd(i, 53) * (W + 80)) + tick * (0.1 + r2 * 0.2)) % (W + 80)) - 40
    const birds = 3 + Math.floor(r2 * 3)
    for (let b = 0; b < birds; b++) {
      const bx = cx + b * 7 - birds * 3
      const by = baseY + Math.sin(tick * 0.05 + b + i) * 2 + (b % 2) * 3
      ctx.beginPath()
      ctx.moveTo(bx - 2, by)
      ctx.lineTo(bx, by - 1.5)
      ctx.lineTo(bx + 2, by)
      ctx.stroke()
    }
  }
  const zoo = scene.flags && scene.flags.zoo ? 5 : 0
  const critters = Math.round((scene.overgrowth ?? 0) * 6) + zoo
  for (let i = 0; i < critters; i++) {
    const pt = iso(Math.floor(srnd(i, 61) * n), Math.floor(srnd(i, 67) * n), ox, oy)
    ctx.fillStyle = 'rgba(150,120,80,0.85)'
    ctx.fillRect(pt.x + Math.sin(tick * 0.02 + i) * 3, pt.y - 2, 3, 2)
  }
}

// Service traffic, each gated on its unlocked gift (Phase 2 populates scene.services): planes cross the
// high sky when there's an airport; boats drift the offshore water when there's a harbour.
function drawVehicles(ctx, scene, ox, oy, tick, stale) {
  if (stale) return
  const serv = scene.services || {}
  const W = LOGICAL_W
  const H = LOGICAL_H
  if (serv.airport) {
    for (let i = 0; i < 2; i++) {
      const y = 28 + i * 22
      const x = (((i * 420) + tick * (0.45 + i * 0.12)) % (W + 120)) - 60
      ctx.fillStyle = 'rgba(222,228,238,0.9)'
      ctx.fillRect(x, y, 10, 2)
      ctx.fillRect(x + 3, y - 2, 3, 2)
      ctx.fillStyle = tick % 2 ? '#ff5a5a' : 'rgba(255,90,90,0.3)'
      ctx.fillRect(x, y, 1, 1)
    }
  }
  if (serv.harbour) {
    for (let i = 0; i < 5; i++) {
      const r = srnd(i, 71)
      const bx = 40 + ((srnd(i, 73) * (W - 80) + tick * (0.08 + r * 0.12)) % (W - 80))
      const by = H - 38 - r * 46
      ctx.fillStyle = 'rgba(180,200,224,0.12)' // shimmering reflection on the water
      ctx.fillRect(bx + 1, by + 3, 6, 5 + Math.round(r * 4))
      ctx.fillStyle = 'rgba(255,255,255,0.1)' // wake
      ctx.fillRect(bx - 3, by + 1, 3, 1)
      ctx.fillStyle = 'rgba(70,92,112,0.95)' // hull
      ctx.fillRect(bx, by, 8, 3)
      ctx.fillStyle = 'rgba(210,218,228,0.85)'
      ctx.fillRect(bx + 3, by - 4, 1, 4) // mast
    }
  }
}

// The landscape the city sits in: a broad field plate beyond the city, with a patchwork of parcels, a
// river, forest clusters, roads leading out, and a couple of distant towns on the horizon ("the space
// between cities"). Deterministic (seeded by the city + position) and tick-independent (stale-safe); the
// GEOMETRY never depends on the palette (grayscale guard), only the fill colours do. No ctx.ellipse.
function drawCountryside(ctx, scene, p, ox, gcy, ghw, ghh) {
  const seed = (scene.seed >>> 0) || 0
  const sr = (a, b) => srnd(a + seed, b)
  const ew = ghw * 1.95, eh = ghh * 1.95
  const onPlate = (px, py) => Math.abs(px - ox) / ghw + Math.abs(py - gcy) / ghh < 1.04

  // broad surrounding fields
  ctx.fillStyle = vgrad(ctx, ox, gcy - eh, ox, gcy + eh, shade(p.zone.park, 8), shade(p.zone.park, -28))
  diamond(ctx, ox, gcy + 5, ew, eh)
  ctx.fill()

  // farmland parcels — a faint patchwork of lighter/darker green in the surrounding ring
  for (let i = 0; i < 44; i++) {
    const a = sr(i, 1), ang = sr(i, 2) * 6.2832, rad = 0.52 + a * 0.46
    const px = ox + Math.cos(ang) * ew * rad * 0.72
    const py = gcy + Math.sin(ang) * eh * rad * 0.72
    if (onPlate(px, py)) continue // clear of the plate
    ctx.fillStyle = rgba(sr(i, 3) > 0.5 ? shade(p.zone.park, 16) : shade(p.zone.park, -18), 0.5)
    diamond(ctx, px, py, 15 + a * 13, 8 + a * 6)
    ctx.fill()
  }

  // forest clusters
  for (let i = 0; i < 20; i++) {
    const a = sr(i, 11), ang = sr(i, 13) * 6.2832, rad = 0.58 + a * 0.42
    const px = ox + Math.cos(ang) * ew * rad * 0.72
    const py = gcy + Math.sin(ang) * eh * rad * 0.72
    if (onPlate(px, py)) continue
    const trees = 3 + Math.floor(a * 4)
    for (let t = 0; t < trees; t++) {
      const tx = px + (sr(i * 9 + t, 17) - 0.5) * 22
      const ty = py + (sr(i * 9 + t, 19) - 0.5) * 13
      ctx.fillStyle = 'rgba(42,84,42,0.5)'
      ctx.fillRect(tx - 1, ty, 2, 2)
      ctx.fillStyle = 'rgba(52,100,50,0.92)'
      ctx.beginPath()
      ctx.moveTo(tx, ty - 8)
      ctx.lineTo(tx - 3.5, ty)
      ctx.lineTo(tx + 3.5, ty)
      ctx.closePath()
      ctx.fill()
    }
  }

  // country lanes easing out of the city toward the horizon: each a soft paved strip that tapers with
  // distance (perspective) and fades into the fields, rather than a hard grey line. Ground-palette tinted.
  for (const [dx, dy] of [[-1, -0.35], [1, -0.22], [0.35, 1]]) {
    const nx = ox + dx * ghw * 0.55, ny = gcy + dy * ghh * 0.55 // near the city edge
    const fx = ox + dx * ew * 0.98, fy = gcy + dy * eh * 0.98 // out at the horizon
    const len = Math.hypot(fx - nx, fy - ny) || 1
    const pxp = -(fy - ny) / len, pyp = (fx - nx) / len // unit perpendicular
    const wN = 6, wF = 1 // wide near, narrow far
    const lane = vgrad(ctx, nx, ny, fx, fy, rgba(shade(p.ground, -26), 0.7), rgba(shade(p.ground, -8), 0))
    ctx.fillStyle = lane
    ctx.beginPath()
    ctx.moveTo(nx + pxp * wN, ny + pyp * wN)
    ctx.lineTo(fx + pxp * wF, fy + pyp * wF)
    ctx.lineTo(fx - pxp * wF, fy - pyp * wF)
    ctx.lineTo(nx - pxp * wN, ny - pyp * wN)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = rgba(shade(p.ground, 22), 0.16) // a faint sunlit centre crown
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(nx, ny)
    ctx.lineTo(fx, fy)
    ctx.stroke()
  }

  // distant towns — tiny clusters on the horizon
  for (let s = 0; s < 3; s++) {
    const ang = (0.18 + s * 0.3) * Math.PI
    const px = ox + Math.cos(ang) * ew * 0.9
    const py = gcy - eh * (0.46 + sr(s, 29) * 0.28)
    for (let k = 0; k < 5; k++) {
      const bx = px + (sr(s * 5 + k, 31) - 0.5) * 26
      const bh = 3 + Math.floor(sr(s * 5 + k, 37) * 6)
      ctx.fillStyle = rgba(shade(p.roof, -8), 0.55)
      ctx.fillRect(bx, py - bh, 3, bh)
    }
  }
}

// Cast shadow for a building: the sun is upper-left, so the shadow is the base footprint swept down-right,
// longer for taller buildings. Geometry depends on height + position only (grayscale/stale-safe).
function drawShadow(ctx, b, ox, oy) {
  const { x, y } = iso(b.gx, b.gy, ox, oy)
  const hw = TILE_W / 2, hh = TILE_H / 2
  const h = b.height * FLOOR_H
  const dx = 6 + h * 0.5, dy = 3 + h * 0.22 // reach, down-right, scaling with height
  ctx.fillStyle = rgba('#05070c', 0.2)
  ctx.beginPath()
  ctx.moveTo(x - hw, y) // base: left → bottom → right (the lit-away edges)
  ctx.lineTo(x, y + hh)
  ctx.lineTo(x + hw, y)
  ctx.lineTo(x + hw + dx, y + dy) // swept copy, offset down-right
  ctx.lineTo(x + dx, y + hh + dy)
  ctx.lineTo(x - hw + dx, y + dy)
  ctx.closePath()
  ctx.fill()
}

// Per-building seeded style (stable across ticks + palettes): 0 flat/parapet, 1 pitched, 2 stepped setback.
const roofStyle = (b) => (b.height >= 2 ? Math.floor(srnd(b.gx * 3 + 1, b.gy * 3 + 7) * 3) : 0)

function drawBuilding(ctx, b, p, ox, oy, tick, stale, infection = 0, tod = 0.5) {
  const { x, y } = iso(b.gx, b.gy, ox, oy)
  const hw = TILE_W / 2
  const hh = TILE_H / 2
  const h = b.height * FLOOR_H

  // An undeveloped lot on the outskirts: bare ground with a little gravel/weeds — not a building.
  if (b.vacant) {
    ctx.fillStyle = vgrad(ctx, x, y - hh, x, y + hh, shade(p.ground, -4), shade(p.ground, -24))
    diamond(ctx, x, y, hw, hh)
    ctx.fill()
    if (srnd(b.gx + 3, b.gy + 5) > 0.5) {
      ctx.fillStyle = rgba('#6a7a46', 0.45)
      ctx.fillRect(x - 3, y - 1, 2, 2)
      ctx.fillRect(x + 2, y + 1, 2, 2)
    }
    return
  }

  if (b.zone === 'park') {
    ctx.fillStyle = vgrad(ctx, x, y - hh, x, y + hh, shade(p.zone.park, 20), shade(p.zone.park, -14))
    diamond(ctx, x, y, hw, hh)
    ctx.fill()
    for (const [dx, dy] of [[-5, 1], [5, -2]]) {
      ctx.fillStyle = shade(p.zone.park, -48)
      ctx.fillRect(x + dx - 1, y + dy - 6, 2, 6)
      ctx.fillStyle = shade(p.zone.park, -22)
      ctx.beginPath()
      ctx.arc(x + dx, y + dy - 7, 4, 0, 7)
      ctx.fill()
      ctx.fillStyle = shade(p.zone.park, 8)
      ctx.beginPath()
      ctx.arc(x + dx - 1, y + dy - 8, 2, 0, 7)
      ctx.fill()
    }
    return
  }

  const base = p.zone[b.zone] ?? p.zone.R
  // per-zone roof: warm residential, cool-glass commercial, flat-dark industrial
  let roofColor = b.zone === 'C' ? shade(p.zone.C, -24) : b.zone === 'I' ? shade(p.zone.I, -36) : p.roof
  // District flavour: a gentle roof tint toward the burn source's hue (cosmetic, grayscale-safe).
  if (b.district && DISTRICT_HUE[b.district]) roofColor = mix(roofColor, DISTRICT_HUE[b.district], 0.22)
  // left (sunlit) face — brighter, with a stronger top-to-bottom falloff for sculpted depth
  ctx.fillStyle = vgrad(ctx, x, y - h, x, y, shade(base, 30), shade(base, -20))
  ctx.beginPath()
  ctx.moveTo(x - hw, y)
  ctx.lineTo(x, y + hh)
  ctx.lineTo(x, y + hh - h)
  ctx.lineTo(x - hw, y - h)
  ctx.closePath()
  ctx.fill()
  // right (shadow) face — deeper shade so the two faces read as a lit solid
  ctx.fillStyle = vgrad(ctx, x, y - h, x, y, shade(base, -40), shade(base, -66))
  ctx.beginPath()
  ctx.moveTo(x + hw, y)
  ctx.lineTo(x, y + hh)
  ctx.lineTo(x, y + hh - h)
  ctx.lineTo(x + hw, y - h)
  ctx.closePath()
  ctx.fill()
  // contact shading: a touch darker where the two faces meet the ground (ambient occlusion)
  ctx.strokeStyle = rgba('#05070c', 0.3)
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x - hw, y)
  ctx.lineTo(x, y + hh)
  ctx.lineTo(x + hw, y)
  ctx.stroke()
  ctx.lineWidth = 1
  // roof (per-zone colour)
  const ry = y - h
  ctx.fillStyle = vgrad(ctx, x, ry - hh, x, ry + hh, shade(roofColor, 22), shade(roofColor, -14))
  diamond(ctx, x, ry, hw, hh)
  ctx.fill()
  // front vertical edge highlight
  ctx.strokeStyle = rgba('#ffffff', 0.14)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y + hh)
  ctx.lineTo(x, ry + hh)
  ctx.stroke()
  // --- roof style (seeded per building; grayscale-safe geometry, tick-independent) ---
  const style = roofStyle(b)
  if (style === 0 && b.height > 0) {
    // parapet: a raised rim — an inset, slightly darker inner roof
    ctx.fillStyle = vgrad(ctx, x, ry - hh, x, ry + hh, shade(roofColor, 6), shade(roofColor, -26))
    diamond(ctx, x, ry - 1, hw * 0.68, hh * 0.68)
    ctx.fill()
  } else if (style === 1) {
    // pitched: a ridge along the roof (lit spine + a shadow slope)
    ctx.strokeStyle = rgba(shade(roofColor, 28), 0.9)
    ctx.beginPath(); ctx.moveTo(x - hw * 0.6, ry + hh * 0.3); ctx.lineTo(x, ry - hh * 0.55); ctx.lineTo(x + hw * 0.6, ry + hh * 0.3); ctx.stroke()
    ctx.strokeStyle = rgba(shade(roofColor, -34), 0.7)
    ctx.beginPath(); ctx.moveTo(x, ry - hh * 0.55); ctx.lineTo(x, ry + hh * 0.5); ctx.stroke()
  } else if (style === 2 && b.height >= 3) {
    // stepped setback: a penthouse box raised above the roof
    const sh = FLOOR_H * 0.7
    ctx.fillStyle = vgrad(ctx, x, ry - sh, x, ry, shade(base, 26), shade(base, -16))
    ctx.beginPath(); ctx.moveTo(x - hw * 0.5, ry); ctx.lineTo(x, ry + hh * 0.5); ctx.lineTo(x, ry + hh * 0.5 - sh); ctx.lineTo(x - hw * 0.5, ry - sh); ctx.closePath(); ctx.fill()
    ctx.fillStyle = vgrad(ctx, x, ry - sh, x, ry, shade(base, -42), shade(base, -64))
    ctx.beginPath(); ctx.moveTo(x + hw * 0.5, ry); ctx.lineTo(x, ry + hh * 0.5); ctx.lineTo(x, ry + hh * 0.5 - sh); ctx.lineTo(x + hw * 0.5, ry - sh); ctx.closePath(); ctx.fill()
    ctx.fillStyle = shade(roofColor, 12); diamond(ctx, x, ry - sh, hw * 0.5, hh * 0.5); ctx.fill()
  }
  // rooftop clutter: a water tank or vents on mid-rises; an antenna + red beacon on tall towers.
  if (b.height >= 3 && style !== 2) {
    if (srnd(b.gx + 5, b.gy + 9) > 0.55) {
      ctx.fillStyle = shade(roofColor, -30); ctx.fillRect(x + hw * 0.2, ry - 5, 4, 5)
      ctx.fillStyle = shade(roofColor, 14); ctx.fillRect(x + hw * 0.2, ry - 6, 4, 2)
    } else {
      ctx.fillStyle = shade(roofColor, -26); ctx.fillRect(x - hw * 0.4, ry - 3, 3, 3); ctx.fillRect(x - hw * 0.1, ry - 2, 2, 2)
    }
  }
  if (b.height >= 5) {
    ctx.strokeStyle = rgba(shade(roofColor, -46), 0.9)
    ctx.beginPath(); ctx.moveTo(x, ry); ctx.lineTo(x, ry - 9); ctx.stroke()
    if (b.height >= 7) { ctx.fillStyle = tick % 2 === 0 ? '#ff5a5a' : rgba('#ff5a5a', 0.3); ctx.fillRect(x - 1, ry - 10, 2, 2) }
  }

  // windows: a dim base grid always; lit windows add a glow + bloom. A boarded facade shows planks
  // instead, and an outbreak puts the lights out (the lit glow is suppressed).
  if (b.height > 0 && !b.collapsed) {
    if (b.boarded) {
      for (let f = 0; f < b.height; f++) {
        const by = y - f * FLOOR_H - 6
        ctx.fillStyle = rgba(shade(base, -42), 0.92)
        ctx.fillRect(x - hw + 3, by - 1, hw - 3, 2)
        ctx.fillStyle = rgba(shade(base, -70), 0.92)
        ctx.fillRect(x + 1, by + 1, hw - 3, 2)
      }
    } else {
      const lightsOn = !stale && infection < 0.5
      for (let f = 0; f < b.height; f++) {
        const wy = y - f * FLOOR_H - 6
        for (let c = 0; c < 3; c++) {
          const lx = x - hw + 4 + c * 5
          const rx = x + 3 + c * 5
          ctx.fillStyle = rgba(shade(base, -64), 0.85)
          ctx.fillRect(lx, wy, 2, 3)
          ctx.fillStyle = rgba(shade(base, -84), 0.85)
          ctx.fillRect(rx, wy, 2, 3)
          if (lightsOn && litWindow(b.gx + c, b.gy, f, tod)) {
            ctx.fillStyle = p.window
            ctx.fillRect(lx, wy, 2, 3)
            ctx.fillStyle = rgba(p.window, 0.3)
            ctx.fillRect(lx - 2, wy - 2, 6, 7) // bloom
          }
        }
      }
    }
  }

  // damage cracks
  if (b.damage > 0.3) {
    ctx.strokeStyle = rgba(p.damage, 0.85)
    ctx.beginPath()
    ctx.moveTo(x, y + hh - h)
    ctx.lineTo(x - hw * 0.4, y - h * 0.45)
    ctx.lineTo(x - hw * 0.1, y - h * 0.18)
    ctx.stroke()
  }

  // collapsed → rubble
  if (b.collapsed) {
    ctx.fillStyle = vgrad(ctx, x, y - hh, x, y + hh, shade(p.rubble, 12), shade(p.rubble, -20))
    ctx.beginPath()
    ctx.moveTo(x - hw, y)
    ctx.lineTo(x, y + hh)
    ctx.lineTo(x + hw, y)
    ctx.lineTo(x, y - hh * 0.5)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = shade(p.rubble, -32)
    for (let d = 0; d < 3; d++) ctx.fillRect(x - hw * 0.5 + d * 6, y - 1 - d, 3, 2)
  }
}

// The Pyromid's screen anchor — EXPORTED so the artifact's click hit-test lands on the same building the
// renderer draws. Placed prominently at the city's front-centre.
export function pyromidAnchor(scene, W, H) {
  const ox = W / 2
  const oy = H * 0.3
  const n = Math.max(scene?.footprint?.cols ?? 1, scene?.footprint?.rows ?? 1)
  const { x, y } = iso(n * 1.3, n * 0.8, ox, oy) // OUTSIDE the city — a megaproject in the countryside, front-right
  return { x, y, bw: 46, fullH: 150 }
}

// Is the screen point (sx, sy) on the drawn Pyromid? Inverse-maps through the zoom view (screen = world×z
// + offset) before testing the world-space box, so clicking the building still burns it at any zoom/pan.
export function pyromidHitsAt(scene, W, H, view, sx, sy, progress) {
  if (!scene || !scene.pyromid) return false
  const a = pyromidAnchor(scene, W, H)
  const z = view && view.z ? view.z : 1
  const vx = view && view.x ? view.x : 0
  const vy = view && view.y ? view.y : 0
  const wx = (sx - vx) / z
  const wy = (sy - vy) / z
  const prog = Math.max(0, Math.min(1, progress || 0))
  const topY = a.y - a.fullH * (0.1 + 0.9 * prog)
  return wx >= a.x - a.bw && wx <= a.x + a.bw && wy >= topY && wy <= a.y + a.bw * 0.5
}

// The solar-pyramid datacenter. Builds from a foundation up to the full pyramid as `progress` climbs,
// with a faint scaffold of what it will become; the apex capstone blazes gold on completion. Static
// geometry depends on progress + footprint only; the sole tick-driven detail is the construction crane's
// hook, which bobs ONLY when the city is lively and hangs still when stale — so a stale mid-build city
// still holds still across ticks (the stale-frame guard) and the bob is position-only (grayscale-safe).
// The capstone's COLOUR blinks on completion. Uses arc/fillRect/moveTo/lineTo/stroke (no ctx.ellipse).
function drawPyromid(ctx, scene, tick) {
  const py = scene.pyromid
  if (!py) return
  const stale = (scene.vitality ?? 0) < 0.34 // a stalled city's crane freezes — no tick-driven drift
  const prog = Math.max(0, Math.min(1, py.progress ?? 0))
  const W = LOGICAL_W
  const H = LOGICAL_H
  const a = pyromidAnchor(scene, W, H)
  const x = a.x, y = a.y, bw = a.bw
  const h = a.fullH * (0.1 + 0.9 * prog) // a foundation that rises to the full height at completion
  const apex = y - h
  const base = y + bw * 0.5
  const building = prog < 0.995 // the site is under construction until it tops out
  // a cleared/graded dirt lot the megaproject sits on (recedes as it finishes)
  if (building) {
    ctx.fillStyle = rgba('#5a4a36', 0.6)
    diamond(ctx, x, base - bw * 0.35, bw * 1.5, bw * 0.72)
    ctx.fill()
    ctx.fillStyle = rgba('#6b5a42', 0.5) // graded tracks
    diamond(ctx, x, base - bw * 0.35, bw * 1.1, bw * 0.5)
    ctx.fill()
  }
  // faint full-height scaffold — what it is becoming
  ctx.strokeStyle = rgba('#8fb0ff', 0.18)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x - bw, y)
  ctx.lineTo(x, y - a.fullH)
  ctx.lineTo(x + bw, y)
  ctx.stroke()
  // foundation
  ctx.fillStyle = rgba('#0a1530', 0.92)
  diamond(ctx, x, base - bw * 0.5, bw * 0.78, bw * 0.4)
  ctx.fill()
  // left (sunlit) + right (shadow) solar faces
  ctx.fillStyle = vgrad(ctx, x, apex, x, y, '#2f54a8', '#122455')
  ctx.beginPath()
  ctx.moveTo(x, apex)
  ctx.lineTo(x - bw, y)
  ctx.lineTo(x, base)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = vgrad(ctx, x, apex, x, y, '#1b3576', '#0a1530')
  ctx.beginPath()
  ctx.moveTo(x, apex)
  ctx.lineTo(x + bw, y)
  ctx.lineTo(x, base)
  ctx.closePath()
  ctx.fill()
  // solar panel rows — chevron bands up the two faces
  ctx.strokeStyle = rgba('#6f93e0', 0.5)
  for (let i = 1; i < 9; i++) {
    const f = i / 9
    const ly = y - h * f
    const lw = bw * (1 - f)
    const sy = base - (base - apex) * f
    ctx.beginPath()
    ctx.moveTo(x - lw, ly)
    ctx.lineTo(x, sy)
    ctx.lineTo(x + lw, ly)
    ctx.stroke()
  }
  // spine sheen
  ctx.strokeStyle = rgba('#bcd4ff', 0.35)
  ctx.beginPath()
  ctx.moveTo(x, apex)
  ctx.lineTo(x, base)
  ctx.stroke()
  // apex capstone: a dim pilot light that blazes gold when the Pyromid is complete
  const done = prog >= 1
  ctx.fillStyle = done ? (tick % 2 === 0 ? '#ffe9a6' : '#ffd76a') : rgba('#8fb0ff', 0.6)
  ctx.beginPath()
  ctx.arc(x, apex, done ? 5 : 3, 0, 7)
  ctx.fill()
  if (done) {
    ctx.fillStyle = rgba('#ffd76a', 0.25)
    ctx.beginPath()
    ctx.arc(x, apex, 12, 0, 7)
    ctx.fill()
  }

  // --- construction site: scaffold rungs on the rising faces, flanking tower cranes, trucks on the lot ---
  if (building) {
    ctx.strokeStyle = rgba('#caa36a', 0.55)
    ctx.lineWidth = 1
    for (let r = 1; r < 7; r++) {
      const f = r / 7, ly = y - h * f, lw = bw * (1 - f)
      ctx.beginPath()
      ctx.moveTo(x - lw, ly)
      ctx.lineTo(x + lw, ly)
      ctx.stroke()
    }
    for (const cs of [-1, 1]) {
      const cxp = x + cs * (bw + 26)
      const ctop = apex - 34
      ctx.strokeStyle = 'rgba(224,176,80,0.92)'
      ctx.lineWidth = 2
      ctx.beginPath() // mast
      ctx.moveTo(cxp, base - 2)
      ctx.lineTo(cxp, ctop)
      ctx.stroke()
      ctx.beginPath() // jib reaching over the pyramid + a short counter-jib
      ctx.moveTo(x + cs * 4, ctop)
      ctx.lineTo(cxp + cs * 16, ctop)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(224,176,80,0.5)' // the hook line slowly bobs while work is live; still when stale
      ctx.lineWidth = 1
      const hx = x + cs * (bw * 0.5)
      const hl = 24 + (stale ? 0 : Math.sin((tick + cs * 5) * 0.06) * 7)
      ctx.beginPath()
      ctx.moveTo(hx, ctop)
      ctx.lineTo(hx, ctop + hl)
      ctx.stroke()
      ctx.fillStyle = 'rgba(40,40,40,0.8)'
      ctx.fillRect(hx - 1, ctop + hl, 3, 2) // the load
    }
    for (const ts of [-0.7, 0.55]) {
      const tx = x + ts * bw * 1.4, ty = base + 3
      ctx.fillStyle = '#c9c2b4'
      ctx.fillRect(tx - 5, ty - 4, 10, 4) // trailer
      ctx.fillStyle = '#9aa0ac'
      ctx.fillRect(tx + 3, ty - 6, 4, 4) // cab
      ctx.fillStyle = '#222'
      ctx.fillRect(tx - 4, ty, 2, 1)
      ctx.fillRect(tx + 4, ty, 2, 1) // wheels
    }
  }
}

function drawLandmark(ctx, l, p, ox, oy, tick) {
  const { x, y } = iso(l.gx, l.gy, ox, oy)
  ctx.fillStyle = p.accent
  if (l.kind === 'monument') {
    ctx.beginPath()
    ctx.moveTo(x, y - 30)
    ctx.lineTo(x - 4, y)
    ctx.lineTo(x + 4, y)
    ctx.closePath()
    ctx.fill()
  } else if (l.kind === 'tower') {
    ctx.fillRect(x - 2, y - 34, 4, 34)
    ctx.fillStyle = tick % 2 === 0 ? '#ff5a5a' : rgba('#ff5a5a', 0.3)
    ctx.beginPath()
    ctx.arc(x, y - 36, 2, 0, 7)
    ctx.fill()
  } else if (l.kind === 'stadium') {
    ctx.beginPath()
    ctx.arc(x, y - 6, 8, 0, 7)
    ctx.fill()
    ctx.fillStyle = shade(p.accent, -44)
    ctx.beginPath()
    ctx.arc(x, y - 6, 5, 0, 7)
    ctx.fill()
  } else if (l.kind === 'spire') {
    // cathedral / arcology spire — a tall, slender steeple
    ctx.beginPath()
    ctx.moveTo(x, y - 40)
    ctx.lineTo(x - 3, y)
    ctx.lineTo(x + 3, y)
    ctx.closePath()
    ctx.fill()
  } else if (l.kind === 'dome') {
    // library / university / opera / planetarium — a domed hall on a base
    ctx.fillRect(x - 7, y - 6, 14, 6)
    ctx.beginPath()
    ctx.arc(x, y - 6, 7, Math.PI, 2 * Math.PI)
    ctx.fill()
  } else if (l.kind === 'observatory') {
    // observatory — a short tower capped by a dome + blinking aperture
    ctx.fillRect(x - 5, y - 18, 10, 18)
    ctx.beginPath()
    ctx.arc(x, y - 18, 6, Math.PI, 2 * Math.PI)
    ctx.fill()
    ctx.fillStyle = tick % 2 === 0 ? '#bfe8ff' : rgba('#bfe8ff', 0.3)
    ctx.fillRect(x - 1, y - 20, 2, 2)
  } else if (l.kind === 'lighthouse') {
    // lighthouse — a tapered tower with a sweeping lantern
    ctx.beginPath()
    ctx.moveTo(x - 4, y)
    ctx.lineTo(x - 2, y - 28)
    ctx.lineTo(x + 2, y - 28)
    ctx.lineTo(x + 4, y)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = tick % 2 === 0 ? '#ffe16a' : rgba('#ffe16a', 0.3)
    ctx.fillRect(x - 2, y - 32, 4, 4)
  } else if (l.kind === 'fountain') {
    // town fountain / grand plaza — a basin with a jet
    ctx.beginPath()
    ctx.arc(x, y, 7, 0, 7)
    ctx.fill()
    ctx.fillStyle = rgba('#bfe8ff', 0.8)
    ctx.fillRect(x - 1, y - 10, 2, 10)
    ctx.fillRect(x - 5, y - 6, 2, 2)
    ctx.fillRect(x + 3, y - 6, 2, 2)
  } else if (l.kind === 'bridge') {
    // river bridge — a shallow arch
    ctx.strokeStyle = p.accent
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x - 10, y)
    ctx.lineTo(x - 5, y - 8)
    ctx.lineTo(x + 5, y - 8)
    ctx.lineTo(x + 10, y)
    ctx.stroke()
    ctx.lineWidth = 1
  } else {
    ctx.beginPath()
    ctx.arc(x, y - 8, 5, 0, 7)
    ctx.fill()
  }
}
