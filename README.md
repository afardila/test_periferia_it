# Esqueleto del agente (Prueba IA – Periferia IT Group)

Agente conversacional en TypeScript (Node 20+) con herramientas tipadas en zod, confirmación humana para escrituras, chat web, verificación sin LLM y despliegue listo. Orientado al **Reto 2 (contratos)**; el núcleo (`registry.ts`, `agent.ts`, `server.ts`, `public/`) sirve igual para los Retos 1 y 3.

## Uso rápido
```bash
npm install
cp .env.example .env        # y pon tu ANTHROPIC_API_KEY
npm test                    # 32 pruebas: reglas, agente (modelo simulado) y seguridad HTTP
npm run demo                # verificación sin LLM (datos ficticios en fixtures-demo/)
npm start                   # http://localhost:3000 (lee .env automáticamente)
```

## Qué cambiar el día de la prueba
1. `FIXTURES_DIR` → carpeta descomprimida del reto (`fixtures/reto-02`).
2. `src/data.ts` → `COLUMNAS` y rutas al formato real.
3. `src/tools/contratos.ts` → reglas del PRD (umbral, campos obligatorios, duplicados…).
4. `agent/prompt.md` → ajustes de clasificación del PRD.
5. `demo.ts` → `CASOS` con los mensajes reales y resultados esperados.
6. `SOLUCION.md` → completar los ✏️.

Para otro reto: crear `src/tools/oc.ts` (Reto 3) o `src/tools/proveedor.ts` (Reto 1) y cambiar el import en `src/agent.ts` y `src/server.ts`.

## Despliegue
- **Railway / Render:** conectar el repo de GitHub; variables `ANTHROPIC_API_KEY` y `MODEL`; comando de inicio `npm start`. (`render.yaml` y `Dockerfile` incluidos.)
- **Respaldo:** `npx cloudflared tunnel --url http://localhost:3000`.

Seguridad: define `APP_PASSWORD` (clave de acceso) en el hosting; sin ella la app queda abierta y avisa en consola. `RATE_LIMIT_PER_MIN` limita el uso por IP.

Metodología SDD: `docs/SPEC.md` → pruebas → código.

Más: `docs/PLAN-2H.md` (cronograma), `docs/DEFENSA.md` (preguntas probables), `SOLUCION.md` (plantilla).

> Los datos de `fixtures-demo/` son ficticios. No uses información real de ninguna entidad en la prueba.
