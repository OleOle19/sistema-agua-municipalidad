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
const IDENTIFICADOR_AMBIGUO = Symbol('identificador_ambiguo');
const ESTADO_CONEXION_ACTIVA = 'CON_CONEXION';
const ESTADO_SERVICIO_ACTIVO = 'ACTIVO';
const DEFAULT_IMPORT_TARIFA_BASE = {
  agua: 7.5,
  desague: 3.5,
  limpieza: 3.5,
  admin: 0.5
};

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

const normalizeImportCode = (value) => String(value || '')
  .replace(/[^A-Z0-9 ]/gi, ' ')
  .trim()
  .toUpperCase()
  .replace(/\s+/g, ' ');

const normalizeImportNameExact = (value) => String(value || '')
  .trim()
  .toUpperCase();

const normalizeImportNameWhitespaceLoose = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/\s+/g, ' ');

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

const pad2 = (value) => String(value).padStart(2, '0');

const buildIsoDate = (anio, mes, dia) => `${anio}-${pad2(mes)}-${pad2(dia)}`;

const roundMonto2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const getPeriodoNum = (anio, mes) => (Number(anio || 0) * 100) + Number(mes || 0);

const buildTarifaKey = ({ agua = 0, desague = 0, limpieza = 0, admin = 0 } = {}) => [
  roundMonto2(agua).toFixed(2),
  roundMonto2(desague).toFixed(2),
  roundMonto2(limpieza).toFixed(2),
  roundMonto2(admin).toFixed(2)
].join('|');

const getCellValueSafe = (row, index) => {
  const cell = row.getCell(index);
  const value = cell?.value;
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string' && value.text.trim()) return value.text;
    if (value.result != null) return value.result;
    if (Array.isArray(value.richText)) {
      return value.richText.map((item) => item?.text || '').join('');
    }
    if (value.hyperlink && value.text) return value.text;
  }
  return value;
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

const parseExcelDateFull = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const anio = value.getUTCFullYear();
    const mes = value.getUTCMonth() + 1;
    const dia = value.getUTCDate();
    return { anio, mes, dia, iso: buildIsoDate(anio, mes, dia) };
  }

  if (typeof value === 'number') {
    const baseUtc = Date.UTC(1899, 11, 30);
    const wholeDays = Math.floor(value);
    if (!Number.isFinite(wholeDays) || wholeDays <= 0) {
      return { anio: null, mes: null, dia: null, iso: null };
    }
    const resultDate = new Date(baseUtc + wholeDays * 24 * 60 * 60 * 1000);
    const anio = resultDate.getUTCFullYear();
    const mes = resultDate.getUTCMonth() + 1;
    const dia = resultDate.getUTCDate();
    return { anio, mes, dia, iso: buildIsoDate(anio, mes, dia) };
  }

  const raw = String(value || '').trim();
  if (!raw) return { anio: null, mes: null, dia: null, iso: null };

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [year, month, day] = raw.slice(0, 10).split('-');
    const anio = Number(year);
    const mes = Number(month);
    const dia = Number(day);
    if (!anio || mes < 1 || mes > 12 || dia < 1 || dia > 31) {
      return { anio: null, mes: null, dia: null, iso: null };
    }
    return { anio, mes, dia, iso: buildIsoDate(anio, mes, dia) };
  }

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const dia = Number(match[1]);
    const mes = Number(match[2]);
    const anio = Number(match[3]);
    if (!anio || mes < 1 || mes > 12 || dia < 1 || dia > 31) {
      return { anio: null, mes: null, dia: null, iso: null };
    }
    return { anio, mes, dia, iso: buildIsoDate(anio, mes, dia) };
  }

  return { anio: null, mes: null, dia: null, iso: null };
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
  const fechaActualIso = buildIsoDate(fechaActual.anio, fechaActual.mes, fechaActual.dia);

  if (!buffer) {
    throw new Error('Buffer no proporcionado');
  }

  const client = await pool.connect();

  ioLogger.log('INICIANDO IMPORTACION DESDE EXCEL...');
  ioLogger.log(`Modo transaccional: ${commitPerBatch ? 'por lote (recomendado para menor bloqueo)' : 'transaccion unica (todo-o-nada)'}`);

  let reciboChunks = [];
  let reciboParams = [];
  let reciboCount = 0;
  let reciboUpdateChunks = [];
  let reciboUpdateParams = [];
  let reciboUpdateCount = 0;

  let pagoChunks = [];
  let pagoParams = [];
  let pagoCount = 0;
  let pagosDeleteIds = new Set();

  let totalProcesados = 0;
  let totalPagos = 0;
  let lineasLeidas = 0;
  let lineasOmitidas = 0;

  const resumenRechazos = {
    duplicado_archivo: 0,
    duplicado_bd: 0,
    formato_invalido: 0,
    contribuyente_no_encontrado: 0,
    contribuyente_ambiguo: 0,
    contribuyente_sin_conexion: 0
  };
  const resumenAjustes = {
    total_desde_abono: 0,
    abono_recortado_a_total: 0,
    abono_futuro_omitido: 0,
    recibos_existentes_reutilizados: 0,
    pagos_sobrescritos: 0,
    predios_resueltos_por_tarifa_previa: 0,
    predios_resueltos_por_periodo_existente: 0,
    predios_resueltos_por_tarifa: 0
  };
  const rechazos = [];
  const resumenOmitidos = {
    fila_vacia: 0,
    sin_total_ni_abono: 0
  };
  const omitidos = [];

  const registrarRechazo = (tipo, data = {}) => {
    if (Object.prototype.hasOwnProperty.call(resumenRechazos, tipo)) {
      resumenRechazos[tipo] += 1;
    }
    lineasOmitidas += 1;
    rechazos.push({
      tipo,
      linea: data.linea || null,
      codigo_municipal: data.codigo_municipal || null,
      anio: data.anio ?? null,
      mes: data.mes ?? null,
      motivo: data.motivo || tipo
    });
  };
  const registrarOmitido = (tipo, data = {}) => {
    if (Object.prototype.hasOwnProperty.call(resumenOmitidos, tipo)) {
      resumenOmitidos[tipo] += 1;
    }
    lineasOmitidas += 1;
    omitidos.push({
      tipo,
      linea: data.linea || null,
      codigo_municipal: data.codigo_municipal || null,
      anio: data.anio ?? null,
      mes: data.mes ?? null,
      motivo: data.motivo || tipo
    });
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
    const mapaPrediosPorCodigo = new Map();
    const mapaPrediosPorNombre = new Map();
    const mapaPrediosPorNombreFlexible = new Map();
    const historialRecibosPorPredio = new Map();
    const pushCandidate = (map, key, candidate) => {
      if (!key) return;
      const arr = map.get(key) || [];
      arr.push(candidate);
      map.set(key, arr);
    };
    const isPredioConConexion = (candidate) => (
      candidate.estado_conexion === ESTADO_CONEXION_ACTIVA
      && candidate.estado_servicio === ESTADO_SERVICIO_ACTIVO
      && candidate.activo_sn === 'S'
    );
    const buildCandidateTarifa = (candidate) => {
      const activo = candidate.activo_sn === 'S';
      const aguaHabilitado = activo && candidate.agua_sn === 'S';
      const desagueHabilitado = activo && candidate.desague_sn === 'S';
      const limpiezaHabilitado = activo && candidate.limpieza_sn === 'S';
      const agua = aguaHabilitado
        ? roundMonto2(
          parseDecimal(candidate.ultima_agua_cobrada)
          || parseDecimal(candidate.tarifa_agua)
          || parseDecimal(candidate.ultima_agua_emitida)
          || DEFAULT_IMPORT_TARIFA_BASE.agua
        )
        : 0;
      const desague = desagueHabilitado
        ? roundMonto2(
          parseDecimal(candidate.ultima_desague_cobrada)
          || parseDecimal(candidate.tarifa_desague)
          || parseDecimal(candidate.ultima_desague_emitida)
          || DEFAULT_IMPORT_TARIFA_BASE.desague
        )
        : 0;
      const limpieza = limpiezaHabilitado
        ? roundMonto2(
          parseDecimal(candidate.ultima_limpieza_cobrada)
          || parseDecimal(candidate.tarifa_limpieza)
          || parseDecimal(candidate.ultima_limpieza_emitida)
          || DEFAULT_IMPORT_TARIFA_BASE.limpieza
        )
        : 0;
      const adminActual = roundMonto2(parseDecimal(candidate.tarifa_admin) + parseDecimal(candidate.tarifa_extra));
      const admin = activo
        ? roundMonto2(
          parseDecimal(candidate.ultima_admin_cobrada)
          || adminActual
          || parseDecimal(candidate.ultima_admin_emitida)
          || DEFAULT_IMPORT_TARIFA_BASE.admin
        )
        : 0;
      return { agua, desague, limpieza, admin };
    };
    const buildReciboTarifa = (item) => ({
      agua: roundMonto2(parseDecimal(item.subtotal_agua)),
      desague: roundMonto2(parseDecimal(item.subtotal_desague)),
      limpieza: roundMonto2(parseDecimal(item.subtotal_limpieza)),
      admin: roundMonto2(parseDecimal(item.subtotal_admin))
    });
    const getHistorialPredio = (idPredio) => historialRecibosPorPredio.get(Number(idPredio || 0)) || [];
    const getTarifaPreviaPredio = (candidate, anio, mes) => {
      const periodoObjetivo = getPeriodoNum(anio, mes);
      const historial = getHistorialPredio(candidate.id_predio)
        .filter((item) => item.periodo_num < periodoObjetivo);
      const pagados = historial.filter((item) => item.total_pagado > EPS);
      const base = pagados.length > 0 ? pagados : historial;
      if (base.length === 0) return null;
      return buildReciboTarifa(base[0]);
    };
    const getTarifaPeriodoPredio = (candidate, anio, mes) => {
      const periodoObjetivo = getPeriodoNum(anio, mes);
      const historial = getHistorialPredio(candidate.id_predio);
      const match = historial.find((item) => item.periodo_num === periodoObjetivo);
      return match ? buildReciboTarifa(match) : null;
    };
    const resolveUniqueByTarifa = (candidatos, tarifaResolver, tarifaBuscada) => {
      const tarifaKey = buildTarifaKey(tarifaBuscada);
      const matches = candidatos.filter((candidate) => {
        const tarifa = tarifaResolver(candidate);
        return tarifa && buildTarifaKey(tarifa) === tarifaKey;
      });
      return matches.length === 1 ? matches[0] : (matches.length > 1 ? IDENTIFICADOR_AMBIGUO : null);
    };
    const resolvePredio = ({ identificadorCodigo, identificadorNombre, identificadorNombreFlexible, tarifaBuscada, anio, mes }) => {
      const candidatosPorCodigo = mapaPrediosPorCodigo.get(identificadorCodigo) || [];
      const candidatosPorNombre = mapaPrediosPorNombre.get(identificadorNombre) || [];
      const candidatosPorNombreFlexible = candidatosPorCodigo.length === 0 && candidatosPorNombre.length === 0
        ? (mapaPrediosPorNombreFlexible.get(identificadorNombreFlexible) || [])
        : [];
      const candidatos = candidatosPorCodigo.length > 0
        ? candidatosPorCodigo
        : (candidatosPorNombre.length > 0 ? candidatosPorNombre : candidatosPorNombreFlexible);
      if (candidatos.length === 0) {
        return {
          error: 'contribuyente_no_encontrado',
          motivo: 'No existe por codigo municipal ni por nombre exacto.'
        };
      }
      if (candidatos.length === 1) {
        return { idPredio: Number(candidatos[0].id_predio || 0) };
      }
      const previos = resolveUniqueByTarifa(
        candidatos,
        (candidate) => getTarifaPreviaPredio(candidate, anio, mes),
        tarifaBuscada
      );
      if (previos && previos !== IDENTIFICADOR_AMBIGUO) {
        resumenAjustes.predios_resueltos_por_tarifa_previa += 1;
        return { idPredio: Number(previos.id_predio || 0) };
      }
      const porPeriodo = resolveUniqueByTarifa(
        candidatos,
        (candidate) => getTarifaPeriodoPredio(candidate, anio, mes),
        tarifaBuscada
      );
      if (porPeriodo && porPeriodo !== IDENTIFICADOR_AMBIGUO) {
        resumenAjustes.predios_resueltos_por_periodo_existente += 1;
        return { idPredio: Number(porPeriodo.id_predio || 0) };
      }
      const activos = candidatos.filter(isPredioConConexion);
      if (activos.length === 0) {
        if (candidatos.length === 1) {
          return { idPredio: Number(candidatos[0].id_predio || 0) };
        }
        return {
          error: 'contribuyente_sin_conexion',
          motivo: 'No hay un unico predio historico para este codigo/nombre sin conexion activa.'
        };
      }
      if (activos.length === 1) {
        return { idPredio: Number(activos[0].id_predio || 0) };
      }
      const matches = activos.filter((candidate) => candidate.tarifa_key === buildTarifaKey(tarifaBuscada));
      if (matches.length === 1) {
        resumenAjustes.predios_resueltos_por_tarifa += 1;
        return { idPredio: Number(matches[0].id_predio || 0) };
      }
      if (matches.length > 1) {
        return {
          error: 'contribuyente_ambiguo',
          motivo: 'Hay varios predios con conexion activa y misma tarifa historica. Usa codigo municipal exacto o corrige manualmente.'
        };
      }
      return {
        error: 'contribuyente_ambiguo',
        motivo: 'Hay varios predios con conexion activa y ninguna tarifa coincide con el ultimo cobro conocido.'
      };
    };
    const resPredios = await client.query(`
      SELECT
        p.id_predio,
        p.id_contribuyente,
        c.codigo_municipal,
        c.nombre_completo,
        COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
        COALESCE(NULLIF(UPPER(TRIM(p.estado_servicio)), ''), CASE WHEN COALESCE(NULLIF(UPPER(TRIM(p.activo_sn)), ''), 'S') = 'S' THEN 'ACTIVO' ELSE 'SIN_CONEXION' END) AS estado_servicio,
        COALESCE(NULLIF(UPPER(TRIM(p.activo_sn)), ''), 'S') AS activo_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_sn,
        p.tarifa_agua,
        p.tarifa_desague,
        p.tarifa_limpieza,
        p.tarifa_admin,
        p.tarifa_extra,
        paid_hist.subtotal_agua AS ultima_agua_cobrada,
        paid_hist.subtotal_desague AS ultima_desague_cobrada,
        paid_hist.subtotal_limpieza AS ultima_limpieza_cobrada,
        paid_hist.subtotal_admin AS ultima_admin_cobrada,
        emit_hist.subtotal_agua AS ultima_agua_emitida,
        emit_hist.subtotal_desague AS ultima_desague_emitida,
        emit_hist.subtotal_limpieza AS ultima_limpieza_emitida,
        emit_hist.subtotal_admin AS ultima_admin_emitida
      FROM predios p
      JOIN contribuyentes c ON p.id_contribuyente = c.id_contribuyente
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(rh.subtotal_agua, 0) AS subtotal_agua,
          COALESCE(rh.subtotal_desague, 0) AS subtotal_desague,
          COALESCE(rh.subtotal_limpieza, 0) AS subtotal_limpieza,
          COALESCE(rh.subtotal_admin, 0) AS subtotal_admin
        FROM pagos pg
        JOIN recibos rh ON rh.id_recibo = pg.id_recibo
        WHERE rh.id_predio = p.id_predio
        ORDER BY pg.fecha_pago DESC, pg.id_pago DESC
        LIMIT 1
      ) paid_hist ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(rh.subtotal_agua, 0) AS subtotal_agua,
          COALESCE(rh.subtotal_desague, 0) AS subtotal_desague,
          COALESCE(rh.subtotal_limpieza, 0) AS subtotal_limpieza,
          COALESCE(rh.subtotal_admin, 0) AS subtotal_admin
        FROM recibos rh
        WHERE rh.id_predio = p.id_predio
          AND (
            COALESCE(rh.subtotal_agua, 0) +
            COALESCE(rh.subtotal_desague, 0) +
            COALESCE(rh.subtotal_limpieza, 0) +
            COALESCE(rh.subtotal_admin, 0)
          ) > 0
        ORDER BY rh.anio DESC, rh.mes DESC, rh.id_recibo DESC
        LIMIT 1
      ) emit_hist ON TRUE
    `);
    resPredios.rows.forEach((r) => {
      const codigoKey = normalizeImportCode(r.codigo_municipal);
      const nombreKey = normalizeImportNameExact(r.nombre_completo);
      const nombreFlexibleKey = normalizeImportNameWhitespaceLoose(r.nombre_completo);
      const candidate = {
        ...r,
        tarifa_ref: buildCandidateTarifa(r)
      };
      candidate.tarifa_key = buildTarifaKey(candidate.tarifa_ref);
      pushCandidate(mapaPrediosPorCodigo, codigoKey, candidate);
      pushCandidate(mapaPrediosPorNombre, nombreKey, candidate);
      pushCandidate(mapaPrediosPorNombreFlexible, nombreFlexibleKey, candidate);
    });
    ioLogger.log(`OK: ${mapaPrediosPorCodigo.size} codigos, ${mapaPrediosPorNombre.size} nombres exactos y ${mapaPrediosPorNombreFlexible.size} nombres por espacios indexados.`);

    ioLogger.log('... Cargando periodos ya existentes para detectar duplicados...');
    const recibosDb = new Map();
    const resRecibos = await client.query(`
      SELECT
        r.id_recibo,
        r.id_predio,
        r.anio,
        r.mes,
        COALESCE(r.subtotal_agua, 0) AS subtotal_agua,
        COALESCE(r.subtotal_desague, 0) AS subtotal_desague,
        COALESCE(r.subtotal_limpieza, 0) AS subtotal_limpieza,
        COALESCE(r.subtotal_admin, 0) AS subtotal_admin,
        COALESCE(r.total_pagar, 0) AS total_pagar,
        COALESCE(r.estado, 'PENDIENTE') AS estado,
        COALESCE(SUM(p.monto_pagado), 0) AS total_pagado,
        COUNT(p.id_pago)::int AS cantidad_pagos
      FROM recibos r
      LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
      GROUP BY r.id_recibo, r.id_predio, r.anio, r.mes, r.subtotal_agua, r.subtotal_desague, r.subtotal_limpieza, r.subtotal_admin, r.total_pagar, r.estado
    `);
    resRecibos.rows.forEach((r) => {
      const key = keyPeriodo(r.id_predio, r.anio, r.mes);
      const prev = recibosDb.get(key);
      const current = {
        id_recibo: Number(r.id_recibo || 0),
        id_predio: Number(r.id_predio || 0),
        anio: Number(r.anio || 0),
        mes: Number(r.mes || 0),
        subtotal_agua: parseDecimal(r.subtotal_agua),
        subtotal_desague: parseDecimal(r.subtotal_desague),
        subtotal_limpieza: parseDecimal(r.subtotal_limpieza),
        subtotal_admin: parseDecimal(r.subtotal_admin),
        total_pagado: parseDecimal(r.total_pagado),
        cantidad_pagos: Number(r.cantidad_pagos || 0),
        periodo_num: getPeriodoNum(r.anio, r.mes),
        multiple: false
      };
      const historial = historialRecibosPorPredio.get(current.id_predio) || [];
      historial.push(current);
      historialRecibosPorPredio.set(current.id_predio, historial);
      if (!prev) {
        recibosDb.set(key, current);
        return;
      }
      prev.multiple = true;
      prev.total_pagado = Math.max(prev.total_pagado, current.total_pagado);
      prev.cantidad_pagos = Math.max(prev.cantidad_pagos, current.cantidad_pagos);
      if (current.id_recibo > prev.id_recibo) {
        prev.id_recibo = current.id_recibo;
      }
    });
    historialRecibosPorPredio.forEach((items, idPredio) => {
      items.sort((a, b) => {
        if (b.periodo_num !== a.periodo_num) return b.periodo_num - a.periodo_num;
        return b.id_recibo - a.id_recibo;
      });
      historialRecibosPorPredio.set(idPredio, items);
    });
    ioLogger.log(`OK: ${recibosDb.size} recibos existentes indexados.`);

    const recibosArchivo = new Set();

    const flushBatch = async () => {
      if (reciboCount === 0 && reciboUpdateCount === 0 && pagoCount === 0 && pagosDeleteIds.size === 0) return;

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

        if (reciboUpdateCount > 0) {
          const valuesRecibosUpdate = reciboUpdateChunks.join(', ');
          const updateRecibos = `
            UPDATE recibos r
            SET
              subtotal_agua = v.subtotal_agua::numeric,
              subtotal_desague = v.subtotal_desague::numeric,
              subtotal_limpieza = v.subtotal_limpieza::numeric,
              subtotal_admin = v.subtotal_admin::numeric,
              total_pagar = v.total_pagar::numeric,
              estado = v.estado
            FROM (
              VALUES ${valuesRecibosUpdate}
            ) AS v (id_recibo, subtotal_agua, subtotal_desague, subtotal_limpieza, subtotal_admin, total_pagar, estado)
            WHERE r.id_recibo = v.id_recibo::int
          `;
          const recibosActualizados = await client.query(updateRecibos, reciboUpdateParams);
          totalProcesados += recibosActualizados.rowCount;
        }

        if (pagosDeleteIds.size > 0) {
          await client.query(
            'DELETE FROM pagos WHERE id_recibo = ANY($1::int[])',
            [[...pagosDeleteIds].map((value) => Number(value))]
          );
        }

        if (pagoCount > 0) {
          const valuesPagos = pagoChunks.join(', ');
          const insertPagos = `
            WITH pagos_batch AS (
              SELECT
                v.id_predio::int AS id_predio,
                v.anio::int AS anio,
                v.mes::int AS mes,
                MAX(v.monto_pagado::numeric) AS monto_pagado,
                MAX(v.fecha_pago::date) AS fecha_pago
              FROM (VALUES ${valuesPagos}) AS v (id_predio, anio, mes, monto_pagado, fecha_pago)
              GROUP BY v.id_predio::int, v.anio::int, v.mes::int
            )
            INSERT INTO pagos (id_recibo, monto_pagado, fecha_pago, usuario_cajero)
            SELECT r.id_recibo, b.monto_pagado, b.fecha_pago, 'IMPORTACION_EXCEL'
            FROM pagos_batch b
            JOIN recibos r ON r.id_predio = b.id_predio AND r.anio = b.anio AND r.mes = b.mes
            WHERE b.monto_pagado > 0
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
        reciboUpdateChunks = [];
        reciboUpdateParams = [];
        reciboUpdateCount = 0;
        pagoChunks = [];
        pagoParams = [];
        pagoCount = 0;
        pagosDeleteIds = new Set();
      }
    };

    if (!commitPerBatch) {
      await client.query('BEGIN');
    }

    // Procesar filas del Excel
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);

      lineasLeidas += 1;
      const lineaActual = lineasLeidas;

      // Mapeo de columnas:
      // A = CONTRIBUYENTE, B = FECHA, C = RECIBO, D = AÑO, E = MES, F = AGUA, G = DESAGUE, H = LIMPIEZA, I = ADMIN, J = EXTRAS, K = ABONO, L = TOTAL
      const fechaCell = getCellValueSafe(row, 2);
      const fechaParsed = parseExcelDateFull(fechaCell);
      const identificadorRaw = String(getCellValueSafe(row, 1) || '').trim();
      const identificadorCodigo = normalizeImportCode(identificadorRaw);
      const identificadorNombre = normalizeImportNameExact(identificadorRaw);
      const identificadorNombreFlexible = normalizeImportNameWhitespaceLoose(identificadorRaw);
      const anioCell = getCellValueSafe(row, 4);
      const mesCell = getCellValueSafe(row, 5);
      let anio = Number(anioCell || 0);
      let mes = Number(mesCell || 0);

      // Si no vienen year/mes explícitos, intentar parsear de la fecha
      if ((!anio || !mes) && fechaCell) {
        if (fechaParsed.anio && fechaParsed.mes) {
          anio = fechaParsed.anio;
          mes = fechaParsed.mes;
        }
      }

      if (!identificadorCodigo && !identificadorNombre) {
        const hasPeriodoHint = Boolean(fechaCell || anioCell || mesCell);
        if (!hasPeriodoHint) {
          registrarOmitido('fila_vacia', {
            linea: lineaActual,
            motivo: 'Fila vacia o sumatoria sin contribuyente ni periodo.'
          });
          continue;
        }
        registrarRechazo('formato_invalido', { linea: lineaActual, motivo: 'Contribuyente vacio' });
        continue;
      }

      if (!Number.isFinite(anio) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
        registrarRechazo('formato_invalido', {
          linea: lineaActual,
          codigo_municipal: identificadorRaw,
          anio: Number.isFinite(anio) ? anio : null,
          mes: Number.isFinite(mes) ? mes : null,
          motivo: 'Anio o mes invalido'
        });
        continue;
      }
      const subtotalAgua = parseDecimal(getCellValueSafe(row, 6));
      const subtotalDesague = parseDecimal(getCellValueSafe(row, 7));
      const subtotalLimpieza = parseDecimal(getCellValueSafe(row, 8));
      const subtotalExtra = parseDecimal(getCellValueSafe(row, 10));
      const subtotalAdmin = roundMonto2(parseDecimal(getCellValueSafe(row, 9)) + subtotalExtra);
      let total = parseDecimal(getCellValueSafe(row, 12));
      let abono = parseDecimal(getCellValueSafe(row, 11));
      const fechaPago = fechaParsed.iso || buildIsoDate(anio, mes, 1);
      const esPagoFuturo = fechaPago > fechaActualIso;
      const tarifaBuscada = {
        agua: subtotalAgua,
        desague: subtotalDesague,
        limpieza: subtotalLimpieza,
        admin: subtotalAdmin
      };

      const predioResuelto = resolvePredio({
        identificadorCodigo,
        identificadorNombre,
        identificadorNombreFlexible,
        tarifaBuscada,
        anio,
        mes
      });
      if (predioResuelto.error) {
        registrarRechazo(predioResuelto.error, {
          linea: lineaActual,
          codigo_municipal: identificadorRaw,
          anio,
          mes,
          motivo: predioResuelto.motivo
        });
        continue;
      }
      const idPredio = Number(predioResuelto.idPredio || 0);
      if (!idPredio) {
        registrarRechazo('contribuyente_no_encontrado', {
          linea: lineaActual,
          codigo_municipal: identificadorRaw,
          anio,
          mes,
          motivo: 'No se pudo resolver predio destino.'
        });
        continue;
      }

      if ([subtotalAgua, subtotalDesague, subtotalLimpieza, subtotalExtra, subtotalAdmin].some((v) => v < 0)) {
        registrarRechazo('formato_invalido', {
          linea: lineaActual,
          codigo_municipal: identificadorRaw,
          anio,
          mes,
          motivo: 'Subtotales negativos no permitidos'
        });
        continue;
      }
      if (esPagoFuturo && abono > 0 && !IMPORT_ALLOW_FUTURE_PAYMENTS) {
        abono = 0;
        resumenAjustes.abono_futuro_omitido += 1;
      }

      if (total <= 0) {
        total = roundMonto2(subtotalAgua + subtotalDesague + subtotalLimpieza + subtotalAdmin);
      }

      if (total <= 0 && abono > 0) {
        total = abono;
        resumenAjustes.total_desde_abono += 1;
      }

      if (total <= 0 && abono <= 0) {
        registrarOmitido('sin_total_ni_abono', {
          linea: lineaActual,
          codigo_municipal: identificadorRaw,
          anio,
          mes,
          motivo: 'No hay total ni abono positivo en la fila.'
        });
        continue;
      }

      if (abono > total + EPS) {
        abono = total;
        resumenAjustes.abono_recortado_a_total += 1;
      }

      const clave = keyPeriodo(idPredio, anio, mes);
      const reciboExistente = recibosDb.get(clave) || null;
      if (recibosArchivo.has(clave)) {
        registrarRechazo('duplicado_archivo', {
          linea: lineaActual,
          codigo_municipal: identificadorRaw,
          anio,
          mes,
          motivo: 'Registro duplicado dentro del archivo'
        });
        continue;
      }
      let estado = 'PENDIENTE';
      if (abono >= total - EPS) estado = 'PAGADO';
      else if (abono > 0) estado = 'PARCIAL';
      if (reciboExistente?.multiple) {
        registrarRechazo('duplicado_bd', {
          linea: lineaActual,
          codigo_municipal: identificadorRaw,
          anio,
          mes,
          motivo: 'Hay multiples recibos existentes para el mismo predio y periodo en la BD.'
        });
        continue;
      }
      if (reciboExistente?.id_recibo) {
        const updateOffset = reciboUpdateCount * 7;
        reciboUpdateChunks.push(`($${updateOffset + 1}, $${updateOffset + 2}, $${updateOffset + 3}, $${updateOffset + 4}, $${updateOffset + 5}, $${updateOffset + 6}, $${updateOffset + 7})`);
        reciboUpdateParams.push(
          reciboExistente.id_recibo,
          subtotalAgua,
          subtotalDesague,
          subtotalLimpieza,
          subtotalAdmin,
          total,
          estado
        );
        reciboUpdateCount += 1;
        resumenAjustes.recibos_existentes_reutilizados += 1;
        if ((reciboExistente.cantidad_pagos || 0) > 0 || (reciboExistente.total_pagado || 0) > EPS) {
          pagosDeleteIds.add(Number(reciboExistente.id_recibo));
          resumenAjustes.pagos_sobrescritos += 1;
        }
      } else {
        reciboParams.push(
          idPredio, anio, mes,
          subtotalAgua, subtotalDesague, subtotalLimpieza, subtotalAdmin,
          total, estado
        );

        const offset = reciboCount * 9;
        reciboChunks.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`);
        reciboCount += 1;
      }

      if (abono > 0) {
        const pagoOffset = pagoCount * 5;
        pagoChunks.push(`($${pagoOffset + 1}, $${pagoOffset + 2}, $${pagoOffset + 3}, $${pagoOffset + 4}, $${pagoOffset + 5})`);
        pagoParams.push(idPredio, anio, mes, abono, fechaPago);
        pagoCount += 1;
      }

      recibosArchivo.add(clave);
      if (!reciboExistente) {
        recibosDb.set(clave, {
          id_recibo: 0,
          id_predio: idPredio,
          anio,
          mes,
          total_pagado: 0,
          cantidad_pagos: 0,
          multiple: false
        });
      }

      if (reciboCount + reciboUpdateCount >= batchSize) {
        await flushBatch();
        ioLogger.progress();
      }
    }

    await flushBatch();

    if (!commitPerBatch) {
      await client.query('COMMIT');
    }

    const totalRechazados = Object.values(resumenRechazos).reduce((acc, n) => acc + n, 0);
    const totalOmitidosSilenciosos = Object.values(resumenOmitidos).reduce((acc, n) => acc + n, 0);
    const resultado = {
      total_recibos_procesados: totalProcesados,
      total_pagos_registrados: totalPagos,
      lineas_leidas: lineasLeidas,
      lineas_omitidas: lineasOmitidas,
      total_omitidos_sin_rechazo: totalOmitidosSilenciosos,
      total_rechazados: totalRechazados,
      resumen_rechazos: resumenRechazos,
      resumen_omitidos: resumenOmitidos,
      resumen_ajustes: resumenAjustes,
      rechazos,
      omitidos,
      rechazos_mostrados: rechazos.length,
      max_rechazos_configurado: maxRechazos
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
