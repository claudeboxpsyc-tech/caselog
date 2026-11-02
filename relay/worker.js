// Case Log sync relay: a Cloudflare Worker + D1 database.
//
// It passes encrypted batches between a resident's own devices. It cannot read them: the key
// exists only on the devices, in the pairing QR code. A "room" (one resident's devices) is
// claimed by the first device that writes to it; after that only the same token is accepted.
//
//   POST /v1/rooms/<room>/batches        {device, iv, data}  -> {seq}
//   GET  /v1/rooms/<room>/batches?after=N                    -> {batches:[{seq,device,iv,data}], more}
//   Authorization: Bearer <64 hex chars>, derived from the pairing secret on the device.

const MAX_BODY = 1_000_000;   // bytes per batch
const PAGE = 100;             // batches per GET
const DAILY_BATCHES = 5000;   // per room

const CORS = {
  "Access-Control-Allow-Origin": "*", // no cookies; the token is the only credential
  "Access-Control-Allow-Methods": "GET, POST",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHash(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const B64U = /^[A-Za-z0-9_-]+$/;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/v1\/rooms\/([0-9a-f]{32})\/batches$/);
    if (!m) return new Response(null, { status: 404, headers: CORS });
    const room = m[1];

    const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!/^[0-9a-f]{64}$/.test(auth)) return json({ error: "Missing or malformed token." }, 401);
    const hash = await sha256(auth);
    const known = await env.DB.prepare("SELECT token_hash FROM rooms WHERE id = ?").bind(room).first();
    if (known && !sameHash(known.token_hash, hash)) return json({ error: "Wrong token for this room." }, 401);

    if (request.method === "GET") {
      if (!known) return json({ batches: [], more: false });
      const after = Math.max(0, parseInt(url.searchParams.get("after") || "0", 10) || 0);
      const { results } = await env.DB.prepare(
        "SELECT seq, device, iv, data FROM batches WHERE room = ? AND seq > ? ORDER BY seq LIMIT ?",
      ).bind(room, after, PAGE + 1).all();
      return json({ batches: results.slice(0, PAGE), more: results.length > PAGE });
    }

    if (request.method === "POST") {
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ error: "Batch too large." }, 413);
      let body;
      try {
        body = JSON.parse(text);
      } catch (_) {
        return json({ error: "Expected JSON." }, 400);
      }
      const { device, iv, data } = body || {};
      if (typeof device !== "string" || !/^[0-9a-f]{32}$/.test(device) || typeof iv !== "string" || !B64U.test(iv) ||
          iv.length > 32 || typeof data !== "string" || !B64U.test(data)) {
        return json({ error: "Malformed batch." }, 400);
      }
      const now = Date.now();
      if (!known) {
        await env.DB.prepare("INSERT OR IGNORE INTO rooms (id, token_hash, created) VALUES (?, ?, ?)").bind(room, hash, now).run();
        const owner = await env.DB.prepare("SELECT token_hash FROM rooms WHERE id = ?").bind(room).first();
        if (!sameHash(owner.token_hash, hash)) return json({ error: "Wrong token for this room." }, 401);
      } else {
        const day = await env.DB.prepare("SELECT COUNT(*) AS n FROM batches WHERE room = ? AND created > ?")
          .bind(room, now - 86400000).first();
        if (day.n >= DAILY_BATCHES) return json({ error: "Too many changes today." }, 429);
      }
      const res = await env.DB.prepare("INSERT INTO batches (room, device, iv, data, created) VALUES (?, ?, ?, ?, ?)")
        .bind(room, device, iv, data, now).run();
      return json({ seq: res.meta.last_row_id }, 201);
    }

    return new Response(null, { status: 404, headers: CORS });
  },
};
