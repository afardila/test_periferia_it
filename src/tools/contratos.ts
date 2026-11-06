/** Herramientas del agente de contratos. Cada export → herramienta `contratos_<export>` (PRD 6.2). */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool, ok, fail, type ToolCtx, type ToolDef } from "./registry.js";
import {
  COLUMNAS, ID_CONTRATO, ID_MENSAJE, FECHA_CORTE, appendHistorial, appendLog, fixturesDir, guardarMaestro, leerAdjunto, leerBytesAdjunto, leerComerciales, rutaEnFixtures,
  leerCorreo, leerMaestro, leerProcesados, listarIdsBuzon, marcarProcesado, outDir, sharepointDir, type Correo, type Fila,
} from "./maestro.js";
import { textoDePdf } from "./pdf.js";
import { CAMPOS_DATO, ContratoSchema, UMBRAL, esFechaValida, diasEntre, esContrato, fechasES, extraerContrato, motivoNoContrato, similitud, slug, type Contrato } from "./extraccion.js";

const idMensaje = z.string().describe("Id del mensaje del buzón, p. ej. msg-001");
const fechaCorreo = (c: Correo) => c.fecha.slice(0, 10);

type Analisis = { correo: Correo; adjunto: string | null; texto: string | null; motivo: string | null; avisos: string[] };
const contexto = (ctx: ToolCtx, correo: Correo) => ({ de: correo.de, asunto: correo.asunto, cuerpo: correo.cuerpo, fechaCorreo: fechaCorreo(correo), comerciales: leerComerciales(ctx) });
const CRUCE = ["id_contrato", "cliente", "nit_cliente", "valor", "moneda", "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza"] as const;

/** Lee los PDF adjuntos (si los hay) y los cruza con el contrato en texto. El TXT siempre prevalece: el PDF solo genera avisos. */
async function cruzarConPdf(ctx: ToolCtx, correo: Correo, textoTxt: string): Promise<string[]> {
  const avisos: string[] = []; const base = extraerContrato(textoTxt, contexto(ctx, correo));
  for (const nombre of correo.adjuntos.filter((n) => /\.pdf$/i.test(n))) {
    const bytes = leerBytesAdjunto(ctx, correo.id, nombre);
    if (!bytes) { avisos.push(`PDF "${nombre}" no encontrado: no se pudo validar contra el TXT.`); continue; }
    let pdf: string;
    try { pdf = (await textoDePdf(bytes)).texto; } catch { avisos.push(`PDF "${nombre}" ilegible: no se pudo validar contra el TXT.`); continue; }
    if (!pdf.trim()) { avisos.push(`PDF "${nombre}" sin capa de texto (¿escaneado?): requiere OCR para validarlo; prevalece el TXT.`); continue; }
    const delPdf = extraerContrato(pdf, contexto(ctx, correo));
    for (const k of CRUCE) {
      if (delPdf[k] === null || base[k] === null) continue;
      if (String(delPdf[k]).toLowerCase() !== String(base[k]).toLowerCase()) avisos.push(`El PDF "${nombre}" difiere del TXT en ${k}: txt=${base[k]}, pdf=${delPdf[k]}. Prevalece el TXT.`);
    }
  }
  return avisos;
}

/** Decide si el mensaje trae un contrato (RN4) y devuelve el texto contractual. Prioridad: TXT; si no hay, el texto del PDF. */
async function analizar(ctx: ToolCtx, id: string): Promise<Analisis> {
  const correo = leerCorreo(ctx, id);
  let ultimo: { nombre: string; texto: string | null } | null = null;
  for (const nombre of correo.adjuntos.filter((n) => !/\.pdf$/i.test(n))) {
    const r = leerAdjunto(ctx, id, nombre);
    const texto = "texto" in r ? r.texto : null;
    if (texto && esContrato(texto)) return { correo, adjunto: nombre, texto, motivo: null, avisos: await cruzarConPdf(ctx, correo, texto) };
    ultimo = { nombre, texto };
  }
  for (const nombre of correo.adjuntos.filter((n) => /\.pdf$/i.test(n))) { // sin TXT: el PDF es la única fuente
    const bytes = leerBytesAdjunto(ctx, id, nombre);
    const texto = bytes ? await textoDePdf(bytes).then((r) => r.texto, () => "") : "";
    if (texto && esContrato(texto)) return { correo, adjunto: nombre, texto, motivo: null, avisos: [`Fuente única: PDF "${nombre}" (no hay contrato.txt); validar con el original.`] };
    ultimo = ultimo ?? { nombre, texto: texto || null };
  }
  return { correo, adjunto: null, texto: null, motivo: motivoNoContrato(ultimo?.nombre ?? null, ultimo?.texto ?? null), avisos: [] };
}

const ISO_NO_SOPORTADAS = "EUR|GBP|MXN|CLP|BRL|ARS|UYU|PYG|BOB|VES|CRC|GTQ|DOP|CAD|CHF|JPY|CNY";
/** HU-6: fecha inexistente o moneda desconocida en el documento → error legible (el agente sigue con el siguiente mensaje). */
function errorDeDatos(texto: string): string | null {
  if (fechasES(texto).some((f) => f === null)) return "el documento contiene una fecha inválida (p. ej. un día inexistente del calendario)";
  const m = texto.match(new RegExp(`\\b(${ISO_NO_SOPORTADAS})\\b\\s*\\$?\\s*\\d`));
  return m ? `moneda desconocida o no soportada: ${m[1]} (soportadas: COP, USD, PEN, PAB, HNL)` : null;
}

async function extraerDe(ctx: ToolCtx, id: string): Promise<{ contrato: Contrato; a: Analisis } | { rechazo: string; a: Analisis } | { error: string }> {
  const a = await analizar(ctx, id);
  if (!a.texto) return { rechazo: a.motivo ?? "sin contrato", a };
  const e = errorDeDatos(a.texto); if (e) return { error: `Mensaje ${id}: ${e}.` };
  const contrato = extraerContrato(a.texto, contexto(ctx, a.correo));
  contrato.alertas.push(...a.avisos);
  return { contrato, a };
}

// ───────── Validación (RN1–RN5)
const COMPARABLES = ["cliente", "nit_cliente", "pais", "objeto", "valor", "moneda", "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza"] as const;
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const bajaConfianza = (c: Contrato, k: string) => (c.confianza[k] ?? 0) < UMBRAL;

interface Evaluacion {
  clasificacion: "nuevo" | "actualizacion" | "duplicado";
  id_contrato_existente?: string;
  requiere_revision: string[];
  detalle_revision: Record<string, string>;
  diferencias: Record<string, { antes: string; despues: string }>;
  comercial_resuelto: boolean;
}

function evaluar(ctx: ToolCtx, c: Contrato): Evaluacion {
  const maestro = leerMaestro(ctx);
  const porId = c.id_contrato ? maestro.find((f) => f.id_contrato.toLowerCase() === c.id_contrato!.toLowerCase()) : undefined;
  const porNit = !porId && c.nit_cliente && c.objeto ? maestro.find((f) => f.nit_cliente === c.nit_cliente && similitud(f.objeto, c.objeto!) >= 0.9) : undefined; // RG1: NIT antes que nombre
  const ex = porId ?? porNit;
  const revision = new Map<string, string>();
  const marcar = (k: string, m: string) => { if (!revision.has(k)) revision.set(k, m); };
  const diferencias: Evaluacion["diferencias"] = {};
  const comercial_resuelto = c.comercial !== null;

  if (ex) {
    for (const k of COMPARABLES) {
      const nuevo = c[k]; if (nuevo === null || nuevo === undefined) continue;
      const antes = ex[k]; const despues = typeof nuevo === "boolean" ? String(nuevo) : texto(nuevo);
      const igual = k === "valor" ? Number(antes) === Number(despues) : antes === despues;
      if (!igual) diferencias[k] = { antes, despues };
    }
    const rn1 = Boolean(porId) && ["valor", "fecha_inicio", "fecha_fin"].every((k) => !(k in diferencias) || c[k as "valor"] === null);
    const clasificacion = !c.es_otrosi && rn1 ? "duplicado" : Object.keys(diferencias).length === 0 ? "duplicado" : "actualizacion";
    if (clasificacion === "actualizacion") {
      for (const k of CAMPOS_DATO) if (c[k] !== null && bajaConfianza(c, k)) marcar(k, `confianza ${(c.confianza[k] ?? 0).toFixed(2)} < ${UMBRAL}`);
      if (!c.es_otrosi) for (const k of Object.keys(diferencias)) marcar(k, "difiere del maestro y el documento no es un otrosí");
      if (diferencias.nit_cliente) marcar("nit_cliente", "el NIT difiere del registrado para ese contrato");
    }
    return { clasificacion, id_contrato_existente: ex.id_contrato, requiere_revision: [...revision.keys()], detalle_revision: Object.fromEntries(revision), diferencias: clasificacion === "duplicado" ? {} : diferencias, comercial_resuelto };
  }

  // Nuevo: todo campo ausente o con confianza < 0.8 exige confirmación humana (no se asume nada)
  // el comercial desconocido NO bloquea (HU-3): queda como observación en `alertas`
  const obligatorios = CAMPOS_DATO.filter((k) => k !== "comercial" && (k !== "tipo_poliza" || c.requiere_poliza === true));
  for (const k of obligatorios) {
    if (c[k] === null) marcar(k, "no figura en el documento");
    else if (bajaConfianza(c, k)) marcar(k, `confianza ${(c.confianza[k] ?? 0).toFixed(2)} < ${UMBRAL}`);
  }
  return { clasificacion: "nuevo", requiere_revision: [...revision.keys()], detalle_revision: Object.fromEntries(revision), diferencias: {}, comercial_resuelto };
}

// ───────── Archivo
const estadoContrato = (fin: string, ref: string) => (fin && diasEntre(ref, fin) < 0 ? "vencido" : "vigente");
const unir = (a: string, b: string[]) => [...new Set([...a.split(" | ").filter(Boolean), ...b])].join(" | ");

function archivar(ctx: ToolCtx, origen: { id: string; adjunto: string }, destinoRel: string) {
  const dest = path.resolve(sharepointDir(ctx), destinoRel);
  if (!dest.startsWith(path.resolve(sharepointDir(ctx)) + path.sep)) throw new Error("ruta de destino fuera de out/");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(fixturesDir(ctx), "buzon", origen.id, origen.adjunto), dest);
}

// ───────── Herramientas
export const leer_buzon = conLog("leer_buzon", defineTool({
  description: "Lista los mensajes del buzón aún no procesados con { id, de, asunto, fecha, adjuntos, tiene_contrato } (y el motivo si no traen contrato).",
  args: {},
  async execute(_a, ctx) {
    const hechos = leerProcesados(ctx);
    const mensajes = [];
    for (const id of listarIdsBuzon(ctx).filter((x) => !(x in hechos))) {
      const a = await analizar(ctx, id);
      mensajes.push({ id, de: a.correo.de, asunto: a.correo.asunto, fecha: a.correo.fecha, adjuntos: a.correo.adjuntos, tiene_contrato: a.texto !== null, ...(a.texto ? {} : { clasificacion: "rechazado", motivo: a.motivo }) });
    }
    return ok({ mensajes });
  },
}));

export const extraer = conLog("extraer", defineTool({
  description: "Extrae del contrato adjunto de un mensaje los datos estructurados con confianza [0,1] por campo; lo ausente es null con confianza 0. Falla si el mensaje no trae contrato.",
  args: { mensaje_id: idMensaje },
  async execute({ mensaje_id }, ctx) {
    const r = await extraerDe(ctx, mensaje_id);
    if ("error" in r) return fail(r.error);
    if ("rechazo" in r) return fail(`El mensaje ${mensaje_id} no contiene un contrato: ${r.rechazo}`);
    return ok({ ...r.contrato, adjunto: r.a.adjunto, remitente: r.a.correo.de, fecha_correo: fechaCorreo(r.a.correo) });
  },
}));

export const validar = conLog("validar", defineTool({
  description: "Clasifica el contrato extraído como nuevo, actualizacion, duplicado o rechazado (RN1–RN4) y lista los campos que requieren revisión humana (confianza < 0.8, ausentes o en conflicto con el maestro). Sin 'contrato' evalúa el mensaje (útil para rechazados).",
  args: { mensaje_id: idMensaje, contrato: ContratoSchema.optional().describe("Contrato tal como lo devolvió contratos_extraer (con las correcciones del humano si las hay)") },
  async execute({ mensaje_id, contrato }, ctx) {
    const r = contrato ? { contrato, a: await analizar(ctx, mensaje_id) } : await extraerDe(ctx, mensaje_id);
    if ("error" in r) return fail(r.error);
    if ("rechazo" in r) return ok({ clasificacion: "rechazado", motivo: r.rechazo, requiere_revision: [] });
    return ok(evaluar(ctx, r.contrato));
  },
}));

export const registrar = conLog("registrar", defineTool({
  description: "Registra en el maestro (nuevo/actualización), archiva el documento y deja historial. Solo escribe si no hay campos en revisión o si confirmado=true tras la respuesta explícita del usuario. Duplicados y rechazados no escriben.",
  args: {
    mensaje_id: idMensaje,
    contrato: ContratoSchema.optional().describe("Contrato validado; si se omite se extrae del mensaje"),
    confirmado: z.boolean().optional().describe("true SOLO si el usuario confirmó explícitamente en su último mensaje los campos en revisión"),
  },
  async execute({ mensaje_id, contrato, confirmado }, ctx) {
    const previo = leerProcesados(ctx)[mensaje_id];
    if (previo) return ok({ id_contrato: previo.id_contrato ?? null, accion: "ya_procesado", ruta_archivo: null, detalle: `El mensaje ya se procesó (${previo.accion}).` });

    const r = contrato ? { contrato, a: await analizar(ctx, mensaje_id) } : await extraerDe(ctx, mensaje_id);
    if ("error" in r) return fail(r.error);
    if ("rechazo" in r || !r.a.texto || !r.a.adjunto) {
      marcarProcesado(ctx, mensaje_id, "rechazado");
      return ok({ id_contrato: null, accion: "rechazado", ruta_archivo: null, motivo: "rechazo" in r ? r.rechazo : r.a.motivo });
    }
    const c = r.contrato; const a = r.a; const adjunto: string = r.a.adjunto; const ev = evaluar(ctx, c);

    if (ev.clasificacion === "duplicado") {
      marcarProcesado(ctx, mensaje_id, "duplicado", ev.id_contrato_existente);
      return ok({ id_contrato: ev.id_contrato_existente ?? null, accion: "duplicado", ruta_archivo: null });
    }
    if (ev.requiere_revision.length && !confirmado) return fail(`requiere revisión: ${ev.requiere_revision.join(", ")}. Pregunta al usuario y vuelve a llamar con confirmado=true solo tras su confirmación.`);
    if (confirmado && ev.requiere_revision.length && ctx.puedeConfirmar && !ctx.puedeConfirmar(mensaje_id)) return fail("confirmado=true no permitido: el usuario aún no ha respondido a la pregunta de confirmación de este mensaje.");

    const maestro = leerMaestro(ctx); const ref = fechaCorreo(a.correo); const ext = path.extname(adjunto).toLowerCase() || ".txt";

    if (ev.clasificacion === "actualizacion") {
      const fila = maestro.find((f) => f.id_contrato === ev.id_contrato_existente)!;
      const cambios: Record<string, unknown> = { ...ev.diferencias };
      for (const [k, d] of Object.entries(ev.diferencias)) (fila as Record<string, string>)[k] = d.despues;
      const alertasNuevas = unir(fila.alertas, c.alertas);
      if (alertasNuevas !== fila.alertas) { cambios.alertas = { antes: fila.alertas, despues: alertasNuevas }; fila.alertas = alertasNuevas; }
      fila.estado_contrato = estadoContrato(fila.fecha_fin, ref);
      const rel = path.posix.join(path.posix.dirname(fila.ruta_sharepoint), `${fila.id_contrato}_${c.es_otrosi ? "otrosi_" : "doc_"}${mensaje_id}${ext}`);
      archivar(ctx, { id: mensaje_id, adjunto }, rel);
      guardarMaestro(ctx, maestro);
      appendHistorial(ctx, { id_contrato: fila.id_contrato, accion: "actualizado", cambios, mensaje_id });
      marcarProcesado(ctx, mensaje_id, "actualizado", fila.id_contrato);
      return ok({ id_contrato: fila.id_contrato, accion: "actualizado", ruta_archivo: rel });
    }

    // nuevo: aun confirmado, un dato indispensable no puede quedar vacío
    const faltan = (["cliente", "nit_cliente", "pais", "objeto", "valor", "moneda", "fecha_inicio", "fecha_fin", "requiere_poliza"] as const).filter((k) => c[k] === null);
    if (faltan.length) return fail(`faltan campos obligatorios para registrar: ${faltan.join(", ")}. Pide el dato al usuario.`);
    let id = c.id_contrato;
    if (!id) { const anio = c.fecha_inicio!.slice(0, 4); id = `AUTO-${anio}-${String(maestro.filter((f) => f.id_contrato.startsWith(`AUTO-${anio}-`)).length + 1).padStart(3, "0")}`; }
    if (!ID_CONTRATO.test(id)) return fail(`id_contrato inválido: "${id}"`);
    const rel = `Contratos/${c.fecha_inicio!.slice(0, 4)}/${slug(c.cliente!)}/${id}${ext}`;
    archivar(ctx, { id: mensaje_id, adjunto }, rel);
    const fila: Fila = {
      id_contrato: id, cliente: c.cliente!, nit_cliente: c.nit_cliente!, pais: c.pais!, objeto: c.objeto!, valor: String(c.valor), moneda: c.moneda!,
      fecha_inicio: c.fecha_inicio!, fecha_fin: c.fecha_fin!, requiere_poliza: String(c.requiere_poliza), tipo_poliza: c.requiere_poliza ? c.tipo_poliza ?? "" : "",
      estado_poliza: c.requiere_poliza ? "pendiente" : "no_aplica", comercial: c.comercial ?? "", ruta_sharepoint: rel, fecha_registro: ref, fuente: "buzon",
      estado_contrato: estadoContrato(c.fecha_fin!, ref), alertas: c.alertas.join(" | "),
    };
    maestro.push(fila); guardarMaestro(ctx, maestro);
    appendHistorial(ctx, { id_contrato: id, accion: "insertado", cambios: { fila: "nueva", confirmado: Boolean(confirmado && ev.requiere_revision.length), campos_en_revision: ev.requiere_revision }, mensaje_id });
    marcarProcesado(ctx, mensaje_id, "insertado", id);
    return ok({ id_contrato: id, accion: "insertado", ruta_archivo: rel });
  },
}));

export const leer_pdf = conLog("leer_pdf", defineTool({
  description: "Lee el texto de un PDF con capa de texto del buzón (ruta relativa a fixtures/, p. ej. buzon/msg-001/contrato.pdf). Un PDF escaneado sin texto devuelve error: requiere OCR.",
  args: { ruta: z.string().min(1).max(200).describe("Ruta relativa a fixtures/reto-02, p. ej. buzon/msg-001/contrato.pdf") },
  async execute({ ruta }, ctx) {
    if (!/\.pdf$/i.test(ruta)) return fail("La ruta debe apuntar a un archivo .pdf");
    const p = rutaEnFixtures(ctx, ruta); if (!p) return fail(`No existe el PDF "${ruta}" dentro de fixtures/`);
    const r = await textoDePdf(new Uint8Array(fs.readFileSync(p)));
    if (!r.texto.trim()) return fail("El PDF no tiene capa de texto (¿escaneado?): requiere OCR, no disponible en esta versión.");
    return ok({ texto: r.texto, paginas: r.paginas });
  },
}));

export const alertas = conLog("alertas", defineTool({
  description: "Genera out/alertas.md con contratos que vencen en ≤ 60 días (y vencidos), pólizas pendientes y contratos registrados desde el corte; actualiza estado_contrato. 'hoy' es la fecha de referencia YYYY-MM-DD.",
  args: { hoy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(esFechaValida, "fecha inexistente").describe("Fecha de referencia YYYY-MM-DD") },
  async execute({ hoy }, ctx) {
    const maestro = leerMaestro(ctx);
    for (const f of maestro) f.estado_contrato = estadoContrato(f.fecha_fin, hoy);
    guardarMaestro(ctx, maestro);
    const dias = (f: Fila) => diasEntre(hoy, f.fecha_fin);
    const vencen = maestro.filter((f) => dias(f) <= 60).sort((a, b) => dias(a) - dias(b) || a.id_contrato.localeCompare(b.id_contrato)).map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_fin: f.fecha_fin, dias: dias(f), estado_contrato: f.estado_contrato }));
    const polizas_pendientes = maestro.filter((f) => f.requiere_poliza === "true" && f.estado_poliza !== "vigente").map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, tipo_poliza: f.tipo_poliza, estado_poliza: f.estado_poliza }));
    const registrados_desde_corte = maestro.filter((f) => f.fecha_registro >= FECHA_CORTE()).map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_registro: f.fecha_registro, fuente: f.fuente }));
    const obs = maestro.filter((f) => f.alertas).map((f) => ({ id_contrato: f.id_contrato, alertas: f.alertas }));
    const tabla = (cab: string[], filas: string[][]) => filas.length ? [`| ${cab.join(" | ")} |`, `|${cab.map(() => "---").join("|")}|`, ...filas.map((r) => `| ${r.join(" | ")} |`)].join("\n") : "_Sin registros._";
    const md = [
      `# Alertas de contratos — referencia ${hoy}`, "",
      "## 1. Vencen en ≤ 60 días (y ya vencidos)", tabla(["Contrato", "Cliente", "Fecha fin", "Días", "Estado"], vencen.map((v) => [v.id_contrato, v.cliente, v.fecha_fin, v.dias < 0 ? `vencido hace ${-v.dias}` : String(v.dias), v.estado_contrato])), "",
      "## 2. Pólizas pendientes (requiere póliza y estado ≠ vigente)", tabla(["Contrato", "Cliente", "Tipo", "Estado póliza"], polizas_pendientes.map((p) => [p.id_contrato, p.cliente, p.tipo_poliza, p.estado_poliza])), "",
      `## 3. Registrados desde el corte (${FECHA_CORTE()})`, tabla(["Contrato", "Cliente", "Fecha registro", "Fuente"], registrados_desde_corte.map((r) => [r.id_contrato, r.cliente, r.fecha_registro, r.fuente])), "",
      "## 4. Observaciones detectadas (campo `alertas`)", tabla(["Contrato", "Observaciones"], obs.map((o) => [o.id_contrato, o.alertas])), "",
    ].join("\n");
    const ruta = path.join(outDir(ctx), "alertas.md"); fs.mkdirSync(outDir(ctx), { recursive: true }); fs.writeFileSync(ruta, md);
    return ok({ ruta: "out/alertas.md", vencen, polizas_pendientes, registrados_desde_corte, observaciones: obs });
  },
}));

// ───────── Log (RN7): cada herramienta exportada ya registra su llamada en out/log.jsonl
function conLog(nombre: string, t: ToolDef): ToolDef {
  return {
    ...t,
    async execute(raw: unknown, ctx: ToolCtx) {
      const out = await t.execute(raw, ctx);
      try {
        const r = JSON.parse(out) as { ok: boolean; error?: string; data?: { accion?: string; clasificacion?: string } };
        const m = (raw as { mensaje_id?: unknown } | null)?.mensaje_id;
        const mid = typeof m === "string" && ID_MENSAJE.test(m) ? m : null;
        appendLog(ctx, { herramienta: `contratos_${nombre}`, mensaje_id: mid, ok: r.ok, resumen: r.ok ? r.data?.accion ?? r.data?.clasificacion ?? "ok" : String(r.error).slice(0, 200) });
      } catch { /* el log nunca debe romper la herramienta */ }
      return out;
    },
  };
}
