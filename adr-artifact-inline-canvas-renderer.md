# ADR: City artifact is one self-contained HTML with an inline canvas renderer

> Standalone cornercase plugin — plain `adr-<slug>.md` in the plugin folder, not `docs/adr/`.

**Status:** accepted (2026-10-19, at `/flow:planning` for Tokenopolis)

## Context

The city must be shareable two ways: opened locally from an `[[actions]]` menu entry, and pasted
into a Claude conversation as an artifact. A Claude artifact is effectively a single HTML document
with no guaranteed network access, so external `<script src>`/`<link href>` references are
non-starters. The spec also wants the city "alive" — subtle motion tied to recent vitality — and
the scale axis is unbounded, which makes pre-rendering to pixels either enormous (large city) or
lossy (fixed resolution). The renderer therefore has to make level-of-detail decisions at draw
time.

## Decision

The service writes a single self-contained `city.html` that embeds the current city-state JSON and
the full isometric canvas renderer inline; all drawing happens procedurally in the browser when
the file is opened, from the embedded state.

## Alternatives considered

- **Pre-rendered PNG embedded as a data URL** — lost: file size scales with city size, motion is
  impossible, and LOD would have to be decided blind at generation time for an unknown viewport.
- **Server-side SVG generation** — lost: SVG node count grows with the city (a megastructure city
  is tens of thousands of elements), killing both file size and open-time performance; canvas
  draws the same scene from a compact scene description.
- **HTML shell + external renderer.js** — lost: breaks the moment the file is shared as a single
  artifact or moved; self-containment is the whole point.
- **A served web app** — lost: violates "runs locally, zero config, safe to forget"; nothing to
  share as a file.

## Consequences

- Good: one file is simultaneously the local view and the shareable trophy; works offline; motion
  and viewport-aware LOD come for free because drawing happens at open time.
- Good: renderer code is authored as normal tested modules and inlined by the assembler at
  generation time — the artifact is a build product, not hand-maintained HTML.
- Bad: total artifact size (renderer + state) needs an explicit budget (<= 300 KB, checked in
  T-010) so pasting as a Claude artifact stays practical.
- Bad: the renderer cannot be lazily split; everything it needs must be inline, which pushes
  toward aggressive LOD/aggregation (ratchet task T-014) rather than asset richness.
