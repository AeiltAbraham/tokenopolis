// Local-only HTTP bridge so the in-city "A Random Act" button can actually TRIGGER an act — a browser
// page can't spawn a process. Binds 127.0.0.1 on an ephemeral port, serves the current city.html, and
// exposes POST /act which runs ONE act (cooldown-checked) via the injected runAct, then re-renders.
// Nothing is exposed off the machine; cross-origin POSTs are refused (a stray web page can't roll acts).

import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export function createCityServer({ dir, runAct }) {
  return createServer((req, res) => {
    const path = (req.url || '/').split('?')[0]

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
        out = runAct()
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

// Bind on an ephemeral localhost port. onReady(url, server) fires once listening; onFail(err) on error.
// Returns the server so the caller can close() it. Never binds a public interface.
export function startCityServer({ dir, runAct, host = '127.0.0.1', onReady, onFail }) {
  const server = createCityServer({ dir, runAct })
  if (onFail) server.on('error', onFail)
  server.listen(0, host, () => {
    if (onReady) onReady(`http://${host}:${server.address().port}`, server)
  })
  return server
}
