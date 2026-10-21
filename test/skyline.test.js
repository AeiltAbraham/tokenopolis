import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sceneFor } from '../src/render/scene.js'
import { skylineFrame, parseTint, resolveTint, DEFAULT_COLORS, weatherAt } from '../src/render/skyline.js'
import { readSettings, applyChange, parseGhosttyConfig, rgbaOf, bannerFor, helperPath, scaleOf } from '../bin/skyline-window.js'
import { toggleSkyline } from '../scripts/toggle-skyline.mjs'
import { readConfig, DEFAULT_CONFIG } from '../src/config.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'tokenopolis-'))
const NOON_SUMMER = Date.parse('2026-07-01T12:00:00Z')
const cityAt = (sim, extra = {}) => ({ scene: sceneFor({ condition: 'Thriving', vitality: 1, ...sim }, 4242), era: 'build', ...extra })
const lively = cityAt({ scaleIndex: 4, peakScaleIndex: 4 })
const view = (o = {}) => ({ width: 100, height: 20, now: NOON_SUMMER, ...o })
const crop = { width: 240, height: 120, now: NOON_SUMMER, crop: true }
const laneRow = (f) => f.px.slice((f.H - 2) * f.W, (f.H - 1) * f.W)
const runs = (row) => {
  let best = 0, cur = 0
  for (const c of row) best = Math.max(best, (cur = c ? cur + 1 : 0))
  return best
}

test('tints: fg, ANSI names, ansi:N and #hex resolve against the terminal colours; junk is rejected', () => {
  assert.equal(parseTint('Cyan'), 'cyan')
  assert.equal(parseTint('bright-red'), 'bright-red')
  assert.equal(parseTint('ansi:12'), 'ansi:12')
  assert.equal(parseTint('#A0b1C2'), '#a0b1c2')
  for (const bad of ['ansi:16', 'purple', '#abc', 42, null]) assert.equal(parseTint(bad), null)
  const colors = { ...DEFAULT_COLORS, fg: [1, 2, 3] }
  assert.deepEqual(resolveTint('fg', colors), [1, 2, 3])
  assert.deepEqual(resolveTint('blue', colors), DEFAULT_COLORS.palette[4])
  assert.deepEqual(resolveTint('bright-blue', colors), DEFAULT_COLORS.palette[12])
  assert.deepEqual(resolveTint('#102030', colors), [16, 32, 48])
  assert.deepEqual(resolveTint('nonsense', colors), [1, 2, 3], 'falls back to the terminal fg')
})

test('a frame is deterministic, and the sky stays see-through', () => {
  const f = skylineFrame(lively, view({ tick: 7 }))
  assert.deepEqual(f, skylineFrame(lively, view({ tick: 7 })))
  assert.ok(f.px.filter(Boolean).length > 100, 'the city is drawn')
  assert.ok(f.px.slice(0, f.W * 4).filter((c) => c === null).length > f.W * 2, 'most of the upper sky is empty')
})

test('the building colour follows the tint', () => {
  const plain = skylineFrame(lively, view())
  const blue = skylineFrame(lively, view({ tint: 'blue' }))
  assert.notDeepEqual(plain.px, blue.px)
})

test('windows are dark by day, lit by night, and hold still from frame to frame', () => {
  const yellow = DEFAULT_COLORS.palette[11]
  const lit = (f) => f.px.slice(f.W * 8, (f.H - 3) * f.W).filter((c) => c && c.join() === yellow.join()).length
  const night = Date.parse('2026-07-01T23:00:00Z')
  assert.equal(lit(skylineFrame(lively, view({ now: NOON_SUMMER }))), 0, 'no lights at noon')
  assert.ok(lit(skylineFrame(lively, view({ now: night }))) > 5, 'lights at night')
  const a = skylineFrame(lively, view({ now: night, tick: 1 }))
  const b = skylineFrame(lively, view({ now: night + 1000, tick: 2 }))
  assert.equal(lit(a), lit(b), 'the same windows stay lit a second later')
})

test('birds and planes pass often but not all the time; an airport adds planes', () => {
  const clear = { rain: false, storm: false }
  const bird = DEFAULT_COLORS.fg.map((v, i) => Math.round(DEFAULT_COLORS.bg[i] + (v - DEFAULT_COLORS.bg[i]) * 0.5)).join()
  const plane = DEFAULT_COLORS.palette[7].map((v, i) => Math.round(DEFAULT_COLORS.bg[i] + (v - DEFAULT_COLORS.bg[i]) * 0.8)).join()
  const ticks = Array.from({ length: 300 }, (_, i) => i * 10)
  const seen = (city, colour) => ticks.filter((t) => skylineFrame(city, { ...crop, tick: t, weather: clear }).px.some((c) => c && c.join() === colour)).length
  const withAirport = cityAt({ scaleIndex: 4, peakScaleIndex: 4, services: { airport: true } })
  for (const [name, count] of [['birds', seen(lively, bird)], ['a plane', seen(lively, plane)]]) {
    assert.ok(count > ticks.length * 0.25, `${name} are seen often (${count}/${ticks.length})`)
    assert.ok(count < ticks.length, `${name} are not always there`)
  }
  assert.ok(seen(withAirport, plane) > seen(lively, plane), 'an airport brings more planes')
})

test("the city's weather: a few spells of rain a day, more in autumn than in summer, the same for the same moment", () => {
  const share = (from) => {
    let wet = 0
    for (let m = 0; m < 30 * 24 * 60; m += 10) if (weatherAt(Date.parse(from) + m * 60_000).rain) wet++
    return wet / (30 * 24 * 6)
  }
  const autumn = share('2026-10-01T00:00:00Z'), summer = share('2026-07-01T00:00:00Z')
  assert.ok(autumn > 0.03 && autumn < 0.25, `autumn rains ${(autumn * 100).toFixed(1)}% of the time`)
  assert.ok(summer < autumn, 'summer is drier')
  const at = Date.parse('2026-10-21T18:00:00Z')
  assert.deepEqual(weatherAt(at), weatherAt(at))
})

test('the sun by day and the moon by night sit inside the cropped sky; rain clouds the sun over', () => {
  const sun = DEFAULT_COLORS.palette[11].join()
  const noon = { ...crop, now: NOON_SUMMER }
  assert.ok(skylineFrame(lively, { ...noon, weather: { rain: false, storm: false } }).px.some((c) => c && c.join() === sun), 'a bright sun')
  const wet = skylineFrame(lively, { ...noon, weather: { rain: true, storm: false } })
  assert.ok(!wet.px.some((c) => c && c.join() === sun), 'no bright sun in the rain')
  const moon = DEFAULT_COLORS.palette[15].map((v, i) => Math.round(DEFAULT_COLORS.bg[i] + (v - DEFAULT_COLORS.bg[i]) * 0.85)).join()
  const night = skylineFrame(lively, { ...crop, now: Date.parse('2026-07-01T23:30:00Z'), weather: { rain: false, storm: false } })
  assert.ok(night.px.some((c) => c && c.join() === moon), 'the moon')
})

test('rain falls, and lightning strikes now and then while it rains — more often in a storm', () => {
  const bolt = DEFAULT_COLORS.palette[15].join()
  const strikes = (weather) => Array.from({ length: 300 }, (_, t) => t).filter((t) => skylineFrame(lively, { ...crop, tick: t, weather }).px.some((c) => c && c.join() === bolt)).length
  const rain = strikes({ rain: true, storm: false }), storm = strikes({ rain: true, storm: true })
  assert.ok(rain > 0 && rain < 30, `lightning in plain rain: ${rain} of 300 ticks`)
  assert.ok(storm > rain, 'more in a storm')
  assert.equal(strikes({ rain: false, storm: false }), 0, 'none in fair weather')
  const drop = DEFAULT_COLORS.palette[12].map((v, i) => Math.round(DEFAULT_COLORS.bg[i] + (v - DEFAULT_COLORS.bg[i]) * 0.55)).join()
  assert.ok(skylineFrame(lively, { ...crop, weather: { rain: true, storm: false } }).px.some((c) => c && c.join() === drop), 'raindrops')
})

test('cars and people move along the front street; a stale city empties it', () => {
  const frames = Array.from({ length: 40 }, (_, t) => laneRow(skylineFrame(lively, view({ tick: t * 5 }))))
  assert.ok(frames.some((r) => runs(r) >= 2), 'a car (2+ px) passes at some point')
  assert.ok(new Set(frames.map((r) => r.map((c) => (c ? 1 : 0)).join(''))).size > 1, 'the street changes over time')
  const stale = cityAt({ scaleIndex: 4, peakScaleIndex: 4, vitality: 0.1 })
  assert.equal(laneRow(skylineFrame(stale, view({ tick: 9 }))).filter(Boolean).length, 0, 'no one walks a stale city')
})

test('an outbreak replaces traffic with single shamblers', () => {
  const infected = cityAt({ scaleIndex: 4, peakScaleIndex: 4, infection: { severity: 0.9 } })
  for (let t = 0; t < 40; t++) {
    const row = laneRow(skylineFrame(infected, view({ tick: t * 5 })))
    assert.ok(row.filter(Boolean).length <= Math.round(4 + 0.9 * 12), 'at most the shambler count')
  }
})

test('acts and climaxes change the frame; quakes shake it', () => {
  const plain = skylineFrame(lively, view({ tick: 3 }))
  for (const fx of [{ anim: 'fireworks', p: 0.4 }, { anim: 'flood', p: 0.5 }, { anim: 'meteor', p: 0.3 }, { phase: 'fall', p: 0.1 }, { anim: 'unknown', p: 0.5 }]) {
    assert.notDeepEqual(skylineFrame(lively, view({ tick: 3, fx })).px, plain.px, JSON.stringify(fx))
  }
  const shaken = skylineFrame(lively, view({ tick: 3, fx: { anim: 'quake', p: 0.1 } }))
  const row = (f) => f.px.slice((f.H - 4) * f.W, (f.H - 3) * f.W).map((c) => (c ? 1 : 0)).join('')
  assert.notEqual(row(shaken), row(plain))
})

test('night, winter and every scale render without throwing, down to a tiny grid', () => {
  for (const s of [0, 1, 4, 8, 16]) {
    for (const now of [NOON_SUMMER, Date.parse('2026-01-05T23:00:00Z'), Date.parse('2026-10-05T06:00:00Z')]) {
      const city = cityAt({ scaleIndex: s, peakScaleIndex: s, services: { airport: true, harbour: true } })
      assert.doesNotThrow(() => skylineFrame(city, { width: 120, height: 36, now, tick: 11 }))
    }
  }
  assert.doesNotThrow(() => skylineFrame(lively, { width: 1, height: 1, now: NOON_SUMMER }))
})

test('rgba: drawn pixels opaque, empty ones fully transparent', () => {
  const buf = rgbaOf({ W: 2, H: 1, px: [[10, 20, 30], null] })
  assert.deepEqual([...buf], [10, 20, 30, 255, 0, 0, 0, 0])
})

test("Ghostty's resolved config gives the terminal colours; anything else gives none", () => {
  const c = parseGhosttyConfig('font-size = 13\nbackground = #1f1f24\nforeground = ffffff\npalette = 4=#4ec4e6\npalette = 17=#00005f\n')
  assert.deepEqual(c.bg, [31, 31, 36])
  assert.deepEqual(c.fg, [255, 255, 255])
  assert.deepEqual(c.palette[4], [78, 196, 230])
  assert.deepEqual(c.palette[5], DEFAULT_COLORS.palette[5])
  assert.equal(c.palette.length, 16)
  assert.equal(parseGhosttyConfig('font-size = 13\n'), null)
})

test('settings: defaults from config.json, overrides from settings.json, junk falls back', () => {
  const dir = tmp()
  assert.deepEqual(readSettings(dir, DEFAULT_CONFIG), { visible: true, position: 'bottom-right', size: 'medium', opacity: 0.85, color: 'fg' })
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ visible: false, position: '120,-40', size: 'large', opacity: 9, color: 'cyan' }))
  assert.deepEqual(readSettings(dir, DEFAULT_CONFIG), { visible: false, position: '120,-40', size: 'large', opacity: 1, color: 'cyan' })
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ position: 'middle', size: 'huge', opacity: 'x', color: 'plaid' }))
  assert.deepEqual(readSettings(dir, DEFAULT_CONFIG), { visible: true, position: 'bottom-right', size: 'medium', opacity: 0.85, color: 'fg' })
})

test('menu picks and drags update the settings; junk leaves them alone', () => {
  const s = { visible: true, position: 'bottom-right', size: 'medium', opacity: 0.85, color: 'fg' }
  assert.equal(applyChange(s, { menu: { key: 'position', value: 'top-left' } }).position, 'top-left')
  assert.equal(applyChange(s, { moved: { x: 10.4, y: 20.6 } }).position, '10,21')
  assert.equal(applyChange(s, { menu: { key: 'size', value: 'small' } }).size, 'small')
  assert.equal(applyChange(s, { menu: { key: 'opacity', value: '0.25' } }).opacity, 0.25)
  assert.equal(applyChange(s, { menu: { key: 'color', value: 'magenta' } }).color, 'magenta')
  assert.equal(applyChange(s, { menu: { key: 'visible', value: 'false' } }).visible, false)
  for (const junk of [{ menu: { key: 'size', value: 'huge' } }, { menu: { key: 'nope', value: 1 } }, {}]) assert.deepEqual(applyChange(s, junk), s)
})

test('a resize on the edge saves a custom zoom and where the window went; a menu size replaces it', () => {
  const s = { visible: true, position: 'bottom-right', size: 'medium', opacity: 0.85, color: 'fg' }
  const zoomed = applyChange(s, { resized: { scale: 5.437, x: 10, y: 20 } })
  assert.deepEqual(zoomed, { ...s, size: 'custom', scale: 5.44, position: '10,20' })
  assert.equal(scaleOf(zoomed), 5.44)
  assert.equal(applyChange(s, { resized: { scale: 99, x: 0, y: 0 } }).scale, 8)
  const back = applyChange(zoomed, { menu: { key: 'size', value: 'small' } })
  assert.equal(back.size, 'small')
  assert.equal('scale' in back, false)
  assert.equal(scaleOf(back), 2)
  const dir = tmp()
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ size: 'custom', scale: 0.2 }))
  assert.deepEqual([readSettings(dir, DEFAULT_CONFIG).size, readSettings(dir, DEFAULT_CONFIG).scale], ['custom', 1])
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ size: 'custom' }))
  assert.equal(readSettings(dir, DEFAULT_CONFIG).size, 'medium', 'custom without a zoom falls back')
})

test('banners name the act, the gift or the climax', () => {
  assert.deepEqual(bannerFor({ name: 'Meteor Shower', kind: 'disaster', tier: 'common' }, 'act'), { text: 'Meteor Shower', tone: 'disaster' })
  assert.deepEqual(bannerFor({ name: 'Rain of Gold', kind: 'boon', tier: 'legendary' }, 'act'), { text: '★ Rain of Gold', tone: 'legendary' })
  assert.deepEqual(bannerFor({ day: 3, name: 'Harbour' }, 'gift'), { text: 'Day 3: Harbour', tone: 'gift' })
  assert.equal(bannerFor({ phase: 'fall' }, 'climax').tone, 'disaster')
})

test('the window helper: the released binary first, else the local cargo build, else none', () => {
  const released = join('/p', 'bin', 'skyline-window')
  const built = join('/p', 'native', 'skyline-window', 'target', 'release', 'skyline-window')
  assert.equal(helperPath('/p', (p) => p === released || p === built), released)
  assert.equal(helperPath('/p', (p) => p === built), built)
  assert.equal(helperPath('/p', () => false), null)
})

test('the Show/Hide Skyline action flips visibility and keeps the other settings', () => {
  const dir = tmp()
  assert.equal(toggleSkyline(dir), false, 'shown by default, so the first toggle hides it')
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ visible: false, size: 'large' }))
  assert.equal(toggleSkyline(dir), true)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')), { visible: true, size: 'large' })
})

test('config: skyline colour + opacity are validated, clamped, and default when missing or junk', () => {
  const dir = tmp()
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ skyline: { color: 'magenta', opacity: 3 } }))
  assert.deepEqual(readConfig(dir).skyline, { color: 'magenta', opacity: 1 })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ skyline: { color: 'nope', opacity: 'x' } }))
  assert.deepEqual(readConfig(dir).skyline, DEFAULT_CONFIG.skyline)
})

test('cropped to the city: much smaller than the canvas, the same from tick to tick, bigger for a bigger city', () => {
  const canvas = { width: 240, height: 90, now: NOON_SUMMER }
  const a = skylineFrame(lively, { ...canvas, crop: true, tick: 1 })
  const b = skylineFrame(lively, { ...canvas, crop: true, tick: 50 })
  assert.ok(a.W < 240 && a.H < 90, `${a.W}×${a.H} inside 240×90`)
  assert.deepEqual([a.W, a.H], [b.W, b.H], 'the crop holds still')
  assert.ok(a.W >= 48)
  assert.ok(a.px.filter(Boolean).length > a.px.length * 0.15, 'the city fills a good part of the crop')
  const hamlet = skylineFrame(cityAt({ scaleIndex: 0, peakScaleIndex: 0 }), { ...canvas, crop: true })
  assert.ok(hamlet.W <= a.W && hamlet.H <= a.H)
})
