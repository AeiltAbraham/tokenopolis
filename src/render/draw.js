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
// Deterministic "is this window lit this tick" — coprime tick multiplier so it animates each frame.
const lit = (gx, gy, f, tick) => (gx * 7 + gy * 13 + f * 17 + tick) % 5 === 0

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
export const srnd = (a, b) => {
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

export function drawCity(ctx, scene, theme, tick = 0) {
  const p = theme && typeof theme === 'object' ? theme : resolveTheme(theme)
  const W = ctx.canvas?.width ?? 960
  const H = ctx.canvas?.height ?? 640
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
  ctx.fillStyle = shade(p.ground, -48) // plate rim for depth
  diamond(ctx, ox, gcy + 6, ghw, ghh)
  ctx.fill()
  ctx.fillStyle = vgrad(ctx, ox, gcy - ghh, ox, gcy + ghh, shade(p.ground, 16), shade(p.ground, -18))
  diamond(ctx, ox, gcy, ghw, ghh)
  ctx.fill()

  mark(ctx, 'roads')
  if (scene.infrastructure.roads) {
    ctx.strokeStyle = rgba(p.road, 0.8)
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
  for (const b of order) drawBuilding(ctx, b, p, ox, oy, tick, stale, scene.infection ?? 0)

  mark(ctx, 'landmarks')
  for (const l of scene.landmarks) drawLandmark(ctx, l, p, ox, oy, tick)
  drawOvergrowth(ctx, scene, ox, oy) // nature reclaims a stagnant/overrun city

  mark(ctx, 'citizens')
  drawCitizens(ctx, scene, p, ox, oy, tick, stale)
  drawAnimals(ctx, scene, ox, oy, tick, stale)
  drawVehicles(ctx, scene, ox, oy, tick, stale)

  mark(ctx, 'overlay')
  if (!stale && !scene.ruined) {
    const cx = ox - 30 + ((tick * 4) % 24)
    const cy = oy - 6
    ctx.strokeStyle = p.accent
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx, cy - 38) // mast
    ctx.lineTo(cx + 26, cy - 38) // jib
    ctx.lineTo(cx + 26, cy - 31) // hook
    ctx.stroke()
    ctx.lineWidth = 1
  }
  // vignette for mood/depth
  const vg = ctx.createRadialGradient(ox, oy + H * 0.18, H * 0.18, ox, oy + H * 0.18, H * 0.8)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, night ? 'rgba(0,0,0,0.5)' : 'rgba(8,10,18,0.26)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, W, H)
}

// Life signal: pedestrians (small accent dots) and the odd car move along the road grid, animated by
// tick. Count scales with the footprint, capped for LOD. Deterministic per-citizen via srnd (no state).
const CAR_COLORS = ['#ffd76a', '#ff6a8a', '#6ad7ff', '#e8ecf2']
function drawCitizens(ctx, scene, p, ox, oy, tick, stale) {
  if (stale) return // a stale/decaying city empties its streets — and keeps frames still
  const n = Math.max(scene.footprint?.cols ?? 0, scene.footprint?.rows ?? 0)
  if (n < 1) return
  if ((scene.infection ?? 0) >= 0.5) { drawShamblers(ctx, scene, ox, oy, tick); return } // outbreak: traffic gone, a few shamblers
  // Density scales with the metrics: a bigger, livelier city teems; a sleepy one goes quiet.
  // A festival gift (market, marathon, World's Fair) thickens the crowd.
  const vit = scene.vitality ?? 1
  const fest = scene.flags && scene.flags.festival ? 1.35 : 1
  const count = Math.min(170, Math.round((8 + n * 6) * (0.35 + 0.65 * vit) * (1 + (scene.scaleIndex ?? 0) * 0.12) * fest))
  for (let i = 0; i < count; i++) {
    const onX = srnd(i, 1) < 0.5 // move along the gx axis (true) or the gy axis (false)
    const lane = Math.round(srnd(i, 2) * n) // which road (grid line)
    const car = srnd(i, 3) > 0.78
    const dir = srnd(i, 5) > 0.5 ? 1 : -1
    const speed = car ? 0.02 : 0.009
    const f = (((srnd(i, 6) + dir * tick * speed) % 1) + 1) % 1
    const pos = onX ? iso(f * n, lane, ox, oy) : iso(lane, f * n, ox, oy)
    if (car) {
      ctx.fillStyle = CAR_COLORS[i % CAR_COLORS.length]
      ctx.fillRect(pos.x - 2, pos.y - 2, 4, 3)
    } else {
      ctx.fillStyle = rgba(p.accent, 0.85)
      ctx.fillRect(pos.x - 1, pos.y - 1, 2, 2)
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
function drawAnimals(ctx, scene, ox, oy, tick, stale) {
  if (stale || (scene.infection ?? 0) >= 0.5) return
  const n = Math.max(scene.footprint?.cols ?? 0, scene.footprint?.rows ?? 0)
  if (n < 1) return
  const W = ctx.canvas?.width ?? 960
  const vit = scene.vitality ?? 1
  // An aviary gift fills the sky with more flocks; a zoo/aquarium gift puts wildlife on the ground.
  const aviary = scene.flags && scene.flags.aviary ? 1.8 : 1
  const flocks = Math.round((2 + vit * 4) * aviary)
  ctx.strokeStyle = 'rgba(40,40,52,0.55)'
  ctx.lineWidth = 1
  for (let i = 0; i < flocks; i++) {
    const r = srnd(i, 51), r2 = srnd(i, 57)
    const baseY = 16 + r * 70
    const cx = (((srnd(i, 53) * (W + 80)) + tick * (0.25 + r2 * 0.5)) % (W + 80)) - 40
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
  const W = ctx.canvas?.width ?? 960
  const H = ctx.canvas?.height ?? 640
  if (serv.airport) {
    for (let i = 0; i < 2; i++) {
      const y = 28 + i * 22
      const x = (((i * 420) + tick * (1.2 + i * 0.3)) % (W + 120)) - 60
      ctx.fillStyle = 'rgba(222,228,238,0.9)'
      ctx.fillRect(x, y, 10, 2)
      ctx.fillRect(x + 3, y - 2, 3, 2)
      ctx.fillStyle = tick % 2 ? '#ff5a5a' : 'rgba(255,90,90,0.3)'
      ctx.fillRect(x, y, 1, 1)
    }
  }
  if (serv.harbour) {
    for (let i = 0; i < 4; i++) {
      const r = srnd(i, 71)
      const bx = 40 + ((srnd(i, 73) * (W - 80) + tick * (0.2 + r * 0.3)) % (W - 80))
      const by = H - 38 - r * 46
      ctx.fillStyle = 'rgba(70,92,112,0.9)'
      ctx.fillRect(bx, by, 8, 3)
      ctx.fillStyle = 'rgba(200,210,220,0.8)'
      ctx.fillRect(bx + 3, by - 4, 1, 4) // mast
    }
  }
}

function drawBuilding(ctx, b, p, ox, oy, tick, stale, infection = 0) {
  const { x, y } = iso(b.gx, b.gy, ox, oy)
  const hw = TILE_W / 2
  const hh = TILE_H / 2
  const h = b.height * FLOOR_H

  // soft drop shadow (depth)
  ctx.fillStyle = rgba('#000000', 0.18)
  diamond(ctx, x + 5, y + 4, hw * 0.9, hh * 0.9)
  ctx.fill()

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
  // left (sunlit) face
  ctx.fillStyle = vgrad(ctx, x, y - h, x, y, shade(base, 14), shade(base, -24))
  ctx.beginPath()
  ctx.moveTo(x - hw, y)
  ctx.lineTo(x, y + hh)
  ctx.lineTo(x, y + hh - h)
  ctx.lineTo(x - hw, y - h)
  ctx.closePath()
  ctx.fill()
  // right (shadow) face
  ctx.fillStyle = vgrad(ctx, x, y - h, x, y, shade(base, -30), shade(base, -56))
  ctx.beginPath()
  ctx.moveTo(x + hw, y)
  ctx.lineTo(x, y + hh)
  ctx.lineTo(x, y + hh - h)
  ctx.lineTo(x + hw, y - h)
  ctx.closePath()
  ctx.fill()
  // roof (per-zone colour)
  ctx.fillStyle = vgrad(ctx, x, y - h - hh, x, y - h + hh, shade(roofColor, 18), shade(roofColor, -12))
  diamond(ctx, x, y - h, hw, hh)
  ctx.fill()
  // front vertical edge highlight
  ctx.strokeStyle = rgba('#ffffff', 0.12)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y + hh)
  ctx.lineTo(x, y + hh - h)
  ctx.stroke()
  // rooftop detail: antenna on tall towers (red beacon when very tall), vent on industrial
  if (b.height >= 5) {
    ctx.strokeStyle = rgba(shade(roofColor, -46), 0.9)
    ctx.beginPath()
    ctx.moveTo(x, y - h)
    ctx.lineTo(x, y - h - 9)
    ctx.stroke()
    if (b.height >= 7) {
      ctx.fillStyle = tick % 2 === 0 ? '#ff5a5a' : rgba('#ff5a5a', 0.3)
      ctx.fillRect(x - 1, y - h - 10, 2, 2)
    }
  } else if (b.zone === 'I') {
    ctx.fillStyle = shade(roofColor, -22)
    ctx.fillRect(x - 3, y - h - 3, 6, 3)
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
          if (lightsOn && lit(b.gx + c, b.gy, f, tick)) {
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
