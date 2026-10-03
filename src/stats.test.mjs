import test from "node:test";
import assert from "node:assert/strict";
import { computeStats, analyzeLocal } from "./stats.mjs";

const subjects = [{ id: "m", name: "رياضيات" }, { id: "e", name: "إنجليزي" }];
const s = (id, subjectId, day, status, extra = {}) => ({ id, subjectId, day, from: 840, to: 885, status, ...extra });
const plan = [
  s("1", "m", 0, "missed"), s("2", "m", 1, "missed"), s("3", "m", 2, "done"),
  s("4", "e", 0, "done"), s("5", "e", 1, "done"), s("6", "e", 5, "planned"),
  s("7", "m", 3, "missed", { rescheduled: true }),
];

test("الحساب حتى اليوم المحدد، والفائت المعاد جدولته لا يُحسب", () => {
  const st = computeStats(plan, subjects, 2);
  assert.equal(st.plannedMin, 225);
  assert.equal(st.doneMin, 135);
  assert.equal(st.pct, 60);
  assert.equal(st.bySubject.find((x) => x.id === "m").missed, 2);
  assert.equal(computeStats(plan, subjects, 6).bySubject.find((x) => x.id === "m").plannedMin, 135);
});

test("التحليل المحلي يلتقط المادة الضعيفة", () => {
  const a = analyzeLocal(computeStats(plan, subjects, 2));
  assert.ok(a.summary.includes("رياضيات"));
  assert.ok(a.nextWeekNote.includes("رياضيات"));
  assert.ok(a.nextWeekNote.length <= 300);
});
