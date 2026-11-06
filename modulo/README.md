# Módulo reutilizable: agente de contratos

- `agent.md` — system prompt con frontmatter (`mode: primary`, `permission: edit/bash deny`). Generado desde `agent/prompt.md`.
- `tools/contratos.ts` — las mismas herramientas de la app (reexport), importables sin servidor.
- `skill/registro-contratos/SKILL.md` — conocimiento del proceso. Generado desde `src/knowledge/registro-contratos.md`.

Regenerar las piezas Markdown tras cambiar el prompt o el conocimiento: `npm run build:modulo`.
