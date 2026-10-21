// The skyline: the same city seen from the street — a 2D front elevation in chunky pixels, coloured
// with the TERMINAL's own palette, shown by the floating window (bin/skyline-window.js). Pure:
// (cityData, view) → a pixel grid where null is see-through. No I/O, no clock (the caller passes `now` + `tick`). The street life, sky and weather reuse the
// isometric renderer's deterministic formulas, so the skyline shows the SAME citizens and cars as the
// city: the street we see is the front edge of the grid (lane n), and whoever walks or drives it here
// walks or drives it there.
//
// Projection: an iso tile (gx, gy) sits at u = gx - gy across the skyline and gx + gy deep into it
// (bigger = nearer). Buildings paint far → near, dimmed toward the background with distance.

import { srnd } from './draw.js'
import { timeOfDay, seasonOf } from './ambient.js'

// xterm's defaults — used when the terminal's colours can't be read.
export const DEFAULT_COLORS = {
  fg: [229, 229, 229],
  bg: [0, 0, 0],
  palette: [
    [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
    [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0], [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
  ],
}

// Building colour: 'fg' (the terminal's text colour), an ANSI name, 'ansi:N' (0..15) or '#rrggbb'.
const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
export const TINTS = ['fg', ...ANSI_NAMES.slice(1), ...ANSI_NAMES.slice(1).map((n) => `bright-${n}`)]

export function parseTint(spec) {
  if (typeof spec !== 'string') return null
  const s = spec.trim().toLowerCase()
  if (s === 'fg' || /^#[0-9a-f]{6}$/.test(s)) return s
  const m = /^ansi:(\d{1,2})$/.exec(s)
  if (m && Number(m[1]) <= 15) return s
  const name = s.replace(/^bright-/, '')
  return ANSI_NAMES.includes(name) ? s : null
}

export function resolveTint(spec, colors = DEFAULT_COLORS) {
  const s = parseTint(spec) ?? 'fg'
  if (s === 'fg') return colors.fg
  if (s[0] === '#') {
    const n = parseInt(s.slice(1), 16)
    return [n >> 16, (n >> 8) & 255, n & 255]
  }
  const idx = s.startsWith('ansi:') ? Number(s.slice(5)) : ANSI_NAMES.indexOf(s.replace(/^bright-/, '')) + (s.startsWith('bright-') ? 8 : 0)
  return colors.palette[idx] ?? DEFAULT_COLORS.palette[idx]
}

const mixc = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t))
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)

// Act animations, reduced to what a few thousand pixels can show. Shake mirrors the artifact's.
const ACT_FX = {
  rise: ['wash', 14, 'up', 15], skyline: ['wash', 14, 'up', 15], boom: ['up', 11], goldrain: ['up', 11],
  parade: ['confetti'], alien: ['confetti'], fireworks: ['fireworks'],
  bloom: ['wash', 10], harvest: ['wash', 11], sunrise: ['wash', 3], blight: ['wash', 2],
  aurora: ['aurora'], utopia: ['aurora'], rainbow: ['rainbow'],
  quake: ['dust'], twister: ['dark', 8, 'down', 7], storm: ['dark', 8, 'down', 7],
  meteor: ['meteor'], fire: ['fire'], phoenix: ['fire'], flood: ['water'], frost: ['frost'],
  sinkhole: ['dark', 0], eclipse: ['dark', 0], blackhole: ['dark', 0], timewarp: ['dark', 5],
}
const SHAKE = { quake: 1, meteor: 1, twister: 1, storm: 1 }

// One frame. data = cityData(); fx = { anim | phase, p: 0..1 } while an act/climax plays; `weather` overrides
// weatherAt(now) ({ rain, storm }). With `crop`, the frame
// is cut down to the city — its buildings, street and a strip of sky — worked out from the scene, so it holds
// still from frame to frame and grows with the city.
// Returns { W, H, px (flat W*H, rgb or null = see-through) }.
export function skylineFrame(data, { width, height, tick = 0, now = 0, colors = DEFAULT_COLORS, tint = 'fg', fx = null, crop = false, weather = null }) {
  const W = Math.max(1, width | 0)
  const H = Math.max(3, height | 0)
  const px = new Array(W * H).fill(null)
  const bg = colors.bg
  const P = (i) => colors.palette[i] ?? DEFAULT_COLORS.palette[i]
  const at = (x, y) => px[y * W + x]
  const put = (x, y, c) => {
    x = Math.round(x)
    y = Math.round(y)
    if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c
  }
  const fade = (c, t) => mixc(bg, c, t) // toward the background: t = 1 full colour, 0 invisible

  const scene = data.scene
  const stale = (scene.vitality ?? 0) < 0.34 // a stale city empties its streets and stops its lights
  const infection = scene.infection ?? 0
  const t = tick
  const n = Math.max(scene.footprint?.cols ?? 0, scene.footprint?.rows ?? 0)
  const street = H - 1 // the road
  const lane = H - 2 // who walks and drives the front street
  const ground = H - 3 // buildings stand here
  // Pixels per tile across: a fixed size when cropping (the frame fits the city), else what fits the width.
  const k = crop ? CROP_TILE : n > 0 ? Math.max(1, Math.min(4, (W - 2) / (2 * n))) : 1
  const cx = W / 2
  const ux = (u) => cx + u * k
  const spanL = Math.max(0, Math.floor(ux(-n)) - 1)
  const spanR = Math.min(W - 1, Math.ceil(ux(n)) + 1)

  let base = resolveTint(tint, colors)
  if (data.era === 'ascendant') base = mixc(base, P(15), 0.45) // the gleaming Singularity revamp
  else if (data.era === 'fallout') base = mixc(base, P(8), 0.5) // ash-grey wasteland
  const tod = timeOfDay(now)
  const elev = Math.sin((tod - 0.25) * Math.PI * 2) // -1 midnight .. +1 noon

  // --- city: buildings + landmarks, far → near ---
  // The skyline's own heights: a share of the commercial blocks rise as towers, taller the bigger the city, while
  // homes and industry stay low — so the profile has peaks instead of a smooth pyramid. Collapsed stays rubble.
  const sizeIndex = scene.sizeIndex ?? scene.scaleIndex ?? 0
  const rise = (b) => {
    if (b.collapsed || b.height === 0) return b.height
    if (b.zone === 'C' && srnd(b.gx * 5 + 1, b.gy * 11 + 3) > 0.55) return Math.round(b.height * (1.4 + 0.1 * sizeIndex))
    return Math.max(1, Math.round(b.height * (b.zone === 'I' ? 0.7 : 0.85)))
  }
  const heights = new Map(scene.buildings.map((b) => [b, rise(b)]))
  const maxH = Math.max(8, ...heights.values())
  // Pixels per floor: fixed when cropping, unless the tallest would pass CROP_MAX_H; else what fits the height.
  const fpx = crop ? Math.min(CROP_FLOOR, CROP_MAX_H / maxH) : Math.max(0.5, Math.min(2, (ground - 3) / maxH))
  const hpx = (h) => (h > 0 ? Math.max(1, Math.round(h * fpx)) : 0)
  const maxDepth = Math.max(1, 2 * (n - 1))
  // Windows light up only at night (the viewer's local clock, which the caller passes as `now`), in a pattern that
  // holds still and reshuffles every 10 minutes — never a flicker.
  const lightsOn = !stale && infection < 0.5 && elev < 0
  const slot = Math.floor(now / 600_000)

  // What is shown: with `crop`, the city's own box (its span and a strip of sky over the tallest building), worked
  // out from the scene so it holds still; else the whole canvas. The sky's furniture is laid out inside it.
  const harbour = !!scene.services?.harbour
  const box = (() => {
    if (!crop) return { x0: 0, x1: W - 1, y0: 0 }
    const tallest = Math.max(hpx(Math.max(0, ...heights.values())), ...scene.landmarks.map(landmarkHeight))
    const side = harbour ? 10 : 3
    let x0 = Math.max(0, spanL - side), x1 = Math.min(W - 1, spanR + side)
    if (x1 - x0 + 1 > CROP_MAX_W) {
      // A big city: frame its downtown, the centre of the skyline.
      x0 = Math.max(0, Math.round(cx - CROP_MAX_W / 2))
      x1 = Math.min(W - 1, x0 + CROP_MAX_W - 1)
    }
    while (x1 - x0 + 1 < Math.min(W, CROP_MIN_W)) {
      x0 = Math.max(0, x0 - 1)
      x1 = Math.min(W - 1, x1 + 1)
    }
    return { x0, x1, y0: Math.max(0, ground - tallest - CROP_SKY) }
  })()
  const bw = box.x1 - box.x0 + 1
  const skyTop = box.y0
  const skyH = Math.max(3, ground - skyTop)

  // --- sky, behind the city (the sky itself stays see-through): the sun by day and the moon by night, dimmed and
  // clouded over while it rains; stars on a clear night; a few fair-weather clouds in spring and summer ---
  const sw = weather ?? weatherAt(now)
  const raining = sw.rain
  // A round disc, 4 px across with its corners off: the sun, and the (always full) moon.
  const disc = (x, y, c) => {
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) if ((dx === 0 || dx === 3) + (dy === 0 || dy === 3) < 2) put(x + dx, y + dy, c)
  }
  const along = (f) => box.x0 + 1 + f * Math.max(0, bw - 6) // left to right across the shown sky
  const skyY = (e) => skyTop + 1 + Math.round(skyH * 0.55 * (1 - e)) // high at noon or midnight
  let body = null // where the sun or moon is, for the cloud that covers it in rain
  if (elev > 0) {
    body = [along((tod - 0.25) / 0.5), skyY(elev)]
    disc(body[0], body[1], raining ? fade(P(11), 0.35) : P(11))
  } else {
    if (!raining) {
      for (let i = 0; i < Math.round((bw * skyH) / 120); i++) {
        if (srnd(i, 3) > 0.6) put(box.x0 + srnd(i, 1) * bw, skyTop + srnd(i, 2) * skyH * 0.6, fade(P(15), 0.35 + 0.3 * srnd(i, 9))) // still, no twinkle
      }
    }
    body = [along((((tod - 0.75) % 1) + 1) % 1 / 0.5), skyY(-elev)]
    const moon = raining ? fade(P(15), 0.3) : fade(P(15), 0.85)
    disc(body[0], body[1], moon)
  }
  const season = seasonOf(now)
  const puff = (x0, y0, w, c) => {
    for (let x = 0; x < w; x++) {
      put(x0 + x, y0 + 1, c)
      if (x > 0 && x < w - 1) put(x0 + x, y0, c)
    }
  }
  if (raining) {
    // A low, heavy deck of cloud across the sky, darker in a storm, and a cloud drifting over the sun or moon.
    const deck = fade(P(8), sw.storm ? 0.75 : 0.55)
    for (let x = box.x0; x <= box.x1; x++) {
      const depth = 2 + Math.round(srnd(x + Math.floor(t / 40), 221) * 1.5)
      for (let y = skyTop; y < skyTop + depth; y++) put(x, y, deck)
    }
    if (body) puff(body[0] - 2 + Math.sin(t * 0.01) * 1.5, body[1] + 1, 7, deck)
  } else if (season === 'spring' || season === 'summer') {
    for (let i = 0; i < 2; i++) {
      const w = 5 + Math.round(srnd(i, 81) * 4)
      const span = bw + w * 2
      const x0 = box.x0 + ((srnd(i, 83) * span + t * (0.03 + srnd(i, 85) * 0.04)) % span) - w
      puff(x0, skyTop + 1 + Math.round(srnd(i, 87) * skyH * 0.25), w, fade(P(7), 0.22))
    }
  }


  const items = [
    ...scene.buildings.map((b) => ({ b, d: b.gx + b.gy })),
    ...scene.landmarks.map((l) => ({ l, d: l.gift ? Infinity : l.gx + l.gy })), // gifts stand out in front
  ].sort((a, b) => a.d - b.d)

  for (const it of items) {
    const near = Math.min(1, 0.45 + 0.55 * (it.d / maxDepth))
    if (it.l) {
      drawLandmark(it.l, near)
      continue
    }
    const b = it.b
    const u = b.gx - b.gy
    const x0 = Math.round(ux(u - 0.5))
    const x1 = Math.max(x0, Math.round(ux(u + 0.5)) - (k >= 3 ? 2 : 1))
    const mid = Math.round((x0 + x1) / 2)
    if (b.zone === 'park') {
      put(mid, ground, fade(P(2), near))
      put(mid, ground - 1, fade(P(10), near * 0.8))
      continue
    }
    const h = hpx(heights.get(b))
    if (b.collapsed || h === 0) {
      for (let x = x0; x <= x1; x++) put(x, ground, fade(P(8), near))
      if (srnd(b.gx, b.gy) > 0.5) put(mid, ground - 1, fade(P(8), near * 0.8))
      continue
    }
    let wall = b.zone === 'C' ? mixc(base, P(6), 0.25) : b.zone === 'I' ? mixc(base, P(3), 0.25) : base
    const roof = mixc(wall, b.district === 'tech' ? P(6) : P(3), 0.5) // burn-source district hue
    wall = fade(wall, near)
    for (let y = ground; y > ground - h; y--) {
      const floor = ground - y
      for (let x = x0; x <= x1; x++) {
        if (b.damage > 0.2 && srnd(x * 7 + y, b.gx * 31 + b.gy) < b.damage * 0.3) continue // cracks
        let c = y === ground - h + 1 ? fade(roof, near) : wall
        const col = x - x0
        if (x1 - x0 >= 2 && col % 2 === 1 && floor % 2 === 1 && y > ground - h + 1) {
          if (b.boarded) c = fade(P(8), near)
          else if (lightsOn && litWindow(b.gx + col, b.gy, floor, slot)) c = P(11)
          else c = mixc(wall, bg, 0.45)
        }
        put(x, y, c)
      }
    }
    if (scene.overgrowth > 0 && srnd(b.gx * 3, b.gy * 5) < scene.overgrowth) {
      for (let x = x0; x <= x1; x += 2) put(x, ground, fade(P(2), near)) // vines reclaim the base
    }
  }

  // How tall a landmark stands, in pixels: what the crop keeps room for.
  function landmarkHeight(l) {
    const cap = (h) => (crop ? Math.min(h, CROP_MAX_H + 10) : h) // a landmark tops the skyline, by a little
    if (l.kind === 'tower') return cap(Math.round((maxH + (l.gift ? 10 : 4)) * fpx) + 1)
    if (l.kind === 'spire') return cap(Math.round((maxH + 6) * fpx * 1.2))
    if (l.kind === 'lighthouse') return Math.max(6, Math.round(maxH * fpx * 0.6)) + 1
    return SPRITES[l.kind]?.length ?? 3
  }

  function drawLandmark(l, near) {
    const x = Math.round(ux(l.gx - l.gy))
    const body = fade(mixc(base, P(7), 0.5), near)
    const blink = !stale && Math.floor(t / 7) % 2 === 0
    if (l.kind === 'tower') {
      // A needle with an observation pod near the top and a warning light; a gift tower stands taller.
      const top = Math.max(2, ground - landmarkHeight(l) + 1)
      for (let y = ground; y >= top; y--) put(x, y, body)
      for (const dx of [-1, 0, 1]) put(x + dx, top + 3, body)
      if (lightsOn) put(x, top + 3, P(11))
      if (blink) put(x, top - 1, P(9))
    } else if (l.kind === 'spire') {
      // Tapering to a point, the tallest thing in town.
      const tall = landmarkHeight(l)
      for (let dy = 0; dy < tall && ground - dy >= 1; dy++) {
        const half = dy < tall * 0.5 ? 1 : 0
        for (let dx = -half; dx <= half; dx++) put(x + dx, ground - dy, body)
      }
    } else if (l.kind === 'lighthouse') {
      const tall = landmarkHeight(l) - 1
      for (let dy = 0; dy < tall; dy++) put(x, ground - dy, Math.floor(dy / 2) % 2 ? fade(P(9), near) : body)
      put(x, ground - tall, elev < 0 || blink ? P(11) : body)
    } else if (SPRITES[l.kind]) {
      const rows = SPRITES[l.kind]
      rows.forEach((row, r) => {
        const y = ground - (rows.length - 1 - r)
        ;[...row].forEach((ch, c) => {
          const at = x - Math.floor(row.length / 2) + c
          if (ch === '#') put(at, y, body)
          else if (ch === '*') put(at, y, lightsOn ? P(11) : body)
          else if (ch === 'w') put(at, y, fade(P(12), near))
          else if (ch === 'g') put(at, y, fade(P(2), near))
          else if (ch === 'G') put(at, y, fade(P(10), near * 0.8))
        })
      })
    } else {
      for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy < 3; dy++) put(x + dx, ground - dy, fade(P(13), near))
    }
  }

  // --- the front street: road, water off the shore, and everyone on it ---
  for (let x = spanL; x <= spanR; x++) put(x, street, x % 4 === 0 ? fade(P(3), 0.5) : fade(P(8), 0.9))
    const margin = spanL + (W - 1 - spanR)
  if (harbour && margin >= 4) {
    for (let x = 0; x < W; x++) {
      if (x >= spanL && x <= spanR) continue
      put(x, street, (x + Math.floor(t / 8)) % 5 === 0 ? P(12) : fade(P(4), 0.7))
    }
    if (!stale) {
      for (let i = 0; i < 3; i++) {
        const pos = (srnd(i, 73) * margin + t * (0.02 + srnd(i, 71) * 0.03)) % margin
        const x = pos < spanL ? pos : spanR + 1 + (pos - spanL)
        for (let dx = 0; dx < 3; dx++) if (x + dx < spanL || x + dx > spanR) put(x + dx, lane, fade(P(7), 0.85))
        put(x + 1, lane - 1, fade(P(7), 0.6)) // mast
      }
    }
  }
  if (!stale && n >= 1) {
    const front = (onX, f) => ux(onX ? f * n - n : n - f * n) // the two front edges, left to right
    if (infection >= 0.5) {
      // Outbreak: traffic is gone; a few shamblers stagger the front street (drawShamblers' formula).
      const count = Math.round(4 + infection * 12)
      for (let i = 0; i < count; i++) {
        if (Math.round(srnd(i, 31) * n) !== n) continue
        const wobble = Math.sin(t * 0.09 + i) * 0.015
        const dir = srnd(i, 41) > 0.5 ? 1 : -1
        const f = (((srnd(i, 37) + dir * t * 0.0025 + wobble) % 1) + 1) % 1
        put(front(srnd(i, 29) < 0.5, f), lane, fade(P(2), 0.95))
      }
    } else {
      // drawCitizens' exact crowd: same count, lanes, speeds and positions.
      const vit = scene.vitality ?? 1
      const fest = scene.flags && scene.flags.festival ? 1.35 : 1
      const count = Math.min(170, Math.round((8 + n * 6) * (0.35 + 0.65 * vit) * (1 + (scene.scaleIndex ?? 0) * 0.12) * fest))
      const carColors = [P(11), P(13), P(14), P(15)]
      for (let i = 0; i < count; i++) {
        if (Math.round(srnd(i, 2) * n) !== n) continue // not on the street we see
        const onX = srnd(i, 1) < 0.5
        const car = srnd(i, 3) > 0.78
        const dir = srnd(i, 5) > 0.5 ? 1 : -1
        const f = (((srnd(i, 6) + dir * t * (car ? 0.02 : 0.009)) % 1) + 1) % 1
        const x = front(onX, f)
        if (car) {
          const len = k >= 2 ? 3 : 2
          for (let dx = 0; dx < len; dx++) put(x + dx, lane, carColors[i % carColors.length])
        } else put(x, lane, colors.fg)
      }
      const zoo = scene.flags && scene.flags.zoo ? 5 : 0
      const critters = Math.round((scene.overgrowth ?? 0) * 6) + zoo
      for (let i = 0; i < critters; i++) put(ux(srnd(i, 61) * 2 * n - n) + Math.sin(t * 0.02 + i) * 2, lane, fade(P(3), 0.7))
    }
  }

  // --- above it all, inside the shown sky: birds and planes pass now and then; rain and lightning while it rains;
  // a little snow or a few leaves in their season ---
  // A pass crosses the sky in `cross` ticks once every `period` ticks (~7 ticks a second); off its pass it is gone.
  const pass = (i, period, cross) => {
    const f = ((t + srnd(i, 59) * period) % period) / cross
    return f <= 1 ? f : null
  }
  const birdCross = Math.round((bw + 12) / 0.3)
  if (!stale && infection < 0.5 && n >= 1 && !raining) {
    const flocks = scene.flags && scene.flags.aviary ? 3 : 2
    for (let i = 0; i < flocks; i++) {
      const f = pass(i, Math.round(birdCross * 1.6), birdCross)
      if (f === null) continue
      const by = skyTop + 2 + Math.round(srnd(i, 51) * skyH * 0.35)
      const birds = 2 + Math.floor(srnd(i, 57) * 2)
      for (let b = 0; b < birds; b++) put(box.x0 - 6 + f * (bw + 12) + b * 2, by + (b % 2) + ((Math.floor(t / 6) + b) % 2), fade(colors.fg, 0.5))
    }
  }
  if (!stale) {
    // Airliners pass over any city; an airport adds its own, more often.
    const planeCross = Math.round((bw + 8) / 0.45)
    const planes = scene.services?.airport ? 2 : 1
    for (let i = 0; i < planes; i++) {
      const f = pass(7 + i, Math.round(planeCross * (scene.services?.airport ? 1.8 : 2.6)), planeCross)
      if (f === null) continue
      const y = skyTop + (raining ? 4 : 1) + i * 2
      const x = i % 2 ? box.x1 + 4 - f * (bw + 8) : box.x0 - 4 + f * (bw + 8) // the airport's goes the other way
      for (let dx = 0; dx < 3; dx++) put(x + dx, y, fade(P(7), 0.8))
      if (Math.floor(t / 5) % 2) put(i % 2 ? x + 3 : x - 1, y, P(9)) // nav light, a slow blink
    }
  }
  if (raining) {
    const spanY = H - 1 - (skyTop + 3)
    const drops = Math.round((bw * spanY) / (sw.storm ? 16 : 28))
    for (let i = 0; i < drops; i++) {
      const fall = 0.8 + srnd(i, 205) * 0.4
      const y = skyTop + 3 + ((srnd(i, 203) * spanY + t * fall) % spanY)
      const x = box.x0 + ((srnd(i, 201) * bw + t * 0.15) % bw)
      put(x, y, fade(P(12), 0.55))
      put(x, y + 1, fade(P(12), 0.35))
    }
    // Lightning: a jagged bolt from the cloud deck down toward the rooftops, for two ticks; often in a storm,
    // now and then in plain rain.
    const period = sw.storm ? 50 : 150
    const strike = Math.floor((t + 17) / period)
    if ((t + 17) % period < 2) {
      let x = box.x0 + 4 + Math.round(srnd(strike, 211) * Math.max(0, bw - 8))
      const bottom = skyTop + 3 + Math.round(skyH * (0.45 + 0.3 * srnd(strike, 213)))
      for (let y = skyTop + 2; y <= bottom; y++) {
        put(x, y, P(15))
        if (srnd(strike * 97 + y, 215) > 0.6) x += srnd(strike * 89 + y, 217) > 0.5 ? 1 : -1
      }
    }
  } else if (season === 'winter') {
    for (let i = 0; i < Math.round((bw * skyH) / 260); i++) {
      const fall = (0.5 + srnd(i, 91) * 0.6) * (H / 400)
      const y = skyTop + ((srnd(i, 93) * (H - skyTop) + t * fall) % (H - 1 - skyTop))
      put(box.x0 + ((srnd(i, 95) * bw + Math.sin(t * 0.015 + i) * 2 + bw) % bw), y, fade(P(15), 0.7))
    }
  } else if (season === 'autumn') {
    const leaves = [P(3), P(1), P(11), P(9)]
    for (let i = 0; i < Math.round((bw * skyH) / 450); i++) {
      const fall = (0.35 + srnd(i, 91) * 0.4) * (H / 450)
      const y = skyTop + ((srnd(i, 93) * (H - skyTop) + t * fall) % (H - 1 - skyTop))
      put(box.x0 + ((srnd(i, 95) * bw + Math.sin(t * 0.012 + i) * 3 + bw) % bw), y, fade(leaves[i % 4], 0.6))
    }
  }

  // --- a playing act or climax ---
  let dx = 0
  if (fx) {
    const p = clamp01(fx.p)
    const s = Math.sin(Math.PI * p)
    const wash = (c, a, y0 = 0, y1 = H - 2) => {
      for (let y = Math.max(0, y0); y <= y1; y++) for (let x = 0; x < W; x++) px[y * W + x] = mixc(at(x, y) ?? bg, c, a)
    }
    const drift = (cs, dir, count = Math.round(W / 3)) => {
      for (let i = 0; i < count; i++) {
        const f = (p * (0.6 + 0.9 * srnd(i, 101)) + srnd(i, 103)) % 1
        put(srnd(i, 105) * W, dir === 'down' ? f * H : H - 1 - f * H, cs[i % cs.length])
      }
    }
    if (fx.phase === 'ascension') {
      wash(P(11), 0.6 * s)
      drift([P(15), P(11)], 'up')
    } else if (fx.phase === 'rebirth') {
      wash(P(10), 0.5 * s)
      drift([P(10), P(15)], 'up')
    } else if (fx.phase === 'fall') {
      if (p < 0.16) wash(P(15), 1)
      else {
        wash(P(3), 0.5 * (1 - (p - 0.16) / 0.84))
        drift([P(7), P(8)], 'down')
      }
      if (p < 0.3) dx = t % 2 ? 1 : -1
    } else {
      const [kind, c1, extra, c2] = ACT_FX[fx.anim] ?? ['wash', 15]
      if (kind === 'wash') wash(P(c1), 0.42 * s)
      else if (kind === 'dark') wash(P(c1), 0.6 * s)
      else if (kind === 'up') drift([P(c1)], 'up')
      else if (kind === 'confetti') drift([9, 10, 11, 12, 13, 14].map(P), 'down')
      else if (kind === 'dust') {
        wash(P(3), 0.3 * s, Math.floor(H / 2))
        drift([fade(P(3), 0.8)], 'up')
      } else if (kind === 'fire') {
        wash(P(9), 0.55 * s, Math.floor(H * 0.6))
        drift([P(11), P(9)], 'up')
      } else if (kind === 'water') {
        const level = Math.round((H - 2) * 0.5 * s)
        wash(P(4), 0.55, H - 1 - level)
        for (let x = 0; x < W; x++) if (level > 0 && (x + t) % 3 === 0) put(x, H - 1 - level, P(12))
      } else if (kind === 'frost') {
        wash(P(14), 0.35 * s)
        drift([P(15)], 'down')
      } else if (kind === 'aurora') {
        for (let x = 0; x < W; x++) {
          const y = Math.round(ground * 0.25 + Math.sin(x * 0.15 + p * 6) * 2)
          for (let dy = 0; dy < 2; dy++) if (y + dy >= 0) px[(y + dy) * W + x] = mixc(at(x, y + dy) ?? bg, x % 2 ? P(10) : P(13), 0.6 * s)
        }
      } else if (kind === 'rainbow') {
        ;[9, 11, 10, 12, 13].forEach((ci, i) => wash(P(ci), 0.5 * s, 1 + i, 1 + i))
      } else if (kind === 'fireworks') {
        for (let b = 0; b < 3; b++) {
          const bt = p - b * 0.18
          if (bt < 0 || bt > 0.85) continue
          const r = bt * Math.min(W / 5, ground * 0.6)
          for (let j = 0; j < 12; j++) put(W * (0.25 + 0.25 * b) + Math.cos((j / 12) * 6.283) * r, ground * 0.35 + Math.sin((j / 12) * 6.283) * r * 0.6, P(9 + ((b + j) % 6)))
        }
      } else if (kind === 'meteor') {
        if (p < 0.5) {
          const q = p / 0.5
          const hx = q * W * 0.52, hy = q * ground * 0.85
          for (let j = 1; j <= 5; j++) put(hx - j, hy - j * 0.6, j < 3 ? P(11) : P(9))
          put(hx, hy, P(15))
        } else wash(P(15), Math.max(0, 0.8 - (p - 0.5) / 0.5))
      }
      if (extra === 'down') drift([P(c2)], 'down')
      if (extra === 'up') drift([P(c2)], 'up')
      if (SHAKE[fx.anim] && p < 0.35) dx = t % 2 ? 1 : -1
    }
  }

  // --- finish: the Outbreak's sickly cast, then the camera shake ---
  if (infection > 0) for (let i = 0; i < px.length; i++) if (px[i]) px[i] = mixc(px[i], P(2), 0.35 * infection)
  if (dx) {
    for (let y = 0; y < H; y++) {
      const row = px.slice(y * W, y * W + W)
      for (let x = 0; x < W; x++) px[y * W + x] = row[x - dx] ?? null
    }
  }
  if (!crop) return { W, H, px }
  const { x0, x1, y0 } = box
  const cw = x1 - x0 + 1, ch = H - y0
  const out = new Array(cw * ch)
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out[y * cw + x] = px[(y0 + y) * W + x0 + x]
  return { W: cw, H: ch, px: out }
}

// Cropped, the city is drawn at a fixed size — a tile 4 px across (3 of building, room for a column of windows) and
// a floor 2 px high (a row of windows each) — with this much sky above the tallest building, never narrower than
// CROP_MIN_W.
const CROP_TILE = 4
const CROP_FLOOR = 2
const CROP_SKY = 16
const CROP_MIN_W = 48
const CROP_MAX_W = 120
const CROP_MAX_H = 56

// Landmark silhouettes, top row first, the last row on the ground: # body, * a window that lights at night,
// w water, g/G greenery. Towers, spires and lighthouses are drawn by height instead.
const SPRITES = {
  dome: ['  ###  ', ' ##### ', '#######', '#*#*#*#', '#######'],
  observatory: ['  ##   ', ' ### # ', '#######', ' #*#*# ', ' ##### '],
  stadium: ['#       #', '##     ##', '#########'],
  monument: [' # ', ' # ', ' # ', ' # ', ' # ', '###'],
  fountain: ['w w w', ' www ', '  w  ', '#####'],
  bridge: ['###########', '#  #   #  #', '#         #'],
  park: ['G G', 'GGG', 'g g'],
}

// The city's own weather: a few spells of rain a day, 20–60 minutes each, likelier in autumn and winter, some of
// them storms. A spell may start once every three hours; it is a pure function of the (local) clock.
const SPELL_SLOT = 3 * 3_600_000
const RAIN_CHANCE = { winter: 0.4, autumn: 0.4, spring: 0.3, summer: 0.18 }
export function weatherAt(ms) {
  const here = Math.floor(ms / SPELL_SLOT)
  for (const slot of [here, here - 1]) {
    // srnd wants small integers: the slot within a ~6-year cycle.
    const s = ((slot % 20000) + 20000) % 20000
    if (srnd(s, 301) >= RAIN_CHANCE[seasonOf(slot * SPELL_SLOT)]) continue
    const start = slot * SPELL_SLOT + srnd(s, 303) * SPELL_SLOT * 0.8
    const length = (20 + srnd(s, 305) * 40) * 60_000
    if (ms >= start && ms < start + length) return { rain: true, storm: srnd(s, 307) < 0.35 }
  }
  return { rain: false, storm: false }
}

// About two windows in five lit, shuffled by `slot`.
const litWindow = (gx, gy, f, slot) => srnd(gx * 7 + gy * 13 + f * 17, slot) < 0.4
