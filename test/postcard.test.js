import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// Strip ESM wrapping exactly as src/artifact.js inlines the render modules into the browser bundle,
// so this test exercises the code in the same shape it actually runs inside the artifact.
const stripModule = (src) => src.replace(/^\s*import[^\n]*\n/gm, '').replace(/^export\s+/gm, '')
const source = stripModule(readFileSync(join(here, '..', 'src', 'render', 'postcard.js'), 'utf8'))

// A 2D-context stub: style assignments and drawing ops are no-ops (model on test/artifact.test.js).
function ctxStub() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'canvas') return { width: 960, height: 640 }
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} })
        return () => {}
      },
      set() {
        return true
      },
    },
  )
}

// Build a document/canvas environment, run the stripped bundle in a fresh vm context, and hand back
// the context plus a record of which encode path and download the module exercised.
// `withToBlob` toggles the preferred PNG encoder so both the toBlob and toDataURL paths are covered.
function makeEnv({ withToBlob = true } = {}) {
  const calls = { toBlob: 0, toDataURL: 0, clicks: 0, downloads: [] }
  const canvasStub = () => {
    const c = {
      width: 0,
      height: 0,
      getContext: () => ctxStub(),
      toDataURL: () => {
        calls.toDataURL++
        return 'data:image/png;base64,AAAA'
      },
    }
    if (withToBlob) {
      c.toBlob = (cb) => {
        calls.toBlob++
        cb({ size: 4 }) // invoke the callback synchronously with a fake Blob
      }
    }
    return c
  }
  const anchorStub = () => ({
    href: '',
    download: '',
    click() {
      calls.clicks++
      calls.downloads.push({ href: this.href, download: this.download })
    },
  })
  const document = {
    createElement(tag) {
      if (tag === 'canvas') return canvasStub()
      if (tag === 'a') return anchorStub()
      return {}
    },
    body: { appendChild() {}, removeChild() {} },
  }
  const URL = { createObjectURL: () => 'blob:tokenopolis', revokeObjectURL() {} }
  const context = { document, URL, setTimeout: () => 0, console }
  vm.createContext(context)
  vm.runInContext(source, context, { timeout: 2000 })
  return { context, calls }
}

const READOUT = { cityName: 'Testopolis', scaleName: 'Metropolis', population: 182340, treasury: 9910432 }

test('exportPostcard composites and triggers a PNG download via toBlob without throwing', () => {
  const { context, calls } = makeEnv({ withToBlob: true })
  const cityCanvas = { width: 960, height: 640 }
  let out
  assert.doesNotThrow(() => {
    out = context.exportPostcard(cityCanvas, READOUT)
  })
  assert.equal(out, true, 'reports that a download was triggered')
  assert.ok(calls.toBlob > 0 || calls.toDataURL > 0, 'uses toBlob or toDataURL to encode the PNG')
  assert.equal(calls.toBlob, 1, 'prefers toBlob when it is available')
  assert.ok(calls.clicks > 0, 'an <a download> was clicked')
})

test('exportPostcard falls back to toDataURL when toBlob is unavailable', () => {
  const { context, calls } = makeEnv({ withToBlob: false })
  assert.doesNotThrow(() => context.exportPostcard({ width: 960, height: 640 }, READOUT))
  assert.equal(calls.toBlob, 0)
  assert.equal(calls.toDataURL, 1, 'falls back to toDataURL')
  assert.ok(calls.clicks > 0, 'an <a download> was clicked')
})

test('exportPostcard never throws when the canvas and readout are missing', () => {
  const { context } = makeEnv()
  assert.doesNotThrow(() => context.exportPostcard(null, undefined))
})

test('exportPostcard never throws (returns false) when document is absent', () => {
  const context = { console } // no document, no URL
  vm.createContext(context)
  vm.runInContext(source, context, { timeout: 2000 })
  let out
  assert.doesNotThrow(() => {
    out = context.exportPostcard({ width: 10, height: 10 }, READOUT)
  })
  assert.equal(out, false)
})

test('cityShareText includes the city name and the seed', () => {
  const { context } = makeEnv()
  const text = context.cityShareText(READOUT, 2024)
  assert.equal(typeof text, 'string')
  assert.ok(text.includes('Testopolis'), 'includes the city name')
  assert.ok(text.includes('2024'), 'includes the seed')
})

test('cityShareText stays robust when fields and the seed are missing', () => {
  const { context } = makeEnv()
  assert.doesNotThrow(() => context.cityShareText(undefined, undefined))
  const text = context.cityShareText({ cityName: 'Burgville' }, 0)
  assert.ok(text.includes('Burgville'), 'includes the city name')
  assert.ok(text.includes('0'), 'seed 0 is still shown')
})
