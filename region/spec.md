# The Region ("same country") — spec

Let people running Tokenopolis on their own machines **join a shared country** and see each other's cities
grow — neighbours on the horizon, a regional leaderboard, and each other's milestones scrolling through the
**Tokenopolis Times**. Each city stays its owner's private, local mirror; the region is a thin, opt-in
*shared view* stitched together through a **shared git repository** — no server, no backend, no cost.

> **Opt-in, tiny, privacy-first + offline-rendered.** Nothing is shared unless you join; only a small
> "postcard" leaves your machine; the artifact itself makes no network calls (the region is fetched
> keeper-side and baked in). See Privacy + Non-goals.

## Why

Tokenopolis is a living mirror of *your* coding. The one thing a solo mirror can't give you is **company** —
a sense that your town is one of many, that a teammate's metropolis just hit the Singularity while yours
recovers from an outbreak. The distant towns already on the skyline are begging to become real. And it
compounds the chronicle: a solo feed becomes a *country's* feed. The hard part is doing it without betraying
the local, offline, privacy-respecting ethos — so the design shares the **minimum** and keeps every city its
owner's source of truth.

## The shared unit — a city "postcard"

Each keeper publishes one small JSON (a few hundred bytes), and nothing else:

```
{ schema: 1, handle, cityName, nearCity: null|"Haarlem", scaleName, scaleIndex, sizeIndex,
  population, vitality, economyRating, condition, era, pyromidPct, citySeed, streak, day,
  achievements, updatedAt }
```

- `citySeed` lets a neighbour be drawn as a deterministic silhouette without shipping any pixels.
- **No tokens, no raw events, no IPs, no file paths, no OS username.** `handle` is chosen, not derived.
- `nearCity` is included **only if** you opt into location sharing (default off).

## How it travels — a shared git repo = the country

A **private** git repo is the country. Each participant configures the repo + a `handle`. The keeper runs a
periodic **publish+fetch** cycle (alongside the existing geoweather refresh):

- **Publish:** write `cities/<handle>.json`, commit, push.
- **Fetch:** pull, read every `cities/*.json` → the roster.
- **No conflicts by construction:** each keeper only ever writes *its own* file. A push rejected by a race
  is handled with `pull --rebase` + a bounded retry; disjoint files never collide.
- **Zero backend / zero cost / cross-internet / auditable** — the country is a repo you own and can read.
  Git runs via the system binary (built-in `child_process`), so **no new npm dependency**.

A tiny hosted **hub** (POST/GET a postcard under a region code) is a documented future alternative for
friction-free joining by non-technical people; it is **out of scope** for this spec.

## What you see

- **Neighbours on the horizon.** The countryside's distant-town silhouettes (already rendered in
  `drawCountryside`) become the real cities in your country — each sized by its `sizeIndex`, placed
  deterministically, labelled with `handle` + city name, dimmed when dormant.
- **A region panel.** A compact leaderboard + roster: each city's scale, vitality, era, streak, and who's
  **active now** (fresh `updatedAt`).
- **Regional headlines in the Tokenopolis Times.** Diffing the roster between fetches yields real events —
  "Kees's metropolis reached the Singularity", "Priya's city crossed 1M", "Aert's town is recovering" —
  appended to the chronicle (depends on, and supercharges, the chronicle feature).

## How it maps to the existing code (for the design phase)

- **Config** (`src/config.js`): an optional `region` block `{ repo, handle, shareLocation?, intervalMs? }`,
  validated like `cityName`/`theme`; **absent → feature fully off** (backward-compatible, no migration).
- **New `src/region.js`** (keeper-side, modelled on `src/geoweather.js`):
  - `cityPostcard(state, config, env)` — **pure**, builds the postcard from the readout/state (+ geoweather
    `env` for `nearCity` only when `shareLocation`).
  - `publishAndFetchRegion({ repoDir, handle, postcard })` — async; clone-if-missing, write own file, commit,
    `pull --rebase`, push (retry on race), read `cities/*.json`. **Failure-tolerant: never throws, never
    blocks the keeper; returns the roster or the last-good cache.** `getCachedRegion()` like geoweather.
- **`service/main.js`**: when `config.region` is set, start a crash-safe region refresh loop (immediate +
  interval) exactly like the geoweather loop, and `writeArtifact(...)` after a successful fetch so neighbours
  land in the baked HTML.
- **`src/artifact.js` `cityData`**: embed the roster (minus self) + counts into the readout (so `/state`
  carries it); render the region panel; feed regional headlines into the chronicle.
- **Renderer** (`src/render/draw.js`): draw neighbour silhouettes in place of the procedural distant towns,
  sized/placed from roster data passed in as a render param (like `tod`) — **not** part of the deterministic
  local scene, so grayscale/stale still hold (geometry depends on roster data, identical across palettes;
  static, so tick-independent).

## Privacy

- **Off by default.** No `region` config → nothing is published, fetched, or shown.
- Only the **postcard** is shared — coarse stats + a seed, never tokens, events, IPs, paths, or OS user.
- `shareLocation` defaults **off**; `handle` is your choice, not your machine's.
- A **private** repo gates the country; leave anytime by deleting your `cities/<handle>.json` (and the keeper
  stops publishing when the config is removed).
- Nothing is logged that isn't in the postcard.

## Acceptance criteria

- With `region` configured, the keeper publishes a valid postcard (no tokens/IPs/paths/OS-user) and fetches
  the roster on its interval; git/network failures **never crash or block** the keeper (verified like the
  geoweather path).
- The artifact shows neighbour silhouettes (sized by scale + labelled), a region panel (leaderboard +
  active-now), and regional chronicle headlines; baked into the shared artifact (**self-contained, ≤300 KB**)
  and live-updated on the keeper.
- Concurrent keepers don't conflict — each writes only its own file; a push race resolves via rebase+retry.
- **Feature OFF with no `region` config** — byte-for-byte unchanged behaviour (backward-compatible).
- Determinism/grayscale/stale/self-containment guards hold (neighbour data is a render param, not part of
  the deterministic scene); suite green with new tests for `cityPostcard` (pure/no-secrets), the roster
  render, and the no-region default.
- **No new npm dependency** (git via built-in `child_process`); no secrets in the postcard, config, or logs.

## Non-goals

- Not real-time multiplayer — periodic postcard sync, not a live connection.
- No competitive/shared *gameplay* — you **view** neighbours; no trading, attacking, or shared economy. Each
  city stays its owner's private mirror.
- No central server in this spec (the git-repo is the transport; a hub is a future alternative).
- No sharing of raw events, tokens, IPs, file paths, or OS user; no location unless opted in.
- Nothing reverse-engineered from any other game; no new runtime deps, no extra permissions beyond git access
  the user already configured.

## Open questions (for /flow:clarify)

1. Neighbour interaction: labelled silhouettes + panel for v1, with **clickable** horizon cities (a postcard
   popup via a Pyromid-style hit-test) in v2? (Leaning: yes, panel + labels first.)
2. Roster size + layout — how many neighbours on the horizon before overflow spills to the panel only?
3. Staleness — dim neighbours inactive > N days, and drop them after M?
4. Identity — first-come handles, or a stable id + display handle (to survive renames/collisions)?
5. Git auth — assume the participant has push access via their **system git** creds (ssh/credential helper);
   avoid putting any token in `config.json`. Confirm that's the setup we document.
6. Regional headlines — which neighbour transitions earn a Times entry (scale-up, era shift, outbreak,
   rebirth, new record), and how to rate-limit so one busy neighbour doesn't flood the feed.
7. Does the region repo also host an aggregated "country chronicle", or is it derived per-keeper from the
   roster diff? (Leaning: derived per-keeper — keeps the repo a pure postcard store.)
