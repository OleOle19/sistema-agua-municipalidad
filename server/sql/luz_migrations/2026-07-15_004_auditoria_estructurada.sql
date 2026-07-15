-- Auditoria v2 para Luz. Conserva accion/detalle para historicos.

ALTER TABLE auditoria
  ADD COLUMN IF NOT EXISTS sistema VARCHAR(16) NOT NULL DEFAULT 'LUZ',
  ADD COLUMN IF NOT EXISTS actor_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS actor_rol VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS evento VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS nivel_riesgo VARCHAR(16) NULL,
  ADD COLUMN IF NOT EXISTS resultado VARCHAR(20) NOT NULL DEFAULT 'EXITO',
  ADD COLUMN IF NOT EXISTS entidad_tipo VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS entidad_id VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS ip VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS datos_antes JSONB NULL,
  ADD COLUMN IF NOT EXISTS datos_despues JSONB NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE auditoria
SET sistema = 'LUZ'
WHERE COALESCE(NULLIF(TRIM(sistema), ''), '') = '';

UPDATE auditoria
SET evento = LEFT(REGEXP_REPLACE(UPPER(COALESCE(accion, 'EVENTO_SISTEMA')), '[^A-Z0-9_-]+', '_', 'g'), 120)
WHERE evento IS NULL OR TRIM(evento) = '';

UPDATE auditoria
SET categoria = CASE
  WHEN UPPER(COALESCE(evento, accion, '')) ~ '(AUTH|LOGIN|PASSWORD|ACCESO)' THEN 'SEGURIDAD'
  WHEN UPPER(COALESCE(evento, accion, '')) ~ '(PAGO|COBRO|CAJA|CIERRE|ORDEN)' THEN 'CAJA'
  WHEN UPPER(COALESCE(evento, accion, '')) ~ '(RECIBO|DEUDA)' THEN 'DEUDA'
  WHEN UPPER(COALESCE(evento, accion, '')) ~ '(SUMINISTRO|PADRON)' THEN 'PADRON'
  WHEN UPPER(COALESCE(evento, accion, '')) ~ '(CAMPO|CORTE|ACTA)' THEN 'CAMPO'
  WHEN UPPER(COALESCE(evento, accion, '')) ~ '(IMPORT|EXPORT|BACKUP)' THEN 'DATOS'
  WHEN UPPER(COALESCE(evento, accion, '')) ~ '(USUARIO|CONFIG|TARIFA)' THEN 'ADMINISTRACION'
  ELSE 'SISTEMA'
END
WHERE categoria IS NULL OR TRIM(categoria) = '';

UPDATE auditoria
SET nivel_riesgo = CASE
  WHEN UPPER(COALESCE(evento, accion, '')) ~ '(ELIMIN|DELETE|ANUL|PASSWORD|DESHECH|REINTEGR|BACKUP|IMPORT|ACCESO_DENEGADO)' THEN 'ALTO'
  WHEN categoria IN ('CAJA', 'DEUDA', 'SEGURIDAD', 'ADMINISTRACION') THEN 'MEDIO'
  ELSE 'BAJO'
END
WHERE nivel_riesgo IS NULL OR TRIM(nivel_riesgo) = '';

CREATE INDEX IF NOT EXISTS idx_luz_auditoria_fecha_desc ON auditoria (fecha DESC, id_auditoria DESC);
CREATE INDEX IF NOT EXISTS idx_luz_auditoria_usuario_fecha ON auditoria (usuario, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_luz_auditoria_evento_fecha ON auditoria (evento, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_luz_auditoria_categoria_riesgo_fecha ON auditoria (categoria, nivel_riesgo, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_luz_auditoria_entidad ON auditoria (entidad_tipo, entidad_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_luz_auditoria_resultado_fecha ON auditoria (resultado, fecha DESC);

CREATE TABLE IF NOT EXISTS auditoria_reversiones (
  id_reversion BIGSERIAL PRIMARY KEY,
  id_auditoria_origen BIGINT NOT NULL REFERENCES auditoria(id_auditoria),
  id_auditoria_reversion BIGINT NULL REFERENCES auditoria(id_auditoria),
  motivo VARCHAR(500) NOT NULL,
  usuario VARCHAR(160) NOT NULL,
  actor_id BIGINT NULL,
  fecha TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_luz_auditoria_reversion_origen UNIQUE (id_auditoria_origen)
);

CREATE INDEX IF NOT EXISTS idx_luz_auditoria_reversiones_fecha ON auditoria_reversiones (fecha DESC);
