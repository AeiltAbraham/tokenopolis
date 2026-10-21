#!/usr/bin/env node
// The skyline window process ([[window]] in the manifest): cornercase runs it next to each local
// window. It holds one lock so two windows show one skyline, runs the native helper (a floating panel:
// AppKit on macOS, GTK 4 on Linux; native/skyline-window), and feeds it frames of the city at the
// artifact's ~7 fps, the settings, and act/gift/climax banners; the helper's right-click menu and drags come back as settings changes,
// saved to settings.json in the state folder. Colours come from the terminal (Ghostty's config).

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, watchFile } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadState, logLine } from '../src/state.js'
import { cityData } from '../src/artifact.js'
import { readConfig } from '../src/config.js'
import { skylineFrame, DEFAULT_COLORS, parseTint } from '../src/render/skyline.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FRAME_MS = 140
const POLL_MS = 4000
const FX_MS = 4200
const CLIMAX_MS = 6500
const BANNER_MS = 9000
const FRESH_MS = 180_000 // an act/gift/climax this recent when the window opens still plays
export const SIZES = { small: 2, medium: 3, large: 4 } // points per skyline pixel; 'custom' is a zoom dragged on the edge
const SCALE = { min: 1, max: 8 }
const clampScale = (v) => Math.round(Math.max(SCALE.min, Math.min(SCALE.max, v)) * 100) / 100
const PIXELS = { w: 240, h: 120 } // the canvas the city is drawn on before it is cropped to the city (a 25-tile grid fits)
export const COLOR_MENU = ['fg', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']

// settings.json over config.json's skyline defaults; anything invalid falls back.
export function readSettings(dir, config = readConfig()) {
  let raw = {}
  try {
    raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) ?? {}
  } catch {
    raw = {}
  }
  const op = Number(raw.opacity)
  const pos = typeof raw.position === 'string' && (POSITIONS.includes(raw.position) || /^-?\d+,-?\d+$/.test(raw.position)) ? raw.position : 'bottom-right'
  return {
    visible: raw.visible !== false,
    position: pos,
    ...(raw.size === 'custom' && Number.isFinite(Number(raw.scale))
      ? { size: 'custom', scale: clampScale(Number(raw.scale)) }
      : { size: SIZES[raw.size] ? raw.size : 'medium' }),
    opacity: Number.isFinite(op) ? Math.max(0.1, Math.min(1, op)) : config.skyline.opacity,
    color: parseTint(raw.color) ?? config.skyline.color,
  }
}

export const scaleOf = (settings) => (settings.size === 'custom' ? settings.scale : SIZES[settings.size])

// A menu pick, a drag or a resize → the new settings (unchanged on junk).
export function applyChange(settings, msg) {
  if (msg.moved) return { ...settings, position: `${Math.round(msg.moved.x)},${Math.round(msg.moved.y)}` }
  if (msg.resized && Number.isFinite(Number(msg.resized.scale))) {
    const { x, y } = msg.resized
    return { ...settings, size: 'custom', scale: clampScale(Number(msg.resized.scale)), position: `${Math.round(x)},${Math.round(y)}` }
  }
  const { key, value } = msg.menu ?? {}
  if (key === 'position' && POSITIONS.includes(value)) return { ...settings, position: value }
  if (key === 'size' && SIZES[value]) {
    const { scale: _custom, ...rest } = settings
    return { ...rest, size: value }
  }
  if (key === 'opacity' && Number.isFinite(Number(value))) return { ...settings, opacity: Math.max(0.1, Math.min(1, Number(value))) }
  if (key === 'color' && parseTint(value)) return { ...settings, color: parseTint(value) }
  if (key === 'visible') return { ...settings, visible: value === 'true' }
  return settings
}

// The terminal's colours, from Ghostty's resolved config (`ghostty +show-config`). Null elsewhere.
export function parseGhosttyConfig(text) {
  const hex = (h) => {
    const n = parseInt(h.replace('#', ''), 16)
    return [n >> 16, (n >> 8) & 255, n & 255]
  }
  const colors = { fg: [...DEFAULT_COLORS.fg], bg: [...DEFAULT_COLORS.bg], palette: DEFAULT_COLORS.palette.map((c) => [...c]) }
  let found = false
  for (const line of text.split('\n')) {
    const m = /^(background|foreground)\s*=\s*#?([0-9a-f]{6})\s*$/i.exec(line)
    if (m) {
      colors[m[1] === 'background' ? 'bg' : 'fg'] = hex(m[2])
      found = true
    }
    const p = /^palette\s*=\s*(\d+)\s*=\s*#?([0-9a-f]{6})\s*$/i.exec(line)
    if (p && Number(p[1]) < 16) {
      colors.palette[Number(p[1])] = hex(p[2])
      found = true
    }
  }
  return found ? colors : null
}

function terminalColors() {
  for (const bin of ['ghostty', '/Applications/Ghostty.app/Contents/MacOS/ghostty']) {
    try {
      const c = parseGhosttyConfig(execFileSync(bin, ['+show-config'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }))
      if (c) return c
    } catch {
      /* not this one */
    }
  }
  return DEFAULT_COLORS
}

// The renderer reads time of day and season off a UTC clock; shifted by the viewer's offset it reads their own
// wall clock, so lights come on at their night.
export const localClock = (ms) => ms - new Date(ms).getTimezoneOffset() * 60_000

// Frame → RGBA bytes: see-through where nothing is drawn.
export function rgbaOf(frame) {
  const buf = Buffer.alloc(frame.W * frame.H * 4)
  frame.px.forEach((c, i) => {
    if (!c) return
    buf[i * 4] = c[0]
    buf[i * 4 + 1] = c[1]
    buf[i * 4 + 2] = c[2]
    buf[i * 4 + 3] = 255
  })
  return buf
}

export function bannerFor(item, tone) {
  if (tone === 'climax') {
    const text = { ascension: 'THE SINGULARITY', fall: 'NUCLEAR DOWNFALL', rebirth: 'THE CITY REBORN' }[item.phase]
    return { text, tone: item.phase === 'fall' ? 'disaster' : 'legendary' }
  }
  if (tone === 'gift') return { text: `Day ${item.day}: ${item.name}`, tone: 'gift' }
  return { text: `${item.tier === 'legendary' ? '★ ' : ''}${item.name}`, tone: item.tier === 'legendary' ? 'legendary' : item.kind }
}

// One skyline per user: the first window process to create the lock shows it; others wait.
function takeLock(path) {
  try {
    closeSync(openSync(path, 'wx'))
    writeFileSync(path, String(process.pid))
    return true
  } catch {
    let pid = 0
    try {
      pid = Number(readFileSync(path, 'utf8'))
      if (pid) process.kill(pid, 0)
      return false // a live holder
    } catch {
      try {
        unlinkSync(path) // stale: its process is gone
      } catch {
        /* raced */
      }
      return false
    }
  }
}

// The native helper (native/skyline-window, Rust): the released binary in bin/, else a local cargo build.
export function helperPath(base = root, exists = existsSync) {
  const candidates = [join(base, 'bin', 'skyline-window'), join(base, 'native', 'skyline-window', 'target', 'release', 'skyline-window')]
  return candidates.find((p) => exists(p)) ?? null
}

function main() {
  const dir = process.env.CORNERCASE_PLUGIN_STATE || process.cwd()
  const log = (m) => logLine(dir, `skyline: ${m}`)
  const bin = helperPath()
  if (!bin) {
    log('no window helper: build it with `cargo build --release` in native/skyline-window')
    setInterval(() => {}, 1 << 30) // stay up so cornercase doesn't restart us in a loop
    return
  }
  const lockPath = join(dir, 'skyline.lock')
  const wait = setInterval(() => takeLock(lockPath) && (clearInterval(wait), run()), 2000)
  if (takeLock(lockPath)) {
    clearInterval(wait)
    run()
  }

  function run() {
    const config = readConfig()
    let settings = readSettings(dir, config)
    let colors = terminalColors()
    let data = null
    let tick = 0
    let lastSent = null
    let fx = null
    let banner = null
    const seen = { act: null, gift: null, climax: null }

    const helper = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] })
    const send = (obj) => helper.stdin.writable && helper.stdin.write(JSON.stringify(obj) + '\n')
    const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
    const pushConfig = () =>
      send({ config: { ...settings, scale: scaleOf(settings), colors: COLOR_MENU } })
    const pushBanner = () => {
      const tone = banner && { boon: 10, disaster: 9, legendary: 11, gift: 13 }[banner.tone]
      send({ banner: banner ? { text: banner.text, color: hex(tone ? colors.palette[tone] : colors.fg) } : {} })
    }
    const save = () => {
      try {
        writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2))
      } catch (e) {
        log(`could not save settings: ${e && e.message}`)
      }
    }

    let out = ''
    helper.stdout.setEncoding('utf8')
    helper.stdout.on('data', (chunk) => {
      out += chunk
      let nl
      while ((nl = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, nl)
        out = out.slice(nl + 1)
        try {
          settings = applyChange(settings, JSON.parse(line))
          save()
          pushConfig()
        } catch {
          /* not JSON */
        }
      }
    })
    helper.on('exit', (code) => {
      log(`window helper ended (${code})`)
      quit(1)
    })

    function noticeEvents(d, first) {
      const nowMs = Date.now()
      const isNew = (key, at) => at && at !== seen[key] && (!first || nowMs - Date.parse(at) < FRESH_MS)
      if (isNew('climax', d.climax?.at)) {
        fx = { phase: d.climax.phase, start: nowMs, dur: CLIMAX_MS }
        banner = { ...bannerFor(d.climax, 'climax'), until: nowMs + BANNER_MS }
      } else if (isNew('act', d.act?.at)) {
        fx = { anim: d.act.anim, start: nowMs, dur: FX_MS }
        banner = { ...bannerFor(d.act, 'act'), until: nowMs + BANNER_MS }
      } else if (isNew('gift', d.lastGift?.at)) {
        banner = { ...bannerFor(d.lastGift, 'gift'), until: nowMs + BANNER_MS }
      }
      if (banner) pushBanner()
      seen.climax = d.climax?.at ?? null
      seen.act = d.act?.at ?? null
      seen.gift = d.lastGift?.at ?? null
    }
    const readCity = () => {
      try {
        const s = loadState(dir)
        return s ? cityData(s, config) : null
      } catch {
        return null
      }
    }
    const refresh = () => {
      const d = readCity()
      if (!d) return
      noticeEvents(d, !data)
      data = d
    }

    function frame() {
      if (!data || !settings.visible) return
      const nowMs = Date.now()
      if (fx && nowMs - fx.start > fx.dur) fx = null
      if (banner && nowMs > banner.until) {
        banner = null
        pushBanner()
      }
      const f = fx ? { anim: fx.anim, phase: fx.phase, p: (nowMs - fx.start) / fx.dur } : null
      const px = skylineFrame(data, { width: PIXELS.w, height: PIXELS.h, tick: tick++, now: localClock(nowMs), colors, tint: settings.color, fx: f, crop: true })
      // Only a frame that changed is sent: the helper repaints (and the window server composites) only then.
      const rgba = rgbaOf(px).toString('base64')
      if (rgba === lastSent) return
      lastSent = rgba
      send({ frame: { w: px.W, h: px.H, rgba } })
    }

    // settings.json changed outside (the "Show/Hide Skyline" action): apply it.
    watchFile(join(dir, 'settings.json'), { interval: 1000 }, () => {
      const next = readSettings(dir, config)
      if (JSON.stringify(next) !== JSON.stringify(settings)) {
        settings = next
        pushConfig()
      }
    })

    const timers = [
      setInterval(frame, FRAME_MS),
      setInterval(refresh, POLL_MS),
      setInterval(() => (colors = terminalColors()), 60_000), // follow theme changes
    ]
    function quit(code = 0) {
      for (const t of timers) clearInterval(t)
      try {
        helper.kill()
      } catch {
        /* gone */
      }
      try {
        unlinkSync(lockPath)
      } catch {
        /* gone */
      }
      process.exit(code)
    }
    process.on('SIGTERM', () => quit(0))
    process.on('SIGINT', () => quit(0))

    refresh()
    pushConfig()
    frame()
    log(`window ready (${settings.visible ? 'shown' : 'hidden'}, ${settings.position}, ${settings.size}, ${Math.round(settings.opacity * 100)}%, ${settings.color}; colours ${colors === DEFAULT_COLORS ? 'default' : 'from Ghostty'})`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
