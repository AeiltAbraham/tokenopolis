#!/usr/bin/env node
// "A Random Act" action: once an hour, roll the deck, apply the outcome, re-render the city so the
// occurrence animates + is named, and open it. Off cooldown it's a no-op that reports the wait.
// Resolves the state dir from CORNERCASE_PLUGIN_STATE. Never throws on the happy path.

import { pathToFileURL } from 'node:url'
import { loadState, saveState, logLine } from '../src/state.js'
import { writeArtifact } from '../src/artifact.js'
import { readConfig } from '../src/config.js'
import { openCity } from '../scripts/open-city.mjs'
import { performAct, canAct, msUntilNextAct } from '../src/acts.js'
import { appendEvent } from '../src/history.js'
import { updateProgress, newlyEarned } from '../src/progress.js'
import { notifyAchievements } from '../src/notify.js'

// Injectable for tests: nowIso (clock), rng (deck roll), open (opener), config.
export function runRandomAct({ dir, nowIso = () => new Date().toISOString(), rng = Math.random, open = openCity, config }) {
  const now = nowIso()
  const cfg = config ?? readConfig()
  const state = loadState(dir)
  if (!state) {
    logLine(dir, 'random-act: no city yet — is the city-keeper service running?')
    console.error('Tokenopolis: no city yet — is the city-keeper service running?')
    return { ok: false, reason: 'no-state' }
  }
  const acts = state.acts ?? { usedIds: [], lastActAt: null, last: null }
  const nowMs = Date.parse(now)
  if (!canAct(acts, nowMs)) {
    const mins = Math.ceil(msUntilNextAct(acts, nowMs) / 60000)
    logLine(dir, `random-act: on cooldown (${mins}m left)`)
    console.error(`Tokenopolis: the city is still recovering — next Random Act in ~${mins}m.`)
    open(dir) // still open the city so the user sees the button counting down
    return { ok: false, reason: 'cooldown', minutesLeft: mins }
  }
  const acted = performAct({ ...state, acts }, now, rng)
  const o = acted.acts.last
  // Chronicle the act + refresh achievements/streak immediately (cycled-deck must be caught on the
  // 50th act, before usedIds resets), then notify any freshly-earned milestones.
  const history = appendEvent(acted.history ?? [], { at: now, type: 'act', label: o.name, kind: o.kind })
  const progress = updateProgress({ ...acted, history }, now)
  const freshly = newlyEarned(state.progress, progress)
  const rendered = { ...acted, history, progress, render: { ...acted.render, lastRenderedAt: now } }
  saveState(dir, rendered)
  writeArtifact(rendered, cfg, dir)
  notifyAchievements(freshly)
  logLine(dir, `random-act: ${o.kind} "${o.name}" (delta ${o.delta}, actTokens ${rendered.sim.actTokens})`)
  const icon = o.kind === 'boon' ? '✨' : '⚠'
  console.log(`${icon} ${o.name} — ${o.blurb}`)
  open(dir)
  return { ok: true, act: o }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.env.CORNERCASE_PLUGIN_STATE || process.cwd()
  const res = runRandomAct({ dir })
  process.exit(res.ok || res.reason === 'cooldown' ? 0 : 1)
}
