import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHandler } from "./analyze.mjs";

const stats = {
  pct: 50, plannedMin: 200, doneMin: 100,
  sessions: { total: 4, done: 2, missed: 1 },
  bySubject: [{ id: "m", name: "رياضيات", plannedMin: 100, doneMin: 20, missed: 1, pct: 20 }, { id: "e", name: "إنجليزي", plannedMin: 100, doneMin: 80, missed: 0, pct: 80 }],
  byDay: [],
};

test("رد AI سليم: يُنظَّف ويُحذف المجهول", async () => {
  const fake = async () => JSON.stringify({ summary: "أداء متوسط", nextWeekNote: "خفف الرياضيات", tips: [{ subjectId: "m", text: "قصّر" }, { subjectId: "zzz", text: "x" }] });
  const r = await analyzeHandler({ stats }, fake);
  assert.equal(r.source, "ai");
  assert.equal(r.tips.length, 1);
});

test("بدون مفتاح أو عند الفشل: تحليل القواعد", async () => {
  assert.equal((await analyzeHandler({ stats }, null)).reason, "no_key");
  const r = await analyzeHandler({ stats }, async () => "مش JSON");
  assert.equal(r.source, "engine");
  assert.ok(r.summary);
});

test("لا جلسات: no_data", async () => {
  const empty = { ...stats, sessions: { total: 0, done: 0, missed: 0 }, bySubject: [] };
  assert.equal((await analyzeHandler({ stats: empty }, async () => "{}")).reason, "no_data");
});
