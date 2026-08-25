import { ramp, DEPT_RAMP, INK, type Ramp } from './palette.ts';

/**
 * The village draws itself.
 *
 * Four rules produce the cohesion, and they matter more than any single asset:
 *   1. every sprite carries a dark INK contour — shapes must separate
 *   2. light always comes from the upper-left
 *   3. every coordinate snaps to a 2-unit grid
 *   4. one palette, wide value range (the old one sat in a mid-tone band,
 *      which is exactly what made everything look washed out)
 */

const G = 2;
const s = (n: number): number => Math.round(n / G) * G;

const r = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${s(x)}" y="${s(y)}" width="${s(w)}" height="${s(h)}" fill="${fill}"/>`;

/** A filled box with a contour. This one helper is most of the look. */
const box = (x: number, y: number, w: number, h: number, fill: string, ink = INK, t = 2): string =>
  r(x - t, y - t, w + t * 2, h + t * 2, ink) + r(x, y, w, h, fill);

/** Top-left lit: a light band along the top and left, shade bottom and right. */
const lit = (x: number, y: number, w: number, h: number, p: Ramp): string =>
  r(x, y, w, 3, p.light) + r(x, y, 3, h, p.light) +
  r(x, y + h - 3, w, 3, p.dark) + r(x + w - 3, y, 3, h, p.dark);

const shadow = (cx: number, cy: number, rx: number): string =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${Math.max(3, rx * 0.3)}" fill="rgba(20,14,10,.30)"/>`;

const svg = (vb: string, w: number, h: number, title: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" shape-rendering="crispEdges"><title>${title}</title>${body}</svg>`;

// ------------------------------------------------------------------ buildings

export const ARCHETYPE: Record<string, string> = {
  civic: 'hall', money: 'vault', analytics: 'dome', product: 'market',
  craft: 'barn', research: 'chapel', studio: 'glass', outreach: 'townhouse',
  inbox: 'cottage', family: 'cottage', household: 'barn',
};

const window_ = (x: number, y: number, tim: Ramp, glow: Ramp): string => `
  ${box(x, y, 22, 26, glow.base)}
  ${r(x, y, 22, 9, glow.hi)}
  ${r(x, y + 20, 22, 6, glow.dark)}
  ${r(x + 9, y, 4, 26, tim.dark)}
  ${r(x, y + 11, 22, 4, tim.dark)}`;

const crown = (kind: string, W: number, roof: Ramp, st: Ramp, glow: Ramp): string => {
  switch (kind) {
    case 'hall': return `
      ${box(W / 2 - 24, -80, 48, 80, st.base)}
      ${lit(W / 2 - 24, -80, 48, 80, st)}
      ${box(W / 2 - 30, -86, 60, 10, roof.dark)}
      ${box(W / 2 - 15, -66, 30, 26, '#efe6cf')}
      ${r(W / 2 - 3, -62, 6, 14, INK)}
      ${r(W / 2 - 12, -54, 24, 3, INK)}
      ${box(W / 2 - 11, -34, 22, 18, roof.base)}
      ${r(W / 2 - 7, -30, 14, 12, '#d8a83c')}`;
    case 'dome': return `
      ${box(W / 2 - 44, -34, 88, 38, st.base)}
      ${lit(W / 2 - 44, -34, 88, 38, st)}
      ${box(W / 2 - 34, -52, 68, 22, st.light)}
      ${box(W / 2 - 21, -66, 42, 18, st.light)}
      ${box(W / 2 - 9, -76, 18, 12, st.hi)}
      ${box(W / 2 + 6, -60, 48, 9, INK)}
      ${r(W / 2 + 8, -58, 42, 5, st.dark)}`;
    case 'glass': return `
      ${box(W - 44, -64, 7, 64, st.dark)}
      ${box(W - 58, -68, 34, 7, st.dark)}
      ${box(W - 62, -74, 12, 12, roof.base)}
      ${box(22, -22, 11, 22, st.dark)}`;
    case 'barn': return `
      ${box(W * 0.16, -32, 18, 34, st.base)}
      ${lit(W * 0.16, -32, 18, 34, st)}
      ${box(W * 0.66, -24, 16, 26, st.base)}
      ${lit(W * 0.66, -24, 16, 26, st)}`;
    case 'chapel': return `
      ${box(W / 2 - 6, -58, 12, 60, roof.dark)}
      ${box(W / 2 - 16, -40, 32, 12, roof.dark)}
      ${box(W / 2 - 9, -72, 18, 16, roof.base)}`;
    case 'vault': return `
      ${box(-2, -18, W + 4, 20, st.base)}
      ${lit(0, -18, W, 20, st)}
      ${box(W / 2 - 20, -36, 40, 20, st.light)}
      ${r(W / 2 - 11, -31, 22, 12, '#d8a83c')}`;
    case 'market': return `
      ${box(-8, -20, W + 16, 22, roof.base)}
      ${r(-8, -20, W + 16, 7, '#e8e2d4')}
      ${r(W * 0.22, -20, 22, 22, '#e8e2d4')}
      ${r(W * 0.62, -20, 22, 22, '#e8e2d4')}`;
    case 'townhouse': return `
      ${box(12, -26, W - 24, 28, roof.dark)}
      ${box(W / 2 - 18, -44, 36, 20, roof.base)}
      ${window_(W / 2 - 11, -40, ramp('timber'), glow)}`;
    default: return '';
  }
};

export const buildingSvg = (opts: {
  name: string; department: string; wTiles: number; hTiles: number;
}): string => {
  const roof = ramp(DEPT_RAMP[opts.department] ?? 'clay');
  const pl = ramp('plaster'), tim = ramp('timber'), st = ramp('stone'), glow = ramp('glow');

  const W = opts.wTiles * 32;
  const H = opts.hTiles * 32;
  const roofH = s(H * 0.44);
  const wallY = roofH, wallH = H - roofH;
  const kind = ARCHETYPE[opts.department] ?? 'cottage';
  const lift = kind === 'hall' ? 92 : kind === 'dome' ? 84 : kind === 'chapel' ? 80 : 46;

  const doorW = 30, doorH = 42;
  const doorX = s(W / 2 - doorW / 2), doorY = H - doorH;

  const winCount = Math.max(1, Math.floor(opts.wTiles / 3));
  let windows = '';
  for (let i = 0; i < winCount; i++) {
    const wx = s((W / (winCount + 1)) * (i + 1) - 11);
    if (Math.abs(wx - doorX) < 38) continue;
    windows += window_(wx, s(wallY + 18), tim, glow);
  }

  // roof courses, shaded to a ridge so the pitch reads without a gradient
  let courses = '';
  const rows = 5, rh = roofH / rows;
  for (let i = 0; i < rows; i++) {
    const c = i === 0 ? roof.hi : i === 1 ? roof.light : i < 4 ? roof.base : roof.dark;
    courses += r(0, rh * i, W, rh + 1, c);
    courses += r(0, rh * (i + 1) - 2, W, 2, roof.dark);
  }

  return svg(`0 -${lift} ${W} ${H + lift + 14}`, W, H + lift + 14, opts.name, `
  ${shadow(W / 2 + 5, H + 5, W * 0.46)}

  <!-- one contour around the whole mass, so the building separates from
       whatever it stands on -->
  ${r(-3, -3, W + 6, H + 6, INK)}

  <!-- stone footing -->
  ${r(0, H - 13, W, 13, st.dark)}
  ${r(0, H - 13, W, 4, st.base)}

  <!-- walls -->
  ${r(0, wallY, W, wallH, pl.base)}
  ${r(0, wallY, W, 5, pl.hi)}
  ${r(0, wallY + wallH - 6, W, 6, pl.dark)}
  ${r(0, wallY, 5, wallH, pl.light)}
  ${r(W - 5, wallY, 5, wallH, pl.dark)}
  ${r(0, wallY, 6, wallH, tim.base)}
  ${r(W - 6, wallY, 6, wallH, tim.dark)}
  ${r(0, s(wallY + wallH * 0.6), W, 4, tim.base)}

  ${windows}

  <!-- door -->
  ${box(doorX, doorY, doorW, doorH, tim.light)}
  ${r(doorX + 4, doorY + 5, doorW - 8, 14, tim.dark)}
  ${r(doorX, doorY, doorW, 3, tim.hi)}
  ${r(doorX + doorW - 9, doorY + 22, 5, 5, '#e0c05a')}

  <!-- roof -->
  ${courses}
  ${r(0, roofH - 4, W, 4, INK)}
  ${r(s(W * 0.14), 0, s(W * 0.72), 4, roof.dark)}

  ${crown(kind, W, roof, st, glow)}

  ${kind === 'cottage' || kind === 'townhouse' ? `
    ${box(s(W * 0.74), -12, 15, 24, st.base)}
    ${r(s(W * 0.74), -12, 15, 4, st.light)}` : ''}
`);
};

// ----------------------------------------------------------------- characters

export type Look = { skin: string; hair: string; shirt: string; trouser: string; vest?: string };

/** Same rules as the buildings — contour, top-left light, 2-unit grid — which
 *  is what stops the staff looking pasted onto the scene. */
export const characterSvg = (look: Look, facing: 'up' | 'down' | 'left' | 'right'): string => {
  const W = 28, H = 40;
  const cx = W / 2;
  const back = facing === 'up';
  const side = facing === 'left' || facing === 'right';

  const face = back ? '' : side
    ? `${r(cx + (facing === 'right' ? 2 : -6), 13, 4, 3, INK)}`
    : `${r(cx - 6, 13, 4, 3, INK)}${r(cx + 2, 13, 4, 3, INK)}`;

  const hairShape = back
    ? `${r(cx - 8, 6, 16, 12, look.hair)}`
    : `${r(cx - 8, 6, 16, 6, look.hair)}${r(cx - 8, 6, 3, 10, look.hair)}${r(cx + 5, 6, 3, 10, look.hair)}`;

  return svg(`0 0 ${W} ${H}`, W, H, `staff ${facing}`, `
  ${shadow(cx, H - 3, 9)}
  <!-- legs -->
  ${box(cx - 6, H - 12, 5, 9, look.trouser)}
  ${box(cx + 1, H - 12, 5, 9, look.trouser)}
  <!-- body -->
  ${box(cx - 8, 17, 16, 13, look.shirt)}
  ${r(cx - 8, 17, 16, 3, look.shirt)}
  ${r(cx - 8, 27, 16, 3, INK)}
  ${look.vest ? r(cx - 8, 19, 16, 6, look.vest) : ''}
  <!-- arms -->
  ${box(cx - 11, 18, 4, 9, look.skin)}
  ${box(cx + 7, 18, 4, 9, look.skin)}
  <!-- head -->
  ${box(cx - 7, 6, 14, 12, look.skin)}
  ${hairShape}
  ${face}
`);
};
