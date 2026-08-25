import { ramp, INK } from './palette.ts';

/**
 * The small things, drawn under the same four rules as the buildings:
 * contour, top-left light, 2-unit grid, one palette.
 *
 * Density is what separates a village from a diagram — but density only helps
 * if the props share the buildings' visual language. Otherwise it reads as
 * clutter from a different game.
 */

const G = 2;
const s = (n: number): number => Math.round(n / G) * G;
const r = (x: number, y: number, w: number, h: number, f: string): string =>
  `<rect x="${s(x)}" y="${s(y)}" width="${s(w)}" height="${s(h)}" fill="${f}"/>`;
const box = (x: number, y: number, w: number, h: number, f: string, t = 2): string =>
  r(x - t, y - t, w + t * 2, h + t * 2, INK) + r(x, y, w, h, f);
const shadow = (cx: number, cy: number, rx: number): string =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${Math.max(3, rx * 0.3)}" fill="rgba(20,14,10,.30)"/>`;
const svg = (w: number, h: number, title: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges"><title>${title}</title>${body}</svg>`;

const leaf = ramp('leaf'), tim = ramp('timber'), st = ramp('stone'), glow = ramp('glow');

export const PROPS: Record<string, () => string> = {
  oak: () => svg(52, 62, 'oak', `
    ${shadow(26, 58, 15)}
    ${box(21, 36, 9, 20, tim.base)}
    ${r(21, 36, 4, 20, tim.light)}
    ${box(6, 12, 40, 26, leaf.base)}
    ${box(12, 4, 28, 14, leaf.base)}
    ${r(10, 14, 18, 10, leaf.light)}
    ${r(14, 6, 14, 8, leaf.hi)}
    ${r(8, 30, 36, 6, leaf.dark)}`),

  pine: () => svg(48, 68, 'pine', `
    ${shadow(24, 64, 13)}
    ${box(19, 46, 9, 18, tim.base)}
    ${box(4, 30, 40, 18, leaf.dark)}
    ${box(8, 18, 32, 16, leaf.base)}
    ${box(13, 6, 22, 15, leaf.base)}
    ${r(11, 20, 14, 8, leaf.light)}
    ${r(16, 8, 12, 8, leaf.hi)}`),

  bush: () => svg(40, 32, 'bush', `
    ${shadow(20, 29, 13)}
    ${box(3, 10, 34, 16, leaf.base)}
    ${box(9, 4, 22, 12, leaf.base)}
    ${r(7, 12, 14, 7, leaf.light)}
    ${r(12, 6, 10, 6, leaf.hi)}
    ${r(5, 22, 30, 4, leaf.dark)}`),

  stump: () => svg(34, 28, 'stump', `
    ${shadow(17, 25, 12)}
    ${box(5, 10, 24, 13, tim.base)}
    ${r(5, 10, 24, 5, tim.light)}
    ${r(11, 12, 12, 3, tim.hi)}`),

  flowerbed: () => svg(44, 26, 'flowerbed', `
    ${box(3, 11, 38, 12, ramp('dirt').base)}
    ${r(3, 11, 38, 4, ramp('dirt').light)}
    ${r(7, 4, 6, 7, '#e8d24a')}${r(17, 2, 6, 7, '#e07a9a')}
    ${r(27, 5, 6, 7, '#e8e2ea')}${r(34, 2, 5, 6, '#e29a4a')}`),

  lamp: () => svg(26, 64, 'lamp', `
    ${shadow(13, 60, 8)}
    ${box(9, 22, 7, 38, st.dark)}
    ${box(5, 56, 15, 5, st.base)}
    ${box(4, 8, 17, 15, tim.dark)}
    ${r(6, 10, 13, 11, glow.light)}
    ${r(6, 10, 13, 4, glow.hi)}
    ${box(9, 2, 7, 7, st.dark)}`),

  bench: () => svg(56, 34, 'bench', `
    ${shadow(28, 30, 21)}
    ${box(5, 10, 46, 7, tim.light)}
    ${box(5, 19, 46, 6, tim.base)}
    ${box(8, 17, 6, 12, tim.dark)}
    ${box(42, 17, 6, 12, tim.dark)}`),

  well: () => svg(52, 58, 'well', `
    ${shadow(26, 54, 18)}
    ${box(7, 28, 38, 20, st.base)}
    ${r(7, 28, 38, 5, st.light)}
    ${r(13, 34, 26, 11, '#274a5e')}
    ${box(9, 6, 7, 24, tim.base)}
    ${box(36, 6, 7, 24, tim.base)}
    ${box(3, 0, 46, 11, ramp('clay').base)}
    ${r(3, 0, 46, 4, ramp('clay').light)}`),

  crates: () => svg(52, 44, 'crates', `
    ${shadow(26, 41, 20)}
    ${box(5, 15, 23, 24, tim.base)}
    ${r(5, 15, 23, 4, tim.light)}
    ${r(15, 15, 4, 24, tim.dark)}
    ${box(31, 21, 18, 18, tim.light)}
    ${r(31, 21, 18, 4, tim.hi)}`),

  barrels: () => svg(48, 44, 'barrels', `
    ${shadow(24, 41, 19)}
    ${box(5, 13, 17, 26, tim.base)}
    ${r(5, 19, 17, 4, tim.dark)}${r(5, 30, 17, 4, tim.dark)}
    ${box(27, 19, 16, 20, tim.light)}
    ${r(27, 25, 16, 4, tim.dark)}`),

  cart: () => svg(68, 46, 'cart', `
    ${shadow(34, 43, 28)}
    ${box(7, 13, 50, 17, tim.base)}
    ${r(7, 13, 50, 4, tim.light)}
    ${box(11, 28, 13, 13, tim.dark)}
    ${box(41, 28, 13, 13, tim.dark)}
    ${box(53, 8, 13, 7, tim.base)}`),

  signpost: () => svg(40, 56, 'signpost', `
    ${shadow(20, 52, 10)}
    ${box(15, 15, 8, 36, tim.base)}
    ${box(3, 6, 34, 11, tim.light)}
    ${r(3, 6, 34, 3, tim.hi)}
    ${box(7, 21, 26, 9, tim.base)}`),

  laundry: () => svg(76, 48, 'laundry', `
    ${box(4, 6, 5, 38, tim.base)}
    ${box(66, 6, 5, 38, tim.base)}
    ${r(7, 9, 62, 3, INK)}
    ${box(13, 11, 15, 21, '#dfe6ec')}
    ${box(33, 11, 13, 17, '#e8d7c0')}
    ${box(51, 11, 13, 23, '#cddae0')}`),

  stall: () => svg(76, 56, 'stall', `
    ${shadow(38, 52, 30)}
    ${box(7, 24, 62, 23, tim.base)}
    ${r(7, 24, 62, 4, tim.light)}
    ${box(3, 6, 70, 15, ramp('clay').base)}
    ${r(3, 6, 70, 5, '#e8e2d4')}
    ${r(18, 6, 13, 15, '#e8e2d4')}
    ${r(47, 6, 13, 15, '#e8e2d4')}
    ${r(13, 30, 11, 9, '#c4553c')}
    ${r(30, 30, 11, 9, '#d8a83c')}
    ${r(47, 30, 11, 9, '#5d9945')}`),
};

/** A run of stone wall. Plots are enclosed; that is most of the structure. */
export const wallSvg = (horizontal: boolean): string => {
  const L = 32, T = 14;
  const w = horizontal ? L : T, h = horizontal ? T : L;
  const body = horizontal
    ? `${r(0, 0, L, T, INK)}${r(0, 2, L, T - 4, st.base)}${r(0, 2, L, 3, st.light)}
       ${r(7, 2, 2, T - 4, st.dark)}${r(21, 2, 2, T - 4, st.dark)}`
    : `${r(0, 0, T, L, INK)}${r(2, 0, T - 4, L, st.base)}${r(2, 0, 3, L, st.light)}
       ${r(2, 9, T - 4, 2, st.dark)}${r(2, 23, T - 4, 2, st.dark)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges"><title>wall</title>${body}</svg>`;
};
