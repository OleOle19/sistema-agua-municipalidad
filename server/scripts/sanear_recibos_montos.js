const pool = require('../db');

const EPS = 0.001;
const APPLY = process.argv.includes('--apply');

const resumenSql = `
  WITH pagos_por_recibo AS (
    SELECT
      r.id_recibo,
      r.total_pagar,
      COALESCE(SUM(p.monto_pagado), 0)::numeric AS total_pagado
    FROM recibos r
    LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
    GROUP BY r.id_recibo, r.total_pagar
  )
  SELECT
    COUNT(*) FILTER (
      WHERE total_pagado > 0 AND total_pagar <= 0
    )::int AS total_no_positivo_con_pago,
    COUNT(*) FILTER (
      WHERE total_pagado > total_pagar + $1 AND total_pagar > 0
    )::int AS sobrepagados_con_total_positivo,
    COUNT(*) FILTER (
      WHERE total_pagado > 0 AND (total_pagar <= 0 OR total_pagado > total_pagar + $1)
    )::int AS total_afectados
  FROM pagos_por_recibo
`;

const muestraSql = `
  WITH pagos_por_recibo AS (
    SELECT
      r.id_recibo,
      r.id_predio,
      r.anio,
      r.mes,
      r.total_pagar,
      COALESCE(SUM(p.monto_pagado), 0)::numeric AS total_pagado
    FROM recibos r
    LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
    GROUP BY r.id_recibo, r.id_predio, r.anio, r.mes, r.total_pagar
  )
  SELECT
    id_recibo,
    id_predio,
    anio,
    mes,
    total_pagar,
    total_pagado,
    (total_pagado - total_pagar) AS diferencia
  FROM pagos_por_recibo
  WHERE total_pagado > 0
    AND (total_pagar <= 0 OR total_pagado > total_pagar + $1)
  ORDER BY ABS(total_pagado - total_pagar) DESC, id_recibo DESC
  LIMIT 20
`;

const applySql = `
  WITH pagos_por_recibo AS (
    SELECT
      r.id_recibo,
      r.total_pagar AS total_actual,
      COALESCE(SUM(p.monto_pagado), 0)::numeric AS total_pagado
    FROM recibos r
    LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
    GROUP BY r.id_recibo, r.total_pagar
  ),
  afectados AS (
    SELECT
      id_recibo,
      total_actual,
      total_pagado,
      GREATEST(total_pagado, 0)::numeric AS total_nuevo
    FROM pagos_por_recibo
    WHERE total_pagado > 0
      AND (total_actual <= 0 OR total_pagado > total_actual + $1)
  ),
  bitacora AS (
    INSERT INTO saneamiento_recibos_log (
      ejecutado_en,
      id_recibo,
      total_anterior,
      total_pagado,
      total_nuevo,
      motivo
    )
    SELECT
      NOW(),
      a.id_recibo,
      a.total_actual,
      a.total_pagado,
      a.total_nuevo,
      CASE
        WHEN a.total_actual <= 0 THEN 'TOTAL_NO_POSITIVO'
        ELSE 'SOBREPAGO'
      END
    FROM afectados a
    RETURNING 1
  )
  UPDATE recibos r
  SET
    total_pagar = a.total_nuevo,
    estado = CASE
      WHEN a.total_pagado >= a.total_nuevo - $1 THEN 'PAGADO'
      WHEN a.total_pagado > 0 THEN 'PARCIAL'
      ELSE 'PENDIENTE'
    END
  FROM afectados a
  WHERE r.id_recibo = a.id_recibo
  RETURNING r.id_recibo
`;

async function main() {
  const client = await pool.connect();
  try {
    const resumenAntes = await client.query(resumenSql, [EPS]);
    const muestra = await client.query(muestraSql, [EPS]);
    console.log('Resumen actual de anomalias:');
    console.log(JSON.stringify(resumenAntes.rows[0], null, 2));
    console.log('Muestra (20):');
    console.log(JSON.stringify(muestra.rows, null, 2));

    if (!APPLY) {
      console.log('\nModo reporte (sin cambios). Usa --apply para corregir.');
      return;
    }

    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS saneamiento_recibos_log (
        id_log BIGSERIAL PRIMARY KEY,
        ejecutado_en TIMESTAMP NOT NULL DEFAULT NOW(),
        id_recibo BIGINT NOT NULL,
        total_anterior NUMERIC(14, 2) NOT NULL,
        total_pagado NUMERIC(14, 2) NOT NULL,
        total_nuevo NUMERIC(14, 2) NOT NULL,
        motivo VARCHAR(40) NOT NULL
      )
    `);
    const updated = await client.query(applySql, [EPS]);
    await client.query('COMMIT');

    const resumenDespues = await client.query(resumenSql, [EPS]);
    console.log('\nSaneamiento aplicado.');
    console.log(`Recibos actualizados: ${updated.rowCount}`);
    console.log('Resumen despues del saneamiento:');
    console.log(JSON.stringify(resumenDespues.rows[0], null, 2));
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Error saneando recibos:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
