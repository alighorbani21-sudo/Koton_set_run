const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "scores.json");
const MAX_RECORDS = 500;
const BODY_LIMIT = 10 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", "utf8");

function loadScores() {
  try {
    const v = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch (_) { return []; }
}
let scores = loadScores();

function cleanName(v) {
  return String(v ?? "").normalize("NFC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 16);
}
function validPlayerId(v) {
  return /^[A-Za-z0-9_-]{8,64}$/.test(String(v || ""));
}
function rankSort(a, b) {
  return (b.distance - a.distance) ||
         (b.kotonPoints - a.kotonPoints) ||
         (a.timestamp - b.timestamp);
}
function rankOf(playerId) {
  const i = scores.slice().sort(rankSort).findIndex(x => x.playerId === playerId);
  return i < 0 ? null : i + 1;
}
function topRows(limit = 20) {
  return scores.slice().sort(rankSort).slice(0, Math.min(20, Math.max(1, limit)))
    .map((x, i) => ({ ...x, rank: i + 1 }));
}
function saveScores() {
  scores.sort(rankSort);
  scores = scores.slice(0, MAX_RECORDS);
  fs.writeFileSync(DB_FILE, JSON.stringify(scores, null, 2), "utf8");
}
function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", c => {
      raw += c;
      if (Buffer.byteLength(raw) > BODY_LIMIT) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); }
      catch (_) { reject(new Error("invalid json")); }
    });
  });
}
const mime = {
  ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg",
  ".webp":"image/webp", ".svg":"image/svg+xml", ".ico":"image/x-icon"
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && (u.pathname === "/healthz" || u.pathname === "/api/health"))
      return send(res, 200, { ok: true, records: scores.length });

    if (req.method === "POST" && u.pathname === "/api/scores") {
      const b = await parseBody(req);
      const playerId = String(b.playerId || "");
      const displayName = cleanName(b.displayName);
      const distance = Math.floor(Number(b.distance));
      const kotonPoints = Math.floor(Number(b.kotonPoints));
      const productsCollected = Math.floor(Number(b.productsCollected));
      if (!validPlayerId(playerId) || [...displayName].length < 2 ||
          !Number.isFinite(distance) || distance < 0 || distance > 1000000 ||
          !Number.isFinite(kotonPoints) || kotonPoints < 0 || kotonPoints > 5000000 ||
          !Number.isFinite(productsCollected) || productsCollected < 0 || productsCollected > 5)
        return send(res, 400, { ok:false, error:"invalid score" });

      const now = Date.now();
      const timestamp = Math.abs(Number(b.timestamp) - now) <= 15*60*1000
        ? Number(b.timestamp) : now;

      const rec = { playerId, displayName, distance, kotonPoints, productsCollected, timestamp };
      scores.push(rec);
      saveScores();

      const rank = rankOf(playerId);
      return send(res, 200, { ok:true, rank, top:topRows(20), me: rank ? {...rec, rank} : null });
    }

    if (req.method === "GET" && u.pathname === "/api/leaderboard") {
      const limit = Number(u.searchParams.get("limit") || 20);
      const pid = u.searchParams.get("playerId") || "";
      const top = topRows(limit);
      const rank = pid ? rankOf(pid) : null;
      const me = pid && rank ? { ...scores.find(x => x.playerId === pid), rank } : null;
      return send(res, 200, { ok:true, top, me });
    }

    if (req.method === "GET" && u.pathname === "/api/leaderboard/rank") {
      const pid = u.searchParams.get("playerId") || "";
      const rank = rankOf(pid);
      return send(res, 200, { ok:true, rank });
    }

    if (req.method === "GET") {
      let pathname = decodeURIComponent(u.pathname);
      if (pathname === "/") pathname = "/index.html";
      if (pathname.includes("..") || pathname.startsWith("/data") || pathname.includes("/."))
        return send(res, 403, {ok:false, error:"forbidden"});
      const file = path.normalize(path.join(ROOT, pathname));
      if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return send(res,403,{ok:false});
      if (!fs.existsSync(file) || !fs.statSync(file).isFile())
        return send(res, 404, {ok:false, error:"not found"});
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": pathname === "/index.html" ? "no-cache" : "public, max-age=3600",
        "Access-Control-Allow-Origin": "*"
      });
      return fs.createReadStream(file).pipe(res);
    }

    return send(res, 405, {ok:false, error:"method not allowed"});
  } catch (e) {
    return send(res, 400, {ok:false, error:e.message || "bad request"});
  }
});

server.listen(PORT, () => console.log(`KOTON_SET RUN listening on port ${PORT}`));
