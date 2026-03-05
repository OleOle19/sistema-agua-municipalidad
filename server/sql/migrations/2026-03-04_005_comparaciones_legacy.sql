-- Comparaciones legacy vs base actual

CREATE TABLE IF NOT EXISTS comparaciones_legacy_corridas (
  id_corrida BIGSERIAL PRIMARY KEY,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  id_usuario INTEGER NULL,
  archivo_nombre TEXT NOT NULL,
  archivo_sha256 VARCHAR(64) NOT NULL,
  fecha_desde DATE NULL,
  fecha_hasta DATE NULL,
  duracion_ms INTEGER NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'EN_PROCESO',
  resumen_json JSONB NULL,
  error_json JSONB NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_comparaciones_legacy_corridas_estado'
  ) THEN
    ALTER TABLE comparaciones_legacy_corridas
    ADD CONSTRAINT chk_comparaciones_legacy_corridas_estado
    CHECK (estado IN ('EN_PROCESO', 'COMPLETADA', 'ERROR'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comparaciones_legacy_corridas_creado_en
ON comparaciones_legacy_corridas (creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_comparaciones_legacy_corridas_estado
ON comparaciones_legacy_corridas (estado, creado_en DESC);

CREATE TABLE IF NOT EXISTS comparaciones_legacy_detalle (
  id_detalle BIGSERIAL PRIMARY KEY,
  id_corrida BIGINT NOT NULL REFERENCES comparaciones_legacy_corridas(id_corrida) ON DELETE CASCADE,
  seccion VARCHAR(30) NOT NULL,
  categoria VARCHAR(40) NOT NULL,
  clave VARCHAR(120) NULL,
  codigo_municipal VARCHAR(32) NULL,
  dni_ruc VARCHAR(32) NULL,
  campo VARCHAR(80) NULL,
  valor_antiguo TEXT NULL,
  valor_nuevo TEXT NULL,
  delta NUMERIC(14, 2) NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_comparaciones_legacy_detalle_corrida
ON comparaciones_legacy_detalle (id_corrida);

CREATE INDEX IF NOT EXISTS idx_comparaciones_legacy_detalle_seccion_categoria
ON comparaciones_legacy_detalle (id_corrida, seccion, categoria);

CREATE INDEX IF NOT EXISTS idx_comparaciones_legacy_detalle_codigo
ON comparaciones_legacy_detalle (id_corrida, codigo_municipal);

CREATE INDEX IF NOT EXISTS idx_comparaciones_legacy_detalle_dni
ON comparaciones_legacy_detalle (id_corrida, dni_ruc);
