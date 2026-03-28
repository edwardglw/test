const canvas = document.getElementById("map-canvas");
const screen = document.querySelector(".screen");
const districtButton = document.getElementById("randomize-link");
const panoramaButton = document.getElementById("panorama-link");

if (!canvas || !screen || !districtButton || !panoramaButton) {
  throw new Error("Required page elements were not found. Check index.html structure.");
}

const ctx = canvas.getContext("2d");

let width = 0;
let height = 0;
const pointer = { x: 0.5, y: 0.5 };
const smooth = { x: 0.5, y: 0.5 };

const districtPalettes = [
  ["#f7ecd9", "#f2e3c9", "#147f7d"],
  ["#faefdc", "#d6e9d9", "#2e7f82"],
  ["#f4ead4", "#e8e6d8", "#1b6d74"],
  ["#f7e7d5", "#ebdccf", "#2c6f6e"]
];

const panoramaPalettes = [
  ["#7fcac4", "#5fa8a5", "#ef8f94", "#56365d"],
  ["#87d2cb", "#69b9b8", "#f49b9f", "#663f65"],
  ["#8dd8d0", "#66b2a9", "#ed8998", "#4c3558"]
];

const state = {
  mode: "district",
  params: {
    smoothness: 0.1,
    motionScale: 2.7,
    contourBoost: 22,
    riverBoost: 24,
    roadBend: 30,
    dataShift: 28,
    symbolDrift: 1.3,
    paletteIndex: 0,
    horizonDrift: 1,
    waveDensity: 1,
    uiNoise: 1
  },
  districtSeed: {
    jitterA: Math.random() * 10,
    jitterB: Math.random() * 10
  },
  panoramaSeed: {
    phase: Math.random() * 100,
    largeNumber: "01.023"
  }
};

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function updateActiveNav() {
  districtButton.classList.toggle("is-active", state.mode === "district");
  panoramaButton.classList.toggle("is-active", state.mode === "panorama");
}

function randomizeDistrict() {
  state.mode = "district";
  state.params.paletteIndex = Math.floor(Math.random() * districtPalettes.length);
  state.params.smoothness = randomBetween(0.07, 0.14);
  state.params.motionScale = randomBetween(2.1, 3.7);
  state.params.contourBoost = randomBetween(16, 30);
  state.params.riverBoost = randomBetween(16, 34);
  state.params.roadBend = randomBetween(20, 50);
  state.params.dataShift = randomBetween(18, 46);
  state.params.symbolDrift = randomBetween(1.0, 2.1);
  state.params.waveDensity = randomBetween(0.9, 1.4);
  state.params.uiNoise = randomBetween(0.8, 1.4);
  state.districtSeed.jitterA = Math.random() * 12;
  state.districtSeed.jitterB = Math.random() * 12;
  updateActiveNav();
}

function randomizePanorama() {
  state.mode = "panorama";
  state.params.paletteIndex = Math.floor(Math.random() * panoramaPalettes.length);
  state.params.smoothness = randomBetween(0.05, 0.1);
  state.params.motionScale = randomBetween(1.5, 2.6);
  state.params.horizonDrift = randomBetween(0.8, 1.9);
  state.params.dataShift = randomBetween(14, 30);
  state.params.waveDensity = randomBetween(0.8, 1.6);
  state.params.uiNoise = randomBetween(0.6, 1.2);

  const a = String(Math.floor(randomBetween(1, 10))).padStart(2, "0");
  const b = String(Math.floor(randomBetween(0, 999))).padStart(3, "0");
  state.panoramaSeed.largeNumber = `${a}.${b}`;
  state.panoramaSeed.phase = Math.random() * 200;
  updateActiveNav();
}

function resizeCanvas() {
  const bounds = screen.getBoundingClientRect();
  width = Math.floor(bounds.width);
  height = Math.floor(bounds.height);

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawDistrictBackdrop() {
  const [top, middle, bottom] = districtPalettes[state.params.paletteIndex];
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, top);
  bg.addColorStop(0.42, middle);
  bg.addColorStop(1, bottom);

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(14, 120, 117, 0.84)";
  ctx.fillRect(width * 0.44, 0, width * 0.56, height * 0.52);
  ctx.fillStyle = "rgba(239, 138, 74, 0.62)";
  ctx.fillRect(0, height * 0.83, width * 0.48, height * 0.2);
}

function drawDistrictScene(time, offsetX, offsetY, intensity) {
  const density = state.params.waveDensity;

  for (let i = 0; i < 58; i += 1) {
    const yBase = height * (0.08 + (i / 57) * 0.8);
    const wave = Math.sin(time * 0.00075 * density + i * 0.43 + state.districtSeed.jitterA) *
      (11 + intensity * state.params.contourBoost);

    ctx.strokeStyle = i % 2 === 0 ? "rgba(132, 233, 229, 0.35)" : "rgba(240, 181, 145, 0.24)";
    ctx.lineWidth = i % 7 === 0 ? 1.5 : 0.95;
    ctx.beginPath();
    ctx.moveTo(width * 0.04 + offsetX * 16, yBase + wave + offsetY * 16);
    ctx.bezierCurveTo(
      width * 0.26 + offsetX * 22,
      yBase - 16 + Math.sin(i * 0.2 + time * 0.001) * (10 + intensity * 6),
      width * 0.64 + offsetX * 16,
      yBase + 18 + Math.cos(i * 0.18 + time * 0.0012) * (10 + intensity * 5),
      width * 0.96 + offsetX * 20,
      yBase - 8 + wave
    );
    ctx.stroke();
  }

  for (let i = 0; i < 6; i += 1) {
    const yStart = height * (0.24 + i * 0.09);
    const sway = Math.sin(time * 0.0009 * density + i * 1.8 + state.districtSeed.jitterB) *
      (9 + intensity * state.params.riverBoost);

    ctx.strokeStyle = i % 2 === 0 ? "rgba(137, 222, 228, 0.44)" : "rgba(67, 171, 180, 0.32)";
    ctx.lineWidth = 2.2 - i * 0.22;
    ctx.beginPath();
    ctx.moveTo(width * 0.36 + offsetX * 20, yStart + sway + offsetY * 18 + i * 7);
    ctx.bezierCurveTo(
      width * 0.5 + offsetX * 42,
      yStart - 24 + Math.cos(time * 0.001 + i) * 16,
      width * 0.74 + offsetX * 26,
      yStart + 30 + Math.sin(time * 0.0013 + i) * 14,
      width * 0.96 + offsetX * 16,
      yStart + 8 + sway * 0.4
    );
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(width * 0.17 + offsetX * 48, height * 0.66 + offsetY * 28);
  ctx.rotate(-0.19 + offsetX * 0.1);
  ctx.strokeStyle = "rgba(20, 122, 127, 0.55)";
  for (let y = 0; y < 170; y += 12) {
    for (let x = 0; x < 420; x += 18) {
      const wave = Math.sin((x + y) * 0.05 + state.districtSeed.jitterA) * (1.6 + intensity * 3);
      const pull = (offsetX * x + offsetY * y) * 0.012;
      const skew = Math.sin((x * 0.02 + y * 0.03) + state.districtSeed.jitterB) * 2.6 * state.params.uiNoise;
      ctx.lineWidth = 0.8 + ((x + y) % 4) * 0.12;
      ctx.strokeRect(x + wave + pull + skew, y - wave * 0.7, 14 + skew * 0.2, 8.7);
    }
  }
  ctx.restore();

  const bend = state.params.roadBend * offsetY;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(10, 99, 106, 0.85)";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(width * 0.12 + offsetX * 34, height * 0.74 + offsetY * 12);
  ctx.bezierCurveTo(
    width * 0.35 + offsetX * 24,
    height * (0.66 - intensity * 0.04) + bend,
    width * 0.58 + offsetX * 28,
    height * (0.58 + intensity * 0.04) - bend * 0.4,
    width * 0.82 + offsetX * 42,
    height * 0.5 + offsetY * 8
  );
  ctx.stroke();

  ctx.strokeStyle = "rgba(241, 228, 201, 0.32)";
  ctx.setLineDash([10, 10]);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(width * 0.12 + offsetX * 30, height * 0.74 + offsetY * 12);
  ctx.bezierCurveTo(
    width * 0.35 + offsetX * 24,
    height * (0.66 - intensity * 0.04) + bend,
    width * 0.58 + offsetX * 28,
    height * (0.58 + intensity * 0.04) - bend * 0.4,
    width * 0.82 + offsetX * 42,
    height * 0.5 + offsetY * 8
  );
  ctx.stroke();
  ctx.setLineDash([]);

  drawDataOverlay(time, offsetX, offsetY, intensity, 0.5, 0.57, 0.42, 0.27);
}

function drawPanoramaBackdrop() {
  ctx.fillStyle = "#18212b";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillRect(width * 0.1, height * 0.1, width * 0.88, height * 0.82);
  ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
  ctx.fillRect(width * 0.35, height * 0.08, width * 0.26, height * 0.86);

  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(width * 0.04, height * 0.23);
  ctx.quadraticCurveTo(width * 0.45, height * 0.1, width * 0.98, height * 0.03);
  ctx.stroke();
}

function drawPanoramaScene(time, offsetX, offsetY, intensity) {
  const palette = panoramaPalettes[state.params.paletteIndex];
  const baseY = height * 0.64;

  for (let layer = 0; layer < 5; layer += 1) {
    const depth = layer / 4;
    const color = palette[layer % palette.length];
    const alpha = 0.16 + depth * 0.14;
    const drift = (layer + 1) * (8 + state.params.horizonDrift * 6);

    ctx.fillStyle = color.replace(')', '');
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, baseY + layer * 26);

    for (let x = 0; x <= width; x += 22) {
      const wave = Math.sin(x * 0.008 * state.params.waveDensity + time * 0.0007 + layer * 0.9 + state.panoramaSeed.phase) * drift;
      const mouseLift = offsetY * 30 * (1 - depth);
      const ridge = baseY + layer * 22 + wave + mouseLift + Math.cos(time * 0.0004 + x * 0.003) * 5;
      ctx.lineTo(x + offsetX * 16 * (1 + depth), ridge);
    }

    ctx.lineTo(width, height);
    ctx.closePath();

    ctx.fillStyle = `rgba(${layer === 0 ? '111,230,213' : layer === 1 ? '166,239,225' : layer === 2 ? '244,220,193' : layer === 3 ? '242,145,152' : '100,63,103'}, ${alpha})`;
    ctx.fill();
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.font = `700 ${Math.max(38, width * 0.09)}px 'Segoe UI', sans-serif`;
  ctx.fillText(state.panoramaSeed.largeNumber, width * 0.08 + offsetX * 12, height * 0.28 + offsetY * 12);

  drawDataOverlay(time, offsetX, offsetY, intensity, 0.52, 0.18, 0.4, 0.58);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = height * (0.2 + i * 0.14) + offsetY * (i + 1) * 2;
    ctx.beginPath();
    ctx.moveTo(width * 0.78 + offsetX * 8, y);
    ctx.lineTo(width * 0.95 + offsetX * 14, y - 6);
    ctx.stroke();
  }
}

function drawDataOverlay(time, offsetX, offsetY, intensity, sx, sy, sw, sh) {
  const columns = 10;
  const rows = 5;
  const areaX = width * sx + offsetX * 20;
  const areaY = height * sy + offsetY * 14;
  const areaW = width * sw;
  const areaH = height * sh;

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const x = areaX + (c / (columns - 1)) * areaW;
      const y = areaY + (r / (rows - 1)) * areaH;
      const pulse = 0.4 + 0.6 * (0.5 + Math.sin(time * 0.0025 + c * 0.7 + r * 0.4) * 0.5);
      const size = 2 + pulse * 2 + intensity * 2;

      ctx.fillStyle = `rgba(243, 242, 236, ${0.1 + pulse * 0.24})`;
      ctx.fillRect(x - size, y - size, size * 2, size * 2);

      if ((c + r) % 3 === 0) {
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.08 + pulse * 0.24})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + offsetX * state.params.dataShift + 14, y + offsetY * (state.params.dataShift * 0.8) + 10);
        ctx.stroke();
      }
    }
  }
}

function animate(time) {
  smooth.x += (pointer.x - smooth.x) * state.params.smoothness;
  smooth.y += (pointer.y - smooth.y) * state.params.smoothness;

  const offsetX = smooth.x - 0.5;
  const offsetY = smooth.y - 0.5;
  const intensity = Math.min(1, Math.hypot(offsetX, offsetY) * state.params.motionScale);

  if (state.mode === "panorama") {
    drawPanoramaBackdrop();
    drawPanoramaScene(time, offsetX, offsetY, intensity);
  } else {
    drawDistrictBackdrop();
    drawDistrictScene(time, offsetX, offsetY, intensity);
  }

  requestAnimationFrame(animate);
}

screen.addEventListener("pointermove", (event) => {
  const bounds = screen.getBoundingClientRect();
  pointer.x = (event.clientX - bounds.left) / bounds.width;
  pointer.y = (event.clientY - bounds.top) / bounds.height;
});

screen.addEventListener("pointerleave", () => {
  pointer.x = 0.5;
  pointer.y = 0.5;
});

districtButton.addEventListener("click", randomizeDistrict);
panoramaButton.addEventListener("click", randomizePanorama);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
randomizeDistrict();
requestAnimationFrame(animate);
