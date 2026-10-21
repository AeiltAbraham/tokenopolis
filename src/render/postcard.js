// Export / share "postcard": composite the live city canvas + a footer band into a downloadable PNG,
// and a short shareable caption. Browser-inlined alongside themes.js + draw.js (import lines dropped,
// leading `export ` stripped by src/artifact.js), so NO imports and NO Node APIs — only the DOM and
// the 2D canvas, and EVERY access is guarded so a missing document / canvas / encoder never throws.

const FOOTER_H = 132

const fmt = (n) => {
  const v = Number(n)
  return Number.isFinite(v) ? String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '—'
}

// A filesystem-safe basename from the city's name (always non-empty).
const slug = (name) =>
  String(name || 'tokenopolis')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tokenopolis'

// Build a transient <a download> and click it. Best-effort: a missing document / anchor / click is a no-op.
function triggerDownload(href, filename) {
  try {
    const a = document.createElement('a')
    if (!a) return
    a.href = href
    a.download = filename
    if (document.body && document.body.appendChild) document.body.appendChild(a)
    if (typeof a.click === 'function') a.click()
    if (a.parentNode && a.parentNode.removeChild) a.parentNode.removeChild(a)
  } catch (e) {
    // download is a courtesy — never throw out of it
  }
}

// Encode the composited canvas to PNG and hand it to the browser. Prefers toBlob (lower memory),
// falls back to toDataURL. Returns whether an encode path was taken.
function saveCanvas(canvas, filename) {
  if (canvas && typeof canvas.toBlob === 'function') {
    canvas.toBlob((blob) => {
      try {
        if (!blob) return
        const hasUrl = typeof URL !== 'undefined' && URL && typeof URL.createObjectURL === 'function'
        const url = hasUrl ? URL.createObjectURL(blob) : null
        if (!url) return
        triggerDownload(url, filename)
        if (URL.revokeObjectURL) {
          const revoke = () => {
            try {
              URL.revokeObjectURL(url)
            } catch (e) {
              // ignore
            }
          }
          if (typeof setTimeout === 'function') setTimeout(revoke, 4000)
          else revoke()
        }
      } catch (e) {
        // encode/download best-effort
      }
    }, 'image/png')
    return true
  }
  if (canvas && typeof canvas.toDataURL === 'function') {
    try {
      triggerDownload(canvas.toDataURL('image/png'), filename)
      return true
    } catch (e) {
      return false
    }
  }
  return false
}

// Paint the footer band under the city: name + scale on the left, population + treasury on the right,
// and the "built with Tokenopolis" signature. Pure drawing — style ops are safe against a stub ctx.
function drawFooter(ctx, r, w, top) {
  ctx.fillStyle = '#12151d'
  ctx.fillRect(0, top, w, FOOTER_H)
  ctx.fillStyle = '#2f6bff'
  ctx.fillRect(0, top, w, 3) // accent rule along the band's top edge

  const pad = 28
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = '#e8ecf2'
  ctx.textAlign = 'left'
  ctx.font = '700 30px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(String(r.cityName || 'My Tokenopolis'), pad, top + 48)

  ctx.fillStyle = '#9aa6bd'
  ctx.font = '400 16px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(String(r.scaleName || ''), pad, top + 74)

  ctx.fillStyle = '#9aa6bd'
  ctx.font = '400 13px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('built with Tokenopolis', pad, top + FOOTER_H - 18)

  ctx.textAlign = 'right'
  ctx.fillStyle = '#e8ecf2'
  ctx.font = '600 20px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('Population ' + fmt(r.population), w - pad, top + 48)
  ctx.fillText('Treasury §' + fmt(r.treasury), w - pad, top + 74)
}

// Composite the live city canvas plus the footer band onto an offscreen canvas and trigger a PNG
// download. Returns true when an encode/download path was taken, false otherwise. Never throws.
export function exportPostcard(cityCanvas, readout) {
  try {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false
    const r = readout || {}
    const srcW = (cityCanvas && cityCanvas.width) || 960
    const srcH = (cityCanvas && cityCanvas.height) || 640

    const out = document.createElement('canvas')
    if (!out) return false
    out.width = srcW
    out.height = srcH + FOOTER_H
    const ctx = typeof out.getContext === 'function' ? out.getContext('2d') : null
    if (!ctx) return false

    ctx.fillStyle = '#0b0d13' // matches the artifact's stage backdrop
    ctx.fillRect(0, 0, out.width, out.height)
    if (cityCanvas) {
      try {
        ctx.drawImage(cityCanvas, 0, 0, srcW, srcH)
      } catch (e) {
        // a tainted / unsized source canvas should not abort the postcard
      }
    }
    drawFooter(ctx, r, srcW, srcH)

    return saveCanvas(out, slug(r.cityName) + '-tokenopolis.png')
  } catch (e) {
    return false
  }
}

// A short, shareable caption. Always includes the city name and the seed, degrades gracefully when
// other readout fields are missing.
export function cityShareText(readout, seed) {
  const r = readout || {}
  const name = String(r.cityName || 'My Tokenopolis')
  const seedStr = seed === undefined || seed === null || seed === '' ? 'unknown' : String(seed)
  const parts = [name]
  if (r.scaleName) parts.push('a ' + r.scaleName)
  if (r.population !== undefined && r.population !== null) parts.push('pop. ' + fmt(r.population))
  return parts.join(' — ') + ' · seed ' + seedStr + ' · built with Tokenopolis'
}
