import test from "node:test";
import assert from "node:assert/strict";
import { generatePlan, validate, fixSchedule, rescheduleMissed, formatSession, toMin } from "./engine.mjs";

// السبت = 0 ... الخميس = 5، الجمعة = 6. المدرسة الأحد–الخميس.
const SCHOOL_DAYS = [1, 2, 3, 4, 5];
const input = {
  weekStart: "2026-10-03", // سبت
  student: {
    sleep: { sleepAt: "23:00", wakeAt: "06:00" },
    studyWindow: { from: "14:00", to: "22:00" },
    availableDays: [0, 1, 2, 3, 4, 5, 6],
  },
  subjects: [
    { id: "math", name: "رياضيات", level: "weak", priority: 3, weeklyHours: 4 },
    { id: "sci", name: "علوم", level: "mid", priority: 2, weeklyHours: 3 },
    { id: "ar", name: "عربي", level: "mid", priority: 2, weeklyHours: 2 },
    { id: "en", name: "إنجليزي", level: "good", priority: 1, weeklyHours: 2 },
  ],
  fixedBlocks: [
    { days: SCHOOL_DAYS, type: "school", title: "المدرسة", from: "07:00", to: "13:00" },
    { days: SCHOOL_DAYS, type: "transport", title: "المواصلات", from: "13:00", to: "14:00" },
    { days: [2, 4], type: "lesson", title: "درس خصوصي", from: "16:00", to: "18:00" },
  ],
  exams: [{ subjectId: "math", date: "2026-10-15" }],
};

const minutes = (plan, id) =>
  plan.sessions.filter((x) => x.subjectId === id).reduce((a, x) => a + x.to - x.from, 0);

test("الخطة لا تحتوي أي مخالفة ولا جلسات غير موضوعة", () => {
  const plan = generatePlan(input);
  assert.deepEqual(validate(plan.sessions, input), []);
  assert.equal(plan.unplaced.length, 0);
});

test("المادة الضعيفة عالية الأولوية تأخذ وقتًا أكبر من الجيدة", () => {
  const plan = generatePlan(input);
  assert.ok(minutes(plan, "math") > minutes(plan, "en"));
});

test("لا جلسة تتداخل مع الدرس الخصوصي", () => {
  const plan = generatePlan(input);
  for (const x of plan.sessions.filter((x) => x.day === 2 || x.day === 4))
    assert.ok(x.to <= toMin("16:00") || x.from >= toMin("18:00"));
});

test("الجلسات موزعة على أكثر من يوم (لا تكديس)", () => {
  const plan = generatePlan(input);
  assert.ok(new Set(plan.sessions.map((x) => x.day)).size >= 5);
});

test("الحد الأقصى للجلسات والدقائق يوميًا محترم", () => {
  const plan = generatePlan(input);
  for (let d = 0; d < 7; d++) {
    const day = plan.sessions.filter((x) => x.day === d);
    assert.ok(day.length <= 4);
    assert.ok(day.reduce((a, x) => a + x.to - x.from, 0) <= 240);
  }
});

test("المحقق يكتشف جدولًا سيئًا (مثل اقتراح AI خاطئ)", () => {
  const bad = [
    { id: "a", subjectId: "math", day: 2, from: "16:30", to: "17:20" }, // أثناء الدرس
    { id: "b", subjectId: "sci", day: 0, from: "05:00", to: "05:40" }, // وقت نوم
  ];
  const codes = validate(bad, input).map((v) => v.code);
  assert.ok(codes.includes("OVERLAP_FIXED"));
  assert.ok(codes.includes("OUTSIDE_WINDOW"));
});

test("fixSchedule ينقل الجلسة المرفوضة لوقت صحيح", () => {
  const bad = [{ id: "a", subjectId: "math", day: 2, from: "16:30", to: "17:20" }];
  const res = fixSchedule(bad, input);
  assert.equal(res.moved.length, 1);
  assert.deepEqual(validate(res.sessions, input), []);
});

test("إعادة الجدولة: الفائت يتحول لجلسات تعويض موزعة ولا يضرب القواعد", () => {
  const plan = generatePlan(input);
  const victim = plan.sessions.find((x) => x.subjectId === "math");
  const withMissed = plan.sessions.map((x) => (x === victim ? { ...x, status: "missed" } : x));
  const res = rescheduleMissed(withMissed, input, { fromDay: victim.day + 1 });
  assert.ok(res.added.length >= 1);
  assert.ok(res.added.every((x) => x.type === "makeup" && x.day >= victim.day + 1));
  assert.deepEqual(validate(res.sessions, input), []);
});

test("طباعة عينة", () => {
  const plan = generatePlan(input);
  console.log(plan.sessions.map((x) => formatSession(x, input.subjects)).join("\n"));
  console.log(plan.summary);
});
