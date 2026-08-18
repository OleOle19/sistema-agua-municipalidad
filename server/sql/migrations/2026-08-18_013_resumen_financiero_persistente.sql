CREATE TABLE IF NOT EXISTS contribuyentes_resumen_financiero (
  id_contribuyente INTEGER PRIMARY KEY
    REFERENCES contribuyentes(id_contribuyente) ON DELETE CASCADE,
  deuda_anio NUMERIC(14,2) NOT NULL DEFAULT 0,
  abono_anio NUMERIC(14,2) NOT NULL DEFAULT 0,
  meses_deuda INTEGER NOT NULL DEFAULT 0,
  pendiente_caja_monto NUMERIC(14,2) NOT NULL DEFAULT 0,
  pendiente_caja_ordenes INTEGER NOT NULL DEFAULT 0,
  periodo_corte INTEGER NOT NULL,
  calculo_version SMALLINT NOT NULL DEFAULT 1,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contribuyentes_resumen_periodo
  ON contribuyentes_resumen_financiero (periodo_corte, id_contribuyente);

CREATE TABLE IF NOT EXISTS contribuyentes_resumen_dirty (
  id_contribuyente INTEGER PRIMARY KEY,
  marcado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION fn_resumen_dirty_id(p_id_contribuyente INTEGER)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_id_contribuyente IS NULL OR p_id_contribuyente <= 0 THEN
    RETURN;
  END IF;
  INSERT INTO contribuyentes_resumen_dirty (id_contribuyente, marcado_en)
  VALUES (p_id_contribuyente, NOW())
  ON CONFLICT (id_contribuyente)
  DO UPDATE SET marcado_en = EXCLUDED.marcado_en;
END;
$$;

CREATE OR REPLACE FUNCTION trg_resumen_dirty_contribuyentes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fn_resumen_dirty_id(NEW.id_contribuyente);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_resumen_dirty_predios()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM fn_resumen_dirty_id(OLD.id_contribuyente);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM fn_resumen_dirty_id(NEW.id_contribuyente);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_resumen_dirty_recibos()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_id_predio INTEGER;
  v_id_contribuyente INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_id_predio := OLD.id_predio;
    SELECT id_contribuyente INTO v_id_contribuyente
    FROM predios WHERE id_predio = v_id_predio;
    PERFORM fn_resumen_dirty_id(v_id_contribuyente);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_id_predio := NEW.id_predio;
    SELECT id_contribuyente INTO v_id_contribuyente
    FROM predios WHERE id_predio = v_id_predio;
    PERFORM fn_resumen_dirty_id(v_id_contribuyente);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_resumen_dirty_pagos()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_id_recibo INTEGER;
  v_id_contribuyente INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_id_recibo := OLD.id_recibo;
    SELECT pr.id_contribuyente INTO v_id_contribuyente
    FROM recibos r
    JOIN predios pr ON pr.id_predio = r.id_predio
    WHERE r.id_recibo = v_id_recibo;
    PERFORM fn_resumen_dirty_id(v_id_contribuyente);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_id_recibo := NEW.id_recibo;
    SELECT pr.id_contribuyente INTO v_id_contribuyente
    FROM recibos r
    JOIN predios pr ON pr.id_predio = r.id_predio
    WHERE r.id_recibo = v_id_recibo;
    PERFORM fn_resumen_dirty_id(v_id_contribuyente);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_resumen_dirty_ordenes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM fn_resumen_dirty_id(OLD.id_contribuyente);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM fn_resumen_dirty_id(NEW.id_contribuyente);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resumen_dirty_contribuyentes ON contribuyentes;
CREATE TRIGGER resumen_dirty_contribuyentes
AFTER INSERT ON contribuyentes
FOR EACH ROW EXECUTE FUNCTION trg_resumen_dirty_contribuyentes();

DROP TRIGGER IF EXISTS resumen_dirty_predios ON predios;
CREATE TRIGGER resumen_dirty_predios
AFTER INSERT OR UPDATE OR DELETE ON predios
FOR EACH ROW EXECUTE FUNCTION trg_resumen_dirty_predios();

DROP TRIGGER IF EXISTS resumen_dirty_recibos ON recibos;
CREATE TRIGGER resumen_dirty_recibos
AFTER INSERT OR UPDATE OR DELETE ON recibos
FOR EACH ROW EXECUTE FUNCTION trg_resumen_dirty_recibos();

DROP TRIGGER IF EXISTS resumen_dirty_pagos ON pagos;
CREATE TRIGGER resumen_dirty_pagos
AFTER INSERT OR UPDATE OR DELETE ON pagos
FOR EACH ROW EXECUTE FUNCTION trg_resumen_dirty_pagos();

DROP TRIGGER IF EXISTS resumen_dirty_ordenes ON ordenes_cobro;
CREATE TRIGGER resumen_dirty_ordenes
AFTER INSERT OR UPDATE OR DELETE ON ordenes_cobro
FOR EACH ROW EXECUTE FUNCTION trg_resumen_dirty_ordenes();

INSERT INTO contribuyentes_resumen_dirty (id_contribuyente, marcado_en)
SELECT id_contribuyente, NOW()
FROM contribuyentes
ON CONFLICT (id_contribuyente)
DO UPDATE SET marcado_en = EXCLUDED.marcado_en;
