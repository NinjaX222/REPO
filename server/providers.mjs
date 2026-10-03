// مزوّد الـAI قابل للتبديل بمتغيرات البيئة. المفتاح يبقى على السيرفر فقط.
async function call(url, init) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(45000) });
    if (r.ok) return r.json();
    const body = (await r.text()).slice(0, 300);
    if (attempt === 0 && [429, 500, 503].includes(r.status)) { await new Promise((ok) => setTimeout(ok, 2500)); continue; }
    throw new Error(`HTTP ${r.status}: ${body}`);
  }
}

export function makeProvider(env) {
  const { AI_PROVIDER = "gemini", AI_API_KEY, AI_MODEL } = env;
  if (!AI_API_KEY) return null;

  if (AI_PROVIDER === "gemini") {
    const model = AI_MODEL || "gemini-3.5-flash";
    return async (prompt) => {
      const j = await call(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": AI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 8192 },
        }),
      });
      return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    };
  }

  if (AI_PROVIDER === "openrouter") {
    if (!AI_MODEL) throw new Error("AI_MODEL is required for openrouter");
    return async (prompt) => {
      const j = await call("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0.4,
        }),
      });
      return j.choices?.[0]?.message?.content ?? "";
    };
  }
  throw new Error("Unknown AI_PROVIDER: " + AI_PROVIDER);
}
