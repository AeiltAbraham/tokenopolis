import { test } from 'node:test'
import assert from 'node:assert/strict'
import { THEMES, resolveTheme } from '../src/render/themes.js'

const names = Object.keys(THEMES)
const first = THEMES[names[0]]
const topKeys = Object.keys(first).sort()
const zoneKeys = Object.keys(first.zone).sort()

const isColor = (v) => typeof v === 'string' && v.length > 0

test('the four new themes are present alongside the originals', () => {
  for (const name of ['cyberpunk', 'solarpunk', 'blueprint', 'crt']) {
    assert.ok(THEMES[name], `theme "${name}" must exist`)
  }
})

test('every theme has the same key set as the first theme (shape parity)', () => {
  for (const name of names) {
    assert.deepEqual(Object.keys(THEMES[name]).sort(), topKeys, `${name}: top-level keys differ`)
    assert.deepEqual(Object.keys(THEMES[name].zone).sort(), zoneKeys, `${name}: zone keys differ`)
  }
})

test('all color values are non-empty strings', () => {
  for (const name of names) {
    const t = THEMES[name]
    for (const key of topKeys) {
      if (key === 'zone') continue
      assert.ok(isColor(t[key]), `${name}.${key} must be a non-empty string`)
    }
    for (const zk of zoneKeys) {
      assert.ok(isColor(t.zone[zk]), `${name}.zone.${zk} must be a non-empty string`)
    }
  }
})

test('resolveTheme returns each theme, and falls back to temperate for unknown names', () => {
  for (const name of names) {
    assert.equal(resolveTheme(name), THEMES[name], `${name}: resolveTheme should return the theme`)
  }
  assert.equal(resolveTheme('no-such-theme'), THEMES.temperate, 'unknown name falls back to temperate')
})
