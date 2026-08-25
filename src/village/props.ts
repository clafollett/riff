/**
 * The small things.
 *
 * Density is what separates a village from a diagram. Twelve buildings on
 * empty grass reads as placeholder however well each one is drawn; the same
 * twelve behind stone walls, among benches, lamps, carts and stumps, reads as
 * a place people live.
 *
 * Everything snaps to a 4-unit grid and uses crispEdges, so props sit in the
 * same visual language as the buildings.
 */

const G = 4;
const s = (n: number): number => Math.round(n / G) * G;
const r = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${s(x)}" y="${s(y)}" width="${s(w)}" height="${s(h)}" fill="${fill}"/>`;

const wrap = (w: number, h: number, body: string, title: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges"><title>${title}</title>${body}</svg>`;

const shadow = (cx: number, cy: number, rx: number): string =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${Math.max(3, rx * 0.32)}" fill="rgba(0,0,0,.22)"/>`;

export const PROPS: Record<string, () => string> = {
  // --- foliage -------------------------------------------------------------
  pine: () => wrap(44, 64, `
    ${shadow(24, 60, 13)}
    ${r(18, 44, 8, 16, '#5b3b22')}
    ${r(6, 30, 32, 16, '#2c5c30')}
    ${r(10, 18, 24, 16, '#356c38')}
    ${r(14, 8, 16, 14, '#3d7a3e')}
    ${r(18, 2, 8, 8, '#488c46')}
    ${r(10, 30, 12, 8, '#3d7a3e')}`, 'pine'),

  bush: () => wrap(36, 28, `
    ${shadow(18, 25, 12)}
    ${r(2, 10, 32, 14, '#356c38')}
    ${r(6, 4, 24, 12, '#3d7a3e')}
    ${r(10, 2, 12, 8, '#4a8f48')}
    ${r(6, 10, 8, 6, '#4a8f48')}`, 'bush'),

  stump: () => wrap(32, 26, `
    ${shadow(16, 23, 11)}
    ${r(4, 10, 24, 12, '#5b3b22')}
    ${r(4, 6, 24, 8, '#7a5433')}
    ${r(10, 8, 12, 4, '#8f6640')}`, 'stump'),

  flowerbed: () => wrap(40, 24, `
    ${r(2, 10, 36, 12, '#6b4a2c')}
    ${r(2, 8, 36, 4, '#7d5a3c')}
    ${r(6, 4, 6, 6, '#e8d24a')}
    ${r(16, 2, 6, 6, '#e07a9a')}
    ${r(26, 5, 6, 6, '#d8d8e8')}
    ${r(32, 2, 5, 5, '#e29a4a')}`, 'flowerbed'),

  // --- furniture and fittings ---------------------------------------------
  lamp: () => wrap(24, 60, `
    ${shadow(12, 56, 8)}
    ${r(8, 20, 8, 36, '#3b3630')}
    ${r(6, 52, 12, 6, '#2e2a25')}
    ${r(4, 8, 16, 14, '#4a443c')}
    ${r(6, 10, 12, 10, '#f6d98a')}
    ${r(8, 2, 8, 8, '#3b3630')}`, 'lamp'),

  bench: () => wrap(52, 30, `
    ${shadow(26, 27, 20)}
    ${r(4, 10, 44, 6, '#8a6340')}
    ${r(4, 18, 44, 5, '#7d5a3c')}
    ${r(6, 16, 6, 12, '#5f452c')}
    ${r(40, 16, 6, 12, '#5f452c')}`, 'bench'),

  well: () => wrap(48, 52, `
    ${shadow(24, 48, 17)}
    ${r(6, 26, 36, 18, '#8d8880')}
    ${r(6, 26, 36, 5, '#a9a49b')}
    ${r(12, 32, 24, 10, '#3f5f77')}
    ${r(8, 6, 6, 22, '#7d5a3c')}
    ${r(34, 6, 6, 22, '#7d5a3c')}
    ${r(2, 0, 44, 10, '#8a4b3f')}
    ${r(2, 0, 44, 4, '#a35c4c')}`, 'well'),

  crates: () => wrap(48, 40, `
    ${shadow(24, 37, 18)}
    ${r(4, 14, 22, 22, '#8a6340')}
    ${r(4, 14, 22, 5, '#a07a52')}
    ${r(13, 14, 4, 22, '#6b4a2c')}
    ${r(28, 20, 18, 16, '#7d5a3c')}
    ${r(28, 20, 18, 4, '#96704a')}`, 'crates'),

  barrels: () => wrap(44, 40, `
    ${shadow(22, 37, 17)}
    ${r(4, 12, 16, 24, '#8a6340')}
    ${r(4, 18, 16, 4, '#5f452c')}
    ${r(4, 28, 16, 4, '#5f452c')}
    ${r(24, 18, 16, 18, '#7d5a3c')}
    ${r(24, 24, 16, 4, '#5f452c')}`, 'barrels'),

  cart: () => wrap(64, 42, `
    ${shadow(32, 39, 26)}
    ${r(6, 12, 48, 16, '#8a6340')}
    ${r(6, 12, 48, 4, '#a07a52')}
    ${r(10, 26, 12, 12, '#5f452c')}
    ${r(38, 26, 12, 12, '#5f452c')}
    ${r(50, 8, 12, 6, '#7d5a3c')}`, 'cart'),

  signpost: () => wrap(36, 52, `
    ${shadow(18, 49, 9)}
    ${r(14, 14, 8, 34, '#7d5a3c')}
    ${r(2, 6, 32, 10, '#8a6340')}
    ${r(2, 6, 32, 3, '#a07a52')}
    ${r(6, 20, 24, 8, '#8a6340')}`, 'signpost'),

  laundry: () => wrap(72, 44, `
    ${r(4, 6, 4, 36, '#7d5a3c')}
    ${r(64, 6, 4, 36, '#7d5a3c')}
    ${r(6, 8, 60, 3, '#c9c2b4')}
    ${r(12, 10, 14, 20, '#dfe6ec')}
    ${r(32, 10, 12, 16, '#e8d7c0')}
    ${r(48, 10, 12, 22, '#cddae0')}`, 'laundry'),

  stall: () => wrap(72, 52, `
    ${shadow(36, 49, 28)}
    ${r(6, 22, 60, 22, '#8a6340')}
    ${r(6, 22, 60, 4, '#a07a52')}
    ${r(2, 6, 68, 14, '#c8503f')}
    ${r(2, 6, 68, 5, '#e0e0d8')}
    ${r(16, 6, 12, 14, '#e0e0d8')}
    ${r(44, 6, 12, 14, '#e0e0d8')}
    ${r(12, 28, 10, 8, '#d05a3c')}
    ${r(28, 28, 10, 8, '#e8b03c')}
    ${r(44, 28, 10, 8, '#6f9c4a')}`, 'stall'),
};

/** A run of stone wall. Plots are enclosed, which is most of the structure. */
export const wallSvg = (horizontal: boolean): string => {
  const L = 32, T = 12;
  const w = horizontal ? L : T, h = horizontal ? T : L;
  const body = horizontal
    ? `${r(0, 4, L, 8, '#7c766b')}${r(0, 0, L, 5, '#9a958c')}${r(6, 4, 3, 8, '#6d675e')}${r(20, 4, 3, 8, '#6d675e')}`
    : `${r(0, 0, T, L, '#7c766b')}${r(0, 0, 5, L, '#9a958c')}${r(0, 8, T, 3, '#6d675e')}${r(0, 22, T, 3, '#6d675e')}`;
  return wrap(w, h, body, 'wall');
};
