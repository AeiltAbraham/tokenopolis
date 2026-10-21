// Local-only HTTP bridge so the in-city "A Random Act" button can actually TRIGGER an act — a browser
// page can't spawn a process. Binds 127.0.0.1 on an ephemeral port, serves the current city.html, and
// exposes POST /act which runs ONE act (cooldown-checked) via the injected runAct, then re-renders.
// Nothing is exposed off the machine; cross-origin POSTs are refused (a stray web page can't roll acts).

import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export function createCityServer({ dir, runAct, readState, readChoice }) {
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
      // CSRF guard: a same-origin fetch sends Origin === our own; a cross-site page sends a different
      // one. Refuse the mismatch so a random web page the user visits can't trigger city events.
      const origin = req.headers.origin
      const host = req.headers.host
      if (origin && host && origin !== `http://${host}` && origin !== `https://${host}`) {
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

    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })
}

// Bind on a STABLE localhost port (default 8420) so the city URL survives service restarts and an
// open browser tab keeps working — an ephemeral port would change on every restart and break it.
// Falls back to the next port on a conflict. basePort 0 → ephemeral (used by tests). onReady(url,
// server) fires once listening; onFail(err) on a non-recoverable error. Never binds a public interface.
export function startCityServer({ dir, runAct, readState, readChoice, host = '127.0.0.1', basePort = 8420, maxTries = 20, onReady, onFail }) {
  const server = createCityServer({ dir, runAct, readState, readChoice })
  let port = basePort
  let tries = 0
  server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE' && port !== 0 && tries < maxTries) {
      tries += 1
      port += 1
      setTimeout(() => server.listen(port, host), 25) // try the next port
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
