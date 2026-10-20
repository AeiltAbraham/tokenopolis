import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildArtifactHtml, writeArtifact } from '../src/artifact.js'
import { readConfig, DEFAULT_CONFIG } from '../src/config.js'
import { initState, applyStatsRead } from '../src/state.js'
import { step } from '../src/sim/condition.js'
import { economyFor } from '../src/sim/economy.js'

function makeState() {
  const s0 = initState({ baselineLifetimeTokens: 0, installedAt: '2026-10-19T00:00:00.000Z', citySeed: 2024 })
  const next = applyStatsRead(s0, { lifetimeTotal: 140_000_000, burn24h: 40e6, burn7d: 140e6, readAt: '2026-10-19T01:00:00.000Z' })
  const sim = step(s0.sim, { builtTokens: next.sim.builtTokens, burn24h: 40e6, burn7d: 140e6 }, '2026-10-19T01:00:00.000Z')
  return { ...next, sim }
}
const tmp = () => mkdtempSync(join(tmpdir(), 'tokenopolis-'))

test('self-contained: no external references (grayscale of the L172 self-containment guard)', () => {
  const html = buildArtifactHtml(makeState(), { cityName: 'Testopolis', theme: 'neon' })
  assert.doesNotMatch(html, /https?:\/\//i, 'no absolute URLs')
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*["']\s*\/\//i, 'no protocol-relative src/href')
  assert.doesNotMatch(html, /<link\b/i, 'no external stylesheet links')
})

test('embedded city-data JSON round-trips and matches the computed readout', () => {
  const state = makeState()
  const html = buildArtifactHtml(state, DEFAULT_CONFIG)
  const raw = html.match(/<script id="city-data"[^>]*>([\s\S]*?)<\/script>/)[1]
  const data = JSON.parse(raw)
  assert.ok(Array.isArray(data.scene.buildings))
  assert.equal(data.readout.population, economyFor(state.sim.builtTokens, state.sim.vitality).population)
  assert.equal(data.theme, 'temperate')
})

test('HUD shows the economy readout, lifetime panel, name and theme', () => {
  const html = buildArtifactHtml(makeState(), { cityName: 'Burgville', theme: 'coastal' })
  for (const label of ['Population', 'Treasury', 'Economy', 'Vitality', 'Peak', 'Decay clock']) {
    assert.ok(html.includes(label), `HUD missing "${label}"`)
  }
  assert.ok(html.includes('Burgville'), 'city name shown')
  assert.ok(html.includes('theme: coastal'), 'theme shown')
})

test('the A Random Act button is always present and carries live cooldown data', () => {
  const base = makeState()
  const withCd = { ...base, acts: { usedIds: ['tsunami'], lastActAt: '2026-10-19T00:30:00.000Z', last: null } }
  const html = buildArtifactHtml(withCd, DEFAULT_CONFIG)
  assert.ok(html.includes('id="act-btn"'), 'the button is rendered')
  const data = JSON.parse(html.match(/<script id="city-data"[^>]*>([\s\S]*?)<\/script>/)[1])
  assert.ok(data.cooldownMs > 0, 'cooldown window embedded for the countdown')
  assert.equal(data.lastActAt, '2026-10-19T00:30:00.000Z', 'cooldown stamp embedded')
})

test('city.html stays ≤ 300 KB and writeArtifact writes it', () => {
  const dir = tmp()
  const { path, bytes } = writeArtifact(makeState(), DEFAULT_CONFIG, dir)
  assert.ok(existsSync(path))
  assert.ok(bytes <= 300 * 1024, `city.html is ${bytes} bytes (> 300KB)`)
})

test('config: defaults when absent/invalid; valid parsed; bad theme → temperate', () => {
  assert.deepEqual(readConfig(undefined), DEFAULT_CONFIG)
  assert.deepEqual(readConfig('/no/such/dir/xyz'), DEFAULT_CONFIG)
  const dir = tmp()
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ cityName: 'Metropol', theme: 'desert' }))
  assert.deepEqual(readConfig(dir), { cityName: 'Metropol', theme: 'desert' })
  const dir2 = tmp()
  writeFileSync(join(dir2, 'config.json'), JSON.stringify({ cityName: 'X', theme: 'rainbow' }))
  assert.equal(readConfig(dir2).theme, 'temperate')
})

test('the inlined bundle actually runs: boot script executes under node:vm and draws', () => {
  const html = buildArtifactHtml(makeState(), { cityName: 'VMtown', theme: 'nordic' })
  const boot = html.match(/<script id="city-boot">([\s\S]*?)<\/script>/)[1]
  const dataJson = html.match(/<script id="city-data"[^>]*>([\s\S]*?)<\/script>/)[1]

  let fills = 0
  const ctxStub = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'canvas') return { width: 960, height: 640 }
        if (prop === 'fill') return () => { fills++ }
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} })
        return () => {}
      },
      set() { return true },
    },
  )
  const document = {
    getElementById(id) {
      if (id === 'city-data') return { textContent: dataJson }
      if (id === 'city') return { getContext: () => ctxStub }
      if (id === 'decay') return {}
      return null
    },
  }
  const context = { document, JSON, Date, Math, parseInt, isNaN, console }
  assert.doesNotThrow(() => vm.runInNewContext(boot, context, { timeout: 2000 }))
  assert.ok(fills > 0, 'drawCity should have issued fills when the boot script ran')
})
