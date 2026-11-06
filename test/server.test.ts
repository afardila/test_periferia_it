/** Pruebas de seguridad HTTP: acceso, validación de entrada, límites y cabeceras. AC-22..AC-27 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

process.env.APP_PASSWORD = "clave-de-prueba";
process.env.RATE_LIMIT_PER_MIN = "12";
delete process.env.ANTHROPIC_API_KEY;
const { createApp } = await import("../src/server.js");

let srv: Server, base = "";
const auth = { Authorization: "Basic " + Buffer.from("evaluador:clave-de-prueba").toString("base64") };
before(async () => { srv = createApp().listen(0); await new Promise((r) => srv.once("listening", r)); base = `http://localhost:${(srv.address() as { port: number }).port}`; });
after(() => { srv.close(); });
const post = (p: string, body: unknown, h: Record<string, string> = auth) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });

test("AC-22 [!] sin credenciales: 401 en la app y en la API; con clave incorrecta también", async () => {
  assert.equal((await fetch(base + "/")).status, 401);
  assert.equal((await fetch(base + "/api/state?sessionId=abcdefgh12")).status, 401);
  const mala = { Authorization: "Basic " + Buffer.from("x:otra").toString("base64") };
  assert.equal((await fetch(base + "/", { headers: mala })).status, 401);
});

test("AC-23 [+] con credenciales sirve la app; /api/health es público y no expone secretos", async () => {
  assert.equal((await fetch(base + "/", { headers: auth })).status, 200);
  const h = await fetch(base + "/api/health");
  assert.equal(h.status, 200);
  const txt = await h.text();
  assert.ok(!/sk-ant|clave-de-prueba/.test(txt));
});

test("AC-24 [-] sessionId inválido, mensaje vacío o demasiado largo → 400", async () => {
  assert.equal((await post("/api/chat", { sessionId: "../../etc", message: "hola" })).status, 400);
  assert.equal((await post("/api/chat", { sessionId: "sesion-valida-1", message: "   " })).status, 400);
  assert.equal((await post("/api/chat", { sessionId: "sesion-valida-1", message: "x".repeat(8001) })).status, 400);
  assert.equal((await post("/api/confirm", { sessionId: "sesion-valida-1", approve: "si" })).status, 400);
});

test("AC-25 [!] sin ANTHROPIC_API_KEY responde un error claro (500) sin filtrar nada", async () => {
  const r = await post("/api/chat", { sessionId: "sesion-valida-1", message: "hola" });
  assert.equal(r.status, 500);
  assert.match(JSON.stringify(await r.json()), /ANTHROPIC_API_KEY/);
});

test("AC-26 [+] cabeceras de seguridad presentes y sin X-Powered-By", async () => {
  const r = await fetch(base + "/", { headers: auth });
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.ok(r.headers.get("content-security-policy"));
  assert.equal(r.headers.get("x-powered-by"), null);
});

test("AC-27 [+] el estado se entrega por sesión y el límite de uso responde 429", async () => {
  const s = await (await fetch(base + "/api/state?sessionId=sesion-estado-1", { headers: auth })).json();
  assert.ok(Array.isArray(s.maestro) && s.maestro.length >= 4);
  let status = 0;
  for (let i = 0; i < 20 && status !== 429; i++) status = (await fetch(base + "/api/tools", { headers: auth })).status;
  assert.equal(status, 429);
});
