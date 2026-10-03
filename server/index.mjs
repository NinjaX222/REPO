import http from "node:http";
import { planHandler } from "./plan.mjs";
import { analyzeHandler } from "./analyze.mjs";
import { makeProvider } from "./providers.mjs";

const PORT = process.env.PORT || 8787;
const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const callModel = makeProvider(process.env);
const hits = new Map();
const limited = (ip) => {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 10; // 10 طلبات/دقيقة لكل IP
};

const ROUTES = {
  "/api/plan": { run: planHandler, ok: (b) => b.input?.student && Array.isArray(b.input.subjects) },
  "/api/analyze": { run: analyzeHandler, ok: (b) => Array.isArray(b.stats?.bySubject) && b.stats.sessions },
};

const send = (res, code, body) => {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  });
  res.end(JSON.stringify(body));
};

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.url === "/health") return send(res, 200, { ok: true, ai: !!callModel });
  const route = ROUTES[req.url];
  if (req.method !== "POST" || !route) return send(res, 404, { error: "not_found" });
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0];
  if (limited(ip)) return send(res, 429, { error: "too_many_requests" });

  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) return send(res, 413, { error: "too_large" }); }
  try {
    const body = JSON.parse(raw);
    if (!route.ok(body)) return send(res, 400, { error: "bad_input" });
    send(res, 200, await route.run(body, callModel));
  } catch {
    send(res, 400, { error: "bad_request" });
  }
}).listen(PORT, () => console.log(`Jadwal API on :${PORT} (AI ${callModel ? "on" : "off"})`));
