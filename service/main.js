// The long-running keeper. First run captures the install baseline (grow-from-zero) and renders an
// initial city; then it ticks on an interval and immediately when a `refresh.request` poke appears
// (written by the status hook). Never exits on a tick error. The CLI entry wires signals.

import { watch, unlink, existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readStats as realReadStats } from '../src/stats.js'
import { loadState, saveState, initState, logLine } from '../src/state.js'
import { writeArtifact, cityData } from '../src/artifact.js'
import { readConfig } from '../src/config.js'
import { tick } from '../src/tick.js'
import { claudeProjectsDir, initClaudeOffsets, readClaudeDelta } from '../src/claude-stats.js'
import { startCityServer } from '../src/server.js'
import { runRandomAct } from '../bin/random-act.js'
import { canAct, msUntilNextAct, drawChoice } from '../src/acts.js'
import { burn, updatePyromid, newlyUnlocked } from '../src/pyromid.js'
import { treasuryFor } from '../src/sim/economy.js'
import { appendEvent } from '../src/history.js'

const randomSeed = () => (Math.floor(Math.random() * 0xffffffff) >>> 0)

// Ensures a state file exists. Returns true when state is ready, false when it DEFERRED because the
// first stats read failed — baseline capture must wait for a real read, or grow-from-zero would be
// defeated (a fabricated baseline of 0 counts the whole machine history as "built"). Retried next tick.
export function ensureState(dir, readStats, nowIso, config, claudeDir = claudeProjectsDir()) {
  if (loadState(dir, nowIso)) {
    // Upgrade path: an existing install adopting combined-burn has no Claude offsets yet. Initialize
    // them (skipping existing history) so the city doesn't jump from 2 GB of past transcripts.
    const offsetsPath = join(dir, 'claude-offsets.json')
    if (!existsSync(offsetsPath)) initClaudeOffsets(offsetsPath, claudeDir)
    return true
  }
  const stats = readStats()
  if (!stats) {
    logLine(dir, 'stats unavailable at install; deferring baseline capture until a successful read', nowIso)
    return false
  }
  const state = initState({ baselineLifetimeTokens: stats.lifetimeTotal, installedAt: nowIso(), citySeed: randomSeed() })
  saveState(dir, state)
  initClaudeOffsets(join(dir, 'claude-offsets.json'), claudeDir) // skip existing Claude history → grow-from-zero
  writeArtifact(state, config, dir)
  logLine(dir, `initialized (grow-from-zero; baseline ${stats.lifetimeTotal} cornercase tokens; Claude counted forward)`, nowIso)
  return true
}

// A Pyromid click: deposit clickValue into the datacenter's treasury, re-build (high-water), chronicle
// any lore it reveals, and re-render. No cooldown — the burn is the interaction. Injectable for tests.
export function runPyromidBurn({ dir, nowIso = () => new Date().toISOString(), config = readConfig() }) {
  const now = nowIso()
  const state = loadState(dir, nowIso)
  if (!state) return { ok: false, reason: 'no-state' }
  const burned = burn(state.pyromid)
  const pyromid = updatePyromid(burned, treasuryFor(state.sim, burned.bonus))
  let history = state.history ?? []
  for (const line of newlyUnlocked(state.pyromid?.infoLevel ?? 1, pyromid.infoLevel)) history = appendEvent(history, { at: now, type: 'pyromid', label: line })
  const next = { ...state, pyromid, history, render: { ...state.render, lastRenderedAt: now } }
  saveState(dir, next)
  writeArtifact(next, config, dir)
  const data = cityData(next, config)
  return { ok: true, progress: pyromid.progress, bonus: pyromid.bonus, treasury: data.pyromid.treasury, displayTreasury: data.readout.treasury }
}

export function startService({
  dir,
  tickMs = 60_000,
  readStats = realReadStats,
  config = readConfig(),
  nowIso = () => new Date().toISOString(),
  claudeDir = claudeProjectsDir(),
}) {
  const offsetsPath = join(dir, 'claude-offsets.json')
  const run = () => {
    try {
      if (!ensureState(dir, readStats, nowIso, config, claudeDir)) return // first read failed — retry next tick
      tick({ dir, readStats, config, nowIso, readClaude: () => readClaudeDelta(offsetsPath, claudeDir) }, nowIso())
    } catch (e) {
      logLine(dir, `tick error: ${e && e.message}`, nowIso) // never exit the loop on a tick error
    }
  }
  run()
  const interval = setInterval(run, tickMs) // also the poll fallback if fs.watch is unavailable

  let watcher
  try {
    watcher = watch(dir, (_event, file) => {
      if (file === 'refresh.request') {
        unlink(join(dir, 'refresh.request'), () => {}) // best-effort delete after handling
        run()
      }
    })
  } catch {
    /* fs.watch unsupported here — the interval covers refreshes */
  }

  // Local bridge: serve the city on localhost and let its "A Random Act" button POST /act. The URL is
  // written to <dir>/endpoint so the "Open Tokenopolis" action opens the interactive page, not the file.
  const endpointPath = join(dir, 'endpoint')
  let cityServer
  try {
    cityServer = startCityServer({
      dir,
      runAct: (choiceId) => runRandomAct({ dir, open: () => {}, nowIso, config, choiceId }),
      runPyro: () => runPyromidBurn({ dir, nowIso, config }),
      readState: () => {
        const s = loadState(dir, nowIso)
        return s ? cityData(s, config) : null
      },
      readChoice: () => {
        const s = loadState(dir, nowIso)
        if (!s) return null
        const acts = s.acts ?? { usedIds: [], lastActAt: null }
        const nowMs = Date.parse(nowIso())
        if (!canAct(acts, nowMs)) return { ok: false, reason: 'cooldown', minutesLeft: Math.ceil(msUntilNextAct(acts, nowMs) / 60000) }
        const { options } = drawChoice(acts.usedIds ?? [], Math.random)
        return { ok: true, options: options.map((o) => ({ id: o.id, name: o.name, kind: o.kind, blurb: o.blurb })) }
      },
      onReady: (url) => {
        try {
          writeFileSync(endpointPath, url, { mode: 0o600 })
        } catch {
          /* best effort — the action falls back to opening the file */
        }
        logLine(dir, `city server listening at ${url}`, nowIso)
      },
      onFail: (e) => logLine(dir, `city server error: ${e && e.message}`, nowIso),
    })
  } catch (e) {
    logLine(dir, `city server failed to start: ${e && e.message}`, nowIso)
  }

  return {
    run,
    stop() {
      clearInterval(interval)
      try {
        watcher && watcher.close()
      } catch {
        /* ignore */
      }
      try {
        cityServer && cityServer.close()
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(endpointPath) // remove the stale URL so the action falls back to the file
      } catch {
        /* ignore */
      }
    },
  }
}

// CLI entry.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.env.CORNERCASE_PLUGIN_STATE || process.cwd()
  const svc = startService({ dir, tickMs: Number(process.env.TOKENOPOLIS_TICK_MS) || 60_000 })
  logLine(dir, 'service started', () => new Date().toISOString())
  // Defense-in-depth: a stray async error (e.g. a failed child spawn) must never take the keeper down
  // and strand the city server — log it and keep serving.
  process.on('uncaughtException', (e) => logLine(dir, `uncaught: ${e && e.message}`, () => new Date().toISOString()))
  const shutdown = () => {
    try {
      logLine(dir, 'shutdown', () => new Date().toISOString())
    } catch {
      /* ignore */
    }
    svc.stop()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
