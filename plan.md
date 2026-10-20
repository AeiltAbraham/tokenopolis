# Tokenopolis — Plan

> Standalone cornercase plugin. Planned 2026-10-19 from `spec.md` + `clarify.md` (signed off —
> decisions there are not re-litigated here). Not a Voris feature: no Voris data model, tenant,
> privacy-matrix, or CI-pin sections apply. All proof commands run from the repo root
> (`cornercase-citysim/`, which becomes its own public repo at publish — see T-015).

## 1. Approach and justification

**Stack (ADR: `adr-node-zero-dep-runtime.md`).** Plain Node.js (>= 20; v22.23.2 verified present)
ESM, zero runtime dependencies, `node:test` for everything, one dev-only dep (`smol-toml`) for
manifest tests. One language covers the service, the scripts, the tests, and the renderer that
ships inside the artifact. No TypeScript, no bundler, no framework — the marketplace distributes
source from a git repo, so install must be clone-and-run.

**Artifact (ADR: `adr-artifact-inline-canvas-renderer.md`).** One self-contained `city.html`:
embedded city-state JSON + inline canvas renderer, drawn procedurally at open time. This is the
only shape that is simultaneously a local view, a shareable Claude artifact, animated ("alive"),
and viable at unbounded scale (LOD decided at draw time).

**Architecture — three layers, strictly ordered so the heart is verified first:**

1. **Pure simulation** (`src/sim/`, `src/tuning.js`): deterministic functions
   `(builtTokens, recent burn, time-since-last-burn, prior state) → city state`. No I/O, no
   clock reads (time is a parameter). This is where all the spec's model rules live — log growth,
   open-ended scale ladder, underground at Metropolis, condition ladder, decay-in-days, ~5×
   brownfield recovery, regression into ruins — and where the mutation-checked invariant guards
   bite (T-007).
2. **Adapters** (`src/stats.js`, `src/state.js`): shell out to `cornercase stats --json`
   (argv spawn, never shell), persist/load `state.json` under `CORNERCASE_PLUGIN_STATE`, capture
   the install baseline on first run, hold-last-known on any stats failure (never reset, never
   crash — clarify.md default).
3. **Presentation + wiring** (`src/render/`, `src/artifact.js`, `service/main.js`, manifest):
   city state → deterministic scene description → isometric pixel canvas renderer → assembled
   artifact; the service polls + refreshes on a `status`-hook poke; an action opens the city.

Every spec-level behaviour is testable below the service layer; the service is a thin loop.

## 2. External interface deltas

### 2.1 `cornercase stats` fields we depend on — **confirm at build (T-001)**

Exact `--json` field names are **unknown until T-001 runs** `cornercase stats --help` /
`cornercase stats --json` on the installed version (0.12.154 verified present) and records them in
`stats-contract.md` + a committed numbers-only fixture. What we require to exist in some form:

| Needed signal | Use | Fallback if absent as a direct field |
|---|---|---|
| Lifetime totals: tokens in, out, cache | burn = in + out + cache; built potential | none — hard requirement |
| 24h window total | vitality (short) | derive from hourly buckets |
| 7d window total | vitality (trend) + decay clock | derive from hourly buckets |
| Hourly buckets (26 weeks) | window derivation; "meaningful burn" day detection | optional if windows exist directly |

Only `src/stats.js` may name these fields; everything downstream consumes the adapter's
normalized shape `{ lifetimeTotal, burn24h, burn7d, readAt }`.

### 2.2 Persistent state — proposed `state.json` (in `$CORNERCASE_PLUGIN_STATE/`)

```json
{
  "schemaVersion": 1,
  "install": {
    "installedAt": "2026-10-19T18:00:00Z",
    "baselineLifetimeTokens": 123456789
  },
  "stats": {
    "lastReadAt": "2026-10-19T18:05:00Z",
    "lastLifetimeTokens": 123457000,
    "burn24h": 42000,
    "burn7d": 310000
  },
  "sim": {
    "builtTokens": 211,
    "scaleIndex": 0,
    "peakScaleIndex": 0,
    "condition": "thriving",
    "vitality": 0.93,
    "lastMeaningfulBurnAt": "2026-10-19T18:05:00Z",
    "ruinProgress": 0.0,
    "recoveryCredit": 0
  },
  "citySeed": 987654321,
  "render": { "lastRenderedAt": "2026-10-19T18:05:00Z", "artifactFile": "city.html" }
}
```

Semantics: `builtTokens = max(prevBuiltTokens, lastLifetimeTokens − baselineLifetimeTokens)` —
clamped monotonic (a stats hiccup can never shrink history). `peakScaleIndex` is the all-time
peak (lifetime panel + recovery target). `ruinProgress`/`recoveryCredit` carry the
decay-regression and 5×-brownfield mechanics across runs. `citySeed` fixes procedural layout so
the city is recognizably "yours" between renders. Stats-unavailable ⇒ `sim` untouched, `stats`
untouched, logged to `plugin.log`, retried next tick. `schemaVersion` gates future migrations.
The artifact `city.html` is also written into the state dir (survives `remove`, per platform).

### 2.3 Cosmetic config (read from `CORNERCASE_PLUGIN_CONFIG`; path semantics confirmed at T-010)

```json
{ "cityName": "Tokenopolis", "theme": "temperate" }
```

Themes: `temperate | coastal | desert | nordic | neon` (clarify.md examples). Missing/invalid
config ⇒ defaults, never an error. Cosmetic only — no sim effect.

### 2.4 Manifest surface (`cornercase-plugin.toml`)

- `[[service]]` `id = "city-keeper"`, `command = ["node", "service/main.js"]` — poll loop +
  artifact regeneration.
- `[[events]]` `on = "status"`, `command = ["node", "scripts/poke.mjs"]` — writes a
  `refresh.request` touch-file into the state dir; the service watches it (hooks are killed at
  60s, so the hook only pokes — all real work stays in the service). Hook cwd/env semantics
  confirmed at T-012 with a logging probe.
- `[[actions]]` `id = "open-city"`, `title = "Open Tokenopolis"`,
  `contexts = ["workspace", "pane"]`, `command = ["node", "scripts/open-city.mjs"]` — opens
  `city.html` via the platform opener (`open` / `xdg-open`).
- No `[[build]]` section — zero runtime deps means nothing to install or compile.

### 2.5 Model constants (all in `src/tuning.js`, one file, commented)

Scale ladder (open-ended): Hamlet(0) → Village → Town → City → Metropolis(4) → Megalopolis →
Arcology → Megastructure(7) → procedural tiers (8+). Underground unlocks at index >= 4.
Scale thresholds geometric (`T0 · r^n`) ⇒ front-loaded/log feel; T0 sized so Village lands in a
first real session. Condition ladder: Thriving → Stable → Stagnant → Declining → Blighted →
Ruins → Buried. Decay onset after ~3 quiet days (weekend-safe), ruins ~10+, scale regression
only after Ruins; "meaningful burn" day-threshold resets the clock. Recovery: tokens count ~5×
toward re-reaching `peakScaleIndex`, normal rate beyond it. **The exact numbers are tuning
values, not acceptance criteria** — tasks assert shape (monotonicity, ordering, ratios), and
T-013's scenario gallery exists to tune feel by eye without touching any test.

## 3. Risks and rollback

| Risk | Mitigation |
|---|---|
| **Stats field names unknown** until run against the installed CLI | T-001 is the first task; adapter (`src/stats.js`) is the only module naming raw fields; recorded fixture pins the contract; `assert-stats-shape.mjs` re-checks the live CLI on demand (field rename in a cornercase upgrade fails loud, holds last-known state, never corrupts) |
| **Unbounded-scale render performance** (megastructure cities) | Scene generator emits aggregated LOD primitives, never per-building at high scale; deterministic primitive-count score (`scripts/lod-score.mjs`) with a hard bound (<= 20k at every probe scale) and a ratchet task (T-014) to drive it down |
| **Decay/growth feel is wrong** (too punishing / too flat) | Every constant in one `src/tuning.js`; T-013 renders a 6-state canonical gallery (fresh, boom, stale, blighted, ruins, recovery) for eyeball tuning; invariant guards assert shape, not numbers, so tuning never breaks tests |
| **Artifact-publish mechanics** (Claude artifact = paste/upload one HTML; no API) | Self-containment asserted by test (no external `src`/`href`); <= 300 KB budget on `city.html` (T-010); E2E smoke opens the file from a clean copy (T-015) |
| **Hook/service runtime semantics** (hook cwd, env propagation, service restart policy) unverified | Logging probes at T-011/T-012 before wiring is declared done; poke-file trigger + 60s poll fallback means a mis-fired hook degrades to "refresh within a minute", never breaks |
| **This folder is currently inside the Voris working tree** | Publish requires its own public repo with the `cornercase-plugin` topic; T-015 includes the extraction/publish checklist. Nothing here touches Voris code |

**Rollback:** the plugin is purely additive and local. Disable = stop the service / remove the
plugin; `CORNERCASE_PLUGIN_STATE` survives `remove` by platform design, so reinstalling resumes
the same city; deleting the state dir is the full reset. No external services, no data egress
(numbers-only by platform design).

## 4. Workflow

Stages run in order. The three fanout groups were **downgraded to agentic** at plan-verification
(2026-10-19): the folder has no own git tree yet (it lives inside the Voris working tree), so
parallel implementers would contend on one `.git` index and a whole-tree gate — file-disjointness
alone does not make them parallel-safe. Build therefore runs tasks sequentially; only T-014
(ratchet) uses its own branch/worktree.

| Stage | Tasks | Parallel? |
|---|---|---|
| 1 | T-001 (stats contract) → T-002 (scaffold; runs the one `npm install`) | sequential |
| 2 | T-003 (scale/economy sim), then T-004 (stats adapter) | sequential (was fanout:core) |
| 3 | T-005 (vitality/decay/recovery sim), then T-006 (state store + baseline) | sequential (was fanout:sim2) |
| 4 | T-007 (invariant guards, mutation-checked) | solo — mutation flips shared sources RED; never parallel |
| 5 | T-008 (scene generator + LOD score script) | solo |
| 6 | T-009 (isometric canvas renderer + themes) | solo |
| 7 | T-010 (artifact assembler + cosmetics + size budget) | solo |
| 8 | T-011 (service loop + poke trigger) | solo |
| 9 | T-012 (manifest wiring: hook + action), then T-013 (scenario gallery & tuning) | sequential (was fanout:polish); T-014 (LOD ratchet) on its own branch/worktree |
| 10 | T-015 (E2E smoke + publish readiness) | solo — final gate |

The pure model (T-003/T-005) and its guards (T-007) are complete and verified before any renderer
(stage 5+) or live plugin wiring (stage 8+) exists, per the sequencing requirement.

Task details and acceptance criteria: `tasks.md`.

## 5. Plan-verification (2026-10-19)

Adversarial pass — 4 lenses (find) × 2 skeptics (refute), 28 agents. 7 findings confirmed, 5
refuted. All confirmed findings applied:

- **Blockers ×2 + Major ×1 (proof commands):** `node --test test/` (directory form) exits 1 on the
  pinned Node v22.23.2 regardless of results — it resolves `test/` as a module entry. Fixed in
  T-013 and T-015 proofs/acceptance and the T-002 `package.json` test script → bare `node --test`
  (auto-discovers `test/`). Per-file proofs (`node --test test/x.test.js`) were always correct.
- **Major ×2 (fanout safety):** `fanout:core` (T-003/T-004) and `fanout:sim2` (T-005/T-006) not
  provably parallel-safe in a shared git tree → downgraded to agentic (and `polish` too, for
  consistency; see §4).
- **Major ×2 (L172 guard vacuity):** T-008 LOD-budget and T-010 self-containment are guard
  assertions with no mutation-check → mutation-check added to each task's acceptance criteria.

Refuted (not acted on): a fanout:polish-specific test-file race (resolved by the downgrade
anyway), a T-007-dependency DAG concern, and three others.
