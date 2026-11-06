/** Ciclo del agente con un proveedor LLM falso (sin red). AC-37..42 y AC-40 (guardia de confirmación). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { crearAgente } from "../src/agent.js";
import { ErrorLLM, type LLM, type Mensaje, type RespuestaLLM } from "../src/llm/adapter.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const uso = { input: 100, output: 50, cache_read: 0, cache_write: 0 };
const llamada = (name: string, input: unknown, id = `tu_${Math.random().toString(36).slice(2, 8)}`): RespuestaLLM => ({ texto: "", llamadas: [{ id, name, input }], uso });
const texto = (t: string): RespuestaLLM => ({ texto: t, llamadas: [], uso });
const falso = (f: (m: Mensaje[], i: number) => RespuestaLLM | Error): LLM => {
  let i = 0;
  return { proveedor: "falso", modelo: "falso-1", async enviar(m) { const r = f(m, i++); if (r instanceof Error) throw r; return r; } };
};
let n = 0; const sid = () => `agt-${process.pid}-${++n}`;
const nuevo = (llm: LLM, o: { maxIter?: number; maxTokens?: number } = {}) => crearAgente({ llm, directory: ROOT, ...o });

test("AC-37 [+] el ciclo ejecuta herramientas y termina con texto", async () => {
  const a = nuevo(falso((_m, i) => (i === 0 ? llamada("contratos_leer_buzon", {}) : texto("Hay 6 mensajes."))));
  const r = await a.chat(sid(), "Procesa el buzón");
  assert.equal(r.reply, "Hay 6 mensajes."); assert.equal(r.toolCalls.length, 1); assert.equal(r.toolCalls[0].name, "contratos_leer_buzon"); assert.equal(r.toolCalls[0].ok, true);
});
test("AC-37 [-] al llegar al tope de iteraciones responde con lo hecho y lo que falta", async () => {
  const a = nuevo(falso(() => llamada("contratos_leer_buzon", {})), { maxIter: 3 });
  const r = await a.chat(sid(), "x");
  assert.equal(r.toolCalls.length, 3); assert.match(r.reply, /tope de 3 iteraciones/i); assert.match(r.reply, /contin/i);
});
test("AC-38 [+] el ciclo solo depende de la interfaz LLM (sin proveedor real)", async () => {
  const visto: string[] = [];
  const a = nuevo(falso((m) => { visto.push(m[0].role); return texto("ok"); }));
  await a.chat(sid(), "hola"); assert.equal(visto[0], "system");
  assert.equal(a.llm.proveedor, "falso");
});
test("AC-39 [+] si registrar pide revisión, la respuesta marca needsConfirmation", async () => {
  const a = nuevo(falso((_m, i) => (i === 0 ? llamada("contratos_registrar", { mensaje_id: "msg-006" }) : texto("msg-006 requiere confirmar valor y fecha_fin. ¿Confirmas?"))));
  const r = await a.chat(sid(), "procesa msg-006");
  assert.equal(r.needsConfirmation, true); assert.equal(r.toolCalls[0].ok, false); assert.match(String(r.toolCalls[0].output), /requiere revisión/);
});
test("AC-40 [-] el modelo no puede autoconfirmar: confirmado=true se rechaza hasta que el usuario responda", async () => {
  const id = sid();
  const a = nuevo(falso((m, i) => {
    if (i === 0) return llamada("contratos_registrar", { mensaje_id: "msg-006" });
    if (i === 1) return llamada("contratos_registrar", { mensaje_id: "msg-006", confirmado: true }); // intento de autoconfirmación en el mismo turno
    if (i === 2) return texto("¿Confirmas?");
    return i === 3 ? llamada("contratos_registrar", { mensaje_id: "msg-006", confirmado: true }) : texto("Registrado.");
  }));
  const r1 = await a.chat(id, "procesa msg-006");
  assert.equal(r1.toolCalls[1].ok, false); assert.match(String(r1.toolCalls[1].output), /no permitido/);
  assert.ok(!fs.existsSync(path.join(ROOT, "out", id, "sharepoint", "historial.jsonl")));
  const r2 = await a.chat(id, "confirmo valor 0 y fecha fin 2027-08-31"); // ahora el usuario respondió
  assert.equal(r2.toolCalls[0].ok, true, JSON.stringify(r2.toolCalls[0]));
  assert.ok(fs.existsSync(path.join(ROOT, "out", id, "sharepoint", "historial.jsonl")));
});
test("AC-41 [+] cada llamada queda en historial de sesión y en out/<sesión>/log.jsonl", async () => {
  const id = sid();
  const a = nuevo(falso((_m, i) => (i === 0 ? llamada("contratos_leer_buzon", {}) : texto("listo"))));
  await a.chat(id, "hola");
  const h = a.historial(id)!; assert.ok(h.eventos.some((e) => e.type === "tool")); assert.ok(h.eventos.some((e) => e.type === "user"));
  const log = fs.readFileSync(path.join(ROOT, "out", id, "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(Object.keys(log[0]).sort(), ["herramienta", "mensaje_id", "ok", "resumen", "ts"]);
});
test("AC-42 [!] un fallo del proveedor se informa en claro y la sesión sigue viva", async () => {
  const id = sid();
  const a = nuevo(falso((_m, i) => (i === 0 ? new ErrorLLM("El modelo tardó demasiado en responder (timeout).") : texto("ya estoy de vuelta"))));
  const r1 = await a.chat(id, "hola"); assert.match(r1.reply, /timeout/); assert.equal(r1.status, 200);
  const r2 = await a.chat(id, "otra vez"); assert.equal(r2.reply, "ya estoy de vuelta");
});
test("AC-43 [-] el tope de tokens por sesión corta antes de llamar al modelo", async () => {
  let llamadas = 0; const id = sid();
  const a = nuevo(falso(() => { llamadas++; return texto("ok"); }), { maxTokens: 120 });
  await a.chat(id, "uno"); // gasta 150 tokens (100+50) → supera 120
  const r = await a.chat(id, "dos");
  assert.equal(r.status, 429); assert.match(r.reply, /tope de tokens/i); assert.equal(llamadas, 1);
});
test("AC-46 [+] las sesiones están aisladas (estado de A no aparece en B)", async () => {
  const A = sid(), B = sid();
  const a = nuevo(falso((_m, i) => (i % 2 === 0 ? llamada("contratos_registrar", { mensaje_id: "msg-001" }) : texto("ok"))));
  await a.chat(A, "procesa msg-001");
  assert.equal(a.estado(A).maestro.some((f) => f.id_contrato === "CT-2026-015"), true);
  assert.equal(a.estado(B).maestro.some((f) => f.id_contrato === "CT-2026-015"), false);
});
