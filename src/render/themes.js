// Five city palettes + a resolver. Pure data, no imports — inlined into the artifact alongside
// draw.js. Colors are #rrggbb so draw.js can shade them arithmetically.

export const THEMES = {
  temperate: { sky: '#cfe3f2', ground: '#8fae6b', road: '#9a9a93', roof: '#b5452f', window: '#ffe8a3', damage: '#2e221b', rubble: '#6d6a64', underground: '#2b2540', accent: '#ffcc55', zone: { R: '#d9b48a', C: '#7fb0d6', I: '#b0a07a', park: '#6fae5a' } },
  coastal: { sky: '#d6f0f2', ground: '#cdd6a8', road: '#aeb0ac', roof: '#2f7d8c', window: '#fff2c8', damage: '#20302f', rubble: '#7c8a86', underground: '#1f3b44', accent: '#14b8c4', zone: { R: '#e5d2a0', C: '#79c6c9', I: '#aab488', park: '#5fb08a' } },
  desert: { sky: '#f3e4c5', ground: '#d8b483', road: '#b79a72', roof: '#b4652a', window: '#fff0b0', damage: '#3b2a18', rubble: '#9a8260', underground: '#3a2c1c', accent: '#e8902a', zone: { R: '#e8c79a', C: '#d7a35e', I: '#c3a877', park: '#88a65a' } },
  nordic: { sky: '#e7eef3', ground: '#b9c6c2', road: '#9aa6a6', roof: '#415a6b', window: '#fdf0d0', damage: '#232b2e', rubble: '#879491', underground: '#232c33', accent: '#6fa3c0', zone: { R: '#cdd6d4', C: '#8fb0c0', I: '#a6afad', park: '#7fae8e' } },
  neon: { sky: '#120a26', ground: '#1d1240', road: '#2a2050', roof: '#ff3ea5', window: '#38f0ff', damage: '#0a0618', rubble: '#3a2e5a', underground: '#060316', accent: '#b14bff', zone: { R: '#ff5bc0', C: '#38f0ff', I: '#7a5cff', park: '#2bd9a6' } },
}

export function resolveTheme(name) {
  return THEMES[name] ?? THEMES.temperate
}
