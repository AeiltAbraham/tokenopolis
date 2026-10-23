# Named Residents & Living Chronicle — spec

Give the city a **soul**: a small cast of **named residents** and a proper **"Tokenopolis Times"** — a
dated, illustrated chronicle that narrates your coding as a story ("Maya opened a café in the tech
district", "Population crossed 1M", "Old Tom boarded his windows as the decline set in", "The Pyromid hums
louder tonight"). It turns a glanceable city into something you *follow*.

> **100% original + offline.** All text is generated from deterministic templates on-device. No AI calls,
> no network, no third-party content at runtime. See Non-goals.

## Why

Tokenopolis already keeps an event log (`src/history.js`: `appendEvent`, `formatEvent`, cap 60, newest-
first) and `src/tick.js` already records nine event types — `scale`, `ruin`, `recovery`, `milestone`,
`gift`, `pyromid`, `singularity`, `downfall`, `rebirth` — plus act rolls. But the artifact only shows the
last **8** flat lines, with no dates, no cast, no voice. The infrastructure for a chronicle exists; what's
missing is the *character*. Named residents + a richer feed are the single biggest "soul-per-effort" lever,
and they're a pure function of state we already have, so they cost nothing at runtime and stay deterministic.

## Scope

### 1. Named residents (a deterministic cast)

A small roster derived purely from `citySeed` (stable across ticks + renders), sized to the city:
~2 at a hamlet, growing to ~10 at a metropolis.

- Each resident: `{ name, archetype, district }`. **Names** from a built-in pool (seeded, de-duplicated).
  **Archetypes** are flavour roles — café owner, engineer, gardener, night-owl shopkeeper, busker, old-
  timer, courier, teacher. **District** is the burn source they belong to (`tech` = Claude Code, `ops` =
  cornercase agents), so the cast mirrors *how* you burned.
- Pure helper `residentsFor(citySeed, scaleIndex, sourceMix)` in a new `src/residents.js` — no I/O, no clock.
- Exposed on the readout so the artifact can list a few "notable residents" and the chronicle can name them.

### 2. Resident-driven vignettes (woven into the chronicle)

City transitions become *stories* that sometimes name a resident, chosen deterministically:

- **growth** (scale-up, a district filling in) → "Maya opened a café as the commercial quarter filled in."
- **decline / ruin** → "Old Tom boarded his windows as the decline set in."
- **recovery / rebirth** → "The buskers are back on 3rd — the city's breathing again."
- **gift / festival** → "Priya cut the ribbon on the new {landmark}."
- **pyromid / singularity / downfall** → resident reactions to the big beats.
- **ambient** (quiet days) → at most **one** small seeded vignette per day so the feed never goes dead
  ("A calm day. Tom repainted his shutters."). Deterministic by `day`; skippable.

A helper `vignette(type, event, residents, seed)` returns a flavoured label (a template pool per type).
It *decorates* the existing `appendEvent` calls in `tick.js` — the event types and cap are unchanged.

### 3. The "Tokenopolis Times" panel

Upgrade the 8-line list into a real chronicle, on the live page and baked into the artifact:

- A dated, **categorised** feed (an icon per event type), newest-first, scrollable, showing ~20 with the
  rest reachable up to the 60 cap — not just 8.
- A header ("Tokenopolis Times") and a small **notable-residents** strip (a few named citizens + archetype).
- Live-updating on the keeper via the `/state` poll; a static snapshot (last ~20) baked into the shared
  artifact so a shared city still reads as a story.

## How it maps to the existing code (for the design phase)

- **New `src/residents.js`:** `residentsFor(seed, scaleIndex, sourceMix)` + name/archetype pools +
  `vignette(type, event, residents, seed)`. Pure, deterministic, unit-testable, zero deps.
- **`src/history.js`:** add icons/labels for any new display categories; cap (60) + newest-first unchanged.
- **`src/tick.js`:** at each existing `appendEvent`, pass the event through `vignette(...)` so the stored
  label can be resident-flavoured; add the once-per-day ambient vignette (seeded by `day`, deterministic).
- **`src/artifact.js` `cityData`:** expose `residents` + a longer slice of `history` (not just 8) for the
  panel; render the Times panel + residents strip; the existing `/state` already carries the readout, so
  `applyLive` gains a chronicle-list update (today it only updates scalar fields).
- **Guards:** everything stays a pure function of (state, seed) → the scene-determinism, self-containment,
  and size guards hold; no renderer geometry changes, so grayscale/stale are untouched.

## Acceptance criteria

- `residentsFor` is pure + deterministic (same seed → identical roster); size scales with `scaleIndex`;
  names are unique within a city — covered by a test.
- `vignette` is deterministic (same type+event+seed → same line), stays within the template pools, and
  never overflows the 60 cap — covered by a test; key transitions (growth, decline, recovery, gift,
  pyromid, era) each produce a resident-named entry at least some of the time.
- At most one ambient vignette per day; a day with no events still shows one line; a busy day is not spammed.
- The Times panel renders dated, categorised, scrollable entries (~20+) on the live page and updates via the
  poll; the artifact bakes a static last-~20 snapshot; the residents strip shows named citizens.
- No AI/network/deps at runtime; `city.html` stays ≤ 300 KB + self-contained; the node:vm boot test passes;
  the full suite stays green with new guard tests for `residents.js` + the vignette determinism.

## Non-goals

- **No runtime AI or network.** All lines come from deterministic on-device templates — never a Claude/API
  call, never a fetch. (The chronicle must work inside the self-contained, offline artifact.)
- Residents are **flavour entities, not simulated agents** — no needs, pathing, or AI; they don't move on
  the map (they *narrate*).
- No new dependencies, permissions, or external content; nothing reverse-engineered from any other game.
- Not a life-sim; Tokenopolis stays an ambient city that reacts to your burn.

## Open questions (for /flow:clarify)

1. Ambient vignettes on quiet days — in, and at one/day? (Leaning: yes, one/day, so the feed stays alive.)
2. Roster size curve — exact counts per scale, and do residents *persist by identity* across a rebirth, or
   re-roll with the new cycle? (Leaning: re-roll per cycle, like the seed-driven layout.)
3. Times panel — a **new** panel, or upgrade the existing history list in place? (Leaning: upgrade in place
   + rename, to keep the HUD compact.)
4. Do vignettes lean on the **district** (tech vs ops) so the story reflects Claude-Code-vs-agent burn?
5. How many "notable residents" to surface in the strip (all, or the 3 most recently mentioned)?
