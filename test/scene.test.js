import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sceneFor } from '../src/render/scene.js'

const city = (over = {}) => ({ peakScaleIndex: 4, scaleIndex: 4, condition: 'Thriving', vitality: 1, ...over })

test('pure & deterministic: same (state, seed) → deep-equal; different seed → different layout', () => {
  const s = city({ peakScaleIndex: 5, scaleIndex: 5 })
  assert.deepEqual(sceneFor(s, 123), sceneFor(s, 123))
  assert.notDeepEqual(sceneFor(s, 1).buildings, sceneFor(s, 2).buildings)
})

test('healthy conditions carry no damage; Declining+ introduces structural damage', () => {
  for (const cond of ['Thriving', 'Stable', 'Stagnant']) {
    const scene = sceneFor(city({ condition: cond }), 7)
    assert.ok(scene.buildings.every((b) => b.damage === 0), `${cond} should have no damage`)
    assert.equal(scene.ruined, false)
  }
  const declining = sceneFor(city({ condition: 'Declining' }), 7)
  assert.ok(declining.buildings.some((b) => b.damage > 0), 'Declining must introduce damage')
})

test('districts split by burn source: mix 1 → all tech, 0 → all ops, 0.5 → mixed', () => {
  const s = city({ peakScaleIndex: 5, scaleIndex: 5 })
  assert.ok(sceneFor(s, 7, 1).buildings.every((b) => b.district === 'tech'), 'all-Claude → all tech')
  assert.ok(sceneFor(s, 7, 0).buildings.every((b) => b.district === 'ops'), 'all-cornercase → all ops')
  const mixed = sceneFor(s, 7, 0.5).buildings
  assert.ok(mixed.some((b) => b.district === 'tech') && mixed.some((b) => b.district === 'ops'), 'a 50/50 mix has both')
})

test('condition is structural, not color-only (grayscale-safe): no color fields in the scene', () => {
  const scene = sceneFor(city({ condition: 'Blighted' }), 7)
  const json = JSON.stringify(scene)
  assert.ok(!/colou?r/i.test(json), 'scene must not encode condition as color')
  // Damage lives on structure: heights, damage, collapsed.
  assert.ok(scene.buildings.every((b) => 'damage' in b && 'height' in b && 'collapsed' in b))
})

test('Ruins keep the big silhouette of the peak (ruined metropolis, not a village)', () => {
  const thrivingMetro = sceneFor(city({ peakScaleIndex: 7, scaleIndex: 7, condition: 'Thriving' }), 9)
  const ruinedMetro = sceneFor(city({ peakScaleIndex: 7, scaleIndex: 2, condition: 'Ruins' }), 9)
  assert.equal(ruinedMetro.buildings.length, thrivingMetro.buildings.length, 'same footprint — bones remain')
  assert.equal(ruinedMetro.ruined, true)
  assert.ok(ruinedMetro.buildings.some((b) => b.collapsed), 'a regressed ruin shows collapsed buildings')
})

test('underground opens at Metropolis and deepens; infrastructure tiers gate by scale', () => {
  assert.equal(sceneFor(city({ peakScaleIndex: 3, scaleIndex: 3 }), 1).underground.length, 0)
  assert.ok(sceneFor(city({ peakScaleIndex: 4, scaleIndex: 4 }), 1).underground.length >= 1)
  const big = sceneFor(city({ peakScaleIndex: 6, scaleIndex: 6 }), 1)
  assert.deepEqual(big.infrastructure, { roads: true, power: true, water: true, transit: true, data: true })
})

test('LOD: primitive count stays ≤ 20,000 at every probe scale, and aggregates at large scale', () => {
  for (const s of [4, 8, 16, 32, 64]) {
    const scene = sceneFor(city({ peakScaleIndex: s, scaleIndex: s }), 42)
    assert.ok(scene.primitiveCount <= 20_000, `scale ${s}: ${scene.primitiveCount} exceeds 20k`)
  }
  assert.equal(sceneFor(city({ peakScaleIndex: 32, scaleIndex: 32 }), 42).lod, 'aggregated')
  // Stress probe (T-014 territory): still bounded at an extreme scale.
  assert.ok(sceneFor(city({ peakScaleIndex: 128, scaleIndex: 128 }), 42).primitiveCount <= 20_000)
})

test('services pass through from cityState (they gate boats/planes)', () => {
  assert.deepEqual(sceneFor(city({ services: { harbour: true } }), 1).services, { harbour: true })
  assert.deepEqual(sceneFor(city(), 1).services, {})
})
