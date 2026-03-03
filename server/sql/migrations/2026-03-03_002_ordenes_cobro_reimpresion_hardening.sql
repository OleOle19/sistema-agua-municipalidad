-- Asegura estructura e integridad para ordenes de cobro con cargo de reimpresion.
-- Idempotente: se puede ejecutar mas de una vez sin romper.

CREATE TABLE IF NOT EXISTS ordenes_cobro (
  id_orden BIGSERIAL PRIMARY KEY,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  id_usuario_emite INTEGER NULL,
  id_usuario_cobra INTEGER NULL,
  id_usuario_anula INTEGER NULL,
  id_contribuyente INTEGER NOT NULL REFERENCES contribuyentes(id_contribuyente),
  codigo_municipal VARCHAR(32) NULL,
  total_orden NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cargo_reimpresion NUMERIC(12, 2) NOT NULL DEFAULT 0,
  motivo_cargo_reimpresion TEXT NULL,
  recibos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  observacion TEXT NULL,
  motivo_anulacion TEXT NULL,
  cobrado_en TIMESTAMP NULL,
  anulado_en TIMESTAMP NULL
);

ALTER TABLE ordenes_cobro
  ADD COLUMN IF NOT EXISTS cargo_reimpresion NUMERIC(12, 2);

UPDATE ordenes_cobro
SET cargo_reimpresion = 0
WHERE cargo_reimpresion IS NULL;

ALTER TABLE ordenes_cobro
  ALTER COLUMN cargo_reimpresion SET DEFAULT 0;

ALTER TABLE ordenes_cobro
  ALTER COLUMN cargo_reimpresion SET NOT NULL;

ALTER TABLE ordenes_cobro
  ADD COLUMN IF NOT EXISTS motivo_cargo_reimpresion TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ordenes_cobro_cargo_reimpresion_nonnegative'
  ) THEN
    ALTER TABLE ordenes_cobro
      ADD CONSTRAINT chk_ordenes_cobro_cargo_reimpresion_nonnegative
      CHECK (cargo_reimpresion >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ordenes_cobro_estado'
  ) THEN
    ALTER TABLE ordenes_cobro
      ADD CONSTRAINT chk_ordenes_cobro_estado
      CHECK (estado IN ('PENDIENTE', 'COBRADA', 'ANULADA'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ordenes_cobro_total_positive'
  ) THEN
    ALTER TABLE ordenes_cobro
      ADD CONSTRAINT chk_ordenes_cobro_total_positive
      CHECK (total_orden > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ordenes_cobro_estado_creado
  ON ordenes_cobro (estado, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_ordenes_cobro_contribuyente_estado
  ON ordenes_cobro (id_contribuyente, estado, creado_en DESC);
