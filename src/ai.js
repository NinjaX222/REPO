const API = import.meta.env.VITE_API_URL || "";

async function post(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("http_" + r.status);
  return r.json();
}

export const aiPlan = (input, note) => post("/api/plan", { input, note });
export const aiAnalyze = (stats) => post("/api/analyze", { stats });