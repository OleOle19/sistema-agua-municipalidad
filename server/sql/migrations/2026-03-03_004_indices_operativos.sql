-- Indices operativos para mejorar rendimiento en consultas frecuentes.
-- Idempotente.

CREATE INDEX IF NOT EXISTS idx_caja_cierres_creado_en
  ON caja_cierres (creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_caja_cierres_tipo_fecha
  ON caja_cierres (tipo, fecha_referencia DESC);

CREATE INDEX IF NOT EXISTS idx_contribuyentes_estado_conexion
  ON contribuyentes (estado_conexion);

CREATE INDEX IF NOT EXISTS idx_contribuyentes_estado_conexion_fuente
  ON contribuyentes (estado_conexion_fuente);

CREATE INDEX IF NOT EXISTS idx_estado_conexion_eventos_id_contribuyente
  ON estado_conexion_eventos (id_contribuyente);

CREATE INDEX IF NOT EXISTS idx_estado_conexion_eventos_creado_en
  ON estado_conexion_eventos (creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_campo_solicitudes_estado
  ON campo_solicitudes (estado_solicitud, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_campo_solicitudes_contribuyente
  ON campo_solicitudes (id_contribuyente);

CREATE UNIQUE INDEX IF NOT EXISTS uq_campo_solicitudes_idempotency
  ON campo_solicitudes (id_usuario_solicita, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_pagos_fecha_pago
  ON pagos (fecha_pago DESC);

CREATE INDEX IF NOT EXISTS idx_pagos_id_recibo
  ON pagos (id_recibo);

CREATE INDEX IF NOT EXISTS idx_pagos_id_orden_cobro
  ON pagos (id_orden_cobro);

CREATE INDEX IF NOT EXISTS idx_recibos_id_predio_anio_mes
  ON recibos (id_predio, anio, mes);

CREATE INDEX IF NOT EXISTS idx_recibos_anio_mes_id_predio_id_recibo
  ON recibos (anio, mes, id_predio, id_recibo);

CREATE INDEX IF NOT EXISTS idx_recibos_anio_mes
  ON recibos (anio, mes);

CREATE INDEX IF NOT EXISTS idx_predios_id_contribuyente
  ON predios (id_contribuyente);

CREATE INDEX IF NOT EXISTS idx_predios_id_calle
  ON predios (id_calle);

CREATE INDEX IF NOT EXISTS idx_contribuyentes_codigo_municipal
  ON contribuyentes (codigo_municipal);

CREATE INDEX IF NOT EXISTS idx_contribuyentes_nombre_completo
  ON contribuyentes (nombre_completo);

CREATE INDEX IF NOT EXISTS idx_codigos_impresion_recibos_json_gin
  ON codigos_impresion USING GIN (recibos_json);
