// The Region ("country"): opt-in, share a tiny city postcard with other keepers through a shared git repo.
// KEEPER-SIDE ONLY — never bundled into the artifact; the roster is baked into the artifact JSON, so a shared
// city stays self-contained. Privacy: only the postcard leaves the machine — no tokens, events, IPs, paths,
// or OS user. Failure-tolerant: a git/network hiccup never throws and never blocks the keeper. No new
// dependency — git runs via the built-in child_process.

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Build the shared postcard from a cityData() result. PURE (nowIso is passed in). Only coarse, shareable
// fields — deliberately NO tokens, event log, IP, file path, or OS user.
export function cityPostcard(data, config, nowIso) {
  const r = data?.readout ?? {}
  const region = config?.region ?? {}
  const streak = Number(data?.streak?.current ?? data?.streak?.days ?? 0) || 0
  const earned = Array.isArray(data?.achievements) ? data.achievements.filter((a) => a && a.earned).length : 0
  return {
    schema: 1,
    handle: String(region.handle ?? '').slice(0, 24),
    cityName: String(r.cityName ?? 'Tokenopolis').slice(0, 60),
    nearCity: region.shareLocation && typeof r.locationCity === 'string' ? r.locationCity.slice(0, 48) : null,
    scaleName: String(r.scaleName ?? '').slice(0, 24),
    scaleIndex: Math.max(0, Math.floor(data?.scene?.scaleIndex ?? 0)),
    sizeIndex: Math.max(0, Math.floor(data?.scene?.sizeIndex ?? 0)),
    population: Math.max(0, Math.round(r.population ?? 0)),
    vitality: Math.max(0, Math.min(1, r.vitality ?? 0)),
    economyRating: Math.max(0, Math.round(r.economyRating ?? 0)),
    condition: String(r.condition ?? '').slice(0, 24),
    era: String(data?.era ?? 'build').slice(0, 16),
    pyromidPct: Math.max(0, Math.min(100, Math.round((data?.pyromid?.progress ?? 0) * 100))),
    citySeed: (data?.seed >>> 0) || 0,
    streak,
    day: Math.max(0, Math.floor(data?.day ?? 0)),
    achievements: earned,
    updatedAt: nowIso,
  }
}

// Default git runner — shells out to the system git. Injectable so tests never need the real binary.
const realGit = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 20000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))))
  })

let cache = [] // the last good roster (postcards of the OTHER cities in the country)

export function getCachedRegion() {
  return cache
}
export function __resetRegionForTest() {
  cache = []
}

const MAX_CITIES = 60 // bound the baked roster so a big/hostile country can't blow the artifact size budget
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
const num = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo)

// Clamp an UNTRUSTED postcard read from the shared repo: whitelist the known fields + cap every size, so a
// neighbour (buggy, modified, or hostile) can't bloat our self-contained artifact or smuggle extra fields.
export function clampPostcard(p) {
  if (!p || typeof p !== 'object') return null
  const handle = typeof p.handle === 'string' ? p.handle.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) : ''
  if (!handle) return null
  return {
    schema: 1,
    handle,
    cityName: str(p.cityName, 60) || 'Tokenopolis',
    nearCity: typeof p.nearCity === 'string' ? p.nearCity.slice(0, 48) : null,
    scaleName: str(p.scaleName, 24),
    scaleIndex: Math.floor(num(p.scaleIndex, 0, 1000)),
    sizeIndex: Math.floor(num(p.sizeIndex, 0, 1000)),
    population: Math.round(num(p.population, 0, 1e12)),
    vitality: num(p.vitality, 0, 1),
    economyRating: Math.round(num(p.economyRating, 0, 1e9)),
    condition: str(p.condition, 24),
    era: str(p.era, 16),
    pyromidPct: Math.round(num(p.pyromidPct, 0, 100)),
    citySeed: (p.citySeed >>> 0) || 0,
    streak: Math.floor(num(p.streak, 0, 100000)),
    day: Math.floor(num(p.day, 0, 100000)),
    achievements: Math.floor(num(p.achievements, 0, 100000)),
    updatedAt: str(p.updatedAt, 40),
  }
}

const parsePostcard = (txt) => {
  try {
    return clampPostcard(JSON.parse(txt))
  } catch {
    return null // skip a malformed postcard
  }
}

// Diff two region rosters → notable headlines for the Tokenopolis Times (a neighbour reached the
// Singularity, fell to ruin, grew a tier, finished its Pyromid, or newly joined). PURE. Events use the
// 'vignette' type — a 🗞️ dispatch, deliberately NOT counted in the player's own act/disaster tally
// (summarize() ignores it) — and carry the headline as `line`. An empty `prev` (the first sync of a keeper
// run) yields nothing: that roster is the baseline, not news. Capped so a big sync can't flood the log.
export function regionHeadlines(prev, next, nowIso, cap = 3) {
  if (!Array.isArray(prev) || !prev.length || !Array.isArray(next)) return []
  const was = new Map(prev.map((c) => [c.handle, c]))
  const out = []
  const push = (line, rank) => out.push({ at: nowIso, type: 'vignette', label: line, line, rank })
  for (const c of next) {
    const name = c.cityName || c.handle || 'A city'
    const p = was.get(c.handle)
    if (!p) {
      push(`${name} joined the region`, 1)
      continue
    }
    if (c.era === 'ascendant' && p.era !== 'ascendant') push(`${name} reached the Singularity`, 4)
    else if (c.era === 'fallout' && p.era !== 'fallout') push(`${name} fell to ruin`, 3)
    else if ((c.scaleIndex ?? 0) > (p.scaleIndex ?? 0) && c.scaleName) push(`${name} grew to ${c.scaleName}`, 2)
    if ((c.pyromidPct ?? 0) >= 100 && (p.pyromidPct ?? 0) < 100) push(`${name} completed its Pyromid`, 2)
  }
  return out
    .sort((a, b) => b.rank - a.rank)
    .slice(0, cap)
    .map(({ rank, ...e }) => e)
}

// Publish our postcard and fetch the roster through the shared repo (cloned to <dir>/region-repo). We only
// ever write cities/<handle>.json, so a push race just means re-sync + retry. NEVER throws; returns the
// roster (minus ourselves) or the last good cache.
export async function syncRegion({ dir, repo, handle, postcard, branch = 'main', git = realGit }) {
  if (!repo || !handle) return cache
  const repoDir = join(dir, 'region-repo')
  const file = join('cities', `${handle}.json`)
  try {
    if (!existsSync(join(repoDir, '.git'))) await git(['clone', '--depth', '1', '--', repo, repoDir], dir)
    // Anonymous commit identity = the chosen handle (never the machine's git user.name/email). `-c` scopes it
    // to this commit only, so it doesn't touch the user's global config.
    const idCommit = ['-c', `user.name=${handle}`, '-c', `user.email=${handle}@tokenopolis.local`, 'commit', '-m', `city: ${handle}`, '--allow-empty']
    for (let attempt = 0; attempt < 3; attempt++) {
      await git(['fetch', 'origin', branch], repoDir).catch(() => {})
      // reset to the fetched tip via FETCH_HEAD (works for ANY branch, incl. a shallow single-branch clone
      // where origin/<branch> may not be a tracking ref); a first keeper for a new branch just proceeds.
      await git(['reset', '--hard', 'FETCH_HEAD'], repoDir).catch(() => {})
      mkdirSync(join(repoDir, 'cities'), { recursive: true })
      writeFileSync(join(repoDir, file), JSON.stringify(postcard, null, 2) + '\n')
      await git(['add', file], repoDir)
      await git(idCommit, repoDir).catch(() => {})
      try {
        await git(['push', 'origin', `HEAD:${branch}`], repoDir)
        break // pushed cleanly
      } catch {
        /* someone pushed between our fetch and push — loop re-syncs and retries */
      }
    }
    const citiesDir = join(repoDir, 'cities')
    const roster = []
    if (existsSync(citiesDir)) {
      let seen = 0
      for (const f of readdirSync(citiesDir)) {
        if (!f.endsWith('.json') || ++seen > 500) continue // bound the read against a pathological country
        let txt
        try {
          txt = readFileSync(join(citiesDir, f), 'utf8')
        } catch {
          continue
        }
        if (txt.length > 65536) continue // a real postcard is < 1 KB; skip a bloated file
        const p = parsePostcard(txt)
        if (p && p.handle !== handle) roster.push(p)
      }
    }
    cache = roster.sort((a, b) => (b.population ?? 0) - (a.population ?? 0)).slice(0, MAX_CITIES)
  } catch {
    /* offline / no access / bad repo — keep the last good roster so the city still works solo */
  }
  return cache
}
