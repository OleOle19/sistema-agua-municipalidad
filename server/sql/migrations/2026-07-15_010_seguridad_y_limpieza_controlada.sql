-- Correcciones incrementales de seguridad y operaciones.
-- Este archivo reemplaza cambios que antes se ejecutaban de forma destructiva en cada arranque.

CREATE INDEX IF NOT EXISTS idx_contribuyentes_estado_conexion_normalizada
  ON contribuyentes ((COALESCE(NULLIF(UPPER(TRIM(estado_conexion)), ''), 'SIN_CONEXION')));

ALTER TABLE usuarios_sistema
  DROP COLUMN IF EXISTS password_visible;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename ILIKE 'reniec%'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', r.schemaname, r.tablename);
  END LOOP;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name ILIKE 'reniec%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP COLUMN IF EXISTS %I CASCADE',
      r.table_schema,
      r.table_name,
      r.column_name
    );
  END LOOP;
END $$;
