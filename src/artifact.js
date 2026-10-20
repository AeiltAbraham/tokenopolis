// Artifact assembler: state + config → one self-contained city.html (no external references).
// It embeds the pre-computed scene + readout as JSON and inlines the renderer (themes.js + draw.js,
// imports/exports stripped), so the page draws procedurally at open time and animates via a tick
// loop. Pre-computing the scene in Node (DEVIATION from "embed cityState") avoids inlining
// scene.js/tuning/scale into the browser — only the self-contained draw+themes bundle ships.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sceneFor } from './render/scene.js'
import { economyFor } from './sim/economy.js'
import { scaleName } from './sim/scale.js'
import { DEFAULT_CONFIG } from './config.js'

const here = dirname(fileURLToPath(import.meta.url))

// Strip ESM import lines and `export ` keywords so the two render modules concatenate into one
// browser-runnable bundle. themes.js must come first (draw.js references THEMES/resolveTheme).
const stripModule = (src) => src.replace(/^\s*import[^\n]*\n/gm, '').replace(/^export\s+/gm, '')
function renderBundle() {
  const themes = stripModule(readFileSync(join(here, 'render', 'themes.js'), 'utf8'))
  const draw = stripModule(readFileSync(join(here, 'render', 'draw.js'), 'utf8'))
  return `${themes}\n${draw}`
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export function buildArtifactHtml(state, config = DEFAULT_CONFIG) {
  const sim = state.sim
  const scene = sceneFor(sim, state.citySeed)
  const eco = economyFor(sim.builtTokens, sim.vitality)
  const readout = {
    cityName: config.cityName,
    theme: config.theme,
    population: eco.population,
    treasury: eco.treasury,
    economyRating: eco.economyRating,
    vitality: sim.vitality,
    condition: sim.condition,
    scaleName: scene.scaleName,
    peakScaleName: scaleName(sim.peakScaleIndex),
    builtTokens: sim.builtTokens,
    lastMeaningfulBurnAt: sim.lastMeaningfulBurnAt,
  }
  const data = { scene, theme: config.theme, readout }
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c') // safe inside <script type=application/json>
  const bundle = renderBundle()

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(readout.cityName)} — Tokenopolis</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; background: #0e1017; color: #e8ecf2; display: flex; flex-wrap: wrap; gap: 16px; padding: 16px; }
  #city { flex: 1 1 560px; max-width: 100%; background: #0b0d13; border-radius: 12px; image-rendering: pixelated; }
  #hud { flex: 0 1 260px; min-width: 220px; }
  #hud h1 { margin: 0 0 2px; font-size: 22px; }
  #hud .scale { opacity: .8; margin-bottom: 14px; }
  #hud .cond { font-weight: 600; }
  #hud dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
  #hud dt { opacity: .65; }
  #hud dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  #hud .theme { margin-top: 14px; opacity: .55; font-size: 12px; }
  @media (max-width: 640px) { #city { flex-basis: 100%; } }
</style>
</head>
<body>
<canvas id="city" width="960" height="640" aria-label="Your Tokenopolis city"></canvas>
<aside id="hud">
  <h1>${esc(readout.cityName)}</h1>
  <div class="scale">${esc(readout.scaleName)} · <span class="cond">${esc(readout.condition)}</span></div>
  <dl>
    <dt>Population</dt><dd>${fmt(readout.population)}</dd>
    <dt>Treasury</dt><dd>§${fmt(readout.treasury)}</dd>
    <dt>Economy</dt><dd>${fmt(readout.economyRating)}</dd>
    <dt>Vitality</dt><dd>${Math.round(readout.vitality * 100)}%</dd>
    <dt>Peak</dt><dd>${esc(readout.peakScaleName)}</dd>
    <dt>Built since install</dt><dd>${fmt(readout.builtTokens)}</dd>
    <dt>Decay clock</dt><dd id="decay">—</dd>
  </dl>
  <div class="theme">theme: ${esc(readout.theme)}</div>
</aside>
<script id="city-data" type="application/json">${dataJson}</script>
<script id="city-boot">
(function () {
  "use strict";
  ${bundle}
  var DATA = JSON.parse(document.getElementById('city-data').textContent);
  var canvas = document.getElementById('city');
  var ctx = canvas.getContext('2d');
  var tick = 0;
  function frame() { drawCity(ctx, DATA.scene, DATA.theme, tick++); }
  var decayEl = document.getElementById('decay');
  function updateDecay() {
    if (!decayEl) return;
    var last = Date.parse(DATA.readout.lastMeaningfulBurnAt);
    var days = isNaN(last) ? 0 : Math.max(0, (Date.now() - last) / 86400000);
    decayEl.textContent = days < 1 ? 'active' : days.toFixed(1) + ' days idle';
  }
  frame();
  updateDecay();
  if (typeof requestAnimationFrame === 'function') {
    var lastT = 0;
    (function loop(t) { if (t - lastT > 140) { frame(); updateDecay(); lastT = t; } requestAnimationFrame(loop); })(0);
  }
})();
</script>
</body>
</html>`
}

export function writeArtifact(state, config, outDir) {
  const html = buildArtifactHtml(state, config)
  writeFileSync(join(outDir, 'city.html'), html)
  return { path: join(outDir, 'city.html'), bytes: Buffer.byteLength(html) }
}
