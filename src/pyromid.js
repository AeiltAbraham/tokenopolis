// The Pyromid — a mysterious solar-pyramid datacenter where the tokens are burned ("pyro"). It builds
// toward PYROMID.target treasury (high-water: it never un-builds), boosts the city as it rises, and
// reveals one more line of lore at each threshold until the final truth. Pure: no I/O, no clock.

import { PYROMID } from './tuning.js'

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)

// Ascending reveal. Each threshold unlocks one line; `infoLevel` is the count unlocked (1-based). The
// more you build, the more you learn — ending at the heart of the machine.
export const PYROMID_LORE = [
  { at: 0.0, text: 'Construction begins. Purpose: classified.' },
  { at: 0.1, text: 'The panels drink the sun; something hums beneath the sand.' },
  { at: 0.25, text: 'It is a datacenter. The tokens you burn feed its furnace — pyro.' },
  { at: 0.5, text: 'Readings spike. It is learning. It watches the city grow.' },
  { at: 0.75, text: 'It no longer needs the sun — it burns the city’s spare cycles to think.' },
  { at: 0.9, text: 'You understand now: it was never a monument. It is a mind.' },
  { at: 1.0, text: 'The Pyromid is the heart of the AI — and the reason we return to dust. It was all a simulation.' },
]

export function defaultPyromid() {
  return { progress: 0, bonus: 0, infoLevel: 1 } // the intro line is visible from the first stone
}

// How many lore lines are unlocked at this build fraction (1..PYROMID_LORE.length).
export function infoLevelFor(progress) {
  const p = clamp01(progress)
  let n = 0
  for (const l of PYROMID_LORE) if (p >= l.at) n++
  return Math.max(1, n)
}

// The text to show for the current infoLevel (the latest unlocked line).
export function loreFor(infoLevel) {
  const i = Math.max(1, Math.min(Math.floor(infoLevel || 1), PYROMID_LORE.length))
  return PYROMID_LORE[i - 1].text
}

// The lore lines unlocked crossing from prevInfoLevel to newInfoLevel (for the chronicle).
export function newlyUnlocked(prevInfoLevel, newInfoLevel) {
  const lines = []
  for (let i = Math.max(1, Math.floor(prevInfoLevel || 1) + 1); i <= newInfoLevel; i++) lines.push(PYROMID_LORE[i - 1].text)
  return lines
}

// The city boost the datacenter provides, scaling with build progress.
export function boostFor(progress) {
  const p = clamp01(progress)
  return { economyMult: 1 + p * PYROMID.boostEconomy, popBonus: Math.round(p * PYROMID.boostPopulation) }
}

// Advance the build from the current treasury (which already includes the click bonus). Progress is
// high-water — once built, a level stays built even if treasury later craters (the wasteland, a setback).
export function updatePyromid(prev, treasury) {
  const p = normalize(prev)
  const progress = Math.max(p.progress, clamp01((Number(treasury) || 0) / PYROMID.target))
  const infoLevel = Math.max(p.infoLevel, infoLevelFor(progress))
  return { progress, bonus: p.bonus, infoLevel }
}

// A click: deposit clickValue into the Pyromid's treasury bonus. (Progress is recomputed by updatePyromid.)
export function burn(prev) {
  const p = normalize(prev)
  return { progress: p.progress, bonus: p.bonus + PYROMID.clickValue, infoLevel: p.infoLevel }
}

function normalize(p) {
  const o = p && typeof p === 'object' ? p : {}
  return {
    progress: clamp01(Number(o.progress) || 0),
    bonus: Math.max(0, Number(o.bonus) || 0),
    infoLevel: Math.max(1, Math.floor(Number(o.infoLevel) || 1)),
  }
}
