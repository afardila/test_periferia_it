/** Pruebas del procesamiento determinista del buzón (lo que ejecuta demo.ts). AC-28..AC-32 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/data.js";
import { aISO, clasificar, extraerContrato, procesarBuzon, procesarMensaje } from "../src/pipeline.js";

test("AC-28 [+] el buzón se procesa completo con el resultado esperado por mensaje", async () => {
  const s = createStore();
  const r = await procesarBuzon(s);
  const por = Object.fromEntries(r.map((x) => [x.id, x.clasificacion]));
  assert.deepEqual(por, { "msg-001": "nuevo", "msg-002": "otrosi", "msg-003": "duplicado", "msg-004": "no_contrato" });
  assert.ok(s.maestro.some((c) => c.numero === "CT-2026-040" && c.estado === "vigente"));
  assert.equal(s.maestro.find((c) => c.numero === "CT-2026-002")?.fecha_fin, "2026-11-10");
  assert.equal(s.rechazados.length, 1);
  assert.equal(s.archivo.length, 2, "se archivan el contrato nuevo y el otrosí");
});

test("AC-29 [!] determinismo: dos corridas independientes dan resultados idénticos", async () => {
  assert.deepEqual(await procesarBuzon(createStore()), await procesarBuzon(createStore()));
});

test("AC-30 [!] independencia: el orden de procesamiento no cambia el resultado de cada caso", async () => {
  const s1 = createStore(), s2 = createStore();
  const ids = ["msg-001", "msg-002", "msg-003", "msg-004"];
  const a = await Promise.all([]).then(async () => { const o = []; for (const i of ids) o.push(await procesarMensaje(s1, i)); return o; });
  const b = await Promise.all([]).then(async () => { const o = []; for (const i of [...ids].reverse()) o.push(await procesarMensaje(s2, i)); return o; });
  const k = (l: typeof a) => JSON.stringify([...l].sort((x, y) => x.id.localeCompare(y.id)));
  assert.equal(k(a), k(b));
});

test("AC-31 [-] un mensaje que no es contrato se rechaza con motivo y no toca el maestro", async () => {
  const s = createStore();
  const antes = JSON.stringify(s.maestro);
  const r = await procesarMensaje(s, "msg-004");
  assert.equal(r.clasificacion, "no_contrato");
  assert.equal(JSON.stringify(s.maestro), antes);
  assert.match(s.rechazados[0].motivo, /no contiene/);
});

test("AC-32 [+] extracción: clasifica, convierte fechas y marca menor confianza al inferir del remitente", () => {
  assert.equal(aISO("1 de junio de 2026"), "2026-06-01");
  assert.equal(aISO("2026-01-15"), "2026-01-15");
  assert.equal(aISO("31 de mayo de 2027"), "2027-05-31");
  assert.equal(aISO("32 de sinmes de 2027"), null);
  assert.equal(clasificar("OTROSÍ No. 1 al contrato CT-2026-002"), "otrosi");
  assert.equal(clasificar("Aprovecha 20% de descuento"), "no_contrato");
  const d = extraerContrato("CONTRATO No. CT-9\nCliente: Uno S.A. NIT 900.1-2\nObjeto: X\nValor: $1.500.000 COP\nVigencia: del 1 de junio de 2026 al 31 de mayo de 2027", "ana@ejemplo.test");
  assert.equal(d.valor, 1_500_000);
  assert.equal(d.fecha_fin, "2027-05-31");
  assert.equal(d.comercial_email, "ana@ejemplo.test");
  assert.equal(d.confianza.comercial_email, 0.7);
});
