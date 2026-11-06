/**
 * Ejemplo de integración SIN el servidor HTTP: otra plataforma de agentes importa las herramientas del módulo
 * y las expone a su modelo. Aquí se ejecutan directamente sobre el buzón de los fixtures.
 * Uso: npx tsx modulo/ejemplo.ts
 */
import path from "node:path";
import * as contratos from "./tools/contratos.js";

const ctx = { directory: path.resolve(import.meta.dirname, ".."), sessionId: "modulo-ejemplo" };
const buzon = JSON.parse(await contratos.leer_buzon.execute({}, ctx));
console.log("herramientas:", Object.keys(contratos).map((k) => `contratos_${k}`).join(", "));
console.log("mensajes en el buzón:", buzon.data.mensajes.map((m: { id: string }) => m.id).join(", "));
const v = JSON.parse(await contratos.validar.execute({ mensaje_id: "msg-006" }, ctx));
console.log("msg-006 →", v.data.clasificacion, "· revisión:", v.data.requiere_revision.join(", "));
