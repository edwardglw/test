"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// el-w / anima — local server
// Run:  node server.js
// Then open the Network URL shown in the console on your phone.
// ─────────────────────────────────────────────────────────────────────────────

const http     = require("http");
const fs       = require("fs");
const path     = require("path");
const os       = require("os");
const { randomUUID } = require("crypto");

const PORT      = process.env.PORT || 3000;
const ROOT      = __dirname;
const UPLOADS   = path.join(ROOT, "uploads");

// Ensure uploads folder exists
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

// ─── MIME types ──────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".heic": "image/heic",
};

// ─── Minimal multipart parser ─────────────────────────────────────────────
// Parses a single multipart/form-data body and saves files to UPLOADS.
// Returns a Promise resolving to an array of saved file paths relative to ROOT.
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const ct = req.headers["content-type"] || "";
    const m  = ct.match(/boundary=([^\s;]+)/);
    if (!m) return reject(new Error("No boundary in Content-Type"));
    const boundary = "--" + m[1];

    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("error", reject);
    req.on("end", () => {
      try {
        const body  = Buffer.concat(chunks);
        const sep   = Buffer.from("\r\n" + boundary);
        const saved = [];

        let pos = body.indexOf(boundary);
        while (pos !== -1) {
          const start = pos + boundary.length;
          if (body.slice(start, start + 2).toString() === "--") break;
          const headerEnd = body.indexOf("\r\n\r\n", start);
          if (headerEnd === -1) break;
          const headers   = body.slice(start + 2, headerEnd).toString();
          const nextBound = body.indexOf(sep, headerEnd + 4);
          const fileData  = body.slice(headerEnd + 4, nextBound === -1 ? body.length : nextBound);

          // Extract original filename
          const fnMatch = headers.match(/filename="([^"]+)"/);
          if (fnMatch) {
            const ext      = path.extname(fnMatch[1]).toLowerCase() || ".jpg";
            const saveName = Date.now() + "-" + randomUUID().slice(0, 8) + ext;
            const savePath = path.join(UPLOADS, saveName);
            fs.writeFileSync(savePath, fileData);
            saved.push("/uploads/" + saveName);
          }
          pos = nextBound;
        }
        resolve(saved);
      } catch (e) { reject(e); }
    });
  });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  // ── POST /api/upload ───────────────────────────────────────────────────────
  if (req.method === "POST" && url === "/api/upload") {
    try {
      const files = await parseMultipart(req);
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ files }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── GET /api/photos ────────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/api/photos") {
    try {
      const exts  = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"]);
      const files = fs.readdirSync(UPLOADS)
        .filter(f => exts.has(path.extname(f).toLowerCase()))
        .sort()
        .map(f => "/uploads/" + f);
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(files));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify([]));
    }
    return;
  }

  // ── DELETE /api/photos/:filename ───────────────────────────────────────────
  if (req.method === "DELETE" && url.startsWith("/api/photos/")) {
    const filename = path.basename(url.replace("/api/photos/", ""));
    const target   = path.join(UPLOADS, filename);
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Static file serving ────────────────────────────────────────────────────
  let filePath = path.join(ROOT, url === "/" ? "index.html" : url);

  // Prevent directory traversal outside ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  if (fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  } catch (e) {
    res.writeHead(500);
    res.end("Server error");
  }
});

// ─── Start & print access URLs ───────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  console.log("\n  ╔════════════════════════════════════════╗");
  console.log("  ║         el-w / anima  is live          ║");
  console.log("  ╠════════════════════════════════════════╣");
  console.log(`  ║  Local:   http://localhost:${PORT}         ║`);

  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        const url = `http://${net.address}:${PORT}`;
        const pad = " ".repeat(Math.max(0, 38 - url.length));
        console.log(`  ║  Network: ${url}${pad}║  ← phone`);
      }
    }
  }

  console.log("  ╚════════════════════════════════════════╝\n");
});
