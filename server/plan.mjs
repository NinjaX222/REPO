import { generatePlan, fixSchedule, validate } from "../src/engine.mjs";
import { buildPrompt } from "./prompt.mjs";

const TYPES = new Set(["understand", "practice", "review", "test", "makeup"]);

export function parseJSON(text) {
  const t = String(text).replace(/```json|```/g, "").trim();
  try { return JSON.parse(t); } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("bad_json");
  }
}

const norm = (t) => {
  const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
};

function clean(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => ({ ...x, day: Number(x?.day), from: norm(x?.from), to: norm(x?.to) }))
    .filter((x) => typeof x.subjectId === "string" && Number.isInteger(x.day) && x.from && x.to)
    .map((x) => ({
      id: `${x.subjectId}-${x.day}-${x.from}`, subjectId: x.subjectId, day: x.day, from: x.from, to: x.to,
      type: TYPES.has(x.type) ? x.type : "practice", status: "planned",
    }));
}

const total = (a) => a.reduce((s, x) => s + x.to - x.from, 0);

export async function planHandler({ input, note = "" }, callModel) {
  const baseline = generatePlan(input);
  const fallback = (reason, detail) => ({ source: "engine", reason, detail, sessions: baseline.sessions, moved: 0, unplaced: baseline.unplaced.length });
  if (!callModel) return fallback("no_key");
  try {
    const text = await callModel(buildPrompt(input, String(note).slice(0, 300), baseline.summary.minutesBySubject));
    const parsed = parseJSON(text);
    const raw = clean(Array.isArray(parsed) ? parsed : parsed.sessions);
    if (!raw.length) {
      console.error("[AI empty output]", String(text).slice(0, 500));
      return fallback("empty_ai_output", String(text).slice(0, 150));
    }
    const fixed = fixSchedule(raw, input);
    if (total(fixed.sessions) < 0.5 * total(baseline.sessions)) return fallback("ai_plan_too_small");
    return {
      source: "ai", sessions: fixed.sessions, moved: fixed.moved.length,
      unplaced: fixed.unplaced.length, issues: validate(fixed.sessions, input).length,
    };
  } catch (e) {
    console.error("[AI error]", e.message);
    return fallback("ai_error", e.message.slice(0, 200));
  }
}