// Cosmetic config (name + theme). Read from $CORNERCASE_PLUGIN_CONFIG/config.json. Missing or
// invalid config yields defaults, never an error. Cosmetic only — no effect on the simulation.
//
// NOTE: the exact config.json location is assumed to be `$CORNERCASE_PLUGIN_CONFIG/config.json`
// per the plugin docs; this is confirmed against the live platform by the logging probe in T-012
// and recorded in README.md. Until then it is an assumption, isolated to this module.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_CONFIG = { cityName: 'Tokenopolis', theme: 'temperate', flag: '', districts: { tech: 'Tech', ops: 'Industry' } }
const ALLOWED_THEMES = new Set(['temperate', 'coastal', 'desert', 'nordic', 'neon', 'cyberpunk', 'solarpunk', 'blueprint', 'crt', 'wasteland', 'ascension'])
const dname = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 24) : fallback)

// Optional opt-in "region" (the shared-git-repo country). Both repo + handle are required, else it's OFF.
// handle is sanitised to a filename-safe slug; interval is clamped. No secrets here — git auth is the
// user's own system credentials, never stored in config.
function parseRegion(raw) {
  if (!raw || typeof raw !== 'object') return null
  // repo + branch reach `git` as positional args — reject a leading '-' so neither can pose as an option
  // (e.g. a branch of `--upload-pack=...`); branch is also charset-limited. Not a shell, so no shell injection.
  const repoRaw = typeof raw.repo === 'string' ? raw.repo.trim() : ''
  const repo = repoRaw && !repoRaw.startsWith('-') ? repoRaw.slice(0, 300) : null
  const handle = typeof raw.handle === 'string' ? raw.handle.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) : ''
  if (!repo || !handle) return null
  const shareLocation = raw.shareLocation === true
  const intervalMs = Number.isFinite(raw.intervalMs) ? Math.max(60000, Math.min(3600000, Math.floor(raw.intervalMs))) : 900000
  const branchRaw = typeof raw.branch === 'string' ? raw.branch.trim().replace(/[^A-Za-z0-9._/-]/g, '') : ''
  const branch = branchRaw && !branchRaw.startsWith('-') ? branchRaw.slice(0, 64) : 'main'
  return { repo, handle, shareLocation, intervalMs, branch }
}

export function readConfig(configDir = process.env.CORNERCASE_PLUGIN_CONFIG) {
  if (!configDir) return { ...DEFAULT_CONFIG }
  let raw
  try {
    raw = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))
  } catch {
    return { ...DEFAULT_CONFIG }
  }
  const cityName =
    typeof raw?.cityName === 'string' && raw.cityName.trim() ? raw.cityName.trim().slice(0, 60) : DEFAULT_CONFIG.cityName
  const theme = ALLOWED_THEMES.has(raw?.theme) ? raw.theme : DEFAULT_CONFIG.theme
  const flag = typeof raw?.flag === 'string' ? raw.flag.trim().slice(0, 4) : '' // a short emoji/badge by the name
  const districts = { tech: dname(raw?.districts?.tech, 'Tech'), ops: dname(raw?.districts?.ops, 'Industry') }
  const region = parseRegion(raw?.region)
  return { cityName, theme, flag, districts, ...(region ? { region } : {}) }
}
