# ADR: Plain Node.js, zero runtime dependencies, for the Tokenopolis service

> Standalone cornercase plugin — plain `adr-<slug>.md` in the plugin folder, not `docs/adr/`.

**Status:** accepted (2026-10-19, at `/flow:planning` for Tokenopolis)

## Context

The plugin needs a long-running `[[service]]` process that shells out to `cornercase stats --json`,
runs a pure simulation, persists JSON state, and emits a self-contained HTML artifact. It is
distributed as source via a public GitHub repo (marketplace reads the repo directly — no build or
publish pipeline, no review step). Install must be "clone and run": anything that needs a compile
step, a package install at runtime, or a second toolchain raises the install-failure surface for a
toy. The renderer ships *inside* the HTML artifact, so it is JavaScript regardless of what the
service is written in. Node v22.23.2 is present on the dev machine and `node:test` + `node:assert`
cover the whole test surface.

## Decision

The service, scripts, and renderer are plain Node.js (>= 20) ESM JavaScript with **zero runtime
dependencies**; tests run on the built-in `node:test` runner; a single dev-only dependency
(`smol-toml`) exists solely so tests can parse the manifest. No TypeScript, no bundler, no
framework. (`smol-toml` parsing of the manifest shape — array-of-tables, argv-array commands —
was probed at planning time and works under Node 22 ESM.)

## Alternatives considered

- **TypeScript + Vitest** — lost: adds a build step and a toolchain to a repo whose consumers
  clone-and-run; the type surface is small (one state shape, one stats shape) and contract tests
  against recorded fixtures cover the same seam.
- **Python** — lost: capable for the service, but the renderer is JS inside the artifact either
  way, so Python means two languages and two test runners for one tiny plugin.
- **Go / Rust binary** — lost: the marketplace distributes source from a git repo; shipping
  binaries means per-platform release engineering for a toy. The `[[build]]` hook could compile at
  install, but that trades a zero-step install for a toolchain prerequisite.
- **Bun / Deno** — lost: less likely than Node to be present on a cornercase user's machine, and
  buys nothing here.

## Consequences

- Good: clone-and-run install; one language end to end (service, tests, artifact renderer); the
  pure sim module is importable unchanged by both the service and test files.
- Good: no `[[build]]` section needed in the manifest; nothing to compile or bundle.
- Bad: no static types — the stats-adapter and state-store seams must be guarded by contract
  tests against recorded fixtures instead (tasks T-001, T-004, T-006).
- Bad: `smol-toml` is a dev dependency, so contributors run one `npm install` before `node --test`
  (runtime users never do).
