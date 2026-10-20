# `cornercase stats --json` contract (T-001)

Pinned against **cornercase 0.12.154** (`/opt/homebrew/bin/cornercase`) on 2026-10-19.
`cornercase stats --help`: "Print every counter and the heatmap blocks as JSON ... With no
server, reads stats.json." So `--json` runs without a server. Counts are **numbers only** — no
prompts, models, paths, or conversation ids (platform guarantee).

## Shape we depend on

```
{
  "since": "<ISO-8601 string>",          // when counting started (install baseline references this)
  "windows": {
    "24h":   { "tokens": { "in": <n>, "out": <n>, "cache_read": <n>, "cache_write": <n> }, ... },
    "7d":    { "tokens": { "in": <n>, "out": <n>, "cache_read": <n>, "cache_write": <n> }, ... },
    "total": { "tokens": { "in": <n>, "out": <n>, "cache_read": <n>, "cache_write": <n> }, ... }
  },
  "blocks": [ ... ],                      // heatmap buckets — NOT needed (windows are direct)
  "merged_pull_requests": { ... }         // ignored
}
```

Each window also carries `agents, prompts, turns, agent_seconds, waited_seconds, busy_seconds,
most_at_once, by_agent{<agent>: {...}}`. We read **only** `windows.{total,24h,7d}.tokens`.

### Fields `src/stats.js` (T-004) consumes — and nothing else downstream names

| Path | Meaning |
|---|---|
| `windows.total.tokens.{in,out,cache_read,cache_write}` | lifetime totals → built potential |
| `windows.24h.tokens.{in,out,cache_read,cache_write}`   | short-window vitality |
| `windows.7d.tokens.{in,out,cache_read,cache_write}`    | trend vitality + decay-clock input |
| `since` | counting-start timestamp (informational) |

### Burn definition

`burn = in + out + cache_read + cache_write` (sum of **all four** token counters), applied
identically to each window. Rationale: the spec's "the more you burn" reads most literally as all
tokens; it keeps the number large and always-increasing with use. Note `cache_read` dominates in
practice (≈99% of the total), so the city effectively tracks total activity volume — fine for a
toy. If we later want a "generation-focused" feel, the weighting is a one-line change isolated to
`src/stats.js` / `src/tuning.js`; the rest of the system only sees the normalized scalar.

Windows are present directly, so **no hourly-bucket (`blocks`) derivation is needed** for 24h/7d.

## Failure-mode probe (recorded)

`node scripts/assert-stats-shape.mjs <file>` validates a saved JSON file; against a copy of the
fixture with `windows.total.tokens.out` deleted it exits **1** with:

```
FAIL: stats contract violated:
  - windows.total.tokens.out: expected number
```

Against the live CLI with no args it exits **0** (`OK: cornercase stats --json contract
satisfied ...`). A field rename in a future cornercase upgrade therefore fails loud here (and in
`src/stats.js`, which returns `null` → the service holds last-known state, never corrupts).

## Fixture note (deviation from the task text — intentional)

`test/fixtures/stats.live.json` is **shape-faithful with synthetic numbers**, not a verbatim dump
of this machine's real usage. This folder is published as a public repo (T-015), and the user's
actual token counts should not ship in it. The live contract is pinned above and re-checked on
demand by `assert-stats-shape.mjs` against the real CLI.
