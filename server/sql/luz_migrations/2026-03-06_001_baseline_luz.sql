CREATE TABLE IF NOT EXISTS usuarios_sistema (
  id_usuario SERIAL PRIMARY KEY,
  username VARCHAR(120) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  nombre_completo VARCHAR(180) NOT NULL,
  rol VARCHAR(30) NOT NULL DEFAULT 'CONSULTA',
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
  fecha_registro TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_usuarios_rol'
  ) THEN
    ALTER TABLE usuarios_sistema
      ADD CONSTRAINT chk_luz_usuarios_rol
      CHECK (UPPER(TRIM(rol)) IN ('ADMIN', 'ADMIN_SEC', 'CAJERO', 'CONSULTA', 'BRIGADA', 'SUPERADMIN', 'ADMIN_PRINCIPAL', 'NIVEL_1', 'NIVEL_2', 'NIVEL_3', 'NIVEL_4', 'NIVEL_5'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_usuarios_estado'
  ) THEN
    ALTER TABLE usuarios_sistema
      ADD CONSTRAINT chk_luz_usuarios_estado
      CHECK (UPPER(TRIM(estado)) IN ('ACTIVO', 'PENDIENTE', 'INACTIVO'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS zonas (
  id_zona SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suministros (
  id_suministro SERIAL PRIMARY KEY,
  id_zona INTEGER NOT NULL REFERENCES zonas(id_zona),
  nro_medidor VARCHAR(80) NOT NULL,
  nro_medidor_real VARCHAR(80) NULL,
  nombre_usuario VARCHAR(220) NOT NULL,
  direccion TEXT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (id_zona, nro_medidor)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_suministros_estado'
  ) THEN
    ALTER TABLE suministros
      ADD CONSTRAINT chk_luz_suministros_estado
      CHECK (estado IN ('ACTIVO', 'CORTADO', 'INACTIVO'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tarifas_config (
  id_tarifa BIGSERIAL PRIMARY KEY,
  tarifa_kwh NUMERIC(10,2) NOT NULL,
  cargo_fijo NUMERIC(10,2) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  creado_por VARCHAR(120) NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_tarifas_tarifa_kwh'
  ) THEN
    ALTER TABLE tarifas_config
      ADD CONSTRAINT chk_luz_tarifas_tarifa_kwh CHECK (tarifa_kwh >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_tarifas_cargo_fijo'
  ) THEN
    ALTER TABLE tarifas_config
      ADD CONSTRAINT chk_luz_tarifas_cargo_fijo CHECK (cargo_fijo >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_luz_tarifas_activa ON tarifas_config ((activo)) WHERE activo = TRUE;

CREATE TABLE IF NOT EXISTS config_fechas (
  id_config SMALLINT PRIMARY KEY,
  dias_vencimiento INTEGER NOT NULL,
  dias_corte INTEGER NOT NULL,
  actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  actualizado_por VARCHAR(120) NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_config_fechas_venc'
  ) THEN
    ALTER TABLE config_fechas
      ADD CONSTRAINT chk_luz_config_fechas_venc CHECK (dias_vencimiento BETWEEN 0 AND 90);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_config_fechas_corte'
  ) THEN
    ALTER TABLE config_fechas
      ADD CONSTRAINT chk_luz_config_fechas_corte CHECK (dias_corte BETWEEN 0 AND 120);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_config_fechas_orden'
  ) THEN
    ALTER TABLE config_fechas
      ADD CONSTRAINT chk_luz_config_fechas_orden CHECK (dias_corte >= dias_vencimiento);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS recibos (
  id_recibo BIGSERIAL PRIMARY KEY,
  id_suministro INTEGER NOT NULL REFERENCES suministros(id_suministro),
  anio INTEGER NOT NULL,
  mes INTEGER NOT NULL,
  lectura_anterior NUMERIC(14,2) NOT NULL,
  lectura_actual NUMERIC(14,2) NOT NULL,
  consumo_kwh NUMERIC(14,2) NOT NULL,
  tarifa_kwh NUMERIC(10,2) NOT NULL,
  energia_activa NUMERIC(14,2) NOT NULL,
  mantenimiento NUMERIC(14,2) NOT NULL,
  total_pagar NUMERIC(14,2) NOT NULL,
  fecha_emision DATE NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  fecha_corte DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  observacion TEXT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (id_suministro, anio, mes)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_recibos_mes'
  ) THEN
    ALTER TABLE recibos
      ADD CONSTRAINT chk_luz_recibos_mes CHECK (mes BETWEEN 1 AND 12);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_recibos_lecturas'
  ) THEN
    ALTER TABLE recibos
      ADD CONSTRAINT chk_luz_recibos_lecturas CHECK (lectura_actual >= lectura_anterior);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_recibos_consumo'
  ) THEN
    ALTER TABLE recibos
      ADD CONSTRAINT chk_luz_recibos_consumo CHECK (consumo_kwh = (lectura_actual - lectura_anterior));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_recibos_energia'
  ) THEN
    ALTER TABLE recibos
      ADD CONSTRAINT chk_luz_recibos_energia CHECK (energia_activa = ROUND((consumo_kwh * tarifa_kwh)::numeric, 2));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_recibos_total'
  ) THEN
    ALTER TABLE recibos
      ADD CONSTRAINT chk_luz_recibos_total CHECK (total_pagar = ROUND((energia_activa + mantenimiento)::numeric, 2));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_recibos_estado'
  ) THEN
    ALTER TABLE recibos
      ADD CONSTRAINT chk_luz_recibos_estado CHECK (estado IN ('PENDIENTE', 'PARCIAL', 'PAGADO', 'NO_EXIGIBLE'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ordenes_cobro (
  id_orden BIGSERIAL PRIMARY KEY,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  id_usuario_emite INTEGER NULL REFERENCES usuarios_sistema(id_usuario),
  id_usuario_cobra INTEGER NULL REFERENCES usuarios_sistema(id_usuario),
  id_suministro INTEGER NOT NULL REFERENCES suministros(id_suministro),
  total_orden NUMERIC(14,2) NOT NULL,
  recibos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  observacion TEXT NULL,
  cobrado_en TIMESTAMP NULL,
  motivo_anulacion TEXT NULL,
  anulado_en TIMESTAMP NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_ordenes_estado'
  ) THEN
    ALTER TABLE ordenes_cobro
      ADD CONSTRAINT chk_luz_ordenes_estado CHECK (estado IN ('PENDIENTE', 'COBRADA', 'ANULADA'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_ordenes_total'
  ) THEN
    ALTER TABLE ordenes_cobro
      ADD CONSTRAINT chk_luz_ordenes_total CHECK (total_orden > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pagos (
  id_pago BIGSERIAL PRIMARY KEY,
  id_recibo BIGINT NOT NULL REFERENCES recibos(id_recibo),
  fecha_pago TIMESTAMP NOT NULL DEFAULT NOW(),
  monto_pagado NUMERIC(14,2) NOT NULL,
  usuario_cajero VARCHAR(120) NULL,
  id_orden_cobro BIGINT NULL REFERENCES ordenes_cobro(id_orden)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_pagos_monto'
  ) THEN
    ALTER TABLE pagos
      ADD CONSTRAINT chk_luz_pagos_monto CHECK (monto_pagado > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS codigos_impresion (
  id_codigo BIGSERIAL PRIMARY KEY,
  creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
  id_usuario INTEGER NULL REFERENCES usuarios_sistema(id_usuario),
  recibos_json JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS auditoria (
  id_auditoria BIGSERIAL PRIMARY KEY,
  fecha TIMESTAMP NOT NULL DEFAULT NOW(),
  usuario VARCHAR(160) NULL,
  accion VARCHAR(120) NOT NULL,
  detalle TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_luz_suministros_nombre ON suministros (nombre_usuario);
CREATE INDEX IF NOT EXISTS idx_luz_suministros_medidor ON suministros (nro_medidor);
CREATE INDEX IF NOT EXISTS idx_luz_suministros_zona_estado ON suministros (id_zona, estado, nro_medidor);
CREATE INDEX IF NOT EXISTS idx_luz_recibos_periodo ON recibos (anio, mes, id_suministro, id_recibo);
CREATE INDEX IF NOT EXISTS idx_luz_recibos_suministro ON recibos (id_suministro);
CREATE INDEX IF NOT EXISTS idx_luz_pagos_fecha ON pagos (fecha_pago DESC);
CREATE INDEX IF NOT EXISTS idx_luz_pagos_recibo ON pagos (id_recibo);
CREATE INDEX IF NOT EXISTS idx_luz_ordenes_estado ON ordenes_cobro (estado, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_luz_ordenes_suministro ON ordenes_cobro (id_suministro, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_luz_codigos_gin ON codigos_impresion USING GIN (recibos_json);

INSERT INTO config_fechas (id_config, dias_vencimiento, dias_corte)
VALUES (1, 6, 10)
ON CONFLICT (id_config) DO NOTHING;

INSERT INTO tarifas_config (tarifa_kwh, cargo_fijo, activo, creado_por)
SELECT 1.00, 6.50, TRUE, 'MIGRACION'
WHERE NOT EXISTS (
  SELECT 1 FROM tarifas_config WHERE activo = TRUE
);
