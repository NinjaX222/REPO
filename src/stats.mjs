// جَدول — حساب التقدم وتحليل الأداء (بدون AI). uptoDay = آخر يوم يُحسب (حتى اليوم الحالي).
const mins = (x) => x.to - x.from;
const sum = (l) => l.reduce((a, x) => a + mins(x), 0);
const pct = (d, p) => (p ? Math.round((d / p) * 100) : 0);

export function computeStats(plan = [], subjects = [], uptoDay = 6) {
  // الفائت الذي أُعيدت جدولته لا يُحسب (تعويضه هو الذي يُحسب)
  const live = plan.filter((x) => x.day <= uptoDay && !(x.status === "missed" && x.rescheduled));
  const done = (l) => l.filter((x) => x.status === "done");
  const bySubject = subjects
    .map((s) => {
      const own = live.filter((x) => x.subjectId === s.id);
      const plannedMin = sum(own), doneMin = sum(done(own));
      return { id: s.id, name: s.name, plannedMin, doneMin, missed: own.filter((x) => x.status === "missed").length, pct: pct(doneMin, plannedMin) };
    })
    .filter((s) => s.plannedMin > 0);
  const byDay = Array.from({ length: 7 }, (_, d) => {
    const own = live.filter((x) => x.day === d);
    return { day: d, plannedMin: sum(own), doneMin: sum(done(own)) };
  });
  const plannedMin = sum(live), doneMin = sum(done(live));
  return {
    plannedMin, doneMin, pct: pct(doneMin, plannedMin),
    sessions: { total: live.length, done: done(live).length, missed: live.filter((x) => x.status === "missed").length },
    bySubject, byDay,
  };
}

// تحليل بسيط بالقواعد: يُستخدم كبديل لو الـAI غير متاح.
export function analyzeLocal(stats) {
  const weak = stats.bySubject.filter((s) => s.pct < 60).sort((a, b) => a.pct - b.pct);
  const names = (l) => l.map((s) => s.name).join("، ");
  const summary = !stats.sessions.total
    ? "لا توجد جلسات حتى الآن."
    : `أنجزت ${stats.pct}% (${stats.sessions.done} من ${stats.sessions.total} جلسة).` +
      (weak.length ? ` أضعف التزام في: ${names(weak)}.` : " التزامك جيد في كل المواد.");
  const nextWeekNote = weak.length
    ? `ركّز على ${names(weak)}: ضعها في أيام أخف وبجلسات أقصر، وأبقِ باقي المواد كما هي.`.slice(0, 300)
    : "";
  const tips = stats.bySubject.map((s) => ({
    subjectId: s.id,
    text: s.pct < 60 ? `منفّذ ${s.pct}% فقط: قصّر الجلسات ووزّعها على أيام أخف.` : s.pct >= 90 ? `ممتاز (${s.pct}%).` : `${s.pct}%: استمر.`,
  }));
  return { summary, nextWeekNote, tips };
}
