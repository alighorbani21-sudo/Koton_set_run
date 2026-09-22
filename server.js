const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const BODY_LIMIT = 10 * 1024;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scores (
      player_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      distance INTEGER NOT NULL DEFAULT 0,
      koton_points INTEGER NOT NULL DEFAULT 0,
      products_collected INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_scores_rank
    ON scores (distance DESC, koton_points DESC, created_at ASC);
  `);

  console.log("PostgreSQL database ready.");
}

function cleanName(v) {
  return String(v ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 16);
}

function validPlayerId(v) {
  return /^[A-Za-z0-9_-]{8,64}$/.test(String(v || ""));
}

function rankSort(a, b) {
  return (
    (b.distance - a.distance) ||
    (b.kotonPoints - a.kotonPoints) ||
    (a.createdAt - b.createdAt)
  );
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });

  if (type.startsWith("application/json")) {
    res.end(JSON.stringify(body));
  } else {
    res.end(body);
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;

      if (Buffer.byteLength(raw) > BODY_LIMIT) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("invalid json"));
      }
    });

    req.on("error", reject);
  });
}

async function getTop(limit = 20) {
  limit = Math.max(1, Math.min(100, Number(limit) || 20));

  const result = await pool.query(
    `
    SELECT
      player_id AS "playerId",
      display_name AS "displayName",
      distance,
      koton_points AS "kotonPoints",
      products_collected AS "productsCollected",
      EXTRACT(EPOCH FROM created_at) * 1000 AS "timestamp"
    FROM scores
    ORDER BY distance DESC, koton_points DESC, created_at ASC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows.map((r, i) => ({
    ...r,
    distance: Number(r.distance),
    kotonPoints: Number(r.kotonPoints),
    productsCollected: Number(r.productsCollected),
    timestamp: Number(r.timestamp),
    rank: i + 1
  }));
}

async function getRank(playerId) {
  const me = await pool.query(
    `
    SELECT
      distance,
      koton_points AS "kotonPoints",
      created_at AS "createdAt"
    FROM scores
    WHERE player_id = $1
    `,
    [playerId]
  );

  if (!me.rows.length) return null;

  const row = me.rows[0];

  const rank = await pool.query(
    `
    SELECT COUNT(*) + 1 AS rank
    FROM scores
    WHERE
      distance > $1
      OR (
        distance = $1
        AND koton_points > $2
      )
      OR (
        distance = $1
        AND koton_points = $2
        AND created_at < $3
      )
    `,
    [
      Number(row.distance),
      Number(row.kotonPoints),
      row.createdAt
    ]
  );

  return Number(rank.rows[0].rank);
}

async function getPlayer(playerId) {
  const result = await pool.query(
    `
    SELECT
      player_id AS "playerId",
      display_name AS "displayName",
      distance,
      koton_points AS "kotonPoints",
      products_collected AS "productsCollected",
      EXTRACT(EPOCH FROM created_at) * 1000 AS "timestamp"
    FROM scores
    WHERE player_id = $1
    `,
    [playerId]
  );

  if (!result.rows.length) return null;

  const r = result.rows[0];

  return {
    ...r,
    distance: Number(r.distance),
    kotonPoints: Number(r.kotonPoints),
    productsCollected: Number(r.productsCollected),
    timestamp: Number(r.timestamp)
  };
}

async function saveScore(body) {
  const playerId = String(body.playerId || "");
  const displayName = cleanName(body.displayName);

  const distance = Math.floor(Number(body.distance));
  const kotonPoints = Math.floor(Number(body.kotonPoints));
  const productsCollected = Math.floor(Number(body.productsCollected));

  if (!validPlayerId(playerId)) {
    throw new Error("invalid playerId");
  }

  if (
    displayName.length < 2 ||
    !Number.isFinite(distance) ||
    !Number.isFinite(kotonPoints) ||
    !Number.isFinite(productsCollected)
  ) {
    throw new Error("invalid score");
  }

  if (distance < 0 || distance > 1000000) {
    throw new Error("invalid distance");
  }

  if (kotonPoints < 0 || kotonPoints > 5000000) {
    throw new Error("invalid points");
  }

  if (productsCollected < 0 || productsCollected > 5) {
    throw new Error("invalid products");
  }

  await pool.query(
    `
    INSERT INTO scores (
      player_id,
      display_name,
      distance,
      koton_points,
      products_collected
    )
    VALUES ($1, $2, $3, $4, $5)

    ON CONFLICT (player_id)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      distance = EXCLUDED.distance,
      koton_points = EXCLUDED.koton_points,
      products_collected = EXCLUDED.products_collected,
      updated_at = NOW()

    WHERE
      EXCLUDED.distance > scores.distance
      OR (
        EXCLUDED.distance = scores.distance
        AND EXCLUDED.koton_points > scores.koton_points
      )
      OR (
        EXCLUDED.distance = scores.distance
        AND EXCLUDED.koton_points = scores.koton_points
        AND EXCLUDED.products_collected > scores.products_collected
      )
    `,
    [
      playerId,
      displayName,
      distance,
      kotonPoints,
      productsCollected
    ]
  );

  const rank = await getRank(playerId);
  const top = await getTop(20);
  const me = await getPlayer(playerId);

  return {
    ok: true,
    rank,
    top,
    me
  };
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  const url = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  );

  try {
    /* HEALTH */
    if (
      req.method === "GET" &&
      (url.pathname === "/api/health" ||
       url.pathname === "/healthz")
    ) {
      await pool.query("SELECT 1");

      return send(res, 200, {
        ok: true,
        database: "postgresql",
        service: "KOTON_SET RUN"
      });
    }

    /* SAVE SCORE */
    if (
      req.method === "POST" &&
      url.pathname === "/api/scores"
    ) {
      const body = await parseBody(req);
      const result = await saveScore(body);

      return send(res, 200, result);
    }

    /* LEADERBOARD */
    if (
      req.method === "GET" &&
      url.pathname === "/api/leaderboard"
    ) {
      const limit = Math.min(
        100,
        Math.max(1, Number(url.searchParams.get("limit")) || 20)
      );

      const playerId =
        url.searchParams.get("playerId") || "";

      const top = await getTop(limit);

      let rank = null;
      let me = null;

      if (playerId && validPlayerId(playerId)) {
        rank = await getRank(playerId);
        me = await getPlayer(playerId);

        if (me && rank !== null) {
          me.rank = rank;
        }
      }

      return send(res, 200, {
        ok: true,
        top,
        rank,
        me
      });
    }

    /* PLAYER RANK */
    if (
      req.method === "GET" &&
      url.pathname === "/api/leaderboard/rank"
    ) {
      const playerId =
        url.searchParams.get("playerId") || "";

      if (!validPlayerId(playerId)) {
        return send(res, 400, {
          ok: false,
          error: "invalid playerId"
        });
      }

      const rank = await getRank(playerId);

      return send(res, 200, {
        ok: true,
        rank
      });
    }

    /* STATIC FILES */
    if (req.method === "GET") {
      let pathname = decodeURIComponent(url.pathname);

      if (pathname === "/") {
        pathname = "/index.html";
      }

      if (
        pathname.includes("..") ||
        pathname.includes("\\")
      ) {
        return send(res, 403, {
          ok: false,
          error: "forbidden"
        });
      }

      if (
        pathname.startsWith("/data") ||
        pathname.startsWith("/.git") ||
        pathname.includes("/.")
      ) {
        return send(res, 403, {
          ok: false,
          error: "forbidden"
        });
      }

      const file = path.normalize(
        path.join(ROOT, pathname)
      );

      if (
        !file.startsWith(ROOT + path.sep) &&
        file !== ROOT
      ) {
        return send(res, 403, {
          ok: false,
          error: "forbidden"
        });
      }

      if (
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        return send(res, 404, {
          ok: false,
          error: "not found"
        });
      }

      res.writeHead(200, {
        "Content-Type":
          mime[path.extname(file).toLowerCase()] ||
          "application/octet-stream",
        "Cache-Control":
          pathname === "/index.html"
            ? "no-cache"
            : "public, max-age=3600",
        "Access-Control-Allow-Origin": "*"
      });

      return fs.createReadStream(file).pipe(res);
    }

    return send(res, 405, {
      ok: false,
      error: "method not allowed"
    });

  } catch (err) {
    console.error(err);

    return send(res, 500, {
      ok: false,
      error: err.message || "server error"
    });
  }
});

initDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(
        `KOTON_SET RUN server listening on port ${PORT}`
      );
    });
  })
  .catch(err => {
    console.error(
      "Database initialization failed:",
      err
    );
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  await pool.end();
  server.close(() => process.exit(0));
});

process.on("SIGINT", async () => {
  await pool.end();
  server.close(() => process.exit(0));
});
