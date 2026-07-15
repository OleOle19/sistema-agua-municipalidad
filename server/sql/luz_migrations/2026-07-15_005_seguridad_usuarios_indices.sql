-- Reafirma las diferencias del baseline legacy y elimina almacenamiento de claves visibles.

CREATE INDEX IF NOT EXISTS idx_luz_suministros_zona_estado
  ON suministros (id_zona, estado, nro_medidor);

ALTER TABLE usuarios_sistema
  DROP COLUMN IF EXISTS password_visible;
