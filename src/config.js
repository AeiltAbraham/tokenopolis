// Cosmetic config (name + theme). Read from $CORNERCASE_PLUGIN_CONFIG/config.json. Missing or
// invalid config yields defaults, never an error. Cosmetic only — no effect on the simulation.
//
// NOTE: the exact config.json location is assumed to be `$CORNERCASE_PLUGIN_CONFIG/config.json`
// per the plugin docs; this is confirmed against the live platform by the logging probe in T-012
// and recorded in README.md. Until then it is an assumption, isolated to this module.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_CONFIG = { cityName: 'Tokenopolis', theme: 'temperate', flag: '', districts: { tech: 'Tech', ops: 'Industry' } }
const ALLOWED_THEMES = new Set(['temperate', 'coastal', 'desert', 'nordic', 'neon', 'cyberpunk', 'solarpunk', 'blueprint', 'crt', 'wasteland'])
const dname = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 24) : fallback)

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
  return { cityName, theme, flag, districts }
}
