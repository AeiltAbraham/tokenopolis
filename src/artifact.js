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
import { effectiveBuilt } from './sim/condition.js'
import { INFECTION } from './tuning.js'
import { COOLDOWN_MS, LEGENDARY } from './acts.js'
import { achievementsFor, streakFor } from './progress.js'
import { formatEvent, summarize } from './history.js'
import { DEFAULT_CONFIG } from './config.js'

const LEGENDARY_IDS = new Set(LEGENDARY.map((l) => l.id))

const here = dirname(fileURLToPath(import.meta.url))

// Strip ESM import lines and `export ` keywords so the two render modules concatenate into one
// browser-runnable bundle. themes.js must come first (draw.js references THEMES/resolveTheme).
const stripModule = (src) => src.replace(/^\s*import[^\n]*\n/gm, '').replace(/^export\s+/gm, '')
function renderBundle() {
  const themes = stripModule(readFileSync(join(here, 'render', 'themes.js'), 'utf8'))
  const draw = stripModule(readFileSync(join(here, 'render', 'draw.js'), 'utf8'))
  const ambient = stripModule(readFileSync(join(here, 'render', 'ambient.js'), 'utf8')) // day/night + weather
  const postcard = stripModule(readFileSync(join(here, 'render', 'postcard.js'), 'utf8')) // PNG export
  return `${themes}\n${draw}\n${ambient}\n${postcard}`
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// The pure data model embedded in the artifact AND served by the live /state endpoint — ONE source of
// truth, so the polling page re-renders in place with exactly what a full render would show.
export function cityData(state, config = DEFAULT_CONFIG) {
  const sim = state.sim
  // Districts split by burn source: Claude Code ("tech") vs cornercase agents ("ops/industry").
  const claude = state.claude?.cumulativeTokens ?? 0
  const sourceMix = sim.builtTokens > 0 ? Math.max(0, Math.min(1, claude / sim.builtTokens)) : 0.5
  const scene = sceneFor(sim, state.citySeed, sourceMix)
  const infection = sim.infection?.severity ?? 0 // the Outbreak drags population + economy down
  const eco = economyFor(effectiveBuilt(sim), sim.vitality * (1 - INFECTION.economyDrop * infection))
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
  // Latest act + when this render happened → animate & name it only when the render was triggered BY it.
  const act = state.acts?.last ?? null
  const renderedAt = state.render?.lastRenderedAt ?? null
  const lastActAt = state.acts?.lastActAt ?? null // drives the live cooldown countdown
  const nowIso = renderedAt || sim.lastMeaningfulBurnAt || new Date().toISOString()
  return {
    scene,
    theme: config.theme,
    readout,
    act,
    renderedAt,
    lastActAt,
    cooldownMs: COOLDOWN_MS,
    seed: state.citySeed,
    actLegendary: !!(act && LEGENDARY_IDS.has(act.id)),
    achievements: achievementsFor(state),
    streak: streakFor(state, nowIso),
    historyLines: (Array.isArray(state.history) ? state.history : []).slice(0, 8).map(formatEvent),
    tally: summarize(Array.isArray(state.history) ? state.history : []),
    sourceMix,
    districts: config.districts ?? { tech: 'Tech', ops: 'Industry' },
    flag: config.flag ?? '',
    infection,
  }
}

export function buildArtifactHtml(state, config = DEFAULT_CONFIG) {
  const data = cityData(state, config)
  const { readout, achievements, streak, historyLines, tally, sourceMix, districts, flag, infection } = data
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
  #stage { flex: 1 1 560px; max-width: 100%; position: relative; }
  #city { display: block; width: 100%; background: #0b0d13; border-radius: 12px; image-rendering: pixelated; }
  #act-fx { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 12px; pointer-events: none; }
  #act-banner {
    position: absolute; left: 50%; top: 14px; transform: translateX(-50%) translateY(-8px);
    max-width: 88%; padding: 9px 16px; border-radius: 999px; pointer-events: none;
    background: rgba(12,15,22,.82); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.14);
    box-shadow: 0 8px 28px rgba(0,0,0,.45); text-align: center; opacity: 0; transition: opacity .5s, transform .5s;
    font-size: 13px; line-height: 1.3;
  }
  #act-banner.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  #act-banner .ttl { font-weight: 700; letter-spacing: .2px; }
  #act-banner .ttl .ico { margin-right: 6px; }
  #act-banner.boon .ttl { color: #8fe3a8; }
  #act-banner.disaster .ttl { color: #ff9a7a; }
  #act-banner .sub { opacity: .78; font-size: 12px; margin-top: 1px; }
  #hud { flex: 0 1 260px; min-width: 220px; }
  #hud h1 { margin: 0 0 2px; font-size: 22px; }
  #hud .scale { opacity: .8; margin-bottom: 14px; }
  #hud .cond { font-weight: 600; }
  #hud dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
  #hud dt { opacity: .65; }
  #hud dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  #hud .theme { margin-top: 14px; opacity: .55; font-size: 12px; }
  .act-btn {
    width: 100%; margin: 0 0 4px; padding: 11px 14px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,.14); font: 600 14px/1.2 ui-sans-serif, system-ui, sans-serif;
    color: #e8ecf2; background: linear-gradient(180deg,#2a3550,#1b2236);
    display: flex; align-items: center; justify-content: center; gap: 8px;
    font-variant-numeric: tabular-nums; transition: opacity .25s, background .25s, border-color .25s;
  }
  .act-btn.ready { cursor: pointer; background: linear-gradient(180deg,#2f6bff,#1f49c7); border-color: #6f9bff; animation: actpulse 2.2s infinite; }
  .act-btn[disabled] { cursor: default; opacity: .62; color: #aab4c4; background: linear-gradient(180deg,#242a38,#1a1f2b); border-color: rgba(255,255,255,.1); animation: none; }
  @keyframes actpulse { 0%{box-shadow:0 0 0 0 rgba(90,150,255,.45)} 70%{box-shadow:0 0 0 10px rgba(90,150,255,0)} 100%{box-shadow:0 0 0 0 rgba(90,150,255,0)} }
  .act-hint { margin: 6px 0 2px; font-size: 11px; opacity: .5; text-align: center; }
  #conn { margin: 8px 0 2px; padding: 7px 10px; border-radius: 8px; background: rgba(255,120,80,.12); border: 1px solid rgba(255,140,90,.4); color: #ffb49a; font-size: 11px; text-align: center; line-height: 1.3; }
  #conn[hidden] { display: none; }
  #infected { margin: 0 0 12px; padding: 7px 10px; border-radius: 8px; background: rgba(120,160,70,.14); border: 1px solid rgba(150,190,90,.5); color: #c6e89a; font-size: 12px; font-weight: 600; text-align: center; letter-spacing: .02em; }
  #infected[hidden] { display: none; }
  .act-btn.mini { font-size: 12px; padding: 8px 12px; margin: 10px 0 2px; background: linear-gradient(180deg,#232a3a,#191e2a); }
  .act-btn.mini:hover { cursor: pointer; border-color: #6f9bff; }
  #act-banner.legendary { border-color: #ffd76a; box-shadow: 0 0 26px rgba(255,215,106,.55), 0 8px 28px rgba(0,0,0,.45); }
  #act-banner.legendary .ttl { color: #ffd76a; }
  .panel { margin-top: 16px; }
  .panel h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; opacity: .7; margin: 0 0 7px; font-weight: 700; }
  .panel .muted { opacity: .5; font-weight: 400; text-transform: none; letter-spacing: 0; }
  .badges { display: flex; flex-wrap: wrap; gap: 4px; }
  .badge { font-size: 10.5px; padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03); opacity: .42; }
  .badge.on { opacity: 1; color: #8fe3a8; border-color: rgba(143,227,168,.4); background: rgba(143,227,168,.08); }
  .chron { list-style: none; margin: 0; padding: 0; max-height: 150px; overflow: auto; font-size: 12px; }
  .chron li { padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
  .chron li.muted { opacity: .5; border: 0; }
  .choice-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(6,8,14,.72); backdrop-filter: blur(3px); border-radius: 12px; z-index: 5; }
  .choice-overlay[hidden] { display: none; }
  .choice-box { width: 88%; max-width: 440px; text-align: center; }
  .choice-title { font-weight: 700; margin-bottom: 12px; font-size: 15px; }
  .choice-opts { display: flex; gap: 10px; }
  .choice-opt { flex: 1; padding: 13px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,.16); background: linear-gradient(180deg,#232c42,#1a2132); color: #e8ecf2; cursor: pointer; text-align: left; transition: border-color .2s; }
  .choice-opt:hover { border-color: #6f9bff; }
  .choice-opt .cn { font-weight: 700; display: block; margin-bottom: 3px; }
  .choice-opt .cb { font-size: 11.5px; opacity: .72; }
  .choice-opt.boon .cn { color: #8fe3a8; }
  .choice-opt.disaster .cn { color: #ff9a7a; }
  .choice-cancel { margin-top: 12px; background: none; border: 0; color: #aab4c4; font-size: 12px; cursor: pointer; opacity: .7; }
  .mute-btn { position: absolute; top: 12px; right: 12px; z-index: 4; width: 34px; height: 34px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(12,15,22,.7); color: #e8ecf2; cursor: pointer; font-size: 15px; line-height: 1; }
  .mute-btn:hover { border-color: #6f9bff; }
  @media (max-width: 640px) { #city { flex-basis: 100%; } }
</style>
</head>
<body>
<div id="stage">
  <canvas id="city" width="960" height="640" aria-label="Your Tokenopolis city"></canvas>
  <canvas id="act-fx" width="960" height="640" aria-hidden="true"></canvas>
  <div id="act-banner" role="status"><div class="ttl"></div><div class="sub"></div></div>
  <div id="choice" class="choice-overlay" hidden>
    <div class="choice-box">
      <div class="choice-title">Choose the city's fate</div>
      <div class="choice-opts">
        <button class="choice-opt" type="button"></button>
        <button class="choice-opt" type="button"></button>
      </div>
      <button id="choice-cancel" class="choice-cancel" type="button">cancel</button>
    </div>
  </div>
  <button id="mute-btn" class="mute-btn" type="button" title="Toggle ambient sound" aria-label="Toggle sound">🔈</button>
</div>
<aside id="hud">
  <h1>${flag ? esc(flag) + ' ' : ''}${esc(readout.cityName)}</h1>
  <div class="scale"><span id="scaleName">${esc(readout.scaleName)}</span> · <span class="cond" id="cond">${esc(readout.condition)}</span></div>
  <div id="infected" class="infected"${infection > 0 ? '' : ' hidden'}>☣ Outbreak — ${Math.round(infection * 100)}% · burn to clear</div>
  <button id="act-btn" class="act-btn" type="button" disabled title="Click to roll a Random Act">A Random Act</button>
  <div class="act-hint">click to roll</div>
  <div id="conn" role="status" hidden></div>
  <button id="choose-btn" class="act-btn mini" type="button" title="Pick between two acts instead of a random roll">⚖️ Choose an act</button>
  <dl>
    <dt>Population</dt><dd id="pop">${fmt(readout.population)}</dd>
    <dt>Treasury</dt><dd id="treasury">§${fmt(readout.treasury)}</dd>
    <dt>Economy</dt><dd id="economy">${fmt(readout.economyRating)}</dd>
    <dt>Vitality</dt><dd id="vitality">${Math.round(readout.vitality * 100)}%</dd>
    <dt>Peak</dt><dd id="peak">${esc(readout.peakScaleName)}</dd>
    <dt>Streak</dt><dd>${streak.current}d · best ${streak.best}</dd>
    <dt>Districts</dt><dd title="${esc(districts.tech)} (Claude Code) vs ${esc(districts.ops)} (cornercase agents)">${Math.round(sourceMix * 100)}% ${esc(districts.tech)}</dd>
    <dt>Latest act</dt><dd id="lastact">—</dd>
    <dt>Decay clock</dt><dd id="decay">—</dd>
  </dl>
  <button id="postcard-btn" class="act-btn mini" type="button" title="Save a PNG postcard of your city">📸 Save postcard</button>
  <section class="panel">
    <h2>Achievements <span class="muted">${achievements.filter((a) => a.earned).length}/${achievements.length}</span></h2>
    <div class="badges">${achievements
      .map((a) => `<span class="badge ${a.earned ? 'on' : ''}" title="${esc(a.desc)}">${a.earned ? '✓' : '·'} ${esc(a.name)}</span>`)
      .join('')}</div>
  </section>
  <section class="panel">
    <h2>Chronicle <span class="muted">${tally.acts} acts · ${tally.disasters} disasters</span></h2>
    <ul class="chron">${
      historyLines.length ? historyLines.map((l) => `<li>${esc(l)}</li>`).join('') : '<li class="muted">nothing yet — roll an act</li>'
    }</ul>
  </section>
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
  function frame() {
    var k = tick++;
    drawCity(ctx, DATA.scene, DATA.theme, k);
    // Living city: day/night tint + seasonal weather, keyed off the viewer's clock (screen-space overlays).
    if (typeof drawDayNight === 'function') {
      var now = Date.now();
      drawDayNight(ctx, canvas.width, canvas.height, timeOfDay(now));
      drawWeather(ctx, canvas.width, canvas.height, seasonOf(now), k);
    }
    if (typeof drawInfection === 'function') drawInfection(ctx, canvas.width, canvas.height, (DATA.scene && DATA.scene.infection) || 0);
  }
  var decayEl = document.getElementById('decay');
  function updateDecay() {
    if (!decayEl) return;
    var last = Date.parse(DATA.readout.lastMeaningfulBurnAt);
    var days = isNaN(last) ? 0 : Math.max(0, (Date.now() - last) / 86400000);
    decayEl.textContent = days < 1 ? 'active' : days.toFixed(1) + ' days idle';
  }
  // ---- "A Random Act": name the latest occurrence, animate it when THIS render is fresh. ----
  var FRESH_MS = 180000, FX_DUR = 4200;
  var ICON = { boon: '✨', disaster: '⚠' };
  var FX = {
    rise:{p:'bars',c:'#9ad7ff'}, skyline:{p:'bars',c:'#bfe3ff'}, boom:{p:'coins',c:'#ffd76a'},
    parade:{p:'confetti'}, fireworks:{p:'fireworks'}, bloom:{p:'wash',c:'#6fe39a'},
    harvest:{p:'wash',c:'#e3c96f'}, sunrise:{p:'wash',c:'#ffb36a'}, aurora:{p:'aurora'},
    rainbow:{p:'rainbow'}, quake:{p:'dust',c:'#b9a089'}, twister:{p:'swirl',c:'#9aa6b2'},
    storm:{p:'swirl',c:'#6f86a6'}, meteor:{p:'meteor',c:'#ff8a3a'}, fire:{p:'fire',c:'#ff5a2a'},
    flood:{p:'water',c:'#3aa0ff'}, sinkhole:{p:'drop',c:'#05070c'}, blight:{p:'wash',c:'#7a8f4a'},
    eclipse:{p:'dark',c:'#05070c'}, frost:{p:'frost',c:'#bfe8ff'},
    // legendary anims
    goldrain:{p:'coins',c:'#ffe16a'}, utopia:{p:'aurora'}, phoenix:{p:'fire',c:'#ff7a2a'},
    blackhole:{p:'swirl',c:'#140a28'}, alien:{p:'rainbow'}, timewarp:{p:'swirl',c:'#9a6aff'}
  };
  var SHAKE = { quake:1, meteor:1, twister:0.6, storm:0.4 };
  var PR = []; for (var pi=0; pi<72; pi++) PR.push([Math.random(),Math.random(),Math.random(),Math.random()]);
  var PRIM = {
    wash: function(g,w,h,p,c){ g.globalAlpha=0.42*Math.sin(Math.PI*p); g.fillStyle=c||'#fff'; g.fillRect(0,0,w,h); g.globalAlpha=1; },
    dark: function(g,w,h,p,c){ g.globalAlpha=0.66*Math.sin(Math.PI*p); g.fillStyle=c||'#05070c'; g.fillRect(0,0,w,h); g.globalAlpha=1; },
    bars: function(g,w,h,p,c){ var n=5,bw=40,gap=18,tot=n*bw+(n-1)*gap,x0=(w-tot)/2,i,hh,x,y;
      for(i=0;i<n;i++){ hh=(h*0.52)*Math.min(1,p*1.2)*(0.45+0.55*Math.abs(Math.sin(i*1.7+1))); x=x0+i*(bw+gap); y=h-46-hh;
        g.globalAlpha=0.88; g.fillStyle=c; g.fillRect(x,y,bw,hh); g.globalAlpha=0.55*Math.sin(Math.PI*p); g.fillStyle='#fff'; g.fillRect(x,y,bw,5);} g.globalAlpha=1; },
    coins: function(g,w,h,p,c){ for(var i=0;i<46;i++){ var r=PR[i], f=(p*(0.5+0.7*r[0]))%1, y=h-f*(h+40), x=w*r[1]+Math.sin(p*6+i)*8, s=3+r[2]*7;
        g.globalAlpha=Math.max(0,0.95-Math.abs(0.5-f)*1.4); g.fillStyle=c; g.beginPath(); g.arc(x,y,s,0,6.3); g.fill(); } g.globalAlpha=1; },
    confetti: function(g,w,h,p){ for(var i=0;i<60;i++){ var r=PR[i], fall=((p*(0.6+0.9*r[0]))+r[2])%1, x=w*r[1], y=-20+fall*(h+40);
        g.save(); g.translate(x,y); g.rotate(p*10+i); g.globalAlpha=0.9; g.fillStyle='hsl('+Math.floor(r[2]*360)+',85%,60%)'; g.fillRect(-4,-4,8,8); g.restore(); } g.globalAlpha=1; },
    fireworks: function(g,w,h,p){ for(var b=0;b<3;b++){ var r=PR[b*7], bt=p-b*0.18; if(bt<0||bt>0.85) continue;
        var cx=w*(0.25+0.25*b), cy=h*(0.22+0.18*r[1]), rad=bt*170, k; for(k=0;k<18;k++){ var a=k/18*6.283;
          g.globalAlpha=Math.max(0,1-bt*1.25); g.fillStyle='hsl('+Math.floor(r[0]*360+k*8)+',90%,62%)';
          g.beginPath(); g.arc(cx+Math.cos(a)*rad, cy+Math.sin(a)*rad, 3, 0, 6.3); g.fill(); } } g.globalAlpha=1; },
    aurora: function(g,w,h,p){ for(var b=0;b<3;b++){ g.globalAlpha=0.2*Math.sin(Math.PI*p); g.fillStyle='hsl('+Math.floor(p*120+b*90+120)+',80%,55%)';
        g.beginPath(); for(var x=0;x<=w;x+=24){ var y=h*0.28+b*26+Math.sin(x*0.012+p*6+b)*22; x===0?g.moveTo(x,y):g.lineTo(x,y);} g.lineTo(w,0); g.lineTo(0,0); g.closePath(); g.fill(); } g.globalAlpha=1; },
    rainbow: function(g,w,h,p){ var cols=['#ff4d4d','#ff9a3a','#ffe14d','#5ad15a','#4da6ff','#6a6aff','#b36aff']; g.lineWidth=10;
        for(var i=0;i<7;i++){ g.globalAlpha=0.7*Math.sin(Math.PI*p); g.strokeStyle=cols[i]; g.beginPath(); g.arc(w/2,h+60,160+i*12,Math.PI,2*Math.PI); g.stroke(); } g.globalAlpha=1; g.lineWidth=1; },
    meteor: function(g,w,h,p,c){ var ix=w*0.52, iy=h*0.6; if(p<0.5){ var q=p/0.5, sx=ix-(1-q)*ix-40, sy=iy-(1-q)*iy-40;
        g.strokeStyle=c; g.lineWidth=5; g.globalAlpha=0.9; g.beginPath(); g.moveTo(sx-60,sy-60); g.lineTo(sx,sy); g.stroke();
        g.fillStyle='#fff'; g.globalAlpha=0.85; g.beginPath(); g.arc(sx,sy,6,0,6.3); g.fill(); }
      else { var q2=(p-0.5)/0.5; g.globalAlpha=Math.max(0,0.8-q2); g.fillStyle='#fff'; g.fillRect(0,0,w,h);
        g.globalAlpha=Math.max(0,0.9-q2); g.strokeStyle=c; g.lineWidth=6; g.beginPath(); g.arc(ix,iy,q2*220,0,6.3); g.stroke(); } g.globalAlpha=1; g.lineWidth=1; },
    fire: function(g,w,h,p,c){ var H=h*0.34*(0.7+0.3*Math.sin(p*20)), gr=g.createLinearGradient(0,h,0,h-H); gr.addColorStop(0,c||'#ff5a2a'); gr.addColorStop(1,'rgba(255,90,20,0)');
        g.globalAlpha=0.8*Math.sin(Math.PI*Math.min(1,p*1.3)); g.fillStyle=gr; g.fillRect(0,h-H,w,H);
        for(var i=0;i<30;i++){ var r=PR[i], y=h-((p*(0.6+r[0]))%1)*h*0.8; g.globalAlpha=0.7; g.fillStyle='#ffb347'; g.fillRect(w*r[1], y, 3,3);} g.globalAlpha=1; },
    water: function(g,w,h,p,c){ var lvl=h*0.5*Math.sin(Math.PI*p); g.globalAlpha=0.5; g.fillStyle=c; g.fillRect(0,h-lvl,w,lvl);
        g.globalAlpha=0.85; g.strokeStyle='#bfe8ff'; g.beginPath(); for(var x=0;x<=w;x+=16){ var y=h-lvl+Math.sin(x*0.05+p*12)*4; x===0?g.moveTo(x,y):g.lineTo(x,y);} g.stroke(); g.globalAlpha=1; },
    drop: function(g,w,h,p,c){ var rx=w*0.42*p, ry=rx*0.5; g.globalAlpha=0.85; g.fillStyle=c||'#05070c'; g.beginPath(); g.ellipse(w/2,h*0.66,rx,ry,0,0,6.3); g.fill();
        g.globalAlpha=0.5*(1-p); g.strokeStyle='#5a4634'; g.lineWidth=4; g.beginPath(); g.ellipse(w/2,h*0.66,rx,ry,0,0,6.3); g.stroke(); g.globalAlpha=1; g.lineWidth=1; },
    swirl: function(g,w,h,p,c){ g.globalAlpha=0.3*Math.sin(Math.PI*p); g.fillStyle='#05070c'; g.fillRect(0,0,w,h);
        g.save(); g.translate(w/2,h/2); g.rotate(p*8); g.strokeStyle=c||'#9aa6b2'; g.lineWidth=6; g.globalAlpha=0.7;
        for(var i=1;i<=6;i++){ g.beginPath(); g.arc(0,0,i*34,0,4.2); g.stroke(); } g.restore(); g.globalAlpha=1; g.lineWidth=1; },
    dust: function(g,w,h,p,c){ g.globalAlpha=0.3*Math.sin(Math.PI*p); g.fillStyle=c||'#b9a089'; g.fillRect(0,h*0.5,w,h*0.5);
        for(var i=0;i<40;i++){ var r=PR[i], y=h-((p*(0.4+r[0]))%1)*h*0.6; g.globalAlpha=0.5; g.fillStyle='#cdbba6'; g.beginPath(); g.arc(w*r[1], y, 4+r[2]*6, 0, 6.3); g.fill(); } g.globalAlpha=1; },
    frost: function(g,w,h,p,c){ var gr=g.createRadialGradient(w/2,h/2,80,w/2,h/2,w*0.6); gr.addColorStop(0,'rgba(191,232,255,0)'); gr.addColorStop(1,c||'#bfe8ff');
        g.globalAlpha=0.6*Math.sin(Math.PI*p); g.fillStyle=gr; g.fillRect(0,0,w,h);
        for(var i=0;i<40;i++){ var r=PR[i]; g.globalAlpha=0.8*Math.sin(Math.PI*p); g.fillStyle='#fff'; g.fillRect(w*r[0], h*r[1], 2,2);} g.globalAlpha=1; }
  };
  function startFx(act) {
    var fx = document.getElementById('act-fx'); if (!fx || !fx.getContext) return;
    var g = fx.getContext('2d'), w = fx.width, h = fx.height;
    var kit = FX[act.anim] || {p:'wash',c:'#ffffff'}, stage = document.getElementById('stage'), shake = SHAKE[act.anim] || 0, start = 0;
    (function run(ts){
      if (!start) start = ts;
      var p = (ts - start) / FX_DUR; if (p > 1) p = 1;
      g.clearRect(0,0,w,h);
      (PRIM[kit.p] || PRIM.wash)(g,w,h,p,kit.c);
      if (stage && shake) {
        var m = shake * 10 * (p < 0.35 ? (1 - p/0.35) : 0), r = PR[(ts|0)%72];
        stage.style.transform = m ? 'translate('+((r[0]-0.5)*m).toFixed(1)+'px,'+((r[1]-0.5)*m).toFixed(1)+'px)' : '';
      }
      if (p < 1) requestAnimationFrame(run); else { g.clearRect(0,0,w,h); if (stage) stage.style.transform=''; }
    })(0);
  }
  function setupActs() {
    var act = DATA.act, lastEl = document.getElementById('lastact');
    if (lastEl) lastEl.textContent = act ? act.name : '—';
    if (!act) return;
    var fresh = DATA.renderedAt && Math.abs(Date.parse(DATA.renderedAt) - Date.parse(act.at)) < FRESH_MS;
    if (!fresh) return;
    var banner = document.getElementById('act-banner');
    if (banner && banner.querySelector) {
      var t = banner.querySelector('.ttl'), s = banner.querySelector('.sub');
      var leg = DATA.actLegendary ? '★ ' : '';
      if (t) t.textContent = leg + (ICON[act.kind] || '') + '  ' + act.name;
      if (s) s.textContent = act.blurb || '';
      banner.className = act.kind + (DATA.actLegendary ? ' legendary' : '');
      if (banner.classList) banner.classList.add('show');
    }
    if (typeof requestAnimationFrame === 'function') startFx(act);
    sting(act.kind);
  }

  // ---- Ambient sound (muted by default; Web Audio starts on the first toggle click — autoplay-safe). ----
  var audio = { ctx: null, on: false, gain: null };
  function toggleAudio() {
    try {
      if (!audio.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audio.ctx = new AC();
        audio.gain = audio.ctx.createGain(); audio.gain.gain.value = 0; audio.gain.connect(audio.ctx.destination);
        var lp = audio.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.connect(audio.gain);
        [110, 110.5, 164.8].forEach(function (f) { var o = audio.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(lp); o.start(); });
      }
      if (audio.ctx.resume) audio.ctx.resume();
      audio.on = !audio.on;
      audio.gain.gain.setTargetAtTime(audio.on ? 0.05 : 0, audio.ctx.currentTime, 0.3);
      var mb = document.getElementById('mute-btn'); if (mb) mb.textContent = audio.on ? '🔊' : '🔈';
      try { localStorage.setItem('tok-audio', audio.on ? '1' : '0'); } catch (e) {}
    } catch (e) {}
  }
  function sting(kind) {
    if (!audio.on || !audio.ctx) return;
    try {
      var o = audio.ctx.createOscillator(), g = audio.ctx.createGain(), t = audio.ctx.currentTime;
      o.type = kind === 'disaster' ? 'sawtooth' : 'triangle';
      o.frequency.value = kind === 'disaster' ? 120 : 523;
      g.gain.value = 0.0001; g.connect(audio.ctx.destination); o.connect(g);
      g.gain.setTargetAtTime(0.12, t, 0.01); g.gain.setTargetAtTime(0.0001, t + 0.09, 0.12);
      o.start(t); o.stop(t + 0.6);
    } catch (e) {}
  }
  var muteBtn = document.getElementById('mute-btn');
  if (muteBtn && muteBtn.addEventListener) muteBtn.addEventListener('click', toggleAudio);

  // ---- Always-visible "A Random Act" button with a live cooldown countdown. ----
  var actBtn = document.getElementById('act-btn'), actHint = document.querySelector && document.querySelector('.act-hint');
  function fmtDur(ms) {
    var s = Math.ceil(ms / 1000), m = Math.floor(s / 60); s = s % 60;
    if (m >= 60) { var hr = Math.floor(m / 60); return hr + 'h ' + (m % 60) + 'm'; }
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function updateActBtn() {
    if (!actBtn) return;
    var last = DATA.lastActAt ? Date.parse(DATA.lastActAt) : NaN;
    var rem = isNaN(last) ? 0 : Math.max(0, last + (DATA.cooldownMs || 0) - Date.now());
    if (rem > 0) { actBtn.disabled = true; actBtn.className = 'act-btn'; actBtn.textContent = '⏳ A Random Act · ' + fmtDur(rem); }
    else { actBtn.disabled = false; actBtn.className = 'act-btn ready'; actBtn.textContent = '⚡ A Random Act · ready'; }
  }
  // Connection state: shown only when the page can't reach its local server (static/shared copy, or a
  // stale tab after a keeper restart). A reachable server — even one answering with an error — is NOT a
  // "connection" problem, so we never tell the user to "use the menu" when the menu can't help.
  var NOT_CONNECTED = '⚠ Not connected to the live city — re-open from the ⋯ menu (Open Tokenopolis)';
  var STATIC_COPY = '⚠ Static copy — the buttons need the live city (⋯ → Open Tokenopolis)';
  function setConn(ok, msg) {
    var c = document.getElementById('conn');
    if (!c) return;
    if (ok) { c.hidden = true; } else { c.textContent = msg || NOT_CONNECTED; c.hidden = false; }
  }
  if (actBtn && actBtn.addEventListener) {
    actBtn.addEventListener('click', function () {
      if (actBtn.disabled) return;
      actBtn.disabled = true; actBtn.className = 'act-btn'; actBtn.textContent = '· rolling ·';
      if (typeof fetch !== 'function') { setConn(false, STATIC_COPY); updateActBtn(); return; }
      fetch('/act', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          setConn(true); // the server answered → we ARE connected, whatever the outcome
          if (res && res.ok) { if (typeof location !== 'undefined' && location.reload) location.reload(); return; }
          if (res && res.reason === 'cooldown') { if (actHint) actHint.textContent = 'on cooldown — ' + (res.minutesLeft || 0) + 'm left'; }
          else if (res && res.reason === 'forbidden') { if (actHint) actHint.textContent = 'blocked (cross-origin request)'; }
          else { if (actHint) actHint.textContent = 'server error — try again'; if (typeof console !== 'undefined' && console.error) console.error('Tokenopolis /act error', res); }
          updateActBtn();
        })
        .catch(function () { setConn(false, NOT_CONNECTED); updateActBtn(); });
    });
  }

  // ---- Choose-your-act: offer two options, apply the pick. ----
  var chooseBtn = document.getElementById('choose-btn'), choiceEl = document.getElementById('choice');
  function hideChoice() { if (choiceEl) choiceEl.hidden = true; }
  function pickChoice(id) {
    hideChoice();
    if (typeof fetch !== 'function') return;
    fetch('/act?choice=' + encodeURIComponent(id), { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (res) { if (res && res.ok && typeof location !== 'undefined' && location.reload) location.reload(); })
      .catch(function () {});
  }
  function fillOpt(btn, opt) {
    if (!btn || !opt) { if (btn) btn.style.display = 'none'; return; }
    btn.style.display = '';
    btn.className = 'choice-opt ' + opt.kind;
    btn.textContent = '';
    var cn = document.createElement('span'); cn.className = 'cn'; cn.textContent = (opt.kind === 'boon' ? '✨ ' : '⚠ ') + opt.name;
    var cb = document.createElement('span'); cb.className = 'cb'; cb.textContent = opt.blurb || '';
    btn.appendChild(cn); btn.appendChild(cb);
    btn.onclick = function () { pickChoice(opt.id); };
  }
  if (chooseBtn && chooseBtn.addEventListener) {
    chooseBtn.addEventListener('click', function () {
      if (typeof fetch !== 'function') { setConn(false, STATIC_COPY); return; }
      fetch('/choice').then(function (r) { return r.ok ? r.json() : null; }).then(function (res) {
        setConn(true);
        if (!res) return;
        if (!res.ok) { if (res.reason === 'cooldown' && actHint) actHint.textContent = 'on cooldown — ' + (res.minutesLeft || 0) + 'm left'; return; }
        if (!choiceEl || !choiceEl.querySelectorAll) return;
        var opts = choiceEl.querySelectorAll('.choice-opt');
        fillOpt(opts[0], res.options[0]); fillOpt(opts[1], res.options[1]);
        choiceEl.hidden = false;
      }).catch(function () { setConn(false, NOT_CONNECTED); });
    });
  }
  var choiceCancel = document.getElementById('choice-cancel');
  if (choiceCancel && choiceCancel.addEventListener) choiceCancel.addEventListener('click', hideChoice);

  // ---- Save postcard (PNG export) ----
  var postcardBtn = document.getElementById('postcard-btn');
  if (postcardBtn && postcardBtn.addEventListener && typeof exportPostcard === 'function') {
    postcardBtn.addEventListener('click', function () { exportPostcard(document.getElementById('city'), DATA.readout); });
  }
  // ---- Live growth: poll /state and update the city + numbers in place (no reload) when served locally. ----
  function setTxt(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function grp(n) { return String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ','); } // \\ — inside a template literal
  function applyLive(s) {
    if (!s || !s.readout) return;
    DATA.scene = s.scene; DATA.readout = s.readout; // the rAF loop redraws DATA.scene automatically
    if (typeof s.lastActAt !== 'undefined') DATA.lastActAt = s.lastActAt;
    setTxt('pop', grp(s.readout.population));
    setTxt('treasury', '§' + grp(s.readout.treasury));
    setTxt('economy', grp(s.readout.economyRating));
    setTxt('vitality', Math.round(s.readout.vitality * 100) + '%');
    setTxt('scaleName', s.readout.scaleName);
    setTxt('cond', s.readout.condition);
    setTxt('peak', s.readout.peakScaleName);
    var infEl = document.getElementById('infected');
    if (infEl) {
      var inf = s.infection || 0;
      if (inf > 0) { infEl.textContent = '☣ Outbreak — ' + Math.round(inf * 100) + '% · burn to clear'; infEl.hidden = false; }
      else infEl.hidden = true;
    }
    updateActBtn();
  }
  function pollLive() {
    if (typeof fetch !== 'function') { setConn(false, STATIC_COPY); return; }
    fetch('/state')
      .then(function (r) { if (!r.ok) throw 0; return r.json(); }) // non-plugin server / 404 → not connected
      .then(function (s) { setConn(true); applyLive(s); })
      .catch(function () { setConn(false, NOT_CONNECTED); });
  }

  frame();
  updateDecay();
  setupActs();
  updateActBtn();
  pollLive(); // probe connection immediately so a static/stale copy shows the badge at once
  if (typeof setInterval === 'function') { setInterval(updateActBtn, 1000); setInterval(pollLive, 4000); }
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
