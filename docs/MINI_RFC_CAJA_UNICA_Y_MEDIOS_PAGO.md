# Mini-RFC: Caja Unica + Medios de Pago Digital

- Fecha: 2026-03-01
- Estado: Borrador para revision interna
- Autor: Equipo de sistemas (base funcional)
- Ambito: Modulo de cobranza municipal (oficina)

## 1) Resumen ejecutivo

Se propone evolucionar el flujo actual de cobranza para:

1. Reducir pasos operativos (ventanilla + caja) mediante un modo de trabajo de "caja unica".
2. Permitir medios de pago no efectivo (tarjeta, yape, transferencia), manteniendo control, auditoria y cierre de caja.

La propuesta esta pensada para implementarse por fases, con bajo riesgo y sin romper el flujo actual.

## 2) Contexto actual

Hoy el sistema maneja un flujo de dos pasos:

1. Emision de orden de cobro (rol operativo alto).
2. Cobro de orden pendiente (rol caja).

Adicionalmente:

- Existe trazabilidad por auditoria.
- Existe cierre de caja con "efectivo declarado".
- El reporte de caja consolida movimientos y cargos de reimpresion.

## 3) Objetivos

1. Disminuir tiempo de atencion al contribuyente.
2. Mantener o mejorar el control interno (auditoria, anulaciones, cierres).
3. Habilitar cobro con distintos medios sin perder conciliacion contable.
4. Conservar compatibilidad con el modelo actual durante la transicion.

## 4) No objetivos (en esta etapa)

1. Integracion inmediata con pasarelas bancarias en tiempo real.
2. Reemplazo total del esquema actual de roles.
3. Cambiar la logica tributaria (deuda, recibos, periodos).

## 5) Propuesta funcional

### 5.1 Modo operativo de cobranza

Se define una configuracion operativa por entorno:

- `DOBLE_CONTROL` (actual): emision y cobro en pasos separados.
- `CAJA_UNICA` (nuevo): el mismo operador puede emitir y cobrar en una misma atencion.

Regla recomendada:

1. Mantener ambos modos configurables.
2. Activar `CAJA_UNICA` por resolucion interna.
3. En auditoria registrar siempre dos eventos logicos, incluso en caja unica:
   - `ORDEN_COBRO_EMITIDA`
   - `ORDEN_COBRO_COBRADA`

### 5.2 Permisos y control interno

En `CAJA_UNICA` se recomienda:

1. Permitir operacion integral a un rol de caja autorizado.
2. Reservar anulaciones y excepciones a supervisor (`ADMIN_SEC` o superior).
3. Exigir motivo obligatorio en anulacion.
4. Registrar alertas por patrones de riesgo (anulaciones frecuentes, reemisiones, cobros fuera de horario).

### 5.3 Medios de pago

Catalogo inicial de metodos:

1. `EFECTIVO`
2. `TARJETA`
3. `YAPE`
4. `TRANSFERENCIA`

Reglas minimas por metodo:

1. `EFECTIVO`: sin referencia externa obligatoria.
2. `TARJETA`: referencia/operacion obligatoria.
3. `YAPE`: numero de operacion obligatorio.
4. `TRANSFERENCIA`: numero de operacion obligatorio.

Campos funcionales por cobro:

1. Metodo de pago.
2. Referencia de operacion (cuando aplique).
3. Estado de confirmacion (`CONFIRMADO`, `PENDIENTE_VERIFICACION`, `RECHAZADO`).
4. Observacion opcional.

### 5.4 Cierre de caja y conciliacion

Evolucion del cierre:

1. Mantener "efectivo declarado".
2. Agregar declaracion por metodo.
3. Mostrar desviacion total y desviacion por metodo.
4. Marcar alerta cuando la desviacion supere umbral.

Reporte de caja:

1. Totales generales.
2. Totales por metodo.
3. Movimientos con metodo y referencia.
4. Exportable a Excel.

## 6) Propuesta tecnica (sin codigo)

### 6.1 Cambios de datos propuestos

1. Extender entidad de pagos con metadatos de metodo:
   - `metodo_pago`
   - `referencia_operacion`
   - `estado_confirmacion`
   - `observacion_pago`
   - `metadata_pago` (json para futura expansion)
2. Extender cierres de caja para declarar montos por metodo:
   - alternativa A: columnas por metodo
   - alternativa B: json consolidado por metodo (recomendada para flexibilidad)
3. Mantener compatibilidad:
   - registros historicos sin metodo se tratan como `EFECTIVO`.

### 6.2 Cambios API propuestos

1. Cobro de orden:
   - recibir metodo y referencia.
2. Cierre de caja:
   - recibir montos declarados por metodo.
3. Reporte de caja:
   - devolver totales por metodo y filtro opcional por metodo.
4. Auditoria:
   - registrar metodo y referencia parcial enmascarada para evitar exponer datos sensibles.

### 6.3 Cambios UI propuestos

1. Pantalla de cobro:
   - selector de metodo de pago.
   - campo de referencia condicionado por metodo.
   - validaciones en tiempo real.
2. Pantalla de cierre:
   - bloque de declaracion por metodo.
   - bloque de diferencias por metodo y total.
3. Reportes:
   - resumen visual por metodo.
   - tabla detallada con metodo/referencia.

## 7) Riesgos y mitigaciones

1. Riesgo: errores de registro en referencias digitales.
   - Mitigacion: validaciones de formato y entrenamiento de caja.
2. Riesgo: sobrecarga operativa al cambiar flujo.
   - Mitigacion: piloto controlado y manual breve de uso.
3. Riesgo: menor segregacion de funciones en caja unica.
   - Mitigacion: alertas de riesgo + anulacion restringida + auditoria reforzada + cierres obligatorios.
4. Riesgo: conciliacion diaria inconsistente.
   - Mitigacion: corte diario con desvios por metodo y reporte firmado.

## 8) Plan de implementacion sugerido

### Fase 0: Aprobacion funcional

1. Validar reglas con jefe de recursos y tesoreria.
2. Definir metodos habilitados oficialmente.
3. Definir quien puede anular y bajo que condiciones.

### Fase 1: MVP operativo (bajo riesgo)

1. Activar `CAJA_UNICA` por configuracion.
2. Agregar metodos de pago y referencia en cobro.
3. Mantener confirmacion manual para pagos digitales.
4. Reporte de caja con totales por metodo.

### Fase 2: Control y conciliacion

1. Cierre de caja por metodo.
2. Alertas de desvio por metodo.
3. Ajustes de interfaz y entrenamiento de usuarios.

### Fase 3: Integraciones (opcional)

1. Evaluar integracion con POS/pasarela.
2. Confirmacion automatica de operaciones digitales.

## 9) Criterios de exito (KPI)

1. Reduccion del tiempo promedio de atencion por contribuyente.
2. Reduccion de colas en horas pico.
3. Tasa de error en cierres por debajo del umbral definido.
4. Porcentaje de cobranzas digitales adoptadas.
5. Cero perdida de trazabilidad en auditoria.

## 10) Decisiones pendientes para direccion

1. Se aprueba oficialmente `CAJA_UNICA` como modo operativo?
2. Que metodos digitales se habilitan en fase 1?
3. Se exige referencia obligatoria para todo pago no efectivo?
4. Quien autoriza anulaciones y reversiones?
5. Cual es el umbral de alerta de cierre por metodo?
6. Se requiere comprobante adjunto para yape/transferencia en fase 1?
7. Se implementa piloto en una sola caja antes del despliegue total?

## 11) Recomendacion final

Implementar por fases, empezando por `CAJA_UNICA` + metodos de pago con verificacion manual, para capturar valor rapido sin comprometer control interno. Despues, iterar con conciliacion por metodo y eventual integracion automatica.
