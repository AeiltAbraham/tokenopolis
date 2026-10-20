import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'smol-toml'
import { poke } from '../scripts/poke.mjs'
import { openCity } from '../scripts/open-city.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = () => mkdtempSync(join(tmpdir(), 'tokenopolis-'))

test('poke(dir) drops refresh.request into the state dir', () => {
  const dir = tmp()
  assert.equal(poke(dir), true)
  assert.ok(existsSync(join(dir, 'refresh.request')))
})

test('poke CLI resolves CORNERCASE_PLUGIN_STATE and exits well under the 60s hook budget', () => {
  const dir = tmp()
  const t0 = Date.now()
  execFileSync('node', ['scripts/poke.mjs'], { cwd: root, env: { ...process.env, CORNERCASE_PLUGIN_STATE: dir } })
  const ms = Date.now() - t0
  assert.ok(existsSync(join(dir, 'refresh.request')), 'poke should create refresh.request')
  assert.ok(ms < 1000, `poke took ${ms}ms (must be well under the 60s hook kill)`)
})

test('openCity uses the platform opener with the artifact path', () => {
  const dir = tmp()
  writeFileSync(join(dir, 'city.html'), '<!doctype html><html></html>')
  const calls = []
  const fakeSpawn = (cmd, args) => (calls.push([cmd, args]), { unref() {} })
  assert.equal(openCity(dir, 'darwin', fakeSpawn), true)
  assert.deepEqual(calls[0], ['open', [join(dir, 'city.html')]])

  const linuxCalls = []
  openCity(dir, 'linux', (c, a) => (linuxCalls.push([c, a]), { unref() {} }))
  assert.equal(linuxCalls[0][0], 'xdg-open')
})

test('openCity returns false (and warns) when no city exists yet', () => {
  assert.equal(openCity(tmp(), 'darwin', () => ({ unref() {} })), false)
})

test('every manifest command points at a file that exists', () => {
  const manifest = parse(readFileSync(join(root, 'cornercase-plugin.toml'), 'utf8'))
  const entries = [...(manifest.service ?? []), ...(manifest.events ?? []), ...(manifest.actions ?? [])]
  assert.ok(entries.length >= 3)
  for (const e of entries) {
    const file = e.command[1] // ["node", "<file>"]
    assert.ok(existsSync(join(root, file)), `manifest command file missing: ${file}`)
  }
})
