/**
 * Verificación SIN modelo: procesa los 6 mensajes del buzón en orden llamando directamente a las herramientas.
 * Uso: npm run demo   (no requiere clave de ningún proveedor). Sale con código 1 si algún resultado difiere de lo esperado.
 */
import fs from "node:fs";
import path from "node:path";
import { tools } from "./src/tools/index.js";
import { llamar, type ToolCtx } from "./src/tools/registry.js";
import { outDir } from "./src/tools/maestro.js";

const HOY = "2026-09-03";
const ctx: ToolCtx = { directory: import.meta.dirname, sessionId: "demo", outDir: "out" }; // PRD 6.6: las salidas van directo en out/
fs.rmSync(path.join(ctx.directory, "out"), { recursive: true, force: true }); // out/ se limpia al inicio
type D = Record<string, unknown>;
const call = (n: string, a: unknown) => llamar(tools, `contratos_${n}`, a, ctx);

const ESPERADO: Record<string, { clasificacion: string; accion: string; revision?: string[] }> = {
  "msg-001": { clasificacion: "nuevo", accion: "insertado" },
  "msg-002": { clasificacion: "nuevo", accion: "insertado" },
  "msg-003": { clasificacion: "actualizacion", accion: "actualizado" },
  "msg-004": { clasificacion: "duplicado", accion: "duplicado" },
  "msg-005": { clasificacion: "rechazado", accion: "rechazado" },
  "msg-006": { clasificacion: "nuevo", accion: "pendiente de confirmación", revision: ["valor", "fecha_fin"] },
};
let fallos = 0;
const verificar = (cond: boolean, msg: string) => { if (!cond) { fallos++; console.log(`   ✗ ${msg}`); } };

console.log(`\n=== DEMO sin modelo · fecha de referencia ${HOY} ===\n`);
const buzon = ((await call("leer_buzon", {})).data as { mensajes: D[] }).mensajes;
console.log(`Buzón: ${buzon.length} mensajes → ${buzon.map((m) => `${m.id}${m.tiene_contrato ? "" : " (sin contrato)"}`).join(", ")}\n`);

for (const m of buzon) {
  const id = String(m.id); const esp = ESPERADO[id];
  console.log(`── ${id} · ${m.asunto}`);
  const ex = await call("extraer", { mensaje_id: id });
  const v = (await call("validar", ex.ok ? { mensaje_id: id, contrato: ex.data } : { mensaje_id: id })).data as D;
  const rev = v.requiere_revision as string[];
  console.log(`   clasificación: ${v.clasificacion}${v.motivo ? ` (${v.motivo})` : ""}${v.id_contrato_existente ? ` · existente: ${v.id_contrato_existente}` : ""}`);
  console.log(`   campos en revisión: ${rev.length ? rev.join(", ") : "—"}`);
  if (rev.length) for (const [k, t] of Object.entries(v.detalle_revision as Record<string, string>)) console.log(`      · ${k}: ${t}`);
  const reg = await call("registrar", ex.ok ? { mensaje_id: id, contrato: ex.data } : { mensaje_id: id });
  const accion = reg.ok ? String((reg.data as D).accion) : rev.length ? "pendiente de confirmación" : `error: ${reg.error}`;
  console.log(`   acción: ${accion}${reg.ok ? "" : `  ← ${reg.error}`}`);
  verificar(v.clasificacion === esp.clasificacion, `clasificación esperada ${esp.clasificacion}`);
  verificar(accion === esp.accion, `acción esperada ${esp.accion}`);
  if (esp.revision) for (const k of esp.revision) verificar(rev.includes(k), `debía pedir revisión de ${k}`);
  if (!esp.revision) verificar(rev.length === 0, "no debía pedir revisión");
  console.log();
}

console.log("── msg-006 · segunda llamada tras la confirmación humana (\"confirmo valor 0 y fecha fin 2027-08-31\")");
const ex6 = (await call("extraer", { mensaje_id: "msg-006" })).data as D;
const reg6 = await call("registrar", { mensaje_id: "msg-006", contrato: { ...ex6, valor: 0, fecha_fin: "2027-08-31" }, confirmado: true });
console.log(`   acción: ${reg6.ok ? (reg6.data as D).accion : `error: ${reg6.error}`} · ${reg6.ok ? (reg6.data as D).id_contrato : ""}`);
verificar(reg6.ok && (reg6.data as D).accion === "insertado", "msg-006 debía registrarse tras confirmar");

console.log(`\n── Alertas (${HOY})`);
const al = (await call("alertas", { hoy: HOY })).data as { vencen: D[]; polizas_pendientes: D[]; registrados_desde_corte: D[]; observaciones: D[] };
console.log(`   vencen ≤60 d / vencidos: ${al.vencen.map((x) => `${x.id_contrato}(${x.dias})`).join(", ")}`);
console.log(`   pólizas pendientes: ${al.polizas_pendientes.map((x) => x.id_contrato).join(", ")}`);
console.log(`   registrados desde el corte: ${al.registrados_desde_corte.map((x) => x.id_contrato).join(", ")}`);
console.log(`   observaciones: ${al.observaciones.length} contrato(s) con alertas · informe: out/alertas.md`);
verificar(JSON.stringify(al.registrados_desde_corte.map((x) => x.id_contrato).sort()) === JSON.stringify(["CM-2026-03", "CT-2026-015", "CT-2026-016"]), "registrados desde corte");
verificar(fs.existsSync(path.join(outDir(ctx), "alertas.md")), "out/alertas.md");
const filas = fs.readFileSync(path.join(outDir(ctx), "sharepoint", "maestro-contratos.csv"), "utf8").trim().split("\n").length - 1;
verificar(filas === 8 + 3, `maestro debía tener 11 filas (tiene ${filas}): sin duplicados`);

console.log(fallos ? `\n✗ ${fallos} verificación(es) fallaron\n` : "\n✓ Todo coincide con lo esperado del PRD (maestro sin duplicados, historial y archivos en out/)\n");
process.exit(fallos ? 1 : 0);
