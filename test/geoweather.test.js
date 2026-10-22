import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weatherLabelFromCode, refreshGeoWeather, getCachedGeoWeather, __resetGeoWeatherForTest } from '../src/geoweather.js'

test('weatherLabelFromCode: WMO codes map to the five render labels (unknown → safe default, never throws)', () => {
  assert.equal(weatherLabelFromCode(0), 'clear')
  assert.equal(weatherLabelFromCode(1), 'clear')
  assert.equal(weatherLabelFromCode(2), 'overcast')
  assert.equal(weatherLabelFromCode(3), 'overcast')
  assert.equal(weatherLabelFromCode(45), 'fog')
  assert.equal(weatherLabelFromCode(48), 'fog')
  for (const c of [51, 61, 65, 80, 82, 95, 99]) assert.equal(weatherLabelFromCode(c), 'rain', `code ${c} → rain`)
  for (const c of [71, 75, 77, 85, 86]) assert.equal(weatherLabelFromCode(c), 'snow', `code ${c} → snow`)
  assert.equal(weatherLabelFromCode(undefined), 'clear') // missing → safe default
  assert.equal(weatherLabelFromCode('not-a-number'), 'clear')
})

test('refreshGeoWeather: builds the env from injected fetchers and caches it (no network)', async () => {
  __resetGeoWeatherForTest()
  const geolocate = async () => ({ city: 'Testville', lat: 1, lon: 2 })
  const weather = async () => ({ weather: 'rain', tempC: 12 })
  const env = await refreshGeoWeather({ geolocate, weather, now: 1000 })
  assert.deepEqual({ city: env.city, weather: env.weather, tempC: env.tempC }, { city: 'Testville', weather: 'rain', tempC: 12 })
  assert.equal(getCachedGeoWeather().city, 'Testville', 'cached so cityData() can read it')
})

test('refreshGeoWeather: offline geo → null env, and never throws', async () => {
  __resetGeoWeatherForTest()
  const env = await refreshGeoWeather({ geolocate: async () => null, weather: async () => ({ weather: 'rain', tempC: 1 }), now: 1 })
  assert.equal(env, null, 'no location → no env')
  assert.equal(getCachedGeoWeather(), null)
})

test('refreshGeoWeather: a weather failure keeps the last good value (does not clobber the cache)', async () => {
  __resetGeoWeatherForTest()
  const geolocate = async () => ({ city: 'Testville', lat: 1, lon: 2 })
  await refreshGeoWeather({ geolocate, weather: async () => ({ weather: 'clear', tempC: 20 }), now: 1000 })
  const env = await refreshGeoWeather({ geolocate, weather: async () => null, now: 2000 }) // weather API down
  assert.equal(env.weather, 'clear', 'kept the last good weather')
  assert.equal(env.tempC, 20)
})

test('refreshGeoWeather: geo up but weather down at cold start still surfaces the city (so "near <city>" shows)', async () => {
  __resetGeoWeatherForTest()
  const env = await refreshGeoWeather({ geolocate: async () => ({ city: 'Haarlem', lat: 1, lon: 2 }), weather: async () => null, now: 1 })
  assert.equal(env.city, 'Haarlem', 'the resolved city is surfaced even with no weather')
  assert.equal(env.weather, null, 'no weather → null so the sky falls back to weatherOf()')
  assert.equal(env.tempC, null)
})

test('refreshGeoWeather: a thrown fetcher is swallowed — the keeper stays alive', async () => {
  __resetGeoWeatherForTest()
  await assert.doesNotReject(
    refreshGeoWeather({
      geolocate: async () => {
        throw new Error('boom')
      },
      weather: async () => null,
      now: 1,
    }),
  )
  assert.equal(getCachedGeoWeather(), null)
})
