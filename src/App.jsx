import { useState, useEffect } from "react";
import { aiPlan } from "./ai.js";
import Stats from "./Stats.jsx";
import { generatePlan, validate, rescheduleMissed, DAY_NAMES, toHHMM } from "./engine.mjs";

const KEY = "jadwal:v1";
const uid = () => Math.random().toString(36).slice(2, 8);
const LEVELS = { weak: "ضعيف", mid: "متوسط", good: "جيد" };
const PRIOS = { 3: "عالية", 2: "متوسطة", 1: "عادية" };
const BTYPES = { school: "مدرسة", lesson: "درس", transport: "مواصلات", other: "أخرى" };
const STYPES = { understand: "فهم", practice: "تطبيق", review: "مراجعة", test: "اختبار", makeup: "تعويض" };

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return d; };
function defaultWeekStart() {
  const d = new Date();
  const idx = (d.getDay() + 1) % 7; // السبت = 0
  d.setDate(d.getDate() + (idx === 6 ? 1 : -idx));
  return iso(d);
}

const empty = () => ({
  student: { name: "", sleep: { sleepAt: "23:00", wakeAt: "06:00" }, studyWindow: { from: "14:00", to: "22:00" }, availableDays: [0, 1, 2, 3, 4, 5, 6] },
  settings: { maxSessionsPerDay: 4, maxMinutesPerDay: 240 },
  subjects: [], fixedBlocks: [], exams: [], weekStart: defaultWeekStart(), plan: null,
});
const SAMPLE = () => ({
  ...empty(),
  subjects: [
    { id: "math", name: "رياضيات", level: "weak", priority: 3, weeklyHours: 4 },
    { id: "sci", name: "علوم", level: "mid", priority: 2, weeklyHours: 3 },
    { id: "ar", name: "عربي", level: "mid", priority: 2, weeklyHours: 2 },
    { id: "en", name: "إنجليزي", level: "good", priority: 1, weeklyHours: 2 },
  ],
  fixedBlocks: [
    { id: "b1", days: [1, 2, 3, 4, 5], type: "school", title: "المدرسة", from: "07:00", to: "13:00" },
    { id: "b2", days: [1, 2, 3, 4, 5], type: "transport", title: "المواصلات", from: "13:00", to: "14:00" },
    { id: "b3", days: [2, 4], type: "lesson", title: "درس خصوصي", from: "16:00", to: "18:00" },
  ],
});
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...JSON.parse(raw) }; } catch {}
  return empty();
}

const F = ({ label, children }) => <label className="f"><span>{label}</span>{children}</label>;
const Opts = ({ map }) => Object.entries(map).map(([k, v]) => <option key={k} value={k}>{v}</option>);
function Days({ value, onChange }) {
  return (
    <div className="days">
      {DAY_NAMES.map((n, i) => (
        <label key={i}>
          <input type="checkbox" checked={value.includes(i)}
            onChange={() => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort())} />
          {n}
        </label>
      ))}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(load);
  const [tab, setTab] = useState("student");
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} }, [data]);

  const set = (p) => setData((d) => ({ ...d, ...p }));
  const setStudent = (p) => set({ student: { ...data.student, ...p } });
  const upd = (key, id, p) => set({ [key]: data[key].map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const del = (key, id) => set({ [key]: data[key].filter((x) => x.id !== id) });

  const input = { settings: data.settings, weekStart: data.weekStart, student: data.student, subjects: data.subjects, fixedBlocks: data.fixedBlocks, exams: data.exams };
  const subj = (id) => data.subjects.find((s) => s.id === id)?.name || "؟";
  const today = Math.round((new Date(iso(new Date()) + "T00:00:00") - new Date(data.weekStart + "T00:00:00")) / 864e5);

  const run = () => {
    if (!data.subjects.length) return setMsg("أضف مادة واحدة على الأقل.");
    const r = generatePlan(input);
    set({ plan: r.sessions });
    setMsg(r.unplaced.length ? `تعذّر وضع ${r.unplaced.length} جلسة (الوقت المتاح لا يكفي).` : "");
    setTab("plan");
  };
  const REASONS = { no_key: "السيرفر بدون مفتاح AI", ai_error: "تعذّر الاتصال بالـAI", empty_ai_output: "رد AI فارغ", ai_plan_too_small: "خطة AI ناقصة" };
  const runAI = async () => {
    if (!data.subjects.length) return setMsg("أضف مادة واحدة على الأقل.");
    setBusy(true); setMsg("");
    try {
      const r = await aiPlan(input, note);
      set({ plan: r.sessions });
      setMsg(r.source === "ai"
        ? `تم إنشاء الجدول بالـAI${r.moved ? ` (صحّح المحرك ${r.moved} جلسة)` : ""}.`
        : `استُخدم المحرك المحلي: ${REASONS[r.reason] || r.reason}.${r.detail ? " (" + r.detail + ")" : ""}`);
    } catch { setMsg("تعذّر الوصول للسيرفر. تأكد من VITE_API_URL أو استخدم زر الإنشاء العادي."); }
    setBusy(false);
  };
  const setStatus = (id, status) => set({ plan: data.plan.map((x) => (x.id === id ? { ...x, status } : x)) });
  const hasMissed = (data.plan || []).some((x) => x.status === "missed" && !x.rescheduled);
  const replan = () => {
    const inWeek = today >= 0 && today <= 6;
    const now = new Date();
    const r = rescheduleMissed(data.plan, input, { fromDay: Math.min(Math.max(today, 0), 6), nowMin: inWeek ? now.getHours() * 60 + now.getMinutes() : 0 });
    set({ plan: [...r.sessions, ...r.history] });
    setMsg(r.unplaced.length ? `تعذّر تعويض ${r.unplaced.length} جلسة.` : "تمت إعادة التنظيم.");
  };

  const counted = (data.plan || []).filter((x) => !(x.status === "missed" && x.rescheduled));
  const done = counted.filter((x) => x.status === "done").length;
  const pct = counted.length ? Math.round((done / counted.length) * 100) : 0;
  const problems = data.plan ? validate(data.plan, input) : [];

  const tabs = [["student", "بياناتي"], ["subjects", "المواد"], ["blocks", "المواعيد"], ["exams", "الامتحانات"], ["plan", "الجدول"], ["stats", "التقدم"]];

  return (
    <div className="app">
      <h1>📅 جَدول {data.student.name && `— ${data.student.name}`}</h1>
      <nav>{tabs.map(([k, n]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{n}</button>)}</nav>
      <NotifyToggle data={data} input={input} set={set} />
      {msg && <div className="warn">{msg}</div>}

      {tab === "student" && (
        <div className="card">
          <div className="grid">
            <F label="الاسم"><input value={data.student.name} onChange={(e) => setStudent({ name: e.target.value })} /></F>
            <F label="الاستيقاظ"><input type="time" value={data.student.sleep.wakeAt} onChange={(e) => setStudent({ sleep: { ...data.student.sleep, wakeAt: e.target.value } })} /></F>
            <F label="النوم"><input type="time" value={data.student.sleep.sleepAt} onChange={(e) => setStudent({ sleep: { ...data.student.sleep, sleepAt: e.target.value } })} /></F>
            <F label="المذاكرة من"><input type="time" value={data.student.studyWindow.from} onChange={(e) => setStudent({ studyWindow: { ...data.student.studyWindow, from: e.target.value } })} /></F>
            <F label="المذاكرة إلى"><input type="time" value={data.student.studyWindow.to} onChange={(e) => setStudent({ studyWindow: { ...data.student.studyWindow, to: e.target.value } })} /></F>
            <F label="أقصى جلسات في اليوم"><input type="number" min="1" max="10" value={data.settings.maxSessionsPerDay} onChange={(e) => set({ settings: { ...data.settings, maxSessionsPerDay: +e.target.value || 1 } })} /></F>
            <F label="أقصى دقائق في اليوم"><input type="number" min="30" step="15" value={data.settings.maxMinutesPerDay} onChange={(e) => set({ settings: { ...data.settings, maxMinutesPerDay: +e.target.value || 30 } })} /></F>
            <F label="بداية الأسبوع (سبت)"><input type="date" value={data.weekStart} onChange={(e) => set({ weekStart: e.target.value })} /></F>
          </div>
          <p className="f">أيام المذاكرة المتاحة</p>
          <Days value={data.student.availableDays} onChange={(v) => setStudent({ availableDays: v })} />
          <p><button className="btn ghost" onClick={() => setData(SAMPLE())}>تحميل بيانات تجريبية</button></p>
        </div>
      )}

      {tab === "subjects" && (
        <>
          {data.subjects.map((s) => (
            <div className="card row" key={s.id}>
              <F label="المادة"><input value={s.name} onChange={(e) => upd("subjects", s.id, { name: e.target.value })} /></F>
              <F label="المستوى"><select value={s.level} onChange={(e) => upd("subjects", s.id, { level: e.target.value })}><Opts map={LEVELS} /></select></F>
              <F label="الأولوية"><select value={s.priority} onChange={(e) => upd("subjects", s.id, { priority: +e.target.value })}><Opts map={PRIOS} /></select></F>
              <F label="ساعات/أسبوع"><input type="number" min="0.5" step="0.5" value={s.weeklyHours} onChange={(e) => upd("subjects", s.id, { weeklyHours: +e.target.value })} /></F>
              <button className="del" onClick={() => del("subjects", s.id)}>🗑</button>
            </div>
          ))}
          <button className="btn" onClick={() => set({ subjects: [...data.subjects, { id: uid(), name: "", level: "mid", priority: 2, weeklyHours: 2 }] })}>+ إضافة مادة</button>
        </>
      )}

      {tab === "blocks" && (
        <>
          <p className="f">المدرسة، الدروس، المواصلات، وأي وقت غير متاح.</p>
          {data.fixedBlocks.map((b) => (
            <div className="card" key={b.id}>
              <div className="row">
                <F label="الاسم"><input value={b.title} onChange={(e) => upd("fixedBlocks", b.id, { title: e.target.value })} /></F>
                <F label="النوع"><select value={b.type} onChange={(e) => upd("fixedBlocks", b.id, { type: e.target.value })}><Opts map={BTYPES} /></select></F>
                <F label="من"><input type="time" value={b.from} onChange={(e) => upd("fixedBlocks", b.id, { from: e.target.value })} /></F>
                <F label="إلى"><input type="time" value={b.to} onChange={(e) => upd("fixedBlocks", b.id, { to: e.target.value })} /></F>
                <button className="del" onClick={() => del("fixedBlocks", b.id)}>🗑</button>
              </div>
              <Days value={b.days} onChange={(v) => upd("fixedBlocks", b.id, { days: v })} />
            </div>
          ))}
          <button className="btn" onClick={() => set({ fixedBlocks: [...data.fixedBlocks, { id: uid(), days: [], type: "school", title: "", from: "07:00", to: "13:00" }] })}>+ إضافة موعد</button>
        </>
      )}

      {tab === "exams" && (
        <>
          {data.exams.map((x) => (
            <div className="card row" key={x.id}>
              <F label="المادة"><select value={x.subjectId} onChange={(e) => upd("exams", x.id, { subjectId: e.target.value })}>
                {data.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></F>
              <F label="التاريخ"><input type="date" value={x.date} onChange={(e) => upd("exams", x.id, { date: e.target.value })} /></F>
              <button className="del" onClick={() => del("exams", x.id)}>🗑</button>
            </div>
          ))}
          <button className="btn" disabled={!data.subjects.length} onClick={() => set({ exams: [...data.exams, { id: uid(), subjectId: data.subjects[0].id, date: data.weekStart }] })}>+ إضافة امتحان</button>
        </>
      )}
      
      {tab === "stats" && <Stats data={data} today={today} />}

      {tab === "plan" && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn" onClick={run}>⚙️ {data.plan ? "جدول جديد (محرك)" : "إنشاء الجدول (محرك)"}</button>
            <button className="btn" disabled={busy} onClick={runAI}>{busy ? "جارٍ التفكير…" : "✨ إنشاء بالـAI"}</button>
            {hasMissed && <button className="btn ghost" onClick={replan}>🔄 إعادة تنظيم الفائت</button>}
          </div>
          <div className="card"><F label="طلب للـAI (اختياري) مثل: خفف يوم الثلاثاء، زوّد مراجعة العلوم"><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></F></div>
          {!data.plan ? <div className="empty">أدخل بياناتك ثم اضغط «إنشاء الجدول».</div> : (
            <>
              <div className="card">الإنجاز: {done} من {counted.length} جلسة ({pct}%)<div className="bar"><i style={{ width: pct + "%" }} /></div></div>
              {problems.length > 0 && <div className="warn">⚠️ يوجد {problems.length} تعارض في الجدول.</div>}
              {DAY_NAMES.map((n, d) => {
                const ses = data.plan.filter((x) => x.day === d).sort((a, b) => a.from - b.from);
                const blocks = data.fixedBlocks.filter((b) => b.days.includes(d));
                return (
                  <section key={d} className={"card day" + (d === today ? " today" : "")}>
                    <h3>{n} <small>{addDays(data.weekStart, d).toLocaleDateString("ar-EG", { day: "numeric", month: "short" })}</small></h3>
                    {blocks.map((b) => <div key={b.id} className="blk">{b.from}–{b.to} {b.title || BTYPES[b.type]}</div>)}
                    {ses.map((x) => (
                      <div key={x.id} className={"ses " + x.status}>
                        <span>{toHHMM(x.from)}–{toHHMM(x.to)}</span>
                        <b>{subj(x.subjectId)}</b>
                        <span className="tag">{STYPES[x.type]}</span>
                        {x.status === "planned" ? <><button onClick={() => setStatus(x.id, "done")}>✓</button><button onClick={() => setStatus(x.id, "missed")}>✗</button></>
                          : !x.rescheduled && <button onClick={() => setStatus(x.id, "planned")}>↺</button>}
                      </div>
                    ))}
                    {!ses.length && <div className="blk">لا جلسات</div>}
                  </section>
                );
              })}
            </>
          )}
        </>
      )}
    </div>
  );
}