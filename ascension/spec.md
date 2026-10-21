# Ascension & Fallout — spec

A 60-day arc with a twist ending. Each day the city gets a **gift** — a special car, animal, crowd,
landmark, or service (airport, harbour, stadium, zoo…) — that makes it busier and grander. On **Day 60**
the gift is **"AI Reached Consciousness"**: a dazzling modern revamp, then a **nuclear downfall** to the
wasteland. The game then **flips**: burning tokens no longer builds — now **restraint recovers**. Step
away from AI, burn less, and the wasteland slowly heals back to a living city. Recover fully and the
city is reborn; the cycle can begin again.

> All original work. Builds on the existing sim/renderer; no third-party assets or code.

## Why

Tokenopolis's core is "burn more → bigger city." This arc gives that core a **narrative** and then
subverts it: an escalating 60-day build-up, a singularity climax, and a survival act where the winning
move is to *stop*. The flip reuses machinery we already have — the decay clock already rewards recent
burn and punishes idleness; the Fallout era simply **inverts** it, so idleness heals. That symmetry is
the whole payoff: the same signal, read backwards.

## The three parts

### Part 1 — A living city (movement + life aligned to the metrics)

Richer ambient life, every bit of it scaled by variables we already track, so a bigger/busier/healthier
city visibly teems and a struggling one goes quiet:

- **More people & cars** — density scales with `population` / `scaleIndex` and `vitality` (today it's a
  flat count). Rush-hour feel on bigger cities.
- **Animals** — birds over parks, fish/boats offshore, wildlife on the fringes; counts scale with
  `park` zones + overgrowth.
- **Boats & planes** — only once the matching **service** gift exists (harbour → boats, airport →
  planes). Traffic on the water, approach paths in the sky.
- Everything respects the existing gates: **stale** cities empty out, an **outbreak** replaces traffic
  with shamblers, **night** lights the windows, **districts** tint the flow.

### Part 2 — Daily gifts (Days 1–59)

- **One gift per day since install** (`day = floor((now − installedAt)/DAY) + 1`). On the first
  tick of a new day the next unclaimed gift is granted automatically — a small "Day N: <gift>" banner +
  a chronicle entry. (The day index is injectable so we can test/demo Day 60 without waiting.)
- **Gift types:** special **cars** (ambulance, limo, food truck), **animals** (a park deer, harbour
  gulls, a zoo), **crowds** (a festival, a market), **landmarks** (observatory, cathedral, tower),
  and **services** that unlock behaviour — **harbour** (boats), **airport** (planes), **stadium**,
  **university**, **power plant**. Gifts persist in `state.gifts` (unlocked set) and render as added
  entities/landmarks keyed off the current scale.
- Gifts are **cosmetic/structural** — they enrich the city but don't change the burn economy. They
  accumulate; by Day 59 the city is at its liveliest.

### Part 3 — Day 60: the Singularity → Fallout (the flip)

- **Day 60 gift = "AI Reached Consciousness."** A short **Ascension**: a modern revamp — the whole city
  flares to a gleaming peak (max glow, chrome, a one-time orchestrated animation), its proudest moment.
- Then the **nuclear downfall**: a blast, the city is razed, the theme snaps to **wasteland**, and the
  sim enters a new **era: `fallout`**.
- **The flip (`era: 'fallout'`).** Recovery is driven by the **inverse** of the normal clock:
  - **Idle / low recent burn → the land heals** (a `recovery` meter 0→1 fills).
  - **Burning hard → setback** (recovery drains; the waste lingers).
  - "Stop using AI, less tokens now wins." The HUD shows **Recovery %** instead of the build readouts,
    and the act button's framing changes ("the land needs rest").
- **Rebirth.** At `recovery == 1` the city is **reborn** green and thriving; the era flips back to
  `build`, and a fresh 60-day cycle can begin (gifts earned are remembered as reappearing blueprints).
  The arc is a loop: **build → ascend → fall → recover → build**.

## How it maps to the code

- **Era + day:** `sim.era` ('build' | 'fallout') and `sim.recovery` (0..1) on the sim block;
  `state.gifts` ({ claimedThroughDay, unlocked: {id:true} }). `day()` from `install.installedAt`.
  All backward-compatible defaults (era 'build', recovery 0, no gifts) → no migration.
- **The flip** lives in `condition.js step()`: a `fallout` branch where `recovery` rises with
  `daysSinceBurn` (idle) and falls on a meaningful-burn tick — the mirror image of the decay/ruins path.
  In `fallout`, scale/economy track `recovery`, not `builtTokens`.
- **Gifts:** a pure `src/gifts.js` (the 60-entry catalog + `giftsForDay(day)` claim logic + what each
  unlocks); `tick.js` claims the day's gift and chronicles it; `state.gifts` persists.
- **Entities/services:** `scene.js` adds `services` (from unlocked gifts) + entity spawn hints;
  `draw.js` gets layers for boats, planes, animals, denser crowds, and the new landmarks/services, each
  gated on the existing metrics; `ambient.js` gets the Ascension flare + nuclear flash overlays.
- **HUD/artifact:** a **Day N / gift** line, a **Recovery %** readout + different framing in `fallout`,
  the Ascension + nuclear climax animations, and the theme snap to wasteland.
- **Achievements/chronicle:** "Singularity", "Survivor" (reached rebirth), per-service unlock chimes.

## Phasing (build order)

1. **Living city** — entity/movement scaling + animals (Part 1). Independent, shippable on its own.
2. **Gifts 1–59** — `gifts.js` + claim/persist + render the services/landmarks/entities they unlock.
3. **Day 60 climax** — Ascension revamp + nuclear transition + era flip to `fallout`.
4. **Fallout era** — the inverted recovery mechanic + Recovery HUD + rebirth loop.

## Acceptance criteria (high level)

- People/cars/animals/boats/planes scale with population/scale/vitality/zones and the service gifts;
  stale/outbreak/night/district gates still hold; suite guards (z-order, grayscale, determinism) pass.
- A new day grants exactly one gift (injectable day); gifts persist and render; Day 60 triggers the
  Ascension→nuclear→fallout transition once.
- In `fallout`, idle ticks raise `recovery` and burn ticks lower it (the inverse of `build`); at 1.0 the
  era flips to `build`, the city reborn. New guard tests for the flip and the day/gift logic.
- Zero new deps; `city.html` ≤ 300 KB, self-contained; the node:vm boot test passes.

## Open decisions (recommended defaults in **bold**)

1. **"Day" = calendar days since install**, one gift per day, auto-granted. (Alt: per N meaningful-burn
   milestones. Lean calendar — matches "daily".)
2. **The flip:** in `fallout`, **idleness heals / burning sets back** (the exact inverse of the decay
   clock), win at 100% recovery. (Alt: a fixed real-time countdown. Lean the inverse-clock — it's the
   poetic "use less AI to recover.")
3. **After rebirth:** **loop back to `build` and restart a new 60-day cycle**, remembering earned gifts
   as reappearing blueprints. (Alt: one-and-done ending. Lean the loop — replayable.)
4. **Gifts:** **auto-granted & cosmetic/structural** (no economy change, no choice). (Alt: let the
   player pick each day. Lean auto — simpler, and choice already exists via Choose-an-act.)
5. **Scope now:** **spec the whole arc, build in the 4 phases above** (start with Phase 1), so each lands
   verified. (Alt: attempt it all at once.)
