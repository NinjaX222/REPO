import { analyzeLocal } from "../src/stats.mjs";
import { parseJSON } from "./plan.mjs";

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

function buildPrompt(stats) {
  const data = { pct: stats.pct, sessions: stats.sessions, bySubject: stats.bySubject, byDay: stats.byDay };
  return `You are a study coach for a secondary-school student. Below is planned vs completed study (minutes), days 0=Saturday..6=Friday.
Write short, encouraging, practical Arabic. Point out subjects that were missed or under-completed and suggest redistributing their time (lighter days, shorter sessions), not just adding hours. Never suggest more than 4 study hours in a day.

DATA:
${JSON.stringify(data)}

Reply with JSON only:
{"summary":"2-3 sentences","nextWeekNote":"one instruction, max 250 chars, that the weekly planner will receive","tips":[{"subjectId":"<id>","text":"one short sentence"}]}`;
}

// الـAI يحلل ← وإن فشل يرجع تحليل القواعد.
export async function analyzeHandler({ stats }, callModel) {
  const local = analyzeLocal(stats);
  const fallback = (reason, detail) => ({ source: "engine", reason, detail, ...local });
  if (!callModel) return fallback("no_key");
  if (!stats.sessions.total) return fallback("no_data");
  try {
    const j = parseJSON(await callModel(buildPrompt(stats)));
    const summary = str(j.summary, 600);
    if (!summary) return fallback("empty_ai_output");
    const ids = new Set(stats.bySubject.map((s) => s.id));
    const tips = (Array.isArray(j.tips) ? j.tips : [])
      .filter((t) => ids.has(t?.subjectId) && typeof t.text === "string")
      .slice(0, 12).map((t) => ({ subjectId: t.subjectId, text: str(t.text, 200) }));
    return { source: "ai", summary, nextWeekNote: str(j.nextWeekNote, 300), tips };
  } catch (e) {
    console.error("[AI analyze error]", e.message);
    return fallback("ai_error", e.message.slice(0, 200));
  }
}
