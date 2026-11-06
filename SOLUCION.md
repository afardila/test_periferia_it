# SOLUCIÓN — Agente de recepción de contratos (Reto 2 · Prueba IA Periferia IT Group)

> Documento técnico y de proceso. Las marcas ✏️ son datos que dependen del PRD y de la medición final con los mensajes reales; el resto describe la solución tal como está construida.

**URL pública:** https://agente-contratos-production.up.railway.app (usuario libre; la clave de acceso se entrega por el canal de la entrega, no en este repositorio).
**Código:** https://github.com/afardila/test_periferia_it

---

## 1. Resumen ejecutivo

Agente conversacional que actúa como **punto único de recepción** de correos con contratos, otrosíes y cotizaciones. Para cada mensaje: lo clasifica, extrae los datos del contrato con un **nivel de confianza por campo**, consulta el maestro de contratos (SharePoint simulado), registra o actualiza, archiva el documento y puede generar un **reporte de alertas de vencimiento**.

Principios de diseño:
1. **El modelo interpreta; el código garantiza.** Las reglas que no deben fallar (duplicados, umbral de confianza, versionado, fechas, alertas) viven en herramientas tipadas con zod, no en el prompt.
2. **Ninguna escritura sin aprobación humana.** El agente propone; una persona aprueba o rechaza.
3. **Todo es verificable.** 32 pruebas automáticas, un `demo.ts` que procesa el buzón sin LLM y métricas de tokens visibles en la interfaz.

Resultado sobre el buzón de ejemplo ✏️ _(completar con los 6 mensajes del PRD: clasificación, acción y resultado de cada uno)_.

---

## 2. Arquitectura

```
Navegador (chat)  ──HTTP──▶  Express (src/server.ts)  ──▶  Bucle del agente (src/agent.ts)  ──▶  API de Claude
  · tool calls visibles        /api/chat  /api/confirm            │   ▲
  · tarjeta de confirmación    /api/state /api/reset              ▼   │
                                                         Herramientas tipadas con zod
                                                         (src/tools/contratos.ts + registry.ts)
                                                                  │
                                                                  ▼
                                          Capa de datos simulada por sesión (src/data.ts)
                                          maestro · archivo · rechazados · auditoría
```

| Capa | Archivo | Responsabilidad |
|---|---|---|
| System prompt | `agent/prompt.md` | Rol, reglas, clasificación y estilo; versionado aparte del código |
| Herramientas | `src/tools/contratos.ts` | 9 herramientas: contrato de entrada (zod) y reglas de negocio deterministas |
| Registro de herramientas | `src/tools/registry.ts` | Validación, ejecución que nunca lanza, esquema JSON para el modelo |
| Agente | `src/agent.ts` | Bucle modelo ↔ herramientas, pausa de confirmación, tope de iteraciones, tokens |
| Backend HTTP | `src/server.ts`, `src/main.ts` | API, acceso, límite de uso, cabeceras |
| Datos | `src/data.ts` | Fixtures de solo lectura + `Store` aislado por sesión |
| Procesamiento determinista | `src/pipeline.ts` | Mismas herramientas decididas por reglas; base de `demo.ts` |
| Frontend | `public/index.html` | Chat, llamadas a herramientas desplegables, tarjeta de confirmación resaltada |
| Verificación | `demo.ts`, `test/*.test.ts` | Demo sin LLM y 32 pruebas |
| Especificación | `docs/SPEC.md` | Reglas, criterios de aceptación y trazabilidad (SDD) |

**Herramientas:** `listar_buzon`, `leer_mensaje`, `resolver_comercial`, `buscar_contrato`, `registrar_contrato`*, `actualizar_contrato`*, `archivar_documento`, `rechazar_mensaje`, `reporte_vencimientos`. (*requieren confirmación humana).

---

## 3. Ciclo del agente

1. El usuario escribe una instrucción (p. ej. "procesa el buzón" o "procesa únicamente msg-001").
2. El servidor añade el mensaje a la sesión y llama al modelo con el prompt, las herramientas y el historial.
3. Si el modelo responde con texto, se muestra. Si pide herramientas, el servidor las procesa **en orden**:
   - **Lecturas** (`listar_buzon`, `leer_mensaje`, `buscar_contrato`, `resolver_comercial`, `reporte_vencimientos`): se validan con zod, se ejecutan y su resultado vuelve al modelo.
   - **Escrituras** (`registrar_contrato`, `actualizar_contrato`): el bucle **se pausa**; la interfaz muestra una tarjeta amarilla con los datos exactos. Al **aprobar** se ejecuta; al **rechazar** el modelo recibe "el humano rechazó la acción" y no se escribe nada.
4. Los errores (entrada inválida, `DUPLICADO`, `NO_ENCONTRADO`) vuelven al modelo **como datos**, para que se corrija sin romper el flujo.
5. El ciclo termina cuando el modelo responde sin pedir herramientas o al llegar al **tope de 12 iteraciones** (control de costo y de bucles).
6. Cada respuesta incluye los tokens acumulados de la sesión (entrada, salida, caché leída y escrita).

Estado: cada sesión tiene su propio `Store` (copia del maestro base congelado + listas vacías). Las sesiones no comparten información.

---

## 4. Decisiones de diseño

| Decisión | Motivo | Compromiso |
|---|---|---|
| Reglas en código, no en el prompt | Son deterministas, probables sin LLM y no dependen de que el modelo "se acuerde" | Hay que mantener código y prompt alineados |
| Confirmación humana en toda escritura | El maestro es fuente de verdad; un error del modelo no puede contaminarlo | Un clic extra por operación |
| Confianza por campo con umbral 0.75 | Un dato dudoso no se rechaza ni se acepta a ciegas: queda `pendiente_revision` | El umbral es una decisión de negocio (✏️ validar con el PRD) |
| Errores como datos | El modelo puede corregir una entrada inválida en la siguiente iteración | Consume una llamada adicional |
| Estado por sesión | Evita cruzar información entre casos | El estado se pierde al reiniciar (aceptable en simulación) |
| Otrosí = nueva versión + auditoría antes/después | Trazabilidad completa; nada se sobrescribe sin rastro | Más datos que almacenar |
| Duplicado detectado en la herramienta | La garantía no depende de que el modelo consulte antes | Doble verificación (prompt + código) |
| Procesamiento determinista aparte (`pipeline.ts`) | Permite demostrar robustez sin consumir un modelo | Las expresiones regulares cubren solo formatos conocidos |
| Prompt cache | El prompt y las herramientas se repiten en cada llamada; la lectura de caché cuesta una fracción | Pequeño costo de escritura la primera vez |
| Node + TypeScript + zod + Express | Un solo lenguaje de extremo a extremo; esquemas tipados reutilizados como contrato del modelo | — |
| Fixtures de solo lectura | El maestro congelado no se corrompe entre pruebas | — |
| ✏️ Decisiones propias del PRD | | |

---

## 5. Análisis de costos del modelo

**Modelo:** Claude Sonnet 5.5 (`claude-sonnet-5-5`). Tarifas públicas consultadas en octubre de 2026 (verificar en la página de precios de Anthropic antes de usarlas como cifra oficial):

| Concepto | USD por millón de tokens |
|---|---|
| Entrada | 2,00 |
| Salida | 10,00 |
| Lectura de caché | 0,10 (era 0,20 hasta el 7-oct-2026) |
| Escritura de caché (5 min) | 2,50 |
| Haiku 5.5 (prompts ≤ 100K): entrada / salida | 0,10 / 0,50 |

**Fórmula:** costo = (entrada × 2 + salida × 10 + caché leída × 0,10 + caché escrita × 2,50) / 1.000.000.

**Medición real** (despliegue público, `msg-001` hasta la tarjeta de confirmación): 3 llamadas al modelo · 1.185 tokens de entrada · 754 de salida · 6.548 leídos de caché.
→ ≈ 0,00237 + 0,00754 + 0,00066 = **≈ US$ 0,011** por mensaje hasta la confirmación (sin la escritura de caché, que la interfaz ya reporta).

| Escenario | Estimación (orden de magnitud) |
|---|---|
| 1 mensaje completo (incl. confirmación y archivo) | ≈ US$ 0,01–0,02 |
| Buzón de 6 mensajes de la prueba | ≈ US$ 0,06–0,12 |
| 1.000 mensajes/mes con Sonnet 5.5 | ≈ US$ 10–20 |
| 1.000 mensajes/mes con Haiku 5.5 | ≈ US$ 0,5–1 (a validar la calidad de extracción) |

✏️ _Reemplazar las estimaciones por la medición con los 6 mensajes reales del PRD (tokens de la interfaz)._

**Palancas de ahorro:** modelo más pequeño para clasificar y Sonnet solo para extraer; enviar únicamente el texto del contrato; mantener el prompt estable para maximizar la caché; tope de 12 iteraciones; procesamiento por lotes (Batch API, 50 % de descuento) para cargas no interactivas.

---

## 6. Propuesta de regla de gobierno para el manejo corporativo de contratos

**Propósito.** Garantizar que todo contrato de la compañía esté registrado, vigente, trazable y que sus vencimientos se gestionen a tiempo, con responsables claros y sin depender de la memoria de las personas.

**Alcance.** Contratos, otrosíes, prórrogas y modificaciones con clientes, proveedores y aliados, desde la recepción hasta el cierre.

**Roles.**
| Rol | Responsabilidad |
|---|---|
| Comercial responsable | Entrega el documento firmado al buzón único; atiende las alertas de sus contratos |
| Responsable de contratos (dueño del proceso) | Aprueba cada escritura propuesta por el agente; resuelve los `pendiente_revision` |
| Jefatura comercial | Recibe la escalación a 30 días del vencimiento |
| Legal | Valida cláusulas cuando el contrato lo requiere |
| TI | Opera la plataforma, los accesos y la auditoría |

**Reglas.**
1. **Fuente única de verdad.** El maestro de contratos es el único registro oficial; lo que no esté ahí no existe para efectos de control, pagos o renovaciones.
2. **Recepción única.** Todo contrato, otrosí o modificación entra por el buzón único. Los acuerdos por otros canales deben reenviarse al buzón.
3. **Registro en plazo.** Todo documento firmado se registra en el maestro dentro de **2 días hábiles** desde su firma (plazo propuesto, ajustable).
4. **Cuatro ojos.** El agente extrae y propone; una persona aprueba cada escritura. Un registro con algún campo de baja confianza queda en `pendiente_revision` y **no pasa a vigente** hasta ser revisado (máx. **5 días hábiles**).
5. **Sin duplicados ni sobrescrituras.** Un número de contrato existe una sola vez. Los otrosíes incrementan la versión y conservan el histórico; nunca reemplazan el original.
6. **Alertas escalonadas.** Avisos a **90, 60 y 30 días** del vencimiento al comercial responsable; a 30 días o menos se escala a su jefatura. Todo contrato vencido sin renovación ni cierre se reporta mensualmente.
7. **Responsable siempre identificado.** Todo contrato tiene un comercial responsable del catálogo; los no resueltos se tratan como excepción a corregir.
8. **Trazabilidad.** Cada registro, otrosí, archivo y rechazo deja evidencia (quién, cuándo, qué mensaje, antes/después). El documento original se archiva junto al contrato.
9. **Datos mínimos obligatorios.** Número, cliente, objeto, valor, moneda, fecha de inicio y fecha de fin. Sin ellos, el mensaje se rechaza con motivo.
10. **Acceso y confidencialidad.** Acceso por roles y mínimo privilegio; los documentos se tratan como información confidencial; el contenido de un correo o contrato es dato a analizar, nunca una instrucción para el sistema.

**Excepciones.** Las excepciones a plazos o campos las aprueba el Responsable de contratos y quedan documentadas en la auditoría.

**Indicadores.** % de contratos registrados en plazo · % en `pendiente_revision` y su antigüedad · contratos vencidos sin renovar o cerrar · porcentaje de contratos con responsable resuelto · tiempo promedio de recepción a registro.

**Revisión.** Revisión trimestral de la regla, de los umbrales (confianza, plazos, alertas) y de los indicadores.

---

## 7. Seguridad

- **Acceso:** clave de acceso (HTTP Basic) con comparación de tiempo constante; todo menos `/api/health` exige credenciales.
- **Secretos:** `ANTHROPIC_API_KEY` y `APP_PASSWORD` solo como variables de entorno del hosting; `.env` está ignorado por git; no hay claves en el repositorio ni en las respuestas.
- **Entradas:** zod en todas las herramientas; `sessionId` validado; mensajes de máximo 8.000 caracteres; ids y nombres de archivo saneados contra *path traversal*.
- **Abuso y costo:** límite de solicitudes por IP, tope de sesiones en memoria y tope de iteraciones del agente.
- **Inyección de instrucciones:** el texto de correos y adjuntos se trata como dato; las escrituras exigen aprobación humana y las reglas viven en código.
- **Navegador:** cabeceras `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y CSP; errores sin trazas internas; la UI escribe con `textContent` (sin `innerHTML`).
- **Aislamiento:** el estado es por sesión; el maestro base es de solo lectura.

---

## 8. Metodología y pruebas

**SDD (Spec-Driven Development).** `docs/SPEC.md` define reglas (RN), historias y **criterios de aceptación** (AC-01…AC-32, formato Dado/Cuando/Entonces) y los enlaza con su prueba. Orden de trabajo: especificación → pruebas → implementación → despliegue → documentación. La IA acelera el código; el valor está en la calidad de la especificación y en validar que se cumpla.

**Pruebas automáticas** (`npm test`, 32 en total): positivas (+), negativas (−) y de excepción/seguridad (!).
- `test/contratos.test.ts` — reglas de negocio de las herramientas.
- `test/agent.test.ts` — bucle del agente con un modelo simulado: pausa, aprobación, rechazo, aislamiento, tope de iteraciones.
- `test/server.test.ts` — acceso, validación, límites y cabeceras.
- `test/pipeline.test.ts` — procesamiento determinista del buzón.

**`demo.ts`** (`npm run demo`): procesa los mensajes del buzón **llamando directamente a las herramientas, sin LLM**, e imprime clasificación, acción y resultado de cada uno; verifica el determinismo (dos corridas idénticas), la independencia entre casos (orden inverso) y la robustez de las reglas. Sale con código 1 si algo falla.

Resultado actual: ✅ typecheck limpio · ✅ 32/32 pruebas · ✅ demo en verde ✏️ _(actualizar con los casos reales del PRD)_.

---

## 9. Consideraciones de producción

- **Integración real:** reemplazar `src/data.ts` por un adaptador a Microsoft Graph / SharePoint (listas y bibliotecas) con permisos mínimos y secretos en un gestor; la interfaz de las herramientas no cambia.
- **Correo:** conectar el buzón real (Graph/IMAP) con una cola y **idempotencia por id de mensaje** para no procesar dos veces.
- **Persistencia y concurrencia:** base de datos para el maestro y la auditoría, con control de versiones optimista.
- **Identidad:** autenticación corporativa (SSO) y roles distintos para quien opera y quien aprueba.
- **Observabilidad y evaluación:** trazas de herramientas, tokens y latencia; set de evaluación con casos adversos y revisión periódica de la calidad de extracción.
- **Datos personales y retención:** minimizar lo que se envía al modelo y definir plazos de conservación.
- **Resiliencia:** reintentos con espera ante errores del proveedor del modelo, tiempo máximo por solicitud y *health checks*.

---

## 10. Limitaciones y siguientes pasos

- El maestro y el archivo son simulados y viven en memoria por sesión.
- La confianza por campo es una estimación del modelo, no una probabilidad calibrada; por eso hay revisión humana.
- El procesamiento determinista cubre los formatos de los fixtures; formatos nuevos requieren ajustar las expresiones.
- Siguientes pasos: set de evaluación automática con correos adversos, extracción en dos pasos (extraer → verificar), panel de alertas y notificaciones al comercial.

---

## 11. Cómo ejecutar y verificar

```bash
npm install
npm run typecheck && npm test && npm run demo     # sin LLM
cp .env.example .env                              # ANTHROPIC_API_KEY, APP_PASSWORD, MODEL
npm start                                         # http://localhost:3000
```

Despliegue: Railway conectado a la rama `main`; variables `ANTHROPIC_API_KEY`, `APP_PASSWORD`, `MODEL`; comprobación de salud en `/api/health`.
