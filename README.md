# Agente "Registro de Contratos Vigentes" (Reto 2)

Agente conversacional que actúa como punto único de recepción de contratos: lee el buzón, extrae datos con confianza por campo, clasifica (nuevo / actualización / duplicado / rechazado), pide confirmación humana en lo dudoso, registra en un maestro simulado de SharePoint, archiva y genera alertas.

**Link de prueba:** https://agente-contratos-production.up.railway.app  
**Acceso:** el link está protegido con HTTP Basic (usuario libre + clave). La clave se entrega por el canal de entrega de la prueba, no se versiona en el repositorio.

## Levantar en local (un comando)
```bash
npm install && cp .env.example .env   # completa ANTHROPIC_API_KEY y APP_PASSWORD
npm run dev                           # front + backend en http://localhost:3000
```
Requiere Node 20+ (también corre con Bun: `bun install && bun run demo.ts`).

## Verificación sin modelo (no necesita clave de ningún proveedor)
```bash
npm run demo          # procesa los 6 mensajes llamando a las herramientas; salidas en out/
npm run typecheck && npm test
```

## Variables de entorno (`.env.example`)
`ANTHROPIC_API_KEY`, `MODEL`, `APP_PASSWORD`, `FIXTURES_DIR`, `FECHA_CORTE`, `RATE_LIMIT_PER_MIN`, `MAX_ITER` (iteraciones por turno), `MAX_SESSION_TOKENS` (tokens por sesión), `LLM_TIMEOUT_MS`, `PORT`. La clave del modelo vive solo en el entorno del backend.

## API mínima
| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation, events[], usage }` |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión: `{ eventos[], usage }` (404 si no existe) |
| `GET` | `/api/health` | `{ ok: true, provider, model }` sin exponer claves y sin autenticación |

Complementarias: `GET /api/state?sessionId=` (maestro y procesados de la sesión) y `POST /api/reset`. `sessionId` debe cumplir `^[A-Za-z0-9-]{8,64}$`; el mensaje admite hasta 8000 caracteres. Códigos: 400 entrada inválida, 401 sin credenciales, 429 límite de peticiones o tope de tokens.

## Herramientas (`src/tools/contratos.ts`, nombre visible `contratos_<export>`)
`leer_buzon`, `extraer`, `validar`, `registrar`, `alertas` (P0) y `leer_pdf` (P1). Cada una: `{ description, args (zod), execute(args, ctx) → string JSON }`, nunca lanza.

## Estructura
`agent/prompt.md` (comportamiento) · `src/knowledge/` (conocimiento) · `src/tools/` (ejecución) · `src/llm/` (adaptador de proveedor) · `src/agent.ts` (ciclo) · `src/server.ts` (API) · `web/` (chat) · `fixtures/reto-02/` (entregados, solo lectura) · `out/` (generado, no se versiona) · `modulo/` (bonus) · `docs/SPEC.md` · `SOLUCION.md` · `demo.ts`.

## Módulo reutilizable (bonus)
`modulo/` empaqueta `agent.md`, `tools/contratos.ts` y `skill/registro-contratos/SKILL.md` con las mismas piezas que la app (ver `modulo/README.md`; `npm run build:modulo` regenera los Markdown).

## Probar el chat
En una sesión nueva: *"Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme."* Luego: *"Confirmo el valor 0 y la fecha fin 2027-08-31"*.
