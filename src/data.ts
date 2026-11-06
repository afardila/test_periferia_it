import fs from "node:fs";
import path from "node:path";

/**
 * Capa de datos simulada (el "SharePoint" del reto).
 * - Los fixtures (maestro base, comerciales, buzón) son de SOLO LECTURA y compartidos.
 * - Todo lo que se escribe vive en un Store POR SESIÓN: un caso nunca ve lo que otro registró.
 * Nota: COLUMNAS y las rutas de archivos deben coincidir con el formato real de los datos del PRD.
 */
export const FIXTURES = path.resolve(process.env.FIXTURES_DIR ?? "./fixtures-demo");
export const FECHA_CORTE = process.env.FECHA_CORTE ?? "2026-05-30";

export type Row = Record<string, string>;

/** Columnas del maestro. Ajustar al CSV real. */
export const COLUMNAS = [
  "numero", "cliente", "nit", "objeto", "valor", "moneda",
  "fecha_inicio", "fecha_fin", "comercial_email", "estado", "version",
] as const;

export interface Comercial { email: string; nombre: string; region?: string }
export interface Evento { ts: string; tipo: string; detalle: Record<string, unknown> }
export interface Store {
  maestro: Row[];
  archivo: { numero: string; id_mensaje: string; archivo: string; texto: string }[];
  rechazados: { id_mensaje: string; motivo: string }[];
  auditoria: Evento[];
}

/** CSV mínimo con soporte de comillas y saltos de línea \r\n. */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = "", q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { cur.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      cur.push(field); field = "";
      if (cur.some((x) => x !== "")) rows.push(cur);
      cur = [];
    } else field += c;
  }
  if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

function readIfExists(p: string): string | null {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

let baseline: Row[] | null = null;
/** Store nuevo y aislado: copia del maestro base congelado + listas vacías. */
export function createStore(): Store {
  if (!baseline) {
    const csv = readIfExists(path.join(FIXTURES, "maestro-contratos.csv"));
    baseline = csv ? parseCsv(csv) : [];
  }
  return { maestro: baseline.map((r) => ({ ...r })), archivo: [], rechazados: [], auditoria: [] };
}

export function audit(store: Store, tipo: string, detalle: Record<string, unknown>) {
  store.auditoria.push({ ts: new Date().toISOString(), tipo, detalle });
}

export function getComerciales(): Comercial[] {
  const raw = readIfExists(path.join(FIXTURES, "comerciales.json"));
  if (!raw) return [];
  const j = JSON.parse(raw);
  return Array.isArray(j) ? j : (j.comerciales ?? []);
}

export const BUZON_DIR = path.join(FIXTURES, "buzon");

/** Ids/nombres seguros: sin separadores ni "..", para impedir path traversal. */
const ID_SEGURO = /^[A-Za-z0-9_-]+$/;
const NOMBRE_SEGURO = /^[A-Za-z0-9_][A-Za-z0-9_. -]*$/;
export const esIdSeguro = (s: string) => ID_SEGURO.test(s);
export const esNombreSeguro = (s: string) => NOMBRE_SEGURO.test(s) && !s.includes("..");

export function listarMensajes(): string[] {
  if (!fs.existsSync(BUZON_DIR)) return [];
  return fs.readdirSync(BUZON_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

/** Lee todo lo que haya en la carpeta del mensaje: .json → metadatos, .txt/.md/.eml → texto de adjuntos. */
export function leerMensaje(id: string) {
  if (!esIdSeguro(id)) return null;
  const dir = path.join(BUZON_DIR, id);
  if (!fs.existsSync(dir)) return null;
  const archivos: { nombre: string; texto: string }[] = [];
  let correo: unknown = null;
  for (const f of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, f);
    if (f.endsWith(".json")) {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
      if (f.startsWith("correo")) correo = parsed;
      else archivos.push({ nombre: f, texto: JSON.stringify(parsed) });
    } else if (/\.(txt|md|eml)$/.test(f)) archivos.push({ nombre: f, texto: fs.readFileSync(p, "utf8") });
  }
  return { id, correo, archivos };
}

export function diasEntre(desdeISO: string, hastaISO: string): number {
  return Math.round((Date.parse(hastaISO) - Date.parse(desdeISO)) / 86_400_000);
}
