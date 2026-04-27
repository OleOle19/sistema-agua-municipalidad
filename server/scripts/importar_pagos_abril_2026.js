const path = require("path");
const ExcelJS = require("exceljs");
const pool = require("../db");

const SHEET_NAME = "ABRIL";
const EPS = 0.001;
const APPLY = process.argv.includes("--apply");
const IMPORT_USER = "IMPORTACION_ABRIL_2026";
const aliasNameMap = new Map([
  ["ASTONITAS MERA ROSA", "ASTONITAS MEJIA ROSA"],
  ["BARDALESPAJARES IRMA SOLEDAD", "BARDALES PAJARES IRMA SOLEDAD"],
  ["ROJAS SANCHEZ ROMAS", "ROJAS SANCHEZ TOMAS"],
  ["SALZAR COBA ELENA", "SALAZAR COBA ELENA"],
  ["TERRONES PAIRAZAMAN SEGUNDO", "TERRONES PAIRAZAMAN SEGUNDO EDILBERTO"]
]);

function parseMonto(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s+/g, "").replace(/,/g, ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ï¿½|�/g, "N")
    .replace(/[^A-Z0-9 ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeLookupName(value) {
  const normalized = normalizeName(value);
  return aliasNameMap.get(normalized) || normalized;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function serialToIsoDate(serial) {
  const baseUtc = Date.UTC(1899, 11, 30);
  const wholeDays = Math.floor(Number(serial || 0));
  if (!Number.isFinite(wholeDays) || wholeDays <= 0) return "";
  const dt = new Date(baseUtc + (wholeDays * 86400000));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function parseExcelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }
  if (typeof value === "number") return serialToIsoDate(value);
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  if (/^\d{5,6}$/.test(raw)) return serialToIsoDate(Number(raw));
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4,5})$/);
  if (!match) return "";
  const day = Number(match[1]);
  const month = Number(match[2]);
  let yearText = match[3];
  if (yearText.length === 5 && yearText.startsWith("20")) {
    yearText = `${yearText.slice(0, 3)}${yearText.slice(4)}`;
  }
  const year = Number(yearText);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function getCellValue(row, index) {
  const cell = row.getCell(index).value;
  if (cell && typeof cell === "object") {
    if (cell.text) return cell.text;
    if (cell.result != null) return cell.result;
    if (cell.richText) return cell.richText.map((item) => item.text || "").join("");
  }
  return cell;
}

async function loadRowsFromExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) throw new Error(`No existe hoja ${SHEET_NAME} en ${path.basename(filePath)}.`);

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const nombre = String(getCellValue(row, 1) || "").trim();
    const fecha = parseExcelDate(getCellValue(row, 2));
    const reciboLegacy = String(getCellValue(row, 3) || "").trim();
    const anio = Number(getCellValue(row, 4) || 0);
    const mes = Number(getCellValue(row, 5) || 0);
    const agua = parseMonto(getCellValue(row, 6));
    const desague = parseMonto(getCellValue(row, 7));
    const limpieza = parseMonto(getCellValue(row, 8));
    const admin = parseMonto(getCellValue(row, 9));
    const extras = parseMonto(getCellValue(row, 10));
    const abono = parseMonto(getCellValue(row, 11));
    const totalHoja = parseMonto(getCellValue(row, 12)) || Number((agua + desague + limpieza + admin + extras).toFixed(2));
    if (!nombre || !fecha || !anio || mes < 1 || mes > 12 || abono <= 0) return;
    if (fecha !== "2026-04-01" && fecha !== "2026-04-06") return;
    rows.push({
      row_number: rowNumber,
      nombre,
      nombre_norm: normalizeLookupName(nombre),
      fecha,
      recibo_legacy: reciboLegacy,
      anio,
      mes,
      agua,
      desague,
      limpieza,
      admin,
      extras,
      abono,
      total_hoja: totalHoja
    });
  });
  return rows;
}

async function loadReceiptCandidates(client, rows) {
  const periodMap = new Map();
  for (const row of rows) {
    periodMap.set(`${row.anio}-${row.mes}`, { anio: row.anio, mes: row.mes });
  }
  const periods = Array.from(periodMap.values());
  const params = [];
  const tuples = periods.map((p, index) => {
    params.push(p.anio, p.mes);
    const offset = index * 2;
    return `($${offset + 1}::int, $${offset + 2}::int)`;
  }).join(", ");

  const rs = await client.query(`
    SELECT
      c.id_contribuyente,
      c.nombre_completo,
      r.id_recibo,
      r.anio,
      r.mes,
      r.total_pagar,
      r.subtotal_agua,
      r.subtotal_desague,
      r.subtotal_limpieza,
      r.subtotal_admin,
      COALESCE(SUM(p.monto_pagado), 0)::numeric AS total_pagado,
      MIN(p.fecha_pago) AS min_fecha,
      MAX(p.fecha_pago) AS max_fecha,
      COUNT(p.id_pago)::int AS pago_count
    FROM recibos r
    JOIN predios pr ON pr.id_predio = r.id_predio
    JOIN contribuyentes c ON c.id_contribuyente = pr.id_contribuyente
    LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
    WHERE (r.anio, r.mes) IN (${tuples})
    GROUP BY
      c.id_contribuyente,
      c.nombre_completo,
      r.id_recibo,
      r.anio,
      r.mes,
      r.total_pagar,
      r.subtotal_agua,
      r.subtotal_desague,
      r.subtotal_limpieza,
      r.subtotal_admin
  `, params);

  return rs.rows.map((row) => ({
    ...row,
    nombre_norm: normalizeLookupName(row.nombre_completo),
    total_pagar_num: parseMonto(row.total_pagar),
    total_pagado_num: parseMonto(row.total_pagado)
  }));
}

function chooseCandidate(row, candidates) {
  const sameName = candidates.filter((candidate) => candidate.nombre_norm === row.nombre_norm);
  if (sameName.length === 0) return null;
  if (sameName.length === 1) return sameName[0];

  const exactPaidAmount = sameName.filter((candidate) => Math.abs(candidate.total_pagado_num - row.abono) <= EPS);
  if (exactPaidAmount.length === 1) return exactPaidAmount[0];

  const exactTotalAmount = sameName.filter((candidate) => Math.abs(candidate.total_pagar_num - row.abono) <= EPS);
  if (exactTotalAmount.length === 1) return exactTotalAmount[0];

  const paidOnes = sameName.filter((candidate) => candidate.total_pagado_num > EPS);
  if (paidOnes.length === 1) return paidOnes[0];

  return sameName[0];
}

function classifyRow(row, match) {
  if (!match) {
    return { status: "unresolved", reason: "sin_recibo_actual" };
  }
  if (match.total_pagado_num > EPS) {
    if (Math.abs(match.total_pagado_num - row.abono) > EPS) {
      return {
        status: "unresolved",
        reason: "pago_existente_monto_distinto",
        match
      };
    }
    return { status: "replace", reason: "mover_fecha_importada", match };
  }
  if (row.abono > match.total_pagar_num + EPS) {
    return {
      status: "unresolved",
      reason: "abono_supera_total_actual",
      match
    };
  }
  return { status: "insert", reason: "registrar_pago_faltante", match };
}

function toIsoDateOnly(value) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

async function refreshReciboEstado(client, idRecibo) {
  await client.query(`
    WITH total_pago AS (
      SELECT COALESCE(SUM(monto_pagado), 0)::numeric AS total_pagado
      FROM pagos
      WHERE id_recibo = $1
    )
    UPDATE recibos r
    SET estado = CASE
      WHEN tp.total_pagado >= r.total_pagar - $2 THEN 'PAGADO'
      WHEN tp.total_pagado > 0 THEN 'PARCIAL'
      ELSE 'PENDIENTE'
    END
    FROM total_pago tp
    WHERE r.id_recibo = $1
  `, [Number(idRecibo), EPS]);
}

async function applyChange(client, item) {
  const { row, match, status } = item;
  if (status === "replace") {
    const pagosRs = await client.query(`
      SELECT id_pago, monto_pagado, fecha_pago
      FROM pagos
      WHERE id_recibo = $1
      ORDER BY id_pago
    `, [Number(match.id_recibo)]);
    if (pagosRs.rows.length === 0) {
      throw new Error(`Recibo ${match.id_recibo} sin pagos para reemplazar.`);
    }
    const totalPagado = Number(
      pagosRs.rows.reduce((acc, pago) => acc + parseMonto(pago.monto_pagado), 0).toFixed(2)
    );
    if (Math.abs(totalPagado - row.abono) > EPS) {
      throw new Error(`Recibo ${match.id_recibo} tiene total pagado ${totalPagado} y no coincide con ${row.abono}.`);
    }
    const fechaImportada = `${row.anio}-${pad2(row.mes)}-01`;
    const fechasInvalidas = pagosRs.rows.filter((pago) => toIsoDateOnly(pago.fecha_pago) !== fechaImportada);
    if (fechasInvalidas.length > 0) {
      throw new Error(`Recibo ${match.id_recibo} ya no conserva fecha importada ${fechaImportada}.`);
    }
    const idsPago = pagosRs.rows.map((pago) => Number(pago.id_pago));
    await client.query(`
      UPDATE pagos
      SET
        fecha_pago = ($2::date + COALESCE(fecha_pago::time, TIME '00:00:00')),
        usuario_cajero = $3
      WHERE id_pago = ANY($1::bigint[])
    `, [idsPago, row.fecha, IMPORT_USER]);
    await refreshReciboEstado(client, match.id_recibo);
    return { action: "replace", pagos: idsPago.length };
  }

  if (status === "insert") {
    await client.query(`
      INSERT INTO pagos (id_recibo, monto_pagado, fecha_pago, usuario_cajero)
      VALUES ($1, $2, ($3::date + TIME '00:00:00'), $4)
    `, [Number(match.id_recibo), row.abono, row.fecha, IMPORT_USER]);
    await refreshReciboEstado(client, match.id_recibo);
    return { action: "insert", pagos: 1 };
  }

  return { action: "skip", pagos: 0 };
}

async function main() {
  const inputArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!inputArg) {
    throw new Error("Uso: node scripts/importar_pagos_abril_2026.js <ruta-xlsx> [--apply]");
  }

  const excelPath = path.resolve(process.cwd(), inputArg);
  const rows = await loadRowsFromExcel(excelPath);
  if (rows.length === 0) {
    throw new Error(`No se encontraron pagos validos en hoja ${SHEET_NAME}.`);
  }

  const client = await pool.connect();
  try {
    const candidates = await loadReceiptCandidates(client, rows);
    const byPeriod = new Map();
    for (const candidate of candidates) {
      const key = `${candidate.anio}-${candidate.mes}`;
      if (!byPeriod.has(key)) byPeriod.set(key, []);
      byPeriod.get(key).push(candidate);
    }

    const resolved = rows.map((row) => {
      const periodKey = `${row.anio}-${row.mes}`;
      const periodCandidates = byPeriod.get(periodKey) || [];
      const match = chooseCandidate(row, periodCandidates);
      return { row, ...classifyRow(row, match) };
    });

    const replaceItems = resolved.filter((item) => item.status === "replace");
    const insertItems = resolved.filter((item) => item.status === "insert");
    const unresolved = resolved.filter((item) => item.status === "unresolved");

    console.log(JSON.stringify({
      archivo: excelPath,
      hoja: SHEET_NAME,
      total_filas_validas: rows.length,
      reemplazos: replaceItems.length,
      inserciones: insertItems.length,
      pendientes_revision: unresolved.length,
      pendientes: unresolved.map((item) => ({
        fila: item.row.row_number,
        nombre: item.row.nombre,
        anio: item.row.anio,
        mes: item.row.mes,
        fecha: item.row.fecha,
        abono: item.row.abono,
        total_hoja: item.row.total_hoja,
        reason: item.reason,
        id_recibo: item.match ? Number(item.match.id_recibo) : null,
        total_actual: item.match ? item.match.total_pagar_num : null,
        total_pagado_actual: item.match ? item.match.total_pagado_num : null
      }))
    }, null, 2));

    if (!APPLY) {
      console.log("Modo reporte. Use --apply para registrar cambios.");
      return;
    }

    await client.query("BEGIN");
    let replaced = 0;
    let inserted = 0;
    for (const item of [...replaceItems, ...insertItems]) {
      const result = await applyChange(client, item);
      if (result.action === "replace") replaced += 1;
      if (result.action === "insert") inserted += 1;
    }
    await client.query("COMMIT");

    console.log(JSON.stringify({
      aplicado: true,
      usuario_cajero: IMPORT_USER,
      reemplazos_aplicados: replaced,
      inserciones_aplicadas: inserted,
      pendientes_revision: unresolved.length
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
  console.error("Error importando pagos abril 2026:", err.message);
  process.exitCode = 1;
});
