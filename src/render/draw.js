// Isometric pixel renderer. Draws a scene (from scene.js) onto a canvas 2D context — in the browser
// inside the artifact, and under a recording-stub ctx in tests. Only import is ./themes.js (both are
// inlined into the artifact). Geometry depends on the scene + tick ONLY (never the palette), so the
// city stays legible with the palette swapped for grayscale; condition shows through STRUCTURE
// (height, damage cracks, collapsed rubble), not color. Layer order is marked via the optional
// ctx.__layer hook (a no-op in the browser) so tests can assert z-order.

import { resolveTheme } from './themes.js'

const TILE_W = 32
const TILE_H = 16
const FLOOR_H = 10

const mark = (ctx, layer) => {
  if (typeof ctx.__layer === 'function') ctx.__layer(layer)
}
const iso = (gx, gy, ox, oy) => ({ x: ox + (gx - gy) * (TILE_W / 2), y: oy + (gx + gy) * (TILE_H / 2) })
// Deterministic "is this window lit this tick" — depends on position + tick (animates when lively).
// The tick multiplier must be coprime to the modulus or the frame would never change.
const lit = (gx, gy, f, tick) => (gx * 7 + gy * 13 + f * 17 + tick) % 5 === 0

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  const clamp = (v) => Math.max(0, Math.min(255, v))
  const r = clamp((n >> 16) + amt)
  const g = clamp(((n >> 8) & 255) + amt)
  const b = clamp((n & 255) + amt)
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

function diamond(ctx, x, y, hw, hh) {
  ctx.beginPath()
  ctx.moveTo(x, y - hh)
  ctx.lineTo(x + hw, y)
  ctx.lineTo(x, y + hh)
  ctx.lineTo(x - hw, y)
  ctx.closePath()
}

export function drawCity(ctx, scene, theme, tick = 0) {
  const p = theme && typeof theme === 'object' ? theme : resolveTheme(theme)
  const W = ctx.canvas?.width ?? 960
  const H = ctx.canvas?.height ?? 640
  const ox = W / 2
  const oy = H * 0.3
  const stale = (scene.vitality ?? 0) < 0.34

  ctx.fillStyle = p.sky
  ctx.fillRect(0, 0, W, H)

  mark(ctx, 'underground')
  for (const u of scene.underground) {
    ctx.fillStyle = shade(p.underground, Math.min(40, u.level * 4))
    const bandY = oy + scene.footprint.rows * (TILE_H / 2) + u.level * 8
    ctx.fillRect(ox - u.extent * (TILE_W / 2), bandY, u.extent * TILE_W, 6)
  }

  mark(ctx, 'ground')
  const span = Math.max(scene.footprint.cols, scene.footprint.rows)
  ctx.fillStyle = p.ground
  diamond(ctx, ox, oy + span * (TILE_H / 2), span * (TILE_W / 2) + TILE_W, span * (TILE_H / 2) + TILE_H)
  ctx.fill()

  mark(ctx, 'roads')
  // Roads visibly connect the zones (spec §3); higher infra tiers show as accent pips as they unlock.
  if (scene.infrastructure.roads) {
    ctx.strokeStyle = p.road
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
    const tiers = ['power', 'water', 'transit', 'data'].filter((t) => scene.infrastructure[t])
    ctx.fillStyle = p.accent
    for (let i = 0; i < tiers.length; i++) ctx.fillRect(8 + i * 10, H - 14, 6, 6)
  }

  mark(ctx, 'buildings')
  const order = [...scene.buildings].sort((a, b) => a.gx + a.gy - (b.gx + b.gy))
  for (const b of order) drawBuilding(ctx, b, p, ox, oy, tick, stale)

  mark(ctx, 'landmarks')
  for (const l of scene.landmarks) {
    const { x, y } = iso(l.gx, l.gy, ox, oy)
    ctx.fillStyle = p.accent
    diamond(ctx, x, y - 14, 6, 3)
    ctx.fill()
  }

  mark(ctx, 'overlay')
  // A construction crane over the city when it's lively and growing (animates along the jib by tick).
  if (!stale && !scene.ruined) {
    const cx = ox - 34 + ((tick * 4) % 26)
    const cy = oy - 4
    ctx.strokeStyle = p.accent
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx, cy - 36) // mast
    ctx.lineTo(cx + 26, cy - 36) // jib
    ctx.lineTo(cx + 26, cy - 30) // hook drop
    ctx.stroke()
  }
}

function drawBuilding(ctx, b, p, ox, oy, tick, stale) {
  const { x, y } = iso(b.gx, b.gy, ox, oy)
  const hw = TILE_W / 2
  const hh = TILE_H / 2
  const h = b.height * FLOOR_H

  if (b.zone === 'park') {
    ctx.fillStyle = p.zone.park
    diamond(ctx, x, y, hw, hh)
    ctx.fill()
    return
  }

  const base = p.zone[b.zone] ?? p.zone.R
  // left face
  ctx.fillStyle = shade(base, -22)
  ctx.beginPath()
  ctx.moveTo(x - hw, y)
  ctx.lineTo(x, y + hh)
  ctx.lineTo(x, y + hh - h)
  ctx.lineTo(x - hw, y - h)
  ctx.closePath()
  ctx.fill()
  // right face
  ctx.fillStyle = shade(base, -44)
  ctx.beginPath()
  ctx.moveTo(x + hw, y)
  ctx.lineTo(x, y + hh)
  ctx.lineTo(x, y + hh - h)
  ctx.lineTo(x + hw, y - h)
  ctx.closePath()
  ctx.fill()
  // roof
  ctx.fillStyle = p.roof
  diamond(ctx, x, y - h, hw, hh)
  ctx.fill()

  // lit windows (glow geometry) — only when lively, so animation shows in geometry; still when stale
  if (!stale && b.height > 0 && !b.collapsed) {
    ctx.fillStyle = p.window
    for (let f = 0; f < b.height; f++) {
      if (lit(b.gx, b.gy, f, tick)) {
        const wy = y - f * FLOOR_H - 6
        ctx.fillRect(x - hw + 4, wy, 3, 3)
        ctx.fillRect(x + hw - 7, wy, 3, 3)
      }
    }
  }

  // structural damage: a crack (independent of palette geometry)
  if (b.damage > 0.3) {
    ctx.strokeStyle = p.damage
    ctx.beginPath()
    ctx.moveTo(x, y + hh - h)
    ctx.lineTo(x - hw * 0.5, y - h * 0.5)
    ctx.stroke()
  }

  // collapsed → rubble silhouette
  if (b.collapsed) {
    ctx.fillStyle = p.rubble
    ctx.beginPath()
    ctx.moveTo(x - hw, y)
    ctx.lineTo(x, y + hh)
    ctx.lineTo(x + hw, y)
    ctx.lineTo(x, y - hh * 0.4)
    ctx.closePath()
    ctx.fill()
  }
}
