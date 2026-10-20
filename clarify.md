# Tokenopolis — Clarifications

> Resolved 2026-10-19 via `/flow:clarify`. Open questions sourced from `spec.md` §10.
> Standalone cornercase plugin — not a Voris feature.

## Decisions

### 1. Scope — one city per user
A single city fed by all cornercase work on the machine. Maps to `stats.json`'s machine-wide
lifetime totals; avoids per-project token attribution that `stats` doesn't expose.

### 2. Interaction — light cosmetic touches
Ambient growth/decay, plus two cosmetic touches: **name the city** and **pick a visual theme**.
No building placement, no gameplay — holds §8's "not a hands-on builder" non-goal.

### 3. Visual style — isometric pixel, SimCity-style
Classic SimCity 2000 homage. Accept the procedural-generation cost; use level-of-detail /
aggregation to keep unbounded scale renderable.

### 4. Decay onset — days
Decline after a few quiet days; ruins over a week+. Weekends don't hurt; a real absence shows
wear. (The "meaningful burn" threshold that resets the decay clock is a build-time tuning value.)

### 5. Growth pacing — front-loaded / logarithmic
Fast early milestones (village→town in the first sessions), each later one needing exponentially
more burn. Idle-game feel: early delight, aspirational late game.

### 6. Underground frontier — opens at Metropolis
Downward building unlocks once the surface is dense/maxed. Mid-late game, earned.

### 7. Ruin recovery — much faster (~5×+)
Near-instant snap-back to former glory on return. Very forgiving: decay is a real setback, but
reversal is quick once you resume burning.

### 8. First run — grow from zero
Install shows bare land; the city grows only from burn *after* install. Everyone gets the full
village→metropolis arc.

**Implication (spec amendment):** "lifetime cumulative" (§4) is **baselined at install** — the
plugin records the `cornercase stats` total at install time and counts burn *forward* from there.
The 26-week history is **not** used to seed the starting city.

## Not asked — defaulted (revisit if wrong)

- **Accessibility:** condition must not rely on color alone (also density / structure / labels);
  legible contrast in the artifact.
- **i18n:** single-user personal toy; English labels; not a goal.
- **Roles:** single user; no roles or sharing permissions beyond publishing the artifact.
- **Errors / data gaps:** if `cornercase stats` is unavailable, hold last-known city state —
  never reset or crash; resume on the next successful read.
- **Performance:** unbounded cities need LOD / aggregation so the artifact stays smooth.
- **Themes (examples, not locked):** Temperate, Coastal, Desert, Nordic, Neon.
