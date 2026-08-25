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

    // ---- roof: shingled courses, ridge, overhang shadow ----
    const apexY = p.y - 6;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p.x - 9, wallY + 3);
    ctx.lineTo(p.x + w / 2, apexY);
    ctx.lineTo(p.x + w + 9, wallY + 3);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = roofB; ctx.fillRect(p.x - 12, apexY - 4, w + 24, wallY - apexY + 12);
    const courses = 6;
    for (let i = 0; i < courses; i++) {
      const yy = apexY + ((wallY + 3 - apexY) / courses) * i;
      ctx.fillStyle = i % 2 ? roofA : roofB;
      ctx.fillRect(p.x - 12, yy, w + 24, (wallY + 3 - apexY) / courses + 1);
      ctx.fillStyle = 'rgba(0,0,0,.13)';
      ctx.fillRect(p.x - 12, yy + (wallY + 3 - apexY) / courses - 2, w + 24, 2);
    }
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.beginPath();
    ctx.moveTo(p.x + w / 2, apexY); ctx.lineTo(p.x - 9, wallY + 3);
    ctx.lineTo(p.x + w / 2, wallY + 3); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(p.x - 9, wallY + 1, w + 18, 5);
    ctx.fillStyle = '#4a3227';
    ctx.fillRect(p.x + w / 2 - 2, apexY - 2, 4, 8);

    // ---- door ----
    const dp = worldToScreen(h.doorX, h.doorY);
    const dx = dp.x + 4, dy = p.y + ht - 34;
    ctx.fillStyle = '#4a3421'; ctx.fillRect(dx - 2, dy - 2, 26, 36);
    ctx.fillStyle = '#6b4a2c'; ctx.fillRect(dx, dy, 22, 34);
    ctx.fillStyle = '#5b3d24'; ctx.fillRect(dx + 3, dy + 4, 16, 12);
    ctx.fillStyle = '#d8b34a'; ctx.fillRect(dx + 17, dy + 20, 3, 3);

    // ---- sign, hung above the roofline so nobody in the doorway covers it ----
    drawHouseSign(h, p, w, apexY - 26);
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
const held = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  held.add(e.key.toLowerCase());
});
addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));

setInterval(() => {
  const me = state.positions.get(state.me);
  if (!me) return;
  let dx = 0, dy = 0;
  if (held.has('arrowup') || held.has('w')) dy = -1;
  if (held.has('arrowdown') || held.has('s')) dy = 1;
  if (held.has('arrowleft') || held.has('a')) dx = -1;
  if (held.has('arrowright') || held.has('d')) dx = 1;
  if (!dx && !dy) return;
  me.x = Math.max(0, Math.min(state.map.w - 1, me.x + dx));
  me.y = Math.max(0, Math.min(state.map.h - 1, me.y + dy));
}, 110);

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

$('btn-open').addEventListener('click', async () => {
  const running = state.inn?.running;
  await fetch(running ? '/api/inn/close' : '/api/inn/open', { method: 'POST' });
  refreshPanels();
});

$('btn-meeting').addEventListener('click', async () => {
  const topic = prompt('What is the meeting about?');
  if (!topic) return;
  await fetch('/api/meeting', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic }),
  });
});

boot();
