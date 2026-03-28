const canvas = document.getElementById("map-canvas");
const screen = document.querySelector(".screen");

if (!canvas || !screen) {
  throw new Error("Required page elements were not found. Check index.html structure.");
}

const ctx = canvas.getContext("2d");

let width = 0;
let height = 0;
const pointer = { x: 0.5, y: 0.5 };
const smooth = { x: 0.5, y: 0.5 };

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

function drawBackdrop() {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#f7ecd9");
  bg.addColorStop(0.42, "#f2e3c9");
  bg.addColorStop(1, "#147f7d");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(14, 120, 117, 0.84)";
  ctx.fillRect(width * 0.44, 0, width * 0.56, height * 0.52);

  ctx.fillStyle = "rgba(239, 138, 74, 0.62)";
  ctx.fillRect(0, height * 0.83, width * 0.48, height * 0.2);
}

function drawDistrictBlocks(offsetX, offsetY) {
  ctx.save();
  ctx.translate(width * 0.2 + offsetX * 18, height * 0.69 + offsetY * 10);
  ctx.rotate(-0.19);

  ctx.strokeStyle = "rgba(20, 122, 127, 0.55)";
  ctx.lineWidth = 1;
  for (let y = 0; y < 145; y += 12) {
    for (let x = 0; x < 390; x += 18) {
      const wobble = Math.sin((x + y) * 0.05) * 1.2;
      ctx.strokeRect(x + wobble, y - wobble, 15, 9);
    }
  }

  ctx.restore();
}

function drawRoadNetwork(offsetX, offsetY) {
  ctx.lineCap = "round";

  ctx.strokeStyle = "rgba(10, 99, 106, 0.8)";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(width * 0.16 + offsetX * 12, height * 0.72 + offsetY * 8);
  ctx.lineTo(width * 0.78 + offsetX * 16, height * 0.53 + offsetY * 6);
  ctx.stroke();

  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(width * 0.45 + offsetX * 8, height * 0.94 + offsetY * 4);
  ctx.quadraticCurveTo(
    width * 0.64 + offsetX * 10,
    height * 0.76 + offsetY * 8,
    width * 0.88 + offsetX * 12,
    height * 0.9 + offsetY * 6
  );
  ctx.stroke();
}

function drawContourBands(time, offsetX, offsetY) {
  const count = 64;
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const yBase = height * (0.08 + t * 0.78);
    const wave = Math.sin(time * 0.0007 + i * 0.43) * 14;

    ctx.strokeStyle = i % 2 === 0 ? "rgba(132, 233, 229, 0.35)" : "rgba(240, 181, 145, 0.24)";
    ctx.lineWidth = i % 7 === 0 ? 1.4 : 0.9;

    ctx.beginPath();
    ctx.moveTo(width * 0.04 + offsetX * 6, yBase + wave + offsetY * 10);
    ctx.bezierCurveTo(
      width * 0.26 + offsetX * 12,
      yBase - 16 + Math.sin(i * 0.2 + time * 0.001) * 10,
      width * 0.64 + offsetX * 8,
      yBase + 18 + Math.cos(i * 0.18 + time * 0.0012) * 10,
      width * 0.96 + offsetX * 14,
      yBase - 8 + wave
    );
    ctx.stroke();
  }
}

function drawMapSymbols(time, offsetX, offsetY) {
  const landmarks = [
    { x: 0.73, y: 0.45, w: 18, h: 12 },
    { x: 0.58, y: 0.64, w: 16, h: 11 },
    { x: 0.36, y: 0.56, w: 14, h: 10 }
  ];

  landmarks.forEach((spot, idx) => {
    const x = width * spot.x + offsetX * (10 + idx * 5);
    const y = height * spot.y + offsetY * (8 + idx * 4);
    const jitter = Math.sin(time * 0.002 + idx * 1.7) * 1.2;

    ctx.fillStyle = "rgba(241, 150, 95, 0.34)";
    ctx.strokeStyle = "rgba(10, 99, 106, 0.66)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.rect(x - spot.w / 2, y - spot.h / 2 + jitter, spot.w, spot.h);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - spot.w * 0.8, y + spot.h);
    ctx.lineTo(x + spot.w * 0.8, y + spot.h);
    ctx.stroke();
  });
}

function animate(time) {
  smooth.x += (pointer.x - smooth.x) * 0.07;
  smooth.y += (pointer.y - smooth.y) * 0.07;

  const offsetX = smooth.x - 0.5;
  const offsetY = smooth.y - 0.5;

  drawBackdrop();
  drawContourBands(time, offsetX, offsetY);
  drawDistrictBlocks(offsetX, offsetY);
  drawRoadNetwork(offsetX, offsetY);
  drawMapSymbols(time, offsetX, offsetY);

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

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
requestAnimationFrame(animate);
