/**
 * The village, drawn.
 *
 * Deliberately plain canvas: no engine, no bundler, no build step — the same
 * discipline as the server (node:sqlite, node:http, no ws). For a dozen agents
 * on a tile grid this is a few hundred lines, and it loads instantly.
 *
 * All art here is placeholder geometry. Everything reads from `state.houses`
 * and tile coordinates, so swapping in real sprites later is a draw-call
 * change and touches nothing else.
 */

const $ = (id) => document.getElementById(id);

/**
 * The village's own art, when it has made any.
 *
 * Every draw call asks `art(key)` first and falls back to drawn geometry, so
 * the staff can hang one building at a time and the map improves piece by
 * piece with no rebuild and no code change.
 */
const ART = new Map();
function art(key) {
  const img = ART.get(key);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
async function loadArt() {
  try {
    const m = await fetch('/api/assets').then((r) => r.json());
    for (const [key, entry] of Object.entries(m.assets ?? {})) {
      if (ART.has(key)) continue;
      const img = new Image();
      img.src = '/assets/' + entry.file;
      ART.set(key, img);
    }
  } catch { /* no art yet — geometry it is */ }
}
const canvas = $('c');
const ctx = canvas.getContext('2d');

const state = {
  map: { w: 44, h: 32, tile: 32, fountain: { x: 22, y: 15 } },
  houses: [], staff: [], positions: new Map(),
  bubbles: new Map(),   // agentId -> {text, until}
  log: [], inn: null, me: null,
  camera: { x: 0, y: 0 },
};

// ------------------------------------------------------------------ palette
const ROLE_COLOR = {
  innkeeper: '#d94f3d', steward: '#e0913c',
  house_manager: '#4f86c6', house_assistant: '#79a84a',
};
const SKIN = ['#f2c9a0', '#e0aa78', '#c98a5e', '#a9683f', '#8a5233'];
const HAIR = ['#2e2018', '#5a3a22', '#8a5a2a', '#c08040', '#3a3a42', '#6b2f2f'];
const DEPT_ROOF = {
  civic:     ['#8f5348', '#7a4239'], money:     ['#c2a03e', '#a08430'],
  analytics: ['#5f74ad', '#4d5f92'], product:   ['#b05663', '#93444f'],
  craft:     ['#8a6a4a', '#6f543a'], research:  ['#568a67', '#456f53'],
  studio:    ['#bb4a3c', '#9c3c30'], outreach:  ['#96609f', '#7b4d83'],
  inbox:     ['#4a7f9a', '#3b667d'], family:    ['#c08a5f', '#a1724d'],
  household: ['#7a8a5f', '#63704d'],
};

/**
 * Deterministic hash-noise, uniform over [0,1). Decoration must not shimmer
 * between frames, so this is a pure function of (x, y, seed).
 *
 * Math.imul is load-bearing: JS bitwise operators coerce to int32, so mixing
 * ordinary float multiplication with shifts silently discards the high bits
 * and skews the distribution low. The first version never exceeded 0.34 and
 * placed no scenery at all.
 */
function noise(x, y, seed = 0) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ------------------------------------------------------------------- drawing
const T = () => state.map.tile;

function resize() {
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
}
addEventListener('resize', resize);

function worldToScreen(tx, ty) {
  return { x: Math.round(tx * T() - state.camera.x), y: Math.round(ty * T() - state.camera.y) };
}

/** Precomputed once: which tiles are path, and where the scenery stands. */
let pathSet = new Set();
let scenery = [];
function buildTerrain() {
  pathSet = new Set();
  const f = state.map.fountain;
  const mark = (x, y) => pathSet.add(`${x},${y}`);
  for (const h of state.houses) {
    const steps = Math.max(Math.abs(h.doorX - f.x), Math.abs(h.doorY - f.y)) || 1;
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(f.x + ((h.doorX - f.x) * i) / steps);
      const y = Math.round(f.y + ((h.doorY - f.y) * i) / steps);
      mark(x, y); mark(x + 1, y);     // two tiles wide, so it reads as a road
    }
  }
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) mark(f.x + dx, f.y + dy);

  const occupied = (x, y) => {
    if (pathSet.has(`${x},${y}`)) return true;
    return state.houses.some((h) =>
      x >= h.x - 1 && x < h.x + h.w + 1 && y >= h.y - 2 && y < h.y + h.h + 2);
  };
  scenery = [];
  for (let y = 0; y < state.map.h; y++) {
    for (let x = 0; x < state.map.w; x++) {
      if (occupied(x, y)) continue;
      const n = noise(x, y, 7);
      if (n > 0.955) scenery.push({ x, y, kind: 'tree', v: noise(x, y, 11) });
      else if (n > 0.90) scenery.push({ x, y, kind: 'bush', v: noise(x, y, 13) });
      else if (n > 0.84) scenery.push({ x, y, kind: 'flower', v: noise(x, y, 17) });
    }
  }
}

function drawGround() {
  const t = T();
  const x0 = Math.max(0, Math.floor(state.camera.x / t) - 1);
  const y0 = Math.max(0, Math.floor(state.camera.y / t) - 1);
  const x1 = Math.min(state.map.w, x0 + Math.ceil(canvas.width / t) + 3);
  const y1 = Math.min(state.map.h, y0 + Math.ceil(canvas.height / t) + 3);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = worldToScreen(x, y);
      const isPath = pathSet.has(`${x},${y}`);
      const n = noise(x, y, 3);

      if (isPath) {
        ctx.fillStyle = n > 0.7 ? '#cdae76' : n > 0.35 ? '#c4a46c' : '#bb9b63';
        ctx.fillRect(p.x, p.y, t, t);
        // scattered pebbles
        if (n > 0.86) {
          ctx.fillStyle = 'rgba(150,125,85,.55)';
          ctx.fillRect(p.x + (n * 20 | 0), p.y + (n * 17 | 0), 3, 2);
        }
      } else {
        ctx.fillStyle = n > 0.78 ? '#5d9450' : n > 0.5 ? '#568b49' : n > 0.22 ? '#4f8344' : '#4a7d40';
        ctx.fillRect(p.x, p.y, t, t);
        // grass blades
        const g = noise(x, y, 23);
        if (g > 0.55) {
          ctx.fillStyle = 'rgba(120,175,95,.5)';
          const gx = p.x + ((g * 26) | 0), gy = p.y + ((g * 22) | 0);
          ctx.fillRect(gx, gy, 2, 4);
          ctx.fillRect(gx + 4, gy + 2, 2, 3);
        }
      }
    }
  }
  drawFountain();
}

function drawFountain() {
  const t = T(), f = state.map.fountain;
  const p = worldToScreen(f.x - 1, f.y - 1);
  const size = t * 3;
  // stone rim with a bevel
  ctx.fillStyle = '#9a968f'; ctx.fillRect(p.x, p.y, size, size);
  ctx.fillStyle = '#b4b0a8'; ctx.fillRect(p.x, p.y, size, 5);
  ctx.fillStyle = '#7d7a74'; ctx.fillRect(p.x, p.y + size - 6, size, 6);
  ctx.fillStyle = '#6f6c66'; ctx.fillRect(p.x + 6, p.y + 6, size - 12, size - 12);

  const cx = p.x + size / 2, cy = p.y + size / 2;
  const wob = Math.sin(Date.now() / 620) * 1.5;
  ctx.fillStyle = '#3f86bd';
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.31, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5aa6dd';
  ctx.beginPath(); ctx.arc(cx, cy - 1, size * 0.31 - 4 + wob, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(230,245,255,.75)';
  ctx.beginPath(); ctx.arc(cx - 4, cy - 5, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#cfcac0';
  ctx.fillRect(cx - 3, cy - 14, 6, 14);
}

function drawScenery() {
  const t = T();
  for (const s of scenery) {
    const p = worldToScreen(s.x, s.y);
    if (p.x < -t * 2 || p.y < -t * 2 || p.x > canvas.width + t || p.y > canvas.height + t) continue;
    const cx = p.x + t / 2, cy = p.y + t / 2;

    if (s.kind === 'tree') {
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath(); ctx.ellipse(cx + 3, cy + 12, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5b3b22'; ctx.fillRect(cx - 3, cy - 2, 6, 15);
      const dark = s.v > 0.5 ? '#2f6b33' : '#35773a';
      const lite = s.v > 0.5 ? '#478f45' : '#4f9b4c';
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(cx, cy - 10, 14, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - 9, cy - 4, 10, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 9, cy - 4, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lite;
      ctx.beginPath(); ctx.arc(cx - 4, cy - 14, 9, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 6, cy - 11, 7, 0, Math.PI * 2); ctx.fill();
    } else if (s.kind === 'bush') {
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.beginPath(); ctx.ellipse(cx + 2, cy + 7, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3d7a3c';
      ctx.beginPath(); ctx.arc(cx - 5, cy + 1, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 5, cy + 1, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy - 4, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4d9149';
      ctx.beginPath(); ctx.arc(cx - 2, cy - 6, 5, 0, Math.PI * 2); ctx.fill();
    } else {
      const petals = ['#e8d24a', '#e07a9a', '#d8d8e8', '#e29a4a'];
      ctx.fillStyle = petals[(s.v * petals.length) | 0];
      for (let i = 0; i < 3; i++) {
        const fx = cx - 8 + ((noise(s.x, s.y, 40 + i) * 18) | 0);
        const fy = cy - 6 + ((noise(s.x, s.y, 60 + i) * 14) | 0);
        ctx.fillRect(fx, fy, 3, 3);
        ctx.fillStyle = 'rgba(90,150,80,.85)'; ctx.fillRect(fx + 1, fy + 3, 1, 3);
        ctx.fillStyle = petals[(s.v * petals.length) | 0];
      }
    }
  }
}

function drawHouses() {
  const t = T();
  for (const h of state.houses) {
    const p = worldToScreen(h.x, h.y);
    const w = h.w * t, ht = h.h * t;
    if (p.x + w < -60 || p.y + ht < -60 || p.x > canvas.width + 60 || p.y > canvas.height + 60) continue;

    // Real art wins when the village has made it.
    const sprite = art(`house/${h.id}`);
    if (sprite) {
      ctx.fillStyle = 'rgba(0,0,0,.26)';
      ctx.beginPath();
      ctx.ellipse(p.x + w / 2 + 6, p.y + ht + 4, w * 0.52, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      const sh = (sprite.naturalHeight / sprite.naturalWidth) * w;
      ctx.drawImage(sprite, p.x, p.y + ht - sh, w, sh);
      drawHouseSign(h, p, w, p.y + ht - sh - 26);
      continue;
    }

    const [roofA, roofB] = DEPT_ROOF[h.department] ?? ['#8c4b3f', '#743d33'];
    const wallY = p.y + ht * 0.44;
    const wallH = ht - ht * 0.44;

    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,.26)';
    ctx.beginPath(); ctx.ellipse(p.x + w / 2 + 6, p.y + ht + 4, w * 0.52, 9, 0, 0, Math.PI * 2); ctx.fill();

    // ---- walls: plaster with a timber base and corner posts ----
    ctx.fillStyle = '#e2d3b4'; ctx.fillRect(p.x, wallY, w, wallH);
    ctx.fillStyle = '#d3c2a0'; ctx.fillRect(p.x, wallY, w, 4);
    ctx.fillStyle = '#6f5334'; ctx.fillRect(p.x, p.y + ht - 7, w, 7);
    ctx.fillStyle = '#7d5d3c';
    ctx.fillRect(p.x, wallY, 6, wallH); ctx.fillRect(p.x + w - 6, wallY, 6, wallH);

    // ---- windows, lit from within ----
    const winCount = Math.max(1, Math.floor(h.w / 3));
    for (let i = 0; i < winCount; i++) {
      const wx = p.x + (w / (winCount + 1)) * (i + 1) - 11;
      const wy = wallY + 12;
      ctx.fillStyle = '#5a4126'; ctx.fillRect(wx - 2, wy - 2, 26, 24);
      ctx.fillStyle = '#f6d98a'; ctx.fillRect(wx, wy, 22, 20);
      ctx.fillStyle = 'rgba(255,240,190,.55)'; ctx.fillRect(wx, wy, 22, 8);
      ctx.fillStyle = '#5a4126';
      ctx.fillRect(wx + 10, wy, 2, 20); ctx.fillRect(wx, wy + 9, 22, 2);
      // spill of light onto the ground
      const grd = ctx.createLinearGradient(0, wy + 20, 0, wy + 46);
      grd.addColorStop(0, 'rgba(246,217,138,.20)');
      grd.addColorStop(1, 'rgba(246,217,138,0)');
      ctx.fillStyle = grd; ctx.fillRect(wx - 5, wy + 20, 32, 26);
    }

    // ---- roof ----
    // The silhouette must fill the footprint. A gable TRIANGLE leaves the top
    // corners of the collision box rendering as bare grass while still walking
    // like wall — which is exactly what it looked like: invisible obstacles
    // above the roofline. So the roof plane fills its rectangle and the gable
    // sits on top of it, and the eaves stay inside the box.
    const apexY = p.y;
    const roofBottom = wallY + 3;

    // the roof plane, filling the footprint corner to corner
    ctx.fillStyle = roofB;
    ctx.fillRect(p.x, apexY, w, roofBottom - apexY);

    // shingle courses across the whole plane
    const courses = 5;
    const ch = (roofBottom - apexY) / courses;
    for (let i = 0; i < courses; i++) {
      ctx.fillStyle = i % 2 ? roofA : roofB;
      ctx.fillRect(p.x, apexY + ch * i, w, ch + 1);
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      ctx.fillRect(p.x, apexY + ch * (i + 1) - 2, w, 2);
    }

    // hip slopes: shade the outer thirds so it reads as a pitched roof rather
    // than a flat slab, without changing the silhouette
    const slope = ctx.createLinearGradient(p.x, 0, p.x + w, 0);
    slope.addColorStop(0, 'rgba(0,0,0,.30)');
    slope.addColorStop(0.34, 'rgba(0,0,0,0)');
    slope.addColorStop(0.5, 'rgba(255,255,255,.10)');
    slope.addColorStop(0.66, 'rgba(0,0,0,0)');
    slope.addColorStop(1, 'rgba(0,0,0,.30)');
    ctx.fillStyle = slope;
    ctx.fillRect(p.x, apexY, w, roofBottom - apexY);

    // ridge line along the top
    ctx.fillStyle = '#4a3227';
    ctx.fillRect(p.x + w * 0.18, apexY, w * 0.64, 4);
    // eaves shadow where the roof meets the wall
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.fillRect(p.x, roofBottom - 2, w, 5);
    // chimney
    ctx.fillStyle = '#4a3227';
    ctx.fillRect(p.x + w * 0.72, apexY - 9, 9, 12);

    // ---- door ----
    const dp = worldToScreen(h.doorX, h.doorY);
    const dx = dp.x + 4, dy = p.y + ht - 34;
    ctx.fillStyle = '#4a3421'; ctx.fillRect(dx - 2, dy - 2, 26, 36);
    ctx.fillStyle = '#6b4a2c'; ctx.fillRect(dx, dy, 22, 34);
    ctx.fillStyle = '#5b3d24'; ctx.fillRect(dx + 3, dy + 4, 16, 12);
    ctx.fillStyle = '#d8b34a'; ctx.fillRect(dx + 17, dy + 20, 3, 3);

    // ---- sign, hung above the roofline so nobody in the doorway covers it ----
    drawHouseSign(h, p, w, p.y - 24);
  }
}

function drawHouseSign(h, p, w, sy) {
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  const lw = ctx.measureText(h.name).width + 16;
  const sx = p.x + w / 2 - lw / 2;
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(sx + 2, sy + 2, lw, 19);
  ctx.fillStyle = '#3a2a1c'; ctx.fillRect(sx, sy, lw, 19);
  ctx.fillStyle = '#6b4a2c'; ctx.fillRect(sx, sy, lw, 3);
  ctx.fillStyle = '#f0e2c6'; ctx.fillText(h.name, p.x + w / 2, sy + 14);
}

function drawPerson(agent, pos) {
  const t = T();
  const p = worldToScreen(pos.x, pos.y);
  const cx = p.x + t / 2, cy = p.y + t / 2;
  const isMe = agent.id === state.me;

  const facing = pos.facing ?? 'down';
  const sprite = art(`staff/${agent.id}/${facing}`) ?? art(`staff/${agent.id}/down`);
  if (sprite) {
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(cx, cy + 11, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    const sw = t * 1.1, sh = (sprite.naturalHeight / sprite.naturalWidth) * sw;
    ctx.drawImage(sprite, cx - sw / 2, cy + 11 - sh, sw, sh);
    drawNameTag(agent, cx, cy - sh + 14, isMe);
    drawBubble(agent, cx, cy - sh + 4);
    return;
  }

  const seed = agent.id.charCodeAt(0) + agent.id.length * 7;
  const skin = SKIN[seed % SKIN.length];
  const hair = HAIR[(seed * 3) % HAIR.length];
  const shirt = ROLE_COLOR[agent.role] ?? '#ccc';
  // gentle idle bob so the village never looks frozen
  const bob = Math.round(Math.sin(Date.now() / 700 + seed) * 1.2);

  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(cx, cy + 11, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();

  const top = cy + bob;
  ctx.fillStyle = '#3b3630'; ctx.fillRect(cx - 5, top + 6, 4, 5);   // legs
  ctx.fillRect(cx + 1, top + 6, 4, 5);
  ctx.fillStyle = shirt; ctx.fillRect(cx - 6, top - 4, 12, 11);      // torso
  ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(cx - 6, top + 4, 12, 3);
  ctx.fillStyle = skin;
  ctx.fillRect(cx - 8, top - 2, 2, 7); ctx.fillRect(cx + 6, top - 2, 2, 7); // arms
  ctx.fillRect(cx - 5, top - 14, 10, 11);                            // head
  ctx.fillStyle = hair;                                              // hair
  ctx.fillRect(cx - 6, top - 16, 12, 5);
  ctx.fillRect(cx - 6, top - 14, 2, 5); ctx.fillRect(cx + 4, top - 14, 2, 5);
  ctx.fillStyle = '#2a2018';                                         // eyes
  ctx.fillRect(cx - 3, top - 9, 2, 2); ctx.fillRect(cx + 1, top - 9, 2, 2);

  if (isMe) {                                                        // the Keeper's hat
    ctx.fillStyle = '#b8452f'; ctx.fillRect(cx - 8, top - 18, 16, 3);
    ctx.fillRect(cx - 5, top - 22, 10, 5);
  } else if (agent.role === 'house_assistant') {                     // hi-vis vest
    ctx.fillStyle = '#e8e04a'; ctx.fillRect(cx - 6, top - 3, 12, 4);
  }

  drawNameTag(agent, cx, top - 38, isMe);
  drawBubble(agent, cx, top - 48);
}

function drawNameTag(agent, cx, y, isMe) {
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  const nw = ctx.measureText(agent.name).width + 10;
  ctx.fillStyle = isMe ? 'rgba(184,69,47,.92)' : 'rgba(24,18,12,.8)';
  roundRect(cx - nw / 2, y, nw, 14, 3); ctx.fill();
  ctx.fillStyle = '#f4ead6';
  ctx.fillText(agent.name, cx, y + 10);
}

function drawBubble(agent, cx, y) {
  const bubble = state.bubbles.get(agent.id);
  if (!bubble || bubble.until <= Date.now()) return;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  const text = bubble.text.slice(0, 46);
  const bw = ctx.measureText(text).width + 18;
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  roundRect(cx - bw / 2 + 2, y - 24, bw, 22, 6); ctx.fill();
  ctx.fillStyle = 'rgba(248,240,225,.98)';
  roundRect(cx - bw / 2, y - 26, bw, 22, 6); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 5, y - 5); ctx.lineTo(cx + 5, y - 5); ctx.lineTo(cx, y + 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#241c17';
  ctx.fillText(text, cx, y - 11);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function render() {
  if (!canvas.width) resize();
  const t = T();
  const mine = state.positions.get(state.me);
  if (mine) {  // camera eases toward the Keeper
    const tx = mine.x * t - canvas.width / 2;
    const ty = mine.y * t - canvas.height / 2;
    state.camera.x += (tx - state.camera.x) * 0.12;
    state.camera.y += (ty - state.camera.y) * 0.12;
  }
  ctx.fillStyle = '#3f6b38';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGround();
  drawScenery();
  drawHouses();

  // Depth-sort so someone lower on the map draws in front.
  const people = state.staff
    .map((a) => ({ a, p: state.positions.get(a.id) }))
    .filter((x) => x.p)
    .sort((x, y) => x.p.y - y.p.y);
  for (const { a, p } of people) drawPerson(a, p);

  // Warm late-afternoon wash + a soft vignette, so the scene reads as a place
  // rather than a diagram.
  ctx.fillStyle = 'rgba(255,196,120,.055)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const vig = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.35,
    canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(20,14,8,.35)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  requestAnimationFrame(render);
}

// ------------------------------------------------------------------- walking

/**
 * Buildings are solid; their doorway is not.
 *
 * Walking through walls made the grounds feel like a diagram rather than a
 * place, and it removed the only reason to use a path.
 */
function blocked(x, y) {
  if (x < 0 || y < 0 || x >= state.map.w || y >= state.map.h) return true;
  for (const h of state.houses) {
    if (x === h.doorX && y === h.doorY) return false;          // the door is a way in
    if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return true;
  }
  return false;
}

function step(dx, dy) {
  const me = state.positions.get(state.me);
  if (!me) return;
  me.facing = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
  // Try the diagonal, then each axis, so sliding along a wall still works.
  const tries = dx && dy ? [[dx, dy], [dx, 0], [0, dy]] : [[dx, dy]];
  for (const [ax, ay] of tries) {
    const nx = me.x + ax, ny = me.y + ay;
    if (!blocked(nx, ny)) { me.x = nx; me.y = ny; return; }
  }
}

const KEYS = {
  arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1],
  arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0],
};

const held = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const k = e.key.toLowerCase();

  if (k === 'e' || k === ' ') { e.preventDefault(); interact(); return; }
  if (k === 'escape') { clearSelection(); return; }

  const move = KEYS[k];
  if (!move) return;
  e.preventDefault();
  // Step immediately on press. Draining a held-set from an interval alone
  // means a quick tap falls between ticks and nothing happens at all.
  if (!held.has(k)) step(move[0], move[1]);
  held.add(k);
});
addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
addEventListener('blur', () => held.clear());

// Continued movement while a key stays down.
setInterval(() => {
  let dx = 0, dy = 0;
  for (const k of held) { const m = KEYS[k]; if (m) { dx += m[0]; dy += m[1]; } }
  if (dx || dy) step(Math.sign(dx), Math.sign(dy));
}, 115);

// --------------------------------------------------------------- interacting

/** Whatever the Keeper is standing next to, if anything. */
function nearby() {
  const me = state.positions.get(state.me);
  if (!me) return null;

  let person = null, pd = 1.9;
  for (const a of state.staff) {
    if (a.id === state.me) continue;
    const p = state.positions.get(a.id);
    if (!p) continue;
    const d = Math.hypot(p.x - me.x, p.y - me.y);
    if (d < pd) { pd = d; person = a; }
  }
  if (person) return { kind: 'person', agent: person };

  for (const h of state.houses) {
    if (Math.hypot(h.doorX - me.x, h.doorY - me.y) < 1.9) return { kind: 'house', house: h };
  }
  const f = state.map.fountain;
  if (Math.hypot(f.x - me.x, f.y - me.y) < 2.6) return { kind: 'fountain' };
  return null;
}

function clearSelection() {
  selected = null;
  $('sel').classList.remove('on');
}

function showSelection(agent) {
  selected = agent;
  const el = $('sel');
  el.querySelector('.nm').textContent = agent.name;
  el.querySelector('.ti').textContent = `${agent.title} · ${agent.building}`;
  el.classList.add('on');
}

async function interact() {
  const near = nearby();
  if (!near) { toast('Nothing here. Walk up to someone, or to a door.'); return; }

  if (near.kind === 'person') { showSelection(near.agent); $('btn-talk').click(); return; }

  if (near.kind === 'house') {
    const h = near.house;
    if (h.id === 'the-inn') { $('btn-meeting').click(); return; }

    const who = state.staff.filter((a) => a.building === h.id);
    if (h.id === 'the-house') {
      const st = await fetch('/api/state').then((r) => r.json()).catch(() => null);
      toast(st
        ? `Your house. ${st.pendingApprovals} thing${st.pendingApprovals === 1 ? '' : 's'} waiting in the envelope.`
        : 'Your house.');
      return;
    }
    toast(who.length ? `${h.name} — ${who.map((a) => a.name).join(', ')}` : `${h.name} — nobody works here yet.`);
    return;
  }

  toast('The fountain. Somebody put a coin in it.');
}

// A quiet prompt for whatever is in reach, so the grounds tell you what they do.
setInterval(() => {
  const near = nearby();
  const el = $('hint');
  if (!near) { el.textContent = 'arrows / WASD to walk · E to interact'; return; }
  if (near.kind === 'person') el.textContent = `E — talk to ${near.agent.name}`;
  else if (near.kind === 'house') el.textContent = `E — ${near.house.id === 'the-inn' ? 'call a meeting' : near.house.name}`;
  else el.textContent = 'E — the fountain';
}, 220);

// ---------------------------------------------------------------- the panels
function renderApprovals(list) {
  const el = $('approvals');
  if (!list.length) { el.innerHTML = '<div class="empty">Nothing waiting on you.</div>'; return; }
  el.innerHTML = list.map((a) => `
    <div class="card">
      <div class="who">${esc(a.requestedBy)} · ${esc(a.capability)}</div>
      <div class="sum">${esc(a.summary)}</div>
      <div class="row">
        <button class="go" data-ok="1" data-id="${a.id}">Approve</button>
        <button data-ok="0" data-id="${a.id}">Not yet</button>
      </div>
    </div>`).join('');
  el.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    await fetch(`/api/approvals/${b.dataset.id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved: b.dataset.ok === '1', reason: '' }),
    });
    refreshPanels();
  }));
}

function renderMorale(list) {
  const el = $('morale');
  if (!list.length) { el.innerHTML = '<div class="empty">Nobody has done anything yet.</div>'; return; }
  el.innerHTML = list.map((m) => {
    const hue = Math.round((m.score / 100) * 110);
    return `<div class="m-row" title="${esc(m.name)}: ${esc(m.why)}">
      <div class="m-top">
        <span class="name">${esc(m.name)}</span>
        <span class="bar"><span class="fill" style="width:${m.score}%;background:hsl(${hue},62%,52%)"></span></span>
        <span class="n">${m.score}</span>
      </div>
      <div class="why">${esc(m.why)}</div>
    </div>`;
  }).join('');
}

function pushLog(e) {
  const who = e.actor;
  const what = e.kind.replace(/\./g, ' ');
  state.log.unshift(`<div><span class="a">${esc(who)}</span> ${esc(what)}${e.subject ? ' · ' + esc(e.subject) : ''}</div>`);
  state.log = state.log.slice(0, 60);
  $('log').innerHTML = state.log.join('');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function refreshPanels() {
  const [ap, mo, st] = await Promise.all([
    fetch('/api/approvals').then((r) => r.json()),
    fetch('/api/morale').then((r) => r.json()),
    fetch('/api/state').then((r) => r.json()),
  ]);
  renderApprovals(ap.filter((a) => a.tier === 'innkeeper'));
  renderMorale(mo);
  $('n-staff').textContent = st.staff.length;
  $('n-appr').textContent = st.pendingApprovals;
  $('n-notes').textContent = st.notes;
  $('chip-env').classList.toggle('alert', st.pendingApprovals > 0);
  $('n-inn').textContent = st.inn.running ? 'awake' : 'asleep';
  $('btn-open').textContent = st.inn.running ? 'Close the Inn' : 'Open the Inn';
  $('btn-open').className = st.inn.running ? '' : 'go';
  state.inn = st.inn;
}

// ------------------------------------------------------------------ liveness
async function boot() {
  const st = await fetch('/api/state').then((r) => r.json());
  state.map = st.map; state.houses = st.houses; state.staff = st.staff;
  state.me = st.inn.rules.innkeeper;
  for (const p of st.positions) state.positions.set(p.agentId, { x: p.x, y: p.y, activity: p.activity });
  $('n-spend').textContent = '$0.00';
  buildTerrain(); await loadArt(); resize(); render(); refreshPanels();

  const es = new EventSource('/api/stream');
  es.onerror = () => {
    $('n-inn').textContent = 'disconnected';
    $('chip-inn').classList.add('alert');
  };
  es.onopen = () => $('chip-inn').classList.remove('alert');
  es.addEventListener('tick', (ev) => {
    const d = JSON.parse(ev.data);
    for (const p of d.positions) {
      if (p.agentId === state.me) continue;   // never yank the Keeper around
      state.positions.set(p.agentId, { x: p.x, y: p.y, activity: p.activity });
    }
    let touched = false;
    for (const e of d.events) {
      pushLog(e);
      if (e.kind === 'agent.said') {
        const data = e.dataJson ? JSON.parse(e.dataJson) : {};
        state.bubbles.set(e.actor, { text: data.text ?? '', until: Date.now() + 7000 });
      }
      if (e.kind === 'art.hung') loadArt();   // pick up new art the moment it is hung
      if (e.kind.startsWith('gate.escalate') || e.kind.startsWith('approval.') ||
          e.kind === 'agent.hired' || e.kind === 'note.written') touched = true;
    }
    if (touched) refreshPanels();
  });
  setInterval(refreshPanels, 15000);
}

/**
 * In-page dialog. Native prompt()/confirm() THROW in embedded browsers
 * ("prompt() is not supported"), which killed the meeting handler on its very
 * first line and made every button look dead. The village never depends on
 * them now.
 */
let selected = null;

function ask({ title, sub, placeholder, value = '' }) {
  return new Promise((resolve) => {
    const veil = $('veil'), ta = $('dlg-text');
    $('dlg').querySelector('h3').textContent = title;
    $('dlg').querySelector('.sub').textContent = sub ?? '';
    ta.placeholder = placeholder ?? '';
    ta.value = value;
    veil.classList.add('on');
    setTimeout(() => ta.focus(), 30);

    const done = (result) => {
      veil.classList.remove('on');
      $('dlg-ok').removeEventListener('click', ok);
      $('dlg-cancel').removeEventListener('click', no);
      ta.removeEventListener('keydown', key);
      resolve(result);
    };
    const ok = () => done(ta.value.trim() || null);
    const no = () => done(null);
    const key = (e) => {
      if (e.key === 'Escape') no();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ok();
    };
    $('dlg-ok').addEventListener('click', ok);
    $('dlg-cancel').addEventListener('click', no);
    ta.addEventListener('keydown', key);
  });
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

// ---- click a staff member to select them ----
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const t = T();
  const wx = (e.clientX - r.left + state.camera.x) / t;
  const wy = (e.clientY - r.top + state.camera.y) / t;

  let best = null, bestD = 1.6;   // tiles
  for (const a of state.staff) {
    if (a.id === state.me) continue;
    const p = state.positions.get(a.id);
    if (!p) continue;
    const d = Math.hypot(p.x - wx, p.y - wy);
    if (d < bestD) { bestD = d; best = a; }
  }
  if (!best) { clearSelection(); return; }
  showSelection(best);
});

$('btn-talk').addEventListener('click', async () => {
  if (!selected) return;
  const text = await ask({
    title: `Say something to ${selected.name}`,
    sub: `${selected.title}. They read it when they next wake — ⌘/Ctrl+Enter to send.`,
    placeholder: 'What do you need from them?',
  });
  if (!text) return;
  const r = await fetch('/api/say', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: selected.id, text }),
  }).then((x) => x.json()).catch(() => null);
  toast(r ? `Sent to ${selected.name}. They will read it when they wake.` : 'Could not reach the Inn.');
});

$('btn-open').addEventListener('click', async () => {
  const running = state.inn?.running;
  const r = await fetch(running ? '/api/inn/close' : '/api/inn/open', { method: 'POST' })
    .then((x) => x.json()).catch(() => null);
  if (!r) { toast('Could not reach the Inn — is the server running?'); return; }
  toast(r.running ? 'The Inn is open. The staff are waking.' : 'The Inn is closed.');
  refreshPanels();
});

$('btn-meeting').addEventListener('click', async () => {
  const topic = await ask({
    title: 'Call everyone to the Inn',
    sub: 'They stop what they are doing, walk over, and wake to read this.',
    placeholder: 'What do you want to ask them?',
  });
  if (!topic) return;
  const r = await fetch('/api/meeting', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic }),
  }).then((x) => x.json()).catch(() => null);
  toast(r ? `Summoned ${r.summoned} to the Inn.` : 'Could not reach the Inn.');
});

boot();
