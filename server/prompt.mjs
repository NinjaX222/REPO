// يبني الـPrompt المنظم. الـAI يقترح، والمحرك (engine) هو الحكم النهائي.
export function buildPrompt(input, note, targets) {
  const lim = { maxSessionsPerDay: 4, maxMinutesPerDay: 240, ...(input.settings || {}) };
  const subjects = input.subjects.map((s) => ({
    id: s.id, name: s.name, level: s.level, priority: s.priority,
    targetMinutesThisWeek: targets[s.id] ?? 0,
  }));
  const data = {
    days: "0=Saturday,1=Sunday,2=Monday,3=Tuesday,4=Wednesday,5=Thursday,6=Friday",
    weekStart: input.weekStart,
    sleep: input.student.sleep,
    studyWindow: input.student.studyWindow,
    availableDays: input.student.availableDays,
    subjects,
    fixedBlocks: input.fixedBlocks,
    exams: input.exams,
  };
  return `You are a study-planning assistant for a secondary-school student.
Build ONE weekly study plan from the data below.

HARD RULES (a validator will reject violations):
1. Never overlap school, lessons, transport or any fixedBlocks.
2. Stay inside studyWindow and only on availableDays. Times are 24h "HH:MM".
3. Each session is 30-50 minutes, with at least 10 minutes between sessions on the same day.
4. At most ${lim.maxSessionsPerDay} sessions and ${lim.maxMinutesPerDay} minutes per day.
5. Never schedule a subject on or after its exam day.

Use only the subject ids given. Never return an empty list: if part of the student's request cannot be satisfied, ignore that part and return the best valid plan.

QUALITY RULES:
- Total minutes per subject should be close to targetMinutesThisWeek.
- Spread each subject across different days; avoid the same subject twice in one day.
- Go lighter on days after long school days; leave rest days lighter.
- Session types: understand (new lesson) -> practice -> review; use "test" for a self-test shortly before an exam.
${note ? `\nSTUDENT REQUEST (apply it without breaking the hard rules): ${note}\n` : ""}
DATA:
${JSON.stringify(data)}

Reply with JSON only, exactly this shape, no extra text:
{"sessions":[{"subjectId":"<id>","day":0,"from":"14:00","to":"14:45","type":"understand|practice|review|test"}]}`;
}