"use strict";

/* Case Log, server-free edition. Cases live on this device (IndexedDB) and sync, end-to-end
   encrypted, with the friend's other paired devices. No account, no server that can read them. */

import * as L from "./local.js";
import * as Sync from "./sync.js";
import { imaWorkbook } from "./exports.js";
import qrcode from "./vendor/qrcode.mjs";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const PREFS_KEY = "caselog.prefs.v1";
const coarse = window.matchMedia("(pointer: coarse)").matches;

const state = {
  meta: null,
  catByKey: {},
  procedures: [],
  picked: [],
  mainUid: null, // set when the user overrides which marked procedure the operation counts as
  role: "primary",
  date: "today",
  sort: "syllabus",
  view: "log",
  progress: null,
  progressStale: true,
  cases: { q: "", incomplete: false, category: "", items: [], total: 0, stale: true },
  editing: null,
  editRole: "primary",
  resultIndex: -1,
};

/* ------------------------------------------------------------------- api */

// The NAS version talked to a server; here the same calls go to this device's own data.
async function api(path, { method = "GET", body } = {}) {
  const url = new URL(path, location.href);
  const p = url.searchParams;
  const m = url.pathname.match(/\/api\/cases\/([^/]+)$/);
  if (url.pathname.endsWith("/api/meta")) return L.meta();
  if (url.pathname.endsWith("/api/progress")) return L.progress();
  if (url.pathname.endsWith("/api/settings")) return L.saveSettings(body);
  if (url.pathname.endsWith("/api/cases") && method === "GET") {
    return L.listCases({ q: p.get("q") || "", incomplete: p.get("incomplete") === "1", category: p.get("category") || "",
      limit: +(p.get("limit") || 100), offset: +(p.get("offset") || 0) });
  }
  if (url.pathname.endsWith("/api/cases") && method === "POST") return L.createCase(body);
  if (m && method === "PUT") return L.updateCase(decodeURIComponent(m[1]), body);
  if (m && method === "DELETE") return L.deleteCase(decodeURIComponent(m[1]));
  throw new Error(`Unknown request ${method} ${path}`);
}

async function loadMeta() {
  state.meta = await api("/api/meta");
  applyMeta();
}

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function he(text) {
  return h("span", { class: "he", lang: "he", dir: "rtl" }, text);
}

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function store(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (_) { /* private mode or storage blocked */ }
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function isoLocal(d) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

const todayISO = () => isoLocal(new Date());

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoLocal(d);
}

function caseDate() {
  if (state.date === "today") return todayISO();
  if (state.date === "yesterday") return yesterdayISO();
  return state.date;
}

function formatDay(iso) {
  const d = new Date(iso + "T12:00:00");
  if (iso === todayISO()) return "Today";
  if (iso === yesterdayISO()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

let toastTimer = null;

function toast(text, actionLabel, action) {
  const box = $("#toast");
  $("#toast-text").textContent = text;
  const btn = $("#toast-action");
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || "";
  btn.onclick = () => {
    box.hidden = true;
    if (action) action();
  };
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), actionLabel ? 8000 : 4500);
}

function applyMeta() {
  const m = state.meta;
  const syl = m.syllabus;
  state.catByKey = Object.fromEntries(syl.categories.map((c) => [c.key, c]));
  const byName = new Map();
  for (const p of syl.presets) byName.set(p.name.toLowerCase(), p);
  for (const p of m.custom_procedures) if (!byName.has(p.name.toLowerCase())) byName.set(p.name.toLowerCase(), p);
  state.procedures = [...byName.values()].filter((p) => state.catByKey[p.category]);
  state.procByName = new Map(state.procedures.map((p) => [p.name.toLowerCase(), p]));

  renderQuickPicks();
  renderAttendingChips();
  fillDatalist("#attending-list", m.attendings);
  fillDatalist("#site-list", m.sites);
  fillDatalist("#all-procedures", state.procedures.map((p) => p.name));
  if (!$("#f-site").value) $("#f-site").value = load(PREFS_KEY, {}).site || m.sites[0] || "";

  const sel = $("#e-category");
  sel.replaceChildren(...categoryOptions());
  $("#syllabus-name").textContent = syl.name;
  $("#set-name").value = m.settings.resident_name || "";
  $("#about-text").textContent =
    `Targets come from the appendix to the IMA ${syl.name.toLowerCase()}. ` +
    `"In children" counts patients under ${syl.child_age_limit}. Laparoscopic and robotic kidney or adrenal cases ` +
    "count toward the minimally invasive target. When an operation has several procedures, it counts as the most " +
    "significant one whose targets aren't met yet. Your cases are stored on this device (and on your other devices " +
    "once you pair them); the sync service only ever sees them encrypted.";
}

function categoryOptions(withBlank = false) {
  const syl = state.meta.syllabus;
  const out = [];
  if (withBlank) out.push(h("option", { value: "" }, "Choose syllabus category"));
  for (const [gkey, g] of Object.entries(syl.groups)) {
    const og = h("optgroup", { label: g.en });
    for (const c of syl.categories.filter((c) => c.group === gkey)) og.append(h("option", { value: c.key }, c.en));
    out.push(og);
  }
  return out;
}

function fillDatalist(sel, values) {
  $(sel).replaceChildren(...values.map((v) => h("option", { value: v })));
}

function renderQuickPicks() {
  const box = $("#quick-picks");
  box.classList.add("grid");
  box.replaceChildren(
    ...state.meta.quick_picks
      .filter((p) => state.catByKey[p.category])
      .map((p) =>
        h("button", {
          type: "button",
          class: "chip",
          "aria-pressed": String(state.picked.some((x) => x.name === p.name)),
          onclick: () => togglePick(p),
        }, p.name)
      )
  );
}

function renderAttendingChips() {
  const current = $("#f-attending").value.trim();
  const names = state.meta.attendings.slice(0, 4);
  $("#attending-chips").replaceChildren(
    ...names.map((n) =>
      h("button", {
        type: "button",
        class: "chip",
        "aria-pressed": String(n === current),
        onclick: () => {
          $("#f-attending").value = $("#f-attending").value.trim() === n ? "" : n;
          renderAttendingChips();
        },
      }, n)
    )
  );
}

function togglePick(p) {
  const existing = state.picked.find((x) => x.name === p.name);
  if (existing) removePick(existing, false);
  else addPick(p, false);
  renderPicked();
}

// Mark a procedure. `parent` is set when it's marked automatically as part of another one.
function addPick(p, render = true, parent = null) {
  const pick = {
    uid: newId(), name: p.name, category: p.category || "", approach: p.approach || "",
    auto: !!parent, parents: parent ? [parent.uid] : [],
  };
  if (!parent && pick.category) {
    // Marking a procedure yourself replaces one marked automatically in the same category,
    // e.g. tapping "Cystoscopy + retrograde pyelogram" after TURBT replaces "Cystoscopy, rigid".
    state.picked = state.picked.filter((x) => !(x.auto && x.category === pick.category));
    if (!state.picked.some((x) => x.uid === state.mainUid)) state.mainUid = null;
  }
  state.picked.push(pick);
  if (!parent) addCompanions(pick);
  if (render) renderPicked();
  return pick;
}

// Also mark the procedures that are part of this one almost every time (TURBT -> cystoscopy),
// unless something in the same syllabus category is marked already.
function addCompanions(pick) {
  const names = (state.meta.syllabus.companions || {})[pick.name] || [];
  for (const name of names) {
    const comp = state.procByName.get(name.toLowerCase());
    if (!comp) continue;
    const same = state.picked.find((x) => x !== pick &&
      (x.name.toLowerCase() === name.toLowerCase() || x.category === comp.category));
    if (same) {
      if (same.auto && !same.parents.includes(pick.uid)) same.parents.push(pick.uid);
      continue;
    }
    addPick(comp, false, pick);
  }
}

// Unmark a procedure, and any procedure that was marked automatically only because of it.
function removePick(p, render = true) {
  state.picked = state.picked.filter((x) => x !== p);
  for (const x of state.picked) x.parents = x.parents.filter((u) => u !== p.uid);
  state.picked = state.picked.filter((x) => !(x.auto && !x.parents.length));
  if (!state.picked.some((x) => x.uid === state.mainUid)) state.mainUid = null;
  if (render) renderPicked();
}

// How "major" a procedure is. Presets carry their own weight; anything else gets its category's.
function weightOf(p) {
  if (!p.category) return -1;
  const known = state.procByName && state.procByName.get(p.name.toLowerCase());
  if (known && known.weight !== undefined && known.category === p.category) return known.weight;
  return state.catByKey[p.category].weight;
}

// Add one logged operation to a map of category counts.
function addCase(map, c) {
  const p = map[c.category];
  if (!p) return;
  const age = c.age === "" || c.age === null || c.age === undefined ? null : Number(c.age);
  const child = c.child !== undefined ? c.child : age !== null && age < state.meta.syllabus.child_age_limit;
  p.total_done += 1;
  if (c.role === "primary") p.primary_done += 1;
  for (const s of p.sub) {
    if (s.kind === "children" && child) s.done += 1;
    if (s.kind === "minimally_invasive" && (c.approach === "lap" || c.approach === "robotic")) s.done += 1;
  }
}

// Would logging this procedure, with this role and patient age, bring its syllabus targets
// closer? False once those targets are met: an assistant case when only primary-surgeon cases
// are missing, or an adult case when only the children quota is left, also counts as met.
function stillNeeded(pick, counts, role, age) {
  const cat = state.catByKey[pick.category];
  const before = cat && counts[pick.category];
  if (!before) return false;
  const after = { total_done: before.total_done, primary_done: before.primary_done, sub: before.sub.map((x) => ({ ...x })) };
  addCase({ [pick.category]: after }, { category: pick.category, role, age, approach: pick.approach });
  return remaining(cat, after) < remaining(cat, before);
}

function formAge() {
  const v = $("#f-age").value.trim().replace(",", ".");
  return /^\d{1,3}(\.\d)?$/.test(v) ? Number(v) : null;
}

// Marked procedures, most significant first (the first marked wins a tie), each flagged with
// whether its category still needs this case. Before progress has loaded, every one counts as needed.
function rankPicks() {
  const counts = currentCounts();
  const age = formAge();
  return state.picked
    .map((p, i) => ({ p, i, w: weightOf(p), needed: counts ? stillNeeded(p, counts, state.role, age) : !!p.category }))
    .sort((a, b) => b.w - a.w || a.i - b.i);
}

// The procedure an operation counts as: the user's choice if they made one, otherwise the most
// significant marked procedure whose syllabus targets aren't met yet (TURBT + cystoscopy -> TURBT,
// or cystoscopy once the TURBT targets are met). If every one is met, the most significant.
function mainPick(ranked = rankPicks()) {
  const chosen = state.picked.find((p) => p.uid === state.mainUid);
  if (chosen) return chosen;
  if (!ranked.length) return null;
  return (ranked.find((r) => r.needed) || ranked[0]).p;
}

function pickItem(p, kind, needed) {
  const cat = state.catByKey[p.category];
  const full = needed === false && state.progress;
  let sub;
  if (!cat) sub = "New procedure";
  else if (kind === "main") sub = `Counts as ${cat.en}${full ? ". Target already met" : ""}`;
  else if (kind === "extra") sub = full ? "Target met, not counted" : "Included, not counted";
  else sub = `${cat.en}${full ? ". Target already met" : ""}`;
  const parents = p.auto ? state.picked.filter((x) => p.parents.includes(x.uid)).map((x) => x.name) : [];
  if (parents.length) sub = `Added with ${parents.join(" and ")}. ${sub}`;
  const li = h("li", { class: `pick${kind === "extra" ? " extra" : ""}` },
    h("div", {},
      h("span", { class: "pick-name" }, p.name),
      h("span", { class: "pick-cat" }, sub)),
    kind === "extra" && cat
      ? h("button", {
        type: "button",
        class: "count-this",
        "aria-label": `Count this operation as ${p.name} instead`,
        onclick: () => {
          state.mainUid = p.uid;
          renderPicked();
        },
      }, "Count this")
      : h("span", {}),
    h("button", {
      type: "button",
      class: "remove",
      "aria-label": `Remove ${p.name}`,
      onclick: () => removePick(p),
    }, "×"));
  if (!cat) {
    const sel = h("select", { "aria-label": `Syllabus category for ${p.name}` }, ...categoryOptions(true));
    sel.addEventListener("change", () => {
      p.category = sel.value;
      renderPicked();
    });
    li.append(sel);
  } else if (p.category === "kidney" && kind !== "extra") {
    const opts = [["open", "Open"], ["lap", "Laparoscopic"], ["robotic", "Robotic"]];
    li.append(h("div", { class: "seg", role: "group", "aria-label": `Approach for ${p.name}` },
      ...opts.map(([v, label]) => h("button", {
        type: "button",
        "aria-pressed": String(p.approach === v),
        onclick: () => {
          p.approach = v;
          renderPicked();
        },
      }, label))));
  }
  return li;
}

function renderPicked() {
  const list = $("#picked");
  const ranked = rankPicks();
  const needed = new Map(ranked.map((r) => [r.p, r.needed]));
  const main = mainPick(ranked);
  if (state.picked.length < 2) {
    list.replaceChildren(...state.picked.map((p) => pickItem(p, "single", needed.get(p))));
  } else {
    list.replaceChildren(
      pickItem(main, "main", needed.get(main)),
      ...ranked.filter((r) => r.p !== main).map((r) => pickItem(r.p, "extra", r.needed)));
  }
  $("#picked-hint").hidden = state.picked.length < 2;
  renderQuickPicks();
}

function setRole(role) {
  state.role = role;
  $$("#role-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.role === role)));
  renderPicked();
}

function setDate(mode) {
  if (mode === todayISO()) mode = "today";
  if (mode === yesterdayISO()) mode = "yesterday";
  state.date = mode;
  $$("#date-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.date === mode)));
  const other = mode !== "today" && mode !== "yesterday";
  $("#date-other").classList.toggle("on", other);
  $("#date-other-text").textContent = other
    ? new Date(mode + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : "Other day";
  if (!other) $("#log-date").value = "";
}

/* search */

// Search results: best matches first, and among equally good matches the ones you use most.
function searchProcedures(raw) {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const usage = new Map(Object.entries(state.meta.usage || {}).map(([n, v]) => [n.toLowerCase(), v]));
  const used = (p) => usage.get(p.name.toLowerCase()) || 0;
  return state.procedures
    .map((p) => {
      const cat = state.catByKey[p.category];
      const name = p.name.toLowerCase();
      const hay = `${name} ${cat.en.toLowerCase()} ${cat.he}`;
      if (!words.every((w) => hay.includes(w))) return null;
      let score = 0;
      if (name.startsWith(q)) score += 4;
      else if (name.includes(q)) score += 2;
      if (name.split(/[\s,()+/-]+/).some((t) => t.startsWith(words[0]))) score += 1;
      return { p, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || used(b.p) - used(a.p) || a.p.name.localeCompare(b.p.name))
    .slice(0, 12)
    .map((x) => x.p);
}

function renderResults() {
  const input = $("#proc-search");
  const list = $("#proc-results");
  const q = input.value.trim();
  if (!q) {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }
  const found = searchProcedures(q);
  const items = found.map((p) => ({ p, label: p.name, sub: state.catByKey[p.category].en }));
  if (!found.some((p) => p.name.toLowerCase() === q.toLowerCase())) {
    items.push({ p: { name: q, category: "", approach: "" }, label: `Add "${q}" as a new procedure`, sub: "You'll choose its syllabus category", add: true });
  }
  state.resultIndex = Math.min(state.resultIndex, items.length - 1);
  list.replaceChildren(
    ...items.map((it, i) =>
      h("li", {
        role: "option",
        id: `res-${i}`,
        class: it.add ? "add-new" : null,
        "aria-selected": String(i === state.resultIndex),
        onmousedown: (e) => e.preventDefault(),
        onclick: () => chooseResult(it.p),
      }, h("span", {}, it.label), h("small", {}, it.sub))
    )
  );
  list._items = items;
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  if (state.resultIndex >= 0) input.setAttribute("aria-activedescendant", `res-${state.resultIndex}`);
  else input.removeAttribute("aria-activedescendant");
}

function chooseResult(p) {
  addPick(p);
  const input = $("#proc-search");
  input.value = "";
  state.resultIndex = -1;
  renderResults();
  if (coarse) input.blur();
  else input.focus();
}

function searchKeys(e) {
  const list = $("#proc-results");
  const items = list._items || [];
  if (e.key === "ArrowDown") {
    e.preventDefault();
    state.resultIndex = Math.min(state.resultIndex + 1, items.length - 1);
    renderResults();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    state.resultIndex = Math.max(state.resultIndex - 1, 0);
    renderResults();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const it = items[state.resultIndex >= 0 ? state.resultIndex : 0];
    if (it && !list.hidden) chooseResult(it.p);
  } else if (e.key === "Escape") {
    $("#proc-search").value = "";
    renderResults();
  }
}

/* save */

function readPatient() {
  return {
    record_no: $("#f-record").value.trim(),
    initials: $("#f-initials").value.trim().toUpperCase(),
    age: $("#f-age").value.trim().replace(",", "."),
  };
}

function fillPatient(p) {
  $("#f-record").value = p.record_no || "";
  $("#f-initials").value = p.initials || "";
  $("#f-age").value = p.age || "";
}

// Clear the form for the next case. Every new case starts as primary surgeon.
function resetLogForm() {
  state.picked = [];
  state.mainUid = null;
  setRole("primary");
  fillPatient({});
  $("#f-notes").value = "";
  setDate("today");
}

// Fewest further cases that would meet every target in the category: primary cases and
// "in children" / laparoscopic cases also count toward the total, so take the largest gap.
function remaining(cat, p) {
  let left = Math.max(0, cat.total - p.total_done, cat.primary - p.primary_done);
  for (const s of p.sub) left = Math.max(left, s.n - s.done);
  return left;
}

// Share of all syllabus targets met, counted the way the NAS does.
function overallShare(byKey) {
  let got = 0;
  let need = 0;
  for (const cat of state.meta.syllabus.categories) {
    const p = byKey[cat.key];
    got += Math.min(p.total_done, cat.total) + Math.min(p.primary_done, cat.primary);
    need += cat.total + cat.primary;
    for (const s of p.sub) {
      got += Math.min(s.done, s.n);
      need += s.n;
    }
  }
  return need ? got / need : 0;
}

function categoryRow(cat, p) {
  const left = remaining(cat, p);
  const pct = (n) => `${Math.min(100, (n / cat.total) * 100)}%`;
  const all = h("i", { class: "bar-all" });
  const prim = h("i", { class: "bar-primary" });
  const bar = h("div", {
    class: "bar",
    role: "img",
    "aria-label": `${p.total_done} of ${cat.total} logged` +
      (cat.primary ? `, ${p.primary_done} of ${cat.primary} as primary surgeon` : ""),
  }, all, prim);
  if (cat.primary && cat.primary < cat.total) {
    const tick = h("i", { class: "bar-target" });
    tick.style.left = `calc(${(cat.primary / cat.total) * 100}% - 1px)`;
    bar.append(tick);
  }
  requestAnimationFrame(() => {
    all.style.width = pct(p.total_done);
    prim.style.width = pct(p.primary_done);
  });

  const meta = [];
  if (cat.primary) {
    const ok = p.primary_done >= cat.primary;
    meta.push(h("span", { class: ok ? "ok" : "short" }, `Primary ${p.primary_done} of ${cat.primary}`));
  }
  for (const s of p.sub) {
    meta.push(h("span", { class: s.done >= s.n ? "ok" : "short" }, `${capitalize(s.en)} ${s.done} of ${s.n}`));
  }
  meta.push(h("span", { class: left ? null : "ok" }, left ? `${plural(left, "more case", "more cases")} needed` : "Target met"));

  return h("button", {
    type: "button",
    class: `cat${left ? "" : " done"}`,
    onclick: () => showCasesFor(cat.key),
  },
  h("div", { class: "cat-head" },
    h("span", { class: "cat-name" }, cat.en, he(cat.he)),
    h("span", { class: "cat-count" }, h("b", {}, p.total_done), h("span", {}, ` / ${cat.total}`))),
  bar,
  h("p", { class: "cat-meta" }, ...meta));
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function loadCases(append = false) {
  const c = state.cases;
  const params = new URLSearchParams({ limit: "100", offset: String(append ? c.items.length : 0) });
  if (c.q) params.set("q", c.q);
  if (c.incomplete) params.set("incomplete", "1");
  if (c.category) params.set("category", c.category);
  try {
    const r = await api(`/api/cases?${params}`);
    c.items = append ? c.items.concat(r.cases) : r.cases;
    c.total = r.total;
    c.stale = false;
  } catch (ex) {
    toast(ex.message);
  }
  renderCases();
}

function caseRow(c) {
  const cat = state.catByKey[c.category];
  const noAge = c.age === null || c.age === undefined || c.age === "";
  const parts = [];
  if (c.record_no) parts.push(`Rec. ${c.record_no}`);
  if (c.initials) parts.push(c.initials);
  if (!noAge) parts.push(`age ${Number(c.age)}`);
  if (c.attending) parts.push(`with ${c.attending}`);
  const line2 = capitalize(parts.join(", "));
  const warn = [];
  if (!c.record_no && !c.initials) warn.push("record no. or initials");
  if (noAge) warn.push("age");
  return h("li", {},
    h("button", {
      type: "button",
      class: "case",
      onclick: () => openEdit(c),
    },
    h("span", { class: "case-title" }, c.procedure),
    h("span", { class: `case-role ${c.role}` }, c.role === "primary" ? "Primary" : "Assistant"),
    h("span", { class: "case-sub" }, cat ? cat.en : c.category),
    alsoNames(c).length ? h("span", { class: "case-sub" }, `Also: ${alsoNames(c).join(", ")}`) : null,
    h("span", { class: "case-sub" }, line2,
      warn.length ? h("span", { class: "warn" }, `${line2 ? ". " : ""}Missing ${warn.join(" and ")}`) : null)));
}

function alsoNames(c) {
  return (c.also || []).map((a) => (typeof a === "string" ? a : a.procedure));
}

function renderCases() {
  const c = state.cases;
  const box = $("#cases-list");
  box.replaceChildren();
  $("#cases-count").textContent = `${plural(c.total, "case", "cases")}${c.q || c.incomplete || c.category ? " match" : " logged"}`;
  if (!c.items.length) {
    box.append(h("p", { class: "empty" },
      c.q || c.incomplete || c.category ? "No cases match." : "No cases yet. Log your first one from the Log tab."));
  }
  let day = null;
  let list = null;
  for (const x of c.items) {
    if (x.date !== day) {
      day = x.date;
      box.append(h("h2", { class: "day" }, formatDay(day)));
      list = h("ol", { class: "case-list" });
      box.append(list);
    }
    list.append(caseRow(x));
  }
  $("#cases-more").hidden = c.items.length >= c.total;
  const cat = state.catByKey[c.category];
  $("#cases-cat-filter").hidden = !cat;
  $("#cases-cat-label").textContent = cat ? `Only ${cat.en}` : "";
}

function showCasesFor(key) {
  state.cases.category = key;
  state.cases.incomplete = false;
  state.cases.q = "";
  $("#cases-q").value = "";
  $("#cases-incomplete").checked = false;
  state.cases.stale = true;
  go("cases");
}

/* edit */

function openEdit(c) {
  state.editing = c;
  $("#e-date").value = c.date;
  $("#e-procedure").value = c.procedure;
  $("#e-category").value = c.category;
  $("#e-also").value = alsoNames(c).join("\n");
  setEditRole(c.role);
  $("#e-approach").value = c.approach || "";
  $("#e-record").value = c.record_no || "";
  $("#e-initials").value = c.initials || "";
  $("#e-age").value = c.age === null || c.age === undefined ? "" : String(Number(c.age));
  $("#e-attending").value = c.attending || "";
  $("#e-site").value = c.site || "";
  $("#e-notes").value = c.notes || "";
  $("#edit-error").textContent = "";
  $("#edit-dialog").showModal();
  // Most edits fill in a missing patient detail, so start there.
  if (!c.record_no && !c.initials) $("#e-record").focus();
  else if (c.age === null || c.age === undefined) $("#e-age").focus();
  else $("#edit-title").focus();
}

function setEditRole(role) {
  state.editRole = role;
  $$("#e-role button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.role === role)));
}

async function saveEdit(e) {
  e.preventDefault();
  const c = state.editing;
  const body = {
    date: $("#e-date").value,
    procedure: $("#e-procedure").value.trim(),
    category: $("#e-category").value,
    also: $("#e-also").value.split("\n").map((x) => x.trim()).filter(Boolean),
    role: state.editRole,
    approach: $("#e-approach").value,
    record_no: $("#e-record").value.trim(),
    initials: $("#e-initials").value.trim().toUpperCase(),
    age: $("#e-age").value.trim().replace(",", "."),
    attending: $("#e-attending").value.trim(),
    site: $("#e-site").value.trim(),
    notes: $("#e-notes").value.trim(),
  };
  if (!body.procedure) return ($("#edit-error").textContent = "Enter the procedure name.");
  try {
    await api(`/api/cases/${c.id}`, { method: "PUT", body });
    $("#edit-dialog").close();
    toast("Changes saved.");
    afterChange(true);
    loadCases();
  } catch (ex) {
    $("#edit-error").textContent = ex.message;
  }
}

async function deleteCase() {
  const c = state.editing;
  if (!window.confirm(`Delete ${c.procedure} on ${formatDay(c.date)}? This can't be undone, and it's deleted on your other devices too.`)) return;
  try {
    await api(`/api/cases/${c.id}`, { method: "DELETE" });
    $("#edit-dialog").close();
    toast("Case deleted.");
    afterChange(true);
    loadCases();
  } catch (ex) {
    $("#edit-error").textContent = ex.message;
  }
}

async function importCsv() {
  const file = $("#import-file").files[0];
  if (!file) return;
  const out = $("#import-result");
  out.textContent = "Importing…";
  try {
    const r = await L.importCsv(await file.text());
    let msg = `Imported ${plural(r.imported, "case", "cases")}.`;
    if (r.skipped) msg += ` Skipped ${r.skipped} already in the log.`;
    if (r.error_count) msg += ` ${plural(r.error_count, "row", "rows")} had problems: ${r.errors.slice(0, 3).join(" ")}`;
    out.textContent = msg;
    afterChange(true);
  } catch (ex) {
    out.textContent = ex.message;
  } finally {
    $("#import-file").value = "";
  }
}

async function saveName() {
  try {
    await api("/api/settings", { method: "PUT", body: { resident_name: $("#set-name").value.trim() } });
    toast("Name saved.");
  } catch (ex) {
    toast(ex.message);
  }
}

const VIEWS = ["log", "progress", "cases", "more", "guide"];

function go(view) {
  if (location.hash !== `#${view}`) location.hash = view;
  else route();
}

function route() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "log";
  state.view = view;
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  $$(".tabs button").forEach((b) => {
    if (b.dataset.view === view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0 });
  if (view === "progress") {
    if (state.progressStale || !state.progress) loadProgress();
    else renderProgress();
  }
  if (view === "more") renderSync();
  if (view === "cases") {
    if (state.cases.stale) loadCases();
    else renderCases();
  }
}

function savePrefs(patch) {
  store(PREFS_KEY, { ...load(PREFS_KEY, {}), ...patch });
}

// Counts per syllabus category, from this device's cases.
function currentCounts() {
  if (!state.progress) return null;
  const map = {};
  for (const c of state.progress.categories) {
    map[c.key] = { total_done: c.total_done, primary_done: c.primary_done, sub: c.sub.map((x) => ({ ...x })) };
  }
  return map;
}

async function saveCase(e) {
  e.preventDefault();
  if (!state.picked.length) {
    toast("Pick at least one procedure.");
    $("#proc-search").focus();
    return;
  }
  const noCat = state.picked.find((p) => !p.category);
  if (noCat) {
    toast(`Choose a syllabus category for ${noCat.name}.`);
    return;
  }
  const patient = readPatient();
  if (patient.age && !/^\d{1,3}(\.\d)?$/.test(patient.age)) {
    toast("Age should be in years, like 64 or 0.5.");
    $("#f-age").focus();
    return;
  }
  const date = caseDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    toast("Choose a date.");
    return;
  }
  const main = mainPick();
  const others = state.picked.filter((p) => p !== main);
  const site = $("#f-site").value.trim();
  const payload = {
    client_uid: L.randomId(),
    date,
    ...patient,
    role: state.role,
    procedure: main.name,
    category: main.category,
    approach: main.approach,
    also: others.map((p) => ({ procedure: p.name, category: p.category, approach: p.approach })),
    attending: $("#f-attending").value.trim(),
    site,
    notes: $("#f-notes").value.trim(),
  };
  try {
    await api("/api/cases", { method: "POST", body: payload });
  } catch (ex) {
    toast(ex.message);
    return;
  }
  savePrefs({ site });
  resetLogForm();
  window.scrollTo({ top: 0 });
  const missing = (!patient.record_no && !patient.initials) || !patient.age;
  const what = main.name + (others.length ? ` with ${others.map((p) => p.name).join(", ")}` : "");
  toast(`Saved ${what}.` + (missing ? " Add the missing patient details in Cases." : ""), "Same patient", () => {
    fillPatient(patient);
    $("#proc-search").focus();
  });
  afterChange();
}

// Something changed (here, or arriving from another device): refresh what's on screen.
function afterChange() {
  state.cases.stale = true;
  loadMeta();
  loadProgress();
  if (state.view === "cases") loadCases();
}

function loadProgress() {
  state.progress = L.progress();
  state.progressStale = false;
  renderProgress();
  renderPicked();
}

function renderProgress() {
  const pr = state.progress;
  const syl = state.meta.syllabus;
  const byKey = currentCounts();
  $("#overall-pct").textContent = `${Math.floor(overallShare(byKey) * 100)}%`;
  $("#overall-cases").textContent = `${plural(pr.total_cases, "procedure", "procedures")} logged`;
  const notice = $("#incomplete-notice");
  notice.hidden = !pr.incomplete;
  notice.textContent = `${plural(pr.incomplete, "case is", "cases are")} missing a record no., initials or age`;
  const board = $("#board");
  board.replaceChildren();
  for (const [gkey, g] of Object.entries(syl.groups)) {
    let cats = syl.categories.filter((c) => c.group === gkey);
    if (state.sort === "todo") {
      cats = cats.slice().sort((a, b) => remaining(b, byKey[b.key]) / b.total - remaining(a, byKey[a.key]) / a.total);
    }
    board.append(h("h2", { class: "group-title" }, g.en, he(g.he)));
    for (const cat of cats) board.append(categoryRow(cat, byKey[cat.key]));
  }
}

/* ---------------------------------------------------------------- files */

// Save a file. Phones offer their share sheet (email, Drive, WhatsApp); computers download it.
async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function exportIma() {
  const from = $("#exp-from").value || undefined;
  const to = $("#exp-to").value || undefined;
  const rows = L.rowsForExport({ from, to });
  const blob = imaWorkbook(rows, L.progress({ from, to }), L.getKv("resident_name", ""), from, to);
  saveFile(blob, `case-log-IMA-${todayISO()}.xlsx`);
}

function exportCsv() {
  saveFile(new Blob([L.exportCsv()], { type: "text/csv" }), `case-log-backup-${todayISO()}.csv`);
}

/* ----------------------------------------------------------------- sync */

const ago = (t) => {
  if (!t) return "never";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

function renderSync() {
  const st = Sync.getStatus();
  const ready = Sync.relayReady();
  $("#sync-off").hidden = st.paired || !ready;
  $("#sync-on").hidden = !st.paired;
  $("#sync-unset").hidden = ready || st.paired;
  if (st.paired) {
    $("#sync-state").textContent = st.state === "syncing" ? "Syncing…"
      : st.state === "error" ? st.error : `Paired. Last synced ${ago(st.last_ok)}.`;
    $("#sync-state").classList.toggle("error", st.state === "error");
  }
  updateBanner(st);
}

// A sync problem that lasts shows at the top of every screen.
function updateBanner(st = Sync.getStatus()) {
  const b = $("#sync-banner");
  const stale = st.paired && st.state === "error" && (!st.last_ok || Date.now() - st.last_ok > 3 * 86400000);
  b.hidden = !stale;
  if (stale) b.textContent = `Not synced since ${ago(st.last_ok)}. ${st.error} Tap to try again.`;
}

function drawQr(canvas, text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const size = 264;
  const cell = Math.floor(size / (n + quiet * 2));
  canvas.width = canvas.height = cell * (n + quiet * 2);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
}

function showPairing() {
  const link = Sync.pairingLink();
  drawQr($("#qr-canvas"), link);
  $("#pair-code").value = link;
  $("#show-dialog").showModal();
}

async function startSync() {
  if (!window.confirm("Turn on sync for this device? Then pair your other device by scanning the code shown next.")) return;
  const r = await Sync.createPairing();
  renderSync();
  if (r && r.error) toast(r.error);
  showPairing();
}

let scanStream = null;
let scanTimer = null;

function stopScan() {
  clearInterval(scanTimer);
  if (scanStream) scanStream.getTracks().forEach((t) => t.stop());
  scanStream = null;
}

async function openJoin() {
  $("#join-error").textContent = "";
  $("#join-input").value = "";
  $("#join-dialog").showModal();
  const video = $("#scan-video");
  $("#scan-box").hidden = true;
  if (!navigator.mediaDevices || !window.jsQR) return;
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch (_) {
    $("#join-error").textContent = "No camera access. Paste the code instead.";
    return;
  }
  video.srcObject = scanStream;
  $("#scan-box").hidden = false;
  await video.play().catch(() => {});
  const canvas = document.createElement("canvas");
  scanTimer = setInterval(() => {
    if (!video.videoWidth) return;
    const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
    if (code && Sync.parsePairing(code.data)) {
      stopScan();
      join(code.data);
    }
  }, 250);
}

async function join(input) {
  if (!Sync.parsePairing(input)) {
    $("#join-error").textContent = "That isn't a Case Log pairing code. Copy the whole code, or scan the QR code again.";
    return;
  }
  stopScan();
  $("#join-dialog").close();
  toast("Paired. Syncing…");
  const r = await Sync.joinPairing(input);
  renderSync();
  afterChange();
  toast(r && r.error ? r.error : `Synced. ${plural(r.received || 0, "case", "cases")} received from your other device.`);
}

async function unpair() {
  if (!window.confirm("Stop syncing on this device? Its cases stay here; your other device keeps its own.")) return;
  await Sync.unpair();
  renderSync();
  toast("Sync is off on this device.");
}

// Opened from a pairing link (Android camera apps open these straight in the browser).
async function pairFromLink() {
  const p = Sync.parsePairing(location.hash);
  if (!p) return;
  history.replaceState(null, "", location.pathname + "#log");
  if (Sync.isPaired()) {
    toast("This device is already paired.");
    return;
  }
  if (window.confirm("Pair this device with your other device and sync your cases?")) await join(`#pair=${p.code}&relay=${encodeURIComponent(p.relay)}`);
}

/* ------------------------------------------------------------------- guide */

const GUIDE_LANG_KEY = "caselog.guideLang";

function setGuideLang(lang) {
  $("#guide-en").hidden = lang !== "en";
  $("#guide-he").hidden = lang !== "he";
  $("#view-guide").setAttribute("aria-labelledby", `guide-title-${lang}`);
  $$(".guide-lang button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  store(GUIDE_LANG_KEY, lang);
}

function initialGuideLang() {
  const saved = load(GUIDE_LANG_KEY, "");
  if (saved === "en" || saved === "he") return saved;
  return (navigator.languages || [navigator.language]).some((l) => /^(he|iw)\b/i.test(l || "")) ? "he" : "en";
}

// Opening the bare link in a browser shows the guide to someone new. The installed app, and anyone
// already using Case Log on this device, goes straight to the log.
function firstView() {
  const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const inUse = Sync.isPaired() || L.allRecords().some((r) => !r.deleted);
  return installed || inUse ? "log" : "guide";
}

/* -------------------------------------------------------------------- boot */

function bind() {
  $("#log-form").addEventListener("submit", saveCase);
  $$("#role-seg button").forEach((b) => b.addEventListener("click", () => setRole(b.dataset.role)));
  $$("#date-seg button").forEach((b) => b.addEventListener("click", () => setDate(b.dataset.date)));
  $("#log-date").addEventListener("change", (e) => {
    if (e.target.value) setDate(e.target.value);
    else setDate("today");
  });
  $("#log-date").addEventListener("click", (e) => {
    try {
      if (e.target.showPicker) e.target.showPicker();
    } catch (_) { /* the native control opens on its own */ }
  });
  const search = $("#proc-search");
  search.addEventListener("input", () => {
    state.resultIndex = -1;
    renderResults();
  });
  search.addEventListener("keydown", searchKeys);
  search.addEventListener("blur", () => setTimeout(() => {
    if (document.activeElement !== search) {
      $("#proc-results").hidden = true;
      search.setAttribute("aria-expanded", "false");
    }
  }, 150));
  search.addEventListener("focus", renderResults);
  $("#f-attending").addEventListener("input", renderAttendingChips);
  $("#f-age").addEventListener("input", () => {
    if (state.picked.length) renderPicked(); // the children quota depends on age
  });
  $("#f-initials").addEventListener("input", (e) => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(pos, pos);
  });

  $$(".tabs button").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
  $$(".guide-lang button").forEach((b) => b.addEventListener("click", () => setGuideLang(b.dataset.lang)));
  $$(".guide-start").forEach((b) => b.addEventListener("click", () => go("log")));
  $("#open-guide").addEventListener("click", () => go("guide"));
  window.addEventListener("hashchange", () => (/[#&]pair=/.test(location.hash) ? pairFromLink() : route()));

  $$("#sort-seg button").forEach((b) => b.addEventListener("click", () => {
    state.sort = b.dataset.sort;
    savePrefs({ sort: state.sort });
    $$("#sort-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    if (state.progress) renderProgress();
  }));
  $("#incomplete-notice").addEventListener("click", () => {
    state.cases.incomplete = true;
    state.cases.category = "";
    $("#cases-incomplete").checked = true;
    state.cases.stale = true;
    go("cases");
  });

  let qTimer = null;
  $("#cases-q").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.cases.q = e.target.value.trim();
      loadCases();
    }, 250);
  });
  $("#cases-incomplete").addEventListener("change", (e) => {
    state.cases.incomplete = e.target.checked;
    loadCases();
  });
  $("#cases-cat-clear").addEventListener("click", () => {
    state.cases.category = "";
    loadCases();
  });
  $("#cases-more").addEventListener("click", () => loadCases(true));

  $("#edit-form").addEventListener("submit", saveEdit);
  $("#e-cancel").addEventListener("click", () => $("#edit-dialog").close());
  $("#e-delete").addEventListener("click", deleteCase);
  $$("#e-role button").forEach((b) => b.addEventListener("click", () => setEditRole(b.dataset.role)));
  $("#e-procedure").addEventListener("change", (e) => {
    const p = state.procedures.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
    if (p) {
      $("#e-category").value = p.category;
      $("#e-approach").value = p.approach || "";
    }
  });

  $("#exp-ima").addEventListener("click", exportIma);
  $("#exp-csv").addEventListener("click", exportCsv);
  $("#import-file").addEventListener("change", importCsv);
  $("#set-name-save").addEventListener("click", saveName);

  $("#sync-start").addEventListener("click", startSync);
  $("#sync-join").addEventListener("click", openJoin);
  $("#sync-show").addEventListener("click", showPairing);
  $("#sync-now").addEventListener("click", async () => {
    const r = await Sync.syncNow();
    toast(r && r.error ? r.error : "Synced.");
  });
  $("#sync-unpair").addEventListener("click", unpair);
  $("#sync-banner").addEventListener("click", () => Sync.syncNow());
  $("#copy-code").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#pair-code").value);
      toast("Code copied. Paste it into Case Log on your other device.");
    } catch (_) {
      $("#pair-code").select();
    }
  });
  $("#show-close").addEventListener("click", () => $("#show-dialog").close());
  $("#join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    join($("#join-input").value);
  });
  $("#join-cancel").addEventListener("click", () => {
    stopScan();
    $("#join-dialog").close();
  });
  $("#join-dialog").addEventListener("close", stopScan);
}

async function init() {
  const prefs = load(PREFS_KEY, {});
  state.sort = prefs.sort === "todo" ? "todo" : "syllabus";
  bind();
  $$("#role-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.role === state.role)));
  $$("#sort-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === state.sort)));
  if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch(() => {});
  try {
    await L.open();
  } catch (ex) {
    $("#boot").textContent = `Case Log can't store data in this browser: ${ex.message}`;
    return;
  }
  $("#boot").hidden = true;
  $("#shell").hidden = false;
  await loadMeta();
  loadProgress();
  setGuideLang(initialGuideLang());
  if (!location.hash || location.hash === "#") history.replaceState(null, "", `${location.pathname}#${firstView()}`);
  route();
  Sync.onStatus(() => {
    if (state.view === "more") renderSync();
    else updateBanner();
  });
  L.onChange(({ local }) => {
    if (!local) afterChange(); // cases arrived from another device
  });
  Sync.start();
  if (/[#&]pair=/.test(location.hash)) pairFromLink();
}

init();
