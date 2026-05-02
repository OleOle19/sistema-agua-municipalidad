const pool = require("../db");

const APPLY = process.argv.includes("--apply");
const IMPORT_USER = "AJUSTE_RECAUDACION_MARZO_2026";
const EPS = 0.001;

const RECEIPT_PRESETS = {
  "22.50": { agua: 15.0, desague: 3.5, limpieza: 3.5, admin: 0.5, total: 22.5 },
  "15.00": { agua: 7.5, desague: 3.5, limpieza: 3.5, admin: 0.5, total: 15.0 },
  "8.00": { agua: 7.5, desague: 0.0, limpieza: 0.0, admin: 0.5, total: 8.0 }
};

const ENTRIES = [
  { codigo: "000777", anio: 2026, mes: 1, total: 22.5, fecha: "2026-03-11" },
  { codigo: "000777", anio: 2026, mes: 2, total: 22.5, fecha: "2026-03-11" },
  { codigo: "002029", anio: 2026, mes: 1, total: 22.5, fecha: "2026-03-11" },
  { codigo: "002029", anio: 2026, mes: 2, total: 22.5, fecha: "2026-03-11" },
  { codigo: "000244", anio: 2026, mes: 1, total: 15.0, fecha: "2026-03-11" },
  { codigo: "000244", anio: 2026, mes: 2, total: 15.0, fecha: "2026-03-11" },
  { codigo: "002761", anio: 2026, mes: 1, total: 15.0, fecha: "2026-03-11" },
  { codigo: "002761", anio: 2026, mes: 2, total: 15.0, fecha: "2026-03-11" },
  { codigo: "000443", anio: 2026, mes: 1, total: 8.0, fecha: "2026-03-11" },
  { codigo: "000443", anio: 2026, mes: 2, total: 8.0, fecha: "2026-03-11" },
  { codigo: "002342", anio: 2026, mes: 2, total: 8.0, fecha: "2026-03-12" },
  { codigo: "002342", anio: 2026, mes: 3, total: 8.0, fecha: "2026-03-12" },
  { codigo: "002707", anio: 2026, mes: 2, total: 8.0, fecha: "2026-03-12" },
  { codigo: "002707", anio: 2026, mes: 3, total: 8.0, fecha: "2026-03-12" },
  { codigo: "000532", anio: 2026, mes: 1, total: 15.0, fecha: "2026-03-19" },
  { codigo: "000532", anio: 2026, mes: 2, total: 15.0, fecha: "2026-03-19" },
  { codigo: "000532", anio: 2026, mes: 3, total: 15.0, fecha: "2026-03-19" },
  { codigo: "002020", anio: 2026, mes: 1, total: 8.0, fecha: "2026-03-19" },
  { codigo: "002020", anio: 2026, mes: 2, total: 8.0, fecha: "2026-03-19" },
  { codigo: "002020", anio: 2026, mes: 3, total: 8.0, fecha: "2026-03-19" },
  { codigo: "000165", anio: 2026, mes: 1, total: 15.0, fecha: "2026-03-04" },
  { codigo: "001960", anio: 2026, mes: 1, total: 8.0, fecha: "2026-03-04" },
  { codigo: "000175", anio: 2026, mes: 1, total: 8.0, fecha: "2026-03-05" },
  { codigo: "000175", anio: 2026, mes: 2, total: 8.0, fecha: "2026-03-05" },
  { codigo: "002596", anio: 2026, mes: 1, total: 15.0, fecha: "2026-03-11" },
  { codigo: "001834", anio: 2026, mes: 2, total: 8.0, fecha: "2026-03-11" },
  { codigo: "000168", anio: 2026, mes: 2, total: 15.0, fecha: "2026-03-17" },
  { codigo: "002449", anio: 2026, mes: 2, total: 15.0, fecha: "2026-03-17" }
];

function keyForTotal(total) {
  return Number(total).toFixed(2);
}

function getPreset(total) {
  const preset = RECEIPT_PRESETS[keyForTotal(total)];
  if (!preset) {
    throw new Error(`No hay preset configurado para total ${total}.`);
  }
  return preset;
}

function fmtPeriod(anio, mes) {
  return `${String(mes).padStart(2, "0")}/${anio}`;
}

async function getPredioByCodigo(client, codigo) {
  const rs = await client.query(
    `
      SELECT
        c.codigo_municipal,
        c.nombre_completo,
        p.id_predio
      FROM contribuyentes c
      JOIN predios p ON p.id_contribuyente = c.id_contribuyente
      WHERE c.codigo_municipal = $1
      ORDER BY p.id_predio ASC
    `,
    [codigo]
  );

  if (rs.rowCount === 0) {
    throw new Error(`No existe predio para codigo ${codigo}.`);
  }
  if (rs.rowCount > 1) {
    throw new Error(`Codigo ${codigo} tiene multiples predios y no se puede resolver de forma segura.`);
  }

  return rs.rows[0];
}

async function findRecibo(client, idPredio, anio, mes) {
  const rs = await client.query(
    `
      SELECT
        r.id_recibo,
        r.id_predio,
        r.anio,
        r.mes,
        r.subtotal_agua,
        r.subtotal_desague,
        r.subtotal_limpieza,
        r.subtotal_admin,
        r.total_pagar,
        r.estado,
        COALESCE(SUM(p.monto_pagado), 0)::numeric AS total_pagado
      FROM recibos r
      LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
      WHERE r.id_predio = $1
        AND r.anio = $2
        AND r.mes = $3
      GROUP BY r.id_recibo
      ORDER BY r.id_recibo DESC
    `,
    [idPredio, anio, mes]
  );

  if (rs.rowCount > 1) {
    throw new Error(`Predio ${idPredio} tiene multiples recibos para ${fmtPeriod(anio, mes)}.`);
  }

  return rs.rows[0] || null;
}

async function createRecibo(client, idPredio, anio, mes, preset) {
  const rs = await client.query(
    `
      INSERT INTO recibos (
        id_predio, anio, mes, fecha_emision, fecha_vencimiento,
        subtotal_agua, subtotal_desague, subtotal_limpieza, subtotal_admin,
        total_pagar, estado
      )
      VALUES (
        $1, $2, $3,
        make_date($2, $3, 1),
        (make_date($2, $3, 1) + INTERVAL '1 month')::date,
        $4, $5, $6, $7,
        $8, 'PENDIENTE'
      )
      RETURNING id_recibo
    `,
    [
      Number(idPredio),
      Number(anio),
      Number(mes),
      preset.agua,
      preset.desague,
      preset.limpieza,
      preset.admin,
      preset.total
    ]
  );
  return Number(rs.rows[0].id_recibo);
}

async function upsertPayment(client, entry) {
  const preset = getPreset(entry.total);
  const predio = await getPredioByCodigo(client, entry.codigo);

  let recibo = await findRecibo(client, Number(predio.id_predio), entry.anio, entry.mes);
  let created = false;
  if (!recibo) {
    const idRecibo = await createRecibo(client, Number(predio.id_predio), entry.anio, entry.mes, preset);
    recibo = await findRecibo(client, Number(predio.id_predio), entry.anio, entry.mes);
    if (!recibo || Number(recibo.id_recibo) !== idRecibo) {
      throw new Error(`No se pudo crear recibo para ${entry.codigo} ${fmtPeriod(entry.anio, entry.mes)}.`);
    }
    created = true;
  }

  await client.query(
    `
      UPDATE recibos
      SET
        subtotal_agua = $2,
        subtotal_desague = $3,
        subtotal_limpieza = $4,
        subtotal_admin = $5,
        total_pagar = $6
      WHERE id_recibo = $1
    `,
    [
      Number(recibo.id_recibo),
      preset.agua,
      preset.desague,
      preset.limpieza,
      preset.admin,
      preset.total
    ]
  );

  await client.query("DELETE FROM pagos WHERE id_recibo = $1", [Number(recibo.id_recibo)]);
  await client.query(
    `
      INSERT INTO pagos (id_recibo, monto_pagado, fecha_pago, usuario_cajero)
      VALUES ($1, $2, $3::date, $4)
    `,
    [Number(recibo.id_recibo), preset.total, entry.fecha, IMPORT_USER]
  );

  await client.query(
    `
      WITH pagos_agg AS (
        SELECT COALESCE(SUM(monto_pagado), 0)::numeric AS total_pagado
        FROM pagos
        WHERE id_recibo = $1
      )
      UPDATE recibos r
      SET estado = CASE
        WHEN pa.total_pagado >= r.total_pagar - $2 THEN 'PAGADO'
        WHEN pa.total_pagado > $2 THEN 'PARCIAL'
        ELSE 'PENDIENTE'
      END
      FROM pagos_agg pa
      WHERE r.id_recibo = $1
    `,
    [Number(recibo.id_recibo), EPS]
  );

  const verify = await client.query(
    `
      SELECT
        r.id_recibo,
        r.total_pagar,
        r.estado,
        COALESCE(SUM(p.monto_pagado), 0)::numeric AS total_pagado,
        MIN(p.fecha_pago) AS min_fecha,
        MAX(p.fecha_pago) AS max_fecha
      FROM recibos r
      LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
      WHERE r.id_recibo = $1
      GROUP BY r.id_recibo
    `,
    [Number(recibo.id_recibo)]
  );

  const row = verify.rows[0];
  if (!row) {
    throw new Error(`No se pudo verificar recibo ${recibo.id_recibo}.`);
  }
  if (Math.abs(Number(row.total_pagado) - preset.total) > EPS) {
    throw new Error(`Recibo ${recibo.id_recibo} quedo con total_pagado ${row.total_pagado} y se esperaba ${preset.total}.`);
  }

  return {
    codigo: entry.codigo,
    nombre: predio.nombre_completo,
    periodo: fmtPeriod(entry.anio, entry.mes),
    fecha: entry.fecha,
    total: preset.total.toFixed(2),
    id_recibo: Number(row.id_recibo),
    created,
    estado: row.estado
  };
}

async function summarizeDates(client, fechas) {
  const uniqueDates = [...new Set(fechas)];
  const rs = await client.query(
    `
      SELECT
        fecha_pago::date AS fecha,
        COUNT(*)::int AS movimientos,
        COALESCE(SUM(monto_pagado), 0)::numeric AS total
      FROM pagos
      WHERE fecha_pago::date = ANY($1::date[])
      GROUP BY fecha_pago::date
      ORDER BY fecha_pago::date
    `,
    [uniqueDates]
  );
  return rs.rows.map((row) => ({
    fecha: String(row.fecha).slice(0, 10),
    movimientos: Number(row.movimientos || 0),
    total: Number(row.total || 0).toFixed(2)
  }));
}

async function main() {
  const client = await pool.connect();
  try {
    console.log(`Modo: ${APPLY ? "APLICAR" : "SIMULAR"}`);
    console.log(`Entradas configuradas: ${ENTRIES.length}`);

    if (!APPLY) {
      for (const entry of ENTRIES) {
        console.log(`${entry.codigo} ${fmtPeriod(entry.anio, entry.mes)} -> ${keyForTotal(entry.total)} @ ${entry.fecha}`);
      }
      return;
    }

    await client.query("BEGIN");
    const applied = [];
    for (const entry of ENTRIES) {
      const result = await upsertPayment(client, entry);
      applied.push(result);
      console.log(
        `[OK] ${result.codigo} ${result.nombre} ${result.periodo} total=${result.total} fecha=${result.fecha} recibo=${result.id_recibo}${result.created ? " creado" : ""}`
      );
    }
    await client.query("COMMIT");

    const resumen = await summarizeDates(client, ENTRIES.map((entry) => entry.fecha));
    console.log("\nResumen por fecha:");
    for (const row of resumen) {
      console.log(`- ${row.fecha}: movimientos=${row.movimientos} total=${row.total}`);
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
