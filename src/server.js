// Local-only HTTP bridge so the in-city "A Random Act" button can actually TRIGGER an act — a browser
// page can't spawn a process. Binds 127.0.0.1 on an ephemeral port, serves the current city.html, and
// exposes POST /act which runs ONE act (cooldown-checked) via the injected runAct, then re-renders.
// Nothing is exposed off the machine; cross-origin POSTs are refused (a stray web page can't roll acts).

import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export function createCityServer({ dir, runAct, runPyro, readState, readChoice }) {
  // CSRF/DNS-rebinding guard for mutating POSTs: a same-origin loopback fetch passes; a non-loopback Host
  // or a cross-origin POST is refused, so a random web page the user visits can't trigger city changes.
  const sameOriginLoopback = (req) => {
    const host = req.headers.host || ''
    const loopback = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)
    const origin = req.headers.origin
    return loopback && !(origin && origin !== `http://${host}` && origin !== `https://${host}`)
  }
  return createServer((req, res) => {
    const path = (req.url || '/').split('?')[0]
    const query = (req.url || '').split('?')[1] || ''

    // Choose-your-act: offer two options to pick from (does not consume the deck or cooldown).
    if (req.method === 'GET' && path === '/choice') {
      let data = null
      try {
        data = readChoice ? readChoice() : null
      } catch {
        data = null
      }
      if (!data) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, reason: 'no-city' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(data))
      return
    }

    // Live growth: the open page polls this for the current scene + readout and re-renders in place.
    if (req.method === 'GET' && path === '/state') {
      let data = null
      try {
        data = readState ? readState() : null
      } catch {
        data = null
      }
      if (!data) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, reason: 'no-city' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(data))
      return
    }

    if (req.method === 'GET' && (path === '/' || path === '/city.html')) {
      const file = join(dir, 'city.html')
      if (!existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('no city yet — is the city-keeper running?')
        return
      }
      let html
      try {
        html = readFileSync(file)
      } catch {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('could not read the city')
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(html)
      return
    }

    if (req.method === 'POST' && path === '/act') {
      if (!sameOriginLoopback(req)) {
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, reason: 'forbidden' }))
        return
      }
      let out
      try {
        const choiceId = query ? new URLSearchParams(query).get('choice') : null
        out = runAct(choiceId || undefined) // a chosen act, or undefined → a random roll
      } catch (e) {
        out = { ok: false, reason: 'error', message: String(e && e.message) }
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out ?? { ok: false, reason: 'error' }))
      return
    }

    // Pyromid: a click deposits into the datacenter's treasury (tokens burned — "pyro"), then re-renders.
    if (req.method === 'POST' && path === '/pyro') {
      if (!sameOriginLoopback(req)) {
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, reason: 'forbidden' }))
        return
      }
      let out
      try {
        out = runPyro ? runPyro() : { ok: false, reason: 'unsupported' }
      } catch (e) {
        out = { ok: false, reason: 'error', message: String(e && e.message) }
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out ?? { ok: false, reason: 'error' }))
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })
}

// Bind on a STABLE localhost port (default 8420) so the city URL survives service restarts and an
// open browser tab keeps working — an ephemeral port would change on every restart and break it.
// Falls back to the next port on a conflict. basePort 0 → ephemeral (used by tests). onReady(url,
// server) fires once listening; onFail(err) on a non-recoverable error. Never binds a public interface.
export function startCityServer({ dir, runAct, runPyro, readState, readChoice, host = '127.0.0.1', basePort = 8420, maxTries = 20, onReady, onFail }) {
  const server = createCityServer({ dir, runAct, runPyro, readState, readChoice })
  let port = basePort
  let tries = 0
  let sameTries = 0
  server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE' && port !== 0 && tries < maxTries) {
      // Keep the STABLE port across a restart overlap: retry the SAME port first (an old keeper's
      // socket frees within a second or two). Only fall forward once it is clearly taken for good —
      // a shifted port strands an already-open city tab on a dead origin (the recurring "button
      // refers to the menu" bug), so we try hard to stay on basePort.
      if (sameTries < 12) {
        sameTries += 1
        setTimeout(() => server.listen(port, host), 250)
        return
      }
      tries += 1
      sameTries = 0
      port += 1
      setTimeout(() => server.listen(port, host), 25)
    } else if (onFail) {
      onFail(e)
    }
  })
  server.on('listening', () => {
    if (onReady) onReady(`http://${host}:${server.address().port}`, server)
  })
  server.listen(port, host)
  return server
}
