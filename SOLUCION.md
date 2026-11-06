# SOLUCION — Reto 2 · Agente "Registro de Contratos Vigentes"

Autor: Andrés Felipe Ardila Rodríguez · Metodología: SDD (`docs/SPEC.md` → pruebas → código → demo).

## 1. Problema en una frase
El maestro de contratos vigentes lleva congelado desde el 2026-05-30 y solo reciben los contratos con póliza, por lo que **a la analista administrativa y a la gerencia** les duele no saber qué contratos están vigentes, cuáles vencen y qué pólizas faltan.

## 2. Arquitectura
```
 Front de chat (public/) ──HTTP──▶ Backend Express (src/server.ts)
   · historial, tool calls            · Basic auth, rate limit, tope de tokens
   · tarjeta de confirmación          ▼
                                 Ciclo del agente (src/agent.ts)
                                   ├─ Adaptador LLM (src/llm/adapter.ts → anthropic.ts)
                                   └─ Herramientas zod (src/tools/contratos.ts)
                                        ├─ extraccion.ts (regex + heurísticas)
                                        └─ maestro.ts (CSV, buzón, out/)
 fixtures/reto-02/ (solo lectura)  ──▶  out/<sessionId>/ (maestro, sharepoint/, historial, log, alertas.md)
```
- **Comportamiento**: `agent/prompt.md`. **Conocimiento**: `src/knowledge/registro-contratos.md` (se concatena al prompt). **Ejecución**: `src/tools/`. Cambiar una regla de negocio no toca el servidor.
- Cada sesión escribe en su propia carpeta `out/<sessionId>/`: ningún caso hereda estado de otro. `fixtures/` nunca se modifica (hay prueba por hash).

## 3. Ciclo del agente
Bucle `modelo → llamadas a herramientas → modelo` (`crearAgente`). Tope de **25 iteraciones por turno** (`MAX_ITER`); al alcanzarlo responde con lo hecho y lo que falta. Tope de **300 000 tokens por sesión** (`MAX_SESSION_TOKENS`): superado, responde 429 sin llamar al modelo. Timeout de 60 s al proveedor con mensaje claro; un fallo descarta solo el turno y la sesión sigue viva.
**Confirmación humana**: `contratos_registrar` rechaza con `requiere revisión: …` si hay campos con confianza < 0.8 o ausentes. El agente termina el turno con una pregunta explícita y el front resalta el estado. Una **guardia en código** impide que el modelo se autoconfirme: `confirmado=true` solo se acepta si, después de la petición de revisión, llegó un mensaje nuevo del usuario.

## 4. Elección del modelo
Anthropic **Claude Sonnet 5.5** (`MODEL`, cambiable): buen uso de herramientas y precio moderado (≈ USD 2 / 10 por millón de tokens de entrada/salida; lectura de caché ≈ 0,10). El prompt de sistema se cachea. **Costo estimado por mensaje procesado: ≈ USD 0,02–0,03** (4–6 llamadas, ~15 k tokens de entrada, ~1,2 k de salida); el buzón completo ≈ USD 0,15. Son estimaciones: el pie del chat muestra los tokens reales por sesión. El adaptador es intercambiable (`src/llm/adapter.ts`).

## 5. Estrategia de extracción
- **Determinista primero** (`extraccion.ts`): partes y NIT/RUC por regex (se descarta Periferia), objeto y valor por cláusula, fechas en español ("primero (1) de agosto de 2026"), plazo en meses, póliza por la cláusula de garantías cruzada con el correo, país por domicilio o tipo de identificador.
- **Confianza por campo**: 0,95–0,98 si el dato es literal; 0,85–0,9 si se infiere o deriva con base explícita; 0,5–0,6 si se supone (fecha de inicio tomada del correo, `fecha_fin` derivada de un plazo en meses, valor por demanda); 0 si no existe (`null`, nunca inventado).
- **Dónde entra el modelo**: orquesta, explica y conversa la confirmación; nunca fija valores. Todo valor registrado pasa por `contratos_validar` y `contratos_registrar` (que revalida).

## 6. Regla de gobierno (propuesta)
1. **Canal único**: `contratos@periferia-ficticia.com`, administrado por la **analista administrativa** (dueña del maestro); la Gerencia Administrativa es responsable de que exista un suplente.
2. **Obligación del comercial**: enviar **todo** contrato firmado (con o sin póliza), otrosíes y actas de terminación, en PDF firmado, dentro de **2 días hábiles** desde la firma. Asunto: `[CONTRATO|OTROSÍ|ACTA] <Cliente> – <N.º contrato>`; un mensaje por documento.
3. **Acuse automático**: en menos de 5 minutos el agente responde al comercial con uno de cuatro estados: *registrado*, *actualizado*, *duplicado* o *rechazado/pendiente* (con motivo y lo que falta).
4. **Excepciones y escalamiento**: contrato sin firmar, sin valor o con datos ilegibles queda *pendiente*; la analista lo confirma con el comercial en 24 h y, si no hay respuesta, escala a la Gerencia Comercial a las 48 h. Remitente desconocido: se registra solo tras confirmación y se pide actualizar `comerciales.json`.
5. **Cierre del gap jun–ago 2026**: una campaña de dos semanas: contabilidad entrega las facturas emitidas desde el 2026-05-30; cada comercial reenvía los contratos faltantes; el agente procesa el lote y la analista confirma lo dudoso. El reporte `alertas.md` (sección "registrados desde el corte") mide el avance.
6. **Indicador mensual**: **% de contratos facturados en el mes que existen en el maestro** (meta ≥ 98 %), junto con el tiempo medio recepción→registro.

## 7. Decisiones y trade-offs
| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Extracción determinista + confianza por campo | Dejar que el LLM extraiga todo | Reproducible, barata, auditable; el modelo "redondea" o infiere fechas (riesgo del PRD). |
| Reglas en código (`validar`/`registrar`) y guardia de confirmación | Reglas en el prompt | El prompt se puede ignorar o inyectar; el código garantiza RN5 y CA3. |
| Estado por sesión en `out/<sessionId>/` | Un único `out/` global | Evita contaminación entre casos y permite probar cada caso en una sesión nueva. |
| CSV + carpeta local simulando SharePoint | Base de datos | Lo pide el PRD (3.2); cero infraestructura. |
| Columnas extra `estado_contrato` y `alertas` | Respetar solo las 16 columnas | Permite marcar vencidos y dejar a la vista los supuestos y observaciones detectadas. |
| Confirmación por la siguiente respuesta en el chat | Botones Aprobar/Rechazar por herramienta | Es lo que pide el PRD (CA3) y el humano puede corregir valores, no solo aprobar. |

## 8. Supuestos
- `fecha_registro` = fecha del correo (determinismo). Los correos y contratos llegan como texto (sin OCR).
- msg-006: `valor = 0` por demanda; sin día de firma se toma la fecha del correo como inicio (confianza 0,5) y `fecha_fin` = inicio + 12 meses; moneda COP inferida del umbral de garantías; el marco no exige póliza (la exigen las órdenes de servicio). Todo queda en revisión y anotado en `alertas`.
- Todo campo ausente o con confianza < 0.8 pide confirmación, incluido un remitente desconocido (comercial).
- Un otrosí hereda del maestro los campos que no trae; no cambia `estado_poliza`, pero deja la observación de ampliar garantías.
- Los vencidos se muestran en el reporte y se marcan `estado_contrato = vencido`.
- Los adjuntos de actualizaciones se archivan junto al contrato original como `<id>_otrosi_<mensaje>.<ext>`.

## 9. Cobertura
| HU | Estado | Para producción falta |
|---|---|---|
| HU-1 Leer buzón | Hecho | Conexión real a Exchange; PDF/OCR (`contratos_leer_pdf` P1 no hecha). |
| HU-2 Extraer | Hecho (texto plano) | Más formatos de contrato; evaluación con muestras reales. |
| HU-3 Validar | Hecho | Afinar similitud de nombres y alias de clientes. |
| HU-4 Registrar y archivar | Hecho | SharePoint real, bloqueo de concurrencia, aprobación formal. |
| HU-5 Alertas | Hecho | Envío automático a gerencia y corredor. |
| HU-6 Errores | Hecho | Métricas y alertas operativas. |
| Bonus `modulo/` | No hecho | — |

## 10. Uso de IA
- **Claude (Anthropic)**, como asistente de construcción: especificación SDD, pruebas, implementación de herramientas, ciclo del agente, front, despliegue en Railway y borrador de este documento. Yo definí el reto, validé la especificación y las decisiones (supuestos de las secciones 7–8) y reviso cada línea.
- **Descartado de las propuestas**: pedirle al modelo la extracción completa; botones de aprobación por herramienta (el PRD exige confirmación conversacional); registrar sin pedir confirmación cuando falta un campo; usar el dato más probable para valores ausentes.
- El modelo en producción es Claude Sonnet 5.5, solo para orquestar la conversación.

## 11. Riesgos y mitigación
| Riesgo | Mitigación |
|---|---|
| Contratos escaneados o con formatos distintos | OCR + evaluación continua; los campos dudosos ya van a revisión humana. |
| Falsos duplicados por nombre del cliente | Dedupe por NIT antes que por nombre (ya implementado) y similitud ≥ 0,9 de objeto. |
| Inyección de instrucciones en documentos | Documentos tratados como datos; reglas críticas en código; guardia de confirmación. |
| Costo y abuso de la clave | Topes de iteraciones y tokens, rate limit por IP, acceso con contraseña, clave solo en variables del servidor. |
| Comerciales que no envían contratos | Regla de gobierno + indicador "facturado vs. maestro". |
| Pérdida de estado (almacenamiento efímero) | En producción: base de datos / SharePoint real; aquí `out/` se recrea por ejecución. |
