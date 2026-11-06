# SOLUCIÓN — Agente de recepción de contratos

> Borrador pre-armado. Las secciones marcadas ✏️ se completan el día de la prueba con datos reales del reto.

## 1. Resumen ejecutivo
Un agente conversacional que actúa como punto único de recepción de correos contractuales: clasifica cada mensaje, extrae datos con nivel de confianza por campo, registra o actualiza el maestro de contratos (SharePoint simulado), archiva los documentos y genera alertas de vencimiento. **Toda escritura exige aprobación humana.** ✏️ _(2–3 líneas con los resultados sobre los 6 mensajes del buzón)_

## 2. Arquitectura

```
Navegador (chat)  ──HTTP──▶  Servidor Express  ──▶  Bucle del agente  ──▶  API del modelo (Claude)
   ▲  tool calls visibles        /api/chat               │   ▲
   │  tarjeta de confirmación    /api/confirm            ▼   │
   └──────────────────────────────────────────  Herramientas tipadas (zod)
                                                      │
                                                      ▼
                                   Maestro simulado · archivo · auditoría (capa de datos)
```

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Prompt | `agent/prompt.md` | Rol, reglas, clasificación. Separado del código para versionarlo |
| Herramientas | `src/tools/contratos.ts` | Contrato de entrada (zod), reglas de negocio deterministas |
| Registro de tools | `src/tools/registry.ts` | Validación, ejecución segura, esquema JSON para el modelo |
| Agente | `src/agent.ts` | Bucle modelo ↔ herramientas, pausa de confirmación, tope de iteraciones |
| Datos | `src/data.ts` | Fixtures, maestro en memoria, auditoría |
| UI | `public/index.html` | Chat, tool calls desplegables, tarjeta de confirmación resaltada |
| Especificación | `docs/SPEC.md` | Reglas, criterios de aceptación y trazabilidad (SDD) |
| Verificación | `test/*.test.ts`, `demo.ts` | Pruebas positivas, negativas y de excepción; reglas sin LLM |

## 3. Ciclo del agente
1. El usuario envía una instrucción (p. ej. "procesa el buzón").
2. El modelo decide qué herramientas llamar (`listar_buzon`, `leer_mensaje`, `buscar_contrato`…).
3. El servidor **valida la entrada con zod** y ejecuta; el resultado (o el error) vuelve al modelo.
4. Si la herramienta modifica estado (`registrar_contrato`, `actualizar_contrato`), el bucle **se pausa** y la UI muestra una tarjeta resaltada; solo al aprobar se ejecuta. Si se rechaza, el rechazo vuelve al modelo como resultado.
5. El ciclo termina cuando el modelo responde sin pedir herramientas, o al llegar al tope de 12 iteraciones.

## 4. Decisiones de diseño
- **Reglas en código, no en el prompt.** Duplicados, umbral de confianza, versionado y cálculo de alertas son deterministas y probables sin LLM (`demo.ts`). El modelo interpreta texto; el código garantiza las reglas.
- **Humano en el circuito para escrituras.** Menor riesgo operativo a cambio de un clic; las lecturas no piden permiso.
- **Confianza por campo.** Bajo el umbral (0.75) el registro queda `pendiente_revision` en lugar de fallar o aceptarse a ciegas.
- **Errores como datos.** Las herramientas devuelven códigos (`DUPLICADO`, `NO_ENCONTRADO`) para que el modelo se corrija sin romper el flujo.
- **Auditoría.** Cada registro, otrosí, archivo y rechazo deja un evento con antes/después.
- ✏️ _(añadir 2–3 decisiones propias del PRD)_

## 5. Análisis de costos del modelo
Costo por mensaje = (tokens de entrada × precio entrada + tokens de salida × precio salida) / 1.000.000.
Los tokens reales se leen del pie del chat (se acumulan por sesión). Precios vigentes: https://docs.claude.com

| Concepto | Valor |
|---|---|
| Modelo usado | ✏️ |
| Tokens por mensaje (entrada / salida) | ✏️ medir con los 6 casos |
| Costo por mensaje (USD) | ✏️ |
| Costo mensual con ✏️ mensajes/mes | ✏️ |
| Palancas | Caché del prompt (ya activo), modelo más pequeño para clasificar, enviar solo el texto del contrato (no el correo completo), tope de iteraciones |

## 6. Regla de gobierno para el manejo corporativo de contratos (obligatoria)
> Borrador base — personalizar con criterio propio.

**Principio:** el maestro de contratos es la única fuente de verdad, y el agente propone pero no decide.

1. **Fuente única y propietario.** Un solo maestro; cada contrato tiene un comercial responsable y un dueño del proceso (área legal/contratos).
2. **Recepción única.** Todo contrato, otrosí o modificación entra por el buzón único; lo que se acuerde fuera no existe para efectos de control.
3. **Registro en plazo.** Todo documento firmado se registra en el maestro dentro de ✏️ N días hábiles.
4. **Cuatro ojos.** El agente extrae y propone; una persona aprueba cada escritura. Registros con baja confianza no se vuelven "vigentes" sin revisión.
5. **Versionado.** Los otrosíes no sobrescriben: incrementan la versión y conservan el histórico (auditoría).
6. **Alertas escalonadas.** Avisos a 90, 60 y 30 días del vencimiento al comercial responsable; a 30 días se escala a su jefatura.
7. **Calidad de datos.** Campos obligatorios mínimos; revisión mensual de `pendiente_revision` y de contratos sin comercial resuelto.
8. **Trazabilidad y retención.** Documento original archivado junto al contrato, con registro de quién aprobó qué y cuándo.
9. **Indicadores.** % registrado en plazo, % pendiente de revisión, contratos vencidos sin renovar ni cerrar.

## 7. Metodología, pruebas y seguridad
- **SDD:** `docs/SPEC.md` define reglas (RN) y criterios de aceptación (AC-xx); cada AC tiene una prueba con el mismo ID. ✏️ _(resultado: N pruebas, N verdes)_
- **Pruebas automáticas:** `npm test` cubre reglas de negocio, bucle del agente (modelo simulado) y seguridad HTTP, con casos positivos, negativos y de excepción.
- **Aislamiento entre casos:** estado por sesión; el maestro base es de solo lectura.
- **Seguridad:** clave de acceso, límite de uso, validación de entradas y rutas, cabeceras, secretos en variables de entorno, documentos tratados como dato.

## 8. Consideraciones de producción
- Reemplazar la capa de datos por Microsoft Graph / SharePoint real con permisos mínimos y secretos en un gestor.
- Persistencia y cola para el buzón (hoy en memoria); idempotencia por id de mensaje.
- Autenticación y roles para quien aprueba; protección contra inyección de instrucciones dentro de los documentos (el texto del contrato es dato, no orden).
- Observabilidad: trazas de tool calls, tokens y latencia; evaluación periódica con un set de mensajes de referencia.
- Datos personales: minimizar lo que se envía al modelo y definir retención.

## 9. Cómo ejecutar y verificar
```
npm install
npm run typecheck && npm test && npm run demo
ANTHROPIC_API_KEY=... APP_PASSWORD=... npm start
```
URL pública: ✏️
