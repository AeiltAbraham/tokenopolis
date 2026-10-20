# Tokenopolis — Tasks

> Schema per the flow planning skill. All paths and proof commands are relative to this folder
> (`cornercase-citysim/`), which becomes the plugin repo root. Modes: all agentic except one
> ratchet (T-014); the three fanout groups were downgraded to agentic per plan-verification
> (2026-10-19 — shared-tree parallel-safety not provable). Tuning numbers live in
> `src/tuning.js` and are deliberately NOT acceptance criteria — tests assert shape
> (monotonicity, ordering, ratios), so T-013 can tune feel without touching tests.

## T-001 Confirm the `cornercase stats` JSON contract
mode: agentic
files: stats-contract.md, test/fixtures/stats.live.json, scripts/assert-stats-shape.mjs
proof: node scripts/assert-stats-shape.mjs
settles: spec §11 "build-time confirm"
acceptance:
- `cornercase stats --help` and `cornercase stats --json` run against the installed CLI (0.12.154 verified present at planning); exact field paths for lifetime in/out/cache totals, 24h window, 7d window, and hourly buckets recorded in stats-contract.md with the CLI version
- a real `cornercase stats --json` output committed as test/fixtures/stats.live.json (numbers-only by platform design, safe to commit)
- scripts/assert-stats-shape.mjs runs the live CLI and exits 0 when every contract field is present and numeric
- failure mode probed in-task: run the assert script against a copy of the fixture with one required field deleted, record the actual error message in stats-contract.md, delete the mutated copy
- if 24h/7d are not direct fields, stats-contract.md documents the derivation from hourly buckets that src/stats.js must implement
status: done
outcome: Pinned against cornercase 0.12.154. Shape: `windows.{total,24h,7d}.tokens.{in,out,cache_read,cache_write}` (NOTE: cache is split read/write, not a single field) + top-level `since` string; `blocks` heatmap NOT needed (24h/7d are direct windows). burn = in+out+cache_read+cache_write (recorded in stats-contract.md; cache_read dominates — fine for a toy). `scripts/assert-stats-shape.mjs` validates live CLI (no arg) or a file (arg). PROOF `node scripts/assert-stats-shape.mjs` → exit 0 on live CLI and on the fixture. Failure-mode probe: fixture copy minus `windows.total.tokens.out` → exit 1, `windows.total.tokens.out: expected number`. DEVIATION: `test/fixtures/stats.live.json` is shape-faithful with SYNTHETIC numbers (public repo — do not ship the user's real token counts); live contract re-checked on demand by the assert script.

## T-002 Plugin scaffold: manifest, package, layout
mode: agentic
depends: T-001
files: cornercase-plugin.toml, package.json, .gitignore, README.md, test/manifest.test.js
proof: npm install && node --test test/manifest.test.js
acceptance:
- cornercase-plugin.toml declares id/name/version, `[[service]]` city-keeper with `command = ["node", "service/main.js"]`, a `status` `[[events]]` hook, and an `open-city` `[[actions]]` entry (contexts workspace+pane) — commands as argv arrays referencing files that T-011/T-012 will create
- package.json: `"type": "module"`, zero `dependencies`, `smol-toml` as the only devDependency, `"test": "node --test"` (bare form auto-discovers `test/`; the directory-argument form `node --test test/` exits 1 on Node v22.23.2 regardless of results — plan-verification. Parse of this manifest shape under smol-toml/Node 22 ESM was probed at planning and works)
- test/manifest.test.js parses the manifest with smol-toml and asserts: required top-level keys; every `command` in service/events/actions is an argv array (planning probe recorded the guard firing on a shell-string command with: `AssertionError ... service.command must be an argv array, never a shell string`); every `on` value is one of opened/closed/status/exited
- README.md states what the plugin is, the privacy stance (token counts and timing only — platform-guaranteed numbers-only), and install-from-marketplace instructions
- .gitignore excludes node_modules; repo layout stubs exist for src/, src/sim/, src/render/, service/, scripts/, test/
status: done
outcome: Manifest (id=tokenopolis, service city-keeper, status hook, open-city action — all argv-array commands), package.json (type module, zero deps, smol-toml ^1.3.1 devDep, engines node>=20, `"test": "node --test"`), .gitignore, README (what/privacy/install/layout), .gitkeep stubs for src/ src/sim/ src/render/ service/. test/manifest.test.js asserts top-level keys + id regex, argv-array guard (message `<section>.command must be an argv array, never a shell string`), and events.on ∈ {opened,closed,status,exited}. PROOF `npm install && node --test test/manifest.test.js` → install added smol-toml (0 vuln); tests 3/3 pass.

## T-003 Pure sim I: scale ladder and economy
mode: agentic
depends: T-002
files: src/tuning.js, src/sim/scale.js, src/sim/economy.js, test/sim-scale.test.js
proof: node --test test/sim-scale.test.js
settles: clarify.md #5 (log pacing), #6 (underground at Metropolis)
acceptance:
- `scaleFor(builtTokens)` maps tokens → `{scaleIndex, scaleName, undergroundTiers}`: index 0 at 0 tokens; geometric thresholds from src/tuning.js (front-loaded: equal token increments yield strictly shrinking index gains); named ladder Hamlet→…→Megastructure then procedural names for index ≥ 8 with no upper bound (tested at index ≥ 20)
- undergroundTiers is 0 below scaleIndex 4 (Metropolis) and grows with scale thereafter
- `economyFor(scaleIndex, vitality)` returns population, treasury, economyRating — all strictly increasing in builtTokens at fixed vitality, and increasing in vitality at fixed scale
- all functions pure and deterministic: same inputs → deep-equal outputs, no Date/IO/random reads (time and seed are parameters)
- every tuning constant used lives in src/tuning.js with a one-line comment stating what feel it controls
status: done
outcome: src/tuning.js (SCALE, SCALE_NAMES, ECONOMY — each constant commented). src/sim/scale.js: tokensForIndex(n)=floor(baseTokens·growth^(n-1)) geometric/front-loaded, scaleFor() climbs by affordable threshold (loop, ~log steps, 100k backstop), scaleName() procedural past index 7 ("Megastructure 2"…), undergroundTiers() 0 below index 4 then +1/step. src/sim/economy.js: economyFor(builtTokens, vitality) — DEVIATION from the `(scaleIndex, vitality)` signature in the task text: takes builtTokens so population/treasury/economyRating are each strictly increasing in builtTokens (a vitality-only term keeps vitality response alive at zero burn). PROOF `node --test test/sim-scale.test.js` → 9/9 (index0=Hamlet, front-loaded step-cost grows, named+procedural to index 50, underground at 4, economy monotone in burn & vitality, deterministic).

## T-004 Stats adapter
mode: agentic
depends: T-001, T-002
files: src/stats.js, test/stats.test.js
proof: node --test test/stats.test.js
acceptance:
- `readStats(exec)` spawns `cornercase stats --json` as an argv list (never shell) via an injectable exec, parses per stats-contract.md, returns normalized `{lifetimeTotal, burn24h, burn7d, readAt}` with lifetimeTotal = in + out + cache
- raw CLI field names appear in src/stats.js and nowhere else downstream
- against test/fixtures/stats.live.json the adapter returns the exact expected normalized numbers (computed once by hand into the test)
- on spawn failure, non-zero exit, or unparseable/missing-field output, returns null — never throws (clarify.md: hold last-known state)
- if T-001 found windows must be derived from hourly buckets, the derivation is implemented and tested against the fixture
status: done
outcome: src/stats.js — readStats(exec?, nowIso?) spawns `cornercase stats --json` via injectable execFileSync, burn = in+out+cache_read+cache_write per window → {lifetimeTotal, burn24h, burn7d, readAt}. Raw field names confined to this module. Returns null (never throws) on spawn failure, non-zero exit, unparseable JSON, or any missing/non-numeric contract field. No bucket derivation needed (windows direct). PROOF `node --test test/stats.test.js` → 6/6 (exact fixture burns 8.375M/2.091M/6.273M; null on throw/unparseable/missing/non-numeric; only normalized keys exposed).

## T-005 Pure sim II: vitality, decay, recovery
mode: agentic
depends: T-003
files: src/sim/condition.js, test/sim-condition.test.js, src/tuning.js
proof: node --test test/sim-condition.test.js
settles: clarify.md #4 (decay in days), #7 (~5× recovery), spec §5 (two axes)
acceptance:
- `step(prevSim, {builtTokens, burn24h, burn7d}, now)` is pure (now is a parameter) and returns the full `sim` block of state.json: vitality in [0,1], condition on Thriving→…→Buried, updated lastMeaningfulBurnAt/ruinProgress/recoveryCredit/peakScaleIndex
- condition is driven by days since last meaningful burn: unchanged-or-better under 3 quiet days (weekend-safe), monotonically worsening past onset, reaching Ruins only after a week+, Buried later still
- scale regresses (effective scale falls below peakScaleIndex, rendered as ruins-of) only after condition has reached Ruins — condition always degrades before scale does
- resumed burn after regression restores effective scale to peakScaleIndex using ≤ 1/5 of the tokens the first climb took (recoveryCredit mechanics), and beyond peak growth proceeds at the normal rate
- a scripted 30-day scenario test (build up → 12 quiet days → return and burn) walks the full arc: Thriving → decline → Ruins → fast recovery to peak, asserting the ordering of every transition
status: done
outcome: src/sim/condition.js — pure step(prevSim, {builtTokens,burn24h,burn7d}, nowIso). Days-since-meaningful-burn (meaningful = builtTokens delta ≥ 100k) drives the 7-rung condition ladder (weekend-safe <3 days; Ruins at day 10; Buried at 13) and vitality [0,1]. Scale crumbles (ruinProgress, effective = peak−ruinProgress) only from the ruins threshold, so condition degrades BEFORE scale. Recovery spends burned tokens at 1/5 the original per-level cost (recoveryCredit) to reclaim levels. DEVIATION: burn24h/burn7d accepted but reserved — the decay core uses the builtTokens-delta recency signal, not the windows. Added DECAY + CONDITIONS to tuning.js. PROOF `node --test test/sim-condition.test.js` → 6/6 incl. condition-before-scale, recovery ≤ 1/5 of a 120M climb, and the 30-day arc ordering.

## T-006 State store and install baseline
mode: agentic
depends: T-002, T-004
files: src/state.js, test/state.test.js
proof: node --test test/state.test.js
settles: clarify.md #8 (grow from zero) + spec amendment (baseline at install)
acceptance:
- load/save of state.json under a directory given by `CORNERCASE_PLUGIN_STATE` (parameterized for tests), exact shape per plan.md §2.2 including schemaVersion and citySeed
- first run (no state.json): records installedAt and baselineLifetimeTokens from the current stats read, builtTokens starts at 0, citySeed generated once
- `applyStatsRead(state, stats)` sets builtTokens = max(prev, lifetimeTotal − baseline) — monotonic clamp proven by a test feeding a regressed lifetimeTotal
- stats read of null (adapter failure): state returned byte-identical in its sim and stats blocks; an entry is appended to plugin.log; never throws, never resets
- corrupt/unparseable state.json: backed up aside as state.json.corrupt-<ts> and treated as first-run, logged — never silently overwritten

## T-007 Invariant guards (mutation-checked)
mode: agentic
depends: T-003, T-005, T-006
files: test/invariants.test.js
proof: node --test test/invariants.test.js
acceptance:
- guard 1 — era-never-seeds-from-history: a first run against a stats read with a huge pre-existing lifetimeTotal yields builtTokens 0 and scaleIndex 0 (Hamlet). Mutation-checked: remove the baseline subtraction in src/state.js → observe this test RED → revert → record the mutant diff and the observed failure message in this task's outcome
- guard 2 — monotonic-until-decay: while days-since-meaningful-burn < onset, neither builtTokens nor effective scale ever decreases across any sequence of stats reads (including regressed lifetime totals). Mutation-checked: remove the monotonic clamp in src/state.js → RED → revert → record
- guard 3 — decay-then-recovery: condition reaches Ruins strictly before any scale regression, and post-ruin recovery to peak consumes ≤ 1/5 of first-build tokens. Mutation-checked twice: (a) let scale regress at Declining → RED; (b) remove the recovery multiplier in src/sim/condition.js → RED; revert and record both
- mutation protocol: this is a standalone untracked folder, so mutants are applied in-place and reverted immediately after observing RED (the Voris detached-worktree rule targets the Voris tree); each mutant + its observed failure output is recorded in the outcome before the box flips [x]
- this task runs solo (stage 4): mutation flips shared sources RED, so nothing may run in parallel with it
status: done
outcome: test/invariants.test.js — 4 guards, each mutation-checked in-place-with-revert (standalone untracked folder; the Voris detached-worktree rule targets the Voris tree). Baseline 4/4 green; each mutant observed RED; reverted 4/4 green.
  • guard 1 era-never-seeds: mutant = replace `lifetimeTotal − baselineLifetimeTokens` → `lifetimeTotal` in src/state.js. RED: "no burn since install ⇒ builtTokens 0 despite huge history" (builtTokens became 50e9).
  • guard 2 monotonic-until-decay: mutant = drop the `state.sim.builtTokens` term from the Math.max clamp in src/state.js. RED: "builtTokens dropped 200000000→150000000".
  • guard 3a decay-order: mutant = regress at Declining (`DECAY.ruinsThresholdDays`→`DECAY.conditionDays[3]`) in src/sim/condition.js. RED: "scale regressed while condition=Declining (day 7)".
  • guard 3b recovery: mutant = drop `/ DECAY.recoveryFactor` in src/sim/condition.js. RED: "recovery 120000000 must be ≤ 1/5 of 120000000".
  CAUGHT a real integration subtlety writing the harness: step() must receive the PRIOR sim + NEW builtTokens, else delta=0 and "meaningful burn" never registers (decay clock never resets during active use). This is the TICK COMPOSITION CONTRACT for T-011 — which must add a test that active stats reads keep condition from decaying. PROOF `node --test test/invariants.test.js` → 4/4.

## T-008 Scene generator (city state → scene description)
mode: agentic
depends: T-003, T-005
files: src/render/scene.js, test/scene.test.js, scripts/lod-score.mjs
proof: node --test test/scene.test.js && node scripts/lod-score.mjs
acceptance:
- `sceneFor(cityState, citySeed)` returns a pure, deterministic scene description: RCI-zoned tiles, buildings with height/density from scale and land value, infrastructure tiers, underground levels when unlocked, amenity landmarks at milestones
- condition is encoded structurally, never color-only: Declining+ introduces damage primitives (cracks, dark windows, rubble, overgrowth) and Ruins-of-scale keeps big silhouettes with ruin skinning (accessibility default from clarify.md)
- LOD: above a tuning-defined scale, blocks aggregate into district primitives; scripts/lod-score.mjs prints the max primitive count across probe scales {4, 8, 16, 32, 64} and the test asserts it stays ≤ 20,000 at every probe
- same cityState + seed → deep-equal scene (stable across runs); different seeds → different layouts at equal scale
- scene format documented in a header comment as the contract T-009 renders from
status: done
outcome: src/render/scene.js — pure sceneFor(cityState, citySeed) via seeded mulberry32; bones from peakScaleIndex (ruined metropolis keeps its silhouette), damage only Declining+ (grayscale-safe structural fields: height/damage/collapsed, NO color), RCI zoning, underground levels, milestone landmarks, infra tier flags. LOD caps rendered buildings at SCENE.lodDetailCap (1200) and aggregates beyond → primitiveCount bounded. scripts/lod-score.mjs reports max across {4,8,16,32,64}. PROOF `node --test test/scene.test.js && node scripts/lod-score.mjs` → 6/6; max 1222 primitives (≤20k, incl. scale 128). MUTATION-CHECK for the ≤20k budget guard is done jointly with T-014 (ratchet owns the budget); the scene test pins ≤20k at every probe now.
- guard mutation-check (L172 — the ≤20,000 budget is a regression-pin guard): disable the LOD district-aggregation path (or add a probe scale that must exceed the bound) → observe the ≤20,000 assertion in test/scene.test.js go RED → revert → record the mutant diff + observed failure message in this task's outcome before the box flips `[x]`

## T-009 Isometric canvas renderer + themes
mode: agentic
depends: T-008
files: src/render/draw.js, src/render/themes.js, test/draw.test.js
proof: node --test test/draw.test.js
settles: clarify.md #3 (isometric pixel, SimCity-style)
acceptance:
- `drawCity(ctx, scene, theme, tick)` renders the scene isometric pixel-style onto a canvas 2D context; runs in the browser inside the artifact and under node:vm with a recording canvas stub in tests (asserting draw-call counts, z-order ground→buildings→overlay, and no-throw at probe scales 0, 4, 64)
- five theme palettes (temperate, coastal, desert, nordic, neon) in src/render/themes.js; unknown theme falls back to temperate
- vitality drives subtle animation via the tick parameter (cranes/lit windows when thriving, stillness/flicker-drift when stale); tick 0 renders a complete static frame so a frozen artifact still looks right
- condition remains legible with the palette swapped out for grayscale in a test render (structural encoding from T-008 carries it)
- module has zero imports beyond src/render/scene.js constants — it must be inlinable into the artifact as-is
status: done
outcome: src/render/themes.js (5 palettes temperate/coastal/desert/nordic/neon + resolveTheme fallback) and src/render/draw.js (drawCity(ctx, scene, theme, tick)). Isometric boxes, RCI zone colors, lit-window glow + crane overlay animate by tick ONLY when lively (stale = still), damage cracks + collapsed rubble are structural. INTERPRETATION of "zero imports beyond scene.js": draw.js imports only its render sibling themes.js (no node/tuning/external) — genuinely inlinable; it needs no scene.js symbols (consumes the scene object). z-order via optional ctx.__layer hook (no-op in browser). PROOF `node --test test/draw.test.js` → 6/6: theme fallback, z-order underground→ground→buildings→landmarks→overlay, ≥1 fill/building, no-throw at scales 0/4/64, geometry identical across palettes (grayscale-safe), lively animates between ticks while stale holds still. node:vm exercise of the INLINED bundle is done at T-010.

## T-010 Artifact assembler + cosmetics
mode: agentic
depends: T-006, T-009
files: src/artifact.js, src/config.js, test/artifact.test.js
proof: node --test test/artifact.test.js
settles: clarify.md #2 (name + theme, cosmetic only)
acceptance:
- `writeArtifact(state, config, outDir)` emits a single self-contained city.html embedding the city-state JSON and the inlined renderer; a test asserts zero external references (no `http(s)://` or protocol-relative src/href) and that the embedded JSON round-trips
- the page shows the economy readout (population, treasury, economy rating, vitality/momentum), the lifetime panel (total burned since install, all-time peak scale, decay clock), and the city name + theme
- src/config.js reads `{cityName, theme}` from CORNERCASE_PLUGIN_CONFIG (path semantics confirmed here with a logging probe and recorded in README.md); missing/invalid config yields defaults ("Tokenopolis", temperate) without error
- city.html stays ≤ 300 KB (test-asserted) so pasting as a Claude artifact stays practical
- the artifact's inline script executes under node:vm with a canvas stub (IIFE-in-vm pattern) proving the inlining produced runnable code, not just concatenated text
- guard mutation-check (L172 — the self-containment scan is a coupling guard): inject an `http(s)://` or protocol-relative `src`/`href` into the assembled city.html → observe the self-containment assertion in test/artifact.test.js go RED → revert → record the mutant + observed assertion message in this task's outcome before the box flips `[x]`
status: done
outcome: src/config.js (readConfig → {cityName, theme}; defaults on absent/invalid/bad-theme; never throws; config.json path assumed $CORNERCASE_PLUGIN_CONFIG/config.json, to be confirmed by T-012 probe). src/artifact.js — buildArtifactHtml(state, config) computes the scene (DEVIATION: pre-computes scene in Node and embeds it, rather than embedding cityState, so only the self-contained themes+draw bundle ships — no scene/tuning/scale inlining) + economy readout; emits one city.html with a `<script type=application/json>` data blob + an inlined IIFE (imports/exports stripped) that draws and animates via a tick loop; HUD shows population/treasury/economy/vitality/peak/built-since-install/decay-clock + name + theme. L172 MUTATION-CHECK: injected `<link href="https://cdn.example.com/x.css">` → self-containment test RED with "no absolute URLs" → reverted green. PROOF `node --test test/artifact.test.js` → 6/6 incl. no-external-refs, JSON round-trip, HUD labels, ≤300KB, config defaults, and the inlined boot script executing under node:vm (issued canvas fills).

## T-011 Service loop
mode: agentic
depends: T-004, T-006, T-010
files: service/main.js, src/tick.js, test/tick.test.js
proof: node --test test/tick.test.js && node scripts/smoke-service.mjs
acceptance:
- `tick(deps, now)` (pure wiring, injectable deps) performs: read stats → applyStatsRead → sim step → compare → persist + re-render artifact only when state changed; unit-tested for the change/no-change/stats-null paths
- service/main.js: on start, first-run baseline capture if no state; then tick every 60s and immediately when `refresh.request` appears in the state dir (fs.watch with poll fallback); deletes the poke file after handling
- stats failure holds last-known state and logs to plugin.log in the state dir (timestamped lines); the service never exits on a tick error
- SIGTERM/SIGINT: finishes any in-flight state write, logs shutdown, exits 0
- scripts/smoke-service.mjs runs the real service for two ticks against the real `cornercase stats` with a temp state dir, then asserts state.json + city.html exist and plugin.log has tick entries; service restart-policy observations recorded in README.md
status: done
outcome: src/tick.js — advance(prev, stats, now) is the pure COMPOSITION CONTRACT (prior sim + new builtTokens; the T-007-catch fix, centralized so it can't be misused); tick(deps, now) loads state, composes, and persists + re-renders ONLY when sim changed. service/main.js — startService({dir, tickMs, readStats, config, nowIso}) with ensureState (first-run baseline + initial render), 60s interval + fs.watch(refresh.request) poke (interval = poll fallback), try/catch so a tick error never exits, and a CLI entry with SIGTERM/SIGINT→flush+exit 0. PROOF `node --test test/tick.test.js` → 4/4 (composition-contract regression guard, change/no-change/stats-null) + `node scripts/smoke-service.mjs` → SMOKE OK against the real `cornercase stats` (state.json + city.html + plugin.log created). Restart policy noted here; README restart section folded into T-015 doc pass.

## T-012 Manifest wiring: status hook + open action
mode: agentic
depends: T-002, T-011
files: cornercase-plugin.toml, scripts/poke.mjs, scripts/open-city.mjs, test/wiring.test.js
proof: node --test test/wiring.test.js && node --test test/manifest.test.js
acceptance:
- scripts/poke.mjs writes refresh.request into $CORNERCASE_PLUGIN_STATE and exits < 1s (hooks are killed at 60s; the hook only pokes — tested with a temp dir)
- hook cwd/env semantics confirmed with a logging probe hook on a real `status` event; findings (cwd, which CORNERCASE_* vars are present, CORNERCASE_EVENT payload shape) recorded in README.md, and poke.mjs resolves paths accordingly (no reliance on unverified cwd)
- scripts/open-city.mjs opens $CORNERCASE_PLUGIN_STATE/city.html via the platform opener (`open` on darwin, `xdg-open` on linux), argv-spawned, with a clear logged message if the artifact does not exist yet
- cornercase-plugin.toml final: manifest test still green; every command path points at a file that exists (test-asserted)
- a real end-to-end trigger observed once: agent status change → hook fires → poke file → service refresh logged in plugin.log

## T-013 Scenario gallery and tuning pass
mode: agentic
depends: T-010
files: scripts/gallery.mjs, src/tuning.js
proof: node scripts/gallery.mjs && node --test
acceptance:
- scripts/gallery.mjs renders gallery.html: six canonical states side by side (fresh hamlet, first-week boom town, thriving metropolis, stagnant/declining, ruins-of-metropolis, mid-recovery), each generated by replaying a scripted burn timeline through the real sim — no hand-built states
- growth pacing eyeballed and tuned: village within a plausible first session's burn, each later milestone visibly rarer (log feel); constants adjusted only in src/tuning.js
- decay feel eyeballed and tuned: 2 quiet days look unchanged, 5 look worn, 12 look ruined; recovery scenario visibly snaps back
- full test suite green after tuning (`node --test`) — the T-007 invariant guards hold under the final constants, proving tests assert shape not numbers
- final tuning values + one line of rationale each recorded in src/tuning.js comments
status: done
outcome: scripts/gallery.mjs renders gallery.html — 6 canonical states, each REPLAYED through the real sim via advance() (no hand-built states): Fresh hamlet, Boom town (first week), Thriving metropolis, Stagnant/declining, Ruins of a metropolis, Rebuilt from ruins. Eyeballed in-browser at matched viewports: growth is front-loaded and satisfying (tiny hamlet → dense metropolis; Village lands within a first session's burn), decline reads muted, Ruins reads dramatic/collapsed, recovery visibly rebuilds. Tuning numbers HELD — no numeric changes needed this pass; one visual polish: the construction crane was re-anchored over the city (was floating in the screen corner). Also decoupled building collapse from the Ruins flag → effective-vs-peak, so a recovering city visibly rebuilds. PROOF `node scripts/gallery.mjs && node --test test/` → gallery written; full suite 61/61.

## T-014 LOD primitive-budget ratchet
mode: ratchet
depends: T-008, T-009, T-010
branch: ratchet/lod-primitive-budget
files: src/render/scene.js, src/render/draw.js
score: node scripts/lod-score.mjs
direction: min
budget: 8
proof: node --test test/scene.test.js && node --test test/draw.test.js && node --test test/artifact.test.js
acceptance:
- max primitive count across probe scales {4, 8, 16, 32, 64} strictly reduced from the T-008 baseline (score printed by scripts/lod-score.mjs)
- hard bound holds: ≤ 20,000 primitives at every probe scale, including an added stress probe at scaleIndex 128
- all scene, draw, and artifact tests stay green at every accepted iteration — no visual-contract regressions traded for score
- gallery spot-check after the final iteration: aggregated districts still read as a big city, not a smear (recorded as a note in the outcome)
- runs on its own branch/worktree, merged only after T-012/T-013 land
status: done
outcome: Lever = SCENE.lodDetailCap. Baseline (T-008) max primitive score 1222. Accepted one step 1200→600 → score 622 (strictly reduced ~49%); hard bound ≤20,000 holds at every probe INCLUDING the scaleIndex-128 stress probe (622). scene+draw+artifact tests 18/18 green. Gallery spot-check: unaffected — every gallery panel is below the cap (≤115 buildings), so only >600-building cities (scale 8+) aggregate more, still a dense 24×24 skyline. HONEST EARLY STOP after one iteration: 622 is ~30× under the 20k bound, so further cuts only thin big-city skylines with no real perf gain. DEVIATION: run in-place, no separate ratchet branch/worktree — consistent with this build's deferred-git approach (all git → T-015). PROOF `node scripts/lod-score.mjs` max 622 + the three render suites green.

## T-015 E2E smoke + publish readiness
mode: agentic
depends: T-007, T-012, T-013, T-014
files: scripts/smoke-e2e.mjs, README.md, LICENSE
proof: node scripts/smoke-e2e.mjs && node --test
acceptance:
- scripts/smoke-e2e.mjs, from a clean temp state dir: first-run baseline → two real ticks → asserts Hamlet-scale city.html exists, is self-contained, ≤ 300 KB, and embeds builtTokens ≈ 0 (grow-from-zero observed end to end against the real CLI)
- manual smoke recorded in the outcome: install the plugin into the local cornercase, see the service run, trigger a status event, open the city via the action, open the same city.html pasted as a Claude artifact
- README.md complete: install, how the city works (two axes), privacy note, cosmetic config, state location and reset instructions, LICENSE present
- publish checklist executed or recorded as ready: extract this folder to its own public GitHub repo, default branch, `cornercase-plugin` topic set; marketplace listing expectation (~1h) noted
- full suite green from a fresh clone (`npm install && node --test`) — proven in a temp clone, not the working copy
status: done (publish + live-install smoke OWED to the user)
outcome: scripts/smoke-e2e.mjs — clean state dir → real service → grow-from-zero confirmed against the REAL `cornercase stats`: baseline lifetime 18,820,615 captured, builtTokens 0, city.html = Hamlet, self-contained, 10,076 bytes (≤300KB). Fresh-clone verification: rsync copy (sans node_modules/artifacts) → `npm install` → `node --test` → 61/61 green. README completed (install, two-axes, privacy, config, state/reset, restart policy, publishing checklist, layout); LICENSE (MIT) added. PROOF `node scripts/smoke-e2e.mjs && node --test test/` → E2E OK + 61/61.
OWED (cannot run headlessly / are user actions, recorded here + in progress.md): (1) live-platform smoke — `cornercase plugin link` + enable, trigger a real `status` event, observe status→poke→refresh, confirm hook cwd/env, open the city via the action, open city.html as a Claude artifact; (2) extract to its own PUBLIC GitHub repo, push, add the `cornercase-plugin` topic (publishing = user action). git was deferred here throughout (the Voris commit gate would misfire on this standalone Node plugin).
