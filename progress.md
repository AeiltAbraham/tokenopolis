# Tokenopolis — build progress

Standalone cornercase plugin. Ephemeral log (tasks.md is the durable record). Build runs
proof-gated with **no per-task git commits** — the Voris commit gate (`.agent/gate.json`) runs the
whole monorepo and would misfire here; all git is deferred to T-015 (own public repo + publish).
Node v22.23.2. Proof form is bare `node --test` (the `test/` directory-arg form is broken on this
Node — see plan §5).

## Done

- **T-001 stats contract** ✓ — cornercase 0.12.154 pinned. `windows.{total,24h,7d}.tokens.{in,out,cache_read,cache_write}` + `since`. burn = sum of all four counters. `scripts/assert-stats-shape.mjs` → exit 0 (live + fixture); failure probe (delete `windows.total.tokens.out`) → exit 1 with `windows.total.tokens.out: expected number`. Fixture is synthetic-shape (privacy: public repo).

- **T-002 scaffold** ✓ — manifest + package.json (smol-toml devDep) + .gitignore + README + layout stubs; `test/manifest.test.js` (argv-array guard + events.on) 3/3 pass after `npm install`.

- **T-003 scale + economy sim** ✓ — tuning.js + scale.js (open-ended front-loaded ladder, underground at Metropolis) + economy.js (monotone pop/treasury/rating). 9/9. Note: economyFor takes builtTokens (not scaleIndex) to satisfy strict-monotonic-in-burn.

- **T-004 stats adapter** ✓ — src/stats.js normalizes to {lifetimeTotal, burn24h, burn7d, readAt}; null on every failure path. 6/6.
- **T-005 vitality/decay/recovery** ✓ — src/sim/condition.js pure step(); condition-before-scale, ≤1/5 recovery, 30-day arc. 6/6.

- **T-006 state store** ✓ — src/state.js init/load/save, baseline-at-install, monotonic clamp, corrupt-state backup, hold-last-known. 6/6.
- **T-007 invariant guards (mutation-checked)** ✓ — 4 guards, each observed RED then reverted. 4/4.

**Full suite: 34/34 green.** Logic + state + guard core complete (T-001–T-007).

### ⚠ Carry into T-011 (tick composition contract)
`step()` must be called with the PRIOR sim + the NEW builtTokens (not the already-updated sim), or the builtTokens delta is 0 and "meaningful burn" never fires → the decay clock would never reset during active use. T-011 must add a test asserting that a run of active stats reads keeps the city OUT of decay.

- **T-008 scene generator** ✓ — pure sceneFor, structural condition, bounded LOD (max 1222 ≤ 20k). 6/6.
- **T-009 renderer + 5 themes** ✓ — isometric draw.js, grayscale-safe geometry, vitality animation. 6/6.

- **T-010 artifact assembler + config** ✓ — self-contained city.html (embedded scene + inlined renderer, HUD readout); node:vm bundle runs; L172 self-containment mutation-check RED→revert. 6/6.

- **T-011 service loop** ✓ — src/tick.js (advance = composition contract + tick) + service/main.js (startService, ensureState, poke watcher, signals). tick 4/4; real-CLI smoke OK.

- **T-012 wiring** ✓ — poke.mjs + open-city.mjs + manifest file-existence. 8/8.
- **T-013 gallery + tuning** ✓ — 6 real-sim states, eyeballed; crane anchored; collapse decoupled for visible recovery. Full suite 61/61.

- **T-014 LOD ratchet** ✓ — score 1222→622 (≤20k incl. scale 128); render suites green; honest early stop.
- **T-015 e2e + publish readiness** ✓ — grow-from-zero E2E against the real CLI; fresh-clone 61/61; README + LICENSE done.

## Review (2026-10-20) — 5 findings found & fixed

Adversarial multi-agent review (18 agents, 6 dimensions × 2 skeptics). 0 blockers. Fixed: (1) MAJOR first-run baseline-0 on null stats → defeated grow-from-zero (now deferred + retried; regression-tested); (2) MAJOR infrastructure/roads never rendered → now drawn (road grid + tier pips); (3) minor blank scaleName log; (4) minor frozen window twinkle. 1 refuted (burn-magnitude — economy already scales with builtTokens). Full suite now **66/66**; e2e + gallery re-verified. See `review.md`.

## BUILD COMPLETE — all 15 tasks done

- **61/61 tests green** (incl. 4 mutation-checked invariant guards + 1 L172 self-containment guard), verified from a fresh clone.
- Renderer verified in-browser (thriving / ruined / 6-state gallery).
- E2E verified against the real `cornercase stats` (grow-from-zero).
- **Nothing committed** — standalone folder in the Voris tree; git deliberately deferred (the Voris commit gate would misfire on a standalone Node plugin).

### OWED before publish (user actions — cannot be done headlessly here)
1. **Live-platform smoke**: `cornercase plugin link <this folder>` + `cornercase plugin enable tokenopolis`; trigger a real agent `status` event; confirm status→poke→refresh in `plugin.log`; confirm hook cwd/env; open the city via the **Open Tokenopolis** action; open `city.html` as a Claude artifact.
2. **Publish**: extract this folder to its own **public GitHub repo**, push, add the **`cornercase-plugin`** topic → marketplace in ~1h.





## 2026-10-20 — honest-burn fix + "A Random Act" feature

**cache_read excluded from burn.** Treasury was ballooning (7M → 34M "too fast"): the metric summed `cache_read`, which is re-read context (~94–97% of the raw counters), not new work. Now `burn = in + out + cache_write` in BOTH adapters (`src/stats.js`, `src/claude-stats.js`); `stats-contract.md` + tests updated. Live install re-baselined (old inflated state backed up to `<state>/.backup-pre-cacheread-fix/`): cornercase lifetime baseline dropped 18,820,615 → 519,480, confirming the inflation. City counts forward honestly now.

**"A Random Act" (new action).** Once-an-hour button (`bin/random-act.js`, manifest action `random-act`) that rolls a 50-outcome deck (25 boons / 25 disasters, `src/acts.js`) drawn WITHOUT replacement — all 50 occur once before the deck resets. Each act moves one signed lever `sim.actTokens` (a fraction of current size): boons grow/prettify, disasters shrink/wreck. The lever feeds `effectiveBuilt` → scale + economy (`effectiveBuilt` exported from `src/sim/condition.js`; `step()` now carries `actTokens` and bounds effective scale by `min(peak − ruin, builtIndexFromEffective)` — backward-compatible, `actTokens 0` ⇒ identical). Real burn dilutes an act over time (natural recovery). The artifact names the occurrence (banner + `Latest act` HUD row) and plays one of ~20 archetype animations (flood/quake/meteor/fire/bloom/boom/…) when the render is fresh. `scene.js` now shows structural rubble whenever effective < peak (not only at condition=Ruins), so a disaster visibly damages the skyline. Live-smoke verified: Tsunami dropped City→Town (actTokens −11.98M), treasury 28M→16.6M, flood animation + banner render clean (no console errors), cooldown refuses a 2nd act (~60m), and the restarted service preserves `actTokens` across ticks. Suite **81/81**; e2e OK; city.html 24.6KB (≤300KB).
