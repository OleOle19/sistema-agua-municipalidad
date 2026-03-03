MIGRACIONES SQL - GUIA RAPIDA

1) Crear archivo nuevo en esta carpeta con formato:
   YYYY-MM-DD_NNN_descripcion.sql
   Ejemplo: 2026-03-03_002_agregar_indice_recibos.sql

2) Escribir SQL idempotente cuando sea posible:
   - ADD COLUMN IF NOT EXISTS
   - CREATE INDEX IF NOT EXISTS

3) Ver estado:
   npm run migrate:status

4) Aplicar pendientes:
   npm run migrate

5) Regla clave:
   Nunca editar una migracion ya aplicada.
   Si necesitas corregir algo, crea una nueva migracion.
