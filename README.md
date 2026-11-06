# Agente "Registro de Contratos Vigentes" (Reto 2)

Agente conversacional que actúa como punto único de recepción de contratos: lee el buzón, extrae datos con confianza por campo, clasifica (nuevo / actualización / duplicado / rechazado), pide confirmación humana en lo dudoso, registra en un maestro simulado de SharePoint, archiva y genera alertas.

**Link de prueba:** https://agente-contratos-production.up.railway.app — acceso con usuario libre y la clave entregada por canal aparte (no está en el repositorio).

## Levantar en local (un comando)
```bash
npm install
cp .env.example .env      # completa ANTHROPIC_API_KEY y APP_PASSWORD
npm run dev               # http://localhost:3000
```
Requiere Node 20+.

## Verificación sin modelo
```bash
npm run demo              # procesa los 6 mensajes llamando a las herramientas; no necesita clave
npm run typecheck && npm test
```

## Variables de entorno (`.env.example`)
`ANTHROPIC_API_KEY`, `MODEL`, `APP_PASSWORD`, `FIXTURES_DIR`, `FECHA_CORTE`, `RATE_LIMIT_PER_MIN`, `MAX_ITER`, `MAX_SESSION_TOKENS`, `LLM_TIMEOUT_MS`, `PORT`. La clave del modelo vive solo en el entorno del backend.

## API
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation, events[], usage }` |
| GET | `/api/sessions/:id` | Historial completo de la sesión |
| GET | `/api/health` | `{ ok, provider, model }` (sin claves, sin autenticación) |
| GET | `/api/state?sessionId=` | Maestro y procesados de esa sesión |
| POST | `/api/reset` | Reinicia la sesión |

## Estructura
`agent/prompt.md` (comportamiento) · `src/knowledge/` (conocimiento) · `src/tools/` (herramientas zod) · `src/llm/` (adaptador de proveedor) · `src/agent.ts` (ciclo) · `src/server.ts` · `public/` (chat) · `fixtures/reto-02/` (solo lectura) · `out/<sesión>/` (salidas, no se versiona) · `docs/SPEC.md` · `SOLUCION.md`.

## Probar el chat
En una sesión nueva: *"Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme."* Luego: *"Confirmo el valor 0 y la fecha fin 2027-08-31"*.
