# Tokenopolis — Spec

> A cornercase plugin that turns token usage into a living city.

| | |
|---|---|
| **Working name** | Tokenopolis *(alts: Burnopolis, Sprawl, CTRL-City)* |
| **Type** | Standalone cornercase plugin — **not** a Voris feature |
| **Status** | Signed off + platform-grounded (burn signal = `cornercase stats`) — pending `/flow:clarify` (§10) |
| **Date** | 2026-10-19 |
| **Distribution** | Plugin via usecornercase.dev/plugins/ · City via Claude artifact |

This spec is deliberately **what / why only** — no tech stack. It lives outside the Voris
flow (no owner-prefixed branch, no `docs/specs/NNN` numbering, no ADR). It is its own thing.

---

## §1 — Summary

A cornercase plugin that turns token usage into a living city. You start as a tiny low-tech
village; as you burn tokens across sessions, the city grows — more zones, denser buildings,
better infrastructure, higher tech — and its economy improves. The city is a persistent,
shareable Claude artifact.

It is explicitly **more fun than helpful**: ambient delight, not a productivity tool.

## §2 — Why

- **Make the invisible visible.** Token burn is normally an abstract, slightly guilt-tinged
  cost. This reframes it as visible progress — every session leaves something built.
- **Delight & momentum.** A village-to-metropolis arc gives a long, low-pressure reward loop
  that spans weeks of normal work.
- **Shareable.** The city is an artifact you can show off ("look how much I've built") — which
  is the whole point of the fun.
- **Zero workflow friction.** It observes usage passively; it never changes how you code or
  gates anything.

**Non-goal (stated early):** this is not a cost-control or budgeting tool. "More burn = better
city" is intentionally the opposite of frugality — it's a toy.

## §3 — Core mechanics (what the city is made of)

Borrowing SimCity's grammar, mapped to usage:

- **RCI zones.** The city has Residential, Commercial, and Industrial zones that grow in rough
  balance as it levels up — a believable skyline, not a random blob.
- **Infrastructure.** Roads → power → water → transit → data/comms. Each tier appears as the
  city advances, visibly connecting the zones.
- **Land value & density.** Buildings start as low-density shacks and densify into towers as
  coverage (infrastructure + amenities) rises. Higher land value = taller, shinier buildings.
- **Amenities.** Parks, schools, landmarks — flavor rewards that appear at milestones and make
  the city feel alive.
- **Economy readout.** Headline numbers the city displays: **Population**, **Treasury**, and an
  **Economy rating**. More burn pushes all three up.

## §4 — Growth & decay model

The city is a living economy with **no fixed ladder and no floor** — it runs on activity (burn).

**Growth — indefinite, both directions.**
- **Up:** sustained burn pushes population and skyline ever higher. No era cap — towers keep
  rising procedurally, past "metropolis" into megastructure territory.
- **Down:** late growth also goes underground — subways, sub-levels, vaults, geothermal — a
  second frontier that opens once the surface is dense.

**Decline — into ruins, and backwards.**
- Stale burn doesn't shrink the city neatly; it lets it **rot**: abandoned towers, cracked
  roads, blackouts, blight, depopulation.
- Prolonged neglect regresses *backwards*, but as **ruins of what you built** — a ruined
  metropolis, not a quaint village. Over time it can sink / bury.

**Recovery.** Return and burn → vitality climbs and the city **revitalizes**: repairs,
repopulation, a visible comeback arc. Decay is reversible — pressure, not punishment.

**Two forces drive it:**

1. **Built potential — lifetime cumulative.** Total tokens ever burned is the city's history.
   Since it is *no longer a floor*, it instead (a) sets the **scale of the ruins** — a big past
   leaves big ruins, visible history; and (b) speeds **recovery** — foundations survive, so
   reviving from ruin is faster than first-time growth (brownfield redevelopment).
2. **Vitality — recent burn = the live economy.** A rolling measure of recent burn sets
   prosperity. Heavy recent burn → **boom** (full occupancy, lit windows, busy industry, happy
   citizens, rising land value). Quiet → **stale** → decline across infrastructure, public
   health, land value, industry, and happiness.

**Measuring burn (grounded in the platform).** cornercase's own `cornercase stats` / `stats.json`
exposes aggregate token counts — tokens **in, out, and cache** — as **lifetime totals** plus
**hourly buckets (26 weeks)** and **24h / 7d** windows, and as *numbers only* (no prompts, models,
paths, or conversation ids). That is the burn signal, and it is literal — not a proxy:
- **Lifetime total** → built potential (scale, ruin-scale, recovery speed).
- **Recent windows + hourly buckets** → vitality and the decay clock.

*(Optional later: `cornercase usage` exposes plan limits — 5-hour & weekly — a possible
"economic pressure" flavor signal.)*

## §5 — State spectrum (two axes, open-ended)

The city's state is a pair: **scale × condition**. A thriving metropolis and a ruined
metropolis share a scale but look nothing alike.

- **Scale axis (vertical growth, unbounded).** Named milestones going up:
  Hamlet → Village → Town → City → Metropolis → Megalopolis → Arcology → Megastructure → …
  continuing procedurally past that, plus the **underground** frontier opening at high scale.
  No top.
- **Condition axis (the living economy).** Where recent burn lands you within your scale:
  **Thriving → Stable → Stagnant → Declining → Blighted → Ruins → Buried.**
  Boom lifts you up this axis; staleness drags you down.

Growth raises scale. Vitality sets condition. Decay pulls condition down first, then — if
neglect persists — scale regresses into ruins.

## §6 — The artifact (what you see & share)

A single rendered city view — the shareable Claude artifact — showing:

- **The city itself**, drawn to its current scale × condition: lit, dense, busy when thriving;
  dark, cracked, overgrown when declining.
- **Economy readout:** population, treasury, economy rating, and current **vitality / momentum**
  (booming or going stale right now?).
- **Lifetime panel:** total tokens ever burned, all-time peak scale, and a **decay clock** (how
  long since meaningful burn → how close to decline).
- **Alive:** subtle motion tied to recent activity — cranes and construction mid-session,
  stillness and drift when idle.
- **Shareable by design** — the artifact is the trophy; showing it off is the point.

## §7 — Distribution & operation

- **Runs locally.** It observes token usage during normal cornercase use; city state (lifetime
  total, peak, decay clock) persists on your machine so it survives across sessions.
- **Passive & zero-config.** Install and forget — it never prompts, gates, or slows work.
- **Shared two ways.** The *plugin* is distributed via **usecornercase.dev/plugins/** (how
  people install it); the *city* is shared as a **Claude artifact** (how you show it off).
- **Privacy.** It watches only usage *magnitude* (token counts & timing) — never the content of
  your prompts, code, or sessions.

**Plugin shape (from the cornercase plugin API).**
- Manifest `cornercase-plugin.toml` (`id`, `name`, `version`). It declares a background
  **`[[service]]`** that maintains the city, **`[[events]]`** hooks (e.g. on `status` → refresh
  when an agent finishes a work cycle), and an **`[[actions]]`** entry (context `workspace`/`pane`)
  to open the city.
- The service reads token totals from **`cornercase stats`** and writes city state to
  **`CORNERCASE_PLUGIN_STATE`** (`plugins/state/<id>/`) — this survives across sessions and is
  kept even on `remove`, so it is our lifetime + decay-clock store.
- **Publish:** push to a public GitHub repo tagged with the **`cornercase-plugin`** topic; it
  appears in the marketplace (usecornercase.dev/plugins/) within ~an hour, re-read on each
  default-branch commit. No submission or review step.

## §8 — Non-goals

- Not a cost / budget or frugality tool — the ethos is the opposite.
- No judgment: not a productivity score or wall-of-shame.
- Not a hands-on city-builder game — growth is driven by burn, not by placing buildings.
- Not multiplayer or a real economy — the "economy" is a toy metaphor.

## §9 — Success criteria

- First session: a village appears and visibly grows as you burn — immediate delight.
- Over days: lifetime growth feels motivating; a gap shows **decay / ruins**, returning shows
  **recovery** — both legible at a glance.
- The artifact draws a "whoa" / screenshot reaction — it's genuinely shareable.
- Zero friction: never interrupts; safe to forget it's running.
- Honest: scale and condition track *real* burn — no fake progress.

## §10 — Open questions (for `/flow:clarify`)

- **Interaction level:** purely observational, or light touches (name the city, pick a visual
  theme)?
- **Decay timescale:** what counts as "stale" — hours idle? days? — needs a feel.
- **Growth pacing:** token thresholds per milestone; curve shape.
- **Underground trigger:** what scale opens the downward frontier?
- **Ruin recovery rate:** how much faster is brownfield vs first build?
- **Scope:** one city per user, or per-project cities?
- **Visual style:** isometric pixel, flat vector, other?

## §11 — Platform grounding (resolved 2026-10-19)

Verified against the cornercase docs so §4's "burn = tokens" rests on a real interface:
- **Token signal exists and is readable:** `cornercase stats` / `stats.json` gives lifetime +
  windowed token counts (in/out/cache), numbers-only — satisfies both the growth signal and
  §7's privacy stance.
- **No token-count *hook*:** `[[events]]` fire on `opened`/`closed`/`status`/`exited` only, so
  hooks *trigger* refreshes; the numbers come from `stats`, polled by the service.
- **Build-time confirm:** exact `cornercase stats --json` field names via `cornercase stats --help`
  on the installed version.

## Clarifications (resolved 2026-10-19)

Full Q&A in `clarify.md`. Decisions:

| Question | Decision |
|---|---|
| Scope | **One city per user** (machine-wide, from `stats` totals) |
| Interaction | **Light cosmetic** — name the city + pick a theme; no gameplay |
| Visual style | **Isometric pixel, SimCity-style** |
| Decay onset | **Days** of no meaningful burn |
| Growth pacing | **Front-loaded / logarithmic** |
| Underground | Opens **at Metropolis** |
| Ruin recovery | **Much faster (~5×+)** brownfield snap-back |
| First run | **Grow from zero** on install |

**Spec amendment (from "grow from zero"):** "lifetime cumulative" in §4 is **baselined at
install** — the plugin records the `cornercase stats` total at install and counts burn *forward*
from there; the 26-week history is not used to seed the starting city, so the full
village→metropolis arc plays for every new install.
