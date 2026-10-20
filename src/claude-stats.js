// Claude Code (desktop/CLI) usage adapter. Counts your Claude burn FORWARD from install by tracking
// each transcript's byte offset — so it only reads NEW lines, never re-scans the whole history. It
// extracts ONLY the token numbers from each line's `usage` object; it never reads, stores, or logs
// your conversation text, and nothing ever leaves the machine.
//
// It reads ~/.claude/projects explicitly (the DESKTOP Claude Code data dir) — NOT $CLAUDE_CONFIG_DIR,
// which cornercase overrides to its own account dirs; those agents are already counted by
// `cornercase stats`, so this avoids double-counting. Never throws.

import { readdirSync, statSync, openSync, readSync, closeSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const claudeProjectsDir = () => join(homedir(), '.claude', 'projects')

// cache_read_input_tokens (re-read context) is EXCLUDED — it dwarfs real work (~94%). Burn = new
// tokens only: input + output + cache_creation (cache_write).
const TOKEN_KEYS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens']

function listTranscripts(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out // dir missing (e.g. CI) → no Claude usage
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...listTranscripts(p))
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

// Sum the token usage on one JSONL line. Numbers only — the rest of the line (your content) is ignored.
export function usageBurn(line) {
  let obj
  try {
    obj = JSON.parse(line)
  } catch {
    return 0
  }
  const u = obj && obj.message && obj.message.usage
  if (!u) return 0
  let sum = 0
  for (const k of TOKEN_KEYS) {
    const v = u[k]
    if (typeof v === 'number' && Number.isFinite(v)) sum += v
  }
  return sum
}

function loadOffsets(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}
function saveOffsets(path, offsets) {
  try {
    writeFileSync(path, JSON.stringify(offsets), { mode: 0o600 })
  } catch {
    /* best effort */
  }
}

// Record current sizes so pre-install history is NOT counted (grow-from-zero for Claude usage).
export function initClaudeOffsets(offsetsPath, dir = claudeProjectsDir()) {
  const offsets = {}
  for (const f of listTranscripts(dir)) {
    try {
      offsets[f] = statSync(f).size
    } catch {
      /* skip */
    }
  }
  saveOffsets(offsetsPath, offsets)
}

// Return the Claude burn DELTA since the last call: sum of token usage in bytes appended since each
// transcript's stored offset. Updates the offsets. Never throws (returns 0 on any failure).
export function readClaudeDelta(offsetsPath, dir = claudeProjectsDir()) {
  try {
    const offsets = loadOffsets(offsetsPath)
    let delta = 0
    for (const f of listTranscripts(dir)) {
      let size
      try {
        size = statSync(f).size
      } catch {
        continue
      }
      const prev = offsets[f] ?? 0
      if (size <= prev) {
        if (size < prev) offsets[f] = size // file rotated/truncated — resync, don't recount
        continue
      }
      const len = size - prev
      const buf = Buffer.allocUnsafe(len)
      let fd
      try {
        fd = openSync(f, 'r')
        readSync(fd, buf, 0, len, prev)
      } catch {
        continue
      } finally {
        if (fd !== undefined) closeSync(fd)
      }
      const text = buf.toString('utf8')
      const lastNl = text.lastIndexOf('\n')
      if (lastNl < 0) continue // no complete new line yet; leave offset, retry next tick
      const complete = text.slice(0, lastNl)
      for (const line of complete.split('\n')) if (line) delta += usageBurn(line)
      offsets[f] = prev + Buffer.byteLength(complete, 'utf8') + 1 // advance past the last newline
    }
    saveOffsets(offsetsPath, offsets)
    return delta
  } catch {
    return 0
  }
}
