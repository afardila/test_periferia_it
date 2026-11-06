/**
 * Pruebas de reglas de negocio SIN modelo. Cada test cita su criterio de aceptación (docs/SPEC.md).
 * Tipos: [+] positivo · [-] negativo · [!] excepción/seguridad.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { executeTool } from "../src/tools/registry.js";
import { tools } from "../src/tools/contratos.js";
import { createStore } from "../src/data.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (store: ReturnType<typeof createStore>, name: string, input: unknown): Promise<any> => {
  const r = await executeTool(tools, name, input, { store });
  return r.ok ? r.output : { __error: r.error };
};

const nuevo = (extra: Record<string, unknown> = {}) => ({
  numero: "CT-2026-040", cliente: "Ficticio Retail S.A.S.", nit: "900999000-1", objeto: "Implementación de tienda en línea",
  valor: 150_000_000, fecha_inicio: "2026-06-01", fecha_fin: "2027-05-31", comercial_email: "luis@ejemplo.test", id_mensaje: "msg-001",
  confianza: { numero: 0.99, cliente: 0.97, valor: 0.95, fecha_fin: 0.9 }, ...extra,
});

test("AC-01 [+] contrato nuevo con alta confianza queda vigente", async () => {
  const s = createStore();
  const r = await run(s, "registrar_contrato", nuevo());
  assert.equal(r.ok, true);
  assert.equal(r.estado, "vigente");
  assert.equal(s.maestro.find((x) => x.numero === "CT-2026-040")?.version, "1");
  assert.equal(s.auditoria.at(-1)?.tipo, "registro");
});

test("AC-02 [-] contrato duplicado se rechaza con DUPLICADO y no escribe", async () => {
  const s = createStore();
  const antes = s.maestro.length;
  const r = await run(s, "registrar_contrato", nuevo({ numero: "ct-2026-001" })); // mayúsculas/minúsculas no engañan
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "DUPLICADO");
  assert.equal(s.maestro.length, antes);
});

test("AC-03 [+] baja confianza deja pendiente_revision y señala el campo", async () => {
  const s = createStore();
  const r = await run(s, "registrar_contrato", nuevo({ confianza: { numero: 0.9, valor: 0.4 } }));
  assert.equal(r.estado, "pendiente_revision");
  assert.deepEqual(r.campos_baja_confianza, ["valor"]);
});

test("AC-04 [+] comercial fuera del catálogo genera advertencia COMERCIAL_NO_RESUELTO", async () => {
  const s = createStore();
  const r = await run(s, "registrar_contrato", nuevo({ comercial_email: "desconocido@otro.test" }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.advertencias, ["COMERCIAL_NO_RESUELTO"]);
});

test("AC-05 [+] otrosí actualiza fecha_fin y sube la versión con auditoría antes/después", async () => {
  const s = createStore();
  const r = await run(s, "actualizar_contrato", { numero: "CT-2026-002", tipo: "otrosi", cambios: { fecha_fin: "2026-11-10" }, id_mensaje: "msg-002" });
  assert.equal(r.ok, true);
  assert.equal(r.version, "2");
  assert.equal(r.contrato.fecha_fin, "2026-11-10");
  const ev = s.auditoria.at(-1)!;
  assert.equal((ev.detalle.antes as Record<string, string>).fecha_fin, "2026-08-10");
});

test("AC-06 [-] otrosí sobre contrato inexistente → NO_ENCONTRADO", async () => {
  const s = createStore();
  const r = await run(s, "actualizar_contrato", { numero: "CT-9999", tipo: "otrosi", cambios: { fecha_fin: "2026-11-10" }, id_mensaje: "m" });
  assert.equal(r.codigo, "NO_ENCONTRADO");
});

test("AC-07 [!] no se pueden cambiar campos protegidos (numero, version, cliente)", async () => {
  const s = createStore();
  for (const campo of ["numero", "version", "cliente"]) {
    const r = await run(s, "actualizar_contrato", { numero: "CT-2026-002", tipo: "correccion", cambios: { [campo]: "x" }, id_mensaje: "m" });
    assert.ok(r.__error, `debe rechazar ${campo}`);
  }
  assert.equal(s.maestro.find((x) => x.numero === "CT-2026-002")?.version, "1");
});

test("AC-08 [-] fechas inválidas o invertidas se rechazan", async () => {
  const s = createStore();
  assert.ok((await run(s, "registrar_contrato", nuevo({ fecha_fin: "2026-05-01" }))).__error, "fin < inicio");
  assert.ok((await run(s, "registrar_contrato", nuevo({ fecha_inicio: "01/06/2026" }))).__error, "formato");
  assert.ok((await run(s, "registrar_contrato", nuevo({ fecha_fin: "2027-13-45" }))).__error, "fecha inexistente");
  const r = await run(s, "actualizar_contrato", { numero: "CT-2026-002", tipo: "otrosi", cambios: { fecha_fin: "2020-01-01" }, id_mensaje: "m" });
  assert.equal(r.codigo, "FECHA_INVALIDA", "otrosí con fin anterior al inicio");
});

test("AC-09 [-] valor no positivo o campos vacíos se rechazan", async () => {
  const s = createStore();
  assert.ok((await run(s, "registrar_contrato", nuevo({ valor: -5 }))).__error);
  assert.ok((await run(s, "registrar_contrato", nuevo({ valor: 0 }))).__error);
  assert.ok((await run(s, "registrar_contrato", nuevo({ cliente: "   " }))).__error);
});

test("AC-10 [+] reporte de vencimientos: vencidos, críticos y orden por urgencia", async () => {
  const s = createStore();
  const r = await run(s, "reporte_vencimientos", { dias: 60 });
  const por = Object.fromEntries(r.alertas.map((a: { numero: string; severidad: string }) => [a.numero, a.severidad]));
  assert.equal(por["CT-2025-017"], "vencido");
  assert.equal(por["CT-2026-001"], "critica");
  assert.equal(por["CT-2025-030"], undefined, "fuera de la ventana");
  const dias = r.alertas.map((a: { dias_restantes: number }) => a.dias_restantes);
  assert.deepEqual(dias, [...dias].sort((a, b) => a - b));
});

test("AC-11 [-] búsqueda sin criterios y herramienta desconocida son errores controlados", async () => {
  const s = createStore();
  assert.ok((await run(s, "buscar_contrato", {})).__error);
  assert.match((await run(s, "borrar_todo", {})).__error, /desconocida/);
});

test("AC-12 [+] buscar por número, NIT y cliente parcial", async () => {
  const s = createStore();
  assert.equal((await run(s, "buscar_contrato", { numero: "CT-2026-001" })).length, 1);
  assert.equal((await run(s, "buscar_contrato", { nit: "900333444-5" })).length, 1);
  assert.equal((await run(s, "buscar_contrato", { cliente: "andina" })).length, 1);
  assert.equal((await run(s, "buscar_contrato", { numero: "NO-EXISTE" })).length, 0);
});

test("AC-13 [+] archivar guarda el adjunto bajo el contrato; [-] archivo inexistente falla", async () => {
  const s = createStore();
  const ok = await run(s, "archivar_documento", { id_mensaje: "msg-001", archivo: "contrato.txt", numero: "CT-2026-040" });
  assert.equal(ok.ok, true);
  assert.equal(s.archivo.length, 1);
  assert.equal((await run(s, "archivar_documento", { id_mensaje: "msg-001", archivo: "fantasma.txt", numero: "X" })).codigo, "ARCHIVO_NO_EXISTE");
});

test("AC-14 [!] path traversal bloqueado al leer y archivar", async () => {
  const s = createStore();
  for (const id of ["..", "../buzon", "msg-001/../..", "/etc", "msg-001\\..\\.."]) {
    const r = await run(s, "leer_mensaje", { id });
    assert.ok(r.error, `leer_mensaje(${id}) debe fallar`);
  }
  const r = await run(s, "archivar_documento", { id_mensaje: "msg-001", archivo: "../comerciales.json", numero: "X" });
  assert.equal(r.codigo, "NOMBRE_NO_VALIDO");
  assert.equal(s.archivo.length, 0);
});

test("AC-15 [!] aislamiento: lo registrado en una sesión no aparece en otra", async () => {
  const a = createStore(), b = createStore();
  await run(a, "registrar_contrato", nuevo());
  await run(a, "actualizar_contrato", { numero: "CT-2026-002", tipo: "otrosi", cambios: { fecha_fin: "2026-11-10" }, id_mensaje: "m" });
  assert.equal(b.maestro.some((r) => r.numero === "CT-2026-040"), false);
  assert.equal(b.maestro.find((r) => r.numero === "CT-2026-002")?.version, "1");
  assert.equal(b.auditoria.length, 0);
});

test("AC-16 [+] el buzón lista los mensajes y leer_mensaje devuelve correo y adjuntos", async () => {
  const s = createStore();
  const lista = await run(s, "listar_buzon", {});
  assert.ok(lista.length >= 3);
  const m = await run(s, "leer_mensaje", { id: "msg-002" });
  assert.match(m.archivos[0].texto, /prorroga/i);
});
