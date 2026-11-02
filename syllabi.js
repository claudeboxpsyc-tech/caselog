// The syllabi Case Log can track, in one shape, and the counting rules shared by storage and screens.
//
// Each category has `targets`: how many cases each column needs. Which columns a case counts
// toward depends on the resident's role in it (`role_counts`); every case also counts toward
// "total". `sub` lists extra "of which" requirements (laparoscopic, open, in children, recurrent...).

import { SYLLABUS as URO } from "./syllabus.js";
import { GS2022 } from "./gs2022.js";
import { GS2008 } from "./gs2008.js";

const UROLOGY = {
  ...URO,
  id: "uro2022",
  short_en: "Urology 2022",
  short_he: "אורולוגיה 2022",
  pick_en: "Urology, 2022 syllabus (version 2.0)",
  pick_note: "Urological surgery, including the general surgery rotation.",
  title_he: "רשימה מסכמת של הניתוחים הנדרשים בכירורגיה אורולוגית",
  version_he: "על פי סילבוס ההתמחות משנת 2022, גרסה 2.0",
  specialty_he: "כירורגיה אורולוגית",
  per_operation: 1,
  roles: [
    { key: "primary", en: "Primary surgeon", long: "Primary surgeon", he: "מנתח ראשי" },
    { key: "assistant", en: "Assistant", long: "Assistant", he: "עוזר" },
  ],
  columns: [
    { key: "total", en: "All roles", short: "Total", he: "מספר ניתוחים" },
    { key: "primary", en: "As primary surgeon", short: "Primary", he: "מתוכם כמנתח ראשי" },
  ],
  role_counts: { primary: ["primary"], assistant: [] },
  categories: URO.categories.map((c) => ({
    ...c,
    targets: { total: c.total, ...(c.primary ? { primary: c.primary } : {}) },
    ask_approach: c.key === "kidney",
  })),
  overall: [],
  per_year: null,
};

export const SYLLABI = { uro2022: UROLOGY, gs2022: GS2022, gs2008: GS2008 };
export const SYLLABUS_ORDER = ["uro2022", "gs2022", "gs2008"];
export const DEFAULT_ID = "uro2022";

export const roleLabel = (S, key) => (S.roles.find((r) => r.key === key) || { en: key }).en;
export const roleHe = (S, key) => (S.roles.find((r) => r.key === key) || { he: key }).he;

// Tags of a procedure (e.g. "recurrent"), from the syllabus's own procedure list.
export function tagIndex(S) {
  return new Map(S.presets.filter((p) => p.tags).map((p) => [p.name.toLowerCase(), p.tags]));
}

// Which target columns a case counts toward.
export function columnsFor(S, cat, role) {
  if (cat.any_role) return Object.keys(cat.targets).filter((k) => k !== "total");
  return S.role_counts[role] || [];
}

export function emptyCounts(S) {
  return Object.fromEntries(S.categories.map((c) => [c.key, {
    cols: Object.fromEntries(["total", ...S.columns.map((x) => x.key)].map((k) => [k, 0])),
    sub: (c.sub || []).map((s) => ({ ...s, done: 0 })),
  }]));
}

const isLap = (a) => a === "lap" || a === "robotic";

// Add one case to a map of category counts. `rec` has category, role, approach, age, procedure.
export function addCase(S, counts, rec, tags = tagIndex(S)) {
  const p = counts[rec.category];
  const cat = S.categories.find((c) => c.key === rec.category);
  if (!p || !cat) return;
  const cols = columnsFor(S, cat, rec.role);
  p.cols.total += 1;
  for (const k of cols) p.cols[k] = (p.cols[k] || 0) + 1;
  const asPrimary = cols.includes("primary");
  const age = rec.age === "" || rec.age === null || rec.age === undefined ? null : Number(rec.age);
  const child = S.child_age_limit && age !== null && age < S.child_age_limit;
  const procTags = tags.get(String(rec.procedure || "").toLowerCase()) || [];
  for (const s of p.sub) {
    if (s.primary_only && !asPrimary) continue;
    if ((s.kind === "children" && child) ||
        ((s.kind === "minimally_invasive" || s.kind === "lap") && isLap(rec.approach)) ||
        (s.kind === "open" && rec.approach === "open") ||
        (s.kind === "tag" && procTags.includes(s.tag))) s.done += 1;
  }
}

export function countCases(S, rows) {
  const counts = emptyCounts(S);
  const tags = tagIndex(S);
  for (const r of rows) addCase(S, counts, r, tags);
  return counts;
}

// Fewest further cases that would meet every target in the category. A case in a narrower
// column (primary) also counts toward the total, so take the largest gap.
export function remaining(cat, p) {
  let left = 0;
  for (const [k, n] of Object.entries(cat.targets)) left = Math.max(left, n - (p.cols[k] || 0));
  for (const s of p.sub) left = Math.max(left, s.n - s.done);
  return left;
}

// Targets met / targets needed, for one category (capped per target).
export function share(cat, p) {
  let got = 0;
  let need = 0;
  for (const [k, n] of Object.entries(cat.targets)) {
    got += Math.min(p.cols[k] || 0, n);
    need += n;
  }
  for (const s of p.sub) {
    got += Math.min(s.done, s.n);
    need += s.n;
  }
  return { got, need };
}

export function overallShare(S, counts, overallDone = []) {
  let got = 0;
  let need = 0;
  for (const cat of S.categories) {
    const s = share(cat, counts[cat.key]);
    got += s.got;
    need += s.need;
  }
  for (const o of overallDone) {
    got += Math.min(o.done, o.n);
    need += o.n;
  }
  return need ? got / need : 0;
}

// Residency year (1 = first) of a case date, from the residency start date.
export function residencyYear(start, date) {
  if (!start || !date || date < start) return null;
  const [y0, m0, d0] = start.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  let years = y - y0;
  if (m < m0 || (m === m0 && d < d0)) years -= 1;
  return years + 1;
}

// Syllabus-wide targets (laparoscopic tiers, resident-instructor) and per-year counts.
export function extras(S, rows, start) {
  const cats = Object.fromEntries(S.categories.map((c) => [c.key, c]));
  const overall = (S.overall || []).map((o) => {
    let done = 0;
    for (const r of rows) {
      const cat = cats[r.category];
      if (!cat) continue;
      const primary = columnsFor(S, cat, r.role).includes("primary") && !cat.any_role;
      if (o.key === "instructor" && r.role === "instructor") done += 1;
      if (o.key === "lap_complex" && primary && cat.lap_tier === "complex" && isLap(r.approach)) done += 1;
      if (o.key === "lap_basic" && primary && cat.lap_tier === "basic" && isLap(r.approach)) done += 1;
    }
    return { ...o, done };
  });
  let years = null;
  if (S.per_year && start) {
    years = S.per_year.targets.map((n, i) => ({ year: i + 1, n, done: 0, instructor_n: S.per_year.instructor[i], instructor: 0 }));
    for (const r of rows) {
      const cat = cats[r.category];
      if (!cat || cat.no_patient) continue;
      const y = residencyYear(start, r.date);
      if (!y || y > years.length) continue;
      if (S.per_year.roles.includes(r.role)) years[y - 1].done += 1;
      if (r.role === "instructor") years[y - 1].instructor += 1;
    }
  }
  return { overall, years };
}
