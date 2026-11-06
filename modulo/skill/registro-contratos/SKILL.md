---
name: registro-contratos
description: Proceso de registro de contratos vigentes: canal único, clasificación (nuevo, actualización, duplicado, rechazado), revisión humana por baja confianza, pólizas y alertas.
---

# Proceso de registro de contratos vigentes

- **Canal único**: todo contrato, otrosí o acta llega al buzón `contratos@`. El agente es el punto único de recepción; el maestro está congelado al 2026-05-30 y se retoma desde ahí.
- **Qué se registra**: todo contrato firmado, **con o sin póliza**. Una cotización o una pregunta NO es contrato: se rechaza con motivo.
- **Clasificación** (la hace la herramienta `contratos_validar`, no tú):
  - `nuevo`: no existe en el maestro → se inserta.
  - `actualizacion`: mismo contrato (mismo id, o mismo NIT + objeto muy parecido) con algún campo distinto, o un otrosí → se modifica la fila y se deja historial.
  - `duplicado`: mismo id con mismo valor y fechas → no se escribe nada.
  - `rechazado`: sin contrato.
- **Revisión humana**: todo campo ausente o con confianza < 0.8 (por ejemplo valor por demanda o una fecha fin derivada de un plazo en meses) detiene el registro. Se muestran campo por campo y se pregunta; solo tras la respuesta del usuario se registra con `confirmado=true`.
- **Pólizas**: un contrato nuevo que exige póliza queda con `estado_poliza = pendiente`; sin póliza, `no_aplica`. Un otrosí que amplía plazo exige ampliar las garantías (queda como observación).
- **Estado de vigencia**: `estado_contrato` es `vigente` o `vencido` según la fecha fin frente a la fecha de referencia del reporte.
- **Remitente desconocido**: se reporta en `alertas` pero no bloquea el registro.
- **Observaciones**: lo detectado (datos supuestos, conflictos, garantías por ampliar, remitente desconocido) queda en el campo `alertas` del maestro.
- **Alertas**: `contratos_alertas` produce el reporte de vencimientos ≤ 60 días (y vencidos), pólizas pendientes y contratos registrados desde el corte. Siempre se le pasa la fecha `hoy`.
- **Dueño del maestro**: la analista administrativa; el agente propone, ella confirma.
