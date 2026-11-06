/**
 * Pruebas del bucle del agente SIN API real: un servidor falso imita /v1/messages con respuestas guionadas.
 * AC-17..AC-20: confirmación humana, rechazo, aislamiento por sesión y tope de iteraciones.
 */
import http from "node:http";
import { test, after } from "node:test";
import assert from "node:assert/strict";

type Bloque = Record<string, unknown>;
let guion: Bloque[][] = [];
let n = 0;
const fake = http.createServer((req, res) => {
  req.resume().on("end", () => {
    const content = guion[Math.min(n++, guion.length - 1)];
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: "msg_" + n, type: "message", role: "assistant", model: "fake", content,
      stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20 },
    }));
  });
});
await new Promise<void>((r) => fake.listen(0, r));
process.env.ANTHROPIC_API_KEY = "test";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${(fake.address() as { port: number }).port}`;
after(() => { fake.close(); });

const { chat, confirm, storeOf, usageOf } = await import("../src/agent.js");

const registro = (numero: string) => ({
  type: "tool_use", id: "t2", name: "registrar_contrato",
  input: { numero, cliente: "Test S.A.", objeto: "X", valor: 10, fecha_inicio: "2026-06-01", fecha_fin: "2027-06-01", id_mensaje: "m", confianza: { numero: 0.9 } },
});
const flujo = (numero: string) => [
  [{ type: "tool_use", id: "t1", name: "buscar_contrato", input: { numero } }],
  [{ type: "text", text: "No existe; lo registro." }, registro(numero)],
  [{ type: "text", text: "Contrato registrado." }],
];
const existe = (sid: string, numero: string) => storeOf(sid).maestro.some((r) => r.numero === numero);

test("AC-17 [+] consulta sin permiso, pausa antes de escribir, escribe solo tras aprobar", async () => {
  guion = flujo("CT-2026-050"); n = 0;
  const e1 = await chat("sesion-aaaa-1", "registra CT-2026-050");
  assert.ok(e1.some((e) => e.type === "tool_result" && e.name === "buscar_contrato"));
  assert.ok(e1.some((e) => e.type === "confirmation_required"));
  assert.equal(existe("sesion-aaaa-1", "CT-2026-050"), false, "no escribe antes de aprobar");
  assert.equal((await chat("sesion-aaaa-1", "otra cosa"))[0].type, "error", "bloquea mensajes con confirmación pendiente");

  const e2 = await confirm("sesion-aaaa-1", true);
  assert.equal(existe("sesion-aaaa-1", "CT-2026-050"), true);
  assert.ok(e2.some((e) => e.type === "text" && e.text.includes("registrado")));
  assert.equal(usageOf("sesion-aaaa-1").calls, 3);
});

test("AC-18 [-] si el humano rechaza, no se escribe y el rechazo vuelve al modelo", async () => {
  guion = flujo("CT-2026-051"); n = 0;
  await chat("sesion-bbbb-2", "registra");
  const e = await confirm("sesion-bbbb-2", false, "no corresponde");
  assert.equal(existe("sesion-bbbb-2", "CT-2026-051"), false);
  assert.ok(e.some((x) => x.type === "tool_result" && !x.ok));
});

test("AC-19 [!] aislamiento: aprobar en una sesión no cambia el maestro de otra", async () => {
  guion = flujo("CT-2026-052"); n = 0;
  await chat("sesion-cccc-3", "registra"); await confirm("sesion-cccc-3", true);
  assert.equal(existe("sesion-cccc-3", "CT-2026-052"), true);
  assert.equal(existe("sesion-bbbb-2", "CT-2026-052"), false);
  assert.equal(existe("sesion-nueva-9", "CT-2026-052"), false);
});

test("AC-20 [!] el bucle se corta al llegar al tope de iteraciones", async () => {
  guion = [[{ type: "tool_use", id: "tx", name: "listar_buzon", input: {} }]]; n = 0; // pide la misma tool para siempre
  const e = await chat("sesion-dddd-4", "bucle");
  assert.ok(e.some((x) => x.type === "error" && /máximo/.test(x.message)));
  assert.ok(n <= 13);
});

test("AC-21 [-] entrada inválida del modelo vuelve como error y no escribe", async () => {
  guion = [
    [{ type: "tool_use", id: "t1", name: "buscar_contrato", input: {} }],
    [{ type: "text", text: "Corrijo." }],
  ]; n = 0;
  const e = await chat("sesion-eeee-5", "busca");
  const r = e.find((x) => x.type === "tool_result");
  assert.ok(r && r.type === "tool_result" && !r.ok);
  assert.ok(e.some((x) => x.type === "text"));
});
