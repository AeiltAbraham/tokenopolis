import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startCityServer } from '../src/server.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'tok-srv-'))
const boot = (dir, runAct) =>
  new Promise((resolve) => {
    const server = startCityServer({ dir, runAct, onReady: (url) => resolve({ url, server }) })
  })

test('serves city.html, runs /act once, refuses cross-origin, 404s the rest', async () => {
  const dir = tmp()
  writeFileSync(join(dir, 'city.html'), '<!doctype html><title>t</title>HELLO-CITY')
  let acted = 0
  const { url, server } = await boot(dir, () => (acted++, { ok: true, act: { name: 'Boom', kind: 'boon' } }))
  try {
    const home = await fetch(url + '/')
    assert.equal(home.status, 200)
    assert.match(await home.text(), /HELLO-CITY/)

    const act = await fetch(url + '/act', { method: 'POST' })
    assert.equal(act.status, 200)
    const body = await act.json()
    assert.equal(body.ok, true)
    assert.equal(body.act.name, 'Boom')
    assert.equal(acted, 1, 'runAct invoked once')

    const cross = await fetch(url + '/act', { method: 'POST', headers: { Origin: 'http://evil.example' } })
    assert.equal(cross.status, 403)
    assert.equal(acted, 1, 'a cross-origin POST must NOT run an act')

    const miss = await fetch(url + '/nope')
    assert.equal(miss.status, 404)
  } finally {
    server.close()
  }
})

test('GET / is 404 before any city is rendered', async () => {
  const { url, server } = await boot(tmp(), () => ({ ok: true }))
  try {
    assert.equal((await fetch(url + '/')).status, 404)
  } finally {
    server.close()
  }
})

test('a throwing runAct is contained — 200 with ok:false, not a crash', async () => {
  const dir = tmp()
  writeFileSync(join(dir, 'city.html'), 'x')
  const { url, server } = await boot(dir, () => {
    throw new Error('boom')
  })
  try {
    const r = await fetch(url + '/act', { method: 'POST' })
    assert.equal(r.status, 200)
    const b = await r.json()
    assert.equal(b.ok, false)
    assert.equal(b.reason, 'error')
  } finally {
    server.close()
  }
})
