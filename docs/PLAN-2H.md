# Plan de las 2 horas (prueba: viernes 10:00 a. m. hora Colombia)

Objetivo: entregar repo, `demo.ts`, URL pública y `SOLUCION.md`, con **SDD** (especificación primero), **pruebas automáticas** (positivas, negativas y de excepción), **seguridad** y **despliegue**.
Regla: **a los 90 min, lo que no esté funcionando se recorta**, no se alarga.

## Esta noche (es lo que más reduce el riesgo)
- [ ] Repositorio privado en GitHub con este esqueleto (`git init`, commit, push). Verifica que `.env` NO se subió.
- [ ] API key de Anthropic con saldo; probar una llamada real corriendo `npm start` y el chat.
- [ ] **Despliegue de práctica** en Railway o Render con variables `ANTHROPIC_API_KEY`, `APP_PASSWORD` y `MODEL`. Abrir la URL desde el celular: debe pedir clave y responder.
- [ ] Anotar: URL, usuario libre + clave de acceso para compartir con los evaluadores.
- [ ] Leer `docs/SPEC.md` y `docs/DEFENSA.md`. Dormir.

## Durante las 2 horas

| Min | Qué | Salida |
|---|---|---|
| 0–10 | Descomprimir fixtures; **leer el PRD completo y subrayar cada regla y cada entregable** (no omitir instrucciones) | Lista de reglas |
| 10–30 | **SDD:** completar `docs/SPEC.md` (reglas RN, AC por cada caso del buzón, matriz de escenarios) | Spec lista |
| 30–45 | Ajustar `src/data.ts` (rutas y `COLUMNAS`) y escribir/ajustar las pruebas de cada AC nuevo (primero rojas) | `npm test` rojo, con sentido |
| 45–75 | Implementar en `src/tools/contratos.ts` hasta que todo quede verde; reescribir `CASOS` de `demo.ts` | `npm run typecheck && npm test && npm run demo` en verde |
| 75–85 | Probar el agente en el chat con cada mensaje real, **uno por sesión** (casos aislados); afinar `agent/prompt.md` solo si falla | 6 mensajes bien resueltos |
| 85–100 | `git push` → el hosting redepliega; probar la URL pública con los 6 casos | URL pública verificada |
| 100–117 | Completar `docs/SOLUCION.md` (costos con tokens reales, regla de gobierno, seguridad) | Documento listo |
| 117–120 | Revisión final (checklist de abajo) | Entrega |

## Checklist de entrega
- [ ] La URL abre, pide clave y el chat responde (abrirla justo antes: los hostings gratuitos se duermen).
- [ ] `npm test` en verde y el resultado visible (captura o salida en `SOLUCION.md`).
- [ ] No hay claves en el repo (`git log -p | grep -i "sk-ant"` vacío) ni datos reales.
- [ ] Cada caso del buzón se valida **en su propia sesión** y no usa datos de otro.
- [ ] `SPEC.md` completo, con trazabilidad AC → prueba.
- [ ] La clave de acceso se entrega a Periferia por el canal de la entrega, no dentro del repo.

## Si algo se atrasa
1. Se recorta el pulido del frontend (ya funciona).
2. Luego casos de borde extra del `demo.ts` (dejar los del buzón).
3. Nunca se recorta: URL pública, confirmación humana, pruebas automáticas, control de acceso ni la regla de gobierno.

## Cómo trabajar con Claude Code ese día
- Pegar el `PRD.md` completo y pedir primero **solo la especificación** (reglas y AC), revisarla tú, y recién después las pruebas y el código.
- Cambios chicos y verificables; después de cada uno: `npm run typecheck && npm test`.
- Tú decides qué regla es la correcta: la IA genera, tú validas contra el PRD.
