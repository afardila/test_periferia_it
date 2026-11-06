/** Lectura de PDF y validación cruzada contra contrato.txt (el TXT siempre prevalece). AC-49..52 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tools } from "../src/tools/index.js";
import { llamar, type ToolCtx } from "../src/tools/registry.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "fixtures/reto-02");
const TMP = fs.mkdtempSync(path.join(ROOT, "out-test-pdf-"));
let n = 0; const ctx = (): ToolCtx => ({ directory: ROOT, sessionId: `pdf-${process.pid}-${++n}` });
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** PDF mínimo válido con texto plano (Helvetica) para pruebas; sin tildes (fuente estándar). */
function pdfConTexto(lineas: string[]): Buffer {
  const esc = (t: string) => t.replace(/[\\()]/g, "\\$&");
  const flujo = `BT /F1 9 Tf 40 780 Td 11 TL ${lineas.map((l) => `(${esc(l)}) '`).join(" ")} ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const off: number[] = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
/** Parte el texto en líneas cortas (como en un PDF real: una línea larga se sale de la página y se recorta). */
const lineas = (t: string) => t.split("\n").filter((l) => l.trim()).flatMap((l) => l.replace(/[^\x20-\x7e]/g, "?").match(/.{1,80}(\s|$)/g) ?? []).map((l) => l.trim());

let prev: string | undefined;
before(() => {
  fs.cpSync(SRC, TMP, { recursive: true });
  const txt = fs.readFileSync(path.join(SRC, "buzon/msg-001/contrato.txt"), "utf8");
  const dir = (id: string) => path.join(TMP, "buzon", id);
  const correo = (id: string, adj: string[]) => JSON.parse(fs.readFileSync(path.join(SRC, "buzon/msg-001/correo.json"), "utf8").replace("msg-001", id)) && { ...JSON.parse(fs.readFileSync(path.join(SRC, "buzon/msg-001/correo.json"), "utf8")), id, adjuntos: adj };
  // msg-901: TXT + PDF coherente
  fs.mkdirSync(dir("msg-901"), { recursive: true }); fs.writeFileSync(path.join(dir("msg-901"), "contrato.txt"), txt); fs.writeFileSync(path.join(dir("msg-901"), "contrato.pdf"), pdfConTexto(lineas(txt)));
  fs.writeFileSync(path.join(dir("msg-901"), "correo.json"), JSON.stringify(correo("msg-901", ["contrato.txt", "contrato.pdf"])));
  // msg-902: PDF con valor distinto
  fs.mkdirSync(dir("msg-902"), { recursive: true }); fs.writeFileSync(path.join(dir("msg-902"), "contrato.txt"), txt);
  fs.writeFileSync(path.join(dir("msg-902"), "contrato.pdf"), pdfConTexto(lineas(txt.replace("265.000.000", "999.000.000"))));
  fs.writeFileSync(path.join(dir("msg-902"), "correo.json"), JSON.stringify(correo("msg-902", ["contrato.txt", "contrato.pdf"])));
  // msg-903: solo PDF
  fs.mkdirSync(dir("msg-903"), { recursive: true }); fs.writeFileSync(path.join(dir("msg-903"), "contrato.pdf"), pdfConTexto(lineas(txt)));
  fs.writeFileSync(path.join(dir("msg-903"), "correo.json"), JSON.stringify(correo("msg-903", ["contrato.pdf"])));
  // msg-904: PDF sin texto (escaneado simulado)
  fs.mkdirSync(dir("msg-904"), { recursive: true }); fs.writeFileSync(path.join(dir("msg-904"), "contrato.txt"), txt); fs.writeFileSync(path.join(dir("msg-904"), "contrato.pdf"), pdfConTexto([]));
  fs.writeFileSync(path.join(dir("msg-904"), "correo.json"), JSON.stringify(correo("msg-904", ["contrato.txt", "contrato.pdf"])));
  prev = process.env.FIXTURES_DIR; process.env.FIXTURES_DIR = path.relative(ROOT, TMP);
});
after(() => { if (prev === undefined) delete process.env.FIXTURES_DIR; else process.env.FIXTURES_DIR = prev; fs.rmSync(TMP, { recursive: true, force: true }); });
const extraer = async (id: string) => { const r = await llamar(tools, "contratos_extraer", { mensaje_id: id }, ctx()); assert.ok(r.ok, r.error ?? ""); return r.data as D; };

test("AC-49 [+] leer_pdf devuelve el texto de un PDF con capa de texto", async () => {
  const r = await llamar(tools, "contratos_leer_pdf", { ruta: "buzon/msg-901/contrato.pdf" }, ctx());
  assert.ok(r.ok, r.error ?? ""); assert.match((r.data as D).texto, /CT-2026-015/); assert.equal((r.data as D).paginas, 1);
});
test("AC-49 [-] leer_pdf rechaza rutas fuera de fixtures, no-PDF e inexistentes; PDF sin texto pide OCR", async () => {
  for (const ruta of ["../package.json", "../../etc/passwd", "buzon/msg-001/contrato.txt", "buzon/msg-001/no.pdf"]) assert.equal((await llamar(tools, "contratos_leer_pdf", { ruta }, ctx())).ok, false, ruta);
  const r = await llamar(tools, "contratos_leer_pdf", { ruta: "buzon/msg-904/contrato.pdf" }, ctx()); assert.equal(r.ok, false); assert.match(r.error!, /OCR/);
});
test("AC-50 [+] PDF coherente con el TXT: sin alertas de diferencia", async () => {
  const c = await extraer("msg-901"); assert.ok(!(c.alertas as string[]).some((a) => /difiere/.test(a)), JSON.stringify(c.alertas));
});
test("AC-51 [-] PDF distinto del TXT: alerta y prevalece el TXT", async () => {
  const c = await extraer("msg-902");
  assert.equal(c.valor, 265000000);
  assert.ok((c.alertas as string[]).some((a) => /difiere del TXT en valor.*Prevalece el TXT/.test(a)), JSON.stringify(c.alertas));
});
test("AC-52 [!] solo PDF: se usa como única fuente con aviso; PDF escaneado junto al TXT: aviso de OCR y prevalece el TXT", async () => {
  const solo = await extraer("msg-903"); assert.equal(solo.id_contrato, "CT-2026-015"); assert.ok((solo.alertas as string[]).some((a) => /Fuente única: PDF/.test(a)));
  const esc = await extraer("msg-904"); assert.equal(esc.valor, 265000000); assert.ok((esc.alertas as string[]).some((a) => /requiere OCR/.test(a)));
});
