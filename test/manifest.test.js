import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse } from 'smol-toml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = parse(readFileSync(join(root, 'cornercase-plugin.toml'), 'utf8'))

const VALID_EVENTS = new Set(['opened', 'closed', 'status', 'exited'])

test('required top-level keys present and well-formed', () => {
  for (const k of ['id', 'name', 'version']) {
    assert.ok(typeof manifest[k] === 'string' && manifest[k].length > 0, `manifest.${k} must be a non-empty string`)
  }
  assert.match(manifest.id, /^[a-z0-9._-]{1,64}$/, 'id must be lowercase letters/digits/._- and <= 64 chars')
})

test('every service/events/actions command is an argv array, never a shell string', () => {
  const entries = [
    ...(manifest.service ?? []).map((s) => ['service', s]),
    ...(manifest.events ?? []).map((e) => ['events', e]),
    ...(manifest.actions ?? []).map((a) => ['actions', a]),
    ...(manifest.window ?? []).map((w) => ['window', w]),
  ]
  assert.ok(entries.length > 0, 'expected at least one service/events/actions entry')
  for (const [section, entry] of entries) {
    assert.ok(
      Array.isArray(entry.command) &&
        entry.command.length > 0 &&
        entry.command.every((part) => typeof part === 'string'),
      `${section}.command must be an argv array, never a shell string`,
    )
  }
})

test('every events.on is one of opened/closed/status/exited', () => {
  for (const e of manifest.events ?? []) {
    assert.ok(VALID_EVENTS.has(e.on), `events.on "${e.on}" must be one of ${[...VALID_EVENTS].join(', ')}`)
  }
})
