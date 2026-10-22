import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drawCity, lampFraction, streetActivity } from '../src/render/draw.js'
import { THEMES, resolveTheme } from '../src/render/themes.js'
import { sceneFor } from '../src/render/scene.js'

const round = (n) => Math.round(n * 100) / 100

// Recording canvas 2D stub: captures geometry OPS (not style assignments) and the __layer markers.
function recCtx() {
  const ops = []
  const layers = []
  const rec = (...a) => ops.push(a)
  return {
    canvas: { width: 960, height: 640 },
    ops,
    layers,
    __layer: (n) => layers.push(n),
    set fillStyle(_) {},
    get fillStyle() { return '' },
    set strokeStyle(_) {},
    get strokeStyle() { return '' },
    set lineWidth(_) {},
    beginPath: () => rec('beginPath'),
    closePath: () => rec('closePath'),
    moveTo: (x, y) => rec('moveTo', round(x), round(y)),
    lineTo: (x, y) => rec('lineTo', round(x), round(y)),
    rect: (x, y, w, h) => rec('rect', round(x), round(y), round(w), round(h)),
    fillRect: (x, y, w, h) => rec('fillRect', round(x), round(y), round(w), round(h)),
    arc: (x, y, r) => rec('arc', round(x), round(y), round(r)),
    fill: () => rec('fill'),
    stroke: () => rec('stroke'),
    save: () => {},
    restore: () => {},
    translate: () => {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }
}

const city = (over = {}) => ({ peakScaleIndex: 4, scaleIndex: 4, condition: 'Thriving', vitality: 1, ...over })
const scene = (over, seed = 7) => sceneFor(city(over), seed)

test('all themes exist; unknown theme falls back to temperate', () => {
  assert.deepEqual(
    Object.keys(THEMES).sort(),
    ['ascension', 'blueprint', 'coastal', 'crt', 'cyberpunk', 'desert', 'neon', 'nordic', 'solarpunk', 'temperate', 'wasteland'],
  )
  assert.equal(resolveTheme('does-not-exist'), THEMES.temperate)
})

test('z-order: ground → buildings → overlay (underground behind, landmarks between)', () => {
  const ctx = recCtx()
  drawCity(ctx, scene(), 'temperate', 0)
  assert.deepEqual(ctx.layers, ['underground', 'ground', 'roads', 'buildings', 'landmarks', 'citizens', 'overlay'])
})

test('draws every building (at least one fill per building)', () => {
  const ctx = recCtx()
  const s = scene()
  drawCity(ctx, s, 'temperate', 0)
  const fills = ctx.ops.filter((o) => o[0] === 'fill').length
  assert.ok(fills >= s.buildings.length, `expected ≥ ${s.buildings.length} fills, got ${fills}`)
})

test('tick 0 renders a complete frame; no throw at scales 0, 4, 64', () => {
  for (const size of [0, 4, 64]) {
    const ctx = recCtx()
    assert.doesNotThrow(() => drawCity(ctx, scene({ peakScaleIndex: size, scaleIndex: size }), 'neon', 0))
    assert.ok(ctx.ops.length > 0, `scale ${size}: tick-0 frame should draw something`)
  }
})

test('condition is legible structurally: geometry identical across palettes (grayscale-safe)', () => {
  const grayscale = {
    sky: '#808080', ground: '#707070', road: '#606060', roof: '#505050', window: '#f0f0f0',
    damage: '#202020', rubble: '#505050', underground: '#303030', accent: '#a0a0a0',
    zone: { R: '#909090', C: '#888888', I: '#808080', park: '#989898' },
  }
  const s = scene({ condition: 'Blighted' })
  const a = recCtx()
  const b = recCtx()
  drawCity(a, s, 'temperate', 0)
  drawCity(b, s, grayscale, 0)
  assert.deepEqual(a.ops, b.ops) // palette changes nothing about geometry → structure carries condition
})

test('vitality drives animation: lively frames differ by tick; stale frames are still', () => {
  const lively = scene({ vitality: 1 })
  const l0 = recCtx()
  const l1 = recCtx()
  drawCity(l0, lively, 'temperate', 0)
  drawCity(l1, lively, 'temperate', 10)
  assert.notDeepEqual(l0.ops, l1.ops, 'a lively city should animate between ticks')

  const stale = scene({ vitality: 0, condition: 'Blighted' })
  const s0 = recCtx()
  const s1 = recCtx()
  drawCity(s0, stale, 'temperate', 0)
  drawCity(s1, stale, 'temperate', 10)
  assert.deepEqual(s0.ops, s1.ops, 'a stale city should hold still across ticks')
})

test('a stale city mid-Pyromid-build also holds still (the construction crane hook must not drift)', () => {
  // The base stale guard above can't catch this: its scene has no pyromid, so drawPyromid early-returns.
  // A city that burned enough to start the Pyromid then went quiet is a reachable stale + mid-build state.
  const staleBuild = { ...scene({ vitality: 0, condition: 'Blighted' }), pyromid: { progress: 0.5 } }
  const s0 = recCtx()
  const s1 = recCtx()
  drawCity(s0, staleBuild, 'temperate', 0)
  drawCity(s1, staleBuild, 'temperate', 10)
  assert.deepEqual(s0.ops, s1.ops, 'a stale mid-build Pyromid must not animate its crane hook across ticks')
})

test('window lights track the local clock and hold steady across frames (no per-tick flicker)', () => {
  const lively = scene({ vitality: 1 })
  const bloom = (tick, tod) => {
    const c = recCtx()
    drawCity(c, lively, 'temperate', tick, tod)
    return c.ops.filter((o) => o[0] === 'fillRect' && o[3] === 6 && o[4] === 7) // lit-window bloom
  }
  const noon = 0.5, evening = 22 / 24
  // steady: the SAME clock at two different frame ticks yields the identical lit-set (the flicker is gone)
  assert.deepEqual(bloom(0, evening), bloom(37, evening), 'lit windows must hold steady across frames')
  // clock-driven: far fewer windows are lit at midday than in the evening
  assert.ok(bloom(0, noon).length < bloom(0, evening).length, 'evening must light more windows than midday')
})

test('lamp + activity curves: bounded, deterministic, and shaped by the clock (dark day, lit evening, sleep after 23:00)', () => {
  const h = (hr) => hr / 24
  for (const tod of [0, 0.12, 0.3, 0.5, 0.75, 22 / 24, 0.99, 1, -0.1, 1.4]) {
    for (const v of [lampFraction(tod), streetActivity(tod)]) assert.ok(v >= 0 && v <= 1, `${tod} → ${v} must be in [0,1]`)
    assert.equal(lampFraction(tod), lampFraction(tod), 'deterministic')
  }
  // windows: near-dark midday, bright evening, dimming after people sleep
  assert.ok(lampFraction(h(13)) < lampFraction(h(22)), 'evening is brighter than midday')
  assert.ok(lampFraction(h(2)) < lampFraction(h(22)), 'the small hours are darker than the evening peak')
  assert.ok(lampFraction(h(1)) < lampFraction(h(23)), 'lights thin out after 23:00 (people sleep)')
  // streets: busy by day, quiet in the small hours
  assert.ok(streetActivity(h(13)) > streetActivity(h(3)), 'daytime streets are busier than 3am')
  assert.ok(streetActivity(h(1)) < streetActivity(h(20)), 'movement dies down after 23:00')
})

test('infrastructure renders: roads as strokes, one accent pip per unlocked higher tier', () => {
  const ctx4 = recCtx()
  drawCity(ctx4, scene({ peakScaleIndex: 4, scaleIndex: 4 }), 'temperate', 0)
  const pips = (ctx) => ctx.ops.filter((o) => o[0] === 'fillRect' && o[3] === 6 && o[4] === 6).length
  assert.equal(pips(ctx4), 4, 'Metropolis has power+water+transit+data')
  assert.ok(ctx4.ops.some((o) => o[0] === 'stroke'), 'roads are drawn as strokes')

  const ctx0 = recCtx()
  drawCity(ctx0, scene({ peakScaleIndex: 0, scaleIndex: 0 }), 'temperate', 0)
  assert.equal(pips(ctx0), 0, 'a hamlet has no higher infra tiers yet')
})

test('service vehicles render only when the service gift is unlocked', () => {
  const base = recCtx()
  drawCity(base, scene(), 'temperate', 3)
  const withServ = recCtx()
  drawCity(withServ, { ...scene(), services: { harbour: true, airport: true } }, 'temperate', 3)
  assert.ok(withServ.ops.length > base.ops.length, 'a harbour + airport add boats and planes')
})
