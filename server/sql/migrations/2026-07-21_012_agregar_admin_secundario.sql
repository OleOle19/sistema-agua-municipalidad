-- Conserva ADMIN_SEC como Ventanilla y agrega ADMIN_AUX como un rol nuevo.

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'usuarios_sistema'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%rol%'
  LOOP
    EXECUTE format('ALTER TABLE usuarios_sistema DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END $$;

ALTER TABLE usuarios_sistema
  ADD CONSTRAINT chk_usuarios_sistema_rol
  CHECK (
    UPPER(TRIM(rol)) IN (
      'ADMIN', 'SUPERADMIN', 'ADMIN_PRINCIPAL', 'NIVEL_1',
      'ADMIN_AUX', 'ADMINISTRADOR_SECUNDARIO', 'SUBADMIN',
      'ADMIN_SEC', 'ADMIN_SECUNDARIO', 'JEFE_CAJA', 'NIVEL_2',
      'CAJERO', 'OPERADOR_CAJA', 'OPERADOR', 'NIVEL_3',
      'CONSULTA', 'LECTURA', 'NIVEL_4',
      'BRIGADA', 'BRIGADISTA', 'CAMPO', 'NIVEL_5'
    )
  );
