# Agente de recepción de contratos

Agente conversacional en TypeScript (Node 20+) que actúa como punto único de recepción de correos con contratos, otrosíes y cotizaciones: los clasifica, extrae los datos con nivel de confianza por campo, registra o actualiza el maestro de contratos (SharePoint simulado), archiva los documentos y genera reportes de alertas de vencimiento. Toda escritura requiere confirmación humana.

**URL pública:** https://agente-contratos-production.up.railway.app (acceso con usuario y clave)

## Estructura
```
agent/prompt.md            System prompt del agente
src/tools/contratos.ts     Herramientas tipadas con zod (reglas de negocio)
src/tools/registry.ts      Validación y ejecución de herramientas
src/agent.ts               Bucle del agente y confirmación humana
src/server.ts, main.ts     Backend HTTP (acceso, límites, cabeceras)
src/data.ts                Datos simulados, estado aislado por sesión
src/pipeline.ts            Procesamiento determinista del buzón (sin LLM)
public/index.html          Chat con llamadas a herramientas y tarjeta de confirmación
demo.ts                    Verificación sin LLM: procesa el buzón llamando a las herramientas
test/*.test.ts             Pruebas automáticas (reglas, agente, seguridad, pipeline)
docs/SPEC.md               Especificación (SDD): reglas, criterios de aceptación, trazabilidad
SOLUCION.md                Documentación técnica y de proceso
fixtures-demo/             Datos ficticios de ejemplo
```

## Ejecución local
```bash
npm install
cp .env.example .env        # completar ANTHROPIC_API_KEY y APP_PASSWORD
npm start                   # http://localhost:3000
```

## Verificación
```bash
npm run typecheck
npm test                    # pruebas positivas, negativas y de excepción
npm run demo                # procesa el buzón con las herramientas, sin LLM
```

## Variables de entorno
| Variable | Descripción |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de la API del modelo (solo como variable de entorno) |
| `APP_PASSWORD` | Clave de acceso a la aplicación (HTTP Basic, usuario libre) |
| `MODEL` | Modelo a usar (por defecto `claude-sonnet-5-5`) |
| `FIXTURES_DIR` | Carpeta de datos (maestro, comerciales, buzón) |
| `FECHA_CORTE` | Fecha de corte para las alertas de vencimiento |
| `RATE_LIMIT_PER_MIN` | Límite de solicitudes por IP por minuto |

## Despliegue
Railway conectado a la rama `main` (Dockerfile incluido); comprobación de salud en `/api/health`.

Detalles de arquitectura, ciclo del agente, decisiones, costos y regla de gobierno: ver [SOLUCION.md](SOLUCION.md).
