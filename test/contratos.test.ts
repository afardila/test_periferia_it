/** Pruebas de herramientas (sin modelo). Cada nombre empieza con su AC de docs/SPEC.md. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { tools } from "../src/tools/index.js";
import { llamar, type ToolCtx } from "../src/tools/registry.js";
import { leerMaestro, outDir } from "../src/tools/maestro.js";

const ROOT = path.resolve(import.meta.dirname, "..");
let n = 0;
const nuevoCtx = (): ToolCtx => ({ directory: ROOT, sessionId: `test-${process.pid}-${++n}` });
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (name: string, args: unknown, ctx: ToolCtx) => llamar(tools, `contratos_${name}`, args, ctx);
const data = (r: { data?: unknown }) => r.data as D;
const extraer = async (ctx: ToolCtx, id: string) => { const r = await call("extraer", { mensaje_id: id }, ctx); assert.ok(r.ok, r.error ?? ""); return data(r); };
const fila = (ctx: ToolCtx, id: string) => leerMaestro(ctx).find((f) => f.id_contrato === id);

function hashDir(dir: string): string {
  const h = crypto.createHash("sha256");
  const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else h.update(p).update(fs.readFileSync(p));
  });
  walk(dir);
  return h.digest("hex");
}

// ───────── HU-1
test("AC-01 [+] leer_buzon lista los 6 mensajes con el formato del PRD", async () => {
  const r = await call("leer_buzon", {}, nuevoCtx());
  const m = data(r).mensajes as D[];
  assert.equal(m.length, 6);
  for (const x of m) assert.deepEqual(Object.keys(x).sort(), ["adjuntos", "asunto", "de", "fecha", "id", "tiene_contrato"].concat(x.motivo ? ["clasificacion", "motivo"] : []).sort());
});
test("AC-02 [+] solo msg-005 (cotización) trae tiene_contrato=false con motivo", async () => {
  const m = data(await call("leer_buzon", {}, nuevoCtx())).mensajes as D[];
  assert.deepEqual(m.filter((x) => !x.tiene_contrato).map((x) => x.id), ["msg-005"]);
  assert.match(m.find((x) => x.id === "msg-005")!.motivo, /cotizaci/i); assert.equal(m.find((x) => x.id === "msg-005")!.clasificacion, "rechazado");
});
test("AC-03 [+] los mensajes ya procesados no se listan", async () => {
  const ctx = nuevoCtx();
  assert.ok((await call("registrar", { mensaje_id: "msg-001" }, ctx)).ok);
  const ids = (data(await call("leer_buzon", {}, ctx)).mensajes as D[]).map((x) => x.id);
  assert.equal(ids.length, 5); assert.ok(!ids.includes("msg-001"));
});

// ───────── HU-2
test("AC-04 [+] extraer msg-001", async () => {
  const c = await extraer(nuevoCtx(), "msg-001");
  assert.equal(c.id_contrato, "CT-2026-015"); assert.equal(c.cliente, "Industrias Delta S.A.S.");
  assert.equal(c.nit_cliente, "890900111"); assert.equal(c.pais, "CO");
  assert.equal(c.valor, 265000000); assert.equal(c.moneda, "COP");
  assert.equal(c.fecha_inicio, "2026-08-01"); assert.equal(c.fecha_fin, "2027-07-31");
  assert.equal(c.requiere_poliza, true); assert.equal(c.tipo_poliza, "cumplimiento");
  assert.equal(c.comercial, "Laura Gómez Restrepo");
  for (const k of ["id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda", "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza"]) assert.ok(c.confianza[k] >= 0.8, k);
});
test("AC-05 [+] extraer msg-002 (RUC, miles con coma, sin póliza)", async () => {
  const c = await extraer(nuevoCtx(), "msg-002");
  assert.equal(c.id_contrato, "CT-2026-016"); assert.equal(c.nit_cliente, "1790012345001"); assert.equal(c.pais, "EC");
  assert.equal(c.valor, 120000); assert.equal(c.moneda, "USD");
  assert.equal(c.fecha_inicio, "2026-08-15"); assert.equal(c.fecha_fin, "2027-08-14");
  assert.equal(c.requiere_poliza, false); assert.ok(!c.tipo_poliza);
});
test("AC-06 [+] extraer msg-003 (otrosí): lo ausente es null con confianza 0", async () => {
  const c = await extraer(nuevoCtx(), "msg-003");
  assert.equal(c.es_otrosi, true); assert.equal(c.id_contrato, "CT-2026-011");
  assert.equal(c.valor, 520000); assert.equal(c.moneda, "PEN"); assert.equal(c.fecha_fin, "2027-11-01");
  for (const k of ["objeto", "fecha_inicio"]) { assert.equal(c[k], null); assert.equal(c.confianza[k] ?? 0, 0); }
  assert.ok((c.alertas as string[]).some((a) => /garant/i.test(a)), "alerta de ampliación de garantías");
});
test("AC-07 [+] extraer msg-004", async () => {
  const c = await extraer(nuevoCtx(), "msg-004");
  assert.equal(c.id_contrato, "CT-2026-012"); assert.equal(c.nit_cliente, "890903456");
  assert.equal(c.valor, 210000000); assert.equal(c.fecha_inicio, "2026-05-15"); assert.equal(c.fecha_fin, "2026-11-14");
});
test("AC-08 [+] extraer msg-006: valor por demanda, fechas derivadas con baja confianza y alerta", async () => {
  const c = await extraer(nuevoCtx(), "msg-006");
  assert.equal(c.id_contrato, "CM-2026-03"); assert.equal(c.nit_cliente, "800222333");
  assert.equal(c.valor_indeterminado, true); assert.equal(c.valor, 0); assert.ok(c.confianza.valor < 0.8);
  assert.equal(c.fecha_inicio, "2026-08-31"); assert.equal(c.confianza.fecha_inicio, 0.8);
  assert.equal(c.fecha_fin, "2027-08-31"); assert.ok(c.confianza.fecha_fin < 0.8);
  assert.equal(c.comercial, null);
  const a = (c.alertas as string[]).join(" | ");
  assert.match(a, /d[ií]a de inicio/i); assert.match(a, /jperez@periferia-ficticia\.com/);
});
test("AC-09 [!] extraer con id inexistente o con ../ devuelve error legible sin lanzar", async () => {
  for (const id of ["msg-999", "../fixtures", "msg-001/../../x", ""]) {
    const r = await call("extraer", { mensaje_id: id }, nuevoCtx());
    assert.equal(r.ok, false); assert.ok(typeof r.error === "string" && r.error.length > 5);
  }
});
test("AC-10 [-] extraer msg-005 (cotización) no inventa un contrato", async () => {
  const r = await call("extraer", { mensaje_id: "msg-005" }, nuevoCtx());
  assert.equal(r.ok, false); assert.match(r.error!, /no contiene un contrato/i);
});
test("AC-11 [!] extraer es determinista", async () => {
  const a = await call("extraer", { mensaje_id: "msg-006" }, nuevoCtx());
  const b = await call("extraer", { mensaje_id: "msg-006" }, nuevoCtx());
  assert.deepEqual(a, b);
});

// ───────── HU-3
test("AC-12 [+] validar msg-001 → nuevo sin revisión", async () => {
  const ctx = nuevoCtx(); const v = data(await call("validar", { mensaje_id: "msg-001", contrato: await extraer(ctx, "msg-001") }, ctx));
  assert.equal(v.clasificacion, "nuevo"); assert.deepEqual(v.requiere_revision, []);
});
test("AC-13 [+] validar msg-002 → nuevo aunque el NIT ya exista en el maestro", async () => {
  const ctx = nuevoCtx(); const v = data(await call("validar", { mensaje_id: "msg-002", contrato: await extraer(ctx, "msg-002") }, ctx));
  assert.equal(v.clasificacion, "nuevo"); assert.deepEqual(v.requiere_revision, []);
});
test("AC-14 [+] validar msg-003 → actualizacion con diferencias de valor y fecha_fin", async () => {
  const ctx = nuevoCtx(); const v = data(await call("validar", { mensaje_id: "msg-003", contrato: await extraer(ctx, "msg-003") }, ctx));
  assert.equal(v.clasificacion, "actualizacion"); assert.equal(v.id_contrato_existente, "CT-2026-011");
  assert.deepEqual(v.diferencias, { valor: { antes: "350000", despues: "520000" }, fecha_fin: { antes: "2027-05-01", despues: "2027-11-01" } });
  assert.deepEqual(v.requiere_revision, []);
});
test("AC-15 [+] validar msg-004 → duplicado", async () => {
  const ctx = nuevoCtx(); const v = data(await call("validar", { mensaje_id: "msg-004", contrato: await extraer(ctx, "msg-004") }, ctx));
  assert.equal(v.clasificacion, "duplicado"); assert.equal(v.id_contrato_existente, "CT-2026-012");
});
test("AC-16 [-] validar msg-005 sin contrato → rechazado con motivo", async () => {
  const v = data(await call("validar", { mensaje_id: "msg-005" }, nuevoCtx()));
  assert.equal(v.clasificacion, "rechazado"); assert.match(v.motivo, /cotizaci/i);
});
test("AC-17 [+] validar msg-006 → nuevo con revisión exactamente de valor y fecha_fin (el comercial desconocido solo alerta)", async () => {
  const ctx = nuevoCtx(); const v = data(await call("validar", { mensaje_id: "msg-006", contrato: await extraer(ctx, "msg-006") }, ctx));
  assert.equal(v.clasificacion, "nuevo");
  assert.deepEqual(v.requiere_revision, ["valor", "fecha_fin"]);
  assert.equal(v.comercial_resuelto, false);
});
test("AC-18 [+] el remitente se resuelve contra comerciales.json", async () => {
  const ctx = nuevoCtx();
  assert.equal((await extraer(ctx, "msg-002")).comercial, "Carlos Ruiz Medina");
  assert.equal((await extraer(ctx, "msg-004")).comercial, "Laura Gómez Restrepo");
});
test("AC-19 [-] mismo id con otro valor y no otrosí → actualizacion con conflicto a revisar", async () => {
  const ctx = nuevoCtx(); const c = await extraer(ctx, "msg-004"); c.valor = 999000000;
  const v = data(await call("validar", { mensaje_id: "msg-004", contrato: c }, ctx));
  assert.equal(v.clasificacion, "actualizacion"); assert.ok((v.requiere_revision as string[]).includes("valor"));
});
test("AC-20 [!] validar con contrato mal formado devuelve el campo inválido", async () => {
  const r = await call("validar", { mensaje_id: "msg-001", contrato: { id_contrato: "X", fecha_fin: "2026-13-40" } }, nuevoCtx());
  assert.equal(r.ok, false); assert.match(r.error!, /fecha_fin|inválid/i);
});

// ───────── HU-4
test("AC-21 [+] registrar msg-001: fila, póliza pendiente, archivo, historial y procesado", async () => {
  const ctx = nuevoCtx(); const r = await call("registrar", { mensaje_id: "msg-001", contrato: await extraer(ctx, "msg-001") }, ctx);
  assert.ok(r.ok, r.error ?? "");
  assert.equal(data(r).ruta_archivo, "Contratos/2026/industrias-delta/CT-2026-015.txt");
  const f = fila(ctx, "CT-2026-015")!;
  assert.equal(f.estado_poliza, "pendiente"); assert.equal(f.fuente, "buzon"); assert.equal(f.fecha_registro, "2026-08-04");
  assert.equal(f.ruta_sharepoint, "Contratos/2026/industrias-delta/CT-2026-015.txt"); assert.equal(f.comercial, "Laura Gómez Restrepo");
  assert.ok(fs.existsSync(path.join(outDir(ctx), "sharepoint", f.ruta_sharepoint)));
  const h = fs.readFileSync(path.join(outDir(ctx), "sharepoint", "historial.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(h.length, 1); assert.deepEqual(Object.keys(h[0]).sort(), ["accion", "cambios", "id_contrato", "mensaje_id", "ts"]);
  assert.ok(JSON.parse(fs.readFileSync(path.join(outDir(ctx), "procesados.json"), "utf8"))["msg-001"]);
});
test("AC-22 [+] registrar msg-002 → no_aplica sin tipo de póliza", async () => {
  const ctx = nuevoCtx(); assert.ok((await call("registrar", { mensaje_id: "msg-002" }, ctx)).ok);
  const f = fila(ctx, "CT-2026-016")!; assert.equal(f.estado_poliza, "no_aplica"); assert.equal(f.tipo_poliza, "");
});
test("AC-23 [+] registrar msg-003 modifica la fila existente y deja historial con cambios", async () => {
  const ctx = nuevoCtx(); const antes = leerMaestro(ctx).length;
  const r = await call("registrar", { mensaje_id: "msg-003" }, ctx); assert.ok(r.ok, r.error ?? "");
  assert.equal(data(r).accion, "actualizado");
  const m = leerMaestro(ctx); assert.equal(m.length, antes);
  assert.equal(m.filter((f) => f.id_contrato === "CT-2026-011").length, 1);
  const f = fila(ctx, "CT-2026-011")!;
  assert.equal(f.valor, "520000"); assert.equal(f.fecha_fin, "2027-11-01"); assert.equal(f.fecha_inicio, "2026-05-02");
  assert.equal(f.estado_poliza, "vigente"); assert.match(f.alertas, /garant/i);
  const h = JSON.parse(fs.readFileSync(path.join(outDir(ctx), "sharepoint", "historial.jsonl"), "utf8").trim().split("\n")[0]);
  assert.equal(h.accion, "actualizado"); assert.equal(h.cambios.valor.antes, "350000"); assert.equal(h.cambios.fecha_fin.despues, "2027-11-01");
});
test("AC-24 [-] registrar msg-004 (duplicado) no escribe nada", async () => {
  const ctx = nuevoCtx(); const antes = JSON.stringify(leerMaestro(ctx));
  const r = await call("registrar", { mensaje_id: "msg-004" }, ctx); assert.ok(r.ok);
  assert.equal(data(r).accion, "duplicado"); assert.equal(JSON.stringify(leerMaestro(ctx)), antes);
  assert.ok(!fs.existsSync(path.join(outDir(ctx), "sharepoint", "historial.jsonl")));
  assert.ok(JSON.parse(fs.readFileSync(path.join(outDir(ctx), "procesados.json"), "utf8"))["msg-004"]);
});
test("AC-25 [-] registrar msg-006 sin confirmado → error 'requiere revisión' y no escribe", async () => {
  const ctx = nuevoCtx(); const antes = JSON.stringify(leerMaestro(ctx));
  const r = await call("registrar", { mensaje_id: "msg-006" }, ctx);
  assert.equal(r.ok, false); assert.match(r.error!, /^requiere revisión: .*valor.*fecha_fin/);
  assert.equal(JSON.stringify(leerMaestro(ctx)), antes);
  assert.ok(!fs.existsSync(path.join(outDir(ctx), "procesados.json")) || !("msg-006" in JSON.parse(fs.readFileSync(path.join(outDir(ctx), "procesados.json"), "utf8"))));
});
test("AC-26 [+] registrar msg-006 con confirmado=true y valores confirmados", async () => {
  const ctx = nuevoCtx(); const c = await extraer(ctx, "msg-006"); c.valor = 0; c.fecha_fin = "2027-08-31";
  const r = await call("registrar", { mensaje_id: "msg-006", contrato: c, confirmado: true }, ctx); assert.ok(r.ok, r.error ?? "");
  const f = fila(ctx, "CM-2026-03")!; assert.equal(f.valor, "0"); assert.equal(f.fecha_fin, "2027-08-31"); assert.equal(f.comercial, "");
  assert.match(f.alertas, /d[ií]a de inicio/i);
});
test("AC-27 [-] registrar msg-005 no escribe y queda rechazado/procesado", async () => {
  const ctx = nuevoCtx(); const antes = JSON.stringify(leerMaestro(ctx));
  const r = await call("registrar", { mensaje_id: "msg-005" }, ctx); assert.ok(r.ok); assert.equal(data(r).accion, "rechazado");
  assert.equal(JSON.stringify(leerMaestro(ctx)), antes);
});
test("AC-28 [!] registrar dos veces el mismo mensaje no duplica filas", async () => {
  const ctx = nuevoCtx(); await call("registrar", { mensaje_id: "msg-001" }, ctx);
  const n1 = leerMaestro(ctx).length; const r = await call("registrar", { mensaje_id: "msg-001" }, ctx);
  assert.ok(r.ok); assert.equal(leerMaestro(ctx).length, n1);
});
test("AC-29 [!] los fixtures no cambian tras procesar todo el buzón", async () => {
  const antes = hashDir(path.join(ROOT, "fixtures"));
  const ctx = nuevoCtx();
  for (const id of ["msg-001", "msg-002", "msg-003", "msg-004", "msg-005", "msg-006"]) await call("registrar", { mensaje_id: id }, ctx);
  await call("alertas", { hoy: "2026-09-03" }, ctx);
  assert.equal(hashDir(path.join(ROOT, "fixtures")), antes);
});
test("AC-30 [!] un id_contrato con ../ no puede escribir fuera de out/", async () => {
  const ctx = nuevoCtx(); const c = await extraer(ctx, "msg-001"); c.id_contrato = "../../evil";
  const r = await call("registrar", { mensaje_id: "msg-001", contrato: c }, ctx);
  assert.equal(r.ok, false);
  assert.ok(!fs.existsSync(path.join(ROOT, "evil.txt")));
});

// ───────── HU-5
async function conBuzonProcesado(): Promise<ToolCtx> {
  const ctx = nuevoCtx();
  for (const id of ["msg-001", "msg-002", "msg-003", "msg-004", "msg-005"]) await call("registrar", { mensaje_id: id }, ctx);
  return ctx;
}
test("AC-31 [+] alertas: vencen ≤60 días, y los vencidos se marcan en estado_contrato", async () => {
  const ctx = await conBuzonProcesado(); const r = await call("alertas", { hoy: "2026-09-03" }, ctx); assert.ok(r.ok, r.error ?? "");
  const v = data(r).vencen as D[];
  const ids = v.map((x) => x.id_contrato);
  for (const id of ["CT-2026-009", "CT-2026-004", "CT-2025-018", "CT-2026-002"]) assert.ok(ids.includes(id), id);
  for (const id of ["CT-2026-012", "CT-2026-011", "CT-2026-006"]) assert.ok(!ids.includes(id), id);
  assert.equal(v.find((x) => x.id_contrato === "CT-2026-009")!.dias, 27);
  assert.equal(fila(ctx, "CT-2025-018")!.estado_contrato, "vencido"); assert.equal(fila(ctx, "CT-2026-009")!.estado_contrato, "vigente");
  const md = fs.readFileSync(path.join(outDir(ctx), "alertas.md"), "utf8");
  assert.equal((md.match(/^## /gm) ?? []).length >= 3, true);
});
test("AC-32 [+] alertas: pólizas pendientes", async () => {
  const ctx = await conBuzonProcesado(); const p = (data(await call("alertas", { hoy: "2026-09-03" }, ctx)).polizas_pendientes as D[]).map((x) => x.id_contrato).sort();
  assert.deepEqual(p, ["CT-2026-004", "CT-2026-015"]);
});
test("AC-33 [+] alertas: registrados desde el corte 2026-05-30", async () => {
  const ctx = await conBuzonProcesado(); const r = (data(await call("alertas", { hoy: "2026-09-03" }, ctx)).registrados_desde_corte as D[]).map((x) => x.id_contrato).sort();
  assert.deepEqual(r, ["CT-2026-015", "CT-2026-016"]);
});
test("AC-34 [!] alertas: hoy inválido → error; mismo hoy → mismo reporte", async () => {
  const ctx = await conBuzonProcesado();
  assert.equal((await call("alertas", { hoy: "2026-13-40" }, ctx)).ok, false);
  const a = await call("alertas", { hoy: "2026-09-03" }, ctx); const md1 = fs.readFileSync(path.join(outDir(ctx), "alertas.md"), "utf8");
  const b = await call("alertas", { hoy: "2026-09-03" }, ctx); const md2 = fs.readFileSync(path.join(outDir(ctx), "alertas.md"), "utf8");
  assert.deepEqual(a, b); assert.equal(md1, md2);
});

// ───────── HU-6
test("AC-35 [!] un mensaje con error no aborta el lote", async () => {
  const ctx = nuevoCtx(); const salidas: boolean[] = [];
  for (const id of ["msg-001", "msg-999", "msg-002"]) salidas.push((await call("registrar", { mensaje_id: id }, ctx)).ok);
  assert.deepEqual(salidas, [true, false, true]);
});
test("AC-36 [!] fecha inexistente o moneda desconocida → ok:false legible, y el lote sigue", async () => {
  const dir = fs.mkdtempSync(path.join(ROOT, "out-test-")); // fixture sintético aislado
  try {
    fs.cpSync(path.join(ROOT, "fixtures/reto-02"), dir, { recursive: true });
    const nuevoMsg = (id: string, texto: string) => {
      const bz = path.join(dir, "buzon", id); fs.mkdirSync(bz, { recursive: true });
      fs.writeFileSync(path.join(bz, "correo.json"), JSON.stringify({ id, de: "lgomez@periferia-ficticia.com", para: "x", asunto: "c", fecha: "2026-09-01T10:00:00-05:00", cuerpo: "adjunto", adjuntos: ["contrato.txt"] }));
      fs.writeFileSync(path.join(bz, "contrato.txt"), texto);
    };
    const cab = "CONTRATO No. CT-2026-900\n\nEntre ACME LTDA., NIT 900.111.222-3, con domicilio en Bogotá, y PERIFERIA IT GROUP S.A.S., NIT 900.123.456-7.\n\nPRIMERA. OBJETO. Servicios varios.\n\n";
    nuevoMsg("msg-900", cab + "SEGUNDA. VALOR. El valor es de EUR 5.000,00.\n\nTERCERA. PLAZO. Desde el primero (1) de enero de 2026 hasta el primero (1) de enero de 2027.\n");
    nuevoMsg("msg-901", cab + "SEGUNDA. VALOR. El valor es de COP $5.000.000.\n\nTERCERA. PLAZO. Desde el treinta y uno (31) de febrero de 2026 hasta el primero (1) de enero de 2027.\n");
    const prev = process.env.FIXTURES_DIR; process.env.FIXTURES_DIR = path.relative(ROOT, dir);
    try {
      const ctx = nuevoCtx();
      const m = await call("extraer", { mensaje_id: "msg-900" }, ctx); assert.equal(m.ok, false); assert.match(m.error!, /moneda.*EUR/i);
      const f = await call("extraer", { mensaje_id: "msg-901" }, ctx); assert.equal(f.ok, false); assert.match(f.error!, /fecha inválida/i);
      assert.equal((await call("registrar", { mensaje_id: "msg-900" }, ctx)).ok, false);
      assert.equal((await call("registrar", { mensaje_id: "msg-001" }, ctx)).ok, true); // el lote continúa con el siguiente mensaje
    } finally { if (prev === undefined) delete process.env.FIXTURES_DIR; else process.env.FIXTURES_DIR = prev; }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
