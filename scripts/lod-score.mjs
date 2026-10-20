#!/usr/bin/env node
// LOD primitive-budget score. Prints the max scene primitive count across probe scales — the number
// the T-014 ratchet drives down, and the one test/scene.test.js bounds at ≤ 20,000. Reporting only
// (always exits 0). The score is `node scripts/lod-score.mjs | tail -1`'s number.

import { sceneFor } from '../src/render/scene.js'

const PROBES = [4, 8, 16, 32, 64]
let max = 0
for (const s of PROBES) {
  const scene = sceneFor({ peakScaleIndex: s, scaleIndex: s, condition: 'Thriving', vitality: 1 }, 12345)
  max = Math.max(max, scene.primitiveCount)
  console.log(`scale ${s}: ${scene.primitiveCount} primitives (${scene.lod})`)
}
console.log(`max ${max}`)
