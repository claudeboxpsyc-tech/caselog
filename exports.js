// The Excel file for the specialist-title application, laid out like the NAS version's export:
// 1. the IMA summary list, 2. the detailed list sorted by type, 3. every case in one table.
// The columns follow the syllabus in use (urology: total and primary; general surgery: per role).

import { roleHe } from "./syllabi.js";
import { Sheet, workbook } from "./xlsx.js";

const APPROACHES = { "": "", open: "פתוחה", lap: "לפרוסקופית", robotic: "רובוטית", endo: "אנדוסקופית", perc: "מלעורית" };
const fmt = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "…");
const period = (from, to) => (from || to ? `${fmt(from)} עד ${fmt(to)}` : "כל התקופה");
const age = (a) => (a === null || a === undefined ? "" : a);
const catName = (cat) => (cat.no ? `${cat.no}. ${cat.he}` : cat.he);

function summary(S, progress, name, from, to) {
  const ws = new Sheet("רשימה מסכמת");
  ws.set(0, 0, S.title_he, "title");
  ws.set(1, 0, S.version_he);
  ws.set(2, 0, `שם המתמחה: ${name || ""}`);
  ws.set(2, 3, "מס' ת.ז.:");
  ws.set(3, 0, `תקופה: ${period(from, to)}`);
  const cols = S.columns;
  const head = ["קטגוריה", "פירוט", ...cols.map((c) => `נדרש: ${c.he}`), ...cols.map((c) => `בוצע: ${c.he}`), "דרישות נוספות"];
  head.forEach((h, i) => ws.set(5, i, h, "head"));
  const width = head.length;
  const by = Object.fromEntries(progress.categories.map((p) => [p.key, p]));
  let r = 5;
  let group = null;
  for (const cat of S.categories) {
    if (cat.group !== group) {
      group = cat.group;
      r += 1;
      for (let c = 0; c < width; c++) ws.set(r, c, c === 0 ? S.groups[group].he : "", "group");
    }
    r += 1;
    const p = by[cat.key];
    const subs = p.sub.map((s) => `${s.he}: ${s.done} מתוך ${s.n}`).join("; ");
    [catName(cat), cat.detail || "", ...cols.map((c) => cat.targets[c.key] || "-"), ...cols.map((c) => p.cols[c.key] || 0), subs]
      .forEach((v, i) => ws.set(r, i, v, i >= 2 && i < 2 + 2 * cols.length ? "center" : "cell"));
  }
  if (progress.overall_targets && progress.overall_targets.length) {
    r += 2;
    for (let c = 0; c < width; c++) ws.set(r, c, c === 0 ? "סיכום כללי" : "", "group");
    for (const o of progress.overall_targets) {
      r += 1;
      ws.set(r, 0, o.he, "cell");
      ws.set(r, 2, o.n, "center");
      ws.set(r, 2 + cols.length, o.done, "center");
    }
  }
  if (progress.years) {
    const roman = ["I", "II", "III", "IV", "V", "VI"];
    r += 2;
    for (let c = 0; c < width; c++) ws.set(r, c, c === 0 ? "לפי שנת התמחות (כמנתח ראשי, מתמחה-מדריך או עוזר ראשון)" : "", "group");
    for (const y of progress.years) {
      r += 1;
      ws.set(r, 0, `שנה ${roman[y.year - 1]}`, "cell");
      ws.set(r, 2, y.n, "center");
      ws.set(r, 2 + cols.length, y.done, "center");
      if (y.instructor_n) ws.set(r, 2 * cols.length + 2, `כמתמחה-מדריך: ${y.instructor} מתוך ${y.instructor_n}`, "cell");
    }
  }
  ws.set(r + 3, 0, "חתימת מנהל המחלקה (עם חותמת):", "bold");
  ws.widths = [34, 46, ...cols.map(() => 12), ...cols.map(() => 12), 30];
  return ws;
}

const DETAIL = ["#", "שם הניתוח", "תאריך הניתוח", "מספר רשומה", "ראשי תיבות", "גיל החולה", "תפקיד", "גישה",
  "פעולות נוספות באותו ניתוח", "רופא בכיר", "מחלקה / בית חולים"];

function detail(S, rows, name, from, to) {
  const ws = new Sheet("רשימה מפורטת");
  ws.set(0, 0, `רשימת ניתוחים מפורטת לפי סוגים, ${S.specialty_he}`, "title");
  ws.set(1, 0, `שם המתמחה: ${name || ""}`);
  ws.set(2, 0, `תקופה: ${period(from, to)}`);
  let r = 3;
  for (const cat of S.categories) {
    const items = rows.filter((x) => x.category === cat.key);
    const byRole = S.roles.map((role) => [role.he, items.filter((x) => x.role === role.key).length]).filter(([, n]) => n);
    const roles = byRole.length ? `, מתוכם ${byRole.map(([label, n]) => `${n} ${label}`).join(", ")}` : "";
    r += 2;
    for (let c = 0; c < DETAIL.length; c++) {
      ws.set(r, c, c === 0 ? `${catName(cat)} (${cat.en}): ${items.length} ניתוחים${roles}` : "", "group");
    }
    r += 1;
    DETAIL.forEach((h, i) => ws.set(r, i, h, "head"));
    if (!items.length) {
      r += 1;
      ws.set(r, 1, "אין ניתוחים רשומים");
      continue;
    }
    items.forEach((x, n) => {
      r += 1;
      [n + 1, x.procedure, x.date, x.record_no, x.initials, age(x.age), roleHe(S, x.role),
        APPROACHES[x.approach] || "", (x.also || []).join(", "), x.attending, x.site]
        .forEach((v, i) => ws.set(r, i, v, i === 2 ? "date" : "cell"));
    });
  }
  ws.widths = [5, 36, 13, 14, 11, 9, 14, 12, 30, 20, 20];
  return ws;
}

function flat(S, rows) {
  const ws = new Sheet("כל המקרים");
  const head = ["תאריך", "שם הניתוח", "קטגוריה בסילבוס", "תפקיד", "גישה", "פעולות נוספות באותו ניתוח",
    "מספר רשומה", "ראשי תיבות", "גיל", "רופא בכיר", "מחלקה / בית חולים", "הערות"];
  head.forEach((h, i) => ws.set(0, i, h, "head"));
  const cats = Object.fromEntries(S.categories.map((c) => [c.key, c]));
  rows.forEach((x, n) => {
    const cat = cats[x.category];
    [x.date, x.procedure, cat ? catName(cat) : x.category, roleHe(S, x.role), APPROACHES[x.approach] || "",
      (x.also || []).join(", "), x.record_no, x.initials, age(x.age), x.attending, x.site, x.notes]
      .forEach((v, i) => ws.set(n + 1, i, v, i === 0 ? "datePlain" : "plain"));
  });
  ws.filter = `A1:L${Math.max(rows.length + 1, 2)}`;
  ws.widths = [12, 36, 28, 14, 12, 30, 14, 11, 7, 20, 20, 30];
  return ws;
}

export function imaWorkbook(S, rows, progress, name, from, to) {
  return workbook([summary(S, progress, name, from, to), detail(S, rows, name, from, to), flat(S, rows)]);
}
