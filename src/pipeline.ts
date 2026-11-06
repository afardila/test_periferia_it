import { executeTool } from "./tools/registry.js";
import { tools } from "./tools/contratos.js";
import type { Store } from "./data.js";

/**
 * Procesamiento DETERMINISTA del buzón: mismas herramientas que usa el agente, pero decididas por reglas
 * (expresiones regulares) en lugar de un modelo de lenguaje. Sirve para:
 *   1) demo.ts: demostrar robustez y determinismo sin consumir un LLM;
 *   2) pruebas: fijar el comportamiento esperado de cada mensaje del buzón;
 *   3) línea base: lo que el agente debe reproducir cuando interpreta el texto.
 * Nota: las expresiones regulares cubren los formatos de fixtures-demo; ajustarlas si cambia el formato de los mensajes.
 */
export type Clasificacion = "nuevo" | "otrosi" | "duplicado" | "no_contrato";
export interface Resultado {
  id: string;
  clasificacion: Clasificacion;
  accion: string;
  resultado: string;
  advertencias: string[];
}

const MESES: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

/** "1 de junio de 2026" | "2026-06-01" → "2026-06-01" (null si no se reconoce). */
export function aISO(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2}) de ([a-záéíóú]+) de (\d{4})$/);
  if (!m || !MESES[m[2]]) return null;
  return `${m[3]}-${MESES[m[2]]}-${m[1].padStart(2, "0")}`;
}

const FECHA = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2} de [a-záéíóú]+ de \d{4})`;
const first = (re: RegExp, s: string) => s.match(re)?.[1]?.trim();

export function clasificar(texto: string): "otrosi" | "contrato" | "no_contrato" {
  if (/otros[ií]\s+no\./i.test(texto)) return "otrosi";
  if (/contrato\s+no\.\s*[A-Z0-9-]+/i.test(texto)) return "contrato";
  return "no_contrato";
}

export function extraerContrato(texto: string, remitente?: string) {
  const numero = first(/contrato\s+no\.\s*([A-Z0-9-]+)/i, texto);
  const cliente = first(/cliente:\s*(.+?)\s+NIT\b/i, texto);
  const nit = first(/NIT\s*([\d.]+-?\d?)/i, texto);
  const objeto = first(/objeto:\s*(.+)/i, texto);
  const valorTxt = first(/valor:\s*\$?\s*([\d.]+)/i, texto);
  const vig = texto.match(new RegExp(String.raw`(?:del\s+)?${FECHA}\s+al?\s+${FECHA}`, "i"));
  const comercialDoc = first(/asesor comercial:\s*(\S+@\S+)/i, texto);
  const fecha_inicio = vig ? aISO(vig[1]) : null;
  const fecha_fin = vig ? aISO(vig[2]) : null;
  const valor = valorTxt ? Number(valorTxt.replace(/\./g, "")) : NaN;
  const comercial_email = comercialDoc ?? remitente;
  // Confianza heurística: dato hallado con patrón exacto = alta; dato inferido del remitente = media.
  const confianza: Record<string, number> = {};
  if (numero) confianza.numero = 0.99;
  if (cliente) confianza.cliente = 0.95;
  if (objeto) confianza.objeto = 0.95;
  if (!Number.isNaN(valor)) confianza.valor = 0.95;
  if (fecha_inicio) confianza.fecha_inicio = 0.95;
  if (fecha_fin) confianza.fecha_fin = 0.95;
  if (comercial_email) confianza.comercial_email = comercialDoc ? 0.95 : 0.7;
  return { numero, cliente, nit, objeto, valor, fecha_inicio, fecha_fin, comercial_email, confianza };
}

type Salida = { ok: boolean; output: unknown };
async function llamar(store: Store, name: string, input: unknown): Promise<Salida> {
  const r = await executeTool(tools, name, input, { store });
  return r.ok ? { ok: true, output: r.output } : { ok: false, output: r.error };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Procesa UN mensaje con su propio contexto (no usa datos de otros mensajes). */
export async function procesarMensaje(store: Store, id: string): Promise<Resultado> {
  const adv: string[] = [];
  const msg = (await llamar(store, "leer_mensaje", { id })).output as Any;
  const correo = (msg.correo ?? {}) as Record<string, string>;
  const remitente = correo.de ?? correo.from;
  const adjuntos: { nombre: string; texto: string }[] = msg.archivos ?? [];
  const principal = adjuntos.find((a) => clasificar(a.texto) !== "no_contrato") ?? adjuntos[0];
  const texto = principal?.texto ?? "";
  const tipo = clasificar(texto);

  if (tipo === "no_contrato") {
    await llamar(store, "rechazar_mensaje", { id_mensaje: id, motivo: "El mensaje no contiene un contrato ni un otrosí" });
    return { id, clasificacion: "no_contrato", accion: "rechazar_mensaje", resultado: "rechazado con motivo", advertencias: adv };
  }

  if (tipo === "otrosi") {
    const numero = first(/contrato\s+([A-Z]{2,}-\d{4}-\d+)/i, texto);
    const nueva = first(new RegExp(String.raw`hasta el ${FECHA}`, "i"), texto);
    const fecha_fin = nueva ? aISO(nueva) : null;
    if (!numero || !fecha_fin) {
      await llamar(store, "rechazar_mensaje", { id_mensaje: id, motivo: "Otrosí sin número de contrato o sin nueva fecha identificable" });
      return { id, clasificacion: "otrosi", accion: "rechazar_mensaje", resultado: "información insuficiente", advertencias: adv };
    }
    const r = await llamar(store, "actualizar_contrato", { numero, tipo: "otrosi", cambios: { fecha_fin }, id_mensaje: id });
    const o = r.output as Any;
    if (r.ok && o.ok) await llamar(store, "archivar_documento", { id_mensaje: id, archivo: principal.nombre, numero });
    return {
      id, clasificacion: "otrosi", accion: "actualizar_contrato",
      resultado: r.ok && o.ok ? `${numero} v${o.version}, fecha_fin ${fecha_fin}` : `${o?.codigo ?? "error"}`,
      advertencias: adv,
    };
  }

  const d = extraerContrato(texto, remitente);
  const existe = d.numero ? ((await llamar(store, "buscar_contrato", { numero: d.numero })).output as Any[]) : [];
  if (existe.length > 0) {
    return { id, clasificacion: "duplicado", accion: "ninguna (sin escritura)", resultado: `${d.numero} ya existe en el maestro`, advertencias: adv };
  }
  if (d.comercial_email) {
    const c = (await llamar(store, "resolver_comercial", { email: d.comercial_email })).output;
    if (!c) adv.push("COMERCIAL_NO_RESUELTO");
  }
  const r = await llamar(store, "registrar_contrato", { ...d, nit: d.nit ?? undefined, id_mensaje: id });
  const o = r.output as Any;
  if (!r.ok || !o.ok) {
    return { id, clasificacion: "nuevo", accion: "registrar_contrato", resultado: r.ok ? String(o.codigo) : String(r.output), advertencias: adv };
  }
  await llamar(store, "archivar_documento", { id_mensaje: id, archivo: principal.nombre, numero: d.numero });
  return { id, clasificacion: "nuevo", accion: "registrar_contrato + archivar", resultado: `estado ${o.estado}`, advertencias: [...adv, ...(o.advertencias ?? [])] };
}

/** Procesa todo el buzón: cada mensaje es independiente. (En el agente real, las escrituras esperan aprobación humana.) */
export async function procesarBuzon(store: Store): Promise<Resultado[]> {
  const lista = (await llamar(store, "listar_buzon", {})).output as { id: string }[];
  const out: Resultado[] = [];
  for (const { id } of lista) out.push(await procesarMensaje(store, id));
  return out;
}
