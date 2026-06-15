-- Fase de hardening para Luz: limpiar contraseñas visibles heredadas.
-- La columna se mantiene temporalmente por compatibilidad, pero deja de exponerse y escribirse.
UPDATE usuarios_sistema
SET password_visible = NULL
WHERE COALESCE(password_visible, '') <> '';
