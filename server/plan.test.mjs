import test from "node:test";
import assert from "node:assert/strict";
import { planHandler } from "./plan.mjs";
import { validate } from "../src/engine.mjs";

const input = {
  weekStart: "2026-10-03",
  student: { sleep: { sleepAt: "23:00", wakeAt: "06:00" }, studyWindow: { from: "14:00", to: "22:00" }, availableDays: [0, 1, 2, 3, 4, 5, 6] },
  subjects: [
    { id: "math", name: "رياضيات", level: "weak", priority: 3, weeklyHours: 4 },
    { id: "sci", name: "علوم", level: "mid", priority: 2, weeklyHours: 3 },
  ],
  fixedBlocks: [{ days: [1, 2, 3, 4, 5], type: "school", title: "المدرسة", from: "07:00", to: "13:00" },
    { days: [2], type: "lesson", title: "درس", from: "16:00", to: "18:00" }],
  exams: [],
};

test("بدون مفتاح: يرجع لخطة المحرك", async () => {
  const r = await planHandler({ input }, null);
  assert.equal(r.source, "engine");
  assert.deepEqual(validate(r.sessions, input), []);
});

test("AI يقترح خطة بها تعارضات: المحرك يصلحها", async () => {
  const fake = async () => JSON.stringify({ sessions: [
    ...[0, 1, 3, 4, 5, 6].map((d) => ({ subjectId: "math", day: d, from: "14:00", to: "14:45", type: "practice" })),
    { subjectId: "math", day: 2, from: "16:30", to: "17:15", type: "practice" },       // أثناء الدرس
    { subjectId: "sci", day: 0, from: "03:00", to: "03:45", type: "understand" },      // وقت نوم
    ...[0, 1, 3, 4, 5, 6].map((d) => ({ subjectId: "sci", day: d, from: "16:00", to: "16:45", type: "review" })),
  ] });
  const r = await planHandler({ input }, fake);
  assert.equal(r.source, "ai");
  assert.ok(r.moved >= 2);
  assert.deepEqual(validate(r.sessions, input), []);
});

test("AI يرجع كلامًا غير JSON أو يفشل: fallback", async () => {
  assert.equal((await planHandler({ input }, async () => "مرحبا")).reason, "ai_error");
  assert.equal((await planHandler({ input }, async () => { throw new Error("x"); })).source, "engine");
});

test("JSON داخل ```json يُقرأ صح", async () => {
  const fenced = "```json\n" + JSON.stringify({ sessions: [] }) + "\n```";
  assert.equal((await planHandler({ input }, async () => fenced)).reason, "empty_ai_output");
});
