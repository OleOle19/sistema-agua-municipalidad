-- Ajuste manual solicitado el 2026-05-07.
-- Casos:
-- 1) TIMANA MARRUFO ELOISA debe quedar con marzo 2026 pendiente (sin pago activo).
-- 2) COSTA TIMANA MARTHA debe tener marzo 2026 pagado con fecha 2026-01-23.
--
-- El script es idempotente:
-- - crea los recibos faltantes de marzo 2026 solo si no existen;
-- - inserta el pago de Martha solo si ese recibo aun no tiene pagos activos;
-- - recalcula el estado final de ambos recibos segun los pagos activos.

BEGIN;

INSERT INTO recibos (
  id_predio,
  anio,
  mes,
  subtotal_agua,
  subtotal_desague,
  subtotal_limpieza,
  subtotal_admin,
  total_pagar,
  estado
)
SELECT
  pr.id_predio,
  2026,
  3,
  7.50,
  3.50,
  3.50,
  0.50,
  15.00,
  'PENDIENTE'
FROM contribuyentes c
JOIN predios pr ON pr.id_contribuyente = c.id_contribuyente
WHERE c.codigo_municipal = '000340'
  AND NOT EXISTS (
    SELECT 1
    FROM recibos r
    WHERE r.id_predio = pr.id_predio
      AND r.anio = 2026
      AND r.mes = 3
  );

INSERT INTO recibos (
  id_predio,
  anio,
  mes,
  subtotal_agua,
  subtotal_desague,
  subtotal_limpieza,
  subtotal_admin,
  total_pagar,
  estado
)
SELECT
  pr.id_predio,
  2026,
  3,
  7.50,
  0.00,
  0.00,
  0.50,
  8.00,
  'PENDIENTE'
FROM contribuyentes c
JOIN predios pr ON pr.id_contribuyente = c.id_contribuyente
WHERE c.codigo_municipal = '001430'
  AND NOT EXISTS (
    SELECT 1
    FROM recibos r
    WHERE r.id_predio = pr.id_predio
      AND r.anio = 2026
      AND r.mes = 3
  );

INSERT INTO pagos (id_recibo, monto_pagado, fecha_pago, usuario_cajero)
SELECT
  r.id_recibo,
  8.00,
  TIMESTAMP '2026-01-23 12:00:00',
  'AJUSTE_MANUAL_2026-05-07'
FROM contribuyentes c
JOIN predios pr ON pr.id_contribuyente = c.id_contribuyente
JOIN recibos r ON r.id_predio = pr.id_predio
WHERE c.codigo_municipal = '001430'
  AND r.anio = 2026
  AND r.mes = 3
  AND NOT EXISTS (
    SELECT 1
    FROM pagos p
    WHERE p.id_recibo = r.id_recibo
  );

UPDATE recibos r
SET estado = CASE
  WHEN COALESCE(t.total_pagado, 0) >= r.total_pagar - 0.001 THEN 'PAGADO'
  WHEN COALESCE(t.total_pagado, 0) > 0.001 THEN 'PARCIAL'
  ELSE 'PENDIENTE'
END
FROM (
  SELECT
    r2.id_recibo,
    COALESCE(SUM(p.monto_pagado), 0)::numeric AS total_pagado
  FROM contribuyentes c2
  JOIN predios pr2 ON pr2.id_contribuyente = c2.id_contribuyente
  JOIN recibos r2 ON r2.id_predio = pr2.id_predio
  LEFT JOIN pagos p ON p.id_recibo = r2.id_recibo
  WHERE c2.codigo_municipal IN ('000340', '001430')
    AND r2.anio = 2026
    AND r2.mes = 3
  GROUP BY r2.id_recibo
) t
WHERE r.id_recibo = t.id_recibo;

COMMIT;

SELECT
  c.codigo_municipal,
  c.nombre_completo,
  r.id_recibo,
  r.anio,
  r.mes,
  r.estado,
  r.total_pagar,
  COALESCE(SUM(p.monto_pagado), 0)::numeric(12, 2) AS total_pagado,
  TO_CHAR(MIN(p.fecha_pago), 'YYYY-MM-DD') AS fecha_primer_pago,
  TO_CHAR(MAX(p.fecha_pago), 'YYYY-MM-DD') AS fecha_ultimo_pago
FROM contribuyentes c
JOIN predios pr ON pr.id_contribuyente = c.id_contribuyente
JOIN recibos r ON r.id_predio = pr.id_predio
LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
WHERE c.codigo_municipal IN ('000340', '001430')
  AND r.anio = 2026
  AND r.mes = 3
GROUP BY
  c.codigo_municipal,
  c.nombre_completo,
  r.id_recibo,
  r.anio,
  r.mes,
  r.estado,
  r.total_pagar
ORDER BY c.codigo_municipal;
