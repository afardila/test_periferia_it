import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { chat, confirm, resetSession, storeOf, usageOf } from "./agent.js";
import { tools } from "./tools/contratos.js";

const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_MESSAGE = 8000;

const sha = (s: string) => crypto.createHash("sha256").update(s).digest();

/**
 * App HTTP. Seguridad:
 *  - APP_PASSWORD (opcional): si existe, todo exige HTTP Basic (usuario libre, esa contraseña). /api/health queda abierto.
 *  - Límite de peticiones por IP (RATE_LIMIT_PER_MIN) para proteger el costo de la API key.
 *  - Cabeceras de seguridad, ids de sesión validados, mensajes acotados, sin trazas en errores.
 */
export function createApp() {
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

  app.get("/api/health", (_req, res) => res.json({ ok: true, llm: Boolean(process.env.ANTHROPIC_API_KEY) }));

  // Control de acceso
  app.use((req, res, next) => {
    const pass = process.env.APP_PASSWORD;
    if (!pass) return next();
    const h = req.headers.authorization ?? "";
    const given = h.startsWith("Basic ") ? Buffer.from(h.slice(6), "base64").toString().split(":").slice(1).join(":") : "";
    if (crypto.timingSafeEqual(sha(given), sha(pass))) return next();
    res.setHeader("WWW-Authenticate", 'Basic realm="Agente"');
    res.status(401).json({ error: "No autorizado" });
  });

  // Límite de uso por IP (ventana de 1 minuto)
  const hits = new Map<string, { n: number; reset: number }>();
  app.use("/api", (req, res, next) => {
    const max = Number(process.env.RATE_LIMIT_PER_MIN ?? 60);
    const now = Date.now(), ip = req.ip ?? "?";
    const h = hits.get(ip);
    if (!h || now > h.reset) hits.set(ip, { n: 1, reset: now + 60_000 });
    else if (++h.n > max) return res.status(429).json({ events: [{ type: "error", message: "Demasiadas solicitudes. Espera un minuto." }] });
    next();
  });

  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

  const bad = (res: express.Response, message: string) => res.status(400).json({ events: [{ type: "error", message }] });
  const needKey = (res: express.Response) => {
    if (process.env.ANTHROPIC_API_KEY) return false;
    res.status(500).json({ events: [{ type: "error", message: "Falta ANTHROPIC_API_KEY en el servidor." }] });
    return true;
  };

  app.get("/api/tools", (_req, res) =>
    res.json(tools.map((t) => ({ name: t.name, requiresConfirmation: Boolean(t.requiresConfirmation), description: t.description }))));

  // Estado del maestro simulado DE ESA SESIÓN (para revisar el antes/después de cada operación)
  app.get("/api/state", (req, res) => {
    const sid = String(req.query.sessionId ?? "");
    if (!SESSION_ID.test(sid)) return bad(res, "sessionId inválido");
    res.json(storeOf(sid));
  });

  app.post("/api/chat", async (req, res) => {
    const { sessionId, message } = req.body ?? {};
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return bad(res, "sessionId inválido");
    if (typeof message !== "string" || !message.trim()) return bad(res, "message es obligatorio");
    if (message.length > MAX_MESSAGE) return bad(res, `El mensaje supera ${MAX_MESSAGE} caracteres`);
    if (needKey(res)) return;
    res.json({ events: await chat(sessionId, message), usage: usageOf(sessionId) });
  });

  app.post("/api/confirm", async (req, res) => {
    const { sessionId, approve, note } = req.body ?? {};
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return bad(res, "sessionId inválido");
    if (typeof approve !== "boolean") return bad(res, "approve debe ser booleano");
    if (needKey(res)) return;
    res.json({ events: await confirm(sessionId, approve, typeof note === "string" ? note.slice(0, 500) : undefined), usage: usageOf(sessionId) });
  });

  // Reinicia la sesión (conversación + maestro de ESA sesión)
  app.post("/api/reset", (req, res) => {
    const { sessionId } = req.body ?? {};
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return bad(res, "sessionId inválido");
    resetSession(sessionId);
    res.json({ ok: true });
  });

  // Errores inesperados: sin detalles internos
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err.message);
    res.status(400).json({ events: [{ type: "error", message: "Solicitud no válida" }] });
  });

  return app;
}
