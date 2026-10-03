// جَدول — Schedule Engine
// محرك جدولة قائم على القواعد (بدون AI). الـAI لاحقًا يقترح، وهذا الملف يتحقق ويصلح.
// كل الأوقات داخليًا بالدقائق من منتصف الليل. الأيام: 0 = السبت ... 6 = الجمعة.

export const DAY_NAMES = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

export const CONFIG = {
  level: { weak: 1.2, mid: 1.0, good: 0.85 },       // معامل المستوى على weeklyHours
  priority: { 1: 0.9, 2: 1.0, 3: 1.1 },             // 3 = أولوية عالية
  examHorizonDays: 14,                              // الامتحان خلال كام يوم يبدأ يرفع الوزن
  examMaxBoost: 0.5,                                // أقصى زيادة قبل الامتحان مباشرة (+50%)
  fixedLoadWeight: 0.25,                            // يوم مدرسي طويل = ضغط أقل بعده
  capacityFactor: 0.85,                             // هامش للراحات
};

const DEFAULTS = {
  minSession: 30, maxSession: 50, breakMin: 10,
  maxSessionsPerDay: 4, maxMinutesPerDay: 240, step: 5,
};

// ---------- أدوات الوقت ----------
export function toMin(t) {
  if (typeof t === "number") return t;
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + (m || 0);
}
export function toHHMM(m) {
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const roundStep = (v, s) => Math.round(v / s) * s;
const ceilStep = (v, s) => Math.ceil(v / s) * s;

// ---------- تطبيع المدخلات ----------
function normalize(input) {
  const settings = { ...DEFAULTS, ...(input.settings || {}) };
  const st = input.student;
  const wake = toMin(st.sleep.wakeAt);
  let bed = toMin(st.sleep.sleepAt);
  if (bed <= wake) bed += 1440;
  const window = {
    from: Math.max(wake, toMin(st.studyWindow.from)),
    to: Math.min(bed, 1440, toMin(st.studyWindow.to)),
  };
  const days = (st.availableDays || [0, 1, 2, 3, 4, 5, 6]).slice().sort((a, b) => a - b);
  const blocks = (input.fixedBlocks || []).flatMap((b) =>
    (b.days || [b.day]).map((d) => ({ ...b, day: d, from: toMin(b.from), to: toMin(b.to) }))
  );
  const exams = (input.exams || []).map((e) => ({
    ...e,
    dayIndex: Math.round((Date.parse(e.date) - Date.parse(input.weekStart)) / 864e5),
  }));
  return { settings, window, days, blocks, exams, subjects: input.subjects || [] };
}

function normSession(x) {
  return { status: "planned", ...x, from: toMin(x.from), to: toMin(x.to) };
}

// آخر يوم مسموح لمادة قبل امتحانها (الجلسات تكون قبل يوم الامتحان فقط)
function examLimit(s, subjectId) {
  const idx = s.exams.filter((e) => e.subjectId === subjectId && e.dayIndex >= 0).map((e) => e.dayIndex);
  return idx.length ? Math.min(...idx) : null;
}

// ---------- الفترات الفاضية ----------
function subtract(slots, [a, b]) {
  const out = [];
  for (const s of slots) {
    if (b <= s.from || a >= s.to) { out.push(s); continue; }
    if (a > s.from) out.push({ from: s.from, to: a });
    if (b < s.to) out.push({ from: b, to: s.to });
  }
  return out;
}

export function freeSlots(s, day, sessions = []) {
  const br = s.settings.breakMin;
  let slots = [{ ...s.window }];
  for (const b of s.blocks) if (b.day === day) slots = subtract(slots, [b.from, b.to]);
  for (const x of sessions)
    if (x.day === day && x.status !== "missed") slots = subtract(slots, [x.from - br, x.to + br]);
  return slots.filter((sl) => sl.to > sl.from);
}

function findStart(s, day, len, sessions, minStart = 0) {
  for (const sl of freeSlots(s, day, sessions)) {
    const start = ceilStep(Math.max(sl.from, minStart), s.settings.step);
    if (start + len <= sl.to) return start;
  }
  return null;
}

const activeOn = (sessions, d) => sessions.filter((x) => x.day === d && x.status !== "missed");
const sumLen = (list) => list.reduce((a, x) => a + (x.to - x.from), 0);
const fixedMinutes = (s, d) => s.blocks.filter((b) => b.day === d && b.type !== "transport").reduce((a, b) => a + (b.to - b.from), 0);

// ---------- أهداف الدقائق لكل مادة ----------
function computeTargets(s) {
  const C = CONFIG;
  const capacity =
    s.days.reduce((a, d) => a + Math.min(sumLen(freeSlots(s, d)), s.settings.maxMinutesPerDay), 0) * C.capacityFactor;

  const raw = s.subjects.map((sub) => {
    const lim = examLimit(s, sub.id);
    let exam = 1;
    if (lim !== null && lim < C.examHorizonDays)
      exam = 1 + (C.examMaxBoost * (C.examHorizonDays - lim)) / C.examHorizonDays;
    const w = (C.level[sub.level] ?? 1) * (C.priority[sub.priority] ?? 1) * exam;
    return { sub, weight: w, minutes: sub.weeklyHours * 60 * w };
  });
  const total = raw.reduce((a, r) => a + r.minutes, 0);
  const scale = total > capacity ? capacity / total : 1;
  return raw.map((r) => ({ ...r, minutes: roundStep(r.minutes * scale, s.settings.step) }));
}

function buildJobs(targets, s) {
  const { minSession, maxSession, step } = s.settings;
  const jobs = [];
  for (const t of targets) {
    if (t.minutes <= 0) continue;
    const n = Math.max(1, Math.ceil(t.minutes / maxSession));
    const len = clamp(roundStep(t.minutes / n, step), minSession, maxSession);
    for (let i = 0; i < n; i++) jobs.push({ subjectId: t.sub.id, length: len, weight: t.weight });
  }
  return jobs.sort((a, b) => b.weight - a.weight || b.length - a.length);
}

// ---------- وضع جلسة في أنسب يوم ----------
function placeJob(job, sessions, s, opts = {}) {
  const { fromDay = null, nowMin = 0 } = opts;
  const { maxSessionsPerDay, maxMinutesPerDay } = s.settings;
  const lim = examLimit(s, job.subjectId);
  let best = null;
  for (const d of s.days) {
    if (fromDay !== null && d < fromDay) continue;
    if (lim !== null && d >= lim) continue;
    const today = activeOn(sessions, d);
    if (today.length >= maxSessionsPerDay) continue;
    const mins = sumLen(today);
    if (mins + job.length > maxMinutesPerDay) continue;
    const start = findStart(s, d, job.length, sessions, d === fromDay ? nowMin : 0);
    if (start === null) continue;
    const same = today.filter((x) => x.subjectId === job.subjectId).length;
    const score = mins + fixedMinutes(s, d) * CONFIG.fixedLoadWeight + same * 1000;
    if (!best || score < best.score) best = { d, start, score };
  }
  if (!best) return null;
  return {
    id: `${job.subjectId}-${best.d}-${best.start}`,
    subjectId: job.subjectId,
    day: best.d,
    from: best.start,
    to: best.start + job.length,
    type: job.type || "understand",
    status: "planned",
    ...(job.makeupOf ? { makeupOf: job.makeupOf } : {}),
  };
}

// ---------- نوع الجلسة: فهم ← تطبيق ← مراجعة (واختبار قبل الامتحان) ----------
function assignTypes(sessions, s) {
  const cycle = ["understand", "practice", "review"];
  for (const sub of s.subjects) {
    const list = sessions
      .filter((x) => x.subjectId === sub.id && x.type !== "makeup")
      .sort((a, b) => a.day - b.day || a.from - b.from);
    const lim = examLimit(s, sub.id);
    const soon = lim !== null && lim <= 7;
    const types = list.map((_, i) => cycle[i % 3]);
    const k = list.length;
    if (soon && k === 1) types[0] = "review";
    if (soon && k >= 2) types[k - 1] = k >= 3 ? "test" : "review";
    if (soon && k >= 4) types[k - 2] = "review";
    list.forEach((x, i) => (x.type = types[i]));
  }
}

const sortSessions = (list) => list.sort((a, b) => a.day - b.day || a.from - b.from);

// ---------- 1) توليد خطة أسبوعية ----------
export function generatePlan(input) {
  const s = normalize(input);
  const targets = computeTargets(s);
  const jobs = buildJobs(targets, s);
  const sessions = [];
  const unplaced = [];
  for (const job of jobs) {
    const placed = placeJob(job, sessions, s);
    placed ? sessions.push(placed) : unplaced.push(job);
  }
  assignTypes(sessions, s);
  sortSessions(sessions);
  return { sessions, unplaced, summary: summarize(sessions, s) };
}

export function summarize(sessions, s) {
  const bySubject = {}, byDay = {};
  for (const x of sessions) {
    if (x.status === "missed") continue;
    const m = x.to - x.from;
    bySubject[x.subjectId] = (bySubject[x.subjectId] || 0) + m;
    byDay[x.day] = (byDay[x.day] || 0) + m;
  }
  return { minutesBySubject: bySubject, minutesByDay: byDay };
}

// ---------- 2) التحقق (يستخدم لفحص أي جدول، ومنها مخرجات الـAI) ----------
function violationsFor(x, earlier, s) {
  const v = [];
  const add = (code, message) => v.push({ code, sessionId: x.id, message });
  const { minSession, maxSession, breakMin, maxSessionsPerDay, maxMinutesPerDay } = s.settings;
  const len = x.to - x.from;

  if (!s.subjects.some((q) => q.id === x.subjectId)) add("UNKNOWN_SUBJECT", "مادة غير معروفة");
  if (!s.days.includes(x.day)) add("DAY_UNAVAILABLE", "يوم غير متاح للدراسة");
  if (x.from < s.window.from || x.to > s.window.to) add("OUTSIDE_WINDOW", "خارج وقت المذاكرة/النوم");
  if (len < minSession) add("TOO_SHORT", "الجلسة أقصر من الحد الأدنى");
  if (len > maxSession) add("TOO_LONG", "الجلسة أطول من الحد الأقصى");
  for (const b of s.blocks)
    if (b.day === x.day && x.from < b.to && b.from < x.to)
      add("OVERLAP_FIXED", `تتعارض مع ${b.title || b.type}`);

  const same = activeOn(earlier, x.day);
  for (const e of same) {
    if (x.from < e.to && e.from < x.to) add("OVERLAP_SESSION", "تتداخل مع جلسة أخرى");
    else if (x.from < e.to + breakMin && e.from < x.to + breakMin) add("BREAK_TOO_SHORT", "لا توجد راحة كافية بين الجلستين");
  }
  if (same.length >= maxSessionsPerDay) add("TOO_MANY_SESSIONS", "عدد الجلسات في اليوم أكبر من المسموح");
  if (sumLen(same) + len > maxMinutesPerDay) add("DAY_OVERLOAD", "ساعات اليوم أكبر من المسموح");
  const lim = examLimit(s, x.subjectId);
  if (lim !== null && x.day >= lim) add("AFTER_EXAM", "الجلسة في/بعد يوم امتحان المادة");
  return v;
}

export function validate(sessions, input) {
  const s = normalize(input);
  const list = sessions.map(normSession).filter((x) => x.status !== "missed");
  const out = [];
  list.forEach((x, i) => out.push(...violationsFor(x, list.slice(0, i), s)));
  return out;
}

// ---------- 3) الإصلاح: يبقي الصحيح ويعيد وضع المرفوض ----------
export function fixSchedule(sessions, input) {
  const s = normalize(input);
  const { minSession, maxSession } = s.settings;
  const accepted = [];
  const rejected = [];
  for (const raw of sessions) {
    const x = normSession(raw);
    if (x.status === "missed" || violationsFor(x, accepted, s).length === 0) accepted.push(x);
    else rejected.push(x);
  }
  const moved = [], unplaced = [];
  for (const r of rejected) {
    const length = clamp(r.to - r.from, minSession, maxSession);
    const placed = placeJob({ subjectId: r.subjectId, length, type: r.type }, accepted, s);
    if (placed) { accepted.push(placed); moved.push({ from: r, to: placed }); }
    else unplaced.push(r);
  }
  return { sessions: sortSessions(accepted), moved, unplaced };
}

// ---------- 4) إعادة الجدولة للجلسات الفائتة ----------
// تُوزَّع الدقائق الفائتة على الأيام المتبقية كجلسات "تعويض" بدل تكديسها في يوم واحد.
export function rescheduleMissed(plan, input, { fromDay, nowMin = 0 }) {
  const s = normalize(input);
  const { maxSession, minSession, step } = s.settings;
  const all = plan.map(normSession);
  const missed = all.filter((x) => x.status === "missed" && !x.rescheduled);
  const kept = all.filter((x) => x.status !== "missed");

  const perSubject = {};
  for (const m of missed) perSubject[m.subjectId] = (perSubject[m.subjectId] || 0) + (m.to - m.from);

  const jobs = [];
  for (const [subjectId, minutes] of Object.entries(perSubject)) {
    const n = Math.max(1, Math.ceil(minutes / maxSession));
    const len = clamp(roundStep(minutes / n, step), minSession, maxSession);
    for (let i = 0; i < n; i++) jobs.push({ subjectId, length: len, type: "makeup", makeupOf: subjectId });
  }

  const added = [], unplaced = [];
  for (const job of jobs) {
    const placed = placeJob(job, [...kept, ...added], s, { fromDay, nowMin });
    placed ? added.push(placed) : unplaced.push(job);
  }
  const history = all.filter((x) => x.status === "missed").map((x) => ({ ...x, rescheduled: true }));
  return { sessions: sortSessions([...kept, ...added]), history, added, unplaced };
}

// ---------- عرض ----------
export function formatSession(x, subjects = []) {
  const name = subjects.find((q) => q.id === x.subjectId)?.name ?? x.subjectId;
  return `${DAY_NAMES[x.day]} ${toHHMM(x.from)}–${toHHMM(x.to)}  ${name}  (${x.type})`;
}
