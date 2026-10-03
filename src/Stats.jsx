import { useState } from "react";
import { computeStats, analyzeLocal } from "./stats.mjs";
import { aiAnalyze } from "./ai.js";
import { DAY_NAMES } from "./engine.mjs";

const hrs = (m) => (m / 60).toFixed(1);
const color = (p) => (p < 60 ? "var(--bad)" : p < 90 ? "var(--pri)" : "var(--ok)");
const Bar = ({ pct, c }) => <div className="bar"><i style={{ width: pct + "%", background: c }} /></div>;
const REASONS = { no_key: "السيرفر بدون مفتاح AI", ai_error: "تعذّر الاتصال بالـAI", server: "تعذّر الوصول للسيرفر" };

export default function Stats({ data, today }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!data.plan) return <div className="empty">أنشئ جدولًا أولًا ثم تابع تقدمك هنا.</div>;

  const st = computeStats(data.plan, data.subjects, Math.min(today, 6));
  const maxDay = Math.max(1, ...st.byDay.map((d) => d.plannedMin));
  const nameOf = (id) => data.subjects.find((s) => s.id === id)?.name || "";

  const analyze = async () => {
    setBusy(true); setCopied(false);
    try { setRes(await aiAnalyze(st)); }
    catch { setRes({ source: "engine", reason: "server", ...analyzeLocal(st) }); }
    setBusy(false);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(res.nextWeekNote); setCopied(true); } catch {} };

  return (
    <>
      <div className="card">
        <b>التقدم حتى اليوم</b>
        <div style={{ fontSize: 30, fontWeight: 800 }}>{st.pct}%</div>
        <Bar pct={st.pct} c="var(--ok)" />
        <small>{hrs(st.doneMin)} من {hrs(st.plannedMin)} ساعة · {st.sessions.done} منفذة، {st.sessions.missed} فائتة، من {st.sessions.total} جلسة</small>
      </div>

      <div className="card">
        <b>المواد (الأضعف أولًا)</b>
        {[...st.bySubject].sort((a, b) => a.pct - b.pct).map((s) => (
          <div key={s.id} style={{ marginTop: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>{s.name}{s.missed ? ` · ${s.missed} فائتة` : ""}</span>
              <small>{hrs(s.doneMin)}/{hrs(s.plannedMin)} س · {s.pct}%</small>
            </div>
            <Bar pct={s.pct} c={color(s.pct)} />
          </div>
        ))}
        {!st.bySubject.length && <div className="empty">لا جلسات حتى الآن.</div>}
      </div>

      <div className="card">
        <b>الأيام (المخطط والمنفذ)</b>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 100, marginTop: 8 }}>
          {st.byDay.map((d) => (
            <div key={d.day} style={{ flex: 1, textAlign: "center", fontSize: 11 }}>
              <div style={{ height: Math.max(2, (d.plannedMin / maxDay) * 80), background: "var(--line)", borderRadius: 4, display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
                <div style={{ width: "100%", height: d.plannedMin ? (d.doneMin / d.plannedMin) * 100 + "%" : 0, background: "var(--ok)" }} />
              </div>
              {DAY_NAMES[d.day]}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <button className="btn" disabled={busy || !st.sessions.total} onClick={analyze}>{busy ? "جارٍ التحليل…" : "🧠 حلّل أدائي"}</button>
        {res && (
          <div style={{ marginTop: 10 }}>
            {res.source !== "ai" && <div className="warn">تحليل مبسّط بالقواعد{res.reason ? `: ${REASONS[res.reason] || res.reason}` : ""}.</div>}
            <p>{res.summary}</p>
            {res.tips?.map((t) => <div key={t.subjectId} className="blk"><b>{nameOf(t.subjectId)}:</b> {t.text}</div>)}
            {res.nextWeekNote && (
              <>
                <p className="f">طلب مقترح للأسبوع القادم (الصقه في خانة «طلب للـAI» بشاشة الجدول):</p>
                <div className="blk">{res.nextWeekNote}</div>
                <button className="btn ghost" onClick={copy}>{copied ? "✓ تم النسخ" : "نسخ الطلب"}</button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
