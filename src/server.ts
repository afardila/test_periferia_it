import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Agente } from "./agent.js";
import { tools } from "./tools/index.js";

const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_MESSAGE = 8000;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest();

/**
 * App HTTP. Seguridad:
 *  - APP_PASSWORD (opcional): si existe, todo exige HTTP Basic (usuario libre). /api/health queda abierto.
 *  - Límite de peticiones por IP (RATE_LIMIT_PER_MIN) y tope de tokens por sesión (en el agente).
 *  - Cabeceras de seguridad, ids de sesión validados, mensajes acotados, errores sin detalles internos.
 */
export function createApp({ agente }: { agente: Agente }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "64kb" }));

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
    next();
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true, provider: agente.llm.proveedor, model: agente.llm.modelo }));

  app.use((req, res, next) => {
    const pass = process.env.APP_PASSWORD;
    if (!pass) return next();
    const h = req.headers.authorization ?? "";
    const given = h.startsWith("Basic ") ? Buffer.from(h.slice(6), "base64").toString().split(":").slice(1).join(":") : "";
    if (crypto.timingSafeEqual(sha(given), sha(pass))) return next();
    res.setHeader("WWW-Authenticate", 'Basic realm="Agente"');
    res.status(401).json({ error: "No autorizado" });
  });

  const hits = new Map<string, { n: number; reset: number }>();
  app.use("/api", (req, res, next) => {
    const max = Number(process.env.RATE_LIMIT_PER_MIN ?? 60);
    const now = Date.now(), ip = req.ip ?? "?"; const h = hits.get(ip);
    if (!h || now > h.reset) hits.set(ip, { n: 1, reset: now + 60_000 });
    else if (++h.n > max) return res.status(429).json({ reply: "Demasiadas solicitudes. Espera un minuto.", events: [{ type: "error", message: "Demasiadas solicitudes. Espera un minuto." }] });
    next();
  });

  app.use(express.static(fileURLToPath(new URL("../web", import.meta.url)), { etag: false, lastModified: false, setHeaders: (res) => res.setHeader("Cache-Control", "no-store") })); // sin caché: cada despliegue se ve al recargar
  const bad = (res: express.Response, message: string) => res.status(400).json({ reply: message, events: [{ type: "error", message }] });

  app.get("/api/tools", (_req, res) => res.json(tools.map((t) => ({ name: t.name, description: t.description }))));

  app.get("/api/state", (req, res) => {
    const sid = String(req.query.sessionId ?? ""); if (!SESSION_ID.test(sid)) return bad(res, "sessionId inválido");
    res.json(agente.estado(sid));
  });

  app.get("/api/sessions/:id", (req, res) => {
    const id = String(req.params.id); if (!SESSION_ID.test(id)) return bad(res, "sessionId inválido");
    const h = agente.historial(id); if (!h) return res.status(404).json({ error: "Sesión no encontrada" });
    res.json(h);
  });

  app.post("/api/chat", async (req, res) => {
    const { sessionId, message } = req.body ?? {};
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return bad(res, "sessionId inválido");
    if (typeof message !== "string" || !message.trim()) return bad(res, "message es obligatorio");
    if (message.length > MAX_MESSAGE) return bad(res, `El mensaje supera ${MAX_MESSAGE} caracteres`);
    const r = await agente.chat(sessionId, message);
    res.status(r.status).json({ reply: r.reply, toolCalls: r.toolCalls, needsConfirmation: r.needsConfirmation, events: r.events, usage: r.usage });
  });

  app.post("/api/reset", (req, res) => {
    const { sessionId } = req.body ?? {}; if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return bad(res, "sessionId inválido");
    agente.reset(sessionId); res.json({ ok: true });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(err.message); bad(res, "Solicitud no válida"); });
  return app;
}
