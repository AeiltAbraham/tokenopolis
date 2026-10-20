#!/usr/bin/env node
// Scenario gallery: six canonical city states, each produced by replaying a scripted burn timeline
// through the REAL sim (advance()), rendered side by side for eyeball tuning of pacing + decay feel.
// Writes gallery.html (gitignored). Reporting only — exits 0.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initState } from '../src/state.js'
import { advance } from '../src/tick.js'
import { sceneFor } from '../src/render/scene.js'
import { economyFor } from '../src/sim/economy.js'
import { scaleName } from '../src/sim/scale.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DAY = 86_400_000
const base = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (d) => new Date(base + d * DAY).toISOString()

function replay(steps) {
  let s = initState({ baselineLifetimeTokens: 0, installedAt: iso(0), citySeed: 4242 })
  for (const st of steps) {
    s = advance(s, { lifetimeTotal: st.lifetime, burn24h: st.burn ?? 1e6, burn7d: st.lifetime, readAt: iso(st.day) }, iso(st.day))
  }
  return s
}

const PANELS = [
  { label: 'Fresh hamlet', theme: 'temperate', steps: [{ lifetime: 150_000, day: 0.2 }] },
  { label: 'Boom town (first week)', theme: 'coastal', steps: [{ lifetime: 1_500_000, day: 1 }, { lifetime: 4_000_000, day: 3 }, { lifetime: 7_000_000, day: 6 }] },
  { label: 'Thriving metropolis', theme: 'desert', steps: [{ lifetime: 35e6, day: 1 }, { lifetime: 70e6, day: 2 }, { lifetime: 110e6, day: 3 }, { lifetime: 150e6, day: 4 }] },
  { label: 'Stagnant / declining', theme: 'nordic', steps: [{ lifetime: 10e6, day: 1 }, { lifetime: 20e6, day: 2 }, { lifetime: 30e6, day: 3 }, { lifetime: 30e6, day: 9 }] },
  { label: 'Ruins of a metropolis', theme: 'neon', steps: [{ lifetime: 40e6, day: 1 }, { lifetime: 90e6, day: 2 }, { lifetime: 140e6, day: 4 }, { lifetime: 140e6, day: 16 }] },
  { label: 'Rebuilt from ruins', theme: 'temperate', steps: [{ lifetime: 40e6, day: 1 }, { lifetime: 90e6, day: 2 }, { lifetime: 140e6, day: 4 }, { lifetime: 140e6, day: 16 }, { lifetime: 150e6, day: 16.2 }, { lifetime: 165e6, day: 16.4 }] },
]

const entries = PANELS.map((pan) => {
  const s = replay(pan.steps)
  const scene = sceneFor(s.sim, s.citySeed)
  const eco = economyFor(s.sim.builtTokens, s.sim.vitality)
  return {
    label: pan.label,
    theme: pan.theme,
    scene,
    readout: {
      scaleName: scene.scaleName,
      peak: scaleName(s.sim.peakScaleIndex),
      condition: s.sim.condition,
      population: eco.population,
      vitality: Math.round(s.sim.vitality * 100),
      builtTokens: s.sim.builtTokens,
    },
  }
})

const stripModule = (src) => src.replace(/^\s*import[^\n]*\n/gm, '').replace(/^export\s+/gm, '')
const bundle = `${stripModule(readFileSync(join(root, 'src/render/themes.js'), 'utf8'))}\n${stripModule(readFileSync(join(root, 'src/render/draw.js'), 'utf8'))}`
const dataJson = JSON.stringify(entries).replace(/</g, '\\u003c')

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tokenopolis — scenario gallery</title>
<style>
  body { margin:0; background:#0e1017; color:#e8ecf2; font:13px/1.4 ui-sans-serif,system-ui,sans-serif; padding:16px; }
  h1 { font-size:18px; margin:0 0 12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px; }
  .panel { background:#0b0d13; border-radius:10px; padding:10px; }
  .panel h2 { font-size:14px; margin:0 0 2px; }
  .panel .meta { opacity:.65; font-size:12px; margin-bottom:6px; }
  canvas { width:100%; height:auto; background:#0b0d13; image-rendering:pixelated; border-radius:6px; }
</style></head>
<body>
<h1>Tokenopolis — scenario gallery <span style="opacity:.5">(replayed through the real sim)</span></h1>
<div class="grid">
${entries.map((e, i) => `<div class="panel"><h2>${e.label}</h2><div class="meta">${e.readout.scaleName} · ${e.readout.condition} · pop ${e.readout.population.toLocaleString('en-US')} · vit ${e.readout.vitality}%${e.scene.scaleName !== e.readout.peak ? ` · peak ${e.readout.peak}` : ''}</div><canvas id="c${i}" width="480" height="320"></canvas></div>`).join('\n')}
</div>
<script id="gallery-data" type="application/json">${dataJson}</script>
<script>
(function(){
  "use strict";
  ${bundle}
  var E = JSON.parse(document.getElementById('gallery-data').textContent);
  var ctxs = E.map(function(_, i){ return document.getElementById('c'+i).getContext('2d'); });
  var tick = 0;
  function frame(){ for (var i=0;i<E.length;i++){ drawCity(ctxs[i], E[i].scene, E[i].theme, tick); } tick++; }
  frame();
  if (typeof requestAnimationFrame==='function'){ var last=0; (function loop(t){ if(t-last>150){ frame(); last=t; } requestAnimationFrame(loop); })(0); }
})();
</script>
</body></html>`

writeFileSync(join(root, 'gallery.html'), html)
console.log('wrote gallery.html —', entries.map((e) => `${e.label}: ${e.readout.scaleName}/${e.readout.condition}`).join(' | '))
