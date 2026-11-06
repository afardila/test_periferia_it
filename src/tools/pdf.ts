/** Lectura de PDF con capa de texto (unpdf/pdf.js, sin binarios nativos). Un PDF escaneado (sin texto) requiere OCR. */
import { extractText, getDocumentProxy } from "unpdf";

export interface PdfTexto { texto: string; paginas: number }

/** Las cláusulas se reconocen por párrafos; el PDF pierde las líneas en blanco, así que se restauran antes de cada cláusula. */
const ORDINAL = "PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|S[ÉE]PTIMA|OCTAVA|NOVENA|D[ÉE]CIMA";
export function normalizarTextoPdf(t: string): string {
  return t.replace(/[ \t]*\r?\n[ \t]*/g, " ").replace(new RegExp(`\\s+(?=(?:${ORDINAL})\\.\\s)`, "g"), "\n\n").replace(/\s+(?=Para constancia)/g, "\n\n").replace(/\s{2,}(?=Entre\s)/g, "\n\n").trim();
}

export async function textoDePdf(bytes: Uint8Array): Promise<PdfTexto> {
  const doc = await getDocumentProxy(bytes);
  const { text, totalPages } = await extractText(doc, { mergePages: true });
  return { texto: normalizarTextoPdf(Array.isArray(text) ? text.join("\n") : text), paginas: totalPages };
}
