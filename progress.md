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

## 2026-10-21 — v0.6 Survival Expansion (original, PZ-flavored, no IP)

Declined reverse-engineering Project Zomboid (copyright); built an ORIGINAL survival layer instead (spec at survival/spec.md). New sim axis `sim.infection` {severity 0..1, startedAt} on condition.js step(): severity falls on a meaningful-burn tick (INFECTION.clearPerBurn) and creeps up on idle ticks (worsenPerIdleTick) — "burning is how you survive"; backward-compatible default in initState (no migration). The common `outbreak` act carries `infect: 0.55` and a new legendary `zombie-outbreak` `infect: 0.95`; applyAct seeds `infection` (max with existing). economyFor is fed `vitality*(1 - economyDrop*severity)` so population/economy fall during an outbreak and recover as it clears. Scene (scene.js): per-building `boarded` (planks when decaying OR infected, reusing dmgRnd — no PRNG shift) + scene-level `overgrowth` (nature reclaims stagnant/overrun cities) + `infection` passthrough; grayscale guards + determinism hold. Renderer (draw.js): boarded facades draw planks, lit-window glow suppressed when infected ≥0.5 (lights out), `drawOvergrowth` (moss arcs + saplings), `drawShamblers` (sickly-green figures replace traffic during an outbreak, gated so stale frames stay still); ambient.js `drawInfection` fog, called in the boot frame(). New `wasteland` theme + ALLOWED_THEMES. HUD `#infected` badge (server-render + live /state update), chronicle "Outbreak contained" milestone on the falling edge (tick.js), and a `quarantine-lifted` achievement (progress.js sawOutbreak latch, mirroring sawRuins). Fixed 2 pre-existing tests (defaultProgress shape +sawOutbreak; draw z-order unaffected) and switched overgrowth from ctx.ellipse→arc (the recCtx test stub has no ellipse). Suite 141/141 (+3). Verified in-browser (wasteland + 72% outbreak: gold Zombie Outbreak banner, ☣ badge, green fog, boarded/overgrown/empty city, dropped pop/treasury, no console errors). Live install restarted on it. Version → 0.6.0.

## 2026-10-21 — Ascension & Fallout arc, Phase 1: the living city

Spec at ascension/spec.md (60-day gift arc → AI-consciousness singularity → nuclear fall to wasteland → a FLIPPED survival era where idleness heals, reusing the decay clock inverted; looping on rebirth). Phase 1 (independent, shippable): richer life scaled to the EXISTING metrics. draw.js — citizen/car density now scales by footprint × vitality × scaleIndex (was a flat count), capped at 150; new `drawAnimals` (bird flocks drifting the sky, count ∝ vitality; ground wildlife ∝ overgrowth) and `drawVehicles` (planes cross the sky when `services.airport`, boats drift the offshore water when `services.harbour`) — all in the existing 'citizens' layer (z-order unchanged), gated off when stale/outbreak so the stale-frames-still + grayscale guards hold (birds use moveTo/lineTo/stroke, critters/boats/planes use fillRect — no ctx.ellipse, which the recCtx stub lacks). scene.js passes `services` through from cityState (default {} — Phase 2's gifts populate it). Suite 143/143 (+2: services passthrough, vehicles-gated-on-service). Verified in-browser: a Metropolis with harbour+airport — bird flocks, boats offshore, denser crowds, no console errors. Live install restarted. Version → 0.7.0. Phases 2–4 (daily gifts, the Day-60 singularity, the Fallout flip) still to build.

## 2026-10-21 — Ascension & Fallout arc, Phase 2: the daily gifts

One gift per day since install (Days 1..59; Day 60 is reserved for the Phase 3 singularity). New pure module `src/gifts.js`: a 59-gift catalog, `dayOf(installedAt, now)` (1-based, clamped ≥1, NaN→1), `claimGiftsUpTo(gifts, day)` (claims the owed range, accumulates in an `unlocked` set, idempotent, never overruns 59), and `unlockedGrants(gifts)` → aggregated {services, landmarks, flags}. ~12 gifts carry grants: services **harbour** (day 10 → boats) + **airport** (day 20 → planes) wire straight into Phase 1's `drawVehicles`; landmark gifts (fountain, dome, lighthouse, observatory, spire, bridge, park, stadium, tower, monument) add structures; flag gifts (festival, aviary, zoo, nightlife, rally) boost entities. The rest are flavor (a banner + a chronicle line).

Wiring: `state.js` initState adds `gifts: defaultGifts()` (backward-compatible, no migration). `tick.js advance()` claims the day's owed gifts, appends a `🎁 Day N: <name>` chronicle line each, and stamps `gifts.last.at` for banner freshness (gifts added to the `changed` check). `history.js` gets a `gift` event type (🎁). `scene.js` appends gift landmarks **after** the procedural ones (never shifts building geometry — guarded) and passes `giftFlags` through as `scene.flags`. `draw.js` renders 6 new gift-landmark glyphs (arc/fillRect/moveTo/lineTo/stroke only — no ctx.ellipse) and reads `scene.flags` for boosts (festival → thicker crowd, aviary → more flocks, zoo → ground wildlife), all inside the existing 'citizens'/'landmarks' layers so z-order + stale-frames-still + grayscale guards hold. `artifact.js cityData` folds grants into the scene, embeds `day`/`giftCount`/`giftTotal`/`lastGift`; the HUD gets a "🎁 Day N · X/59 gifts · <latest>" line + a purple gift banner that flashes on a fresh claim (guarded setupGift + live /state refresh via setDayGift).

Fixed the pre-existing "tick no-change path" **fixture** (not its assertion): it ticked a fresh install on day 1, where the Day-1 gift is now legitimately claimed → a real change; settled the state first so the probe tick is a true no-op. Suite 153/153 (+10: gifts.js catalog/dayOf/claim/clamp/grants/default, scene gift-landmarks-dont-shift + flags passthrough, tick daily-claim + catalog-clamp). Verified in-browser: a Day-21 Giftopolis — "🎁 Day 21: Air Show" banner, HUD "Day 21 · 21/59 gifts", boats+planes, bird flocks, fountain/tower/lighthouse structures, chronicle full of 🎁 gift lines, no console errors. Version → 0.8.0. Phases 3–4 (the Day-60 singularity revamp→nuclear fall, then the Fallout flip) still to build.

## 2026-10-21 — Ascension & Fallout arc, Phase 3: the Day-60 Singularity

The climax. A new `sim.era` state machine ('build' → 'ascendant' → 'fallout') driven by the day index,
plus forward-compat `sim.recovery` (0; Phase 4 drives it) and `sim.singularityAt`. `SINGULARITY = {ascendDay:60, fallDay:61}` in tuning.js. `condition.js step()` now takes `day` (defaults 0 → stays 'build', so every existing caller is unchanged) and owns the transitions, evaluated sequentially so a single catch-up tick can ascend AND fall:
- **Day 60 — Ascension:** era 'ascendant', the city flares to its gleaming peak (scale pinned to peak, Thriving, vitality 1, no ruins/outbreak), `singularityAt` stamped. A new white-gold-chrome **`ascension` theme** snaps on (overriding config).
- **Day 61 — the Nuclear Fall:** `falloutStep()` razes it — scale 0, ruinProgress = peak (the ruined-metropolis bones in rubble), condition Buried, vitality 0, infection sterilized, era 'fallout'. Theme snaps to **wasteland**. Burning no longer rebuilds (Phase 4 adds the inverted recovery mechanic that lets idleness heal it).

`tick.js advance()` computes `day` once (feeds both gifts and the Singularity), diffs prev→new era to chronicle `⚡ The Singularity` / `☢️ Nuclear Downfall` and stamp a one-time `state.climax = {phase, at}` marker; normal decay/scale lines are suppressed on the transition tick. **Ordering fix:** the climax lines are appended LAST (newest-first) so a big gift catch-up (Day 4 → Day 61 in one tick, all 59 gifts at once) can't bury the climax or cap it out of the 60-entry log — guarded by a test asserting `history[0]` is the Downfall. `history.js` adds `singularity`/`downfall` event types (+ tally buckets); `scene.js` passes `era` through; `state.js` defaults era/recovery/singularityAt + `state.climax` (backward-compatible, no migration).

Artifact: `cityData` computes `effectiveTheme` (ascension/wasteland/config) used for both the render and the HUD, reframes the fallout readout (population = recovery × would-be, treasury 0, "Wasteland · Irradiated", a `recovery` field), and embeds era/recovery/climax. Boot: an `#era` HUD badge (⚡ Ascended / ☢️ Fallout — recovery N%, live-updated), a center-stage `#climax-banner`, and two bespoke one-time FX on #act-fx — `ascension` (gold radial bloom + chrome light-rays) and `fall` (detonation whiteout → shockwave ring → ash wash + screen shake) — played by `setupClimax()` on a fresh render and by `applyLive` when the fall lands on a poll while watching (the theme snaps live too). All guarded for the node:vm boot test.

Tests: new `test/singularity.test.js` (11) — era defaults/backward-compat, Day-60 ascend, Day-61 raze, catch-up jump, fallout holds under burn, determinism, advance chronicle+climax for each transition and the double-jump, the climax-ordering guard, and the cityData theme snap + fallout readout. Updated the draw.js theme-list pin (+ascension) and refocused the gift-catalog-clamp test on Day 59 (pre-Singularity). Suite 164/164 (+11). Verified in-browser: Day-60 Terminus — gleaming ascension theme, ⚡ Singularity banner, Metropolis Thriving; Day-61 — wasteland rubble field, ☢️ Nuclear Downfall banner + nuclear-flash FX, Fallout HUD (recovery 0%, pop 0), chronicle headlining the Downfall then the Singularity. No console errors. Version → 0.9.0. Phase 4 (the Fallout flip: idle heals, Recovery HUD, rebirth loop) still to build.

## 2026-10-21 — Ascension & Fallout arc, Phase 4: the Fallout flip (v1.0.0 — arc complete)

The finale. The Fallout era is the decay clock run backwards. `condition.js falloutStep()` now implements
recovery: `recovery = clamp01(daysIdle / RECOVERY.healDays)` (healDays 10, mirroring DECAY.vitalityZeroDays).
A dedicated `recoveryAnchorAt` resets to now on the fall tick (`justFell`) and on any meaningful burn (a
SETBACK — "burning sets back recovery"); idleness lets real time heal. As recovery climbs the wasteland
rebuilds: `scaleIndex = round(recovery*peak)`, condition Buried→Thriving, `vitality = recovery`, ruins
shrink. At `recovery >= 1` the city is REBORN — a fresh green Thriving build-era city sized by builtTokens
(scaleIndex = peak = scaleFor(builtTokens)), recovery 0, `singularityAt` null (re-armed), actTokens 0.
The loop closes: **build → ascend → fall → recover → reborn → build.**

`tick.js advance()` computes `day` from `state.cycleStartAt` (falls back to install) so the gift/singularity
calendar is PER-CYCLE. On rebirth (fromEra fallout→build) it resets `cycleStartAt = now` + `gifts.claimedThroughDay = 0`
(earned gifts persist in the unlocked set as blueprints; banners replay), skips that tick's gift claim,
chronicles `🌅 The City Reborn` (appended last), and stamps `climax {phase:'rebirth'}`. `cityData` now uses
`cycleStartAt` for the HUD day (matching gifts); the fallout readout is recovery-scaled; `effectiveTheme`
reverts to config.theme on rebirth. Artifact boot: a `#recovery-wrap` bar (width = recovery%), the `#era`
badge shows live recovery%, the act hint reframes to "rest — burning sets back recovery" in fallout, and a
`rebirth` climax (green bloom FX + "🌅 The City Reborn" banner) joins ascension/fall. `history.js` adds the
`rebirth` type (🌅, legendaries tally). Backward-compatible (`cycleStartAt`/`recoveryAnchorAt` default via
`??`; no migration). `state.cycleStartAt = installedAt` default.

Tests: new `test/fallout.test.js` (9) — idle heals, burn resets, rebirth at 100% (fresh build sim),
determinism, advance rebirth (chronicle + gift re-arm + cycle reset), the arc LOOP (2nd cycle ascends at its
own Day 60), the recovery HUD, and the pre-Phase-4 backward-compat guard. Suite 172/172 (+8). (The
`poke`-spawn wall-clock test is environmentally flaky under machine load — bare `node -e` cold-start alone
is ~1.1s > its 1000ms budget; poke.mjs is byte-unchanged and imports no touched file, so it's node
startup latency, not a regression.)

Verified in-browser: a 50%-recovery healing wasteland (recovery bar half-filled, era badge "recovery 50%",
reframed act hint, 156k survivors returned, city half-rebuilt) and the full rebirth (🌅 The City Reborn
banner + green FX, reborn Metropolis back in the coastal theme, new "Day 1 · 59/59 gifts" cycle, Phoenix
achievement earned, chronicle headlining Reborn→Downfall). No console errors.

Adversarial 4-lens review (2 low findings, both fixed): (1) a pre-Phase-4 fallout state carried a stale
build-era `lastMeaningfulBurnAt`, which would have instant-rebirthed on upgrade → fixed with the dedicated
`recoveryAnchorAt` that backfills to now (+ guard test); (2) `setEra` never restored the "click to roll"
act hint on a live rebirth → gated the hint write on an era CHANGE (also stops it clobbering transient
cooldown hints). Version → 1.0.0. The Ascension & Fallout arc is complete.

Also this session: wrote the live install's config (`~/.config/cornercase/plugins/config/tokenopolis/config.json`)
to theme `coastal` (name kept "Tokenopolis") at the user's request, and poked the keeper to re-render.

## 2026-10-21 — The Pyromid (v1.1.0): a mysterious datacenter landmark

A new endgame feature at the user's request (from a reference image of a solar-panel pyramid). The
**Pyromid** is a solar-pyramid datacenter that builds toward 10B treasury, clicks for +$10, boosts the
city, and drip-feeds lore to a dark reveal ("the heart of the AI — and the reason we return to dust. It
was all a simulation").

Pure core `src/pyromid.js`: a 7-line lore catalog + `PYROMID` tuning (target 10e9, clickValue 10,
boostEconomy 0.75, boostPopulation 5000); `updatePyromid(prev, treasury)` (progress = high-water
clamp01(treasury/target) — it never un-builds, even when the wasteland takes the rest; infoLevel latches),
`burn(prev)` (+clickValue to the bonus), `boostFor(progress)`, `infoLevelFor/loreFor/newlyUnlocked`.
Shared `treasuryFor(sim, bonus)` added to `economy.js` (one source of truth for the Pyromid build, the
click handler, and the readout). `tick.js advance()` builds it from the current treasury and chronicles
each lore reveal (`⬛ Pyromid: …`, new `pyromid` history type). `state.pyromid = defaultPyromid()` default.

Render: `scene.js` passes `pyromid: { progress }`; `draw.js` adds a `drawPyromid` (solar pyramid rising
with progress — foundation → full height, chevron panel bands, a faint full-height scaffold, a gold
capstone that blazes on completion; geometry is tick-independent so the grayscale/stale guards hold, no
ctx.ellipse) plus an exported `pyromidAnchor` shared with the click hit-test.

Interaction: `cityData` applies the boost (economyRating ×(1+0.75·progress), +pop) and embeds the Pyromid
(progress, lore, treasury, target). Server gets `POST /pyro` (a shared `sameOriginLoopback` CSRF guard now
covers /act + /pyro) → `runPyromidBurn` (service/main.js: +$10, high-water rebuild, chronicle, re-render).
Artifact: a HUD Pyromid panel (⬛ % built, progress bar, §X / §10B, the current lore, a "⬛ Burn · +$10"
button) + a canvas hit-test so clicking the BUILDING also burns; both live-update via applyLive.

Tests: `test/pyromid.test.js` (8 — catalog, thresholds/lore, boost, high-water progress, burn, advance
chronicle, runPyromidBurn, cityData boost/embed) + a server `/pyro` route test. Suite 181/181 (+9).
Verified in-browser: at 70% the pyramid stands mid-build with the "it is learning" lore; the HUD **Burn**
button AND clicking the building each add $10 (treasury 7,000,000,500 → 520 → 530); at 100% the gold
capstone blazes with the final reveal; lore reveals chronicled; economy/pop boosted; no console errors.
Version → 1.1.0.

## 2026-10-22 — Integrated two community PRs (#2 path fix, #5 zoom) onto main

Rebased + landed two external contributions after an adversarial review flagged both as request-changes.

**PR #2 (rahul05ranjan) — resolve entry scripts from $CORNERCASE_PLUGIN_ROOT.** cornercase runs a plugin
command in the clicked WORKSPACE folder, so the relative `node scripts/x.mjs` resolved against the user's
project → MODULE_NOT_FOUND. All commands now use `["sh","-c","exec node \"$CORNERCASE_PLUGIN_ROOT/<file>\""]`
(ROOT verified set by cornercase; argv-safe, double-quoted var, exec leaves no lingering shell). The review
caught that a 4th command added to main after the PR — `random-act` — had the SAME bug; extended the fix to
ALL FOUR commands. Updated the `wiring.test.js` "points at a file" guard to parse the new ROOT form (and now
assert the ROOT form is used). Note: `sh -c` is POSIX-only, but the plugin already is (open/xdg-open/curl).

**PR #5 (jacogaz) — zoom/pan the city view.** Wheel/pinch zoom around the pointer (≤600%), drag-to-pan
clamped inside the canvas, a zoom control + double-click to fit; the city is drawn through a `view` transform
(ctx.setTransform in frame()), the day/night/weather/outbreak washes stay screen-space. The review's key
finding: the transform broke the new PYROMID burn-by-click (it hit-tested raw pointer coords against an
untransformed box, so at z>1 the click missed the pyramid and a stale-box click spuriously burned). Fixed by
a new exported pure `pyromidHitsAt(scene, W, H, view, sx, sy, progress)` in draw.js that inverse-maps the
click through the view (wx=(sx-view.x)/view.z) before the box test; the boot click handler uses it. Ported
PR #5's node:vm zoom test + added a click-while-zoomed regression guard (hits the drawn pyramid at z=1 AND
zoomed; the stale un-zoomed box never burns). Suite 184/184 (+3). Verified in-browser: zoomed to 225% (sharp),
pan clamps to the city, and clicking the enlarged pyramid burns it (+$10, treasury 7,000,000,500 → 510), no
console errors. Version → 1.2.0. Both landed as two commits crediting the contributors; the PR branches
themselves stay open (re-applied with fixes, not fast-forwarded).

## 2026-10-22 — Graphics overhaul (v1.3.0): depth, richer buildings, street life, hi-fi

A full renderer pass across four directions (all requested), staying zero-dep, self-contained, grayscale/
stale/z-order/determinism-safe, no ctx.ellipse.

- **Depth & lighting:** replaced the per-building drop shadow with a CAST-SHADOW pre-pass (buildings sweep a
  shadow down-right on the ground, longer for taller ones, so each sits atop its own + neighbours' shadows);
  stronger directional sun (brighter sunlit face, deeper shadow face) + a contact-AO line where faces meet the
  ground; a post-process warm key-light wash from the sun side + a stronger vignette.
- **Richer buildings:** per-building seeded roof STYLE (parapet / pitched ridge / stepped setback) + rooftop
  clutter (water tanks, vents) and antennae/beacons on tall towers — the skyline reads varied, not boxy.
- **Street life:** a static tree + warm-streetlight pass lining the avenues (tick-independent, thinned by
  overgrowth); denser crowds + nicer cars (contact shadow, windshield glint, head/tail light); boat wakes +
  water reflections.
- **Hi-fi:** dropped `image-rendering: pixelated` and moved the renderer to a fixed LOGICAL 960×640 space
  (`LOGICAL_W/H` in draw.js; drawCity/drawAnimals/drawVehicles/drawPyromid use it, not canvas.width). The
  artifact canvas backing is now 1920×1280 (2×); the boot's frame() bridges them with `ctx.setTransform(S·z…)`
  where S = canvas.width/960, composing the hi-res scale WITH the zoom. The zoom (setView clamp, canvasPoint)
  and the Pyromid hit-test now all operate in the same logical 960-space, so the click stays aligned. act-fx
  canvas bumped to match.

Suite 184/184 (guards intact — the logical-space change is transparent at the 960 test resolution). Verified
in-browser: crisp at 235% zoom with clear cast shadows, varied rooftops, trees/lamps, boats; the Pyromid click
burns at BOTH fit (§…500→510) and 235% zoom (→520); no console errors. Version → 1.3.0.

## 2026-10-22 — Calmer motion + a living sky & weather (v1.4.0)

Addressing live feedback. (1) Removed the constant roving "hook"/crane from the overlay layer (it belongs
at a build site, not floating downtown), and slowed all motion to a calmer, real-life pace — citizens/cars
(speed ~halved), birds, boats, planes drift slower, and the frame cadence eased 140→185ms. The draw guards
(lively-frames-differ, lit-window twinkle, stale-frames-still, grayscale, z-order) all still hold.

(2) A living SKY + WEATHER driven by the viewer's LOCAL clock (local-ms = Date.now() − tz offset).
`ambient.js drawDayNight` now arcs the SUN across the daytime sky (low at dawn/dusk, high at noon, warmer
near the horizon) and the MOON across the night (with a crescent shadow + halo), over a deeper night wash +
warmer sunset glow (stars still come from the backdrop). New `weatherOf(ms)` gives each day a stable, varied
weather (clear / overcast / rain / fog, snow on winter days); `drawWeather` now renders rain (diagonal
streaks + overcast darkening), fog (drifting haze bands), overcast (grey wash + more clouds), plus the
existing snow/leaves/clouds — all screen-space, deterministic, no ctx.ellipse. The boot feeds local time to
both, and a HUD line shows the local time + a day/night + weather glyph ("🌙 21:14 · 🌧️ Rain"), updated live.

Signatures preserved (drawDayNight(ctx,w,h,tod) / drawWeather(ctx,w,h,label,tick)) so the ambient tests pass;
added a weatherOf guard + extended the drawWeather test to the new labels. Suite 190/190. Verified via a
sky-preview grid: sun arcs dawn→noon→sunset, night shows the moon + stars, and rain/fog/overcast/snow all
render. Version → 1.4.0. STILL TO DO (next): the Pyromid as a growing construction site OUTSIDE the city
(cranes, trucks, scaffolding), and a more realistic world (dense centre → outskirts → countryside between cities).

## 2026-10-22 — A world around the city + the Pyromid construction site (v1.5.0)

The city now sits in a believable landscape, and the Pyromid is a megaproject OUTSIDE it.

- **Density gradient (scene.js):** a steeper height falloff (towering downtown → low-rise outskirts) plus a
  new `vacant` flag — undeveloped lots thin out toward the fringe (rare downtown, common at the edge), so the
  footprint reads centre → outskirts instead of a solid slab. `seed` is now exposed on the scene so the
  renderer can lay out this city's surroundings deterministically. Vacant cells render as bare gravel/weed lots.
- **Countryside (draw.js `drawCountryside`, in the ground layer):** a broad field plate beyond the city with a
  farmland patchwork, forest clusters, a river sweeping the lower-left, roads leading out of the city toward the
  horizon, and a few tiny distant towns ("the space between cities"). Deterministic (seeded by the city +
  position), tick-independent, palette-tinted but palette-independent in GEOMETRY. No ctx.ellipse.
- **Pyromid outside + construction site (draw.js):** `pyromidAnchor` moved to the front-right countryside
  (iso(n·1.3, n·0.8)) — the hit-test follows the anchor automatically, so the click stays aligned. While
  building (`progress < 0.995`) it shows a graded dirt lot, scaffold rungs on the rising faces, two flanking
  tower cranes (jibs over the pyramid, slowly-bobbing hooks), and parked trucks; all recede at completion,
  leaving the gleaming pyramid + gold capstone.

Guards intact (scene determinism + length, grayscale, LOD, z-order, stale-frames, the vm boot — the guard
scenes have no pyromid, so the crane's tick-bob is test-safe). Suite 185/185. Verified in-browser: the city in
rolling countryside with a river/farms/forest/roads/distant towns, a clear dense-centre→sparse-outskirts
gradient, and the Pyromid as a cranes-and-trucks construction site outside the city — the relocated click
still burns at 246% zoom, no console errors. Version → 1.5.0.

### v1.5.0 refinements — countryside polish, a review fix, and clock-driven life (same version, still unreleased)

Three follow-ups off user feedback + the adversarial world-review (workflow wwjk3odtt). NOTE: the "crane
tick-bob is test-safe" claim above was wrong — it was a real latent invariant break, now fixed (below).

- **Roads + river no longer flat/grey (user: "grey lines and the sea … too pixelated and flat").** The in-city
  road grid is now a soft ground-tinted paved look (`rgba(shade(p.ground,-20),0.5)`) instead of a hard grey
  lattice (very visible now the outskirts have open lots). The countryside lanes became soft tapering strips
  that fade into the fields (perspective trapezoids + a faint centre crown), not constant-width grey strokes.
  The river was reworked from a flat 4-gon into a meandering water body: a 3-stop depth gradient, wavier banks
  (no straight cut), a lit shelving shore, and faceted iso water-tile highlights (same diamond language as the
  ground, big enough to hold at display scale). All still deterministic + tick-independent, geometry
  palette-independent, no ctx.ellipse. Verified in-browser at magnification — reads as a river, not a slab.
- **Review fix (CONFIRMED medium): the construction crane's hook was tick-dependent GEOMETRY and NOT
  stale-gated** (`hl = 24 + Math.sin((tick+cs·5)·0.06)·7` → moveTo/lineTo/fillRect drift every frame). A city
  that burned enough to start the Pyromid then went quiet (stale + mid-build, reachable via idle-decay or the
  fallout path) would animate while "stale holds still" says it must not — the existing stale guard couldn't
  catch it because its scene has `pyromid:null`. Fixed: `drawPyromid` derives `stale` and the hook hangs still
  when stale (`hl = 24 + (stale ? 0 : …)`); header contract corrected. Added guard `a stale city
  mid-Pyromid-build also holds still` (stale scene + `pyromid:{progress:0.5}`). **Mutation-checked:** removed
  the `stale ?` gate → guard RED (`not ok … crane hook must not drift`) → reverted → green.
- **Window lights + street life now track the LOCAL CLOCK, not the frame tick (user: "sun up → fewer lit,
  don't flicker, steady; getting dark → more windows; from 23:00 people sleep, movement dies down").** Replaced
  the per-tick `lit()` twinkle with clock-driven curves in draw.js (exported `lampFraction`/`streetActivity`,
  piecewise-linear keyframes): windows near-dark by day (a few always-on), filling through dusk to a ~22:00
  peak, thinning after 23:00 as people sleep; a window lights when its fixed personality crosses the hour's
  fraction (so it comes on at dusk and STAYS on, then goes dark — steady, not reshuffling) with a slow 5-minute
  wobble for the odd on/off. Street + flock counts scale by `streetActivity(tod)` so movement dies down at
  night and refills by day. `drawCity` gained a `tod` param (default 0.5 = noon, so existing 4-arg test calls
  are unchanged); the boot computes one local `tod` per frame and feeds both the windows and the sky, so they
  agree. **Twinkle guard rewritten WITH USER APPROVAL** (`draw.test.js` "window lights … hold steady across
  frames") — asserts the new invariant: identical lit-set across adjacent ticks at a fixed clock, and more lit
  at evening than midday; plus a curve unit test (bounded, dark-day/lit-evening/sleep-after-23:00). **Mutation-
  checked (two mutants):** (M1) windows made tick-dependent (`tod + tick·0.02` at the call site) → the steady
  assertion RED; (M2) `lampFraction → 0.3` constant → the curve guard RED. Both reverted → green.

Suite 187/187 (185 + the stale-Pyromid guard + the curve test; twinkle rewritten in place), 0 non-flaky
failures (the `poke` cold-start timing test stays environmentally flaky). Verified in-browser: noon shows dark
windows, 20:00 lights them up, and the river/roads read as landscape rather than flat shapes. Still v1.5.0,
uncommitted — keeper NOT yet restarted onto it.

### v1.5.0 — sea removed + real location/weather ("Tokenopolis near <city>")

User: "Remove the sea; show weather and time based on location — but say 'Tokenopolis near <real city>'."

- **Sea removed (draw.js `drawCountryside`):** the whole river block is gone; the farmland + forest loops
  dropped their river-clearance clauses so fields/forest fill the lower-left (no empty gap). Verified in-browser.
- **Real location + weather (new `src/geoweather.js`, KEEPER-SIDE only, never bundled):** IP → city via
  ipwho.is (primary) / ipapi.co (fallback), keyless HTTPS with a User-Agent (ipapi.co returns empty without
  one); current weather + temp via open-meteo (WMO code → our 5 labels via `weatherLabelFromCode`). A
  failure-tolerant module cache (`refreshGeoWeather` injectable + never throws; `getCachedGeoWeather`). The
  resolved city/weather are BAKED into the artifact JSON, so a shared copy still works (client geolocation +
  external fetch are blocked in the artifact sandbox). **Privacy:** the IP is sent only to resolve a
  city-level name + coarse coords, never logged or stored. Everything degrades to null → fall back to the local
  clock + the deterministic `weatherOf()`.
- **Wiring:** `cityData(state, config, env = getCachedGeoWeather())` bakes `readout.locationCity/weather/tempC`
  (one chokepoint — both the baked HTML and the `/state` poll flow through it). The h1 (`id="cityname"`) +
  `<title>` show "<cityName> near <city>"; the clockline shows real weather + "· N°C"; the sky `drawWeather`
  uses the real label (fallback `weatherOf`). `service/main.js` runs a crash-safe 15-min refresh loop.
- **Adversarial review (workflow wbyglsyqa) — 5/5 confirmed, all fixed:**
  (A, main.js) the post-resolve `run()` was a **no-op** — `tick()` skips `writeArtifact` on an unchanged sim,
  so the baked city only appeared incidentally; now a successful resolve calls `writeArtifact(…)` directly.
  (B, artifact.js `applyLive`) the wholesale `DATA.readout = s.readout` **nulled real weather** during the
  ~10s keeper warmup → flicker to fake weather; now the last-known location/weather are carried forward when
  the incoming values are null. (C, same) the **h1/<title> never re-rendered**, stranding "near <city>" on a
  tab opened before geo resolved; `applyLive` now re-renders them (via `#cityname`, using `textContent` so the
  API city name can't inject markup). (D, geoweather.js) a weather-API failure **discarded the resolved city
  too**; cold-start now surfaces the city with weather=null (sky falls back), while a transient failure keeps
  the last good weather.
- **New tests:** `test/geoweather.test.js` (WMO mapping, env build/cache, offline→null, weather-fails-keeps-
  last, **cold-start city-without-weather**, thrown-fetcher-swallowed) + 2 `cityData`-env tests in
  artifact.test.js (near-city render + self-containment; offline fallback). **Mutation-checked:** (M1) revert
  Fix D → the cold-start test RED (keeps-last-good still green); (M2) drop `id="cityname"` → both location
  tests RED. Both reverted → green.

Suite 195/195, 0 non-flaky failures. Verified live on the keeper after restart: "Tokenopolis near Almunecar ·
☀ Clear · 23°C" (real local time + real weather), sea gone, 0 external URLs in city.html. (v1.5.0 later
shipped — commit 735b9a4.)

## 2026-10-22 — Cozy "storybook" renderer restyle (v1.6.0)

User wanted a graphics LEAP. After a WebGL 3D prototype (rejected as "generic lit boxes") and three style
mockups, they picked "cozy storybook". This restyles the canvas-2D renderer (src/render/draw.js ONLY) toward
it — all colour/light/density, no new tech, so it stays self-contained + deterministic.

- **Pastel palette:** `pastel(hex,t)` (mix toward warm cream) + a `COZY` spread of soft pastels. Each
  building takes a seeded COZY colour lightly tinted by its theme/zone hue (`mix(pastel(zoneColor,0.12),
  accent, 0.62)`), roof = `shade(base,-12)` — ONE cohesive colour per building (replaces the per-zone roof
  logic → cleaner). Varied + charming but still reads each theme.
- **Softer light:** gentler face gradients, soft warm contact-AO, warm glowing windows (#ffe7ad + a #ffdf9a
  6×7 glow), soft warm cast shadows, warm pastel sky + softened pastel ground/countryside.
- **Decluttered:** removed the rooftop-clutter block; thinned street furniture (keep 0.85→0.26) and citizens
  ((10+n·8) cap 240 → (5+n·3.5) cap 130) so the town breathes.
- **Window iso-slant fix (user-reported bug):** windows were drawn in flat horizontal rows; now each row
  follows its face's iso angle — left `lx=x-hw+u·hw, lwy=y+u·hh-f·FLOOR_H-6`; right `rx=x+u·hw,
  rwy=y+hh·(1-u)-f·FLOOR_H-6`, u=(c+0.5)/3. Bloom stays a 6×7 fillRect (window guard holds).

All changes are colour/count/position only — geometry stays palette-independent (grayscale guard) and
tick-independent (stale guard); the window bloom guard holds (6×7, tod-driven). Suite 195/195. Adversarial
review (workflow w7z12vup5; lenses: guards/determinism, window-slant correctness, state regressions) →
**0 findings**. Verified across all 11 themes: the naturalistic ones (coastal/temperate/nordic/solarpunk/
desert/ascension) look genuinely cozy. **OWED follow-up:** the bold themes (cyberpunk/neon/crt) still have
vivid-green grounds — per-theme ground desaturation needed there. Version → 1.6.0.
