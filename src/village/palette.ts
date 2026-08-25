/**
 * One palette for the whole village.
 *
 * Cohesion in game art comes from shared constraints, not from any single
 * asset being good: one palette, one light direction, one outline rule, one
 * pixel grid. Break any of those and the scene reads as assembled from parts.
 *
 * Every ramp below is FIVE steps with a genuinely wide value range. The old
 * palettes sat in a narrow mid-tone band, which is exactly what made
 * everything look washed out and flat.
 */

export type Ramp = {
  line: string;    // outline — darker than any fill
  dark: string;
  base: string;
  light: string;
  hi: string;      // sunlit edge
};

/** Light comes from the upper-left. Every sprite obeys it. */
export const LIGHT = { x: -1, y: -1 };

/** The one outline colour. A single contour colour ties unrelated art together. */
export const INK = '#221a15';

export const RAMPS: Record<string, Ramp> = {
  // roofs
  clay:    { line: INK, dark: '#7a3327', base: '#a84634', light: '#c76248', hi: '#e08a63' },
  slate:   { line: INK, dark: '#2f3a4a', base: '#41506a', light: '#5b6d8c', hi: '#7d8fae' },
  copper:  { line: INK, dark: '#2f6152', base: '#43876f', light: '#5aa88a', hi: '#7fc4a4' },
  gold:    { line: INK, dark: '#8a6516', base: '#b98a24', light: '#d9a83a', hi: '#efc55e' },
  plum:    { line: INK, dark: '#4a2d5c', base: '#6b4180', light: '#8a5aa0', hi: '#a97dbc' },
  moss:    { line: INK, dark: '#3d5124', base: '#587336', light: '#74924c', hi: '#95b06b' },
  rust:    { line: INK, dark: '#7d3d1c', base: '#a6572a', light: '#c4753f', hi: '#dd9a63' },
  teal:    { line: INK, dark: '#20475a', base: '#2f647e', light: '#4384a3', hi: '#63a6c4' },

  // materials
  plaster: { line: INK, dark: '#8a7455', base: '#b39a76', light: '#cfb894', hi: '#e6d3b2' },
  timber:  { line: INK, dark: '#3a2718', base: '#573a24', light: '#754f31', hi: '#8f6740' },
  stone:   { line: INK, dark: '#3f4448', base: '#5c6266', light: '#7b8286', hi: '#9aa1a5' },
  glass:   { line: INK, dark: '#2a3d47', base: '#3f6070', light: '#5d8a9c', hi: '#8fb8c6' },
  glow:    { line: INK, dark: '#8a6a1e', base: '#d8a83c', light: '#f2cd6a', hi: '#fdeab4' },

  // ground and foliage
  grass:   { line: '#1e2f18', dark: '#2f4a26', base: '#3f6432', light: '#4f7b3e', hi: '#65934f' },
  leaf:    { line: '#16280f', dark: '#26401c', base: '#356027', light: '#457a33', hi: '#5d9945' },
  dirt:    { line: '#4a3620', base: '#8a6c42', dark: '#6b5231', light: '#a5854f', hi: '#c0a066' },
  skin:    { line: INK, dark: '#8a5233', base: '#c98a5e', light: '#e0aa78', hi: '#f2c9a0' },
};

/** Which ramp each department roofs itself with. */
export const DEPT_RAMP: Record<string, string> = {
  civic: 'clay', money: 'gold', analytics: 'slate', product: 'plum',
  craft: 'rust', research: 'moss', studio: 'clay', outreach: 'plum',
  inbox: 'teal', family: 'rust', household: 'moss',
};

export const ramp = (name: string): Ramp => RAMPS[name] ?? RAMPS['plaster']!;
