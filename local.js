// Case Log, server-free: all data lives in this device's IndexedDB. This module stands in for
// the NAS version's server: validation, progress, usage ranking, CSV import/export.
// Every case is a record keyed by uid; deletions leave a tombstone so they can sync.

import { SYLLABUS as S } from "./syllabus.js";

const DB_NAME = "caselog";
const CHILD = S.child_age_limit;
const HALF_LIFE_DAYS = 30;
const QUICK_PICK_COUNT = 8;
export const CSV_COLUMNS = ["id", "date", "procedure", "category", "role", "approach", "record_no", "initials",
  "age", "attending", "site", "notes", "also", "created_at", "updated_at"];

const CAT = Object.fromEntries(S.categories.map((c) => [c.key, c]));
const PRESET = new Map(S.presets.map((p) => [p.name.toLowerCase(), p]));
const COMPANIONS = new Map(Object.entries(S.companions).map(([k, v]) => [k.toLowerCase(), v.map((x) => x.toLowerCase())]));

let db = null;
const cases = new Map(); // uid -> record (tombstones included)
const kv = new Map();
const listeners = new Set();

export class Invalid extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/* --------------------------------------------------------------- storage */

const reqP = (r) => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

export async function open() {
  db = await new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("cases", { keyPath: "uid" });
      r.result.createObjectStore("kv", { keyPath: "k" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error("Close other Case Log tabs and reload."));
  });
  const t = db.transaction(["cases", "kv"], "readonly");
  for (const c of await reqP(t.objectStore("cases").getAll())) cases.set(c.uid, c);
  for (const e of await reqP(t.objectStore("kv").getAll())) kv.set(e.k, e.v);
  if (!kv.get("device")) await setKv("device", randomId());
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (_) { /* not supported */ }
}

function write(stores, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, "readwrite");
    fn(t);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error("Couldn't save on this device."));
  });
}

export const getKv = (k, fallback = null) => (kv.has(k) ? kv.get(k) : fallback);
export async function setKv(k, v) {
  if (v === undefined) {
    kv.delete(k);
    await write(["kv"], (t) => t.objectStore("kv").delete(k));
  } else {
    kv.set(k, v);
    await write(["kv"], (t) => t.objectStore("kv").put({ k, v }));
  }
}

export function randomId() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const deviceId = () => kv.get("device");

// Store records (local edits or merged from another device). `local` marks them for sending.
export async function putRecords(records, { local = true } = {}) {
  await write(["cases", "kv"], (t) => {
    const s = t.objectStore("cases");
    for (const r of records) s.put(r);
    if (local) {
      const outbox = new Set(kv.get("outbox") || []);
      for (const r of records) outbox.add(r.uid);
      kv.set("outbox", [...outbox]);
      t.objectStore("kv").put({ k: "outbox", v: [...outbox] });
    }
  });
  for (const r of records) cases.set(r.uid, r);
  for (const fn of listeners) fn({ local });
}

export const onChange = (fn) => listeners.add(fn);
export const allRecords = () => [...cases.values()];
export const getRecord = (uid) => cases.get(uid);

// Is `a` newer than `b`? Last writer wins; the device id breaks exact ties.
export const newer = (a, b) => !b || a.updated_at > b.updated_at ||
  (a.updated_at === b.updated_at && String(a.device) > String(b.device));

/* ------------------------------------------------------------ validation */

function text(v, limit = 200) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") throw new Invalid("A text field has the wrong type.");
  return String(v).split(/\s+/).filter(Boolean).join(" ").slice(0, limit);
}

function cleanDate(v) {
  const t = text(v, 20);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let y, mo, d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/))) {
    [d, mo, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
  }
  const date = y && new Date(Date.UTC(y, mo - 1, d));
  if (!date || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) throw new Invalid(`Date '${t}' isn't valid. Use YYYY-MM-DD.`);
  return date.toISOString().slice(0, 10);
}

function cleanAge(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) throw new Invalid(`Age '${v}' isn't a number.`);
  if (n < 0 || n > 120) throw new Invalid("Age must be between 0 and 120.");
  return Math.round(n * 10) / 10;
}

const ROLE_ALIASES = {
  primary: "primary", p: "primary", main: "primary", surgeon: "primary", "מנתח ראשי": "primary", "ראשי": "primary",
  "מנתח ראשון": "primary", assistant: "assistant", assist: "assistant", a: "assistant", "עוזר": "assistant",
  "עוזר ראשון": "assistant",
};
function cleanRole(v) {
  const r = ROLE_ALIASES[text(v, 30).toLowerCase()];
  if (!r) throw new Invalid("Role must be primary or assistant.");
  return r;
}
function cleanCategory(v) {
  const k = text(v, 40);
  if (!CAT[k]) throw new Invalid(`Unknown syllabus category '${k}'.`);
  return k;
}
function cleanApproach(v) {
  const a = text(v, 20);
  if (!(a in S.approaches)) throw new Invalid(`Unknown approach '${a}'.`);
  return a;
}
// Other procedures done in the same operation (not counted): names, or {procedure, category}.
function cleanAlso(v) {
  if (v === null || v === undefined || v === "") return { names: [], learn: [] };
  if (typeof v === "string") v = v.split("|");
  if (!Array.isArray(v) || v.length > 20) throw new Invalid("Included procedures must be a list.");
  const names = [];
  const learn = [];
  for (const x of v) {
    const name = text(typeof x === "object" && x ? x.procedure : x, 120);
    if (typeof x === "object" && x && CAT[x.category]) learn.push({ name, category: x.category, approach: x.approach || "" });
    if (name && !names.includes(name)) names.push(name);
  }
  return { names, learn };
}

const CLEAN = {
  date: cleanDate, procedure: (v) => text(v, 120), category: cleanCategory, role: cleanRole,
  approach: cleanApproach, record_no: (v) => text(v, 40), initials: (v) => text(v, 10), age: cleanAge,
  attending: (v) => text(v, 80), site: (v) => text(v, 80), notes: (v) => text(v, 500),
};

async function learn(items) {
  const custom = { ...getKv("custom", {}) };
  let changed = false;
  for (const { name, category, approach } of items) {
    if (!name || PRESET.has(name.toLowerCase())) continue;
    custom[name] = { category, approach: approach || "" };
    changed = true;
  }
  if (changed) await setKv("custom", custom);
}

const stamp = (prev) => Math.max(Date.now(), prev ? prev.updated_at + 1 : 0);
const live = () => [...cases.values()].filter((c) => !c.deleted);

/* ------------------------------------------------------------- the "API" */

export async function createCase(body) {
  const rec = {};
  for (const [f, fn] of Object.entries(CLEAN)) rec[f] = fn(body[f] ?? (f === "approach" ? "" : body[f]));
  if (!rec.procedure) throw new Invalid("Pick at least one procedure.");
  const also = cleanAlso(body.also);
  rec.also = also.names.filter((n) => n.toLowerCase() !== rec.procedure.toLowerCase());
  const uid = text(body.client_uid, 64) || randomId();
  const existing = cases.get(uid);
  if (existing && !existing.deleted) return { id: uid, duplicate: true };
  Object.assign(rec, { uid, created_at: new Date().toISOString(), updated_at: stamp(existing), device: deviceId() });
  await learn([{ name: rec.procedure, category: rec.category, approach: rec.approach }, ...also.learn]);
  await putRecords([rec]);
  return { id: uid, duplicate: false };
}

export async function updateCase(uid, body) {
  const prev = cases.get(uid);
  if (!prev || prev.deleted) throw Object.assign(new Error("That case no longer exists."), { status: 404 });
  const rec = { ...prev };
  for (const [f, fn] of Object.entries(CLEAN)) if (f in body) rec[f] = fn(body[f]);
  if (!rec.procedure) throw new Invalid("Procedure name can't be empty.");
  if ("also" in body) rec.also = cleanAlso(body.also).names.filter((n) => n.toLowerCase() !== rec.procedure.toLowerCase());
  rec.updated_at = stamp(prev);
  rec.device = deviceId();
  await learn([{ name: rec.procedure, category: rec.category, approach: rec.approach }]);
  await putRecords([rec]);
  return { case: view(rec) };
}

// A deleted case keeps only what sync needs; its patient details are gone from this device.
export async function deleteCase(uid) {
  const prev = cases.get(uid);
  if (!prev || prev.deleted) throw Object.assign(new Error("That case no longer exists."), { status: 404 });
  await putRecords([{ uid, deleted: true, updated_at: stamp(prev), device: deviceId() }]);
  return { ok: true };
}

const view = (r) => ({ ...r, id: r.uid });

export function listCases({ q = "", incomplete = false, category = "", limit = 100, offset = 0 } = {}) {
  q = q.trim().toLowerCase();
  let rows = live();
  if (q) {
    rows = rows.filter((c) => [c.procedure, c.record_no, c.initials, c.attending, c.notes, c.site, ...(c.also || [])]
      .some((x) => String(x || "").toLowerCase().includes(q)));
  }
  if (incomplete) rows = rows.filter((c) => (!c.record_no && !c.initials) || c.age === null || c.age === undefined);
  if (category) rows = rows.filter((c) => c.category === category);
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.created_at).localeCompare(String(a.created_at))));
  return { total: rows.length, cases: rows.slice(offset, offset + limit).map(view) };
}

function categoryCounts(rows) {
  const counts = Object.fromEntries(S.categories.map((c) => [c.key, { total: 0, primary: 0, children: 0, minimally_invasive: 0 }]));
  for (const r of rows) {
    const c = counts[r.category];
    if (!c) continue;
    c.total += 1;
    if (r.role === "primary") c.primary += 1;
    if (r.age !== null && r.age !== undefined && r.age < CHILD) c.children += 1;
    if (r.approach === "lap" || r.approach === "robotic") c.minimally_invasive += 1;
  }
  return counts;
}

export function progress({ from, to } = {}) {
  const rows = live().filter((c) => (!from || c.date >= from) && (!to || c.date <= to));
  const counts = categoryCounts(rows);
  let got = 0;
  let need = 0;
  const categories = S.categories.map((cat) => {
    const c = counts[cat.key];
    const sub = (cat.sub || []).map((s) => ({ ...s, done: c[s.kind] }));
    got += Math.min(c.total, cat.total) + Math.min(c.primary, cat.primary);
    need += cat.total + cat.primary;
    for (const s of sub) {
      got += Math.min(s.done, s.n);
      need += s.n;
    }
    return { key: cat.key, total_done: c.total, primary_done: c.primary, sub };
  });
  const incomplete = rows.filter((c) => (!c.record_no && !c.initials) || c.age === null || c.age === undefined).length;
  return { categories, overall: need ? got / need : 0, total_cases: rows.length, incomplete };
}

function knownProcedure(key) {
  const p = PRESET.get(key);
  if (p) return [p.name, p.category, p.approach];
  for (const [name, v] of Object.entries(getKv("custom", {}))) if (name.toLowerCase() === key) return [name, v.category, v.approach];
  return null;
}

// Procedures you mark, most used first, weighted toward recent weeks (a use 30 days ago counts
// half). Procedures added automatically with another (the cystoscopy in a TURBT) don't count.
export function usage(today = new Date()) {
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const since = new Date(t0 - 365 * 86400000).toISOString().slice(0, 10);
  const rows = live().filter((c) => c.date >= since)
    .sort((a, b) => (a.date === b.date ? String(a.created_at).localeCompare(String(b.created_at)) : a.date < b.date ? -1 : 1));
  const scores = new Map();
  const info = new Map();
  const last = new Map();
  rows.forEach((r, idx) => {
    const names = [r.procedure, ...(r.also || [])];
    const auto = new Set(names.flatMap((n) => COMPANIONS.get(n.toLowerCase()) || []));
    const days = Math.max(0, (t0 - Date.parse(r.date)) / 86400000);
    const w = Math.pow(0.5, days / HALF_LIFE_DAYS);
    names.forEach((name, i) => {
      const key = name.toLowerCase();
      if (auto.has(key)) return;
      const entry = i === 0 ? [r.procedure, r.category, r.approach] : info.get(key) || knownProcedure(key);
      if (!entry || !CAT[entry[1]]) return;
      scores.set(key, (scores.get(key) || 0) + w);
      info.set(key, entry);
      last.set(key, idx);
    });
  });
  return [...scores.keys()]
    .sort((a, b) => scores.get(b) - scores.get(a) || last.get(b) - last.get(a))
    .map((k) => ({ name: info.get(k)[0], category: info.get(k)[1], approach: info.get(k)[2], score: Math.round(scores.get(k) * 1000) / 1000 }));
}

function quickPicks(used) {
  const picks = used.slice(0, QUICK_PICK_COUNT).map(({ name, category, approach }) => ({ name, category, approach }));
  for (const name of S.defaults) {
    if (picks.length >= QUICK_PICK_COUNT) break;
    if (!picks.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      const p = PRESET.get(name.toLowerCase());
      picks.push({ name: p.name, category: p.category, approach: p.approach });
    }
  }
  return picks;
}

function recentDistinct(field, limit) {
  const seen = [];
  for (const c of live().sort((a, b) => b.updated_at - a.updated_at)) {
    if (c[field] && !seen.includes(c[field])) seen.push(c[field]);
    if (seen.length >= limit) break;
  }
  return seen;
}

export function meta() {
  const used = usage();
  const custom = new Map(Object.entries(getKv("custom", {})).map(([name, v]) => [name.toLowerCase(), { name, ...v }]));
  for (const c of live()) {
    const k = c.procedure.toLowerCase();
    if (!PRESET.has(k) && !custom.has(k)) custom.set(k, { name: c.procedure, category: c.category, approach: c.approach });
  }
  return {
    syllabus: S,
    quick_picks: quickPicks(used),
    usage: Object.fromEntries(used.map((u) => [u.name, u.score])),
    custom_procedures: [...custom.values()].sort((a, b) => a.name.localeCompare(b.name)),
    attendings: recentDistinct("attending", 40),
    sites: recentDistinct("site", 10),
    settings: { resident_name: getKv("resident_name", "") },
  };
}

export async function saveSettings(body) {
  if ("resident_name" in body) await setKv("resident_name", text(body.resident_name, 80));
  return { ok: true };
}

/* ------------------------------------------------------------------- CSV */

const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportCsv() {
  const rows = live().sort((a, b) => (a.date === b.date ? String(a.created_at).localeCompare(String(b.created_at)) : a.date < b.date ? -1 : 1));
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    const row = { ...r, id: r.uid, also: (r.also || []).join(" | "), updated_at: new Date(r.updated_at).toISOString() };
    lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function parseCsv(textIn) {
  const s = textIn.replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}

// Same format as the NAS version's backup. Cases already on this device are skipped.
export async function importCsv(textIn) {
  const rows = parseCsv(textIn);
  if (!rows.length) throw new Invalid("The file is empty.");
  const head = rows[0].map((x) => x.trim());
  const missing = ["date", "procedure", "category", "role"].filter((c) => !head.includes(c));
  if (missing.length) throw new Invalid(`The file needs these columns: ${missing.join(", ")}.`);
  const key = (r) => JSON.stringify(["date", "procedure", "category", "role", "approach", "record_no", "initials", "age", "attending", "site", "notes"].map((f) => r[f] ?? null).concat([(r.also || []).join("|")]));
  const existing = new Map();
  for (const c of live()) existing.set(key(c), (existing.get(key(c)) || 0) + 1);
  const seen = new Map();
  const errors = [];
  const out = [];
  let skipped = 0;
  rows.slice(1).forEach((cells, i) => {
    const raw = Object.fromEntries(head.map((h, j) => [h, cells[j] ?? ""]));
    let rec;
    try {
      rec = {};
      for (const [f, fn] of Object.entries(CLEAN)) rec[f] = fn(raw[f] ?? "");
      if (!rec.procedure) throw new Invalid("procedure is empty");
      rec.also = cleanAlso(raw.also).names;
    } catch (e) {
      errors.push(`Row ${i + 2}: ${e.message}`);
      return;
    }
    const k = key(rec);
    seen.set(k, (seen.get(k) || 0) + 1);
    if (seen.get(k) <= (existing.get(k) || 0)) {
      skipped += 1;
      return;
    }
    out.push({ ...rec, uid: randomId(), created_at: new Date().toISOString(), updated_at: Date.now(), device: deviceId() });
  });
  if (out.length) await putRecords(out);
  await learn(out.map((r) => ({ name: r.procedure, category: r.category, approach: r.approach })));
  return { imported: out.length, skipped, errors: errors.slice(0, 50), error_count: errors.length };
}

export const rowsForExport = ({ from, to } = {}) => live()
  .filter((c) => (!from || c.date >= from) && (!to || c.date <= to))
  .sort((a, b) => (a.date === b.date ? String(a.created_at).localeCompare(String(b.created_at)) : a.date < b.date ? -1 : 1));
