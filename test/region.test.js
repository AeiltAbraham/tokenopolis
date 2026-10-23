import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cityPostcard, syncRegion, clampPostcard, __resetRegionForTest } from '../src/region.js'
import { readConfig } from '../src/config.js'

const mock = (over = {}) => ({
  readout: { cityName: 'Aertville', locationCity: 'Motril', scaleName: 'Township', population: 42000, vitality: 0.9, economyRating: 1234, condition: 'Thriving' },
  scene: { scaleIndex: 2, sizeIndex: 3 },
  era: 'build',
  seed: 7,
  day: 5,
  streak: { current: 3, best: 3 },
  achievements: [{ earned: true }, { earned: false }, { earned: true }],
  pyromid: { progress: 0.04 },
  ...over,
})

test('cityPostcard: coarse shareable fields only, no secrets, nearCity gated on shareLocation', () => {
  const base = cityPostcard(mock(), { region: { handle: 'aert', shareLocation: false } }, '2026-10-23T00:00:00.000Z')
  assert.equal(base.handle, 'aert')
  assert.equal(base.cityName, 'Aertville')
  assert.equal(base.population, 42000)
  assert.equal(base.achievements, 2)
  assert.equal(base.pyromidPct, 4)
  assert.equal(base.citySeed, 7)
  assert.equal(base.nearCity, null, 'location hidden unless opted in')
  const keys = Object.keys(base)
  for (const bad of ['token', 'tokens', 'ip', 'path', 'user', 'builtTokens', 'claude', 'history']) {
    assert.ok(!keys.includes(bad), `postcard must not carry "${bad}"`)
  }
  assert.equal(cityPostcard(mock(), { region: { handle: 'aert', shareLocation: true } }, 'x').nearCity, 'Motril', 'shown when opted in')
})

test('clampPostcard: caps every field + drops extras (an untrusted neighbour cannot bloat our artifact)', () => {
  const c = clampPostcard({ handle: 'kees!!', cityName: 'X'.repeat(100000), nearCity: 'Y'.repeat(9999), token: 'SECRET', evil: 'Z'.repeat(99999), population: 1e30, vitality: 9, pyromidPct: 999 })
  assert.equal(c.handle, 'kees', 'handle sanitised')
  assert.ok(c.cityName.length <= 60, 'cityName capped')
  assert.ok(c.nearCity.length <= 48, 'nearCity capped')
  assert.ok(!('token' in c) && !('evil' in c), 'extra/non-schema fields dropped')
  assert.equal(c.vitality, 1, 'vitality clamped to 1')
  assert.equal(c.pyromidPct, 100, 'pyromidPct clamped to 100')
  assert.ok(c.population <= 1e12, 'population bounded')
  assert.equal(clampPostcard({ handle: '!!!' }), null, 'an all-invalid handle → null')
  assert.equal(clampPostcard(null), null)
})

test('config: a valid region block parses; missing repo/handle → off; handle sanitised', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
  const write = (o) => writeFileSync(join(dir, 'config.json'), JSON.stringify(o))
  write({ region: { repo: 'git@x:country.git', handle: 'aert!!/../x', shareLocation: true } })
  const c = readConfig(dir)
  assert.equal(c.region.repo, 'git@x:country.git')
  assert.equal(c.region.handle, 'aertx', 'handle sanitised to [A-Za-z0-9_-]')
  assert.equal(c.region.shareLocation, true)
  assert.equal(c.region.branch, 'main', 'branch defaults to main')
  write({ region: { repo: 'r', handle: 'a', branch: 'dev' } })
  assert.equal(readConfig(dir).region.branch, 'dev', 'a safe custom branch is kept')
  write({ region: { repo: 'r', handle: 'a', branch: '--upload-pack=evil' } })
  assert.equal(readConfig(dir).region.branch, 'main', 'a dash-leading branch is rejected (no option injection)')
  write({ region: { repo: '--upload-pack=evil', handle: 'a' } })
  assert.equal(readConfig(dir).region, undefined, 'a dash-leading repo is rejected → off')
  write({ region: { handle: 'aert' } })
  assert.equal(readConfig(dir).region, undefined, 'no repo → off')
  write({})
  assert.equal(readConfig(dir).region, undefined, 'no region → off')
})

test('syncRegion: no repo/handle → returns the (empty) cache, never throws', async () => {
  __resetRegionForTest()
  assert.deepEqual(await syncRegion({ dir: tmpdir(), repo: null, handle: 'aert', postcard: {} }), [])
})

test('syncRegion: clones the country, publishes our postcard, reads the roster (e2e, real git)', async () => {
  __resetRegionForTest()
  const idGit = (args, cwd) => execFileSync('git', args[0] === 'commit' ? ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args] : args, { cwd, stdio: 'pipe' })
  // a bare "country" repo, seeded with another keeper's city
  const bare = join(mkdtempSync(join(tmpdir(), 'country-')), 'country.git')
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'pipe' })
  const seed = mkdtempSync(join(tmpdir(), 'seed-'))
  execFileSync('git', ['clone', bare, seed], { stdio: 'pipe' })
  mkdirSync(join(seed, 'cities'), { recursive: true })
  writeFileSync(join(seed, 'cities', 'kees.json'), JSON.stringify({ schema: 1, handle: 'kees', cityName: 'Keesville', scaleName: 'Metropolis', population: 999000, vitality: 1, era: 'build', updatedAt: '2026-10-23T00:00:00.000Z' }))
  writeFileSync(join(seed, 'cities', 'big.json'), JSON.stringify({ schema: 1, handle: 'big', cityName: 'X'.repeat(1000), scaleName: 'City', population: 10000, vitality: 0.5, era: 'build', updatedAt: '2026-10-23T00:00:00.000Z' }))
  writeFileSync(join(seed, 'cities', 'bloat.json'), JSON.stringify({ schema: 1, handle: 'bloat', cityName: 'X'.repeat(80000), scaleName: 'City', population: 1, vitality: 0.1, era: 'build', updatedAt: '2026-10-23T00:00:00.000Z' }))
  idGit(['add', '-A'], seed)
  idGit(['commit', '-m', 'seed kees'], seed)
  execFileSync('git', ['push', 'origin', 'HEAD:main'], { cwd: seed, stdio: 'pipe' })

  // our keeper joins the country
  const dir = mkdtempSync(join(tmpdir(), 'me-'))
  const git = (args, cwd) => Promise.resolve(String(idGit(args, cwd)))
  const postcard = cityPostcard(mock({ readout: { cityName: 'Aertville', scaleName: 'Township', population: 42000, vitality: 0.9, condition: 'Thriving' } }), { region: { handle: 'aert' } }, '2026-10-23T01:00:00.000Z')
  const roster = await syncRegion({ dir, repo: bare, handle: 'aert', postcard, branch: 'main', git })

  assert.ok(roster.some((c) => c.handle === 'kees'), 'the roster includes the other city')
  assert.ok(!roster.some((c) => c.handle === 'aert'), 'the roster excludes ourselves')
  // our postcard reached the shared repo
  const verify = mkdtempSync(join(tmpdir(), 'verify-'))
  execFileSync('git', ['clone', bare, verify], { stdio: 'pipe' })
  assert.ok(existsSync(join(verify, 'cities', 'aert.json')), 'our postcard was published to the country')
  assert.equal(JSON.parse(readFileSync(join(verify, 'cities', 'aert.json'), 'utf8')).cityName, 'Aertville')
  const big = roster.find((c) => c.handle === 'big')
  assert.ok(big && big.cityName.length <= 60, 'an over-long neighbour cityName is clamped on read, not baked verbatim')
  assert.ok(!roster.some((c) => c.handle === 'bloat'), 'a bloated (>64KB) postcard file is skipped entirely')
  const author = execFileSync('git', ['log', '-1', '--format=%an <%ae>', '--', 'cities/aert.json'], { cwd: verify }).toString().trim()
  assert.equal(author, 'aert <aert@tokenopolis.local>', 'the commit uses the anonymous handle identity, not the OS user')
})

test('syncRegion: publishes + reads on a NON-default branch (the shallow-clone fix)', async () => {
  __resetRegionForTest()
  const idGit = (a, c) => execFileSync('git', a[0] === 'commit' ? ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a] : a, { cwd: c, stdio: 'pipe' })
  const bare = join(mkdtempSync(join(tmpdir(), 'country2-')), 'c.git')
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'pipe' })
  const seed = mkdtempSync(join(tmpdir(), 'seed2-'))
  execFileSync('git', ['clone', bare, seed], { stdio: 'pipe' })
  writeFileSync(join(seed, 'README'), 'country\n') // main gets an initial commit…
  idGit(['add', '-A'], seed)
  idGit(['commit', '-m', 'init main'], seed)
  execFileSync('git', ['push', 'origin', 'HEAD:main'], { cwd: seed, stdio: 'pipe' })
  execFileSync('git', ['checkout', '-b', 'dev'], { cwd: seed, stdio: 'pipe' }) // …the roster lives on 'dev'
  mkdirSync(join(seed, 'cities'), { recursive: true })
  writeFileSync(join(seed, 'cities', 'kees.json'), JSON.stringify({ schema: 1, handle: 'kees', cityName: 'Keesville', population: 5, vitality: 1, era: 'build', updatedAt: '2026-10-23T00:00:00.000Z' }))
  idGit(['add', '-A'], seed)
  idGit(['commit', '-m', 'dev kees'], seed)
  execFileSync('git', ['push', 'origin', 'HEAD:dev'], { cwd: seed, stdio: 'pipe' })

  const dir = mkdtempSync(join(tmpdir(), 'me2-'))
  const git = (a, c) => Promise.resolve(String(idGit(a, c)))
  const roster = await syncRegion({ dir, repo: bare, handle: 'aert', postcard: cityPostcard(mock(), { region: { handle: 'aert' } }, '2026-10-23T02:00:00.000Z'), branch: 'dev', git })
  assert.ok(roster.some((c) => c.handle === 'kees'), 'reads the roster from the non-default branch')
  const verify = mkdtempSync(join(tmpdir(), 'verify2-'))
  execFileSync('git', ['clone', '-b', 'dev', bare, verify], { stdio: 'pipe' })
  assert.ok(existsSync(join(verify, 'cities', 'aert.json')), 'published to the non-default branch')
})
