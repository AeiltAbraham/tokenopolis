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

## 2026-10-20 — A Random Act: always-visible button + live cooldown timer

cornercase's action menu can't show a disabled/timer button (static `title`, always clickable; no dynamic/disabled/badge state per the plugin docs; `[[window]]` renders no documented UI). So the visible button lives in the city artifact: a prominent **A Random Act** control in the HUD — glowing/enabled "⚡ ready" when off cooldown, grayed/disabled "⏳ A Random Act · MM:SS" with a live per-second countdown (computed from embedded `lastActAt` + `COOLDOWN_MS` vs the viewer's clock, so even a stale render counts down correctly). Triggering stays the cornercase ⋯ menu (the only surface that can run it); the menu action now **opens the city on cooldown** instead of only erroring, so clicking always shows the timer. Verified in-browser: both states render clean (no console errors), countdown ticks (38:27→38:09). Suite **82/82**. `src/artifact.js` (button + boot countdown), `bin/random-act.js` (open-on-cooldown), `test/artifact.test.js` + `test/acts.test.js` updated.

## 2026-10-20 — A Random Act button now TRIGGERS the act (local HTTP bridge)

A browser page can't spawn a process, so the button couldn't run the act (it only pointed at the ⋯ menu). Added a localhost-only HTTP bridge (`src/server.js`): the `city-keeper` service serves the city on `127.0.0.1:<ephemeral>` and exposes `POST /act` (runs one cooldown-checked act via `runRandomAct`, then re-renders); cross-origin POSTs are refused (CSRF guard). The service writes the URL to `<state>/endpoint`; **Open Tokenopolis** opens that URL (falls back to the file when absent). The in-city button now POSTs `/act` same-origin and reloads to show the fresh animation; opened as a static/shared file, `fetch` fails and it falls back to the menu hint. Verified in a real browser end-to-end: clicked ready → rolled a Tornado → city shrank (treasury §30M→§22.8M, pop 24k→18.3k), banner + swirl animation, button flipped to live 59:58 countdown, no console errors. Live install reachable (GET / 200, cross-origin /act 403). Version → 0.3.0. Suite **86/86**. Files: `src/server.js` (new), `service/main.js` (serve + endpoint lifecycle), `scripts/open-city.mjs` (open URL), `src/artifact.js` (button POSTs /act), `test/server.test.js` (new), `test/wiring.test.js`, README privacy/how-it-works.

## 2026-10-20 — fix: stable server port (the button "did nothing" = dead ephemeral port)

Root cause of "locally nothing happens": the city server bound an EPHEMERAL port, which changed on every service restart — any already-open tab (or one opened before a restart) pointed at a dead port, so the button's fetch silently failed. Backend was fine (confirmed: a same-origin POST /act on the live install fired an act). Fix: `startCityServer` now binds a STABLE port (default 8420, +1 on conflict); the URL survives restarts so open tabs keep working. `basePort: 0` stays available for tests (ephemeral, no collisions). Live endpoint is now `http://127.0.0.1:8420`; verified GET / 200, cross-origin /act 403, button READY. Version → 0.3.1. Suite 86/86. (Also reverted the diagnostic Blizzard act fired during debugging.) NOTE: an open tab from before this fix must be re-opened once (⋯ → Open Tokenopolis) to pick up the stable URL.

## 2026-10-21 — v0.4 "Living City" pack (parallel build + integration)

Wave 1 built 6 modules in parallel (a Workflow fleet, 6 agents, disjoint files, each tested + backward-compatible): LEGENDARY acts + drawChoice (src/acts.js), achievements/streaks (src/progress.js), chronicle (src/history.js), 4 themes (src/render/themes.js), day/night+weather (src/render/ambient.js), postcard export (src/render/postcard.js). Then integrated (by hand, shared files): config ALLOWED_THEMES; state.js progress/history defaults; src/notify.js (cornercase milestone toasts); tick.js advance() folds in progress + chronicle (scale-ups, ruin onset/clear) + newlyEarned notify; bin/random-act.js chronicles the act + updates progress + notifies; artifact.js inlines ambient+postcard, extracts cityData() (one source of truth for HTML + /state), embeds achievements/streak/historyLines/tally/seed/legendary, renders HUD panels (achievements badges, chronicle, streak, Save-postcard button), maps 6 legendary anims + gold legendary banner, day/night+weather in frame(), and a /state poll that updates the city + numbers in place (no reload); server.js GET /state (readState injected); service wires readState; draw.js citizens/traffic layer (gated on vitality — stale cities empty their streets). Fixed 2 pre-existing tests that hard-coded counts (5 themes → 9; z-order +citizens). Suite 133/133 (+22 since v0.3.1). Verified in-browser: cyberpunk demo — neon skyline, gold ★ legendary banner, achievements 5/13, chronicle, streak, postcard button, night stars, citizens, no console errors. Live install restarted on v0.4 (endpoint 8420, /state 200, progress block migrated). Version → 0.4.0.

DEFERRED (tail, offered as follow-up): districts from the two burn sources (scene.js, risks the scene guards); choose-your-act UI flow (drawChoice helper is built; needs a /choice endpoint + 2-button UI); personalization (district names, flag/mascot, audio toggle); cornercase in-pane mini-city via [[window]] (undocumented UI). cityName is already configurable; milestone notify (the documented surface) is done.

## 2026-10-21 — v0.5 tail: districts, choose-your-act, personalization

Districts by burn source: cityData computes sourceMix = claude.cumulativeTokens / builtTokens → sceneFor(sim, seed, sourceMix) tags each building 'tech' (Claude) or 'ops' (cornercase) in spatially-clustered 3×3 blocks (seed-stable, independent of the layout PRNG); draw.js tints roofs toward cyan/amber by district; HUD shows "N% <tech name>". Choose-your-act: server GET /choice (readChoice injected → drawChoice, cooldown-aware) + POST /act?choice=<id> → runRandomAct({choiceId}) applies the picked common act via applyAct; artifact overlay with two option cards + cancel. Personalization: config.js validates `flag` (≤4 chars) + `districts` {tech,ops} names (DEFAULT_CONFIG extended; artifact config test updated); h1 shows the flag; a 🔈 mute button in the stage toggles a Web-Audio ambient drone + per-act stings (muted by default, starts on click, all guarded). FIXED a template-literal escape bug: the boot's grp() regex `\B`/`\d` were eaten by the enclosing template literal (served as /B(?=(d{3}…), so live-polled numbers lost commas) — escaped to `\\B`/`\\d`; caught by in-browser verification, not the vm test. Suite 135/135 (+1 themes test, +1 scene district test, +1 server /choice test, config test updated). Verified in-browser: 🚀 Demopolis, 40% AI Quarter districts with roof tints, choose overlay (Civic Renaissance / Moon Contract), mute button, live numbers keep commas after poll. Live install restarted on the tail; /choice 200. Version → 0.5.0.

## 2026-10-21 — v0.5.1: review + button-reliability fixes

Independent 4-agent adversarial review of a2359f8..HEAD (act+server flow, security, boot robustness, renderer/state); 13 findings. Diagnosis of the recurring "button refers to the menu": the live BACKEND was healthy (same-origin POST /act → 200), so the symptom is the open tab sitting on a dead origin. Root causes + fixes:
- **[high] stable port silently shifted** (src/server.js EADDRINUSE → 8421) on any restart overlap, stranding open tabs on a dead origin. Fix: retry the SAME port (12×250ms) before ever falling forward, so 8420 stays stable across a normal restart.
- **[high] notify.js spawn ENOENT crashed the keeper** (async 'error' escapes try/catch → server dies → button fails). Fix: `child.on('error', ()=>{})`; + `process.on('uncaughtException')` in service/main.js as defense-in-depth.
- **[med] actFallback conflated "no server" with reachable 403/error** → always told the user to use the menu. Fix: a connection-aware boot — a `#conn` badge ("⚠ Not connected to the live city — re-open from the ⋯ menu") shown ONLY when fetch rejects or /state isn't OK; reachable responses now show specific messages (cooldown / cross-origin / server error + console.error) and keep the button enabled. pollLive runs once at boot so a static/stale copy flags itself instantly. Verified in-browser against a generic server (no /state) — badge appears.
- **[med] open-city.mjs opened the endpoint with no liveness check**. Fix: a sync curl probe (≤1s); a dead endpoint opens the static file + warns instead of a dead URL (curl-missing → assume live).
- **[med] survived-legendary unreachable** — applyAct dropped `tier`. Fix: occurrence now carries `tier: act.tier ?? 'common'` + test.
- **[low] cycled-deck could fire one act early** when a legendary landed at 49 used cards. Fix: a legendary no longer appends to usedIds (never a deck slot) + test.
- **[low] cityData.historyLines** lacked summarize's Array.isArray guard → a corrupt history threw → menu fallback. Fix: guarded both.
- **[low] CSRF guard DNS-rebinding** — added a loopback-only Host allowlist on POST /act.
Cleared safe by the review: Origin guard same-origin, crafted choice ids, /state leakage, shell injection, DoS, 127.0.0.1 binding. Suite 138/138 (+3). Live install restarted on all fixes; /state 200, badge hidden when connected. Version → 0.5.1. (Diagnostic Reactor Scare rolled during triage was reverted; a Chronicle line remains, harmless.)
