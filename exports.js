// The Excel file for the specialist-title application, laid out like the NAS version's export:
// 1. the IMA summary list, 2. the detailed list sorted by type, 3. every case in one table.

import { SYLLABUS as S } from "./syllabus.js";
import { Sheet, workbook } from "./xlsx.js";

const ROLES = S.roles;
const APPROACHES = S.approaches;
const fmt = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "…");
const period = (from, to) => (from || to ? `${fmt(from)} עד ${fmt(to)}` : "כל התקופה");
const age = (a) => (a === null || a === undefined ? "" : a);

function summary(progress, name, from, to) {
  const ws = new Sheet("רשימה מסכמת");
  ws.set(0, 0, "רשימה מסכמת של הניתוחים הנדרשים בכירורגיה אורולוגית", "title");
  ws.set(1, 0, "על פי סילבוס ההתמחות משנת 2022, גרסה 2.0");
  ws.set(2, 0, `שם המתמחה: ${name || ""}`);
  ws.set(2, 3, "מס' ת.ז.:");
  ws.set(3, 0, `תקופה: ${period(from, to)}`);
  ["קטגוריה", "פירוט", "מספר ניתוחים נדרש", "מתוכם כמנתח ראשי", "מספר ניתוחים שבוצעו בפועל",
    "מתוכם, בוצעו בפועל כמנתח ראשי", "דרישות נוספות"].forEach((h, i) => ws.set(5, i, h, "head"));
  const by = Object.fromEntries(progress.categories.map((p) => [p.key, p]));
  let r = 5;
  let group = null;
  for (const cat of S.categories) {
    if (cat.group !== group) {
      group = cat.group;
      r += 1;
      for (let c = 0; c < 7; c++) ws.set(r, c, c === 0 ? S.groups[group].he : "", "group");
    }
    r += 1;
    const p = by[cat.key];
    const subs = p.sub.map((s) => `${s.he}: ${s.done} מתוך ${s.n}`).join("; ");
    [cat.he, cat.detail, cat.total, cat.primary || "-", p.total_done, p.primary_done, subs]
      .forEach((v, i) => ws.set(r, i, v, i >= 2 && i <= 5 ? "center" : "cell"));
  }
  ws.set(r + 3, 0, "חתימת מנהל המחלקה (עם חותמת):", "bold");
  ws.widths = [28, 52, 12, 12, 14, 16, 26];
  return ws;
}

const DETAIL = ["#", "שם הניתוח", "תאריך הניתוח", "מספר רשומה", "ראשי תיבות", "גיל החולה", "תפקיד", "גישה",
  "פעולות נוספות באותו ניתוח", "רופא בכיר", "מחלקה / בית חולים"];

function detail(rows, name, from, to) {
  const ws = new Sheet("רשימה מפורטת");
  ws.set(0, 0, "רשימת ניתוחים מפורטת לפי סוגים, כירורגיה אורולוגית", "title");
  ws.set(1, 0, `שם המתמחה: ${name || ""}`);
  ws.set(2, 0, `תקופה: ${period(from, to)}`);
  let r = 3;
  for (const cat of S.categories) {
    const items = rows.filter((x) => x.category === cat.key);
    const primary = items.filter((x) => x.role === "primary").length;
    r += 2;
    for (let c = 0; c < DETAIL.length; c++) {
      ws.set(r, c, c === 0 ? `${cat.he} (${cat.en}): ${items.length} ניתוחים, מתוכם ${primary} כמנתח ראשי` : "", "group");
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
      [n + 1, x.procedure, x.date, x.record_no, x.initials, age(x.age), ROLES[x.role] || x.role,
        APPROACHES[x.approach] || "", (x.also || []).join(", "), x.attending, x.site]
        .forEach((v, i) => ws.set(r, i, v, i === 2 ? "date" : "cell"));
    });
  }
  ws.widths = [5, 36, 13, 14, 11, 9, 12, 12, 30, 20, 20];
  return ws;
}

function flat(rows) {
  const ws = new Sheet("כל המקרים");
  const head = ["תאריך", "שם הניתוח", "קטגוריה בסילבוס", "תפקיד", "גישה", "פעולות נוספות באותו ניתוח",
    "מספר רשומה", "ראשי תיבות", "גיל", "רופא בכיר", "מחלקה / בית חולים", "הערות"];
  head.forEach((h, i) => ws.set(0, i, h, "head"));
  const cats = Object.fromEntries(S.categories.map((c) => [c.key, c]));
  rows.forEach((x, n) => {
    [x.date, x.procedure, (cats[x.category] || {}).he || x.category, ROLES[x.role] || x.role, APPROACHES[x.approach] || "",
      (x.also || []).join(", "), x.record_no, x.initials, age(x.age), x.attending, x.site, x.notes]
      .forEach((v, i) => ws.set(n + 1, i, v, i === 0 ? "datePlain" : "plain"));
  });
  ws.filter = `A1:L${Math.max(rows.length + 1, 2)}`;
  ws.widths = [12, 36, 28, 12, 12, 30, 14, 11, 7, 20, 20, 30];
  return ws;
}

export function imaWorkbook(rows, progress, name, from, to) {
  return workbook([summary(progress, name, from, to), detail(rows, name, from, to), flat(rows)]);
}
