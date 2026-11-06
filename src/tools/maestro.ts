/** Acceso a fixtures (solo lectura) y a out/<sessionId>/ (escritura). Aquí viven las rutas y el CSV. */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ToolCtx } from "./registry.js";

export const COLUMNAS = [
  "id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda", "fecha_inicio", "fecha_fin",
  "requiere_poliza", "tipo_poliza", "estado_poliza", "comercial", "ruta_sharepoint", "fecha_registro", "fuente",
  "estado_contrato", "alertas", // columnas añadidas (decisión de diseño: estado de vigencia y observaciones detectadas)
] as const;
export type Columna = (typeof COLUMNAS)[number];
export type Fila = Record<Columna, string>;

export const ID_MENSAJE = /^[A-Za-z0-9_-]{1,40}$/;
export const ID_CONTRATO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const ID_SESION = /^[A-Za-z0-9_-]{1,64}$/;

export const FECHA_CORTE = () => process.env.FECHA_CORTE ?? "2026-05-30";

export function fixturesDir(ctx: ToolCtx): string {
  return path.resolve(ctx.directory, process.env.FIXTURES_DIR ?? "fixtures/reto-02");
}
/** Carpeta de salida de ESTA sesión: los casos no se contaminan entre sí. */
export function outDir(ctx: ToolCtx): string {
  if (!ID_SESION.test(ctx.sessionId)) throw new Error("sessionId inválido");
  if (ctx.outDir) {
    const d = path.resolve(ctx.directory, ctx.outDir);
    if (!d.startsWith(path.resolve(ctx.directory, "out"))) throw new Error("outDir debe estar dentro de out/");
    return d;
  }
  return path.resolve(ctx.directory, "out", ctx.sessionId);
}
export const sharepointDir = (ctx: ToolCtx) => path.join(outDir(ctx), "sharepoint");

// ───────── CSV
export function parseCsv(texto: string): string[][] {
  const filas: string[][] = []; let fila: string[] = []; let campo = ""; let q = false;
  const t = texto.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') q = false; else campo += c; }
    else if (c === '"') q = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; fila.push(campo); campo = ""; if (fila.some((x) => x !== "") || fila.length > 1) filas.push(fila); fila = []; }
    else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}
const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsv = (filas: Fila[]) => [COLUMNAS.join(","), ...filas.map((f) => COLUMNAS.map((c) => esc(f[c] ?? "")).join(","))].join("\n") + "\n";

function filasDesdeCsv(texto: string): Fila[] {
  const [enc, ...resto] = parseCsv(texto);
  return resto.map((r) => Object.fromEntries(COLUMNAS.map((c) => [c, r[enc.indexOf(c)] ?? ""])) as Fila);
}

// ───────── Maestro (RN6: la primera ejecución copia el fixture a out/)
const maestroPath = (ctx: ToolCtx) => path.join(sharepointDir(ctx), "maestro-contratos.csv");
export function leerMaestro(ctx: ToolCtx): Fila[] {
  const p = maestroPath(ctx);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(sharepointDir(ctx), { recursive: true });
    fs.writeFileSync(p, toCsv(filasDesdeCsv(fs.readFileSync(path.join(fixturesDir(ctx), "maestro-contratos.csv"), "utf8"))));
  }
  return filasDesdeCsv(fs.readFileSync(p, "utf8"));
}
export const guardarMaestro = (ctx: ToolCtx, filas: Fila[]) => { fs.mkdirSync(sharepointDir(ctx), { recursive: true }); fs.writeFileSync(maestroPath(ctx), toCsv(filas)); };

// ───────── Historial, log, procesados
const append = (p: string, o: unknown) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(o) + "\n"); };
export const appendHistorial = (ctx: ToolCtx, o: { id_contrato: string; accion: string; cambios: unknown; mensaje_id: string }) =>
  append(path.join(sharepointDir(ctx), "historial.jsonl"), { ts: new Date().toISOString(), ...o });
export const appendLog = (ctx: ToolCtx, o: { herramienta: string; mensaje_id: string | null; ok: boolean; resumen: string }) =>
  append(path.join(outDir(ctx), "log.jsonl"), { ts: new Date().toISOString(), ...o });

export type Procesados = Record<string, { accion: string; id_contrato?: string; ts: string }>;
export function leerProcesados(ctx: ToolCtx): Procesados {
  const p = path.join(outDir(ctx), "procesados.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Procesados) : {};
}
export function marcarProcesado(ctx: ToolCtx, id: string, accion: string, id_contrato?: string) {
  const p = leerProcesados(ctx); p[id] = { accion, id_contrato, ts: new Date().toISOString() };
  fs.mkdirSync(outDir(ctx), { recursive: true });
  fs.writeFileSync(path.join(outDir(ctx), "procesados.json"), JSON.stringify(p, null, 2));
}

// ───────── Buzón y comerciales (solo lectura)
const Correo = z.object({ id: z.string(), de: z.string(), para: z.string().optional(), asunto: z.string(), fecha: z.string(), cuerpo: z.string(), adjuntos: z.array(z.string()) });
export type Correo = z.infer<typeof Correo>;

export function listarIdsBuzon(ctx: ToolCtx): string[] {
  const d = path.join(fixturesDir(ctx), "buzon");
  return fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && ID_MENSAJE.test(e.name)).map((e) => e.name).sort() : [];
}
export function leerCorreo(ctx: ToolCtx, id: string): Correo {
  if (!ID_MENSAJE.test(id)) throw new Error(`mensaje_id inválido: "${id}"`);
  const p = path.join(fixturesDir(ctx), "buzon", id, "correo.json");
  if (!fs.existsSync(p)) throw new Error(`No existe el mensaje ${id} en el buzón`);
  const r = Correo.safeParse(JSON.parse(fs.readFileSync(p, "utf8")));
  if (!r.success) throw new Error(`El correo ${id} tiene un formato inválido`);
  return r.data;
}
/** Texto de un adjunto. Solo texto plano (.txt/.md); PDF/OCR quedan fuera de alcance (PRD 3.2). */
export function leerAdjunto(ctx: ToolCtx, id: string, nombre: string): { texto: string } | { error: string } {
  if (path.basename(nombre) !== nombre || nombre.includes("..")) return { error: `nombre de adjunto inválido: ${nombre}` };
  if (!/\.(txt|md)$/i.test(nombre)) return { error: `adjunto "${nombre}" no es texto plano (PDF/escaneo fuera de alcance)` };
  const p = path.join(fixturesDir(ctx), "buzon", id, nombre);
  if (!fs.existsSync(p)) return { error: `no existe el adjunto ${nombre}` };
  const texto = fs.readFileSync(p, "utf8");
  return texto.trim() ? { texto } : { error: `el adjunto "${nombre}" está vacío` };
}
export function leerComerciales(ctx: ToolCtx): { email: string; nombre: string; region: string }[] {
  return z.array(z.object({ email: z.string(), nombre: z.string(), region: z.string() })).parse(JSON.parse(fs.readFileSync(path.join(fixturesDir(ctx), "comerciales.json"), "utf8")));
}

/** Solo lectura: devuelve el maestro de la sesión si existe, o el del fixture, SIN crear carpetas. */
export function maestroSinCrear(ctx: ToolCtx): Fila[] {
  return fs.existsSync(maestroPath(ctx)) ? filasDesdeCsv(fs.readFileSync(maestroPath(ctx), "utf8")) : filasDesdeCsv(fs.readFileSync(path.join(fixturesDir(ctx), "maestro-contratos.csv"), "utf8"));
}
export function leerTextoOut(ctx: ToolCtx, rel: string): string | null {
  const p = path.resolve(outDir(ctx), rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}
export const borrarSalida = (ctx: ToolCtx) => fs.rmSync(outDir(ctx), { recursive: true, force: true });

/** Bytes de un adjunto PDF del buzón (solo lectura, nombre saneado). */
export function leerBytesAdjunto(ctx: ToolCtx, id: string, nombre: string): Uint8Array | null {
  if (path.basename(nombre) !== nombre || nombre.includes("..")) return null;
  const p = path.join(fixturesDir(ctx), "buzon", id, nombre);
  return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null;
}
/** Resuelve una ruta relativa a fixtures/ y exige que quede dentro (anti path traversal). */
export function rutaEnFixtures(ctx: ToolCtx, rel: string): string | null {
  const base = fixturesDir(ctx); const p = path.resolve(base, rel);
  return p.startsWith(base + path.sep) && fs.existsSync(p) ? p : null;
}
