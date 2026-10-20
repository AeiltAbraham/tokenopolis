// All feel-controlling constants live here (and nowhere else). Tests assert SHAPE
// (monotonicity, ordering, ratios), never these exact numbers — so T-013 can tune feel by eye
// without breaking a single test. Each constant carries a one-line note on what it controls.

export const SCALE = {
  baseTokens: 1_000_000, // burn to take the FIRST step up (Hamlet→Village); smaller = faster early delight
  growth: 5, // each step up costs this many × the previous step (front-loaded/log feel); bigger = rarer milestones
  undergroundFromIndex: 4, // scale index at which the underground frontier opens (Metropolis)
}

// Named ladder; index ≥ length gets procedural names ("Megastructure 2", "Megastructure 3", …) with no cap.
export const SCALE_NAMES = [
  'Hamlet', // 0
  'Village', // 1
  'Town', // 2
  'City', // 3
  'Metropolis', // 4 — underground opens
  'Megalopolis', // 5
  'Arcology', // 6
  'Megastructure', // 7
]

export const ECONOMY = {
  popBase: 12, // people in a brand-new hamlet at zero burn (keeps a village from reading as empty)
  popVitality: 40, // how many extra residents full vitality alone adds (lively even when small)
  popPerToken: 0.0008, // residents gained per burned token at full activity (overall population scale)

  treasuryBase: 0, // starting treasury
  treasuryVitality: 500, // treasury bump from vitality alone (a busy town has cash flow)
  treasuryPerToken: 0.004, // treasury gained per burned token at full activity

  ratingBase: 1, // floor economy score
  ratingVitality: 30, // economy-score bump from vitality alone (recent activity reads as a hot economy)
  ratingPerToken: 0.00002, // economy score gained per burned token at full activity
}

// Condition ladder, worst-last. Index rises (worsens) with days since the last meaningful burn.
export const CONDITIONS = ['Thriving', 'Stable', 'Stagnant', 'Declining', 'Blighted', 'Ruins', 'Buried']

export const DECAY = {
  meaningfulTokens: 100_000, // burn since last tick that counts as "active" and resets the decay clock
  // days-since-meaningful-burn thresholds, one per CONDITIONS entry (ascending). Condition = the
  // highest entry whose threshold ≤ daysSinceBurn. Weekend-safe: Thriving holds under 3 quiet days.
  conditionDays: [0, 3, 4, 6, 8, 10, 13], // Thriving/Stable/Stagnant/Declining/Blighted/Ruins/Buried
  ruinsThresholdDays: 10, // effective scale only starts to crumble after this many idle days (== Ruins onset)
  daysPerRuinLevel: 1, // once crumbling, idle days per lost effective-scale level
  recoveryFactor: 5, // rebuilding from ruins costs 1/this of the original climb (≈ 5× faster brownfield)
  vitalityFullDays: 1, // vitality stays 1.0 within this many idle days (freshly active)
  vitalityZeroDays: 10, // vitality decays linearly to 0 by this many idle days
}

export const SCENE = {
  baseBuildings: 6, // buildings drawn in a hamlet
  buildingGrowth: 2.1, // conceptual buildings multiply per scale step (visible density climb)
  lodDetailCap: 600, // max rendered building primitives; above this, buildings aggregate into districts (T-014 ratchet: 1200→600, still a dense 24×24 skyline)
  undergroundRenderCap: 14, // underground levels drawn individually; deeper ones are summarized
  maxLandmarks: 8, // amenity landmarks cap (one appears per scale step up to this)
}
