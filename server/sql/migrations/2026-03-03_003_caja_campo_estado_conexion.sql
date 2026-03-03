-- Sincroniza estructura para modulos de caja, campo y estado de conexion.
-- Diseñado para ejecutarse de forma idempotente.

CREATE TABLE IF NOT EXISTS codigos_impresion (
  id_codigo BIGSERIAL PRIMARY KEY,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  id_usuario INTEGER NULL,
  id_contribuyente INTEGER NULL,
  recibos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_monto NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS actas_corte (
  id_acta BIGSERIAL PRIMARY KEY,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  id_usuario INTEGER NULL,
  id_contribuyente INTEGER NOT NULL,
  codigo_municipal VARCHAR(32) NULL,
  meses_deuda INTEGER NOT NULL DEFAULT 0,
  deuda_total NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS caja_cierres (
  id_cierre BIGSERIAL PRIMARY KEY,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  id_usuario INTEGER NULL,
  tipo VARCHAR(20) NOT NULL,
  fecha_referencia DATE NOT NULL,
  desde DATE NOT NULL,
  hasta_exclusivo DATE NOT NULL,
  total_sistema NUMERIC(12, 2) NOT NULL DEFAULT 0,
  efectivo_declarado NUMERIC(12, 2) NOT NULL DEFAULT 0,
  desviacion NUMERIC(12, 2) NOT NULL DEFAULT 0,
  alerta_desviacion_sn CHAR(1) NOT NULL DEFAULT 'N',
  observacion TEXT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_caja_cierres_tipo'
  ) THEN
    ALTER TABLE caja_cierres
      ADD CONSTRAINT chk_caja_cierres_tipo
      CHECK (tipo IN ('diario', 'semanal', 'mensual', 'anual'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_caja_cierres_alerta'
  ) THEN
    ALTER TABLE caja_cierres
      ADD CONSTRAINT chk_caja_cierres_alerta
      CHECK (alerta_desviacion_sn IN ('S', 'N'));
  END IF;
END $$;

ALTER TABLE contribuyentes
  ADD COLUMN IF NOT EXISTS estado_conexion VARCHAR(20);

ALTER TABLE contribuyentes
  ALTER COLUMN estado_conexion SET DEFAULT 'CON_CONEXION';

UPDATE contribuyentes c
SET estado_conexion = CASE
  WHEN UPPER(COALESCE(TRIM(c.estado_conexion), '')) IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO')
    THEN UPPER(TRIM(c.estado_conexion))
  WHEN EXISTS (
    SELECT 1
    FROM predios p
    WHERE p.id_contribuyente = c.id_contribuyente
      AND UPPER(COALESCE(p.estado_servicio, '')) = 'CORTADO'
  ) THEN 'CORTADO'
  WHEN EXISTS (
    SELECT 1
    FROM predios p
    WHERE p.id_contribuyente = c.id_contribuyente
      AND UPPER(COALESCE(p.activo_sn, 'S')) = 'S'
  ) THEN 'CON_CONEXION'
  ELSE 'SIN_CONEXION'
END
WHERE c.estado_conexion IS NULL
   OR UPPER(COALESCE(TRIM(c.estado_conexion), '')) NOT IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_contribuyentes_estado_conexion'
  ) THEN
    ALTER TABLE contribuyentes
      ADD CONSTRAINT chk_contribuyentes_estado_conexion
      CHECK (estado_conexion IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO'));
  END IF;
END $$;

ALTER TABLE contribuyentes
  ADD COLUMN IF NOT EXISTS estado_conexion_fuente VARCHAR(20);

ALTER TABLE contribuyentes
  ALTER COLUMN estado_conexion_fuente SET DEFAULT 'INFERIDO';

ALTER TABLE contribuyentes
  ADD COLUMN IF NOT EXISTS estado_conexion_verificado_sn CHAR(1);

ALTER TABLE contribuyentes
  ALTER COLUMN estado_conexion_verificado_sn SET DEFAULT 'N';

ALTER TABLE contribuyentes
  ADD COLUMN IF NOT EXISTS estado_conexion_fecha_verificacion DATE;

ALTER TABLE contribuyentes
  ADD COLUMN IF NOT EXISTS estado_conexion_motivo_ultimo TEXT;

UPDATE contribuyentes
SET estado_conexion_fuente = 'INFERIDO'
WHERE estado_conexion_fuente IS NULL
   OR UPPER(COALESCE(TRIM(estado_conexion_fuente), '')) NOT IN ('INFERIDO', 'IMPORTACION', 'OFICINA', 'CAMPO');

UPDATE contribuyentes
SET estado_conexion_verificado_sn = 'N'
WHERE estado_conexion_verificado_sn IS NULL
   OR UPPER(COALESCE(TRIM(estado_conexion_verificado_sn), '')) NOT IN ('S', 'N');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_contribuyentes_estado_conexion_fuente'
  ) THEN
    ALTER TABLE contribuyentes
      ADD CONSTRAINT chk_contribuyentes_estado_conexion_fuente
      CHECK (estado_conexion_fuente IN ('INFERIDO', 'IMPORTACION', 'OFICINA', 'CAMPO'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_contribuyentes_estado_conexion_verificado'
  ) THEN
    ALTER TABLE contribuyentes
      ADD CONSTRAINT chk_contribuyentes_estado_conexion_verificado
      CHECK (estado_conexion_verificado_sn IN ('S', 'N'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS estado_conexion_eventos (
  id_evento BIGSERIAL PRIMARY KEY,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  id_usuario INTEGER NULL,
  id_contribuyente INTEGER NOT NULL,
  estado_anterior VARCHAR(20) NOT NULL,
  estado_nuevo VARCHAR(20) NOT NULL,
  motivo TEXT NULL
);

CREATE TABLE IF NOT EXISTS campo_solicitudes (
  id_solicitud BIGSERIAL PRIMARY KEY,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  id_contribuyente INTEGER NOT NULL REFERENCES contribuyentes(id_contribuyente),
  codigo_municipal VARCHAR(32) NULL,
  estado_solicitud VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  id_usuario_solicita INTEGER NULL,
  nombre_solicitante VARCHAR(160) NULL,
  fuente VARCHAR(40) NOT NULL DEFAULT 'APP_CAMPO',
  estado_conexion_actual VARCHAR(20) NOT NULL,
  estado_conexion_nuevo VARCHAR(20) NOT NULL,
  nombre_verificado VARCHAR(200) NULL,
  dni_verificado VARCHAR(30) NULL,
  telefono_verificado VARCHAR(40) NULL,
  direccion_verificada TEXT NULL,
  observacion_campo TEXT NULL,
  motivo_revision TEXT NULL,
  id_usuario_revision INTEGER NULL,
  revisado_en TIMESTAMP NULL,
  idempotency_key VARCHAR(80) NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE campo_solicitudes
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(80);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_campo_solicitudes_estado'
  ) THEN
    ALTER TABLE campo_solicitudes
      ADD CONSTRAINT chk_campo_solicitudes_estado
      CHECK (estado_solicitud IN ('PENDIENTE', 'APROBADO', 'RECHAZADO'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_campo_solicitudes_estado_actual'
  ) THEN
    ALTER TABLE campo_solicitudes
      ADD CONSTRAINT chk_campo_solicitudes_estado_actual
      CHECK (estado_conexion_actual IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_campo_solicitudes_estado_nuevo'
  ) THEN
    ALTER TABLE campo_solicitudes
      ADD CONSTRAINT chk_campo_solicitudes_estado_nuevo
      CHECK (estado_conexion_nuevo IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_recibos_total_pagar_non_negative'
  ) THEN
    ALTER TABLE recibos
      ADD CONSTRAINT chk_recibos_total_pagar_non_negative
      CHECK (total_pagar >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pagos_monto_pagado_positive'
  ) THEN
    ALTER TABLE pagos
      ADD CONSTRAINT chk_pagos_monto_pagado_positive
      CHECK (monto_pagado > 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE pagos
  ADD COLUMN IF NOT EXISTS id_orden_cobro BIGINT NULL;

UPDATE pagos
SET usuario_cajero = 'IMPORTACION_HISTORIAL'
WHERE id_orden_cobro IS NULL
  AND COALESCE(NULLIF(TRIM(usuario_cajero), ''), '') = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pagos_origen_registro'
  ) THEN
    ALTER TABLE pagos
      ADD CONSTRAINT chk_pagos_origen_registro
      CHECK (
        id_orden_cobro IS NOT NULL
        OR COALESCE(NULLIF(TRIM(usuario_cajero), ''), '') <> ''
      ) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_pagos_id_orden_cobro'
  ) THEN
    ALTER TABLE pagos
      ADD CONSTRAINT fk_pagos_id_orden_cobro
      FOREIGN KEY (id_orden_cobro)
      REFERENCES ordenes_cobro(id_orden);
  END IF;
END $$;
