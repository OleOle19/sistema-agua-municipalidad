-- Limpieza segura de deudas autogeneradas antes del cierre real de abril 2026.
-- Objetivo:
-- 1) Solo afecta recibos del periodo 04/2026.
-- 2) No elimina recibos con pagos asociados.
-- 3) No elimina recibos vinculados a ordenes de cobro activas (PENDIENTE/COBRADA).
-- 4) Se bloquea automaticamente si ya llego el ultimo dia del mes objetivo.
--
-- Uso recomendado:
-- 1) Ejecutar primero el bloque de PREVIEW para revisar cuantos recibos se tocaran.
-- 2) Si el resultado es correcto, ejecutar luego el bloque de DELETE.

-- =========================
-- PREVIEW (solo lectura)
-- =========================
WITH objetivo AS (
  SELECT r.id_recibo
  FROM recibos r
  WHERE r.anio = 2026
    AND r.mes = 4
    AND COALESCE(r.estado, 'PENDIENTE') = 'PENDIENTE'
    AND NOT EXISTS (
      SELECT 1
      FROM pagos p
      WHERE p.id_recibo = r.id_recibo
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ordenes_cobro oc
      WHERE COALESCE(oc.estado, 'PENDIENTE') <> 'ANULADA'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(oc.recibos_json, '[]'::jsonb)) it
          WHERE (it->>'id_recibo') ~ '^[0-9]+$'
            AND (it->>'id_recibo')::bigint = r.id_recibo
        )
    )
)
SELECT COUNT(*)::int AS recibos_objetivo
FROM objetivo;

-- =========================
-- DELETE (ejecucion real)
-- =========================
DO $$
DECLARE
  v_anio INTEGER := 2026;
  v_mes INTEGER := 4;
  v_tz TEXT := 'America/Lima';
  v_hoy DATE := (NOW() AT TIME ZONE v_tz)::date;
  v_ultimo_dia DATE := (make_date(v_anio, v_mes, 1) + INTERVAL '1 month - 1 day')::date;
BEGIN
  IF v_hoy >= v_ultimo_dia THEN
    RAISE EXCEPTION
      'Operacion bloqueada: fecha local % (zona %) ya alcanzo o supero el ultimo dia % del periodo %/%',
      v_hoy, v_tz, v_ultimo_dia, v_mes, v_anio;
  END IF;
END $$;

BEGIN;

WITH objetivo AS (
  SELECT r.id_recibo
  FROM recibos r
  WHERE r.anio = 2026
    AND r.mes = 4
    AND COALESCE(r.estado, 'PENDIENTE') = 'PENDIENTE'
    AND NOT EXISTS (
      SELECT 1
      FROM pagos p
      WHERE p.id_recibo = r.id_recibo
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ordenes_cobro oc
      WHERE COALESCE(oc.estado, 'PENDIENTE') <> 'ANULADA'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(oc.recibos_json, '[]'::jsonb)) it
          WHERE (it->>'id_recibo') ~ '^[0-9]+$'
            AND (it->>'id_recibo')::bigint = r.id_recibo
        )
    )
),
eliminados AS (
  DELETE FROM recibos r
  USING objetivo o
  WHERE r.id_recibo = o.id_recibo
  RETURNING r.id_recibo
)
SELECT COUNT(*)::int AS recibos_eliminados
FROM eliminados;

COMMIT;
