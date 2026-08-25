/**
 * The village draws itself.
 *
 * SVG is text, which is the whole point: a staff member can author a building
 * with the same tool it writes a note with. No image model, no credits, no
 * spritesheet slicing — and the result scales to any zoom.
 *
 * The chunky look comes from three rules, not from a filter:
 *   - every coordinate snaps to a 4-unit grid (drawn on graph paper)
 *   - shape-rendering="crispEdges" (no anti-aliased mush on the edges)
 *   - a small fixed palette per building, shaded in flat bands
 */

const G = 4;
/** Snap to the chunk grid. Off-grid coordinates are what make vector art look
 *  smooth and wrong for this style. */
const s = (n: number): number => Math.round(n / G) * G;

export type Palette = {
  roof: string; roofDark: string; roofLight: string;
  wall: string; wallShade: string; timber: string;
  stone: string; stoneDark: string;
};

export const PALETTES: Record<string, Palette> = {
  civic:     { roof: '#c96f4a', roofDark: '#9c5236', roofLight: '#e08a5f', wall: '#cbb896', wallShade: '#ac9a7b', timber: '#7d5a3c', stone: '#9a958c', stoneDark: '#787369' },
  money:     { roof: '#d9b44a', roofDark: '#a88832', roofLight: '#ecd070', wall: '#d3c39c', wallShade: '#b3a37f', timber: '#7a5c33', stone: '#a09a8e', stoneDark: '#7c766b' },
  analytics: { roof: '#5f74ad', roofDark: '#45568a', roofLight: '#8095cc', wall: '#bcc2d0', wallShade: '#9aa1b2', timber: '#5a5f70', stone: '#93969e', stoneDark: '#71747c' },
  product:   { roof: '#b8566a', roofDark: '#8d3d4e', roofLight: '#d4798c', wall: '#d3bdb5', wallShade: '#b39c94', timber: '#7d4a44', stone: '#9d9490', stoneDark: '#7a726e' },
  craft:     { roof: '#8a6a4a', roofDark: '#684f36', roofLight: '#a98862', wall: '#cbb894', wallShade: '#aa9877', timber: '#6b4d30', stone: '#9a9285', stoneDark: '#766f64' },
  research:  { roof: '#568a67', roofDark: '#3e684c', roofLight: '#78ac88', wall: '#c3c8ab', wallShade: '#a3a88c', timber: '#5c6b45', stone: '#94988c', stoneDark: '#71756a' },
  studio:    { roof: '#c04a3c', roofDark: '#93342a', roofLight: '#dc7060', wall: '#cdbaa9', wallShade: '#ac9a8a', timber: '#7a4a3a', stone: '#9c9490', stoneDark: '#78716d' },
  outreach:  { roof: '#96609f', roofDark: '#71467a', roofLight: '#b483bc', wall: '#cbbdd0', wallShade: '#a99bb0', timber: '#69506e', stone: '#98939c', stoneDark: '#75717a' },
  inbox:     { roof: '#4a7f9a', roofDark: '#356073', roofLight: '#6ea3bd', wall: '#bcc7cd', wallShade: '#9ba6ad', timber: '#4f6570', stone: '#93989c', stoneDark: '#70757a' },
  family:    { roof: '#c08a5f', roofDark: '#966843', roofLight: '#d9a97f', wall: '#d3c3a5', wallShade: '#b3a386', timber: '#7c5c3e', stone: '#9d968a', stoneDark: '#79736a' },
  household: { roof: '#7a8a5f', roofDark: '#5b6844', roofLight: '#9aab7c', wall: '#c9c9a6', wallShade: '#a9a988', timber: '#5f6b42', stone: '#96988a', stoneDark: '#737568' },
};

const rect = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${s(x)}" y="${s(y)}" width="${s(w)}" height="${s(h)}" fill="${fill}"/>`;

/** Flat shingle courses. Bands, not gradients — gradients read as plastic. */
const shingles = (x: number, y: number, w: number, h: number, p: Palette): string => {
  const rows = Math.max(3, Math.round(h / 12));
  const rh = h / rows;
  let out = '';
  for (let i = 0; i < rows; i++) {
    out += rect(x, y + rh * i, w, rh, i % 2 ? p.roof : p.roofDark);
    // a lit lip on each course so the pitch reads
    out += rect(x, y + rh * i, w, G, i % 2 ? p.roofLight : p.roof);
  }
  return out;
};

const window_ = (x: number, y: number, p: Palette, lit = true): string => `
    ${rect(x - G, y - G, 24 + G * 2, 28 + G * 2, p.timber)}
    ${rect(x, y, 24, 28, lit ? '#f6d98a' : '#5d6b73')}
    ${lit ? rect(x, y, 24, 12, '#fdeab4') : ''}
    ${rect(x + 10, y, 4, 28, p.timber)}
    ${rect(x, y + 12, 24, 4, p.timber)}`;

/**
 * Which silhouette a house wears.
 *
 * Twelve buildings that differ only in roof colour read as placeholder no
 * matter how well each is drawn — the eye reads OUTLINE first. Each department
 * therefore gets its own shape.
 */
export const ARCHETYPE: Record<string, string> = {
  civic: 'hall', money: 'vault', analytics: 'dome', product: 'market',
  craft: 'barn', research: 'chapel', studio: 'glass', outreach: 'townhouse',
  inbox: 'cottage', family: 'cottage', household: 'barn',
};

/** Roof furniture per archetype, drawn above the roof plane. */
const crown = (kind: string, W: number, p: Palette): string => {
  switch (kind) {
    case 'hall': return `
      ${rect(W / 2 - 22, -74, 44, 74, p.stone)}
      ${rect(W / 2 - 22, -74, 44, 6, p.stoneDark)}
      ${rect(W / 2 - 26, -78, 52, 8, p.roofDark)}
      ${rect(W / 2 - 14, -60, 28, 24, '#e8e0cc')}
      ${rect(W / 2 - 3, -56, 6, 12, '#3a2f24')}
      ${rect(W / 2 - 10, -30, 20, 16, p.roof)}
      ${rect(W / 2 - 6, -26, 12, 10, '#c9a83c')}`;
    case 'dome': return `
      ${rect(W / 2 - 40, -30, 80, 34, '#8d95a8')}
      ${rect(W / 2 - 32, -46, 64, 20, '#9fa7ba')}
      ${rect(W / 2 - 20, -58, 40, 16, '#b0b8ca')}
      ${rect(W / 2 - 8, -66, 16, 10, '#c2c9d8')}
      ${rect(W / 2 + 4, -52, 44, 8, '#6c7382')}
      ${rect(W / 2 + 40, -58, 12, 16, '#5b6270')}`;
    case 'glass': return `
      ${rect(W - 40, -56, 6, 56, '#5a606c')}
      ${rect(W - 52, -60, 30, 6, '#5a606c')}
      ${rect(W - 56, -64, 10, 10, '#c0463a')}
      ${rect(20, -18, 10, 18, '#5a606c')}`;
    case 'barn': return `
      ${rect(W * 0.18, -26, 16, 28, p.stoneDark)}
      ${rect(W * 0.18, -26, 16, 6, p.stone)}
      ${rect(W * 0.66, -20, 14, 22, p.stoneDark)}
      ${rect(W * 0.66, -20, 14, 5, p.stone)}`;
    case 'chapel': return `
      ${rect(W / 2 - 5, -50, 10, 52, p.roofDark)}
      ${rect(W / 2 - 14, -34, 28, 10, p.roofDark)}
      ${rect(W / 2 - 8, -62, 16, 14, p.roof)}`;
    case 'vault': return `
      ${rect(0, -14, W, 16, p.stoneDark)}
      ${rect(0, -14, W, 5, p.stone)}
      ${rect(W / 2 - 18, -30, 36, 18, p.stone)}
      ${rect(W / 2 - 10, -26, 20, 12, '#d9b44a')}`;
    case 'market': return `
      ${rect(-6, -16, W + 12, 18, '#c8503f')}
      ${rect(-6, -16, W + 12, 6, '#e0e0d8')}
      ${rect(W * 0.2, -16, 20, 18, '#e0e0d8')}
      ${rect(W * 0.6, -16, 20, 18, '#e0e0d8')}`;
    case 'townhouse': return `
      ${rect(10, -22, W - 20, 24, p.roofDark)}
      ${rect(W / 2 - 16, -38, 32, 18, p.roof)}
      ${rect(W / 2 - 6, -34, 12, 12, '#f6d98a')}`;
    default: return '';   // cottage
  }
};

/**
 * One building. `w`/`h` are TILES; the sprite is drawn at 32 units per tile so
 * it lands on the same grid the map uses.
 */
export const buildingSvg = (opts: {
  name: string; department: string; wTiles: number; hTiles: number; smoke?: boolean;
}): string => {
  const p = PALETTES[opts.department] ?? PALETTES['civic']!;
  const W = opts.wTiles * 32;
  const H = opts.hTiles * 32;

  const roofH = s(H * 0.46);
  const wallY = roofH;
  const wallH = H - roofH;
  const doorW = 28, doorH = 40;
  const doorX = s(W / 2 - doorW / 2);
  const doorY = H - doorH;

  const winCount = Math.max(1, Math.floor(opts.wTiles / 3));
  let windows = '';
  for (let i = 0; i < winCount; i++) {
    const wx = s((W / (winCount + 1)) * (i + 1) - 12);
    if (Math.abs(wx - doorX) < 36) continue;    // never on top of the door
    windows += window_(wx, s(wallY + 16), p);
  }

  const kind = ARCHETYPE[opts.department] ?? 'cottage';
  const lift = kind === 'hall' ? 80 : kind === 'dome' ? 70 : kind === 'chapel' ? 66 : 40;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -${lift} ${W} ${H + lift + 12}" width="${W}" height="${H + lift + 12}" shape-rendering="crispEdges">
  <title>${opts.name}</title>
  <!-- ground shadow -->
  <ellipse cx="${s(W / 2 + 4)}" cy="${H + 4}" rx="${s(W * 0.46)}" ry="7" fill="rgba(0,0,0,.24)"/>

  <!-- stone footing -->
  ${rect(0, H - 12, W, 12, p.stoneDark)}
  ${rect(0, H - 12, W, 5, p.stone)}

  <!-- walls -->
  ${rect(0, wallY, W, wallH, p.wall)}
  ${rect(0, wallY, W, G * 2, p.wallShade)}
  <!-- corner posts and a sill band: timber framing without the fuss -->
  ${rect(0, wallY, G * 2, wallH, p.timber)}
  ${rect(W - G * 2, wallY, G * 2, wallH, p.timber)}
  ${rect(0, s(wallY + wallH * 0.62), W, G, p.timber)}

  ${windows}

  <!-- door -->
  ${rect(doorX - G, doorY - G, doorW + G * 2, doorH + G, p.timber)}
  ${rect(doorX, doorY, doorW, doorH, '#6b4a2c')}
  ${rect(doorX + G, doorY + G * 2, doorW - G * 2, 12, '#5b3d24')}
  ${rect(doorX + doorW - 10, doorY + 20, 4, 4, '#d8b34a')}

  <!-- roof: fills the footprint edge to edge, so the silhouette matches
       whatever collision box the map gives it -->
  ${shingles(0, 0, W, roofH, p)}
  ${rect(0, roofH - G * 2, W, G * 2, 'rgba(0,0,0,.28)')}
  ${rect(s(W * 0.16), 0, s(W * 0.68), G * 2, p.roofDark)}

  ${crown(kind, W, p)}

  <!-- chimney (skipped where the crown already occupies the ridge) -->
  ${kind === 'cottage' || kind === 'townhouse' || kind === 'market' ? `
    ${rect(s(W * 0.74), -8, 14, 22, p.stoneDark)}
    ${rect(s(W * 0.74), -8, 14, 5, p.stone)}` : ''}
  ${opts.smoke ? `<g fill="rgba(240,238,232,.5)">
    ${rect(s(W * 0.76), -22, 8, 8, 'rgba(240,238,232,.45)')}
    ${rect(s(W * 0.78), -34, 10, 10, 'rgba(240,238,232,.28)')}
  </g>` : ''}
</svg>`;
};

/** A tree. Instanced many times, so it stays cheap. */
export const treeSvg = (variant = 0): string => {
  const dark = variant % 2 ? '#2f6b33' : '#35773a';
  const lite = variant % 2 ? '#478f45' : '#4f9b4c';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 56" width="48" height="56" shape-rendering="crispEdges">
  <ellipse cx="26" cy="52" rx="14" ry="4" fill="rgba(0,0,0,.22)"/>
  ${rect(20, 34, 8, 18, '#5b3b22')}
  ${rect(20, 34, 4, 18, '#6e4a2c')}
  ${rect(8, 12, 32, 24, dark)}
  ${rect(4, 18, 40, 12, dark)}
  ${rect(12, 4, 24, 16, dark)}
  ${rect(12, 8, 16, 12, lite)}
  ${rect(16, 4, 12, 8, lite)}
</svg>`;
};
