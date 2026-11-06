# Módulo reutilizable: agente de contratos

- `agent.md` — system prompt con frontmatter (`mode: primary`, `permission: edit/bash deny`). Generado desde `agent/prompt.md`.
- `tools/contratos.ts` — las mismas herramientas de la app (reexport), importables sin servidor.
- `skill/registro-contratos/SKILL.md` — conocimiento del proceso. Generado desde `src/knowledge/registro-contratos.md`.

Regenerar las piezas Markdown tras cambiar el prompt o el conocimiento: `npm run build:modulo`.

## Integración sin servidor
```ts
import * as contratos from "./modulo/tools/contratos.js";
const ctx = { directory: "<raíz con fixtures/>", sessionId: "mi-sesion" };
const r = JSON.parse(await contratos.extraer.execute({ mensaje_id: "msg-001" }, ctx)); // { ok, data | error }
```
Cada herramienta valida sus argumentos con zod y nunca lanza. Ejemplo ejecutable: `npx tsx modulo/ejemplo.ts`.
Dependencias del módulo: `zod` y `unpdf` (no usa Express ni el SDK del modelo).
