/**
 * Verificación determinista SIN modelo de lenguaje.
 *  Parte A: procesa los mensajes del buzón llamando directamente a las herramientas (src/pipeline.ts).
 *  Parte B: pruebas de robustez de las reglas (duplicados, confianza, fechas, rutas, aislamiento).
 * Cada ejecución usa un Store propio: nada se hereda entre casos. Dos corridas dan resultados idénticos.
 * Uso: npm run demo   (código de salida 1 si algo falla)
 *
 * Nota: ESPERADO refleja los mensajes de fixtures-demo; debe alinearse con los mensajes reales y las reglas del PRD.
 */
import { createStore } from "./src/data.js";
import { executeTool } from "./src/tools/registry.js";
import { tools } from "./src/tools/contratos.js";
import { procesarBuzon, procesarMensaje, type Resultado } from "./src/pipeline.js";

let fallos = 0;
const marca = (ok: boolean) => (ok ? "✅" : "❌");
function verificar(ok: boolean, texto: string, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${marca(ok)} ${texto}`);
  if (!ok && detalle !== undefined) console.log("     →", typeof detalle === "string" ? detalle : JSON.stringify(detalle));
}

// ───────── Parte A · el buzón, mensaje por mensaje ─────────
const ESPERADO: Record<string, { clasificacion: string; contiene: string }> = {
  "msg-001": { clasificacion: "nuevo", contiene: "estado vigente" },
  "msg-002": { clasificacion: "otrosi", contiene: "CT-2026-002 v2, fecha_fin 2026-11-10" },
  "msg-003": { clasificacion: "duplicado", contiene: "CT-2026-001 ya existe" },
  "msg-004": { clasificacion: "no_contrato", contiene: "rechazado" },
};

console.log("PARTE A · Procesamiento del buzón (sin LLM)\n");
const store = createStore();
const resultados = await procesarBuzon(store);
console.log("  mensaje   clasificación  acción                          resultado");
for (const r of resultados) {
  console.log(`  ${r.id.padEnd(9)} ${r.clasificacion.padEnd(14)} ${r.accion.padEnd(31)} ${r.resultado}${r.advertencias.length ? "  ⚠ " + r.advertencias.join(",") : ""}`);
}
console.log();
for (const r of resultados) {
  const e = ESPERADO[r.id];
  verificar(!!e && r.clasificacion === e.clasificacion && r.resultado.includes(e.contiene), `${r.id} → ${e?.clasificacion ?? "?"}`, r);
}
verificar(resultados.length === Object.keys(ESPERADO).length, "se procesaron todos los mensajes del buzón");

// Determinismo: otra corrida sobre un store nuevo da exactamente lo mismo
const otra = await procesarBuzon(createStore());
verificar(JSON.stringify(otra) === JSON.stringify(resultados), "determinismo: dos corridas independientes producen resultados idénticos");

// Independencia entre casos: el orden de procesamiento no cambia el resultado de cada mensaje
const invertido: Resultado[] = [];
const sInv = createStore();
for (const r of [...resultados].reverse()) invertido.push(await procesarMensaje(sInv, r.id));
const ordenado = (l: Resultado[]) => JSON.stringify([...l].sort((x, y) => x.id.localeCompare(y.id)));
verificar(ordenado(invertido) === ordenado(resultados), "independencia: procesar en orden inverso no altera ningún caso");

// ───────── Parte B · robustez de las reglas ─────────
console.log("\nPARTE B · Robustez de las reglas\n");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (s: ReturnType<typeof createStore>, name: string, input: unknown): Promise<any> => {
  const r = await executeTool(tools, name, input, { store: s });
  return r.ok ? r.output : { __error: r.error };
};
const base = {
  numero: "CT-2026-099", cliente: "Prueba S.A.", objeto: "Servicio", valor: 1_000_000,
  fecha_inicio: "2026-06-01", fecha_fin: "2026-12-31", id_mensaje: "msg-demo", confianza: { numero: 0.9 },
};
{
  const s = createStore();
  verificar((await run(s, "registrar_contrato", { ...base, numero: "CT-2026-001" })).codigo === "DUPLICADO", "duplicado rechazado aunque el modelo no consulte antes");
  verificar((await run(s, "registrar_contrato", { ...base, confianza: { numero: 0.9, valor: 0.4 } })).estado === "pendiente_revision", "baja confianza → pendiente_revision");
  verificar(!!(await run(s, "registrar_contrato", { ...base, fecha_fin: "2026-01-01" })).__error, "fechas invertidas rechazadas");
  verificar(!!(await run(s, "registrar_contrato", { ...base, valor: -1 })).__error, "valor negativo rechazado");
  verificar(!!(await run(s, "actualizar_contrato", { numero: "CT-2026-002", tipo: "correccion", cambios: { numero: "X" }, id_mensaje: "m" })).__error, "campos protegidos no se pueden modificar");
  verificar((await run(s, "actualizar_contrato", { numero: "CT-0000", tipo: "otrosi", cambios: { fecha_fin: "2027-01-01" }, id_mensaje: "m" })).codigo === "NO_ENCONTRADO", "otrosí de contrato inexistente → NO_ENCONTRADO");
  verificar(!!(await run(s, "leer_mensaje", { id: "../" })).error, "path traversal bloqueado");
  verificar(!!(await run(s, "buscar_contrato", {})).__error, "entrada inválida detectada por zod");
  const rep = await run(s, "reporte_vencimientos", { dias: 60 });
  const sev = Object.fromEntries(rep.alertas.map((a: { numero: string; severidad: string }) => [a.numero, a.severidad]));
  verificar(sev["CT-2025-017"] === "vencido" && sev["CT-2026-001"] === "critica", "reporte de vencimientos: vencido y crítica");
}
{
  const a = createStore(), b = createStore();
  await run(a, "registrar_contrato", base);
  verificar(!b.maestro.some((r) => r.numero === "CT-2026-099"), "aislamiento: lo escrito en una sesión no aparece en otra");
}

console.log(fallos ? `\n❌ ${fallos} verificación(es) fallaron` : "\n✅ Todas las verificaciones pasaron");
process.exit(fallos ? 1 : 0);
