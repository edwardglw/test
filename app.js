const canvas = document.getElementById("map-canvas");
const ctx = canvas.getContext("2d");
const screen = document.querySelector(".screen");

let width = 0;
let height = 0;
const pointer = { x: 0, y: 0 };
const focus = { x: 0, y: 0 };

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

  pointer.x = width * 0.72;
  pointer.y = height * 0.48;
  focus.x = pointer.x;
  focus.y = pointer.y;
}

function drawBackdrop() {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f7ebd8");
  gradient.addColorStop(0.45, "#f2e3c9");
  gradient.addColorStop(1, "#0f7a78");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(15, 122, 120, 0.86)";
  ctx.fillRect(width * 0.42, 0, width * 0.58, height * 0.52);

  ctx.fillStyle = "rgba(239, 138, 74, 0.6)";
  ctx.fillRect(0, height * 0.82, width * 0.48, height * 0.22);
  ctx.globalAlpha = 1;
}

function drawStreetGrid() {
  ctx.save();
  ctx.translate(width * 0.16, height * 0.59);
  ctx.rotate(-0.2);

  ctx.strokeStyle = "rgba(13, 102, 109, 0.6)";
  ctx.lineWidth = 1;

  for (let y = 0; y < 130; y += 12) {
    for (let x = 0; x < 360; x += 17) {
      ctx.beginPath();
      ctx.rect(x, y, 14, 8);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawRoads() {
  ctx.strokeStyle = "rgba(10, 98, 104, 0.85)";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(width * 0.18, height * 0.72);
  ctx.lineTo(width * 0.76, height * 0.52);
  ctx.stroke();

  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(width * 0.48, height * 0.92);
  ctx.quadraticCurveTo(width * 0.64, height * 0.75, width * 0.88, height * 0.88);
  ctx.stroke();
}

function drawFlowLines() {
  const lineCount = 105;
  for (let i = 0; i < lineCount; i += 1) {
    const t = i / lineCount;
    const startX = width * (0.08 + t * 0.82);
    const startY = height * (0.08 + Math.sin(t * 8) * 0.02);
    const bend = 30 + Math.sin(t * 10) * 18;

    const hueShift = 180 + Math.sin(t * 15 + performance.now() * 0.001) * 10;
    ctx.strokeStyle = `hsla(${hueShift}, 53%, ${55 + t * 14}%, 0.45)`;
    ctx.lineWidth = 1.1;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(
      (startX + focus.x) / 2 + bend,
      (startY + focus.y) / 2 - bend,
      focus.x,
      focus.y
    );
    ctx.stroke();
  }

  for (let i = 0; i < 70; i += 1) {
    const t = i / 70;
    const startX = width * 0.02;
    const startY = height * (0.25 + t * 0.7);

    ctx.strokeStyle = "rgba(236, 135, 85, 0.32)";
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(width * 0.24, startY + 22, width * 0.68, focus.y - 10, focus.x, focus.y);
    ctx.stroke();
  }
}

function drawHotspot() {
  const pulse = Math.sin(performance.now() * 0.004) * 0.15 + 0.85;
  const radius = 38 * pulse;

  const glow = ctx.createRadialGradient(focus.x, focus.y, 4, focus.x, focus.y, radius);
  glow.addColorStop(0, "rgba(239, 138, 74, 0.9)");
  glow.addColorStop(1, "rgba(239, 138, 74, 0)");

  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(focus.x, focus.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function animate() {
  focus.x += (pointer.x - focus.x) * 0.08;
  focus.y += (pointer.y - focus.y) * 0.08;

  drawBackdrop();
  drawStreetGrid();
  drawRoads();
  drawFlowLines();
  drawHotspot();

  requestAnimationFrame(animate);
}

screen.addEventListener("pointermove", (event) => {
  const bounds = screen.getBoundingClientRect();
  pointer.x = event.clientX - bounds.left;
  pointer.y = event.clientY - bounds.top;
});

screen.addEventListener("pointerleave", () => {
  pointer.x = width * 0.72;
  pointer.y = height * 0.48;
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
animate();
