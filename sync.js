// Sync between a friend's own devices through the relay, end-to-end encrypted.
//
// Pairing makes one random 32-byte secret, shown as a QR code (or a code to paste). From it each
// device derives, with HKDF-SHA-256: the relay "room" id, a token that lets it read and write
// that room, and the AES-256-GCM key that encrypts every change. The relay only ever stores
// encrypted batches; it never sees the secret, the key, or any case.
//
// Each change is a whole case record (or a deletion marker) stamped with the time and device
// that made it. Merging keeps the newest version of each case, so every device ends up the same.

import * as L from "./local.js";
import { RELAY_URL } from "./config.js";

const te = new TextEncoder();
const td = new TextDecoder();
const BATCH = 150;
const CODE_PREFIX = "CL1-";

function b64u(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

// A relay must be HTTPS; plain http is accepted only on this computer (for testing).
const okRelay = (u) => /^https:\/\/[^\s/]+/.test(u) || /^http:\/\/localhost(:\d+)?$/.test(u);
export const relayReady = () => okRelay(RELAY_URL) && !RELAY_URL.includes("YOUR-");
export const defaultRelay = () => RELAY_URL;

let keys = null; // { key, room, auth } for the current pairing
let running = null;
let timer = null;
let status = { state: "off", last_ok: null, error: "" };
const statusListeners = new Set();

export const onStatus = (fn) => statusListeners.add(fn);
export const getStatus = () => ({ ...status, paired: isPaired(), last_ok: (L.getKv("sync") || {}).last_ok || null });
function setStatus(patch) {
  status = { ...status, ...patch };
  for (const fn of statusListeners) fn(getStatus());
}

export const isPaired = () => !!(L.getKv("sync") || {}).code;

async function derive(code) {
  const secret = unb64u(code.slice(CODE_PREFIX.length));
  const ikm = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits", "deriveKey"]);
  const salt = te.encode("caselog-sync-v1");
  const bits = async (info, n) => new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: te.encode(info) }, ikm, n * 8));
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: te.encode("enc") },
    ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { key, room: hex(await bits("room", 16)), auth: hex(await bits("auth", 32)) };
}

/* -------------------------------------------------------------- pairing */

// What the QR code holds: a link that opens Case Log and pairs. The secret is in the part
// after "#", which browsers never send to a server.
export function pairingLink() {
  const s = L.getKv("sync");
  if (!s) return "";
  const base = location.origin + location.pathname;
  const relay = s.relay !== RELAY_URL ? `&relay=${encodeURIComponent(s.relay)}` : "";
  return `${base}#pair=${s.code}${relay}`;
}

// Accepts the whole link, or just the code.
export function parsePairing(input) {
  const t = String(input || "").trim();
  let code = t;
  let relay = RELAY_URL;
  const m = t.match(/[#&]pair=([^&\s]+)/);
  if (m) {
    code = decodeURIComponent(m[1]);
    const r = t.match(/[#&]relay=([^&\s]+)/);
    if (r) relay = decodeURIComponent(r[1]);
  }
  if (!new RegExp(`^${CODE_PREFIX}[A-Za-z0-9_-]{43}$`).test(code)) return null;
  if (!okRelay(relay)) return null;
  return { code, relay };
}

// Start syncing on this device: everything already here gets sent once.
async function adopt({ code, relay }) {
  await L.setKv("sync", { code, relay, cursor: 0, last_ok: null });
  await L.setKv("outbox", L.allRecords().map((r) => r.uid));
  keys = null;
  setStatus({ state: "idle", error: "" });
  return syncNow();
}

export async function createPairing() {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  return adopt({ code: CODE_PREFIX + b64u(secret), relay: RELAY_URL });
}

export async function joinPairing(input) {
  const p = parsePairing(input);
  if (!p) throw new Error("That isn't a Case Log pairing code. Scan the QR code again, or copy the whole code.");
  await L.yieldSettings(); // this device takes the syllabus of the device it pairs with
  return adopt(p);
}

// Stop syncing on this device. Its cases stay here.
export async function unpair() {
  await L.setKv("sync", undefined);
  await L.setKv("outbox", undefined);
  keys = null;
  setStatus({ state: "off", error: "" });
}

/* ------------------------------------------------------------------ sync */

async function relayFetch(path, opts = {}) {
  const s = L.getKv("sync");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(s.relay.replace(/\/$/, "") + path, {
      ...opts, mode: "cors", credentials: "omit", cache: "no-store", signal: ctrl.signal,
      headers: { Authorization: `Bearer ${keys.auth}`, "Content-Type": "application/json" },
    });
    if (res.status === 401) throw Object.assign(new Error("The sync service didn't accept this device's code. Pair it again."), { fatal: true });
    if (!res.ok) throw new Error(`The sync service answered with error ${res.status}. It will try again later.`);
    return res.json();
  } catch (e) {
    if (e.fatal || e.message.startsWith("The sync service answered")) throw e;
    throw new Error("Couldn't reach the sync service. Your cases are safe on this device and will sync later.");
  } finally {
    clearTimeout(t);
  }
}

async function encrypt(obj) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const data = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: te.encode(keys.room) }, keys.key, te.encode(JSON.stringify(obj))));
  return { iv: b64u(iv), data: b64u(data) };
}

async function decrypt(batch) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64u(batch.iv), additionalData: te.encode(keys.room) }, keys.key, unb64u(batch.data));
  return JSON.parse(td.decode(plain));
}

const validRecord = (r) => r && typeof r.uid === "string" && r.uid.length <= 64 && Number.isFinite(r.updated_at) &&
  (r.deleted === true || (r.kind === "settings" && typeof r.syllabus === "string") ||
    (!r.kind && typeof r.procedure === "string" && typeof r.date === "string" && typeof r.category === "string"));

async function pull() {
  const me = L.deviceId();
  let received = 0; // new or changed cases (deletions aren't counted)
  for (;;) {
    const s = L.getKv("sync");
    const r = await relayFetch(`/v1/rooms/${keys.room}/batches?after=${s.cursor || 0}`);
    const merged = [];
    for (const b of r.batches) {
      if (b.device === me) continue;
      let payload;
      try {
        payload = await decrypt(b);
      } catch (_) {
        continue; // not readable with this pairing's key: ignore
      }
      for (const rec of payload.records || []) {
        if (!validRecord(rec)) continue;
        const current = merged.find((x) => x.uid === rec.uid) || L.getRecord(rec.uid);
        if (L.newer(rec, current)) {
          const i = merged.findIndex((x) => x.uid === rec.uid);
          if (i >= 0) merged[i] = rec;
          else merged.push(rec);
        }
      }
    }
    if (merged.length) await L.putRecords(merged, { local: false });
    received += merged.filter((x) => !x.deleted && !x.kind).length;
    const last = r.batches.length ? r.batches[r.batches.length - 1].seq : s.cursor || 0;
    await L.setKv("sync", { ...L.getKv("sync"), cursor: last });
    if (!r.more) return received;
  }
}

async function push() {
  let sent = 0;
  for (;;) {
    const outbox = L.getKv("outbox", []);
    if (!outbox.length) return sent;
    const uids = outbox.slice(0, BATCH);
    const records = uids.map((u) => L.getRecord(u)).filter(Boolean);
    const stamps = new Map(records.map((r) => [r.uid, r.updated_at]));
    if (records.length) {
      const body = await encrypt({ v: 1, records });
      await relayFetch(`/v1/rooms/${keys.room}/batches`, { method: "POST", body: JSON.stringify({ device: L.deviceId(), ...body }) });
      sent += records.length;
    }
    // Keep anything edited again while this batch was on its way.
    const left = L.getKv("outbox", []).filter((u) => !uids.includes(u) || (L.getRecord(u) && L.getRecord(u).updated_at !== stamps.get(u)));
    await L.setKv("outbox", left);
  }
}

export function syncNow() {
  if (!isPaired()) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    setStatus({ state: "syncing" });
    try {
      if (!keys) keys = await derive(L.getKv("sync").code);
      const received = await pull();
      const sent = await push();
      await L.setKv("sync", { ...L.getKv("sync"), last_ok: Date.now() });
      setStatus({ state: "ok", error: "" });
      return { received, sent };
    } catch (e) {
      setStatus({ state: "error", error: e.message });
      return { error: e.message };
    } finally {
      running = null;
    }
  })();
  return running;
}

// Send changes a moment after they're made; check for the other device's changes every minute
// and whenever the app comes back to the screen or the connection returns.
export function start() {
  L.onChange(({ local }) => {
    if (!local || !isPaired()) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 1500);
  });
  setInterval(() => {
    if (document.visibilityState === "visible") syncNow();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow();
  });
  window.addEventListener("online", () => syncNow());
  setStatus({ state: isPaired() ? "idle" : "off" });
  return syncNow();
}
