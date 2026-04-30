const fs = require("fs");
const path = require("path");
const pool = require("../db");

const IMPORT_USER = "IMPORTACION_PAGOS_ACTA_TXT";
const EPS = 0.001;

function splitCsv(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function parseMonto(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw.replace(/\s+/g, "").replace(/,/g, "."));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function parsePositiveInt(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function periodKey(anio, mes) {
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}`;
}

function periodNumFromParts(anio, mes) {
  return (Number(anio) * 100) + Number(mes);
}

function periodNumFromText(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;
  return Number(raw.replace("-", ""));
}

function parseArgs(argv) {
  const options = {
    apply: argv.includes("--apply"),
    ignorePeriod: null,
    maxPeriod: null,
    createMissingReceipts: true,
    fileArg: null
  };

  argv.forEach((arg) => {
    if (!arg.startsWith("--") && !options.fileArg) {
      options.fileArg = arg;
      return;
    }
    if (arg.startsWith("--ignore-period=")) {
      const value = String(arg.split("=")[1] || "").trim();
      options.ignorePeriod = value || null;
      return;
    }
    if (arg.startsWith("--max-period=")) {
      const value = String(arg.split("=")[1] || "").trim();
      options.maxPeriod = value || null;
      return;
    }
    if (arg === "--no-create-missing-receipts") {
      options.createMissingReceipts = false;
    }
  });

  return options;
}

function validatePeriodText(value, flagName) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new Error(`${flagName} debe tener formato YYYY-MM. Valor recibido: ${value}`);
  }
  const month = Number(value.slice(5, 7));
  if (month < 1 || month > 12) {
    throw new Error(`${flagName} tiene mes inválido: ${value}`);
  }
  return value;
}

function computeReceiptTotal(row) {
  const totalFromParts = round2(
    row.subtotal_agua +
    row.subtotal_desague +
    row.subtotal_limpieza +
    row.subtotal_admin +
    row.subtotal_extra
  );
  const totalArchivo = round2(row.total_archivo);
  return totalArchivo > 0 ? totalArchivo : totalFromParts;
}

function computeReceiptAdmin(row) {
  return round2(row.subtotal_admin + row.subtotal_extra);
}

function clampPayment(monto, totalRecibo) {
  const bounded = Math.max(0, Math.min(round2(monto), round2(totalRecibo)));
  return round2(bounded);
}

function determineReceiptState(totalPagado, totalRecibo) {
  if (totalPagado >= totalRecibo - EPS) return "PAGADO";
  if (totalPagado > EPS) return "PARCIAL";
  return "PENDIENTE";
}

function pickSample(target, row, extra = {}) {
  if (target.length >= 10) return;
  target.push({ ...row, ...extra });
}

function loadRowsFromTxt(filePath, options = {}) {
  const ignorePeriod = validatePeriodText(options.ignorePeriod || null, "--ignore-period");
  const maxPeriod = validatePeriodText(options.maxPeriod || null, "--max-period");
  const maxPeriodNum = maxPeriod ? periodNumFromText(maxPeriod) : null;
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows = [];

  lines.forEach((line, index) => {
    const parts = splitCsv(line).map((value) => String(value || "").trim());
    if (parts.length < 12) return;

    const codigo = String(parts[0] || "").trim();
    const anio = parsePositiveInt(parts[1]);
    const mes = parsePositiveInt(parts[2]);
    const abono = parseMonto(parts[9]);
    if (!codigo || !anio || mes < 1 || mes > 12 || abono <= 0) return;

    const periodo = periodKey(anio, mes);
    if (ignorePeriod && periodo === ignorePeriod) return;
    if (Number.isFinite(maxPeriodNum) && periodNumFromParts(anio, mes) > maxPeriodNum) return;

    rows.push({
      linea: index + 1,
      codigo_municipal: codigo,
      anio,
      mes,
      periodo,
      subtotal_agua: parseMonto(parts[3]),
      subtotal_desague: parseMonto(parts[4]),
      subtotal_limpieza: parseMonto(parts[5]),
      subtotal_admin: parseMonto(parts[6]),
      subtotal_extra: parseMonto(parts[7]),
      total_archivo: parseMonto(parts[8]),
      abono_archivo: abono,
      recibo_legacy: String(parts[10] || "").trim(),
      pagado_sn: String(parts[11] || "").trim().toUpperCase()
    });
  });

  return rows;
}

async function loadPrediosMap(client) {
  const rs = await client.query(`
    SELECT p.id_predio, c.codigo_municipal
    FROM predios p
    JOIN contribuyentes c ON c.id_contribuyente = p.id_contribuyente
  `);
  const map = new Map();
  rs.rows.forEach((row) => {
    const codigo = String(row.codigo_municipal || "").trim();
    if (codigo && !map.has(codigo)) {
      map.set(codigo, Number(row.id_predio));
    }
  });
  return map;
}

function buildReceiptSnapshot(row) {
  return {
    id_recibo: Number(row.id_recibo),
    id_predio: Number(row.id_predio),
    anio: Number(row.anio),
    mes: Number(row.mes),
    total_pagar: parseMonto(row.total_pagar),
    total_pagado: parseMonto(row.total_pagado),
    has_hidden_user: Boolean(row.has_hidden_user),
    has_target_user: Boolean(row.has_target_user)
  };
}

async function loadRecibosMap(client, targetKeys) {
  const rs = await client.query(`
    SELECT
      r.id_predio,
      r.id_recibo,
      r.anio,
      r.mes,
      r.total_pagar,
      COALESCE(SUM(p.monto_pagado), 0)::numeric AS total_pagado,
      BOOL_OR(COALESCE(NULLIF(TRIM(p.usuario_cajero), ''), '') = 'IMPORTACION_HISTORIAL') AS has_hidden_user,
      BOOL_OR(COALESCE(NULLIF(TRIM(p.usuario_cajero), ''), '') = $1) AS has_target_user
    FROM recibos r
    LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
    GROUP BY r.id_predio, r.id_recibo, r.anio, r.mes, r.total_pagar
  `, [IMPORT_USER]);
  const map = new Map();
  rs.rows.forEach((row) => {
    const key = `${row.id_predio}|${row.anio}|${row.mes}`;
    if (!targetKeys.has(key)) return;
    map.set(key, buildReceiptSnapshot(row));
  });
  return map;
}

async function loadReciboByKey(client, idPredio, anio, mes) {
  const rs = await client.query(`
    SELECT
      r.id_predio,
      r.id_recibo,
      r.anio,
      r.mes,
      r.total_pagar,
      COALESCE(SUM(p.monto_pagado), 0)::numeric AS total_pagado,
      BOOL_OR(COALESCE(NULLIF(TRIM(p.usuario_cajero), ''), '') = 'IMPORTACION_HISTORIAL') AS has_hidden_user,
      BOOL_OR(COALESCE(NULLIF(TRIM(p.usuario_cajero), ''), '') = $4) AS has_target_user
    FROM recibos r
    LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
    WHERE r.id_predio = $1 AND r.anio = $2 AND r.mes = $3
    GROUP BY r.id_predio, r.id_recibo, r.anio, r.mes, r.total_pagar
    LIMIT 1
  `, [idPredio, anio, mes, IMPORT_USER]);
  if (rs.rowCount === 0) return null;
  return buildReceiptSnapshot(rs.rows[0]);
}

async function insertMissingReceipt(client, row, idPredio) {
  const totalPagar = computeReceiptTotal(row);
  const subtotalAdmin = computeReceiptAdmin(row);
  const estado = determineReceiptState(clampPayment(row.abono_archivo, totalPagar), totalPagar);
  const inserted = await client.query(`
    INSERT INTO recibos (
      id_predio, anio, mes, subtotal_agua, subtotal_desague, subtotal_limpieza,
      subtotal_admin, total_pagar, estado, fecha_emision, fecha_vencimiento
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, make_date($2, $3, 1), (make_date($2, $3, 1) + INTERVAL '1 month')::date
    )
    ON CONFLICT DO NOTHING
    RETURNING id_recibo
  `, [
    idPredio,
    row.anio,
    row.mes,
    row.subtotal_agua,
    row.subtotal_desague,
    row.subtotal_limpieza,
    subtotalAdmin,
    totalPagar,
    estado
  ]);
  if (inserted.rowCount > 0) {
    return Number(inserted.rows[0].id_recibo);
  }
  const existing = await loadReciboByKey(client, idPredio, row.anio, row.mes);
  return Number(existing?.id_recibo || 0);
}

async function retagHiddenPayments(client, idRecibo) {
  const result = await client.query(`
    UPDATE pagos
    SET usuario_cajero = $2
    WHERE id_recibo = $1
      AND COALESCE(NULLIF(TRIM(usuario_cajero), ''), '') = 'IMPORTACION_HISTORIAL'
  `, [idRecibo, IMPORT_USER]);
  return Number(result.rowCount || 0);
}

async function insertVisiblePayment(client, idRecibo, monto, fechaPago) {
  await client.query(`
    INSERT INTO pagos (id_recibo, monto_pagado, fecha_pago, usuario_cajero)
    VALUES ($1, $2, ($3::date + TIME '00:00:00'), $4)
  `, [idRecibo, monto, fechaPago, IMPORT_USER]);
}

async function syncReceiptState(client, idRecibo) {
  await client.query(`
    UPDATE recibos r
    SET estado = CASE
      WHEN COALESCE(p.total_pagado, 0) >= COALESCE(r.total_pagar, 0) - 0.001 THEN 'PAGADO'
      WHEN COALESCE(p.total_pagado, 0) > 0.001 THEN 'PARCIAL'
      ELSE 'PENDIENTE'
    END
    FROM (
      SELECT $1::bigint AS id_recibo, COALESCE(SUM(monto_pagado), 0)::numeric AS total_pagado
      FROM pagos
      WHERE id_recibo = $1
      GROUP BY id_recibo
    ) p
    WHERE r.id_recibo = $1
  `, [idRecibo]);
}

function createStats(filePath, options, rows) {
  return {
    archivo: filePath,
    filtro: {
      ignore_period: options.ignorePeriod || null,
      max_period: options.maxPeriod || null
    },
    create_missing_receipts: options.createMissingReceipts,
    filas_validas: rows.length,
    no_mapeado: 0,
    sin_recibo: 0,
    crear_recibo: 0,
    retag_visible: 0,
    insertar_pago: 0,
    ya_visible: 0,
    monto_distinto: 0,
    sin_pago_en_bd: 0,
    monto_recortado: 0,
    muestras: {
      no_mapeado: [],
      sin_recibo: [],
      crear_recibo: [],
      monto_distinto: [],
      sin_pago_en_bd: [],
      monto_recortado: []
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.fileArg) {
    throw new Error("Uso: node server/scripts/importar_pagos_acta_txt.js <ruta-txt> [--apply] [--max-period=YYYY-MM] [--ignore-period=YYYY-MM]");
  }

  options.ignorePeriod = validatePeriodText(options.ignorePeriod, "--ignore-period");
  options.maxPeriod = validatePeriodText(options.maxPeriod, "--max-period");

  const filePath = path.resolve(options.fileArg);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No existe archivo: ${filePath}`);
  }

  const rows = loadRowsFromTxt(filePath, options);
  if (rows.length === 0) {
    throw new Error("Archivo no trae pagos aplicables despues de filtros.");
  }

  const client = await pool.connect();
  try {
    const prediosMap = await loadPrediosMap(client);
    const targetKeys = new Set();
    rows.forEach((row) => {
      const idPredio = prediosMap.get(row.codigo_municipal);
      if (idPredio) targetKeys.add(`${idPredio}|${row.anio}|${row.mes}`);
    });
    const recibosMap = await loadRecibosMap(client, targetKeys);

    const stats = createStats(filePath, options, rows);
    const retagTargets = [];
    const insertTargets = [];
    const createTargets = [];

    rows.forEach((row) => {
      const idPredio = prediosMap.get(row.codigo_municipal);
      if (!idPredio) {
        stats.no_mapeado += 1;
        pickSample(stats.muestras.no_mapeado, row);
        return;
      }

      const key = `${idPredio}|${row.anio}|${row.mes}`;
      const recibo = recibosMap.get(key);
      if (!recibo) {
        if (!options.createMissingReceipts) {
          stats.sin_recibo += 1;
          pickSample(stats.muestras.sin_recibo, row, { id_predio: idPredio });
          return;
        }
        stats.crear_recibo += 1;
        stats.insertar_pago += 1;
        createTargets.push({ row, idPredio });
        pickSample(stats.muestras.crear_recibo, row, {
          id_predio: idPredio,
          total_recibo_objetivo: computeReceiptTotal(row)
        });
        const pagoAInsertar = clampPayment(row.abono_archivo, computeReceiptTotal(row));
        if (Math.abs(pagoAInsertar - row.abono_archivo) > 0.009) {
          stats.monto_recortado += 1;
          pickSample(stats.muestras.monto_recortado, row, {
            motivo: "recibo_nuevo",
            pago_aplicado: pagoAInsertar,
            total_recibo_objetivo: computeReceiptTotal(row)
          });
        }
        return;
      }

      if (recibo.total_pagado <= EPS) {
        stats.sin_pago_en_bd += 1;
        stats.insertar_pago += 1;
        const pagoAInsertar = clampPayment(row.abono_archivo, recibo.total_pagar);
        insertTargets.push({ row, recibo, montoAplicar: pagoAInsertar });
        pickSample(stats.muestras.sin_pago_en_bd, row, {
          id_recibo: recibo.id_recibo,
          total_pagar_bd: recibo.total_pagar,
          pago_aplicar: pagoAInsertar
        });
        if (Math.abs(pagoAInsertar - row.abono_archivo) > 0.009) {
          stats.monto_recortado += 1;
          pickSample(stats.muestras.monto_recortado, row, {
            motivo: "recibo_existente",
            id_recibo: recibo.id_recibo,
            pago_aplicado: pagoAInsertar,
            total_pagar_bd: recibo.total_pagar
          });
        }
        return;
      }

      if (Math.abs(recibo.total_pagado - row.abono_archivo) > 0.009) {
        stats.monto_distinto += 1;
        pickSample(stats.muestras.monto_distinto, row, {
          id_recibo: recibo.id_recibo,
          total_pagado_bd: recibo.total_pagado,
          total_pagar_bd: recibo.total_pagar
        });
      }

      if (recibo.has_hidden_user) {
        retagTargets.push(recibo.id_recibo);
      } else {
        stats.ya_visible += 1;
      }
    });

    const uniqueRetagTargets = Array.from(new Set(retagTargets));
    stats.retag_visible = uniqueRetagTargets.length;

    console.log(JSON.stringify(stats, null, 2));
    if (!options.apply) {
      console.log("Modo reporte. Use --apply para registrar pagos visibles y crear recibos faltantes.");
      return;
    }

    await client.query("BEGIN");
    let pagosActualizados = 0;
    let pagosInsertados = 0;
    let recibosInsertados = 0;

    for (const idRecibo of uniqueRetagTargets) {
      pagosActualizados += await retagHiddenPayments(client, idRecibo);
      await syncReceiptState(client, idRecibo);
    }

    for (const item of createTargets) {
      const idRecibo = await insertMissingReceipt(client, item.row, item.idPredio);
      if (!idRecibo) {
        throw new Error(`No se pudo crear/ubicar recibo para ${item.row.codigo_municipal} ${item.row.periodo}`);
      }
      const reciboActual = await loadReciboByKey(client, item.idPredio, item.row.anio, item.row.mes);
      const totalPagar = parseMonto(reciboActual?.total_pagar || computeReceiptTotal(item.row));
      const pagoAInsertar = clampPayment(item.row.abono_archivo, totalPagar);
      if ((reciboActual?.total_pagado || 0) <= EPS && pagoAInsertar > EPS) {
        await insertVisiblePayment(client, idRecibo, pagoAInsertar, `${item.row.periodo}-01`);
        pagosInsertados += 1;
      }
      await syncReceiptState(client, idRecibo);
      recibosInsertados += 1;
    }

    for (const item of insertTargets) {
      if (item.montoAplicar <= EPS) continue;
      await insertVisiblePayment(client, item.recibo.id_recibo, item.montoAplicar, `${item.row.periodo}-01`);
      await syncReceiptState(client, item.recibo.id_recibo);
      pagosInsertados += 1;
    }

    await client.query("COMMIT");

    console.log(JSON.stringify({
      aplicado: true,
      usuario_cajero_objetivo: IMPORT_USER,
      recibos_creados_o_regularizados: recibosInsertados,
      recibos_retaggeados: uniqueRetagTargets.length,
      pagos_actualizados: pagosActualizados,
      pagos_insertados: pagosInsertados,
      monto_distinto: stats.monto_distinto,
      monto_recortado: stats.monto_recortado,
      sin_pago_en_bd: stats.sin_pago_en_bd,
      sin_recibo: stats.sin_recibo
    }, null, 2));
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Error importando PAGOSACTA:", err.message);
  process.exitCode = 1;
});
