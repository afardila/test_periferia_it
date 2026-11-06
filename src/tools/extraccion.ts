/** Extracción determinista (regex + heurísticas) sobre el texto del contrato. Lo ausente es null con confianza 0. */
import { z } from "zod";

export const UMBRAL = 0.8;
const PAISES = ["CO", "EC", "PE", "PA", "HN"] as const;
const MONEDAS = ["COP", "USD", "PEN", "PAB", "HNL"] as const;
export const esFechaValida = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const Fecha = z.string().refine(esFechaValida, "fecha inválida (YYYY-MM-DD)");

export const ContratoSchema = z.object({
  id_contrato: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/, "id_contrato inválido").nullable().describe("Número del contrato tal como aparece en el documento"),
  cliente: z.string().max(200).nullable().describe("Razón social de la contraparte"),
  nit_cliente: z.string().regex(/^\d{5,20}$/, "solo dígitos, sin puntos ni dígito de verificación").nullable().describe("Identificador tributario sin puntos ni dígito de verificación"),
  pais: z.enum(PAISES).nullable().describe("CO | EC | PE | PA | HN"),
  objeto: z.string().max(200).nullable().describe("Objeto del contrato, máx. 200 caracteres"),
  valor: z.number().min(0).nullable().describe("Sin separadores; 0 si es por demanda"),
  valor_indeterminado: z.boolean().default(false).describe("true si el contrato es por demanda (valor = 0)"),
  moneda: z.enum(MONEDAS).nullable().describe("COP | USD | PEN | PAB | HNL"),
  fecha_inicio: Fecha.nullable().describe("YYYY-MM-DD"),
  fecha_fin: Fecha.nullable().describe("YYYY-MM-DD; puede derivarse de un plazo en meses"),
  requiere_poliza: z.boolean().nullable().describe("true si el contrato exige póliza"),
  tipo_poliza: z.string().nullable().describe("Lista separada por ;"),
  comercial: z.string().nullable().describe("Nombre resuelto desde comerciales.json"),
  es_otrosi: z.boolean().default(false).describe("true si el documento es un otrosí que modifica un contrato existente"),
  alertas: z.array(z.string()).default([]).describe("Observaciones detectadas"),
  confianza: z.record(z.string(), z.number().min(0).max(1)).default({}).describe("Confianza [0,1] por campo"),
});
export type Contrato = z.infer<typeof ContratoSchema>;
export const CAMPOS_DATO = ["id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda", "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza", "comercial"] as const;

// ───────── utilidades
const MESES: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const iso = (y: number, m: number, d: number): string | null => { const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; return esFechaValida(s) ? s : null; };
const RE_FECHA = /(?:\((\d{1,2})\)|\b(\d{1,2}))\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/gi;
/** Fechas en español ("primero (1) de agosto de 2026"). Las inexistentes (31 de febrero) devuelven null en su posición. */
export function fechasES(texto: string): (string | null)[] {
  return [...texto.matchAll(RE_FECHA)].map((m) => iso(Number(m[4]), MESES[m[3].toLowerCase()], Number(m[1] ?? m[2])));
}
export function sumarMeses(f: string, meses: number): string {
  const [y, m, d] = f.split("-").map(Number); const t = y * 12 + (m - 1) + meses; const yy = Math.floor(t / 12), mm = (t % 12) + 1;
  const ultimo = new Date(Date.UTC(yy, mm, 0)).getUTCDate(); return iso(yy, mm, Math.min(d, ultimo))!;
}
export function diasEntre(desde: string, hasta: string): number { return Math.round((Date.parse(hasta + "T00:00:00Z") - Date.parse(desde + "T00:00:00Z")) / 86_400_000); }

export function parseMonto(s: string): number | null {
  const t = s.replace(/[^\d.,]/g, "").replace(/[.,]+$/, "");
  let n: string;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) n = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) n = t.replace(/,/g, "");
  else if (/^\d+([.,]\d{1,2})?$/.test(t)) n = t.replace(",", ".");
  else return null;
  const v = Number(n); return Number.isFinite(v) ? v : null;
}

const quitaTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const slug = (nombre: string) => quitaTildes(nombre.replace(/\s+(S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?\s?C\.?|S\.?\s?A\.?|S\.?\s?de\s?R\.?\s?L\.?|LTDA\.?)\s*$/i, "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export function similitud(a: string, b: string): number {
  const bi = (s: string) => { const t = quitaTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); const m = new Map<string, number>(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const A = bi(a), B = bi(b); let inter = 0, tot = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  for (const n of A.values()) tot += n; for (const n of B.values()) tot += n;
  return tot ? (2 * inter) / tot : 0;
}
const SIN_MAYUS = new Set(["de", "del", "la", "las", "el", "y", "e"]);
const tituloRazon = (s: string) => s.trim().split(/\s+/).map((w) => (/\./.test(w) ? w.toUpperCase() : SIN_MAYUS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ").replace(/[.,]+$/, (m) => (/\.$/.test(s.trim()) ? "." : ""));

const parrafos = (t: string) => t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const parrafoDe = (t: string, re: RegExp) => parrafos(t).find((p) => re.test(p));

// ───────── detección de contrato
export function esContrato(texto: string): boolean {
  const cab = texto.slice(0, 300);
  const marca = /CONTRATO|OTROS[ÍI]/i.test(cab);
  const partes = /\b(NIT|RUC)\s+[\d.\-]+/i.test(texto);
  const objeto = /OBJETO/i.test(texto) || /OTROS[ÍI]/i.test(cab);
  return marca && partes && objeto;
}
export function motivoNoContrato(nombre: string | null, texto: string | null): string {
  if (!nombre) return "El mensaje no trae adjuntos: no contiene contrato.";
  if (texto && /COTIZACI[ÓO]N/i.test(texto.slice(0, 300))) return `El adjunto "${nombre}" es una cotización, no un contrato (sin partes ni objeto contractual).`;
  return `El adjunto "${nombre}" no contiene partes ni objeto de contrato identificables.`;
}

export interface Contexto { de: string; asunto: string; cuerpo: string; fechaCorreo: string; comerciales: { email: string; nombre: string }[] }

export function extraerContrato(texto: string, ctx: Contexto): Contrato {
  const conf: Record<string, number> = {}; const alertas: string[] = [];
  const c: Contrato = { id_contrato: null, cliente: null, nit_cliente: null, pais: null, objeto: null, valor: null, valor_indeterminado: false, moneda: null, fecha_inicio: null, fecha_fin: null, requiere_poliza: null, tipo_poliza: null, comercial: null, es_otrosi: false, alertas, confianza: conf };
  const fijar = <K extends keyof Contrato>(k: K, v: Contrato[K], p: number) => { c[k] = v; conf[k as string] = v === null ? 0 : p; };
  c.es_otrosi = /OTROS[ÍI]/i.test(texto.slice(0, 300)) || /otros[íi]/i.test(ctx.asunto);
  const cuerpo = `${ctx.asunto}\n${ctx.cuerpo}`;

  // id
  const id = texto.match(/\b([A-Z]{1,4}-\d{4}-\d{1,4})\b/); fijar("id_contrato", id ? id[1] : null, 0.98);

  // cliente y NIT: primera parte con identificador que no sea Periferia
  let finCliente = 0; let tipoId: "NIT" | "RUC" | null = null;
  for (const m of texto.matchAll(/([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 .&]+?),\s*(?:identificad[ao]\s+con\s+|con\s+)?(NIT|RUC)\s+([\d.\-]+)/g)) {
    if (/PERIFERIA/i.test(m[1])) continue;
    fijar("cliente", tituloRazon(m[1]).slice(0, 200), 0.95);
    const crudo = m[3].replace(/\./g, "").replace(/[.,]+$/, ""); tipoId = m[2] as "NIT" | "RUC";
    fijar("nit_cliente", (tipoId === "NIT" ? crudo.replace(/-\d$/, "") : crudo.replace(/-/g, "")) || null, 0.95);
    finCliente = (m.index ?? 0) + m[0].length; break;
  }
  if (c.cliente === null) conf.cliente = 0;

  // país: domicilio del cliente; si no, tipo de identificador
  const dom = texto.slice(finCliente).match(/domicilio en\s+([^.;\n]+?)(?:,\s*(?:representad|y\s)|\.|;|$)/i);
  const lugar = (dom?.[1] ?? "").toLowerCase();
  const porLugar = /ecuador|quito|guayaquil/.test(lugar) ? "EC" : /per[úu]|lima/.test(lugar) ? "PE" : /panam[áa]/.test(lugar) ? "PA" : /honduras|tegucigalpa|san pedro sula/.test(lugar) ? "HN" : /colombia|bogot|medell|barranquilla|cali\b|cartagena/.test(lugar) ? "CO" : null;
  if (porLugar) fijar("pais", porLugar, 0.9);
  else if (tipoId === "NIT") fijar("pais", "CO", 0.8);
  else conf.pais = 0;

  // objeto
  const po = parrafoDe(texto, /OBJETO\./i);
  if (po) { const o = po.replace(/^.*?OBJETO\.\s*/is, "").replace(/\s+/g, " ").trim(); fijar("objeto", o.slice(0, 200), 0.9); if (o.length > 200) alertas.push("objeto truncado a 200 caracteres (límite del maestro)"); } else conf.objeto = 0;

  // valor y moneda
  const pv = c.es_otrosi ? texto : parrafoDe(texto, /VALOR\./) ?? "";
  const monto = pv.match(/\b(COP|USD|PEN|PAB|HNL)\s*\$?\s*([\d][\d.,]*)/);
  const indet = /no tiene un valor determinado|valor indeterminado|por demanda|cuant[ií]a indeterminada/i.test(pv);
  if (indet) {
    fijar("valor", 0, 0.5); c.valor_indeterminado = true; alertas.push("Contrato de valor indeterminado (por demanda): valor = 0, pendiente de confirmación.");
    const m0 = texto.match(/\b(COP|USD|PEN|PAB|HNL)\s*\$?\s*[\d]/);
    if (m0) fijar("moneda", m0[1] as Contrato["moneda"], 0.85); else conf.moneda = 0; // la única moneda del texto es la de los umbrales de garantía
  } else if (monto) {
    const v = parseMonto(monto[2]);
    fijar("valor", v, 0.95); fijar("moneda", v === null ? null : (monto[1] as Contrato["moneda"]), 0.95);
  } else {
    conf.valor = 0; conf.moneda = 0;
    const raro = pv.match(/\b([A-Z]{3})\s*\$?\s*[\d]/); if (raro) alertas.push(`Moneda no soportada: ${raro[1]}`);
  }

  // fechas
  if (c.es_otrosi) {
    const m = texto.match(/(?:hasta|se extiende hasta)\s+(el\s+[^."]*?\d{4})/i); const f = m ? fechasES(m[1])[0] ?? null : null;
    fijar("fecha_fin", f, 0.9); conf.fecha_inicio = 0;
  } else {
    const pp = parrafoDe(texto, /PLAZO\./) ?? "";
    const rango = pp.match(/desde\s+(el\s+.*?\d{4})\s+hasta\s+(el\s+.*?\d{4})/is);
    if (rango) { fijar("fecha_inicio", fechasES(rango[1])[0] ?? null, 0.95); fijar("fecha_fin", fechasES(rango[2])[0] ?? null, 0.95); }
    else {
      const meses = pp.match(/\((\d{1,3})\)\s+mes/i);
      const inicioExpl = pp.match(/a\s+partir\s+(?:del\s+|de\s+el\s+)(.*?\d{4})/i);
      if (meses && inicioExpl && fechasES(inicioExpl[1])[0]) {
        const fi = fechasES(inicioExpl[1])[0]!; fijar("fecha_inicio", fi, 0.9); fijar("fecha_fin", sumarMeses(fi, Number(meses[1])), 0.85); alertas.push(`fecha_fin derivada de plazo de ${meses[1]} meses.`);
      } else if (meses) {
        const fi = ctx.fechaCorreo; const n = Number(meses[1]);
        fijar("fecha_inicio", fi, 0.8); fijar("fecha_fin", sumarMeses(fi, n), 0.5); // inicio: decisión del usuario (fecha del correo + alerta); fin: derivada, siempre a confirmar
        alertas.push(`No se tiene día de inicio ni de firma: fecha_inicio tomada de la fecha del correo (${fi}); fecha_fin derivada de plazo de ${n} meses (requiere confirmación).`);
        if (/pr[óo]rroga/i.test(pp)) alertas.push("Prorrogable automáticamente por periodos iguales salvo aviso con 30 días de antelación.");
      } else { conf.fecha_inicio = 0; conf.fecha_fin = 0; }
    }
    if (c.fecha_inicio === null && rango) conf.fecha_inicio = 0;
    if (c.fecha_fin === null && rango) conf.fecha_fin = 0;
  }

  // póliza
  const pg = parrafoDe(texto, /GARANT[ÍI]AS?\./i) ?? "";
  const clausula = /constituir[áa].{0,120}p[óo]liza/is.test(pg);
  const condicional = clausula && /cuyo valor supere|para cada orden|por cada orden/i.test(pg);
  const cuerpoSi = /requiere\s+p[óo]liza/i.test(cuerpo) && !/no\s+(requiere|pide)\s+p[óo]liza/i.test(cuerpo);
  const cuerpoNo = /(no\s+(requiere|pide|exige)\s+p[óo]liza|sin\s+p[óo]liza)/i.test(cuerpo);
  if (c.es_otrosi) { conf.requiere_poliza = 0; conf.tipo_poliza = 0; }
  else if (condicional) { fijar("requiere_poliza", false, 0.85); conf.tipo_poliza = 0; alertas.push("La garantía depende de cada orden de servicio (> COP 100.000.000, póliza de cumplimiento 10 %): no se exige póliza al marco. Confirmar."); }
  else if (clausula) {
    fijar("requiere_poliza", true, cuerpoNo ? 0.5 : 0.95);
    if (cuerpoNo) alertas.push("El correo dice que no requiere póliza, pero el contrato la exige.");
    const tipos = [["cumplimiento", /cumplimiento/i], ["calidad", /calidad/i], ["salarios_prestaciones", /salarios/i], ["responsabilidad_civil", /responsabilidad civil/i], ["buen_manejo_anticipo", /anticipo/i]] as const;
    const t = tipos.filter(([, re]) => re.test(pg)).map(([n]) => n); fijar("tipo_poliza", t.length ? t.join(";") : null, 0.9);
  } else {
    fijar("requiere_poliza", cuerpoSi ? true : false, cuerpoSi ? 0.5 : 0.9);
    if (cuerpoSi) alertas.push("El correo dice que requiere póliza, pero el contrato no contiene cláusula de garantías."); else { c.tipo_poliza = null; conf.tipo_poliza = 0.9; }
  }

  // alertas de otrosí
  if (c.es_otrosi && /deber[áa]n\s+ampliarse|ampliarse\s+en\s+vigencia/i.test(texto)) {
    alertas.push(`Otrosí: las garantías vigentes deben ampliarse al nuevo plazo${c.fecha_fin ? ` (hasta ${c.fecha_fin})` : ""}. Gestionar con el corredor.`);
  }

  // comercial por remitente
  const com = ctx.comerciales.find((x) => x.email.toLowerCase() === ctx.de.toLowerCase());
  if (com) fijar("comercial", com.nombre, 0.98); else { conf.comercial = 0; alertas.push(`Remitente ${ctx.de} no está en comerciales.json: comercial sin asignar.`); }
  return c;
}
