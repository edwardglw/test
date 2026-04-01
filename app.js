"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// DOM
// ─────────────────────────────────────────────────────────────────────────────
const canvas       = document.getElementById("canvas");
const stage        = document.getElementById("stage");
const ctx          = canvas.getContext("2d");
const hamburgerBtn = document.getElementById("hamburger-btn");
const sideNav      = document.getElementById("side-nav");
const coordDisplay = document.getElementById("coord-display");

// Inject backdrop element for mobile overlay
const backdrop = document.createElement("div");
backdrop.className = "nav-backdrop";
document.body.appendChild(backdrop);

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let W = 0, H = 0;
let currentPage = 0; // 0=Stochasticity  1=Panorama  2=Flux  3=Strata

const pointer = { x: 0.5, y: 0.5 };
const smooth  = { x: 0.5, y: 0.5 };

// Each page gets a seed (0–1) used to drive a deterministic RNG
const seeds = [Math.random(), Math.random(), Math.random(), Math.random()];

// Per-page cached data
let mapData    = null;
let formShapes = [];
let formPalIdx = 0;

// Flux (page 2)
let fluxData      = null;   // sphere radius + palette
// Strata (page 3)
let strataData    = null;   // layered wave forms
let fluxParticles = [];     // burst particles
let fluxStars     = [];     // background star field
let fluxLines     = [];     // horizontal speed lines

// Vision pages (page 4+) — each upload creates a new entry
let visionPages = [];

// ─── Card system globals ───────────────────────────────────────────────────
const cardPositions = {};  // "pageIdx:id" → {x, y}  — persists across navigation
const cardsByPage   = {};  // pageIdx → [cardObj, ...]
let   cardZTop      = 20;
let   cardDrag      = null;

// Parse an rgb(r,g,b) CSS string to [r,g,b]
function parseRgb(str) {
  const m = str.match(/\d+/g);
  return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeded LCG random-number generator
// ─────────────────────────────────────────────────────────────────────────────
function makeRng(seed) {
  let s = Math.max(1, Math.floor(seed * 2_147_483_646));
  return () => {
    s = (s * 16_807) % 2_147_483_647;
    return (s - 1) / 2_147_483_646;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas resize
// ─────────────────────────────────────────────────────────────────────────────
function resize() {
  const b   = stage.getBoundingClientRect();
  W         = Math.floor(b.width);
  H         = Math.floor(b.height);
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width  = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  initMap();
  initForms();
  initFlux();
  initStrata();

  // Reinit vision particle positions (they're in canvas-space px)
  for (const vp of visionPages) {
    if (vp.particles) initVisionFlowField(vp);
  }

  // Reposition and redraw cards for the current page
  const resizeCards = cardsByPage[currentPage];
  if (resizeCards) {
    resizeCards.forEach((c, i) => {
      if (c.el.style.display !== "none") {
        placeCard(c, i);
        if (!c.isLive) c.drawFn(c.cx, c.w, c.h);
      }
    });
  }
}

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resize, 80);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pointer tracking
// ─────────────────────────────────────────────────────────────────────────────
stage.addEventListener("pointermove", e => {
  const b   = stage.getBoundingClientRect();
  pointer.x = (e.clientX - b.left) / b.width;
  pointer.y = (e.clientY - b.top)  / b.height;
});
stage.addEventListener("pointerleave", () => { pointer.x = 0.5; pointer.y = 0.5; });

// ─────────────────────────────────────────────────────────────────────────────
// CARD SYSTEM — draggable data panels overlaid on the stage
// ─────────────────────────────────────────────────────────────────────────────
const cardLayer = document.getElementById("card-layer");

// ── Drag ──────────────────────────────────────────────────────────────────────
cardLayer.addEventListener("pointerdown", e => {
  const hdr = e.target.closest(".card-hdr");
  if (!hdr) return;
  const el = hdr.closest(".card");
  if (!el) return;
  e.preventDefault();
  const r = el.getBoundingClientRect();
  cardDrag = { el, ox: e.clientX - r.left, oy: e.clientY - r.top };
  el.style.zIndex = ++cardZTop;
  cardLayer.setPointerCapture(e.pointerId);
});

cardLayer.addEventListener("pointermove", e => {
  if (!cardDrag) return;
  const sr = stage.getBoundingClientRect();
  const el = cardDrag.el;
  let x = e.clientX - sr.left - cardDrag.ox;
  let y = e.clientY - sr.top  - cardDrag.oy;
  x = Math.max(0, Math.min(W - el.offsetWidth,  x));
  y = Math.max(0, Math.min(H - el.offsetHeight, y));
  el.style.left = x + "px";
  el.style.top  = y + "px";
  cardPositions[el.dataset.key] = { x, y };
});

cardLayer.addEventListener("pointerup",     () => { cardDrag = null; });
cardLayer.addEventListener("pointercancel", () => { cardDrag = null; });

// ── Build utility ─────────────────────────────────────────────────────────────
// Creates a card DOM element with a 2× canvas inside, appends to cardLayer.
// drawFn(cx, w, h) renders content onto the card's canvas.
// isLive = true → drawFn is called every frame from drawLiveCards().
function buildCard(pageIdx, id, title, w, h, drawFn, isLive) {
  const key = `${pageIdx}:${id}`;
  const el  = document.createElement("div");
  el.className   = "card";
  el.dataset.key = key;
  el.style.display = "none";
  el.style.zIndex  = cardZTop;

  const hdr = document.createElement("div");
  hdr.className = "card-hdr";
  hdr.textContent = title;
  el.appendChild(hdr);

  const body = document.createElement("div");
  body.className = "card-body";
  el.appendChild(body);

  const cvs = document.createElement("canvas");
  cvs.width  = w * 2;
  cvs.height = h * 2;
  cvs.style.cssText = `width:${w}px;height:${h}px;display:block`;
  body.appendChild(cvs);

  const cx = cvs.getContext("2d");
  cx.scale(2, 2);

  cardLayer.appendChild(el);
  return { el, cvs, cx, w, h, key, drawFn, isLive: !!isLive };
}

// Position a card using saved coords or a default staggered layout
function placeCard(card, idx) {
  let x, y;
  const saved = cardPositions[card.key];
  if (saved) {
    x = saved.x;
    y = saved.y;
  } else {
    const gap = 12;
    const cw  = card.w + 24;   // card + body padding
    const ch  = card.h + 30;   // card + header + body padding
    x = W - cw - gap;
    y = gap + idx * (ch + gap);
  }
  x = Math.max(0, Math.min(W - card.w - 24, x));
  y = Math.max(0, Math.min(H - card.h - 30, y));
  card.el.style.left = x + "px";
  card.el.style.top  = y + "px";
}

// Show cards for page p; hide all others; draw static content
function showCardsForPage(p) {
  Object.values(cardsByPage).forEach(arr => arr.forEach(c => (c.el.style.display = "none")));
  const cards = cardsByPage[p] || [];
  cards.forEach((c, i) => {
    placeCard(c, i);
    c.el.style.display = "";
    if (!c.isLive) c.drawFn(c.cx, c.w, c.h);
  });
}

// Draw all live (per-frame) cards for the current page
function drawLiveCards() {
  const cards = cardsByPage[currentPage];
  if (!cards) return;
  for (const c of cards) {
    if (c.isLive && c.el.style.display !== "none") {
      c.cx.clearRect(0, 0, c.w, c.h);
      c.drawFn(c.cx, c.w, c.h);
    }
  }
}

// Lazy build: create cards for page p the first time it is visited
function ensureCards(p) {
  if (cardsByPage[p]) return;
  if      (p === 0) buildMapCards();
  else if (p === 1) buildFormsCards();
  else if (p === 2) buildFluxCards();
  else if (p === 3) buildStrataCards();
  else if (p >= 4)  buildVisionCards(p);
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 0 — Stochasticity (Cartographic Map)
// ─────────────────────────────────────────────────────────────────────────────

// Four seeded cartographic colour themes
const MAP_THEMES = [
  // Ordnance Survey
  { land: '#f4e8ce', water: '#8ec8dc', waterD: '#3a90b4',
    cRgb: '150,90,30',  roadA: '#cc4010', roadB: '#e08040',
    uRgb: '20,80,100',  gRgb: '80,130,160', iRgb: '18,60,80' },
  // Maritime chart
  { land: '#ede5cf', water: '#1e4f78', waterD: '#0c2d50',
    cRgb: '100,70,30',  roadA: '#b81818', roadB: '#d04030',
    uRgb: '60,40,20',   gRgb: '170,150,110', iRgb: '30,18,8' },
  // Geological survey
  { land: '#e4edd0', water: '#3a7898', waterD: '#1c4c6c',
    cRgb: '90,110,50',  roadA: '#1848a0', roadB: '#406898',
    uRgb: '50,70,30',   gRgb: '70,110,70',  iRgb: '18,48,28' },
  // Modern topo
  { land: '#f0ece0', water: '#0a7282', waterD: '#064a5a',
    cRgb: '8,110,100',  roadA: '#e06010', roadB: '#f09030',
    uRgb: '8,90,100',   gRgb: '8,90,100',   iRgb: '8,72,86' },
];

function initMap() {
  const rng = makeRng(seeds[0]);

  const themeIdx  = Math.floor(rng() * MAP_THEMES.length);

  // Coastline — bezier from left edge to bottom edge
  const coastLeftY = 0.28 + rng() * 0.38;
  const coastBtmX  = 0.32 + rng() * 0.42;
  const cCP1x = rng() * 0.30;
  const cCP1y = coastLeftY + 0.05 + rng() * 0.20;
  const cCP2x = Math.max(0.05, coastBtmX - 0.06 - rng() * 0.18);
  const cCP2y = 0.58 + rng() * 0.30;

  // Hill / terrain
  const hillX        = 0.38 + rng() * 0.36;
  const hillY        = 0.20 + rng() * 0.32;
  const hillRX       = 0.14 + rng() * 0.18;
  const hillRY       = 0.10 + rng() * 0.14;
  const hillAngle    = rng() * Math.PI;
  const contourRings = Math.floor(14 + rng() * 10);

  // Urban area
  const urbanX     = Math.max(0.04, Math.min(0.45, coastBtmX * 0.6 + rng() * 0.2));
  const urbanY     = coastLeftY + 0.06 + rng() * 0.18;
  const urbanAngle = (rng() - 0.5) * 0.20;
  const cellSize   = 9 + rng() * 9;

  // Urban street layout — irregular column/row spacings (multipliers on cellSize)
  const rng2 = makeRng(seeds[0] * 2.71828 + 0.1);
  const colSpacings = Array.from({ length: 32 }, () => 0.65 + rng2() * 0.95);
  const rowSpacings = Array.from({ length: 26 }, () => 0.65 + rng2() * 0.95);
  // Diagonal avenues cutting through the grid (1–2)
  const numDiag  = Math.floor(1 + rng2() * 2);
  const diagonals = Array.from({ length: numDiag }, (_, i) => ({
    ox:    rng2() * 0.30,                       // x-offset (fraction of urban width)
    angle: Math.PI * (0.10 + rng2() * 0.20),   // shallow diagonal
    primary: i === 0,
  }));

  // Roads
  const roadCount = Math.floor(2 + rng() * 3);
  const roads = [];
  for (let i = 0; i < roadCount; i++) {
    roads.push({
      x0:  rng() * 0.28,        y0:  0.20 + rng() * 0.60,
      cpX: 0.20 + rng() * 0.50, cpY: 0.10 + rng() * 0.75,
      x1:  0.65 + rng() * 0.35, y1:  0.08 + rng() * 0.84,
      w:   2.5  + rng() * 5,    primary: i === 0,
    });
  }

  // River from hill toward coast
  const rivSX  = hillX + (rng() - 0.5) * 0.10;
  const rivSY  = hillY + hillRY + rng() * 0.08;
  const rivEX  = cCP2x + (rng() - 0.5) * 0.12;
  const rivEY  = cCP2y + (rng() - 0.5) * 0.10;
  const rivCPX = (rivSX + rivEX) * 0.5 + (rng() - 0.5) * 0.14;
  const rivCPY = (rivSY + rivEY) * 0.5 + rng() * 0.10;

  mapData = {
    themeIdx,
    coastLeftY, coastBtmX, cCP1x, cCP1y, cCP2x, cCP2y,
    hillX, hillY, hillRX, hillRY, hillAngle, contourRings,
    urbanX, urbanY, urbanAngle, cellSize,
    roads,
    rivSX, rivSY, rivEX, rivEY, rivCPX, rivCPY,
    colSpacings, rowSpacings, diagonals,
  };
}

function drawMap(t) {
  if (!mapData) return;
  const m = mapData;
  const th = MAP_THEMES[m.themeIdx];

  // Six parallax layers — 0.022 (bg) to 0.60 (fg) gives very dramatic depth
  const ox = smooth.x - 0.5;
  const oy = smooth.y - 0.5;
  const L = [
    [ox * W * 0.022, oy * H * 0.022],  // 0 – water / land
    [ox * W * 0.07,  oy * H * 0.07 ],  // 1 – contour rings
    [ox * W * 0.14,  oy * H * 0.14 ],  // 2 – graticule grid
    [ox * W * 0.26,  oy * H * 0.26 ],  // 3 – urban + river
    [ox * W * 0.42,  oy * H * 0.42 ],  // 4 – roads
    [ox * W * 0.60,  oy * H * 0.60 ],  // 5 – symbols (foreground)
  ];

  // ── BG · Styled reference map (bedrock — barely-visible city map) ───────
  ctx.save();
  ctx.translate(ox * W * 0.008, oy * H * 0.008);

  // Zone patches: parks, commercial, residential, mixed (ultra-faint fills)
  const bgZones = [
    [0.04, 0.06, 0.20, 0.28, '180,210,170', 0.055],
    [0.40, 0.18, 0.26, 0.24, '200,185,210', 0.045],
    [0.68, 0.48, 0.24, 0.36, '210,200,182', 0.050],
    [0.12, 0.58, 0.30, 0.32, '182,200,218', 0.045],
    [0.50, 0.62, 0.22, 0.26, '200,215,182', 0.040],
  ];
  for (const [rx, ry, rw, rh, rgb, a] of bgZones) {
    ctx.fillStyle = `rgba(${rgb},${a})`;
    ctx.fillRect(rx * W - 60, ry * H - 60, rw * W + 120, rh * H + 120);
  }

  // Arterial roads (major) — 2-level road hierarchy across whole canvas
  ctx.strokeStyle = `rgba(${th.iRgb},0.11)`;
  ctx.lineWidth   = 0.95;
  const msx = W * 0.088, msy = H * 0.080;
  for (let x = msx * 0.65; x < W + msx; x += msx) {
    ctx.beginPath(); ctx.moveTo(x, -8); ctx.lineTo(x, H + 8); ctx.stroke();
  }
  for (let y = msy * 0.65; y < H + msy; y += msy) {
    ctx.beginPath(); ctx.moveTo(-8, y); ctx.lineTo(W + 8, y); ctx.stroke();
  }

  // Secondary streets
  ctx.strokeStyle = `rgba(${th.iRgb},0.055)`;
  ctx.lineWidth   = 0.45;
  const ssx = W * 0.028, ssy = H * 0.025;
  for (let x = ssx * 0.5; x < W + ssx; x += ssx) {
    ctx.beginPath(); ctx.moveTo(x, -4); ctx.lineTo(x, H + 4); ctx.stroke();
  }
  for (let y = ssy * 0.5; y < H + ssy; y += ssy) {
    ctx.beginPath(); ctx.moveTo(-4, y); ctx.lineTo(W + 4, y); ctx.stroke();
  }

  ctx.restore();

  // ── L0 · Water + land base ──────────────────────────────────────────────
  ctx.save();
  ctx.translate(L[0][0], L[0][1]);

  // Land fill
  ctx.fillStyle = th.land;
  ctx.fillRect(-200, -200, W + 400, H + 400);

  // Build coastline path (reused for fill + stroke)
  const cl  = m.coastLeftY, cb = m.coastBtmX;
  const c1x = m.cCP1x * W,  c1y = m.cCP1y * H;
  const c2x = m.cCP2x * W,  c2y = m.cCP2y * H;

  // Water fill
  const wGrad = ctx.createLinearGradient(-20, cl * H, cb * W, H + 20);
  wGrad.addColorStop(0, th.water);
  wGrad.addColorStop(1, th.waterD);
  ctx.fillStyle = wGrad;
  ctx.beginPath();
  ctx.moveTo(-30, cl * H);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, cb * W, H + 30);
  ctx.lineTo(-30, H + 30);
  ctx.closePath();
  ctx.fill();

  // Water shimmer (clipped to water shape)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-30, cl * H);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, cb * W, H + 30);
  ctx.lineTo(-30, H + 30);
  ctx.closePath();
  ctx.clip();
  for (let i = 0; i < 20; i++) {
    const wy  = cl * H + i * H * 0.055 + Math.sin(t * 0.0006 + i * 0.65) * 6;
    const alp = 0.055 + (i % 3 === 0 ? 0.055 : 0);
    ctx.strokeStyle = `rgba(255,255,255,${alp})`;
    ctx.lineWidth   = 0.6;
    ctx.beginPath();
    ctx.moveTo(-20, wy + Math.cos(i * 0.4) * 5);
    ctx.bezierCurveTo(W * 0.3, wy - 5, W * 0.65, wy + 5, W + 20, wy + Math.sin(i * 0.35) * 4);
    ctx.stroke();
  }
  ctx.restore();

  // Coastline edge
  ctx.strokeStyle = `rgba(${th.iRgb},0.72)`;
  ctx.lineWidth   = 1.8;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(-30, cl * H);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, cb * W, H + 30);
  ctx.stroke();

  ctx.restore();

  // ── L1 · Topographic contour rings ──────────────────────────────────────
  ctx.save();
  ctx.translate(L[1][0], L[1][1]);

  const hx = m.hillX * W, hy = m.hillY * H;
  const hrx = m.hillRX * W, hry = m.hillRY * H;

  for (let i = 0; i < m.contourRings; i++) {
    // Outer rings use gentle breathing animation
    const breath   = i < 5 ? Math.sin(t * 0.00055 + i * 0.75) * 3 : 0;
    const rFactor  = Math.pow(1 - i / m.contourRings, 0.65);
    const rx = rFactor * hrx + breath;
    const ry = rFactor * hry + breath * 0.7;

    const idx5 = i % 5;
    const alp  = idx5 === 0 ? 0.82 : (idx5 % 2 === 0 ? 0.46 : 0.22);
    const lw   = idx5 === 0 ? 1.65 : (idx5 % 2 === 0 ? 0.85 : 0.44);

    ctx.strokeStyle = `rgba(${th.cRgb},${alp})`;
    ctx.lineWidth   = lw;
    ctx.beginPath();
    ctx.ellipse(hx, hy, rx, ry, m.hillAngle, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Summit dot
  const sPulse = Math.sin(t * 0.0018) * 1.6;
  ctx.fillStyle   = `rgba(${th.cRgb},0.92)`;
  ctx.strokeStyle = `rgba(${th.iRgb},0.6)`;
  ctx.lineWidth   = 0.8;
  ctx.beginPath(); ctx.arc(hx, hy + sPulse, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  ctx.restore();

  // ── L2 · Graticule ──────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(L[2][0], L[2][1]);

  const gStep = Math.min(W, H) * 0.12;
  ctx.strokeStyle = `rgba(${th.gRgb},0.15)`;
  ctx.lineWidth   = 0.55;
  ctx.setLineDash([3, 7]);
  for (let x = gStep * 0.5; x < W + gStep; x += gStep) {
    ctx.beginPath(); ctx.moveTo(x, -20); ctx.lineTo(x, H + 20); ctx.stroke();
  }
  for (let y = gStep * 0.5; y < H + gStep; y += gStep) {
    ctx.beginPath(); ctx.moveTo(-20, y); ctx.lineTo(W + 20, y); ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.restore();

  // ── L3 · Urban street network ────────────────────────────────────────────
  ctx.save();
  ctx.translate(W * m.urbanX + L[3][0], H * m.urbanY + L[3][1]);
  ctx.rotate(m.urbanAngle);

  const cw = m.cellSize, ch = m.cellSize * 0.62;
  const uW  = W * 0.74,  uH = H * 0.64;  // urban coverage extent

  // Build irregular vertical street positions from seeded spacings
  const vStreets = [];
  let vx = -cw * 3, vi = 0;
  for (const sp of m.colSpacings) {
    vx += cw * sp;
    if (vx > uW + cw * 3) break;
    vStreets.push({ x: vx, primary: vi % 4 === 0 });
    vi++;
  }

  // Build irregular horizontal street positions
  const hStreets = [];
  let sy = -ch * 3, si = 0;
  for (const sp of m.rowSpacings) {
    sy += ch * sp;
    if (sy > uH + ch * 3) break;
    hStreets.push({ y: sy, primary: si % 3 === 0 });
    si++;
  }

  ctx.lineCap = 'butt';

  // Vertical streets
  for (const s of vStreets) {
    ctx.strokeStyle = s.primary ? `rgba(${th.uRgb},0.56)` : `rgba(${th.uRgb},0.28)`;
    ctx.lineWidth   = s.primary ? 1.8 : 0.65;
    ctx.beginPath();
    ctx.moveTo(s.x, -ch * 3); ctx.lineTo(s.x, uH + ch * 3);
    ctx.stroke();
  }

  // Horizontal streets
  for (const s of hStreets) {
    ctx.strokeStyle = s.primary ? `rgba(${th.uRgb},0.52)` : `rgba(${th.uRgb},0.26)`;
    ctx.lineWidth   = s.primary ? 1.6 : 0.62;
    ctx.beginPath();
    ctx.moveTo(-cw * 3, s.y); ctx.lineTo(uW + cw * 3, s.y);
    ctx.stroke();
  }

  // Diagonal avenues cutting through the grid
  ctx.lineCap = 'round';
  for (const d of m.diagonals) {
    const diagLen = Math.hypot(uW, uH) * 1.4;
    const sx = d.ox * uW;
    ctx.strokeStyle = d.primary ? `rgba(${th.uRgb},0.68)` : `rgba(${th.uRgb},0.48)`;
    ctx.lineWidth   = d.primary ? 2.6 : 1.6;
    ctx.beginPath();
    ctx.moveTo(sx - Math.cos(d.angle) * diagLen * 0.55,
               0  - Math.sin(d.angle) * diagLen * 0.55);
    ctx.lineTo(sx + Math.cos(d.angle) * diagLen * 0.55,
               0  + Math.sin(d.angle) * diagLen * 0.55);
    ctx.stroke();
  }

  ctx.restore();

  // River
  ctx.save();
  ctx.translate(L[3][0], L[3][1]);
  ctx.lineCap = 'round';

  ctx.strokeStyle = `rgba(${th.uRgb},0.3)`;
  ctx.lineWidth   = 5;
  ctx.beginPath();
  ctx.moveTo(m.rivSX * W, m.rivSY * H);
  ctx.quadraticCurveTo(m.rivCPX * W, m.rivCPY * H, m.rivEX * W, m.rivEY * H);
  ctx.stroke();

  ctx.strokeStyle = th.water;
  ctx.lineWidth   = 2.4;
  ctx.beginPath();
  ctx.moveTo(m.rivSX * W, m.rivSY * H);
  ctx.quadraticCurveTo(m.rivCPX * W, m.rivCPY * H, m.rivEX * W, m.rivEY * H);
  ctx.stroke();

  ctx.restore();

  // ── L4 · Roads ───────────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(L[4][0], L[4][1]);
  ctx.lineCap = 'round';

  for (const r of m.roads) {
    const x0  = r.x0  * W, y0  = r.y0  * H;
    const cpX = r.cpX * W, cpY = r.cpY * H;
    const x1  = r.x1  * W, y1  = r.y1  * H;

    ctx.strokeStyle = `rgba(${th.iRgb},0.48)`;
    ctx.lineWidth   = r.w + 3.5;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cpX, cpY, x1, y1); ctx.stroke();

    ctx.strokeStyle = r.primary ? th.roadA : th.roadB;
    ctx.lineWidth   = r.w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cpX, cpY, x1, y1); ctx.stroke();
  }
  ctx.restore();

  // ── L5 · Symbols + cartographic furniture ───────────────────────────────
  ctx.save();
  ctx.translate(L[5][0], L[5][1]);

  // Spot height crosses (scattered on land)
  const spots = [
    { rx: m.hillX + m.hillRX * 0.65, ry: m.hillY - m.hillRY * 0.5 },
    { rx: m.urbanX + 0.14,            ry: m.urbanY + 0.04 },
    { rx: m.coastBtmX - 0.10,         ry: m.coastLeftY + 0.14 },
    { rx: Math.min(0.90, m.hillX + 0.28), ry: Math.min(0.88, m.hillY + 0.32) },
  ];

  for (let i = 0; i < spots.length; i++) {
    const sx    = Math.max(0.06, Math.min(0.94, spots[i].rx)) * W;
    const sy    = Math.max(0.06, Math.min(0.94, spots[i].ry)) * H;
    const pulse = Math.sin(t * 0.0016 + i * 1.9) * 1.5;
    ctx.fillStyle   = `rgba(${th.cRgb},0.55)`;
    ctx.strokeStyle = `rgba(${th.iRgb},0.72)`;
    ctx.lineWidth   = 1.2;
    ctx.beginPath();
    ctx.moveTo(sx - 5, sy + pulse); ctx.lineTo(sx + 5, sy + pulse);
    ctx.moveTo(sx, sy - 5 + pulse); ctx.lineTo(sx, sy + 5 + pulse);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy + pulse, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  // North arrow
  const nax = W * 0.922, nay = H * 0.082;
  ctx.strokeStyle = `rgba(${th.iRgb},0.62)`;
  ctx.fillStyle   = `rgba(${th.iRgb},0.72)`;
  ctx.lineWidth   = 1.2;
  ctx.beginPath(); ctx.moveTo(nax, nay + 14); ctx.lineTo(nax, nay - 14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(nax, nay - 16); ctx.lineTo(nax - 5, nay - 4); ctx.lineTo(nax + 5, nay - 4); ctx.closePath(); ctx.fill();
  ctx.font      = `bold ${Math.max(9, W * 0.01)}px "Courier New",monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('N', nax, nay + 26);

  // Scale bar with checkerboard
  const sbX = W * 0.76, sbY = H * 0.930, sbLen = W * 0.10;
  ctx.strokeStyle = `rgba(${th.iRgb},0.62)`;
  ctx.lineWidth   = 1.2;
  ctx.beginPath();
  ctx.moveTo(sbX, sbY);              ctx.lineTo(sbX + sbLen, sbY);
  ctx.moveTo(sbX, sbY - 4);         ctx.lineTo(sbX, sbY + 4);
  ctx.moveTo(sbX + sbLen, sbY - 4); ctx.lineTo(sbX + sbLen, sbY + 4);
  ctx.moveTo(sbX + sbLen*0.5, sbY - 3); ctx.lineTo(sbX + sbLen*0.5, sbY + 3);
  ctx.stroke();
  ctx.fillStyle = `rgba(${th.iRgb},0.55)`;
  ctx.fillRect(sbX, sbY - 3, sbLen * 0.5, 3);
  ctx.fillRect(sbX + sbLen * 0.5, sbY, sbLen * 0.5, 3);
  const fSz = Math.max(8, W * 0.0095);
  ctx.font = `${fSz}px "Courier New",monospace`;
  ctx.fillStyle = `rgba(${th.iRgb},0.55)`;
  ctx.textAlign = 'left';   ctx.fillText('0',    sbX - 2,          sbY - 6);
  ctx.textAlign = 'center'; ctx.fillText('500m', sbX + sbLen*0.5,  sbY - 6);
  ctx.textAlign = 'right';  ctx.fillText('1km',  sbX + sbLen + 2,  sbY - 6);

  ctx.restore();

  // Coord display
  if (coordDisplay) {
    const lat = (45 - pointer.y * 90).toFixed(4);
    const lon = (pointer.x * 180 - 90).toFixed(4);
    coordDisplay.textContent = `${lat >= 0 ? ' ' : ''}${lat}° N\n${lon >= 0 ? ' ' : ''}${lon}° E`;
  }
}

// ─── Map cards ────────────────────────────────────────────────────────────────
function buildMapCards() {
  const cards = [];

  // 1. Palette — map theme colour swatches
  cards.push(buildCard(0, "palette", "palette", 134, 50, (cx, w, h) => {
    if (!mapData) return;
    const th   = MAP_THEMES[mapData.themeIdx];
    const cols = [th.land, th.water, `rgb(${th.cRgb})`, th.roadA, `rgb(${th.uRgb})`];
    const lbs  = ["land","sea","topo","road","urb"];
    const sw   = Math.floor((w - 6) / 5);
    cx.clearRect(0, 0, w, h);
    cols.forEach((c, i) => {
      cx.fillStyle = c;
      cx.fillRect(3 + i * sw + 1, 3, sw - 2, h - 14);
      cx.fillStyle = "rgba(31,45,56,0.36)";
      cx.font = "6.5px 'Courier New',monospace";
      cx.textAlign = "center";
      cx.fillText(lbs[i], 3 + i * sw + 1 + (sw - 2) / 2, h - 3);
    });
  }));

  // 2. Terrain — mini map thumbnail
  cards.push(buildCard(0, "terrain", "terrain", 134, 74, (cx, w, h) => {
    if (!mapData) return;
    const th = MAP_THEMES[mapData.themeIdx];
    const m  = mapData;
    cx.clearRect(0, 0, w, h);
    cx.fillStyle = th.land; cx.fillRect(0, 0, w, h);
    // water
    cx.fillStyle = th.water;
    cx.beginPath();
    cx.moveTo(0, m.coastLeftY * h);
    cx.bezierCurveTo(m.cCP1x * w, m.cCP1y * h, m.cCP2x * w, m.cCP2y * h, m.coastBtmX * w, h + 2);
    cx.lineTo(0, h + 2); cx.closePath(); cx.fill();
    // contour rings (simplified)
    cx.strokeStyle = `rgb(${th.cRgb})`; cx.lineWidth = 0.8;
    for (let i = 3; i >= 0; i--) {
      const f = (i + 1) / 4;
      cx.globalAlpha = 0.28 + (3 - i) * 0.18;
      cx.beginPath();
      cx.ellipse(m.hillX * w, m.hillY * h, m.hillRX * w * f, m.hillRY * h * f, m.hillAngle, 0, Math.PI * 2);
      cx.stroke();
    }
    cx.globalAlpha = 1;
    // urban patch
    cx.fillStyle = `rgba(${th.uRgb},0.48)`;
    cx.fillRect(m.urbanX * w - 5, m.urbanY * h - 4, 11, 8);
    // river
    cx.strokeStyle = th.water; cx.lineWidth = 1.2; cx.lineCap = "round";
    cx.beginPath();
    cx.moveTo(m.rivSX * w, m.rivSY * h);
    cx.quadraticCurveTo(m.rivCPX * w, m.rivCPY * h, m.rivEX * w, m.rivEY * h);
    cx.stroke();
  }));

  // 3. Variables — contours, roads, theme as bars
  cards.push(buildCard(0, "variables", "variables", 134, 56, (cx, w, h) => {
    if (!mapData) return;
    cx.clearRect(0, 0, w, h);
    const rows = [
      { label: "contours", v: mapData.contourRings, max: 24 },
      { label: "roads   ", v: mapData.roads.length, max: 5  },
      { label: "theme   ", v: mapData.themeIdx + 1, max: 4  },
    ];
    cx.font = "7.5px 'Courier New',monospace";
    rows.forEach(({ label, v, max }, i) => {
      const y = 14 + i * 15;
      cx.fillStyle = "rgba(31,45,56,0.42)"; cx.textAlign = "left";
      cx.fillText(label, 0, y);
      const bx = 62, bw = w - bx - 2, bh = 6;
      cx.fillStyle = "rgba(239,138,74,0.14)"; cx.fillRect(bx, y - bh, bw, bh);
      cx.fillStyle = "rgba(239,138,74,0.70)"; cx.fillRect(bx, y - bh, bw * Math.min(1, v / max), bh);
    });
  }));

  cardsByPage[0] = cards;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 1 — Panorama (Geometric Forms)
// ─────────────────────────────────────────────────────────────────────────────

const PALETTES = [
  { hues: [200, 240, 275], sat: 72, lit: 66, bg0: "#060c18", bg1: "#0c1524" },
  { hues: [158, 195, 172], sat: 65, lit: 62, bg0: "#050e12", bg1: "#081718" },
  { hues: [28,  58, 345],  sat: 74, lit: 68, bg0: "#0e0908", bg1: "#180c0a" },
  { hues: [278, 312, 188], sat: 68, lit: 64, bg0: "#090812", bg1: "#10091c" },
];

class FormShape {
  constructor(homeX, homeY, sides, baseSize, hue, sat, lit, alpha, rng) {
    this.homeX    = homeX;
    this.homeY    = homeY;
    this.x        = homeX + (rng() - 0.5) * 0.5;
    this.y        = homeY + (rng() - 0.5) * 0.5;
    this.sides    = sides;
    this.baseSize = baseSize;
    this.size     = baseSize;
    this.hue      = hue;
    this.sat      = sat;
    this.lit      = lit;
    this.alpha    = alpha;
    this.rotation = rng() * Math.PI * 2;
    this.rotSpeed = (rng() - 0.5) * 0.007;
    this.velX     = 0;
    this.velY     = 0;
    this.phase    = rng() * Math.PI * 2;
    this.verts    = [];
  }

  update(mX, mY, t) {
    // Spring back to home
    this.velX += (this.homeX - this.x) * 0.046;
    this.velY += (this.homeY - this.y) * 0.046;

    // Mouse repulsion in normalised space
    const mdx  = mX - this.x;
    const mdy  = mY - this.y;
    const md   = Math.sqrt(mdx * mdx + mdy * mdy);
    if (md < 0.32 && md > 0.001) {
      const force = Math.pow((0.32 - md) / 0.32, 1.6) * 0.020;
      this.velX -= (mdx / md) * force;
      this.velY -= (mdy / md) * force;
    }

    // Global swirl from mouse X
    this.velX += (smooth.x - 0.5) * 0.0004;
    this.velY += (smooth.y - 0.5) * 0.0002;

    this.velX *= 0.80;
    this.velY *= 0.80;
    this.x    += this.velX;
    this.y    += this.velY;

    this.rotation += this.rotSpeed + (smooth.x - 0.5) * 0.005;
    this.size = this.baseSize * (1 + Math.sin(t * 0.001 + this.phase) * 0.10);

    // Compute screen-space vertices with per-vertex mouse deformation
    const sx   = this.x * W;
    const sy   = this.y * H;
    const cos  = Math.cos(this.rotation);
    const sin  = Math.sin(this.rotation);
    const unit = Math.min(W, H);

    this.verts = [];
    for (let i = 0; i < this.sides; i++) {
      const angle = (i / this.sides) * Math.PI * 2 - Math.PI / 2;
      const bx    = Math.cos(angle);
      const by    = Math.sin(angle);
      const rx    = (bx * cos - by * sin) * this.size * unit;
      const ry    = (bx * sin + by * cos) * this.size * unit;
      let   vx    = sx + rx;
      let   vy    = sy + ry;

      // Per-vertex pull toward mouse cursor
      const dvx   = mX * W - vx;
      const dvy   = mY * H - vy;
      const vd    = Math.sqrt(dvx * dvx + dvy * dvy);
      const range = 0.24 * unit;
      if (vd < range) {
        const vf = Math.pow((range - vd) / range, 2) * 0.14;
        vx += dvx * vf;
        vy += dvy * vf;
      }

      this.verts.push({ x: vx, y: vy });
    }
  }

  draw() {
    if (this.verts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(this.verts[0].x, this.verts[0].y);
    for (let i = 1; i < this.verts.length; i++) ctx.lineTo(this.verts[i].x, this.verts[i].y);
    ctx.closePath();

    ctx.fillStyle   = `hsla(${this.hue},${this.sat}%,${this.lit}%,${this.alpha * 0.28})`;
    ctx.strokeStyle = `hsla(${this.hue},${this.sat}%,${this.lit + 14}%,${this.alpha})`;
    ctx.lineWidth   = 1.4;
    ctx.fill();
    ctx.stroke();
  }
}

function initForms() {
  const rng = makeRng(seeds[1]);

  formPalIdx  = Math.floor(rng() * PALETTES.length);
  const pal   = PALETTES[formPalIdx];
  const count = Math.floor(20 + rng() * 22);  // 20–42
  const arr   = rng(); // 0=grid, <0.35=grid, <0.68=constellation, else scatter

  const sidePool = [3, 3, 4, 4, 4, 5, 6, 6, 8]; // weighted distribution

  formShapes = [];

  for (let i = 0; i < count; i++) {
    let hx, hy;

    if (arr < 0.35) {
      // Regular grid with jitter
      const cols = Math.ceil(Math.sqrt(count * (W || 1) / (H || 1)));
      const rows = Math.ceil(count / cols);
      hx = 0.10 + (i % cols) / cols * 0.80 + (rng() - 0.5) * 0.06;
      hy = 0.10 + Math.floor(i / cols) / rows * 0.80 + (rng() - 0.5) * 0.06;
    } else if (arr < 0.68) {
      // Constellation: grouped around 5 attractors
      const ax = [0.25, 0.75, 0.50, 0.20, 0.80];
      const ay = [0.30, 0.30, 0.65, 0.72, 0.72];
      const ai = i % 5;
      hx = ax[ai] + (rng() - 0.5) * 0.40;
      hy = ay[ai] + (rng() - 0.5) * 0.40;
    } else {
      // Organic scatter
      hx = 0.06 + rng() * 0.88;
      hy = 0.06 + rng() * 0.88;
    }

    hx = Math.max(0.04, Math.min(0.96, hx));
    hy = Math.max(0.04, Math.min(0.96, hy));

    const sides    = sidePool[Math.floor(rng() * sidePool.length)];
    const baseSize = 0.024 + rng() * 0.068;
    const hue      = pal.hues[i % pal.hues.length] + (rng() - 0.5) * 38;
    const alpha    = 0.42 + rng() * 0.52;

    formShapes.push(new FormShape(hx, hy, sides, baseSize, hue, pal.sat, pal.lit, alpha, rng));
  }
}

function drawForms(t) {
  const pal = PALETTES[formPalIdx];
  const mX  = smooth.x;
  const mY  = smooth.y;

  // Dark background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, pal.bg0);
  bg.addColorStop(1, pal.bg1);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Ambient mouse glow
  const glow = ctx.createRadialGradient(mX * W, mY * H, 0, mX * W, mY * H, W * 0.38);
  glow.addColorStop(0, `hsla(${pal.hues[0]}, 55%, 52%, 0.07)`);
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Update all shapes
  for (const sh of formShapes) sh.update(mX, mY, t);

  // Connection lines between nearby shapes
  const thresh = Math.min(W, H) * 0.30;
  ctx.lineCap = "round";

  for (let i = 0; i < formShapes.length; i++) {
    for (let j = i + 1; j < formShapes.length; j++) {
      const a   = formShapes[i];
      const b   = formShapes[j];
      const dx  = (a.x - b.x) * W;
      const dy  = (a.y - b.y) * H;
      const d   = Math.sqrt(dx * dx + dy * dy);
      if (d < thresh) {
        const f = 1 - d / thresh;
        ctx.strokeStyle = `hsla(${(a.hue + b.hue) * 0.5}, 62%, 66%, ${f * f * 0.32})`;
        ctx.lineWidth   = f * 1.5;
        ctx.beginPath();
        ctx.moveTo(a.x * W, a.y * H);
        ctx.lineTo(b.x * W, b.y * H);
        ctx.stroke();
      }
    }
  }

  // Draw shapes
  for (const sh of formShapes) sh.draw();

  // Coord display – show normalised x/y
  if (coordDisplay) {
    coordDisplay.textContent = `x  ${(mX * 100).toFixed(1)}\ny  ${(mY * 100).toFixed(1)}`;
  }
}

// ─── Forms cards ──────────────────────────────────────────────────────────────
function buildFormsCards() {
  const cards = [];

  // 1. Palette — hue swatches + background sample
  cards.push(buildCard(1, "palette", "palette", 134, 38, (cx, w, h) => {
    const pal = PALETTES[formPalIdx];
    cx.clearRect(0, 0, w, h);
    const n  = pal.hues.length + 1;
    const sw = Math.floor((w - 4) / n);
    cx.fillStyle = pal.bg0; cx.fillRect(2, 2, sw - 1, h - 4);
    pal.hues.forEach((hue, i) => {
      cx.fillStyle = `hsl(${hue},${pal.sat}%,${pal.lit}%)`;
      cx.fillRect(2 + (i + 1) * sw + 1, 2, sw - 2, h - 4);
    });
  }));

  // 2. Energy — live spring velocity bars
  cards.push(buildCard(1, "energy", "energy", 134, 56, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    if (!formShapes.length) return;
    const pal  = PALETTES[formPalIdx];
    const n    = Math.min(formShapes.length, Math.floor((w - 4) / 2.2));
    const bw   = (w - 4) / n;
    for (let i = 0; i < n; i++) {
      const s  = formShapes[Math.floor(i / n * formShapes.length)];
      const e  = Math.min(1, Math.sqrt(s.velX * s.velX + s.velY * s.velY) * 85);
      const bh = Math.max(1, e * (h - 6));
      cx.fillStyle = `hsla(${s.hue},${pal.sat}%,${pal.lit}%,0.84)`;
      cx.fillRect(2 + i * bw, h - 3 - bh, bw - 0.5, bh);
    }
  }, true));  // isLive

  // 3. Variables — shape count + palette index
  cards.push(buildCard(1, "variables", "variables", 134, 42, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    const rows = [
      { label: "shapes  ", v: formShapes.length, max: 42 },
      { label: "palette ", v: formPalIdx + 1,     max: 4  },
    ];
    cx.font = "7.5px 'Courier New',monospace";
    rows.forEach(({ label, v, max }, i) => {
      const y = 14 + i * 15;
      cx.fillStyle = "rgba(31,45,56,0.42)"; cx.textAlign = "left";
      cx.fillText(label, 0, y);
      const bx = 62, bw = w - bx - 2, bh = 6;
      cx.fillStyle = "rgba(239,138,74,0.14)"; cx.fillRect(bx, y - bh, bw, bh);
      cx.fillStyle = "rgba(239,138,74,0.70)"; cx.fillRect(bx, y - bh, bw * Math.min(1, v / max), bh);
    });
  }));

  cardsByPage[1] = cards;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 2 — Flux (Particle burst from sphere)
// ─────────────────────────────────────────────────────────────────────────────

function initFlux() {
  const rng = makeRng(seeds[2]);

  // Colour palette — pink/coral hue base, teal sphere
  const hueBase   = 338 + rng() * 28;          // 338–366 (pink/coral/rose)
  const sphereHue = 188 + rng() * 20;           // 188–208 (teal/cyan)
  const sphereR   = Math.min(W, H) * (0.44 + rng() * 0.14);

  // Particles — spawn on the sphere's upper arc, radiate outward
  const count = Math.floor(48 + rng() * 36);    // 48–84
  fluxParticles = [];
  for (let i = 0; i < count; i++) {
    fluxParticles.push({
      spawnAngle: (rng() - 0.5) * Math.PI * 1.25, // −112° to +112° across top arc
      size:       2.5 + rng() * 19,
      speed:      0.22 + rng() * 1.5,
      phase:      rng() * Math.PI * 2,
      phase2:     rng() * Math.PI * 2,            // second wave for organic motion
      onStem:     rng() > 0.66,                   // ~34% on pin-stems
      stemWidth:  0.6 + rng() * 0.8,
      alpha:      0.50 + rng() * 0.46,
      hue:        hueBase + (rng() - 0.5) * 36,
      sat:        62 + rng() * 26,
      lit:        56 + rng() * 24,
    });
  }

  // Star field — seeded positions, some twinkle
  const starCount = 85 + Math.floor(rng() * 65);
  fluxStars = [];
  for (let i = 0; i < starCount; i++) {
    fluxStars.push({
      x:            rng(),
      y:            rng(),
      r:            0.3 + rng() * 1.5,
      alpha:        0.12 + rng() * 0.52,
      phase:        rng() * Math.PI * 2,
      twinkleSpeed: 0.0006 + rng() * 0.0022,
    });
  }

  // Horizontal speed lines — pink + teal, drift with mouse
  const lineCount = 9 + Math.floor(rng() * 8);
  fluxLines = [];
  for (let i = 0; i < lineCount; i++) {
    fluxLines.push({
      yPos:      0.08 + rng() * 0.76,
      rightEdge: 0.55 + rng() * 0.48,
      maxLen:    0.06 + rng() * 0.30,
      speed:     0.0004 + rng() * 0.0014,
      phase:     rng() * Math.PI * 2,
      width:     0.5 + rng() * 1.6,
      alpha:     0.12 + rng() * 0.34,
      pink:      rng() > 0.42,
    });
  }

  fluxData = { sphereR, hueBase, sphereHue };
}

function drawFlux(t) {
  if (!fluxData) return;
  const { sphereR, hueBase, sphereHue } = fluxData;
  const mx = smooth.x, my = smooth.y;

  // Sphere drifts slightly left/right with mouse X
  const sCX = W * 0.5 + (mx - 0.5) * W * 0.055;
  // Center sits below canvas so only the dome is visible
  const sCY = H * 0.36 + sphereR;

  // Mouse Y: top = maximum intensity (particles fly far), bottom = minimal
  const intensity = 0.22 + (1 - my) * 1.05;   // 0.22 → 1.27

  // Mouse X: tilts the whole explosion left or right
  const angleBias = (mx - 0.5) * 1.15;

  // ── Background ────────────────────────────────────────────────────────────
  ctx.fillStyle = '#040409';
  ctx.fillRect(0, 0, W, H);

  // ── Star field ────────────────────────────────────────────────────────────
  for (const s of fluxStars) {
    const tw = 0.48 + Math.sin(t * s.twinkleSpeed + s.phase) * 0.38;
    ctx.fillStyle = `rgba(255,255,255,${s.alpha * tw})`;
    ctx.beginPath();
    ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Speed lines (behind sphere) ───────────────────────────────────────────
  ctx.lineCap = 'round';
  for (const sl of fluxLines) {
    const pulse = 0.45 + Math.sin(t * sl.speed + sl.phase + mx * 1.8) * 0.45;
    const len   = W * sl.maxLen * pulse * (0.5 + mx * 0.9);
    const lx    = W * sl.rightEdge - len;
    const ly    = H * sl.yPos;
    const lHue  = sl.pink ? hueBase : sphereHue;
    ctx.strokeStyle = `hsla(${lHue},68%,64%,${sl.alpha * pulse})`;
    ctx.lineWidth   = sl.width;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + len, ly);
    ctx.stroke();
  }

  // ── Sphere ────────────────────────────────────────────────────────────────
  const sGrad = ctx.createRadialGradient(
    sCX - sphereR * 0.24, sCY - sphereR * 0.20, sphereR * 0.04,
    sCX, sCY, sphereR
  );
  sGrad.addColorStop(0,    `hsla(${sphereHue + 10},65%,58%,1)`);
  sGrad.addColorStop(0.55, `hsla(${sphereHue},60%,36%,1)`);
  sGrad.addColorStop(1,    `hsla(${sphereHue - 8},58%,18%,1)`);
  ctx.fillStyle = sGrad;
  ctx.beginPath();
  ctx.arc(sCX, sCY, sphereR, 0, Math.PI * 2);
  ctx.fill();

  // Subtle rim highlight
  ctx.strokeStyle = `hsla(${sphereHue + 15},70%,72%,0.16)`;
  ctx.lineWidth   = 2.2;
  ctx.beginPath();
  ctx.arc(sCX, sCY, sphereR, 0, Math.PI * 2);
  ctx.stroke();

  // ── Particles ─────────────────────────────────────────────────────────────
  ctx.lineCap = 'round';

  for (const p of fluxParticles) {
    const pT  = t * 0.001 * p.speed + p.phase;
    // Two overlapping sine waves give organic, non-repeating distance variation
    const w1  = Math.sin(pT)        * 0.5 + 0.5;   // 0–1
    const w2  = Math.sin(pT * 0.71 + p.phase2) * 0.35 + 0.35; // 0–0.7
    const distFrac = w1 * w2;                       // 0–0.7, organic rhythm

    const dist = sphereR * (0.03 + intensity * 0.95 * distFrac);

    const angle  = p.spawnAngle + angleBias;

    // Spawn point on sphere surface
    const spawnX = sCX + Math.sin(angle) * sphereR;
    const spawnY = sCY - Math.cos(angle) * sphereR;

    // Small lateral drift for organic scatter (not a perfectly straight line)
    const drift  = Math.sin(pT * 1.4 + p.phase2) * dist * 0.13;
    const px     = spawnX + Math.sin(angle) * dist + Math.cos(angle) * drift;
    const py     = spawnY - Math.cos(angle) * dist + Math.sin(angle) * drift;

    // Skip particles that are below canvas or buried inside sphere
    if (py > H + p.size || distFrac < 0.012) continue;

    // Pin stem — line from sphere surface to particle
    if (p.onStem && dist > sphereR * 0.06) {
      ctx.strokeStyle = `hsla(${p.hue},${p.sat}%,${p.lit - 14}%,${p.alpha * 0.52})`;
      ctx.lineWidth   = p.stemWidth;
      ctx.beginPath();
      ctx.moveTo(spawnX, spawnY);
      ctx.lineTo(px, py);
      ctx.stroke();
    }

    // Particle — size scales with distance and intensity
    const pSize = Math.max(0.8, p.size * (0.28 + distFrac * 0.72) * (0.48 + intensity * 0.52));
    ctx.fillStyle = `hsla(${p.hue},${p.sat}%,${p.lit}%,${p.alpha})`;
    ctx.beginPath();
    ctx.arc(px, py, pSize, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Coord display — shows force + tilt ───────────────────────────────────
  if (coordDisplay) {
    const force = Math.round((1 - my) * 100);
    const tilt  = Math.round((mx - 0.5) * 200);
    coordDisplay.textContent = `force  ${force}%\ntilt   ${tilt > 0 ? '+' : ''}${tilt}°`;
  }
}

// ─── Flux cards ───────────────────────────────────────────────────────────────
function buildFluxCards() {
  const cards = [];

  // 1. Palette — particle hue + sphere hue gradient swatch
  cards.push(buildCard(2, "palette", "palette", 134, 38, (cx, w, h) => {
    if (!fluxData) return;
    cx.clearRect(0, 0, w, h);
    const { hueBase, sphereHue } = fluxData;
    const grad = cx.createLinearGradient(2, 0, w - 2, 0);
    grad.addColorStop(0,    `hsl(${hueBase},70%,58%)`);
    grad.addColorStop(0.46, `hsl(${hueBase},70%,58%)`);
    grad.addColorStop(0.54, `hsl(${sphereHue},62%,36%)`);
    grad.addColorStop(1,    `hsl(${sphereHue},62%,36%)`);
    cx.fillStyle = grad; cx.fillRect(2, 2, w - 4, h - 4);
    // divider
    cx.fillStyle = "rgba(255,255,255,0.35)"; cx.fillRect(w / 2 - 0.5, 4, 1, h - 8);
    cx.fillStyle = "rgba(255,255,255,0.60)";
    cx.font = "6.5px 'Courier New',monospace";
    cx.textAlign = "left";  cx.fillText("burst",  4, h - 5);
    cx.textAlign = "right"; cx.fillText("sphere", w - 4, h - 5);
  }));

  // 2. Activity — live mini burst arc with intensity
  cards.push(buildCard(2, "activity", "activity", 134, 60, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    if (!fluxData) return;
    const intensity = 0.22 + (1 - smooth.y) * 1.05;
    const normI     = Math.min(1, (intensity - 0.22) / 1.05);
    const { hueBase, sphereHue } = fluxData;
    const cr = Math.min(w, h) * 0.36, cx2 = w / 2, cy2 = h * 0.74;
    // sphere arc
    cx.strokeStyle = `hsl(${sphereHue},55%,36%)`; cx.lineWidth = 2.5;
    cx.beginPath(); cx.arc(cx2, cy2, cr, Math.PI, 0); cx.stroke();
    // burst lines
    const n = 9;
    for (let i = 0; i < n; i++) {
      const ang = Math.PI * (0.12 + (i / (n - 1)) * 0.76);
      const x0  = cx2 + Math.cos(ang) * cr;
      const y0  = cy2 - Math.sin(ang) * cr;
      const len = normI * cr * 0.92;
      cx.strokeStyle = `hsla(${hueBase},68%,60%,${0.38 + normI * 0.54})`;
      cx.lineWidth   = 0.7 + normI * 1.2;
      cx.beginPath();
      cx.moveTo(x0, y0);
      cx.lineTo(x0 + Math.cos(ang) * len, y0 - Math.sin(ang) * len);
      cx.stroke();
    }
    cx.fillStyle = "rgba(31,45,56,0.36)";
    cx.font = "7px 'Courier New',monospace"; cx.textAlign = "right";
    cx.fillText(`${Math.round(normI * 100)}%`, w - 2, h - 3);
  }, true));  // isLive

  // 3. Variables — particle + star count bars
  cards.push(buildCard(2, "variables", "variables", 134, 42, (cx, w, h) => {
    if (!fluxData) return;
    cx.clearRect(0, 0, w, h);
    const { hueBase } = fluxData;
    const rows = [
      { label: "particles", v: fluxParticles.length, max: 84  },
      { label: "stars    ", v: fluxStars.length,     max: 150 },
    ];
    cx.font = "7.5px 'Courier New',monospace";
    rows.forEach(({ label, v, max }, i) => {
      const y = 14 + i * 15;
      cx.fillStyle = "rgba(31,45,56,0.42)"; cx.textAlign = "left";
      cx.fillText(label, 0, y);
      const bx = 62, bw = w - bx - 2, bh = 6;
      cx.fillStyle = `hsla(${hueBase},25%,22%,0.22)`;    cx.fillRect(bx, y - bh, bw, bh);
      cx.fillStyle = `hsla(${hueBase},68%,60%,0.74)`;    cx.fillRect(bx, y - bh, bw * Math.min(1, v / max), bh);
    });
  }));

  cardsByPage[2] = cards;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 3 — Strata (Layered mountain ridges, mouse deforms wave shapes)
// ─────────────────────────────────────────────────────────────────────────────

const STRATA_THEMES = [
  // Warm — orange / amber on cream
  { bg: '#f2e8d4', ink: '#1a2840',
    layers: ['#9a2c0e','#c44018','#d86030','#e07c38','#e89840','#f0b04c','#f4c860','#f8dc7e'],
    line: '#5c180a', bar: '#b83818' },
  // Cool — steel blue / teal on deep navy
  { bg: '#07111e', ink: '#9cd8f2',
    layers: ['#081628','#0c2844','#104060','#185a84','#2278a8','#3898c4','#5ab4d8','#7ed0ec'],
    line: '#b0e4ff', bar: '#2888b8' },
  // Sunset — warm at base, cool at peaks
  { bg: '#f0e8d8', ink: '#181e38',
    layers: ['#5c1824','#8a2828','#c44030','#d86c3c','#e49840','#b8882e','#6082a8','#88b0cc'],
    line: '#3c1014', bar: '#bc3c2c' },
  // Earthy — sienna / terracotta on parchment
  { bg: '#f4ecd6', ink: '#1c140a',
    layers: ['#561e10','#7a3218','#9c4c28','#b86432','#cc7c3c','#d89448','#e4a858','#ecbf6e'],
    line: '#381008', bar: '#883020' },
];

function initStrata() {
  const rng = makeRng(seeds[3]);

  const themeIdx   = Math.floor(rng() * STRATA_THEMES.length);
  const layerCount = Math.floor(5 + rng() * 5);    // 5–9 ridges
  const freq       = 2.2 + rng() * 3.2;            // 2.2–5.4 wave peaks across width
  const segments   = Math.floor(7 + rng() * 6);    // 7–12 bezier control points

  const stLayers = [];
  for (let i = 0; i < layerCount; i++) {
    const tt = i / Math.max(1, layerCount - 1);    // 0 = back, 1 = front
    stLayers.push({
      baseYFrac:  0.38 + tt * 0.42,               // back waves start higher
      ampFrac:    0.19 - tt * 0.11,               // back = tallest (0.19H), front = smallest
      freqMult:   0.86 + rng() * 0.30,            // per-layer frequency variation
      phaseOff:   rng() * Math.PI * 2,
      animSpeed:  0.00016 + rng() * 0.00028,      // slow autonomous drift
      parallax:   1.0 - tt * 0.74,               // back layers respond most to mouse X
    });
  }

  // Bar heights for the bottom decorative strip
  const barCount = Math.floor(12 + rng() * 10);
  const stBars   = Array.from({ length: barCount }, () => 0.15 + rng() * 0.85);

  strataData = { themeIdx, layerCount, stLayers, segments, freq, stBars };
}

function drawStrata(t) {
  if (!strataData) return;
  const { themeIdx, stLayers, segments, freq, stBars } = strataData;
  const th = STRATA_THEMES[themeIdx];
  const mx = smooth.x, my = smooth.y;

  // Mouse Y: top = tall dramatic peaks, bottom = flat calm
  const ampScale = 0.10 + (1 - my) * 1.70;

  // Mouse X: phase bias — each layer scaled by its parallax factor
  const phaseBias = (mx - 0.5) * Math.PI * 3.2;

  // Local shape deformation: Gaussian push upward centred on mouse X position
  const deformMax    = H * 0.16 * (1 - my);
  const deformSigma2 = 0.016;

  // ── Background ────────────────────────────────────────────────────────────
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);

  const step = W / segments;

  // ── Layers — back to front ────────────────────────────────────────────────
  for (let li = 0; li < stLayers.length; li++) {
    const lyr      = stLayers[li];
    const cIdx     = Math.round(li / Math.max(1, stLayers.length - 1) * (th.layers.length - 1));
    const color    = th.layers[cIdx];
    const baseY    = lyr.baseYFrac * H;
    const amp      = lyr.ampFrac * H * ampScale;
    const phase    = lyr.phaseOff + t * lyr.animSpeed + phaseBias * lyr.parallax;

    // Build wave control points
    const pts = [];
    for (let s = 0; s <= segments; s++) {
      const nx   = s / segments;
      const x    = nx * W;
      let   y    = baseY - amp * Math.sin(nx * freq * lyr.freqMult * Math.PI * 2 + phase);
      // Gaussian mouse push: pulls the wave UP at the mouse's x position
      const dx   = nx - mx;
      y -= Math.exp(-(dx * dx) / deformSigma2) * deformMax * lyr.parallax;
      pts.push({ x, y: Math.min(y, H - 2) });
    }

    // Filled area from wave down to canvas bottom
    ctx.beginPath();
    ctx.moveTo(-4, H + 4);
    ctx.lineTo(pts[0].x, pts[0].y);
    for (let s = 0; s < pts.length - 1; s++) {
      ctx.bezierCurveTo(
        pts[s].x   + step * 0.38, pts[s].y,
        pts[s+1].x - step * 0.38, pts[s+1].y,
        pts[s+1].x, pts[s+1].y
      );
    }
    ctx.lineTo(W + 4, H + 4);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    // Ridge edge — thin shadow line for depth
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let s = 0; s < pts.length - 1; s++) {
      ctx.bezierCurveTo(
        pts[s].x   + step * 0.38, pts[s].y,
        pts[s+1].x - step * 0.38, pts[s+1].y,
        pts[s+1].x, pts[s+1].y
      );
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth   = 0.8;
    ctx.stroke();
  }

  // ── Trend line — floats above the front layer ─────────────────────────────
  const fl     = stLayers[stLayers.length - 1];
  const flPh   = fl.phaseOff + t * fl.animSpeed + phaseBias * fl.parallax;
  const flAmp  = fl.ampFrac * H * ampScale * 0.65;
  const flBase = fl.baseYFrac * H - flAmp * 1.1;
  const fineN  = segments * 3;

  ctx.beginPath();
  for (let s = 0; s <= fineN; s++) {
    const nx  = s / fineN;
    const x   = nx * W;
    const dx  = nx - mx;
    const y   = flBase
      - flAmp * Math.sin(nx * freq * fl.freqMult * Math.PI * 2 + flPh)
      - Math.exp(-(dx * dx) / deformSigma2) * deformMax * fl.parallax;
    s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = th.line;
  ctx.lineWidth   = 1.8;
  ctx.lineJoin    = 'round';
  ctx.stroke();

  // Tick marks on the trend line at each control-point interval
  ctx.fillStyle = th.line;
  for (let s = 0; s <= segments; s++) {
    const nx  = s / segments;
    const x   = nx * W;
    const dx  = nx - mx;
    const y   = flBase
      - flAmp * Math.sin(nx * freq * fl.freqMult * Math.PI * 2 + flPh)
      - Math.exp(-(dx * dx) / deformSigma2) * deformMax * fl.parallax;
    ctx.beginPath();
    ctx.arc(x, y, s % 3 === 0 ? 3.2 : 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Bar strip — bottom, reacts to mouse ──────────────────────────────────
  const barH  = H * 0.058;
  const barY  = H - barH - H * 0.012;
  const barW  = (W * 0.80) / stBars.length;
  const barX0 = W * 0.10;

  stBars.forEach((val, idx) => {
    const bx        = barX0 + idx * barW;
    const bh        = barH * val * (0.28 + (1 - my) * 0.72);
    const normIdx   = idx / stBars.length;
    const proximity = Math.exp(-Math.pow((normIdx - mx) * 7, 2));

    ctx.globalAlpha = 0.50 + proximity * 0.46;
    ctx.fillStyle   = proximity > 0.15 ? th.bar : th.layers[Math.floor(th.layers.length * 0.45)];
    ctx.fillRect(bx + 1, barY + barH - bh, barW - 2, bh);
  });
  ctx.globalAlpha = 1;

  // ── Coord display ─────────────────────────────────────────────────────────
  if (coordDisplay) {
    const amp   = Math.round((1 - my) * 100);
    const shift = Math.round((mx - 0.5) * 180);
    coordDisplay.textContent = `amp    ${amp}%\nshift  ${shift >= 0 ? '+' : ''}${shift}°`;
  }
}

// ─── Strata cards ─────────────────────────────────────────────────────────────
function buildStrataCards() {
  const cards = [];

  // 1. Palette — layer colour bands
  cards.push(buildCard(3, "palette", "palette", 134, 44, (cx, w, h) => {
    if (!strataData) return;
    cx.clearRect(0, 0, w, h);
    const th = STRATA_THEMES[strataData.themeIdx];
    const n  = th.layers.length;
    const sw = (w - 4) / n;
    th.layers.forEach((c, i) => {
      cx.fillStyle = c;
      cx.fillRect(2 + i * sw, 2, sw - 0.5, h - 4);
    });
  }));

  // 2. Waves — live mini waveform of all layers
  cards.push(buildCard(3, "waves", "waves", 134, 72, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    if (!strataData) return;
    const { themeIdx, stLayers, freq } = strataData;
    const th = STRATA_THEMES[themeIdx];
    cx.fillStyle = th.bg; cx.fillRect(0, 0, w, h);
    const t2        = performance.now();
    const ampScale  = 0.10 + (1 - smooth.y) * 1.70;
    const phaseBias = (smooth.x - 0.5) * Math.PI * 3.2;
    stLayers.forEach((lyr, li) => {
      const cIdx  = Math.round(li / Math.max(1, stLayers.length - 1) * (th.layers.length - 1));
      const color = th.layers[cIdx];
      const baseY = lyr.baseYFrac * h;
      const amp   = lyr.ampFrac * h * ampScale;
      const phase = lyr.phaseOff + t2 * lyr.animSpeed + phaseBias * lyr.parallax;
      const seg   = 20;
      cx.fillStyle = color;
      cx.beginPath(); cx.moveTo(-2, h + 2);
      for (let s = 0; s <= seg; s++) {
        const nx = s / seg;
        const y  = baseY - amp * Math.sin(nx * freq * lyr.freqMult * Math.PI * 2 + phase);
        s === 0 ? cx.lineTo(nx * w, y) : cx.lineTo(nx * w, y);
      }
      cx.lineTo(w + 2, h + 2); cx.closePath(); cx.fill();
    });
  }, true));  // isLive

  // 3. Variables — layers, frequency, bar count
  cards.push(buildCard(3, "variables", "variables", 134, 56, (cx, w, h) => {
    if (!strataData) return;
    cx.clearRect(0, 0, w, h);
    const th   = STRATA_THEMES[strataData.themeIdx];
    const dark = th.bg === "#07111e";
    const barC = dark ? "rgba(90,180,216,0.72)"  : "rgba(239,138,74,0.70)";
    const bgC  = dark ? "rgba(90,180,216,0.14)"  : "rgba(239,138,74,0.14)";
    const rows = [
      { label: "layers  ", v: strataData.layerCount,             max: 9  },
      { label: "freq    ", v: (strataData.freq - 2.2) / 3.2,     max: 1  },
      { label: "bars    ", v: strataData.stBars.length / 22,     max: 1  },
    ];
    cx.font = "7.5px 'Courier New',monospace";
    rows.forEach(({ label, v, max }, i) => {
      const y = 14 + i * 15;
      cx.fillStyle = dark ? "rgba(156,216,242,0.50)" : "rgba(31,45,56,0.42)";
      cx.textAlign = "left"; cx.fillText(label, 0, y);
      const bx = 62, bw = w - bx - 2, bh = 6;
      cx.fillStyle = bgC;  cx.fillRect(bx, y - bh, bw, bh);
      cx.fillStyle = barC; cx.fillRect(bx, y - bh, bw * Math.min(1, v / max), bh);
    });
  }));

  cardsByPage[3] = cards;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 4+ — Vision  (uploaded image → dynamic canvas interpretation)
// ─────────────────────────────────────────────────────────────────────────────

const VISION_GW = 48;
const VISION_GH = 32;

// ── Colour helpers ────────────────────────────────────────────────────────────
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = t => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return [hue2rgb(h + 1/3), hue2rgb(h), hue2rgb(h - 1/3)].map(v => Math.round(v * 255));
}

// ── Image analysis ────────────────────────────────────────────────────────────
function analyzeImage(imgEl) {
  const GW = VISION_GW, GH = VISION_GH;
  const oc = document.createElement("canvas");
  oc.width = GW; oc.height = GH;
  const ox = oc.getContext("2d");
  ox.drawImage(imgEl, 0, 0, GW, GH);
  const px = ox.getImageData(0, 0, GW, GH).data;
  const n  = GW * GH;

  const brightness = new Float32Array(n);
  const rAcc = new Float32Array(5), gAcc = new Float32Array(5);
  const bAcc = new Float32Array(5), cnt  = new Float32Array(5);
  let sumB = 0, minB = 1, maxB = 0, warmScore = 0;

  for (let i = 0; i < n; i++) {
    const r = px[i*4], g = px[i*4+1], b = px[i*4+2];
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    brightness[i] = lum;
    sumB += lum;
    if (lum < minB) minB = lum;
    if (lum > maxB) maxB = lum;
    warmScore += (r - b) / 255;
    const band = Math.min(4, Math.floor(lum * 5));
    rAcc[band] += r; gAcc[band] += g; bAcc[band] += b; cnt[band]++;
  }

  const avgBright = sumB / n;
  warmScore /= n;

  // Stretch brightness to full 0–1 range
  const range = Math.max(0.01, maxB - minB);
  for (let i = 0; i < n; i++) brightness[i] = (brightness[i] - minB) / range;

  // Structure complexity: fraction of adjacent pairs with a large brightness gap
  let transitions = 0;
  for (let r = 0; r < GH; r++)
    for (let c = 0; c < GW - 1; c++)
      if (Math.abs(brightness[r*GW+c] - brightness[r*GW+c+1]) > 0.2) transitions++;
  for (let r = 0; r < GH - 1; r++)
    for (let c = 0; c < GW; c++)
      if (Math.abs(brightness[r*GW+c] - brightness[(r+1)*GW+c]) > 0.2) transitions++;
  const complexity = transitions / (GW * GH * 2);

  // Per-band palette — fill empty bands, boost saturation for screenprint clarity
  const rawRgb = Array.from({ length: 5 }, (_, b) =>
    cnt[b] > 0 ? [rAcc[b]/cnt[b], gAcc[b]/cnt[b], bAcc[b]/cnt[b]] : null
  );
  for (let b = 0; b < 5; b++) {
    if (!rawRgb[b]) {
      for (let d = 1; d < 5; d++) {
        if (b+d < 5 && rawRgb[b+d]) { rawRgb[b] = [...rawRgb[b+d]]; break; }
        if (b-d >= 0 && rawRgb[b-d]) { rawRgb[b] = [...rawRgb[b-d]]; break; }
      }
      if (!rawRgb[b]) rawRgb[b] = [128, 128, 128];
    }
  }
  const palette = rawRgb.map(([r, g, b]) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    const [nr, ng, nb] = hslToRgb(h, Math.min(1, s * 1.55 + 0.06), l);
    return `rgb(${nr},${ng},${nb})`;
  });

  // Per-row average colours
  const rowRr = new Float32Array(GH), rowGr = new Float32Array(GH), rowBr = new Float32Array(GH);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / GW);
    rowRr[row] += px[i*4]; rowGr[row] += px[i*4+1]; rowBr[row] += px[i*4+2];
  }
  const rowColors = Array.from({ length: GH }, (_, r) => {
    const [h, s, l] = rgbToHsl(rowRr[r]/GW, rowGr[r]/GW, rowBr[r]/GW);
    const [nr, ng, nb] = hslToRgb(h, Math.min(1, s * 1.6 + 0.07), l);
    return `rgb(${nr},${ng},${nb})`;
  });

  // Band-row profiles: for each of 5 brightness bands, how that tonal level
  // distributes row-by-row through the image (fraction of each row's pixels
  // that fall in this band).  X-axis = image depth (top→bottom), Y = density.
  const BANDS = 5;
  const bandRowProfiles = Array.from({ length: BANDS }, () => new Float32Array(GH));
  for (let r = 0; r < GH; r++) {
    for (let c = 0; c < GW; c++) {
      const band = Math.min(BANDS - 1, Math.floor(brightness[r * GW + c] * BANDS));
      bandRowProfiles[band][r] += 1;
    }
    for (let b = 0; b < BANDS; b++) bandRowProfiles[b][r] /= GW;
  }

  return { brightness, rowColors, bandRowProfiles, palette, avgBright, warmScore, complexity, GW, GH };
}

// ── Name generation (based on the shapes the visualization creates) ───────────
function generateVisionName(analysis, seed) {
  const { avgBright, warmScore, complexity } = analysis;
  const rng = makeRng(seed);

  const hue   = warmScore >  0.08 ? "warm" : warmScore < -0.08 ? "cool" : "neutral";
  const lum   = avgBright > 0.62  ? "bright" : avgBright < 0.40 ? "dark" : "mid";
  const struc = complexity > 0.22  ? "complex" : "simple";

  const pools = {
    "warm-dark-complex":      ["Ember Field",   "Burnt Scatter", "Fire Strata",   "Ochre Mesh"    ],
    "warm-dark-simple":       ["Amber Ridge",   "Deep Terra",    "Burnt Plain",   "Ochre Survey"  ],
    "warm-mid-complex":       ["Terra Mesh",    "Solar Scatter", "Warm Field",    "Sand Survey"   ],
    "warm-mid-simple":        ["Sand Ridge",    "Terra Plain",   "Solar Survey",  "Ochre Strata"  ],
    "warm-bright-complex":    ["Pale Scatter",  "Solar Mesh",    "Light Terra",   "Bleach Field"  ],
    "warm-bright-simple":     ["Solar Plain",   "Light Survey",  "Pale Ridge",    "Warm Chart"    ],
    "cool-dark-complex":      ["Void Mesh",     "Ink Scatter",   "Dark Field",    "Deep Survey"   ],
    "cool-dark-simple":       ["Void Ridge",    "Ink Survey",    "Deep Plain",    "Dark Chart"    ],
    "cool-mid-complex":       ["Azure Field",   "Mist Mesh",     "Grey Scatter",  "Cool Survey"   ],
    "cool-mid-simple":        ["Cool Ridge",    "Azure Survey",  "Mist Plain",    "Grey Strata"   ],
    "cool-bright-complex":    ["Silver Field",  "Pale Mesh",     "Cold Scatter",  "Light Survey"  ],
    "cool-bright-simple":     ["Cold Plain",    "Silver Ridge",  "Pale Chart",    "Ice Survey"    ],
    "neutral-dark-complex":   ["Shadow Field",  "Dark Mesh",     "Void Scatter",  "Grey Survey"   ],
    "neutral-dark-simple":    ["Deep Plain",    "Shadow Ridge",  "Dark Chart",    "Void Survey"   ],
    "neutral-mid-complex":    ["Grey Field",    "Neutral Mesh",  "Salt Scatter",  "Mid Survey"    ],
    "neutral-mid-simple":     ["Grey Ridge",    "Salt Chart",    "Mid Plain",     "Neutral Strata"],
    "neutral-bright-complex": ["Light Field",   "Pale Mesh",     "White Scatter", "Silver Survey" ],
    "neutral-bright-simple":  ["Light Plain",   "Silver Ridge",  "Pale Chart",    "White Survey"  ],
  };

  const pool = pools[`${hue}-${lum}-${struc}`] || ["Survey Field", "Plain Chart", "Ridge Survey"];
  return pool[Math.floor(rng() * pool.length)];
}

// ── Vision flow field init ────────────────────────────────────────────────────
function initVisionFlowField(vp) {
  const { complexity } = vp.analysis;
  const count = Math.floor(200 + complexity * 580);  // 200–780 particles
  vp.particles = Array.from({ length: count }, () => ({
    x:        Math.random() * W,
    y:        Math.random() * H,
    angle:    Math.random() * Math.PI * 2,
    speed:    0.20 + Math.random() * 1.5,
    size:     0.4  + Math.random() * 2.4,
    alpha:    0.08 + Math.random() * 0.38,
    colorIdx: Math.floor(Math.random() * 5),
  }));
  vp.firstFrame = true;
}

// ── Vision cards ──────────────────────────────────────────────────────────────
function buildVisionCards(p) {
  const vp = visionPages[p - 4];
  if (!vp) return;
  const { brightness, palette, avgBright, warmScore, complexity, GW, GH } = vp.analysis;
  const cards = [];

  // 1. Image palette — 5 tone bands
  cards.push(buildCard(p, "palette", "palette", 134, 52, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    const lbs = ["shadow","dark","mid","light","hi"];
    const sw  = Math.floor((w - 6) / 5);
    palette.forEach((c, i) => {
      cx.fillStyle = c;
      cx.fillRect(3 + i * sw + 1, 3, sw - 2, h - 14);
      cx.fillStyle = "rgba(31,45,56,0.32)";
      cx.font = "6.5px 'Courier New',monospace"; cx.textAlign = "center";
      cx.fillText(lbs[i], 3 + i * sw + 1 + (sw - 2) / 2, h - 3);
    });
  }));

  // 2. Luminance histogram — brightness distribution
  cards.push(buildCard(p, "luminance", "luminance", 134, 58, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    const buckets = 16, total = GW * GH;
    const hist = new Float32Array(buckets);
    for (let k = 0; k < total; k++) {
      hist[Math.min(buckets - 1, Math.floor(brightness[k] * buckets))]++;
    }
    const peak = Math.max(...hist);
    const bw   = (w - 4) / buckets;
    for (let i = 0; i < buckets; i++) {
      const t2 = i / buckets;
      const bh = ((hist[i] / peak) || 0) * (h - 6);
      cx.fillStyle = `hsl(0,0%,${Math.round(14 + t2 * 76)}%)`;
      cx.fillRect(2 + i * bw + 0.5, h - 3 - bh, bw - 1, bh);
    }
  }));

  // 3. Character — warm/cool, brightness, complexity gauges
  cards.push(buildCard(p, "character", "character", 134, 72, (cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    const [r0, g0, b0] = parseRgb(palette[0]);
    const [r4, g4, b4] = parseRgb(palette[4]);
    const gauges = [
      { label: "warm ↔ cool",    v: Math.max(0, Math.min(1, (warmScore  + 0.25) / 0.50)) },
      { label: "dark ↔ bright",  v: Math.max(0, Math.min(1, avgBright)) },
      { label: "calm ↔ complex", v: Math.max(0, Math.min(1, complexity / 0.38)) },
    ];
    cx.font = "7px 'Courier New',monospace";
    gauges.forEach(({ label, v }, i) => {
      const y = 14 + i * 20;
      cx.fillStyle = "rgba(31,45,56,0.44)"; cx.textAlign = "left";
      cx.fillText(label, 0, y);
      const bx = 0, bw = w - 2, by = y + 2, bh = 5;
      cx.fillStyle = "rgba(31,45,56,0.10)"; cx.fillRect(bx, by, bw, bh);
      const grad = cx.createLinearGradient(bx, 0, bx + bw, 0);
      grad.addColorStop(0, `rgba(${r0},${g0},${b0},0.78)`);
      grad.addColorStop(1, `rgba(${r4},${g4},${b4},0.78)`);
      cx.fillStyle = grad; cx.fillRect(bx, by, bw * v, bh);
      cx.fillStyle = "rgba(239,138,74,0.92)";
      cx.beginPath(); cx.arc(bx + bw * v, by + bh / 2, 2.8, 0, Math.PI * 2); cx.fill();
    });
  }));

  cardsByPage[p] = cards;
}

// ── Add a new vision page from an analyzed image ──────────────────────────────
function addVisionPage(analysis) {
  const seed    = Math.random();
  const name    = generateVisionName(analysis, seed);
  const pageIdx = 4 + visionPages.length;
  visionPages.push({ seed, name, analysis, particles: null, firstFrame: true });

  // Insert at top of vision list (most recent first, directly under upload zone)
  const visionList = document.getElementById("nav-vision-list");
  const li         = document.createElement("li");
  li.className     = "nav-item";
  li.innerHTML     = `
    <button class="nav-link" data-page="${pageIdx}" aria-current="false">${name}</button>
    <button class="refresh-btn" data-page="${pageIdx}" aria-label="Refresh ${name}">↻</button>`;
  visionList.prepend(li);

  buildVisionCards(pageIdx);
  navigateTo(pageIdx);
}

// ── Draw Vision — particle flow field driven by image analysis ─────────────────
function drawVision(t) {
  const vp = visionPages[currentPage - 4];
  if (!vp) return;
  if (!vp.particles) initVisionFlowField(vp);

  const { analysis } = vp;
  const { brightness, palette, complexity, GW, GH } = analysis;
  const mx = smooth.x, my = smooth.y;

  // Background — dark version of image's darkest palette band
  const [br, bg, bb] = parseRgb(palette[0]);
  const [bh, bs, bl] = rgbToHsl(br, bg, bb);
  const [dbR, dbG, dbB] = hslToRgb(bh, Math.min(1, bs * 0.65), Math.max(0.03, bl * 0.22));

  if (vp.firstFrame) {
    ctx.fillStyle = `rgb(${dbR},${dbG},${dbB})`;
    ctx.fillRect(0, 0, W, H);
    vp.firstFrame = false;
  } else {
    // Slow fade — builds up long particle trails
    ctx.fillStyle = `rgba(${dbR},${dbG},${dbB},0.052)`;
    ctx.fillRect(0, 0, W, H);
  }

  // Flow field turbulence driven by image complexity
  const turb     = 1.5 + complexity * 4.8;
  const spdScale = 0.45 + my * 1.35;   // mouse Y controls particle speed

  for (const p of vp.particles) {
    const nx = p.x / W;
    const ny = p.y / H;

    // Sample image brightness at particle position to warp the flow field
    const gx    = Math.min(GW - 1, Math.floor(nx * GW));
    const gy    = Math.min(GH - 1, Math.floor(ny * GH));
    const bright = brightness[gy * GW + gx] || 0.5;

    // Trig flow field + brightness warp
    const targetA =
        Math.sin(nx * 4.1 + t * 0.00024 * turb) * turb
      + Math.cos(ny * 3.2 + t * 0.00018 * turb) * turb
      + Math.sin((nx * 2.3 + ny * 1.9) + t * 0.00013) * turb * 0.55
      + bright * Math.PI * 1.5;

    // Smooth angle update
    p.angle += (targetA - p.angle) * 0.042;

    // Mouse attraction — particles near cursor drift toward it
    const mdx = mx - nx, mdy = (my - ny) * (H / W);
    const md  = Math.sqrt(mdx * mdx + mdy * mdy);
    if (md < 0.26 && md > 0.002) {
      p.angle += Math.atan2(mdy, mdx) * (1 - md / 0.26) * 0.20;
    }

    p.x += Math.cos(p.angle) * p.speed * spdScale;
    p.y += Math.sin(p.angle) * p.speed * spdScale;

    // Wrap edges seamlessly
    if (p.x < -4) p.x = W + 4;
    if (p.x > W + 4) p.x = -4;
    if (p.y < -4) p.y = H + 4;
    if (p.y > H + 4) p.y = -4;

    // Draw particle using image's own palette
    const [pr, pg, pb] = parseRgb(palette[p.colorIdx]);
    ctx.fillStyle = `rgba(${pr},${pg},${pb},${p.alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  if (coordDisplay) {
    coordDisplay.textContent = `turbulence  ${Math.round(complexity * 100)}%\nflow      ${Math.round(my * 100)}%`;
  }
}

// ── Vision upload handler ─────────────────────────────────────────────────────
(function setupVisionUpload() {
  const input     = document.getElementById("vision-input");
  const miniLabel = document.getElementById("upload-mini");
  const miniText  = document.getElementById("upload-mini-text");
  if (!input) return;

  function loadImage(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        addVisionPage(analyzeImage(img));
        if (miniLabel) miniLabel.classList.add("has-image");
        if (miniText)  miniText.textContent = "add another";
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    input.value = ""; // reset so same file can be re-uploaded
  }

  input.addEventListener("change", () => loadImage(input.files[0]));
})();

// ─────────────────────────────────────────────────────────────────────────────
// Animation loop
// ─────────────────────────────────────────────────────────────────────────────
function tick(t) {
  // Slower lerp = more inertia, makes parallax feel physical
  smooth.x += (pointer.x - smooth.x) * 0.038;
  smooth.y += (pointer.y - smooth.y) * 0.038;

  if      (currentPage === 0) drawMap(t);
  else if (currentPage === 1) drawForms(t);
  else if (currentPage === 2) drawFlux(t);
  else if (currentPage === 3) drawStrata(t);
  else if (currentPage >= 4)  drawVision(t);

  drawLiveCards();

  requestAnimationFrame(tick);
}

// Fallback loop via setInterval so the canvas draws even when
// requestAnimationFrame is throttled (e.g. hidden tabs, preview tools)
function startLoop() {
  let rafAlive = false;
  requestAnimationFrame(t => { rafAlive = true; tick(t); });
  setTimeout(() => {
    if (!rafAlive) {
      // rAF didn't fire — use setInterval at ~30fps instead
      setInterval(() => tick(performance.now()), 33);
    }
  }, 200);
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

function spinBtn(p) {
  const btn = document.querySelector(`.refresh-btn[data-page="${p}"]`);
  if (!btn) return;
  btn.classList.remove("spinning");
  void btn.offsetWidth; // force reflow to restart animation
  btn.classList.add("spinning");
  btn.addEventListener("animationend", () => btn.classList.remove("spinning"), { once: true });
}

function refreshPage(p) {
  if (p < 4) {
    seeds[p] = Math.random();
    if      (p === 0) initMap();
    else if (p === 1) initForms();
    else if (p === 2) initFlux();
    else              initStrata();
    // Redraw static card content with new data
    const cards = cardsByPage[p];
    if (cards) cards.forEach(c => { if (!c.isLive) c.drawFn(c.cx, c.w, c.h); });
  } else {
    const vp = visionPages[p - 4];
    if (!vp) return;
    vp.seed = Math.random();
    vp.name = generateVisionName(vp.analysis, vp.seed);
    // Reset particle field for a fresh start
    initVisionFlowField(vp);
    const btn = document.querySelector(`.nav-link[data-page="${p}"]`);
    if (btn) btn.textContent = vp.name;
  }
  spinBtn(p);
}

function navigateTo(p) {
  if (p === currentPage) return;
  currentPage = p;
  document.querySelectorAll(".nav-link").forEach(btn => {
    const active = parseInt(btn.dataset.page) === p;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-current", active ? "page" : "false");
  });
  // Vision pages: reset trail so fresh particles on arrival
  if (p >= 4) {
    const vp = visionPages[p - 4];
    if (vp) vp.firstFrame = true;
  }
  // Cards
  ensureCards(p);
  showCardsForPage(p);
}

// Event delegation on the whole nav — covers both static and dynamic vision items
sideNav.addEventListener("click", e => {
  const navBtn = e.target.closest(".nav-link");
  const refBtn = e.target.closest(".refresh-btn");
  if (navBtn) {
    const p = parseInt(navBtn.dataset.page);
    if (p === currentPage) refreshPage(p);
    else navigateTo(p);
  } else if (refBtn) {
    const p = parseInt(refBtn.dataset.page);
    navigateTo(p);
    refreshPage(p);
  }
});

// Hamburger / mobile nav
function closeNav() {
  sideNav.classList.remove("is-open");
  backdrop.classList.remove("is-visible");
  hamburgerBtn.setAttribute("aria-expanded", "false");
}

hamburgerBtn.addEventListener("click", () => {
  const open = sideNav.classList.toggle("is-open");
  backdrop.classList.toggle("is-visible", open);
  hamburgerBtn.setAttribute("aria-expanded", String(open));
});

backdrop.addEventListener("click", closeNav);

// ─────────────────────────────────────────────────────────────────────────────
// Rename nav labels to match page names
// ─────────────────────────────────────────────────────────────────────────────
(function labelNav() {
  const links = document.querySelectorAll(".nav-link");
  if (links[0]) links[0].textContent = "Stochasticity";
  if (links[1]) links[1].textContent = "Panorama";
  if (links[2]) links[2].textContent = "Flux";
  if (links[3]) links[3].textContent = "Strata";
})();

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
resize();           // sets W/H, calls initMap() + initForms() + initFlux() + initStrata()
ensureCards(0);     // build cards for the initial page
showCardsForPage(0);
startLoop();
