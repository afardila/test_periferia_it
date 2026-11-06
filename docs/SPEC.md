# SPEC — Especificación (SDD)

> Orden de trabajo del día de la prueba: **1) completar esta especificación desde el PRD → 2) escribir/ajustar las pruebas → 3) implementar hasta que pasen → 4) desplegar → 5) documentar.**
> Regla: no se escribe código para algo que no tenga un criterio de aceptación (AC) aquí.
> ✏️ = completar con el PRD real. Los AC ya escritos son los del esqueleto genérico; ajústalos, no los borres.

## 1. Contexto y objetivo
Agente que recibe correos con contratos/otrosíes/cotizaciones, los clasifica, extrae datos con confianza por campo, opera el maestro de contratos (SharePoint simulado), archiva y alerta vencimientos. ✏️ _(objetivo de negocio y métricas del PRD)_

## 2. Alcance
**Dentro:** clasificar, extraer, registrar, actualizar (otrosí), archivar, rechazar, reportar vencimientos, confirmación humana.
**Fuera:** SharePoint/correo reales, firma electrónica, envío de notificaciones. ✏️

## 3. Historias de usuario
| ID | Como… | Quiero… | Para… |
|---|---|---|---|
| HU-1 | Asistente comercial | enviar un contrato al buzón y que quede registrado | no digitarlo a mano |
| HU-2 | Responsable de contratos | aprobar o rechazar cada escritura | mantener el control |
| HU-3 | Responsable de contratos | ver alertas de vencimiento | renovar a tiempo |
| HU-4 | Auditor | ver qué cambió, cuándo y por qué mensaje | trazabilidad |
✏️ _(las del PRD)_

## 4. Reglas de negocio (verificables)
| ID | Regla | Origen |
|---|---|---|
| RN-1 | Un número de contrato existe una sola vez en el maestro | ✏️ PRD |
| RN-2 | Campo con confianza < 0.75 → el registro queda `pendiente_revision` | ✏️ PRD |
| RN-3 | Un otrosí no sobrescribe: incrementa `version` y deja auditoría antes/después | ✏️ PRD |
| RN-4 | Solo se pueden modificar: fecha_fin, valor, objeto, estado, comercial_email | decisión de diseño |
| RN-5 | fecha_fin ≥ fecha_inicio; fechas `YYYY-MM-DD`; valor > 0 | ✏️ PRD |
| RN-6 | Alertas desde la fecha de corte: vencido (<0), crítica (≤30), alta (≤60), media | ✏️ PRD |
| RN-7 | Toda escritura requiere aprobación humana | PRD / decisión |
| RN-8 | Cada mensaje es un caso independiente; las sesiones no comparten estado | tips de la prueba |

## 5. Criterios de aceptación y trazabilidad
Formato Dado/Cuando/Entonces. Cada AC tiene una prueba con su mismo ID (`test/*.test.ts`). `[+]` positivo · `[-]` negativo · `[!]` excepción/seguridad.

| AC | Tipo | Dado / Cuando / Entonces | Prueba |
|---|---|---|---|
| AC-01 | + | Dado un contrato nuevo con confianza alta, cuando se registra, entonces queda `vigente`, versión 1, con auditoría | contratos.test |
| AC-02 | − | Dado un número existente (cualquier mayúscula), cuando se registra, entonces `DUPLICADO` y no se escribe | contratos.test |
| AC-03 | + | Dado un campo con confianza < 0.75, cuando se registra, entonces `pendiente_revision` y se señala el campo | contratos.test |
| AC-04 | + | Dado un comercial fuera del catálogo, cuando se registra, entonces advertencia `COMERCIAL_NO_RESUELTO` | contratos.test |
| AC-05 | + | Dado un otrosí con nueva fecha_fin, cuando se aplica, entonces versión+1 y auditoría antes/después | contratos.test |
| AC-06 | − | Dado un otrosí de un contrato inexistente, entonces `NO_ENCONTRADO` | contratos.test |
| AC-07 | ! | Dado un intento de cambiar numero/version/cliente, entonces se rechaza | contratos.test |
| AC-08 | − | Dadas fechas invertidas, con formato erróneo o inexistentes, entonces se rechaza | contratos.test |
| AC-09 | − | Dado valor ≤ 0 o texto vacío, entonces se rechaza | contratos.test |
| AC-10 | + | Dado el maestro y una ventana, entonces el reporte clasifica vencido/crítica y ordena por urgencia | contratos.test |
| AC-11 | − | Dada una búsqueda sin criterios o una tool inexistente, entonces error controlado | contratos.test |
| AC-12 | + | Dado número/NIT/cliente parcial, entonces la búsqueda encuentra el contrato | contratos.test |
| AC-13 | +/− | Dado un adjunto existente se archiva; si no existe, `ARCHIVO_NO_EXISTE` | contratos.test |
| AC-14 | ! | Dado un id o nombre con `..` o `/`, entonces se bloquea (path traversal) | contratos.test |
| AC-15 | ! | Dadas dos sesiones, lo escrito en una no aparece en la otra | contratos.test |
| AC-16 | + | Dado el buzón, entonces se listan los mensajes y se leen correo + adjuntos | contratos.test |
| AC-17 | + | Dada una escritura propuesta por el modelo, entonces el agente pausa y solo escribe tras aprobar | agent.test |
| AC-18 | − | Dado un rechazo humano, entonces no se escribe y el modelo recibe el rechazo | agent.test |
| AC-19 | ! | Dadas dos sesiones del agente, aprobar en una no cambia la otra | agent.test |
| AC-20 | ! | Dado un modelo que pide herramientas sin fin, entonces el bucle se corta en el tope | agent.test |
| AC-21 | − | Dados argumentos inválidos del modelo, entonces vuelven como error y no se escribe | agent.test |
| AC-22 | ! | Sin credenciales o con clave incorrecta, entonces 401 (app y API) | server.test |
| AC-23 | + | Con credenciales sirve la app; `/api/health` es público y no expone secretos | server.test |
| AC-24 | − | sessionId inválido, mensaje vacío/largo, approve no booleano → 400 | server.test |
| AC-25 | ! | Sin API key del modelo, error claro sin filtrar información | server.test |
| AC-26 | + | Cabeceras de seguridad presentes; sin `X-Powered-By` | server.test |
| AC-27 | + | Estado entregado por sesión; límite de uso → 429 | server.test |

| AC-28 | + | Dado el buzón, cuando se procesa con las herramientas (sin LLM), entonces cada mensaje termina con el resultado esperado | pipeline.test |
| AC-29 | ! | Dadas dos corridas independientes, entonces los resultados son idénticos (determinismo) | pipeline.test |
| AC-30 | ! | Dado un orden distinto de procesamiento, entonces cada caso conserva su resultado (independencia) | pipeline.test |
| AC-31 | − | Dado un mensaje sin contrato, entonces se rechaza con motivo y el maestro no cambia | pipeline.test |
| AC-32 | + | Dado el texto de un contrato, entonces se clasifica, se convierten las fechas y se marca menor confianza al inferir del remitente | pipeline.test |

✏️ Añadir AC por cada caso del buzón del PRD (msg-001…msg-006), con su resultado esperado exacto.

## 6. Matriz de escenarios del buzón
| Mensaje | Clasificación esperada | Acción esperada | AC |
|---|---|---|---|
| msg-001 ✏️ | | | |
| msg-002 ✏️ | | | |
| msg-003 ✏️ | | | |
| msg-004 ✏️ | | | |
| msg-005 ✏️ | | | |
| msg-006 ✏️ | | | |

## 7. Requisitos no funcionales
- **Seguridad:** acceso con clave, sin secretos en el repo ni en respuestas, límites de uso, validación de entradas, contenido de documentos tratado como dato.
- **Aislamiento:** estado por sesión; ninguna regla ni dato se comparte entre casos.
- **Disponibilidad:** URL pública funcional; `/api/health` para el monitoreo del hosting.
- **Costo:** tope de iteraciones, caché de prompt, tokens visibles en la UI.

## 8. Cómo se verifica
`npm run typecheck && npm test && npm run demo` — todo en verde antes de desplegar y de nuevo contra la URL pública (ver docs/PLAN-2H.md).
