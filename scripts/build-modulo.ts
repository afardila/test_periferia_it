/**
 * Genera las piezas Markdown del módulo reutilizable (modulo/) a partir de las MISMAS fuentes que usa la app:
 *   agent/prompt.md → modulo/agent.md · src/knowledge/registro-contratos.md → modulo/skill/registro-contratos/SKILL.md
 * Las herramientas no se copian: modulo/tools/contratos.ts reexporta src/tools/contratos.ts.
 * Uso: npm run build:modulo   (la prueba AC-53 falla si el módulo quedó desincronizado)
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const leer = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

export function generarModulo(): Record<string, string> {
  return {
    "modulo/agent.md": `---\ndescription: Agente de recepción de contratos. Lee un buzón, extrae datos con confianza por campo, clasifica, pide confirmación humana y registra en el maestro simulado de SharePoint.\nmode: primary\npermission:\n  edit: deny\n  bash: deny\n---\n\n${leer("agent/prompt.md").trim()}\n`,
    "modulo/skill/registro-contratos/SKILL.md": `---\nname: registro-contratos\ndescription: Proceso de registro de contratos vigentes: canal único, clasificación (nuevo, actualización, duplicado, rechazado), revisión humana por baja confianza, pólizas y alertas.\n---\n\n${leer("src/knowledge/registro-contratos.md").trim()}\n`,
  };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [rel, contenido] of Object.entries(generarModulo())) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), contenido); console.log("generado", rel); }
}
