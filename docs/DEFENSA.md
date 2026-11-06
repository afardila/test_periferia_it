# Guía para la defensa técnica

Piensa en tres mensajes: **(1)** el modelo interpreta, el código garantiza; **(2)** nada se escribe sin aprobación humana; **(3)** todo es medible (demo, tokens, auditoría).

## Preguntas probables y cómo responderlas

**¿Cómo funciona el agente de principio a fin?**
Bucle: el modelo pide herramientas → el servidor valida con zod y ejecuta → devuelve el resultado al modelo → repite hasta que responde sin herramientas. Tope de 12 iteraciones. Ver `src/agent.ts`, función `drive`.

**¿Por qué zod?**
El modelo puede enviar argumentos mal formados. zod los valida antes de ejecutar y el mismo esquema genera el contrato JSON que ve el modelo: una sola fuente de verdad.

**¿Qué pasa si el modelo se equivoca?**
Tres redes: (a) validación de entrada, (b) reglas deterministas en las herramientas (duplicados, confianza), (c) confirmación humana antes de escribir. Además, los errores vuelven al modelo como datos para que se corrija.

**¿Cómo evitan duplicados?**
El prompt exige consultar antes, pero la garantía está en el código: `registrar_contrato` rechaza con `DUPLICADO` aunque el modelo olvide consultar.

**¿Qué es la confianza y de dónde sale?**
El modelo la estima por campo al extraer. Bajo 0.75 el registro queda `pendiente_revision`. Es una señal, no una verdad; por eso hay revisión humana.

**¿Y la inyección de instrucciones en un contrato ("ignora tus reglas…")?**
El texto de los documentos es dato. Las escrituras exigen aprobación humana y las reglas viven en código; el peor caso es una propuesta rechazada. En producción: filtros adicionales y permisos mínimos.

**¿Cuánto cuesta?**
Ver sección 5 de `SOLUCION.md`: tokens medidos en el chat. Palancas: caché del prompt, modelo menor para clasificar, enviar solo el texto necesario.

**¿Cómo lo llevarían a producción?**
Graph/SharePoint real, persistencia y cola, autenticación, observabilidad, evaluación periódica. Ver sección 7.

**¿Por qué no hacerlo todo con reglas, sin LLM?**
Los correos y contratos son texto libre y variable; el LLM aporta la interpretación. Las reglas que no deben fallar se dejan en código.

**¿Qué mejorarías con más tiempo?**
Set de evaluación automática con casos adversos, extracción en dos pasos (extraer → verificar), persistencia real, panel de alertas.

**¿Qué es SDD y cómo lo aplicaron?**
Spec-Driven Development: primero la especificación (reglas, criterios de aceptación Dado/Cuando/Entonces), luego pruebas y recién después el código. `docs/SPEC.md` mapea cada AC a una prueba; la IA generó código, pero el valor está en la especificación y en validar que se cumpla.

**¿Cómo demuestran que funciona?**
`npm test`: pruebas positivas, negativas y de excepción/seguridad, más `npm run demo` y las mismas verificaciones contra la URL pública. Las del agente usan un modelo simulado para ser deterministas.

**¿Cómo evitan que un caso contamine a otro?**
Cada sesión tiene su propio estado (maestro, archivo, auditoría) y el prompt exige tratar cada mensaje como caso independiente. Hay pruebas de aislamiento (AC-15, AC-19).

**¿Cómo protegen la información y los accesos?**
Clave de acceso (HTTP Basic) con comparación de tiempo constante, límite de uso por IP, validación de ids y rutas, cabeceras de seguridad, secretos solo en variables de entorno, errores sin trazas, y el contenido de los documentos tratado como dato.

## Demostración sugerida (5 min)
1. Abrir la URL → "Procesa todo el buzón".
2. Mostrar un tool call desplegado y la tarjeta amarilla de confirmación; **rechazar una** y aprobar otra.
3. Ver "Ver maestro" antes/después.
4. "Reporte de vencimientos a 90 días".
5. En terminal: `npm run demo` (verde, sin LLM).

## Antes de entrar a la defensa
- Abrir la URL 5 minutos antes (los hostings gratuitos se duermen).
- Tener el chat reiniciado ("Nueva sesión") y el pie de tokens visible.
- Plan B: túnel desde tu computador (`npx cloudflared tunnel --url http://localhost:3000`).
