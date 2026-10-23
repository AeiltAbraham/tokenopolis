// City history chronicle. Pure data + formatting — no I/O, no clock read, no randomness. The sim
// produces moments (a Random Act fires, the scale ladder climbs, the city falls into ruins or claws
// its way back out); this module records each as one entry in a capped, newest-first log and renders
// it as a short one-line headline the HUD can print. The integrator appends to `state.history` at the
// three sim transitions (see the integration note) and feeds the same array to summarize() for the
// lifetime tally.
//
// Event shape — a plain record, serialized into state.json as-is:
//   { at: ISO string, type: 'act'|'milestone'|'scale'|'ruin'|'recovery'|'gift'|'singularity'|'downfall'|'rebirth'|'pyromid', label: string, kind?: 'boon'|'disaster' }
// `kind` is only meaningful for 'act' events (which Random Act fired); other types ignore it.

export const HISTORY_CAP = 60 // headlines kept; the oldest fall off the tail (the log is newest-first)

// Leading emoji per event type, used when an event carries a pre-written `line` (a resident vignette).
const TYPE_ICON = { act: '🎉', scale: '🏙️', milestone: '🏆', gift: '🎁', singularity: '⚡', downfall: '☢️', rebirth: '🌅', pyromid: '⬛', ruin: '🧟', recovery: '🌱', vignette: '🗞️' }

// Prepend `event` and return a NEW array (the input is never mutated), newest-first, capped at `cap`.
// A non-finite cap falls back to HISTORY_CAP so a bad call can never silently wipe the whole log.
export function appendEvent(history, event, cap = HISTORY_CAP) {
  const prev = Array.isArray(history) ? history : []
  const limit = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : HISTORY_CAP
  return Object.freeze([event, ...prev].slice(0, limit))
}

// One-line headline with a leading emoji. The emoji + verb come from the type/kind; `label` carries
// the specific noun (the act name, the scale tier reached, …). Never throws on a malformed event.
export function formatEvent(event) {
  const label = typeof event?.label === 'string' ? event.label : ''
  // A resident-voiced vignette line (when present) is the whole headline, behind the type's emoji.
  if (typeof event?.line === 'string' && event.line) {
    const icon = event?.kind === 'disaster' ? '💥' : TYPE_ICON[event?.type] ?? '📜'
    return `${icon} ${event.line}`
  }
  switch (event?.type) {
    case 'act':
      return event.kind === 'disaster' ? `💥 ${label} struck` : `🎉 ${label} lifted the city`
    case 'scale':
      return `🏙️ Grew to ${label}`
    case 'milestone':
      return `🏆 ${label}`
    case 'gift':
      return `🎁 ${label}`
    case 'singularity':
      return `⚡ The Singularity — ${label}`
    case 'downfall':
      return `☢️ ${label} — the city is razed`
    case 'rebirth':
      return `🌅 ${label} — reborn from the wasteland`
    case 'pyromid':
      return `⬛ Pyromid: ${label}`
    case 'ruin':
      return '🧟 Fell into ruins'
    case 'recovery':
      return '🌱 Rebuilt from the ruins'
    default:
      return label ? `📜 ${label}` : '📜 History'
  }
}

// Lifetime tally over the whole log. Buckets are derived purely from type/kind (never from parsing
// `label`), so a renamed scale tier can never drift the counts:
//   acts        — every Random Act fired (boon or disaster)
//   disasters   — destructive moments: disaster-kind acts AND falling into ruins
//   milestones  — growth moments: scale-ladder climbs and named milestones
//   legendaries — comebacks: clawing back out of the ruins (the rare, legendary arc)
export function summarize(history) {
  const events = Array.isArray(history) ? history : []
  const tally = { acts: 0, disasters: 0, milestones: 0, legendaries: 0 }
  for (const e of events) {
    if (!e || typeof e !== 'object') continue
    if (e.type === 'act') tally.acts++
    if (e.kind === 'disaster' || e.type === 'ruin' || e.type === 'downfall') tally.disasters++
    if (e.type === 'scale' || e.type === 'milestone' || e.type === 'singularity') tally.milestones++
    if (e.type === 'recovery' || e.type === 'rebirth') tally.legendaries++
  }
  return tally
}
