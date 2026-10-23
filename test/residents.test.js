import { test } from 'node:test'
import assert from 'node:assert/strict'
import { residentsFor, vignette, ambientVignette } from '../src/residents.js'

test('residentsFor: deterministic, sized to the city, unique names', () => {
  const a = residentsFor(42, 4, 0.5)
  assert.deepEqual(residentsFor(42, 4, 0.5), a, 'same (seed, scale, mix) → identical roster')
  assert.notDeepEqual(residentsFor(43, 4, 0.5), a, 'a different seed → a different roster')
  assert.equal(residentsFor(42, 0, 0.5).length, 2, 'a hamlet has 2')
  assert.equal(residentsFor(42, 4, 0.5).length, 6, '2 + scaleIndex')
  assert.equal(residentsFor(42, 50, 0.5).length, 10, 'capped at 10')
  const names = a.map((r) => r.name)
  assert.equal(new Set(names).size, names.length, 'names are unique within a city')
  for (const r of a) {
    assert.ok(typeof r.name === 'string' && r.name)
    assert.ok(['tech', 'ops'].includes(r.district))
    assert.ok(typeof r.archetype === 'string' && r.archetype)
  }
})

test('residentsFor: sourceMix skews the district split', () => {
  assert.ok(residentsFor(42, 6, 1).every((r) => r.district === 'tech'), 'mix 1 → all tech')
  assert.ok(residentsFor(42, 6, 0).every((r) => r.district === 'ops'), 'mix 0 → all ops')
})

test('vignette: deterministic, names a resident + uses the ctx, null when unsupported or no cast', () => {
  const res = residentsFor(42, 4, 0.5)
  const l1 = vignette('scale', 'Metropolis', res, 7)
  assert.equal(l1, vignette('scale', 'Metropolis', res, 7), 'deterministic')
  assert.ok(typeof l1 === 'string' && l1.length)
  assert.ok(res.some((r) => l1.includes(r.name)), 'names a resident')
  assert.ok(l1.includes('Metropolis'), 'uses the ctx noun')
  assert.equal(vignette('not-a-type', 'x', res, 7), null, 'unsupported type → null')
  assert.equal(vignette('scale', 'x', [], 7), null, 'no cast → null')
})

test('ambientVignette: deterministic, names a resident, null when no cast', () => {
  const res = residentsFor(42, 4, 0.5)
  const a = ambientVignette(res, 9)
  assert.equal(a, ambientVignette(res, 9), 'deterministic')
  assert.ok(typeof a === 'string' && a.length)
  assert.ok(res.some((r) => a.includes(r.name)))
  assert.equal(ambientVignette([], 9), null)
})
