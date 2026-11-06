/**
 * Herramientas del agente, importables SIN el servidor HTTP.
 * Son las mismas que usa la aplicación (reexport, no una copia): leer_buzon, extraer, validar, registrar, leer_pdf, alertas.
 * Cada export es { description, args (zod), execute(args, ctx) → string JSON } y su nombre visible es contratos_<export>.
 */
export * from "../../src/tools/contratos.js";
