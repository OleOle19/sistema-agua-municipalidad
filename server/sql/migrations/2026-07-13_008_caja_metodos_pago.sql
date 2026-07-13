-- Caja unica: metodos de pago, referencias y cierre por metodo.
-- Idempotente: conserva historicos como EFECTIVO/CONFIRMADO.

ALTER TABLE pagos
  ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(24) NOT NULL DEFAULT 'EFECTIVO',
  ADD COLUMN IF NOT EXISTS referencia_operacion VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS estado_confirmacion VARCHAR(32) NOT NULL DEFAULT 'CONFIRMADO',
  ADD COLUMN IF NOT EXISTS observacion_pago VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS metadata_pago JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE pagos
SET metodo_pago = 'EFECTIVO'
WHERE COALESCE(NULLIF(TRIM(metodo_pago), ''), '') = '';

UPDATE pagos
SET estado_confirmacion = 'CONFIRMADO'
WHERE COALESCE(NULLIF(TRIM(estado_confirmacion), ''), '') = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pagos_metodo_pago'
  ) THEN
    ALTER TABLE pagos
      ADD CONSTRAINT chk_pagos_metodo_pago
      CHECK (UPPER(COALESCE(NULLIF(TRIM(metodo_pago), ''), 'EFECTIVO')) IN ('EFECTIVO', 'TARJETA', 'YAPE', 'TRANSFERENCIA')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pagos_estado_confirmacion'
  ) THEN
    ALTER TABLE pagos
      ADD CONSTRAINT chk_pagos_estado_confirmacion
      CHECK (UPPER(COALESCE(NULLIF(TRIM(estado_confirmacion), ''), 'CONFIRMADO')) IN ('CONFIRMADO', 'PENDIENTE_VERIFICACION', 'RECHAZADO')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pagos_metodo_fecha
  ON pagos (metodo_pago, fecha_pago DESC);

ALTER TABLE ordenes_cobro
  ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(24) NULL,
  ADD COLUMN IF NOT EXISTS referencia_operacion VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS estado_confirmacion VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS observacion_pago VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS metadata_pago JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ordenes_cobro_metodo_pago'
  ) THEN
    ALTER TABLE ordenes_cobro
      ADD CONSTRAINT chk_ordenes_cobro_metodo_pago
      CHECK (
        metodo_pago IS NULL
        OR UPPER(COALESCE(NULLIF(TRIM(metodo_pago), ''), 'EFECTIVO')) IN ('EFECTIVO', 'TARJETA', 'YAPE', 'TRANSFERENCIA')
      ) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ordenes_cobro_estado_confirmacion'
  ) THEN
    ALTER TABLE ordenes_cobro
      ADD CONSTRAINT chk_ordenes_cobro_estado_confirmacion
      CHECK (
        estado_confirmacion IS NULL
        OR UPPER(COALESCE(NULLIF(TRIM(estado_confirmacion), ''), 'CONFIRMADO')) IN ('CONFIRMADO', 'PENDIENTE_VERIFICACION', 'RECHAZADO')
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE caja_conteos_efectivo
  ADD COLUMN IF NOT EXISTS declaracion_metodos_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE caja_cierres
  ADD COLUMN IF NOT EXISTS total_declarado NUMERIC(12, 2) NULL,
  ADD COLUMN IF NOT EXISTS declaracion_metodos_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS totales_metodos_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS desviaciones_metodos_json JSONB NOT NULL DEFAULT '{}'::jsonb;
