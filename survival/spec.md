# Survival Expansion — spec

A survival layer for Tokenopolis: an **Outbreak** that grips the city and is fought back by burning,
a gritty **Wasteland** theme, and **deeper decay visuals** (boarded windows, overgrowth). The feeling
is the isometric-survival genre — a city under pressure, holding on, reclaimed by nature when idle.

> **100% original.** This draws on the *genre and mood*, not on any game's assets, code, or data.
> Nothing is reverse-engineered or copied from Project Zomboid (or any other product). See Non-goals.

## Why

Tokenopolis is already a survival-shaped sim — it grows from burn, decays when idle, crumbles into
ruins, and recovers ~5× faster (brownfield rebuild). It has a 50-act disaster deck, day/night, seasonal
weather, and a decay→ruins→recovery arc. What it lacks is a *survival-under-siege* beat: a shock that
lingers, that you actively claw back from by working. That beat is the most characteristic thing in the
genre, and it maps cleanly onto the burn-is-the-economy core: **burning tokens is how you survive.**

## Scope

### 1. The Outbreak (a lingering event, not a one-tick act)

Today "Outbreak" is one of the 50 common acts — a single `actTokens` dip. This promotes it to a
**persisted state** with its own arc, so the city visibly struggles and recovers over time.

- **Onset.** An outbreak begins when the **Outbreak** act fires (or a new **Zombie Outbreak** legendary,
  rarer and more severe). The city enters an *infected* state with a severity (0..1).
- **While infected:**
  - population and economy drop sharply (beyond the normal act dip),
  - **streets empty** — citizens/traffic vanish (we already gate citizens on vitality; infection forces
    them off),
  - **lights go dark** — the window-glow bloom is suppressed; the city reads abandoned at night,
  - a low, sickly **fog/tint** sits over the scene (screen-space, subtle, theme-tinted),
  - a few original **shambler** dots wander the roads (simple pixel markers — our own, never anyone's
    sprites), thinning out as the city recovers,
  - the HUD shows an **Infected** badge + a "severity" / "days to clear" readout.
- **Recovery is burn.** Severity decays as you burn tokens (the same recency signal the decay clock
  uses). Clear it and the lights come back, citizens return, the fog lifts. If you go idle while
  infected, it worsens (compounding with normal decay).
- **Resolution.** A fully-cleared outbreak records a chronicle entry ("Survived the outbreak") and can
  earn an achievement (**Quarantine Lifted**).

### 2. Wasteland theme

A 10th theme, `wasteland`: ash-grey sky, rust-and-olive buildings, sickly amber accent, muted greens —
grit over gloss. Follows the exact `THEMES` key shape (drops straight into the existing renderer and the
config theme list). Pairs naturally with the Outbreak but selectable any time.

### 3. Deeper decay visuals

The decay arc currently shows as shorter/collapsed buildings + a scale drop. Add two structural signals
(geometry, so they stay grayscale-safe and read without color):

- **Boarded windows.** From `Declining` onward (and while infected), window rows render as **planks**
  instead of lit glass — a survival tell.
- **Overgrowth.** As the city sits idle/decayed, **vegetation reclaims it** — creeping green on roofs,
  cracked streets, a few saplings on empty lots. Scales with days-idle / condition; recedes as you
  rebuild.

## How it maps to the existing code (for the design phase)

- **Sim/state:** an `infection` block on `sim` (`severity`, `startedAt`), decayed by burn in
  `src/sim/condition.js`'s `step()` (same recency math as the decay clock); defaults make it backward-
  compatible (no migration). Economy already reads `effectiveBuilt` + vitality — infection layers a
  multiplier.
- **Acts:** `src/acts.js` — the `outbreak` act (and a new legendary) set `infection` via `applyAct`
  rather than only moving `actTokens`. The existing deck/cooldown is untouched.
- **Scene:** `src/render/scene.js` — per-building `boarded` and `overgrowth` flags derived from
  condition/idle + infection, alongside the existing `damage`/`collapsed`. Pure, deterministic, and the
  shape-parity + grayscale guards still hold.
- **Renderer:** `src/render/draw.js` — draw planks over boarded windows, vegetation patches, and the
  shamblers layer; `src/render/ambient.js` — an infection fog overlay. Citizens already gate on vitality;
  add an infection gate.
- **Theme:** `src/render/themes.js` + `ALLOWED_THEMES` in `src/config.js` (one line, like the v0.4 themes).
- **HUD/artifact:** `src/artifact.js` `cityData` embeds infection severity + the Infected badge; a
  chronicle event + achievement via `src/history.js` / `src/progress.js`.

## Acceptance criteria

- Firing the outbreak act sets `infection.severity > 0`; the artifact shows the **Infected** badge,
  dark/empty streets, fog, and shamblers.
- Burning tokens reduces severity over ticks; at 0 the city visibly recovers (lights, citizens, no fog)
  and a chronicle entry + achievement are recorded.
- Going idle while infected worsens severity (bounded).
- `wasteland` is selectable via `config.json` `"theme"` and passes the theme shape-parity test.
- Boarded windows appear from `Declining`+; overgrowth appears with idle/decay and recedes on rebuild —
  both are structural (visible in grayscale), guarded by tests.
- Existing suite stays green; new guard tests for infection decay, the scene flags, and the achievement.
- `city.html` stays ≤ 300 KB and self-contained; zero new runtime deps; the node:vm boot test still passes.

## Non-goals (the IP boundary, codified)

- **No reverse-engineering, extraction, or reuse of any third-party game's assets, code, Lua, data, or
  specific implementation** — not Project Zomboid, not anything else. This feature is built from scratch.
- No zombies-as-literal-clone; the survival beat is abstract (infection severity + recovery), expressed
  with our own minimal pixel art.
- No new external dependencies, no network calls, no new permissions.
- Not a full game loop — Tokenopolis stays an ambient, low-interaction city that reacts to your burn.

## Open questions (for /flow:clarify)

1. Is infection its **own sim axis**, or folded into the existing condition ladder (add `Infected` as a
   condition state)? (Leaning: its own small block, so it can overlap any condition.)
2. Outbreak severity: a continuous `0..1` decayed by burn, or a discrete day-countdown like the decay
   clock? (Leaning: continuous, consistent with vitality.)
3. Does the **legendary "Zombie Outbreak"** replace or sit alongside the common `outbreak` act?
4. Is `wasteland` auto-applied during an outbreak, or purely a user theme choice? (Leaning: user choice;
   the fog/darkness convey the outbreak regardless of theme.)
