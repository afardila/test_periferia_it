/**
 * Verificación determinista: llama a las herramientas DIRECTAMENTE, sin modelo de lenguaje.
 * Demuestra que las reglas de negocio (duplicados, confianza, otrosíes, alertas) no dependen del LLM.
 * Cada caso usa un Store propio (sin contaminación entre casos). Las pruebas completas están en test/ (npm test).
 * Uso: npm run demo   (sale con código 1 si algún caso falla)
 *
 * ⚠️ El día de la prueba: reemplazar CASOS por los mensajes reales del buzón y los resultados esperados del PRD.
 */
import { executeTool } from "./src/tools/registry.js";
import { tools } from "./src/tools/contratos.js";
import { createStore } from "./src/data.js";

type Paso = { tool: string; input: unknown; espera: (out: any) => boolean; nota: string };
const CASOS: { caso: string; pasos: Paso[] }[] = [
  {
    caso: "msg-001 · contrato nuevo, alta confianza",
    pasos: [
      { tool: "buscar_contrato", input: { numero: "CT-2026-040" }, nota: "no existe aún", espera: (o) => o.length === 0 },
      { tool: "resolver_comercial", input: { email: "luis@ejemplo.test" }, nota: "comercial resuelto", espera: (o) => o?.nombre === "Luis Demo" },
      {
        tool: "registrar_contrato", nota: "queda vigente", espera: (o) => o.ok && o.estado === "vigente",
        input: {
          numero: "CT-2026-040", cliente: "Ficticio Retail S.A.S.", nit: "900999000-1", objeto: "Implementación de tienda en línea",
          valor: 150_000_000, fecha_inicio: "2026-06-01", fecha_fin: "2027-05-31", comercial_email: "luis@ejemplo.test", id_mensaje: "msg-001",
          confianza: { numero: 0.99, cliente: 0.97, valor: 0.95, fecha_fin: 0.9 },
        },
      },
      { tool: "archivar_documento", input: { id_mensaje: "msg-001", archivo: "contrato.txt", numero: "CT-2026-040" }, nota: "archivado", espera: (o) => o.ok },
    ],
  },
  {
    caso: "msg-002 · otrosí (prórroga)",
    pasos: [
      {
        tool: "actualizar_contrato", nota: "versión 2 y nueva fecha_fin", espera: (o) => o.ok && o.version === "2" && o.contrato.fecha_fin === "2026-11-10",
        input: { numero: "CT-2026-002", tipo: "otrosi", cambios: { fecha_fin: "2026-11-10" }, id_mensaje: "msg-002" },
      },
    ],
  },
  {
    caso: "msg-003 · duplicado",
    pasos: [
      {
        tool: "registrar_contrato", nota: "rechaza con DUPLICADO", espera: (o) => !o.ok && o.codigo === "DUPLICADO",
        input: {
          numero: "CT-2026-001", cliente: "Ejemplo Andina S.A.", objeto: "Soporte de plataforma", valor: 120_000_000,
          fecha_inicio: "2026-01-15", fecha_fin: "2026-06-20", id_mensaje: "msg-003", confianza: { numero: 0.99 },
        },
      },
    ],
  },
  {
    caso: "baja confianza → pendiente_revision",
    pasos: [
      {
        tool: "registrar_contrato", nota: "estado pendiente_revision + campo señalado", espera: (o) => o.ok && o.estado === "pendiente_revision" && o.campos_baja_confianza.includes("valor"),
        input: {
          numero: "CT-2026-041", cliente: "Dudoso S.A.", objeto: "Servicio X", valor: 1_000_000,
          fecha_inicio: "2026-06-01", fecha_fin: "2026-12-31", id_mensaje: "msg-demo", confianza: { numero: 0.9, valor: 0.4 },
        },
      },
    ],
  },
  {
    caso: "msg-004 · no es contrato",
    pasos: [{ tool: "rechazar_mensaje", input: { id_mensaje: "msg-004", motivo: "Publicidad, sin contrato" }, nota: "rechazado con motivo", espera: (o) => o.ok }],
  },
  {
    caso: "validación de entrada (zod)",
    pasos: [{ tool: "buscar_contrato", input: {}, nota: "exige al menos un criterio", espera: () => true }],
  },
  {
    caso: "reporte de vencimientos a 60 días",
    pasos: [
      {
        tool: "reporte_vencimientos", input: { dias: 60 }, nota: "CT-2025-017 vencido; CT-2026-001 crítico",
        espera: (o) => o.alertas.some((a: any) => a.numero === "CT-2025-017" && a.severidad === "vencido") && o.alertas.some((a: any) => a.numero === "CT-2026-001" && a.severidad === "critica"),
      },
    ],
  },
];

let fallos = 0;
for (const { caso, pasos } of CASOS) {
  console.log(`\n▶ ${caso}`);
  const store = createStore(); // cada caso corre aislado: no hereda nada de los anteriores
  for (const p of pasos) {
    const r = await executeTool(tools, p.tool, p.input, { store });
    const esValidacion = caso.startsWith("validación");
    const ok = esValidacion ? !r.ok : r.ok && p.espera(r.output);
    if (!ok) fallos++;
    console.log(`  ${ok ? "✅" : "❌"} ${p.tool} — ${p.nota}`);
    if (!ok) console.log("     →", JSON.stringify(r));
  }
}
console.log(fallos ? `\n❌ ${fallos} verificación(es) fallaron` : "\n✅ Todas las verificaciones pasaron");
process.exit(fallos ? 1 : 0);
