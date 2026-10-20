import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { usageBurn, initClaudeOffsets, readClaudeDelta } from '../src/claude-stats.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'tokenopolis-claude-'))
const line = (inp, out, cr, cw) =>
  JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: inp, output_tokens: out, cache_read_input_tokens: cr, cache_creation_input_tokens: cw } } }) + '\n'

test('usageBurn sums the four token fields; 0 for lines without usage or bad JSON', () => {
  assert.equal(usageBurn(line(10, 20, 30, 40).trim()), 70) // 10+20+40; cache_read 30 NOT counted
  assert.equal(usageBurn(JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })), 0)
  assert.equal(usageBurn('not json'), 0)
})

test('forward-only: init skips pre-install history; delta counts only new lines', () => {
  const dir = tmp()
  const offs = join(dir, 'offsets.json')
  const proj = join(dir, 'projects', 'p1')
  mkdirSync(proj, { recursive: true })
  const f = join(proj, 's1.jsonl')
  writeFileSync(f, line(1000, 2000, 0, 0)) // pre-install history (3000 tokens) — must NOT be counted

  initClaudeOffsets(offs, join(dir, 'projects'))
  assert.equal(readClaudeDelta(offs, join(dir, 'projects')), 0, 'history is skipped')

  appendFileSync(f, line(10, 90, 100, 0)) // 100 new tokens (cache_read 100 NOT counted)
  assert.equal(readClaudeDelta(offs, join(dir, 'projects')), 100)
  assert.equal(readClaudeDelta(offs, join(dir, 'projects')), 0, 'no further change → 0')
})

test('a transcript created AFTER init is counted in full', () => {
  const dir = tmp()
  const offs = join(dir, 'offsets.json')
  const proj = join(dir, 'projects', 'p1')
  mkdirSync(proj, { recursive: true })
  initClaudeOffsets(offs, join(dir, 'projects')) // no transcripts yet
  writeFileSync(join(proj, 'new.jsonl'), line(5, 5, 0, 0) + line(0, 0, 10, 0)) // 10 + 0 (cache_read 10 not counted)
  assert.equal(readClaudeDelta(offs, join(dir, 'projects')), 10)
})

test('missing projects dir → 0, never throws', () => {
  const dir = tmp()
  assert.equal(readClaudeDelta(join(dir, 'offsets.json'), join(dir, 'does-not-exist')), 0)
})
