# Tokenopolis — Review (2026-10-20)

Adversarial multi-agent review: 6 dimensions (sim, state, artifact, service, privacy, spec) find
defects → 2 skeptics refute each. 18 agents. **0 blockers.** 6 raw findings → **5 confirmed, 1
refuted**. All 5 confirmed findings FIXED; full suite **66/66**.

## Confirmed & fixed

### Major
1. **First-run baseline-0 on a null stats read** (`service/main.js`) — found independently by the
   `service` AND `spec` dimensions; both skeptics confirmed. If `cornercase stats` failed on the very
   first run, `ensureState` persisted `baselineLifetimeTokens = 0`, so the next successful read
   counted the entire machine lifetime (~18.8M+) as "built since install" — permanently defeating
   grow-from-zero (clarify #8 + the spec amendment). Uncaught because every smoke has stats available.
   **Fix:** `ensureState` now DEFERS (logs, creates no state, returns `false`) when the first read
   fails; `run()` retries each tick; the baseline is captured only from a real read. Regression tests
   in `test/service.test.js` (null → defer with no state; success → baseline; null-then-success →
   baseline from the success, never 0).

2. **Infrastructure / roads never rendered** (`src/render/draw.js`) — the scene computed an
   `infrastructure` block but `drawCity` discarded it; the `road` color was dead in every theme; roads
   (spec §3's first tier) were absent from the model. The shareable artifact showed no streets or tier
   progression.
   **Fix:** added `roads` to the scene; `drawCity` draws a road grid connecting the zones (new `roads`
   z-layer) plus one accent pip per unlocked higher tier (power/water/transit/data). Verified in the
   gallery; `test/draw.test.js` asserts the pip count per scale and that roads stroke.

### Minor
3. **`tick.js` logged `rendered.sim.scaleName`** — never set on the sim object → always blank (a
   double space in `plugin.log`). **Fix:** import `scaleName`, log `scaleName(rendered.sim.scaleIndex)`.
4. **Window twinkle frozen** (`draw.js` `lit()`) — `tick*5 % 5` is always 0, so windows never
   animated; only the crane moved. **Fix:** multiplier coprime to the modulus (`+ tick`); the draw
   test now guards the window lit-set changing across ticks, not just the crane.

## Refuted (no action)
- **"burn24h/burn7d unused collapses the magnitude gradient"** (spec dimension) — both skeptics
  refuted: `economyFor` scales population/treasury/economyRating with `builtTokens` (the running
  lifetime-since-install sum), so burn magnitude IS reflected in prosperity. The windows are reserved
  inputs by design (recorded deviation in T-005).

## Verification
All 4 fixes are covered by new/updated tests (66/66 green). Gallery and the real-CLI e2e smoke were
re-verified after the renderer + service changes (grow-from-zero intact, LOD max 622). The OWED
pre-publish live-platform smoke (T-015) is unchanged.
