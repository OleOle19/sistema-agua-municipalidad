const ExcelJS = require('exceljs');
const path = require('path');
const readline = require('readline');
const { Readable } = require('stream');
const pool = require('./db');

const DEFAULT_BATCH_SIZE = 2000;
const DEFAULT_MAX_RECHAZOS = 500;
const EPS = 0.001;
const DEFAULT_COMMIT_PER_BATCH = process.env.IMPORT_COMMIT_PER_BATCH !== '0';
const IMPORT_TIMEZONE = process.env.IMPORT_TIMEZONE || process.env.AUTO_DEUDA_TIMEZONE || 'America/Lima';
const IMPORT_ALLOW_FUTURE_PAYMENTS = process.env.IMPORT_ALLOW_FUTURE_PAYMENTS === '1';

const getFechaPartesZona = (date = new Date(), timeZone = IMPORT_TIMEZONE) => {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = dtf.formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    anio: Number(map.year),
    mes: Number(map.month),
    dia: Number(map.day)
  };
};

const getLogger = (logger) => ({
  log: (msg) => (logger && typeof logger.log === 'function' ? logger.log(msg) : console.log(msg)),
  error: (msg, err) => {
    if (logger && typeof logger.error === 'function') return logger.error(msg, err);
    console.error(msg, err);
  },
  progress: () => {
    if (logger && typeof logger.progress === 'function') return logger.progress();
    process.stdout.write('.');
  }
});

const keyPeriodo = (idPredio, anio, mes) => `${idPredio}|${anio}|${mes}`;

const parseDecimal = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const compact = raw.replace(/\s+/g, '');
  let normalized = compact;
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');
  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(/,/g, '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = normalized.replace(/,/g, '.');
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseExcelDate = (value) => {
  // Si es un objeto Date
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = value.getUTCMonth() + 1;
    return { anio: year, mes: month };
  }

  // Si es un número (serial date)
  if (typeof value === 'number') {
    const baseDate = new Date(1899, 11, 30);
    const resultDate = new Date(baseDate.getTime() + value * 24 * 60 * 60 * 1000);
    return { anio: resultDate.getFullYear(), mes: resultDate.getMonth() + 1 };
  }

  // Si es string
  const raw = String(value || '').trim();
  if (!raw) return { anio: null, mes: null };

  // Formato YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [year, month] = raw.split('-').slice(0, 2);
    return { anio: Number(year), mes: Number(month) };
  }

  // Formato DD/MM/YYYY
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    return { anio: year, mes: month };
  }

  return { anio: null, mes: null };
};

async function importarDestritoExcel(options = {}) {
  const buffer = options.buffer;
  const batchSize = Number.isFinite(options.batchSize) && options.batchSize > 0
    ? Math.floor(options.batchSize)
    : DEFAULT_BATCH_SIZE;
  const maxRechazos = Number.isFinite(options.maxRechazos) && options.maxRechazos > 0
    ? Math.floor(options.maxRechazos)
    : DEFAULT_MAX_RECHAZOS;
  const commitPerBatch = typeof options.commitPerBatch === 'boolean'
    ? options.commitPerBatch
    : DEFAULT_COMMIT_PER_BATCH;
  const ioLogger = getLogger(options.logger);
  const fechaActual = getFechaPartesZona(new Date(), IMPORT_TIMEZONE);

  if (!buffer) {
    throw new Error('Buffer no proporcionado');
  }

  const client = await pool.connect();

  ioLogger.log('INICIANDO IMPORTACION DESDE EXCEL...');
  ioLogger.log(`Modo transaccional: ${commitPerBatch ? 'por lote (recomendado para menor bloqueo)' : 'transaccion unica (todo-o-nada)'}`);

  let reciboChunks = [];
  let reciboParams = [];
  let reciboCount = 0;

  let pagoChunks = [];
  let pagoParams = [];
  let pagoCount = 0;

  let totalProcesados = 0;
  let totalPagos = 0;
  let lineasLeidas = 0;
  let lineasOmitidas = 0;

  const resumenRechazos = {
    duplicado_archivo: 0,
    duplicado_bd: 0,
    formato_invalido: 0,
    contribuyente_no_encontrado: 0
  };
  const resumenAjustes = {
    total_desde_abono: 0,
    abono_recortado_a_total: 0,
    abono_futuro_omitido: 0
  };
  const rechazos = [];

  const registrarRechazo = (tipo, data = {}) => {
    if (Object.prototype.hasOwnProperty.call(resumenRechazos, tipo)) {
      resumenRechazos[tipo] += 1;
    }
    lineasOmitidas += 1;
    if (rechazos.length < maxRechazos) {
      rechazos.push({
        tipo,
        linea: data.linea || null,
        codigo_municipal: data.codigo_municipal || null,
        anio: data.anio ?? null,
        mes: data.mes ?? null,
        motivo: data.motivo || tipo
      });
    }
  };

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    // Buscar hoja con nombre común
    let worksheet = workbook.getWorksheet('ABRIL') || workbook.getWorksheet('abril')
      || workbook.getWorksheet('HISTORIAL') || workbook.getWorksheet('historial')
      || workbook.worksheets[0];

    if (!worksheet) {
      throw new Error('No se encontró hoja de trabajo válida en el Excel');
    }

    ioLogger.log('... Cargando contribuyentes...');
    const mapaPredios = new Map();
    const resPredios = await client.query(`
      SELECT p.id_predio, c.codigo_municipal
      FROM predios p
      JOIN contribuyentes c ON p.id_contribuyente = c.id_contribuyente
    `);
    resPredios.rows.forEach((r) => mapaPredios.set(String(r.codigo_municipal || '').trim().toUpperCase(), r.id_predio));
    ioLogger.log(`OK: ${mapaPredios.size} usuarios encontrados.`);

    ioLogger.log('... Cargando periodos ya existentes para detectar duplicados...');
    const recibosDb = new Set();
    const resRecibos = await client.query(`
      SELECT id_predio, anio, mes
      FROM recibos
    `);
    resRecibos.rows.forEach((r) => recibosDb.add(keyPeriodo(r.id_predio, r.anio, r.mes)));
    ioLogger.log(`OK: ${recibosDb.size} recibos existentes indexados.`);

    const recibosArchivo = new Set();

    const flushBatch = async () => {
      if (reciboCount === 0 && pagoCount === 0) return;

      try {
        if (commitPerBatch) {
          await client.query('BEGIN');
        }

        if (reciboCount > 0) {
          const valuesRecibos = reciboChunks.join(', ');
          const valuesSql = `
            (VALUES ${valuesRecibos})
            AS v (id_predio, anio, mes, subtotal_agua, subtotal_desague, subtotal_limpieza, subtotal_admin, total_pagar, estado)
          `;

          const insertRecibos = `
            INSERT INTO recibos (
              id_predio, anio, mes, subtotal_agua, subtotal_desague, subtotal_limpieza,
              subtotal_admin, total_pagar, estado, fecha_emision, fecha_vencimiento
            )
            SELECT v.id_predio::int, v.anio::int, v.mes::int, v.subtotal_agua::numeric, v.subtotal_desague::numeric, v.subtotal_limpieza::numeric,
                  v.subtotal_admin::numeric, v.total_pagar::numeric, v.estado,
                  make_date(v.anio::int, v.mes::int, 1),
                  (make_date(v.anio::int, v.mes::int, 1) + INTERVAL '1 month')::date
            FROM ${valuesSql}
            ON CONFLICT DO NOTHING
          `;

          const recibosInsertados = await client.query(insertRecibos, reciboParams);
          totalProcesados += recibosInsertados.rowCount;
        }

        if (pagoCount > 0) {
          const valuesPagos = pagoChunks.join(', ');
          const insertPagos = `
            WITH pagos_batch AS (
              SELECT
                v.id_predio::int AS id_predio,
                v.anio::int AS anio,
                v.mes::int AS mes,
                MAX(v.monto_pagado::numeric) AS monto_pagado
              FROM (VALUES ${valuesPagos}) AS v (id_predio, anio, mes, monto_pagado)
              GROUP BY v.id_predio::int, v.anio::int, v.mes::int
            )
            INSERT INTO pagos (id_recibo, monto_pagado, fecha_pago, usuario_cajero)
            SELECT r.id_recibo, b.monto_pagado, make_date(b.anio, b.mes, 1), 'IMPORTACION_EXCEL'
            FROM pagos_batch b
            JOIN recibos r ON r.id_predio = b.id_predio AND r.anio = b.anio AND r.mes = b.mes
            LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
            WHERE b.monto_pagado > 0
              AND p.id_recibo IS NULL
          `;
          const pagosInsertados = await client.query(insertPagos, pagoParams);
          totalPagos += pagosInsertados.rowCount;
        }

        if (commitPerBatch) {
          await client.query('COMMIT');
        }
      } catch (batchErr) {
        if (commitPerBatch) {
          try { await client.query('ROLLBACK'); } catch {}
        }
        throw batchErr;
      } finally {
        reciboChunks = [];
        reciboParams = [];
        reciboCount = 0;
        pagoChunks = [];
        pagoParams = [];
        pagoCount = 0;
      }
    };

    if (!commitPerBatch) {
      await client.query('BEGIN');
    }

    // Procesar filas del Excel
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Omitir encabezado

      lineasLeidas += 1;
      const lineaActual = lineasLeidas;

      // Mapeo de columnas:
      // A = CONTRIBUYENTE, B = FECHA, C = RECIBO, D = AÑO, E = MES, F = AGUA, G = DESAGUE, H = LIMPIEZA, I = ADMIN, J = EXTRAS, K = ABONO, L = TOTAL
      const codigoUser = String(row.getCell(1).value || '').trim().toUpperCase();
      let anio = Number(row.getCell(4).value || 0);
      let mes = Number(row.getCell(5).value || 0);

      // Si no vienen year/mes explícitos, intentar parsear de la fecha
      if ((!anio || !mes) && row.getCell(2).value) {
        const fechaParsed = parseExcelDate(row.getCell(2).value);
        if (fechaParsed.anio && fechaParsed.mes) {
          anio = fechaParsed.anio;
          mes = fechaParsed.mes;
        }
      }

      if (!codigoUser) {
        registrarRechazo('formato_invalido', { linea: lineaActual, motivo: 'Contribuyente vacío' });
        return;
      }

      const idPredio = mapaPredios.get(codigoUser);
      if (!idPredio) {
        registrarRechazo('contribuyente_no_encontrado', {
          linea: lineaActual,
          codigo_municipal: codigoUser,
          motivo: 'Codigo municipal no existe en la BD'
        });
        return;
      }

      if (!Number.isFinite(anio) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
        registrarRechazo('formato_invalido', {
          linea: lineaActual,
          codigo_municipal: codigoUser,
          anio: Number.isFinite(anio) ? anio : null,
          mes: Number.isFinite(mes) ? mes : null,
          motivo: 'Año o mes inválido'
        });
        return;
      }

      const subtotalAgua = parseDecimal(row.getCell(6).value);
      const subtotalDesague = parseDecimal(row.getCell(7).value);
      const subtotalLimpieza = parseDecimal(row.getCell(8).value);
      const subtotalAdmin = parseDecimal(row.getCell(9).value);
      let total = parseDecimal(row.getCell(12).value);
      let abono = parseDecimal(row.getCell(11).value);
      const esPeriodoFuturo = anio > fechaActual.anio || (anio === fechaActual.anio && mes > fechaActual.mes);

      if ([subtotalAgua, subtotalDesague, subtotalLimpieza, subtotalAdmin].some((v) => v < 0)) {
        registrarRechazo('formato_invalido', {
          linea: lineaActual,
          codigo_municipal: codigoUser,
          anio,
          mes,
          motivo: 'Subtotales negativos no permitidos'
        });
        return;
      }

      if (esPeriodoFuturo && abono > 0 && !IMPORT_ALLOW_FUTURE_PAYMENTS) {
        abono = 0;
        resumenAjustes.abono_futuro_omitido += 1;
      }

      if (total <= 0 && abono > 0) {
        total = abono;
        resumenAjustes.total_desde_abono += 1;
      }

      if (total <= 0 && abono <= 0) {
        lineasOmitidas += 1;
        return;
      }

      if (abono > total + EPS) {
        abono = total;
        resumenAjustes.abono_recortado_a_total += 1;
      }

      const clave = keyPeriodo(idPredio, anio, mes);
      if (recibosArchivo.has(clave)) {
        registrarRechazo('duplicado_archivo', {
          linea: lineaActual,
          codigo_municipal: codigoUser,
          anio,
          mes,
          motivo: 'Registro duplicado dentro del archivo'
        });
        return;
      }

      if (recibosDb.has(clave)) {
        registrarRechazo('duplicado_bd', {
          linea: lineaActual,
          codigo_municipal: codigoUser,
          anio,
          mes,
          motivo: 'Registro ya existe en la base de datos'
        });
        return;
      }

      let estado = 'PENDIENTE';
      if (abono >= total - EPS) estado = 'PAGADO';
      else if (abono > 0) estado = 'PARCIAL';

      reciboParams.push(
        idPredio, anio, mes,
        subtotalAgua, subtotalDesague, subtotalLimpieza, subtotalAdmin,
        total, estado
      );

      const offset = reciboCount * 9;
      reciboChunks.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`);
      reciboCount += 1;

      if (abono > 0) {
        const pagoOffset = pagoCount * 4;
        pagoChunks.push(`($${pagoOffset + 1}, $${pagoOffset + 2}, $${pagoOffset + 3}, $${pagoOffset + 4})`);
        pagoParams.push(idPredio, anio, mes, abono);
        pagoCount += 1;
      }

      recibosArchivo.add(clave);
      recibosDb.add(clave);

      if (reciboCount >= batchSize) {
        flushBatch();
        ioLogger.progress();
      }
    });

    flushBatch();

    if (!commitPerBatch) {
      await client.query('COMMIT');
    }

    const totalRechazados = Object.values(resumenRechazos).reduce((acc, n) => acc + n, 0);
    const resultado = {
      total_recibos_procesados: totalProcesados,
      total_pagos_registrados: totalPagos,
      lineas_leidas: lineasLeidas,
      lineas_omitidas: lineasOmitidas,
      total_rechazados: totalRechazados,
      resumen_rechazos: resumenRechazos,
      resumen_ajustes: resumenAjustes,
      rechazos,
      rechazos_mostrados: rechazos.length
    };

    ioLogger.log('\n==========================================');
    ioLogger.log('IMPORTACION DESDE EXCEL COMPLETADA CON EXITO');
    ioLogger.log(`Total Recibos Procesados: ${resultado.total_recibos_procesados}`);
    ioLogger.log(`Total Pagos Registrados: ${resultado.total_pagos_registrados}`);
    ioLogger.log(`Lineas Leidas: ${resultado.lineas_leidas}`);
    ioLogger.log(`Lineas Omitidas: ${resultado.lineas_omitidas}`);
    ioLogger.log(`Total Rechazados: ${resultado.total_rechazados}`);
    ioLogger.log('==========================================');

    return resultado;
  } catch (err) {
    if (!commitPerBatch) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    ioLogger.error('ERROR EN IMPORTACION EXCEL:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { importarDestritoExcel };
