// Approximate CITY + current weather for the "Tokenopolis near <city>" label and the real sky, derived from
// the viewer's IP. KEEPER-SIDE ONLY — never bundled into the shared artifact; the resolved city/weather are
// baked into the artifact JSON (so a shared city shows them as of the last keeper rebuild). Privacy: the IP
// is sent to a keyless geo service only to resolve a city-level name + coarse coords, and is NEVER stored or
// logged here. Everything degrades to null on any error/offline; callers fall back to the local clock + the
// deterministic weatherOf(). No new dependency — Node's built-in fetch (Node >= 20).

const UA = 'tokenopolis (+https://github.com/AeiltAbraham/tokenopolis)'

async function getJson(url, ms = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null // offline, blocked, timeout, bad JSON — the caller falls back
  } finally {
    clearTimeout(timer)
  }
}

// WMO weather code → our five render labels (clear | overcast | rain | fog | snow). Pure + exported for tests.
export function weatherLabelFromCode(code) {
  const c = Number(code)
  if (!Number.isFinite(c)) return 'clear'
  if (c <= 1) return 'clear' // 0 clear sky, 1 mainly clear
  if (c <= 3) return 'overcast' // 2 partly cloudy, 3 overcast
  if (c === 45 || c === 48) return 'fog'
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow' // snow fall / grains / showers
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99)) return 'rain' // drizzle/rain/showers/thunder
  return 'overcast'
}

async function geolocate() {
  // primary ipwho.is, fallback ipapi.co — both keyless HTTPS; keep only a city + coarse coords, never the IP.
  const a = await getJson('https://ipwho.is/')
  if (a && a.success && a.city && Number.isFinite(a.latitude) && Number.isFinite(a.longitude)) {
    return { city: String(a.city).slice(0, 48), lat: a.latitude, lon: a.longitude }
  }
  const b = await getJson('https://ipapi.co/json/')
  if (b && b.city && Number.isFinite(b.latitude) && Number.isFinite(b.longitude)) {
    return { city: String(b.city).slice(0, 48), lat: b.latitude, lon: b.longitude }
  }
  return null
}

async function fetchWeather(lat, lon) {
  const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`)
  const cur = w && w.current
  if (!cur || !Number.isFinite(cur.temperature_2m)) return null
  return { weather: weatherLabelFromCode(cur.weather_code), tempC: Math.round(cur.temperature_2m) }
}

let cache = null // { city, weather, tempC, at } — the last good lookup
let geo = null // { city, lat, lon } — the resolved city (cached longer; it rarely changes)
let geoAt = 0

const GEO_TTL = 6 * 3600_000 // re-resolve the city every 6h

// Refresh the cached city + weather. Network-driven but failure-tolerant: returns the (possibly unchanged)
// cache and NEVER throws, so the keeper can call it fire-and-forget. Fetchers are injectable so tests never
// touch the network.
export async function refreshGeoWeather(opts = {}) {
  const now = opts.now ?? Date.now()
  const geoFn = opts.geolocate ?? geolocate
  const weatherFn = opts.weather ?? fetchWeather
  try {
    if (!geo || now - geoAt > GEO_TTL) {
      const g = await geoFn()
      if (g) {
        geo = g
        geoAt = now
      }
    }
    if (!geo) return cache // no location yet — keep whatever we had (maybe null)
    const wx = await weatherFn(geo.lat, geo.lon)
    if (wx) {
      cache = { city: geo.city, weather: wx.weather, tempC: wx.tempC, at: now }
    } else if (!cache) {
      // geo resolved but the weather API is down at cold start — still surface the city so the
      // "near <city>" label appears; the sky falls back to the deterministic weatherOf().
      cache = { city: geo.city, weather: null, tempC: null, at: now }
    } else {
      // transient weather failure with a prior good reading — keep the last weather, refresh the city.
      cache = { ...cache, city: geo.city, at: now }
    }
  } catch {
    /* keep the last good cache — a refresh must never break the keeper */
  }
  return cache
}

// The last good lookup (or null). cityData() reads this to bake location + weather into the artifact.
export function getCachedGeoWeather() {
  return cache
}

// Test hook: clear the module cache so cases don't bleed into each other.
export function __resetGeoWeatherForTest() {
  cache = null
  geo = null
  geoAt = 0
}
