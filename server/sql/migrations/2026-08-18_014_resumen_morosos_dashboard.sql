ALTER TABLE contribuyentes_resumen_financiero
ADD COLUMN IF NOT EXISTS predios_morosos_actuales INTEGER NOT NULL DEFAULT 0;

