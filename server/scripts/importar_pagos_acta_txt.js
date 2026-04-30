const fs = require("fs");
const path = require("path");
const pool = require("../db");

const APPLY = process.argv.includes("--apply");
const IMPORT_USER = "IMPORTACION_PAGOS_ACTA_TXT";
const DEFAULT_IGNORE_PERIOD = "2026-04";
const DEFAULT_MAX_PERIOD = "2026-03";
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

function periodKey(anio, mes) {
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}`;
}

function periodNum(anio, mes) {
  return (Number(anio) * 100) + Number(mes);
}

function loadRowsFromTxt(filePath, options = {}) {
  const ignorePeriod = String(options.ignorePeriod || DEFAULT_IGNORE_PERIOD).trim();
  const maxPeriod = String(options.maxPeriod || DEFAULT_MAX_PERIOD).trim();
  const maxPeriodNum = Number(maxPeriod.replace("-", ""));
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
    if (periodo === ignorePeriod) return;
    if (Number.isFinite(maxPeriodNum) && periodNum(anio, mes) > maxPeriodNum) return;

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
    map.set(key, {
      id_recibo: Number(row.id_recibo),
      id_predio: Number(row.id_predio),
      anio: Number(row.anio),
      mes: Number(row.mes),
      total_pagar: parseMonto(row.total_pagar),
      total_pagado: parseMonto(row.total_pagado),
      has_hidden_user: Boolean(row.has_hidden_user),
      has_target_user: Boolean(row.has_target_user)
    });
  });
  return map;
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

async function insertVisiblePayment(client, row, idRecibo) {
  const fecha = `${row.anio}-${String(row.mes).padStart(2, "0")}-01`;
  await client.query(`
    INSERT INTO pagos (id_recibo, monto_pagado, fecha_pago, usuario_cajero)
    VALUES ($1, $2, ($3::date + TIME '00:00:00'), $4)
  `, [idRecibo, row.abono_archivo, fecha, IMPORT_USER]);
}

async function main() {
  const fileArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!fileArg) {
    throw new Error("Uso: node server/scripts/importar_pagos_acta_txt.js <ruta-txt> [--apply]");
  }

  const filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No existe archivo: ${filePath}`);
  }

  const rows = loadRowsFromTxt(filePath, {
    ignorePeriod: DEFAULT_IGNORE_PERIOD,
    maxPeriod: DEFAULT_MAX_PERIOD
  });
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

    const stats = {
      archivo: filePath,
      filtro: {
        ignore_period: DEFAULT_IGNORE_PERIOD,
        max_period: DEFAULT_MAX_PERIOD
      },
      filas_validas: rows.length,
      no_mapeado: 0,
      sin_recibo: 0,
      retag_visible: 0,
      insertar_pago: 0,
      ya_visible: 0,
      monto_distinto: 0,
      sin_pago_en_bd: 0,
      muestras: {
        no_mapeado: [],
        sin_recibo: [],
        monto_distinto: [],
        sin_pago_en_bd: []
      }
    };

    const retagTargets = [];
    const insertTargets = [];

    rows.forEach((row) => {
      const idPredio = prediosMap.get(row.codigo_municipal);
      if (!idPredio) {
        stats.no_mapeado += 1;
        if (stats.muestras.no_mapeado.length < 10) stats.muestras.no_mapeado.push(row);
        return;
      }

      const recibo = recibosMap.get(`${idPredio}|${row.anio}|${row.mes}`);
      if (!recibo) {
        stats.sin_recibo += 1;
        if (stats.muestras.sin_recibo.length < 10) {
          stats.muestras.sin_recibo.push({ ...row, id_predio: idPredio });
        }
        return;
      }

      if (recibo.total_pagado <= EPS) {
        stats.sin_pago_en_bd += 1;
        if (row.abono_archivo <= recibo.total_pagar + EPS) {
          insertTargets.push({ row, recibo });
          stats.insertar_pago += 1;
        }
        if (stats.muestras.sin_pago_en_bd.length < 10) {
          stats.muestras.sin_pago_en_bd.push({
            ...row,
            id_recibo: recibo.id_recibo,
            total_pagar_bd: recibo.total_pagar
          });
        }
        return;
      }

      if (Math.abs(recibo.total_pagado - row.abono_archivo) > 0.009) {
        stats.monto_distinto += 1;
        if (stats.muestras.monto_distinto.length < 10) {
          stats.muestras.monto_distinto.push({
            ...row,
            id_recibo: recibo.id_recibo,
            total_pagado_bd: recibo.total_pagado,
            total_pagar_bd: recibo.total_pagar
          });
        }
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
    if (!APPLY) {
      console.log("Modo reporte. Use --apply para actualizar usuario_cajero visible.");
      return;
    }

    await client.query("BEGIN");
    let pagosActualizados = 0;
    let pagosInsertados = 0;
    for (const idRecibo of uniqueRetagTargets) {
      pagosActualizados += await retagHiddenPayments(client, idRecibo);
    }
    for (const item of insertTargets) {
      await insertVisiblePayment(client, item.row, item.recibo.id_recibo);
      pagosInsertados += 1;
    }
    await client.query("COMMIT");

    console.log(JSON.stringify({
      aplicado: true,
      usuario_cajero_objetivo: IMPORT_USER,
      recibos_retaggeados: uniqueRetagTargets.length,
      pagos_actualizados: pagosActualizados,
      pagos_insertados: pagosInsertados,
      monto_distinto: stats.monto_distinto,
      sin_pago_en_bd: stats.sin_pago_en_bd
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
