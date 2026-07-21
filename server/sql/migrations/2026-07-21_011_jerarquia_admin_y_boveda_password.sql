-- Jerarquía administrativa y resguardo reversible de credenciales.
-- La contraseña de autenticación continúa almacenada únicamente como hash bcrypt.
-- Esta columna guarda una copia cifrada con AES-256-GCM para consulta exclusiva
-- del administrador principal. Las credenciales anteriores permanecen NULL
-- hasta que el usuario o un administrador principal cambie la contraseña.

ALTER TABLE usuarios_sistema
  ADD COLUMN IF NOT EXISTS password_ciphertext TEXT NULL;

COMMENT ON COLUMN usuarios_sistema.password_ciphertext IS
  'Credencial cifrada AES-256-GCM; acceso exclusivo y auditado para ADMIN principal.';
