// Case Log, server-free: all data lives in this device's IndexedDB. This module stands in for
// the NAS version's server: validation, progress, usage ranking, CSV import/export.
// Every case is a record keyed by uid; deletions leave a tombstone so they can sync.

import { SYLLABI, DEFAULT_ID, countCases, extras, overallShare } from "./syllabi.js";

const DB_NAME = "caselog";
const APPROACHES = ["", "open", "lap", "robotic", "endo", "perc"];
const SETTINGS = "settings"; // a synced record: which syllabus, residency start date
const HALF_LIFE_DAYS = 30;
const QUICK_PICK_COUNT = 8;
export const CSV_COLUMNS = ["id", "date", "procedure", "category", "role", "approach", "record_no", "initials",
  "age", "attending", "site", "notes", "also", "created_at", "updated_at"];

// The syllabus in use on this device (the same on every paired device).
let S;
let CAT;
let PRESET;
let COMPANIONS;
function apply(id) {
  S = SYLLABI[id] || SYLLABI[DEFAULT_ID];
  CAT = Object.fromEntries(S.categories.map((c) => [c.key, c]));
  PRESET = new Map(S.presets.map((p) => [p.name.toLowerCase(), p]));
  COMPANIONS = new Map(Object.entries(S.companions).map(([k, v]) => [k.toLowerCase(), v.map((x) => x.toLowerCase())]));
}
apply(DEFAULT_ID);

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
  // Devices that used Case Log before there was a choice of syllabus were on urology. Record
  // that, but weakly, so a syllabus chosen on purpose on another device wins.
  if (!syllabusId() && (live().length || kv.get("sync"))) {
    await putRecords([{ uid: SETTINGS, kind: SETTINGS, syllabus: DEFAULT_ID, updated_at: 1, device: deviceId() }]);
  }
  apply(syllabusId() || DEFAULT_ID);
  await repairStored();
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
  if (records.some((r) => r.uid === SETTINGS)) apply(syllabusId() || DEFAULT_ID); // e.g. chosen on a paired device
  for (const fn of listeners) fn({ local });
}

export const onChange = (fn) => listeners.add(fn);
export const allRecords = () => [...cases.values()];
export const getRecord = (uid) => cases.get(uid);

// Is `a` newer than `b`? Last writer wins; the device id breaks exact ties.
export const newer = (a, b) => !b || a.updated_at > b.updated_at ||
  (a.updated_at === b.updated_at && String(a.device) > String(b.device));

/* -------------------------------------------------------------- settings */

const settingsRecord = () => cases.get(SETTINGS) || null;
export function syllabusId() {
  const r = settingsRecord();
  return r && SYLLABI[r.syllabus] ? r.syllabus : null;
}
export const syllabus = () => S;

async function saveSettingsRecord(patch, { weak = false } = {}) {
  const prev = settingsRecord();
  const rec = { syllabus: syllabusId() || DEFAULT_ID, residency_start: "", ...(prev || {}), ...patch,
    uid: SETTINGS, kind: SETTINGS, updated_at: weak ? 0 : stamp(prev), device: deviceId() };
  await putRecords([rec]);
  apply(rec.syllabus);
}

export async function chooseSyllabus(id) {
  if (!SYLLABI[id]) throw new Invalid("Unknown syllabus.");
  await saveSettingsRecord({ syllabus: id });
}

// A device joining a pairing takes the other device's settings: make ours lose any tie.
export async function yieldSettings() {
  const prev = settingsRecord();
  if (prev) await saveSettingsRecord({}, { weak: true });
}

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

// Role names as typed in a CSV, mapped to this syllabus's roles.
const ROLE_ALIASES = {
  primary: "primary", p: "primary", main: "primary", surgeon: "primary", "primary surgeon": "primary",
  "first surgeon": "primary", "מנתח ראשי": "primary", "ראשי": "primary", "מנתח ראשון": "primary",
  instructor: "instructor", "resident-instructor": "instructor", "מתמחה-מדריך": "instructor", "מתמחה מדריך": "instructor",
  "עוזר ראשון-מדריך": "instructor", "מנתח אחראי": "instructor",
  first: "first", "1st assistant": "first", "first assistant": "first", "עוזר ראשון": "first",
  second: "second", "2nd assistant": "second", "second assistant": "second", "עוזר שני": "second",
  assistant: "assistant", assist: "assistant", a: "assistant", "עוזר": "assistant",
};
function cleanRole(v) {
  const keys = S.roles.map((r) => r.key);
  let r = ROLE_ALIASES[text(v, 30).toLowerCase()] || text(v, 30);
  if (!keys.includes(r)) {
    // Urology has one assistant role; general surgery splits it.
    if (r === "assistant" && keys.includes("first")) r = "first";
    else if (["instructor", "first", "second"].includes(r) && keys.includes("assistant")) r = "assistant";
    else if (r === "instructor" && !keys.includes("instructor")) r = "primary";
  }
  if (!keys.includes(r)) throw new Invalid(`Role must be one of: ${keys.join(", ")}.`);
  return r;
}
function cleanCategory(v) {
  const k = text(v, 40);
  if (!CAT[k]) throw new Invalid(`Unknown syllabus category '${k}'.`);
  return k;
}
function cleanApproach(v) {
  const a = text(v, 20);
  if (!APPROACHES.includes(a)) throw new Invalid(`Unknown approach '${a}'.`);
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

// Hebrew that went through a program reading UTF-8 as a Western encoding (often Excel opening a
// CSV and saving it again) turns into "×ž×•..." or worse. That is reversible: turn each
// character back into its byte and read the bytes as UTF-8 again, as many times as it was garbled.
const CP1252 = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89,
  "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96,
  "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f };
const GARBLED = /[ÃÂ×][\u0080-¿€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;
const utf8 = new TextDecoder("utf-8", { fatal: true });
// Each Hebrew letter is two bytes, D7 then 80-BF, so garbled Hebrew is "×" plus one character
// per letter. When a program on the way also dropped some bytes (א and ם end in bytes 90 and 9D,
// which Windows' Western encoding doesn't have, so they become "?" or "�"), decode pair by pair
// and restore those from context: ם only ends a word.
const byteOf = (ch) => {
  const code = ch.codePointAt(0);
  if (code < 0x100) return code;
  if (CP1252[ch] !== undefined) return CP1252[ch];
  return null;
};
function repairHebrewPairs(s) {
  if (!/[×Ö][^\x00-\x7f]/.test(s) && !LOST.test(s)) return s;
  const chars = [...s];
  let out = "";
  let letters = 0;
  for (let i = 0; i < chars.length; i++) {
    const lead = chars[i] === "×" ? 0x5c0 : chars[i] === "Ö" ? 0x580 : 0;
    const next = chars[i + 1];
    if (lead && next !== undefined) {
      const b = byteOf(next);
      if (b !== null && b >= 0x80 && b <= 0xbf) {
        const code = lead | (b & 0x3f);
        // Only Hebrew letters, geresh / gershayim and the maqaf: anything else means this wasn't Hebrew.
        if (!((code >= 0x5d0 && code <= 0x5ea) || code === 0x5f3 || code === 0x5f4 || code === 0x5be)) return s;
        out += String.fromCharCode(code);
        if (lead === 0x5c0) letters += 1;
        i += 1;
        continue;
      }
      // נ ends in byte A0, a no-break space, which often became a plain space. נ never ends a
      // word, so a Hebrew letter (or another garbled letter) always follows it.
      if (lead === 0x5c0 && next === " " && /[×\u05d0-\u05ea]/.test(chars[i + 2] || "")) {
        out += "נ";
        letters += 1;
        i += 1;
        continue;
      }
      if (lead === 0x5c0 && (next === "\ufffd" || next === "?")) {
        const after = chars[i + 2];
        out += after === undefined || /[\s.,;:'"()\-/]/.test(after) ? "ם" : "א";
        letters += 1;
        i += 1;
        continue;
      }
    }
    out += chars[i];
  }
  return letters ? out : s;
}

// Garbled letters whose second byte was lost or turned into a space (see above).
const LOST = /×[\ufffd?]|× (?=[×\u05d0-\u05ea])/;

export function repairText(v) {
  if (typeof v !== "string") return v;
  const strict = repairStrict(v);
  return GARBLED.test(strict) || LOST.test(strict) ? repairHebrewPairs(strict) : strict;
}

function repairStrict(v) {
  let s = v;
  for (let round = 0; round < 4 && typeof s === "string" && GARBLED.test(s); round++) {
    const bytes = [];
    for (const ch of s) {
      const code = ch.codePointAt(0);
      if (code < 0x100) bytes.push(code);
      else if (CP1252[ch] !== undefined) bytes.push(CP1252[ch]);
      else return s; // a real character outside the Western range: not this kind of garbling
    }
    let next;
    try {
      next = utf8.decode(new Uint8Array(bytes));
    } catch (_) {
      return s;
    }
    // Only accept a repair that produces Hebrew letters, undoes the classic "Ã©" garbling of
    // accented letters, or uncovers another layer of the same garbling.
    if (!/[\u05d0-\u05ea]/.test(next) && !/[ÃÂ][\u0080-\u00bf]/.test(s) && !GARBLED.test(next)) return s;
    s = next;
  }
  return s;
}

const NEEDS_REPAIR = (x) => typeof x === "string" && (GARBLED.test(x) || LOST.test(x));
const REPAIR_FIELDS = ["procedure", "record_no", "initials", "attending", "site", "notes"];

// Fix cases already saved with garbled Hebrew (imported before the repair existed).
async function repairStored() {
  const fixed = [];
  for (const c of live()) {
    const patch = {};
    for (const f of REPAIR_FIELDS) {
      if (NEEDS_REPAIR(c[f])) {
        const r = repairText(c[f]);
        if (r !== c[f]) patch[f] = r;
      }
    }
    const also = (c.also || []).map((a) => (typeof a === "string" ? repairText(a) : a));
    if (also.some((a, i) => a !== c.also[i])) patch.also = also;
    if (Object.keys(patch).length) fixed.push({ ...c, ...patch, updated_at: stamp(c), device: deviceId() });
  }
  if (fixed.length) await putRecords(fixed);
  return fixed.length;
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
const live = () => [...cases.values()].filter((c) => !c.deleted && !c.kind);

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

export const SORTS = ["date", "procedure", "category", "role", "attending"];

export function listCases({ q = "", incomplete = false, category = "", sort = "date", dir = "desc", limit = 100, offset = 0 } = {}) {
  q = q.trim().toLowerCase();
  let rows = live();
  if (q) {
    rows = rows.filter((c) => [c.procedure, c.record_no, c.initials, c.attending, c.notes, c.site, ...(c.also || [])]
      .some((x) => String(x || "").toLowerCase().includes(q)));
  }
  if (incomplete) rows = rows.filter(missingPatient);
  if (category) rows = rows.filter((c) => c.category === category);
  const oldest = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.created_at).localeCompare(String(b.created_at)));
  const text = (x) => String(x || "").toLocaleLowerCase();
  const catIndex = Object.fromEntries(S.categories.map((c, i) => [c.key, i]));
  const roleIndex = Object.fromEntries(S.roles.map((r, i) => [r.key, i]));
  // Each field ascending; the direction flips it. Within a group, newest first.
  const by = {
    date: oldest,
    procedure: (a, b) => text(a.procedure).localeCompare(text(b.procedure)),
    category: (a, b) => (catIndex[a.category] ?? 999) - (catIndex[b.category] ?? 999),
    role: (a, b) => (roleIndex[a.role] ?? 99) - (roleIndex[b.role] ?? 99),
    attending: (a, b) => text(a.attending).localeCompare(text(b.attending), "he"),
  };
  const field = by[sort] || oldest;
  const sign = dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    if (sort === "attending" && !a.attending !== !b.attending) return a.attending ? -1 : 1; // no attending: last
    return sign * field(a, b) || -oldest(a, b);
  });
  return { total: rows.length, cases: rows.slice(offset, offset + limit).map(view) };
}

const missingPatient = (c) => !(CAT[c.category] || {}).no_patient &&
  ((!c.record_no && !c.initials) || c.age === null || c.age === undefined);

export function progress({ from, to } = {}) {
  const rows = live().filter((c) => (!from || c.date >= from) && (!to || c.date <= to));
  const counts = countCases(S, rows);
  const start = (settingsRecord() || {}).residency_start || "";
  const ex = extras(S, rows, start);
  const categories = S.categories.map((cat) => ({ key: cat.key, ...counts[cat.key] }));
  return {
    categories, overall_targets: ex.overall, years: ex.years, residency_start: start,
    overall: overallShare(S, counts, ex.overall), total_cases: rows.length,
    incomplete: rows.filter(missingPatient).length,
  };
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
      if (!p) continue;
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
    syllabus_id: syllabusId(),
    quick_picks: quickPicks(used),
    usage: Object.fromEntries(used.map((u) => [u.name, u.score])),
    custom_procedures: [...custom.values()].sort((a, b) => a.name.localeCompare(b.name)),
    attendings: recentDistinct("attending", 40),
    sites: recentDistinct("site", 10),
    settings: { resident_name: getKv("resident_name", ""), residency_start: (settingsRecord() || {}).residency_start || "" },
  };
}

export async function saveSettings(body) {
  if ("resident_name" in body) await setKv("resident_name", text(body.resident_name, 80));
  if ("residency_start" in body) {
    const v = text(body.residency_start, 20);
    await saveSettingsRecord({ residency_start: v ? cleanDate(v) : "" });
  }
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
    const raw = Object.fromEntries(head.map((h, j) => [h, repairText(cells[j] ?? "")]));
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
