export const MAX_RETROACTIVE_COBRO_DAYS_CAJA = 3;

const parseMonto = (value) => {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round2 = (value) => Math.round((parseMonto(value) + Number.EPSILON) * 100) / 100;

export const normalizeRole = (role) => {
  const raw = String(role || "").trim().toUpperCase();
  if (["ADMIN", "SUPERADMIN", "ADMIN_PRINCIPAL", "NIVEL_1"].includes(raw)) return "ADMIN";
  if (["ADMIN_AUX", "ADMINISTRADOR_SECUNDARIO", "SUBADMIN"].includes(raw)) return "ADMIN_AUX";
  if (["ADMIN_SEC", "ADMIN_SECUNDARIO", "JEFE_CAJA", "NIVEL_2"].includes(raw)) return "ADMIN_SEC";
  if (["CAJERO", "OPERADOR_CAJA", "OPERADOR", "NIVEL_3"].includes(raw)) return "CAJERO";
  if (["BRIGADA", "BRIGADISTA", "CAMPO", "NIVEL_5"].includes(raw)) return "BRIGADA";
  return "CONSULTA";
};

export const canEnterCajaModuleByRole = (role) => {
  const normalized = normalizeRole(role);
  return normalized === "ADMIN" || normalized === "ADMIN_SEC" || normalized === "CAJERO";
};

export const canCorregirPagosByRole = (role) => {
  const normalized = normalizeRole(role);
  return normalized === "ADMIN" || normalized === "CAJERO";
};

export const toIsoDate = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const isValidIsoDate = (isoDate) => {
  const text = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map((value) => Number(value));
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && (probe.getUTCMonth() + 1) === month
    && probe.getUTCDate() === day;
};

const shiftIsoDateByDays = (isoDate, deltaDays) => {
  const text = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return toIsoDate();
  const probe = new Date(`${text}T12:00:00`);
  if (Number.isNaN(probe.getTime())) return toIsoDate();
  probe.setDate(probe.getDate() + Number(deltaDays || 0));
  return toIsoDate(probe);
};

export const resolveCobroDateWindow = (role, hoyIso = toIsoDate()) => {
  const rol = normalizeRole(role);
  if (rol === "ADMIN") {
    return { min: "", max: hoyIso, maxDiasRetroactivo: null };
  }
  if (rol === "CAJERO") {
    return {
      min: shiftIsoDateByDays(hoyIso, -MAX_RETROACTIVE_COBRO_DAYS_CAJA),
      max: hoyIso,
      maxDiasRetroactivo: MAX_RETROACTIVE_COBRO_DAYS_CAJA
    };
  }
  return { min: hoyIso, max: hoyIso, maxDiasRetroactivo: 0 };
};

export const buildCobroAguaVisibleYears = (rows = [], preferredYear = 0) => {
  const detected = Array.from(new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => Number(row?.anio || 0))
      .filter((year) => year >= 1900 && year <= 9999)
  ));
  if (detected.length === 0) return [];
  if (preferredYear >= 1900 && preferredYear <= 9999) detected.push(preferredYear);
  const minYear = Math.min(...detected);
  const maxYear = Math.max(...detected);
  const years = [];
  for (let year = maxYear; year >= minYear; year -= 1) years.push(year);
  return years;
};

export const buildCobroAguaYearRows = (rows = [], anio = 0) => {
  const year = Number(anio || 0);
  if (year < 1900 || year > 9999) return [];
  const byMes = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const rowYear = Number(row?.anio || 0);
    const mes = Number(row?.mes || 0);
    if (rowYear !== year || mes < 1 || mes > 12) return;
    byMes.set(mes, row);
  });
  return Array.from({ length: 12 }, (_, index) => {
    const mes = index + 1;
    return byMes.get(mes) || {
      anio: year,
      mes,
      placeholder_sin_recibo: true,
      estado: "SIN_RECIBO",
      subtotal_agua: 0,
      subtotal_desague: 0,
      subtotal_limpieza: 0,
      subtotal_admin: 0,
      total_pagar: 0,
      abono_mes: 0,
      deuda_mes: 0,
      es_adelantado: false
    };
  });
};

export const getCobroAguaRowKey = (row = {}) => {
  const idRecibo = Number(row?.id_recibo || 0);
  if (idRecibo > 0) return `r-${idRecibo}`;
  return `p-${Number(row?.anio || 0)}-${Number(row?.mes || 0)}`;
};

export const getCobroAguaRowSaldo = (row = {}) => (
  round2(row?.deuda_mes ?? row?.total_pagar ?? 0)
);

const getPeriodoNumFromIsoDate = (isoDate) => {
  if (!isValidIsoDate(isoDate)) return 0;
  const [year, month] = String(isoDate).split("-").map((value) => Number(value));
  if (!Number.isInteger(year) || !Number.isInteger(month)) return 0;
  return (year * 100) + month;
};

export const hasCobroAguaPendingReingreso = (row = {}) => {
  const idAnulacionPendiente = Number(row?.id_anulacion_pendiente || 0);
  if (idAnulacionPendiente <= 0) return false;
  const montoPagado = round2(row?.abono_mes ?? 0);
  const idPagoUltimo = Number(row?.id_ultimo_pago || 0);
  return montoPagado > 0.001 || idPagoUltimo > 0;
};

export const normalizeCobroAguaRowConsistency = (row = {}, fechaCorte = toIsoDate()) => {
  const next = { ...row };
  const estadoUpper = String(next?.estado || "").trim().toUpperCase();
  const abono = round2(next?.abono_mes ?? 0);
  const saldo = round2(next?.deuda_mes ?? next?.total_pagar ?? 0);
  const idPagoUltimo = Number(next?.id_ultimo_pago || 0);
  const idAnulacionPendiente = Number(next?.id_anulacion_pendiente || 0);
  const sinPagoActivo = abono <= 0.001 && idPagoUltimo <= 0;
  const periodoFila = (Number(next?.anio || 0) * 100) + Number(next?.mes || 0);
  const periodoFecha = getPeriodoNumFromIsoDate(fechaCorte);

  if (idAnulacionPendiente > 0 && sinPagoActivo) {
    next.id_anulacion_pendiente = 0;
    next.anulado_en_pendiente = null;
    next.monto_anulado_pendiente = 0;
    next.motivo_anulacion_pendiente = null;
  }

  if (estadoUpper === "PAGADO" && sinPagoActivo) {
    next.estado = saldo > 0.001 || periodoFecha <= 0 || periodoFila <= periodoFecha
      ? "PENDIENTE"
      : "NO_EXIGIBLE";
  }

  return next;
};

const normalizeDateOnlyText = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const iso = raw.slice(0, 10);
    return isValidIsoDate(iso) ? iso : "";
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : toIsoDate(parsed);
};

const isIsoDateWithinWindow = (dateRaw, { min = "", max = "" } = {}) => {
  const iso = normalizeDateOnlyText(dateRaw);
  if (!iso) return false;
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
};

export const canCorrectCobroAguaRowByDate = (row = {}, permisos = {}, hoyIso = toIsoDate()) => {
  if (!permisos?.canCorregirPagos) return false;
  const role = normalizeRole(permisos?.role);
  if (role === "ADMIN") return true;
  if (role !== "CAJERO") return false;
  const estado = String(row?.estado || "").trim().toUpperCase();
  const fechaReferencia = estado === "PAGADO"
    ? normalizeDateOnlyText(row?.fecha_ultimo_pago)
    : normalizeDateOnlyText(row?.anulado_en_pendiente || row?.fecha_ultimo_pago);
  return isIsoDateWithinWindow(fechaReferencia, resolveCobroDateWindow(role, hoyIso));
};

export const canAnnulCobroAguaRow = (row = {}, permisos = {}, hoyIso = toIsoDate()) => (
  Number(row?.id_recibo || 0) > 0
  && String(row?.estado || "").trim().toUpperCase() === "PAGADO"
  && canCorrectCobroAguaRowByDate(row, permisos, hoyIso)
);

export const canSelectCobroAguaRow = (row = {}, permisos = {}, hoyIso = toIsoDate()) => {
  const saldo = getCobroAguaRowSaldo(row);
  const estado = String(row?.estado || "").trim().toUpperCase();
  if (saldo <= 0.001 || estado === "PAGADO") return false;
  if (!hasCobroAguaPendingReingreso(row)) return true;
  const role = normalizeRole(permisos?.role);
  if (role === "ADMIN") return true;
  if (role !== "CAJERO") return false;
  return isIsoDateWithinWindow(
    row?.anulado_en_pendiente || row?.fecha_ultimo_pago,
    resolveCobroDateWindow(role, hoyIso)
  );
};
