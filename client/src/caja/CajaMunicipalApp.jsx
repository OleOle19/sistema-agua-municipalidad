import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { FaBolt, FaCashRegister, FaChevronLeft, FaChevronRight, FaSignOutAlt, FaSyncAlt, FaTint } from "react-icons/fa";
import api from "../api";
import LoginPage from "../components/LoginPage";
import ReciboAnexoCaja from "../components/ReciboAnexoCaja";
import cajaLuzApi from "./apiCajaLuz";
import ReciboLuz from "../luz/ReciboLuz";
import realtime from "../realtime";
import { finalizeMoneyInput, normalizeMoneyTyping } from "../utils/moneyInput";
import { formatDireccionDisplay } from "../utils/direccionDisplay";

const ModalCierre = lazy(() => import("../components/ModalCierre"));

const AGUA_TOKEN_KEY = "token_agua";

const ROLE_LABELS = {
  ADMIN: "Nivel 1 - Admin principal",
  ADMIN_SEC: "Nivel 2 - Ventanilla",
  CAJERO: "Nivel 3 - Operador de caja",
  CONSULTA: "Nivel 4 - Consulta",
  BRIGADA: "Nivel 5 - Brigada"
};
const COBRO_AGUA_MODOS = {
  CAJA: "CAJA",
  COMPENSACION: "COMPENSACION"
};
const METODOS_PAGO_CAJA = [
  { value: "EFECTIVO", label: "Efectivo", requiereReferencia: false }
];
const ESTADOS_CONFIRMACION_PAGO = [
  { value: "CONFIRMADO", label: "Confirmado" },
  { value: "PENDIENTE_VERIFICACION", label: "Pendiente verificacion" },
  { value: "RECHAZADO", label: "Rechazado" }
];
const buildEmptyDeclaracionMetodos = () => METODOS_PAGO_CAJA.reduce((acc, metodo) => ({
  ...acc,
  [metodo.value]: ""
}), {});
const normalizeMetodoPagoCaja = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  return METODOS_PAGO_CAJA.some((metodo) => metodo.value === raw) ? raw : "EFECTIVO";
};
const getMetodoPagoConfig = (value) => (
  METODOS_PAGO_CAJA.find((metodo) => metodo.value === normalizeMetodoPagoCaja(value)) || METODOS_PAGO_CAJA[0]
);
const normalizeEstadoConfirmacionPago = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  return ESTADOS_CONFIRMACION_PAGO.some((estado) => estado.value === raw) ? raw : "CONFIRMADO";
};
const buildDeclaracionMetodosFromReporte = (reporte = {}, conteo = {}) => {
  const totales = reporte?.totales_por_metodo || reporte?.totales_metodos || {};
  const previo = conteo?.ultimo_pendiente?.declaracion_metodos
    || conteo?.cierre_hoy?.declaracion_metodos
    || {};
  return METODOS_PAGO_CAJA.reduce((acc, metodo) => {
    const value = previo?.[metodo.value] ?? totales?.[metodo.value] ?? "";
    const monto = parseMonto(value);
    acc[metodo.value] = monto > 0 ? monto.toFixed(2) : "";
    return acc;
  }, {});
};
const totalDeclaracionMetodos = (declaracion = {}) => METODOS_PAGO_CAJA.reduce(
  (acc, metodo) => round2(acc + parseMonto(declaracion?.[metodo.value])),
  0
);

const ANEXO_PAGE_STYLE = `
  @page {
    size: A4 portrait;
    margin: 0;
  }
  @media print {
    html, body {
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      background: #fff !important;
    }
  }
`;

const RECIBO_LUZ_PAGE_STYLE = `
  @page {
    size: 210mm 297mm;
    margin: 0;
  }
  @media print {
    html, body {
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      background: #fff !important;
    }
    #root {
      background: #fff !important;
    }
  }
`;
const MAX_RETROACTIVE_COBRO_DAYS_CAJA = 3;
const SEARCH_RESULTS_CACHE_TTL_MS = 30000;
const SEARCH_RESULTS_LIMIT_AGUA = 120;
const SEARCH_RESULTS_LIMIT_LUZ = 300;
const SEARCH_WARN_THRESHOLD_MS = 800;
const LazyModalFallback = ({ label = "Cargando..." }) => (
  <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
    <div className="modal-dialog">
      <div className="modal-content">
        <div className="modal-body py-4 text-center">
          <div className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></div>
          <span>{label}</span>
        </div>
      </div>
    </div>
  </div>
);

const normalizeRole = (role) => {
  const raw = String(role || "").trim().toUpperCase();
  if (["ADMIN", "SUPERADMIN", "ADMIN_PRINCIPAL", "NIVEL_1"].includes(raw)) return "ADMIN";
  if (["ADMIN_SEC", "ADMIN_SECUNDARIO", "JEFE_CAJA", "NIVEL_2"].includes(raw)) return "ADMIN_SEC";
  if (["CAJERO", "OPERADOR_CAJA", "OPERADOR", "NIVEL_3"].includes(raw)) return "CAJERO";
  if (["BRIGADA", "BRIGADISTA", "CAMPO", "NIVEL_5"].includes(raw)) return "BRIGADA";
  return "CONSULTA";
};

const canEnterCajaModuleByRole = (role) => {
  const normalized = normalizeRole(role);
  return normalized === "ADMIN" || normalized === "ADMIN_SEC" || normalized === "CAJERO";
};
const canCorregirPagosByRole = (role) => {
  const normalized = normalizeRole(role);
  return normalized === "ADMIN" || normalized === "CAJERO";
};

const parseJwtPayload = (token) => {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    if (pad) base64 += "=".repeat(4 - pad);
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
};

const readStoredAguaUser = () => {
  const token = localStorage.getItem(AGUA_TOKEN_KEY) || localStorage.getItem("token");
  if (!token) return null;
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    localStorage.removeItem(AGUA_TOKEN_KEY);
    localStorage.removeItem("token");
    return null;
  }
  return {
    id_usuario: payload.id_usuario,
    username: payload.username,
    nombre: payload.nombre,
    rol: normalizeRole(payload.rol)
  };
};

const toIsoDate = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
const isValidIsoDate = (isoDate) => {
  const text = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map((v) => Number(v));
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
const resolveCobroDateWindow = (role, hoyIso = toIsoDate()) => {
  const rol = normalizeRole(role);
  if (rol === "ADMIN") {
    return {
      min: "",
      max: hoyIso,
      maxDiasRetroactivo: null
    };
  }
  if (rol === "CAJERO") {
    return {
      min: shiftIsoDateByDays(hoyIso, -MAX_RETROACTIVE_COBRO_DAYS_CAJA),
      max: hoyIso,
      maxDiasRetroactivo: MAX_RETROACTIVE_COBRO_DAYS_CAJA
    };
  }
  return {
    min: hoyIso,
    max: hoyIso,
    maxDiasRetroactivo: 0
  };
};

const parseMonto = (value) => {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSearchText = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

const normalizeDigits = (value) => String(value || "").replace(/\D/g, "");

const normalizeCodigo = (value) => String(value || "")
  .toUpperCase()
  .replace(/\s+/g, "")
  .trim();
const buildSearchCacheKey = (value) => {
  const raw = String(value || "").trim();
  return [
    normalizeSearchText(raw),
    normalizeDigits(raw),
    normalizeCodigo(raw)
  ].join("|");
};
const readSearchCacheValue = (cacheRef, cacheKey) => {
  const cached = cacheRef.current.get(cacheKey);
  if (!cached) return null;
  if (Date.now() >= Number(cached.expiresAt || 0)) {
    cacheRef.current.delete(cacheKey);
    return null;
  }
  return Array.isArray(cached.rows) ? cached.rows : null;
};
const writeSearchCacheValue = (cacheRef, cacheKey, rows) => {
  cacheRef.current.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_RESULTS_CACHE_TTL_MS,
    rows: Array.isArray(rows) ? rows : []
  });
};

const formatMoney = (value) => `S/. ${parseMonto(value).toFixed(2)}`;
const MESES_ES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const formatFechaHora = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString("es-PE");
};
const buildCobroAguaCacheKey = (idContribuyente, fecha, permitirContingencia = false, permitirOverrideAdminFuturos = false) => (
  `${Number(idContribuyente || 0)}|${String(fecha || "").trim()}|${permitirContingencia ? "1" : "0"}|${permitirOverrideAdminFuturos ? "1" : "0"}`
);
const buildCobroAguaVisibleYears = (rows = [], preferredYear = 0) => {
  const detected = Array.from(new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => Number(row?.anio || 0))
      .filter((year) => year >= 1900 && year <= 9999)
  ));
  if (detected.length === 0) return [];
  if (preferredYear >= 1900 && preferredYear <= 9999) {
    detected.push(preferredYear);
  }
  const minYear = Math.min(...detected);
  const maxYear = Math.max(...detected);
  const years = [];
  for (let year = maxYear; year >= minYear; year -= 1) {
    years.push(year);
  }
  return years;
};
const buildCobroAguaYearRows = (rows = [], anio = 0) => {
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

const round2 = (value) => Math.round((parseMonto(value) + Number.EPSILON) * 100) / 100;
const allocateMontoByPriority = (baseComponents = {}, montoRaw, priorityOrder = []) => {
  const montoObjetivo = round2(Math.max(parseMonto(montoRaw), 0));
  const priority = Array.isArray(priorityOrder) ? priorityOrder : [];
  const keysBase = Object.keys(baseComponents || {});
  const orderedKeys = [
    ...priority.filter((key) => keysBase.includes(key)),
    ...keysBase.filter((key) => !priority.includes(key))
  ];
  const allocated = {};
  orderedKeys.forEach((key) => {
    allocated[key] = 0;
  });
  if (orderedKeys.length === 0) return allocated;

  let remaining = montoObjetivo;
  orderedKeys.forEach((key) => {
    if (remaining <= 0.0001) return;
    const base = round2(Math.max(parseMonto(baseComponents?.[key]), 0));
    if (base <= 0.0001) return;
    const applied = round2(Math.min(base, remaining));
    allocated[key] = applied;
    remaining = round2(remaining - applied);
  });

  if (remaining > 0.0001) {
    const fallbackKey = orderedKeys[0];
    allocated[fallbackKey] = round2(parseMonto(allocated[fallbackKey]) + remaining);
  }

  return allocated;
};
const getCobroAguaRowKey = (row = {}) => {
  const idRecibo = Number(row?.id_recibo || 0);
  if (idRecibo > 0) return `r-${idRecibo}`;
  const anio = Number(row?.anio || 0);
  const mes = Number(row?.mes || 0);
  return `p-${anio}-${mes}`;
};
const getCobroAguaRowSaldo = (row = {}) => round2(parseMonto(row?.deuda_mes ?? row?.total_pagar ?? 0));
const getPeriodoNumFromIsoDate = (isoDate) => {
  if (!isValidIsoDate(isoDate)) return 0;
  const [year, month] = String(isoDate).split("-").map((value) => Number(value));
  if (!Number.isInteger(year) || !Number.isInteger(month)) return 0;
  return (year * 100) + month;
};
const hasCobroAguaPendingReingreso = (row = {}) => {
  const idAnulacionPendiente = Number(row?.id_anulacion_pendiente || 0);
  if (idAnulacionPendiente <= 0) return false;
  const montoPagado = round2(parseMonto(row?.abono_mes ?? 0));
  const idPagoUltimo = Number(row?.id_ultimo_pago || 0);
  return montoPagado > 0.001 || idPagoUltimo > 0;
};
const normalizeCobroAguaRowConsistency = (row = {}, fechaCorte = toIsoDate()) => {
  const next = { ...row };
  const estadoUpper = String(next?.estado || "").trim().toUpperCase();
  const abono = round2(parseMonto(next?.abono_mes ?? 0));
  const saldo = round2(parseMonto(next?.deuda_mes ?? next?.total_pagar ?? 0));
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
    if (saldo > 0.001) {
      next.estado = "PENDIENTE";
    } else if (periodoFecha > 0 && periodoFila > periodoFecha) {
      next.estado = "NO_EXIGIBLE";
    } else {
      next.estado = "PENDIENTE";
    }
  }

  return next;
};
const getCobroLuzRowKey = (row = {}) => {
  const idRecibo = Number(row?.id_recibo || 0);
  if (idRecibo > 0) return `r-${idRecibo}`;
  const anio = Number(row?.anio || 0);
  const mes = Number(row?.mes || 0);
  return `p-${anio}-${mes}`;
};
const getCobroLuzRowSaldo = (row = {}) => round2(parseMonto(row?.deuda_mes ?? row?.total_pagar ?? 0));
const normalizeDateOnlyText = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const iso = raw.slice(0, 10);
    return isValidIsoDate(iso) ? iso : "";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return toIsoDate(parsed);
};
const isIsoDateWithinWindow = (dateRaw, { min = "", max = "" } = {}) => {
  const iso = normalizeDateOnlyText(dateRaw);
  if (!iso) return false;
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
};
const canCorrectCobroAguaRowByDate = (row = {}, permisos = {}, hoyIso = toIsoDate()) => {
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
const canSelectCobroAguaRow = (row = {}, permisos = {}, hoyIso = toIsoDate()) => {
  const saldo = getCobroAguaRowSaldo(row);
  const estado = String(row?.estado || "").trim().toUpperCase();
  if (saldo <= 0.001) return false;
  if (estado === "PAGADO") return false;
  if (hasCobroAguaPendingReingreso(row)) {
    const role = normalizeRole(permisos?.role);
    if (role === "ADMIN") return true;
    if (role !== "CAJERO") return false;
    return isIsoDateWithinWindow(
      row?.anulado_en_pendiente || row?.fecha_ultimo_pago,
      resolveCobroDateWindow(role, hoyIso)
    );
  }
  return true;
};

const pickFirstText = (...values) => {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
};

const buildDetalleProrrateadoRecibo = (recibo, montoCobro) => {
  const componentes = allocateMontoByPriority(
    {
      subtotal_agua: parseMonto(recibo?.subtotal_agua),
      subtotal_desague: parseMonto(recibo?.subtotal_desague),
      subtotal_limpieza: parseMonto(recibo?.subtotal_limpieza),
      subtotal_admin: parseMonto(recibo?.subtotal_admin)
    },
    montoCobro,
    ["subtotal_agua", "subtotal_desague", "subtotal_limpieza", "subtotal_admin"]
  );
  return {
    subtotal_agua: round2(componentes.subtotal_agua),
    subtotal_desague: round2(componentes.subtotal_desague),
    subtotal_limpieza: round2(componentes.subtotal_limpieza),
    subtotal_admin: round2(componentes.subtotal_admin)
  };
};

const buildAnexoDetallesPorMes = (items, { force = false, maxRows = 7 } = {}) => {
  const rows = Array.isArray(items) ? items : [];
  const byPeriodo = new Map();
  rows.forEach((it) => {
    const mes = Number(it?.mes || 0);
    const anio = Number(it?.anio || 0);
    const monto = round2(parseMonto(
      it?.monto_pagado
      ?? it?.monto_cobrado
      ?? it?.monto_autorizado
      ?? it?.importe
      ?? it?.total
    ));
    if (mes < 1 || mes > 12 || anio < 1900 || monto <= 0) return;
    const key = `${anio}-${mes}`;
    const current = byPeriodo.get(key) || { mes, anio, monto: 0 };
    current.monto = round2(current.monto + monto);
    byPeriodo.set(key, current);
  });
  const ordered = Array.from(byPeriodo.values())
    .sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes))
    .map((row) => ({
      concepto: `${String(MESES_ES[row.mes] || String(row.mes).padStart(2, "0")).toUpperCase()} ${row.anio}`,
      importe: round2(row.monto)
    }));
  if (!force && ordered.length <= 1) return [];
  if (ordered.length <= maxRows) return ordered;
  const base = ordered.slice(0, Math.max(1, maxRows - 1));
  const restantes = ordered.slice(Math.max(1, maxRows - 1));
  const sumaRestante = round2(restantes.reduce((acc, row) => acc + parseMonto(row.importe), 0));
  base.push({
    concepto: `OTROS MESES (${restantes.length})`,
    importe: sumaRestante
  });
  return base;
};

const buildAnexoDataFromPagoDirecto = (contribuyente, pagos) => {
  const items = Array.isArray(pagos) ? pagos : [];
  const totalCobrado = round2(items.reduce((acc, it) => acc + parseMonto(it?.monto_pagado), 0));
  const detallesPorMes = buildAnexoDetallesPorMes(items, { force: false, maxRows: 7 });
  const resumenServicios = items.reduce((acc, it) => ({
    agua: round2(acc.agua + parseMonto(it?.subtotal_agua)),
    desague: round2(acc.desague + parseMonto(it?.subtotal_desague)),
    limpieza: round2(acc.limpieza + parseMonto(it?.subtotal_limpieza)),
    admin: round2(acc.admin + parseMonto(it?.subtotal_admin))
  }), { agua: 0, desague: 0, limpieza: 0, admin: 0 });
  const detallesServicios = [
    { concepto: "SERVICIO DE AGUA", importe: resumenServicios.agua },
    { concepto: "SERVICIO DE DESAGUE", importe: resumenServicios.desague },
    { concepto: "LIMPIEZA PUBLICA", importe: resumenServicios.limpieza },
    { concepto: "SERVICIO ADMIN", importe: resumenServicios.admin }
  ].filter((row) => row.importe > 0);
  const detalles = detallesPorMes.length > 0 ? detallesPorMes : detallesServicios;
  if (detalles.length === 0 && totalCobrado > 0) {
    detalles.push({ concepto: "SERVICIOS", importe: totalCobrado });
  } else if (detalles.length > 0) {
    const totalDetalle = round2(detalles.reduce((acc, row) => acc + parseMonto(row.importe), 0));
    const diferencia = round2(totalCobrado - totalDetalle);
    if (Math.abs(diferencia) >= 0.01) {
      const idx = detalles.length - 1;
      detalles[idx] = { ...detalles[idx], importe: round2(parseMonto(detalles[idx].importe) + diferencia) };
    }
  }

  return {
    entidad: "MUNICIPALIDAD DISTRITAL DE PUEBLO NUEVO",
    entidad_detalle: "ARCO 301  RUC. 20192401004",
    contribuyente: {
      codigo_municipal: pickFirstText(contribuyente?.codigo_municipal, contribuyente?.sec_cod),
      nombre_completo: pickFirstText(contribuyente?.nombre_completo, contribuyente?.sec_nombre),
      calle: formatDireccionDisplay(pickFirstText(contribuyente?.direccion_completa, contribuyente?.direccion)),
      ruc: pickFirstText(contribuyente?.dni_ruc)
    },
    total: totalCobrado,
    detalles
  };
};

const buildAnexoDataFromReciboPagado = (contribuyente, reciboPagado) => {
  const subtotalAgua = round2(parseMonto(reciboPagado?.subtotal_agua));
  const subtotalDesague = round2(parseMonto(reciboPagado?.subtotal_desague));
  const subtotalLimpieza = round2(parseMonto(reciboPagado?.subtotal_limpieza));
  const subtotalAdmin = round2(parseMonto(reciboPagado?.subtotal_admin));
  const totalPagado = round2(parseMonto(reciboPagado?.abono_mes || reciboPagado?.total_pagar));
  const detalles = [
    { concepto: "SERVICIO DE AGUA", importe: subtotalAgua },
    { concepto: "SERVICIO DE DESAGUE", importe: subtotalDesague },
    { concepto: "LIMPIEZA PUBLICA", importe: subtotalLimpieza },
    { concepto: "SERVICIO ADMIN", importe: subtotalAdmin }
  ].filter((row) => row.importe > 0);
  if (detalles.length === 0 && totalPagado > 0) {
    detalles.push({ concepto: "SERVICIOS", importe: totalPagado });
  } else if (detalles.length > 0) {
    const totalDetalle = round2(detalles.reduce((acc, row) => acc + parseMonto(row.importe), 0));
    const diferencia = round2(totalPagado - totalDetalle);
    if (Math.abs(diferencia) >= 0.01) {
      const idx = detalles.length - 1;
      detalles[idx] = { ...detalles[idx], importe: round2(parseMonto(detalles[idx].importe) + diferencia) };
    }
  }

  return {
    entidad: "MUNICIPALIDAD DISTRITAL DE PUEBLO NUEVO",
    entidad_detalle: "ARCO 301  RUC. 20192401004",
    contribuyente: {
      codigo_municipal: pickFirstText(contribuyente?.codigo_municipal, contribuyente?.sec_cod),
      nombre_completo: pickFirstText(contribuyente?.nombre_completo, contribuyente?.sec_nombre),
      calle: formatDireccionDisplay(pickFirstText(contribuyente?.direccion_completa, contribuyente?.direccion)),
      ruc: pickFirstText(contribuyente?.dni_ruc)
    },
    total: totalPagado,
    detalles
  };
};

function CajaMunicipalApp({ onBackToSelector }) {
  const [usuarioSistema, setUsuarioSistema] = useState(readStoredAguaUser);
  const [tab, setTab] = useState("agua");
  const [flash, setFlash] = useState(null);

  const [loadingAgua, setLoadingAgua] = useState(false);
  const [reporteAgua, setReporteAgua] = useState(null);
  const [loadingReporteAgua, setLoadingReporteAgua] = useState(false);
  const [resumenConteoAgua, setResumenConteoAgua] = useState({
    fecha_referencia: "",
    total_pendientes_hoy: 0,
    monto_pendiente_hoy: 0,
    ultimo_pendiente: null,
    caja_cerrada_hoy: false,
    cierre_hoy: null
  });
  const [loadingConteoAgua, setLoadingConteoAgua] = useState(false);
  const [enviandoConteoAgua, setEnviandoConteoAgua] = useState(false);
  const [busquedaContribuyenteAgua, setBusquedaContribuyenteAgua] = useState("");
  const [buscandoContribuyenteAgua, setBuscandoContribuyenteAgua] = useState(false);
  const [busquedaContribuyenteRealizada, setBusquedaContribuyenteRealizada] = useState(false);
  const [errorBusquedaContribuyenteAgua, setErrorBusquedaContribuyenteAgua] = useState("");
  const [contribuyentesFiltradosAgua, setContribuyentesFiltradosAgua] = useState([]);
  const [selectedContribuyenteAgua, setSelectedContribuyenteAgua] = useState(null);
  const [mostrarModalCobroAgua, setMostrarModalCobroAgua] = useState(false);
  const [loadingPendientesCobroAgua, setLoadingPendientesCobroAgua] = useState(false);
  const [actualizandoPeriodosCobroAgua, setActualizandoPeriodosCobroAgua] = useState(false);
  const [cobrandoDirectoAgua, setCobrandoDirectoAgua] = useState(false);
  const [anulandoReciboCobroAguaId, setAnulandoReciboCobroAguaId] = useState(0);
  const [editandoPagoCobroAguaId, setEditandoPagoCobroAguaId] = useState(0);
  const [recibosPendientesCobroAgua, setRecibosPendientesCobroAgua] = useState([]);
  const [seleccionCobroAgua, setSeleccionCobroAgua] = useState({});
  const [fechaCobroAgua, setFechaCobroAgua] = useState(toIsoDate());
  const [anioVistaCobroAgua, setAnioVistaCobroAgua] = useState(0);
  const [modoCobroAgua, setModoCobroAgua] = useState(COBRO_AGUA_MODOS.CAJA);
  const [motivoCobroAgua, setMotivoCobroAgua] = useState("");
  const [metodoPagoAgua, setMetodoPagoAgua] = useState("EFECTIVO");
  const [referenciaPagoAgua, setReferenciaPagoAgua] = useState("");
  const [estadoConfirmacionPagoAgua, setEstadoConfirmacionPagoAgua] = useState("CONFIRMADO");
  const [observacionPagoAgua, setObservacionPagoAgua] = useState("");
  const [mostrarModalConteoAgua, setMostrarModalConteoAgua] = useState(false);
  const [declaracionMetodosAgua, setDeclaracionMetodosAgua] = useState(buildEmptyDeclaracionMetodos);
  const [observacionConteoAgua, setObservacionConteoAgua] = useState("");
  const [permitirContingenciaAgua, setPermitirContingenciaAgua] = useState(false);
  const [mostrarModalReimpresionAgua, setMostrarModalReimpresionAgua] = useState(false);
  const [loadingHistorialReimpresionAgua, setLoadingHistorialReimpresionAgua] = useState(false);
  const [recibosPagadosReimpresionAgua, setRecibosPagadosReimpresionAgua] = useState([]);
  const [idReciboReimpresionAgua, setIdReciboReimpresionAgua] = useState(0);
  const [mostrarReporteCajaAgua, setMostrarReporteCajaAgua] = useState(false);
  const cajaCerradaAguaHoy = Boolean(resumenConteoAgua?.caja_cerrada_hoy);

  const [loadingLuz, setLoadingLuz] = useState(false);
  const [reporteLuz, setReporteLuz] = useState(null);
  const [loadingReporteLuz, setLoadingReporteLuz] = useState(false);
  const [busquedaContribuyenteLuz, setBusquedaContribuyenteLuz] = useState("");
  const [buscandoContribuyenteLuz, setBuscandoContribuyenteLuz] = useState(false);
  const [busquedaContribuyenteLuzRealizada, setBusquedaContribuyenteLuzRealizada] = useState(false);
  const [errorBusquedaContribuyenteLuz, setErrorBusquedaContribuyenteLuz] = useState("");
  const [contribuyentesFiltradosLuz, setContribuyentesFiltradosLuz] = useState([]);
  const [selectedContribuyenteLuz, setSelectedContribuyenteLuz] = useState(null);
  const [mostrarModalCobroLuz, setMostrarModalCobroLuz] = useState(false);
  const [loadingPendientesCobroLuz, setLoadingPendientesCobroLuz] = useState(false);
  const [cobrandoDirectoLuz, setCobrandoDirectoLuz] = useState(false);
  const [recibosPendientesCobroLuz, setRecibosPendientesCobroLuz] = useState([]);
  const [seleccionCobroLuz, setSeleccionCobroLuz] = useState({});
  const [metodoPagoLuz, setMetodoPagoLuz] = useState("EFECTIVO");
  const [referenciaPagoLuz, setReferenciaPagoLuz] = useState("");
  const [estadoConfirmacionPagoLuz, setEstadoConfirmacionPagoLuz] = useState("CONFIRMADO");
  const [mostrarModalReimpresionLuz, setMostrarModalReimpresionLuz] = useState(false);
  const [loadingHistorialReimpresionLuz, setLoadingHistorialReimpresionLuz] = useState(false);
  const [recibosPagadosReimpresionLuz, setRecibosPagadosReimpresionLuz] = useState([]);
  const [idReciboReimpresionLuz, setIdReciboReimpresionLuz] = useState(0);
  const [reciboLuzImpresion, setReciboLuzImpresion] = useState(null);
  const [mostrarReporteCajaLuz, setMostrarReporteCajaLuz] = useState(false);
  const [fechaReporteLuz, setFechaReporteLuz] = useState(toIsoDate());
  const reciboLuzRef = useRef(null);
  const imprimiendoReciboLuzRef = useRef(false);

  const [datosAnexoCajaImprimir, setDatosAnexoCajaImprimir] = useState(null);
  const [imprimiendoAnexoCaja, setImprimiendoAnexoCaja] = useState(false);
  const anexoCajaRef = useRef(null);
  const isPrintingAnexoCajaRef = useRef(false);
  const previousTabRef = useRef("agua");
  const cobroAguaCacheRef = useRef(new Map());
  const busquedaAguaCacheRef = useRef(new Map());
  const busquedaAguaRequestSeqRef = useRef(0);
  const busquedaLuzCacheRef = useRef(new Map());
  const busquedaLuzRequestSeqRef = useRef(0);
  const cobroAguaRequestSeqRef = useRef(0);

  const rolActual = normalizeRole(usuarioSistema?.rol);
  const accesoCajaPermitido = canEnterCajaModuleByRole(rolActual);
  const ventanaFechaCobro = resolveCobroDateWindow(rolActual, toIsoDate());
  const permisos = useMemo(() => ({
    role: rolActual,
    roleLabel: ROLE_LABELS[rolActual] || ROLE_LABELS.CONSULTA,
    canCaja: accesoCajaPermitido,
    canAdminPagos: rolActual === "ADMIN",
    canCorregirPagos: canCorregirPagosByRole(rolActual),
    canSeleccionarFechaCobro: accesoCajaPermitido,
    fechaCobroMinima: ventanaFechaCobro.min,
    fechaCobroMaxima: ventanaFechaCobro.max,
    maxDiasRetroactivoCobro: ventanaFechaCobro.maxDiasRetroactivo
  }), [accesoCajaPermitido, rolActual, ventanaFechaCobro.max, ventanaFechaCobro.maxDiasRetroactivo, ventanaFechaCobro.min]);

  useEffect(() => {
    if (permisos.canAdminPagos) return;
    setModoCobroAgua(COBRO_AGUA_MODOS.CAJA);
    setMotivoCobroAgua("");
  }, [permisos.canAdminPagos]);

  const showFlash = useCallback((type, text) => {
    setFlash({ type, text, ts: Date.now() });
  }, []);

  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(timer);
  }, [flash]);

  const handleApiError = useCallback((err, fallback) => {
    const status = Number(err?.response?.status || 0);
    const msg = String(err?.response?.data?.error || fallback || "Error de conexión");
    if (status === 401) {
      localStorage.removeItem(AGUA_TOKEN_KEY);
      localStorage.removeItem("token");
      setUsuarioSistema(null);
    }
    showFlash("danger", msg);
    return msg;
  }, [showFlash]);

  const logout = useCallback(() => {
    localStorage.removeItem(AGUA_TOKEN_KEY);
    localStorage.removeItem("token");
    setUsuarioSistema(null);
    setReporteAgua(null);
    setResumenConteoAgua({
      fecha_referencia: "",
      total_pendientes_hoy: 0,
      monto_pendiente_hoy: 0,
      ultimo_pendiente: null,
      caja_cerrada_hoy: false,
      cierre_hoy: null
    });
    setContribuyentesFiltradosAgua([]);
    setBusquedaContribuyenteAgua("");
    setBuscandoContribuyenteAgua(false);
    setBusquedaContribuyenteRealizada(false);
    setErrorBusquedaContribuyenteAgua("");
    setSelectedContribuyenteAgua(null);
    setMostrarModalCobroAgua(false);
    setLoadingPendientesCobroAgua(false);
    setActualizandoPeriodosCobroAgua(false);
    setCobrandoDirectoAgua(false);
    setRecibosPendientesCobroAgua([]);
    setSeleccionCobroAgua({});
    setFechaCobroAgua(toIsoDate());
    setAnioVistaCobroAgua(0);
    setMostrarModalReimpresionAgua(false);
    setLoadingHistorialReimpresionAgua(false);
    setRecibosPagadosReimpresionAgua([]);
    setIdReciboReimpresionAgua(0);
    setMostrarReporteCajaAgua(false);
    setReporteLuz(null);
    setContribuyentesFiltradosLuz([]);
    setBusquedaContribuyenteLuz("");
    setBuscandoContribuyenteLuz(false);
    setBusquedaContribuyenteLuzRealizada(false);
    setErrorBusquedaContribuyenteLuz("");
    setSelectedContribuyenteLuz(null);
    setMostrarModalCobroLuz(false);
    setLoadingPendientesCobroLuz(false);
    setCobrandoDirectoLuz(false);
    setRecibosPendientesCobroLuz([]);
    setSeleccionCobroLuz({});
    setMostrarModalReimpresionLuz(false);
    setLoadingHistorialReimpresionLuz(false);
    setRecibosPagadosReimpresionLuz([]);
    setIdReciboReimpresionLuz(0);
    setReciboLuzImpresion(null);
    setMostrarReporteCajaLuz(false);
    setFechaReporteLuz(toIsoDate());
    setImprimiendoAnexoCaja(false);
    busquedaAguaCacheRef.current.clear();
    busquedaAguaRequestSeqRef.current = 0;
    busquedaLuzCacheRef.current.clear();
    busquedaLuzRequestSeqRef.current = 0;
    cobroAguaCacheRef.current.clear();
    cobroAguaRequestSeqRef.current = 0;
  }, []);

  const invalidarCobroAguaCache = useCallback(() => {
    cobroAguaCacheRef.current.clear();
  }, []);

  const invalidarBusquedaCajaCache = useCallback(() => {
    busquedaAguaCacheRef.current.clear();
    busquedaLuzCacheRef.current.clear();
  }, []);

  const cargarReporteAgua = useCallback(async () => {
    if (!permisos.canCaja) return;
    setLoadingReporteAgua(true);
    try {
      const res = await api.get("/caja/reporte", { params: { tipo: "diario", fecha: toIsoDate() } });
      setReporteAgua(res.data || null);
    } catch (err) {
      handleApiError(err, "No se pudo cargar reporte de agua.");
    } finally {
      setLoadingReporteAgua(false);
    }
  }, [handleApiError, permisos.canCaja]);

  const cargarResumenAgua = useCallback(async () => {
    if (!permisos.canCaja) return;
    setLoadingAgua(true);
    try {
      await cargarReporteAgua();
    } finally {
      setLoadingAgua(false);
    }
  }, [cargarReporteAgua, permisos.canCaja]);

  const cargarConteoAgua = useCallback(async () => {
    if (!permisos.canCaja) return;
    setLoadingConteoAgua(true);
    try {
      const res = await api.get("/caja/conteo-efectivo/resumen");
      const data = res?.data || {};
      setResumenConteoAgua({
        fecha_referencia: data.fecha_referencia || "",
        total_pendientes_hoy: Number(data.total_pendientes_hoy || 0),
        monto_pendiente_hoy: Number(data.monto_pendiente_hoy || 0),
        ultimo_pendiente: data.ultimo_pendiente || null,
        caja_cerrada_hoy: Boolean(data.caja_cerrada_hoy),
        cierre_hoy: data.cierre_hoy || null
      });
    } catch {
      setResumenConteoAgua({
        fecha_referencia: "",
        total_pendientes_hoy: 0,
        monto_pendiente_hoy: 0,
        ultimo_pendiente: null,
        caja_cerrada_hoy: false,
        cierre_hoy: null
      });
    } finally {
      setLoadingConteoAgua(false);
    }
  }, [permisos.canCaja]);

  const cargarReporteLuz = useCallback(async (fechaRef = fechaReporteLuz) => {
    if (!permisos.canCaja) return;
    setLoadingReporteLuz(true);
    try {
      const fecha = isValidIsoDate(fechaRef) ? fechaRef : toIsoDate();
      const res = await cajaLuzApi.get("/caja/reporte", { params: { tipo: "diario", fecha } });
      setReporteLuz(res.data || null);
    } catch (err) {
      handleApiError(err, "No se pudo cargar reporte de luz.");
    } finally {
      setLoadingReporteLuz(false);
    }
  }, [fechaReporteLuz, handleApiError, permisos.canCaja]);

  const recargarAgua = useCallback(async () => {
    await Promise.all([cargarResumenAgua(), cargarConteoAgua()]);
  }, [cargarResumenAgua, cargarConteoAgua]);

  const recargarLuz = useCallback(async () => {
    setLoadingLuz(true);
    try {
      await cargarReporteLuz(fechaReporteLuz);
    } finally {
      setLoadingLuz(false);
    }
  }, [cargarReporteLuz, fechaReporteLuz]);

  useEffect(() => {
    if (!usuarioSistema) return;
    if (tab === "agua") {
      recargarAgua();
    } else if (tab === "luz") {
      recargarLuz();
    }
  }, [recargarAgua, recargarLuz, tab, usuarioSistema]);

  useEffect(() => {
    if (previousTabRef.current === tab) return;
    previousTabRef.current = tab;
    invalidarBusquedaCajaCache();
    busquedaAguaRequestSeqRef.current += 1;
    busquedaLuzRequestSeqRef.current += 1;
    setBuscandoContribuyenteAgua(false);
    setBuscandoContribuyenteLuz(false);
    setErrorBusquedaContribuyenteAgua("");
    setErrorBusquedaContribuyenteLuz("");
  }, [invalidarBusquedaCajaCache, tab]);

  useEffect(() => {
    if (!usuarioSistema) {
      realtime.disconnect(true);
      return;
    }
    const token = localStorage.getItem(AGUA_TOKEN_KEY) || localStorage.getItem("token") || "";
    realtime.connect(token);
    return () => {
      realtime.disconnect(true);
    };
  }, [usuarioSistema]);

  const buscarContribuyentesAgua = useCallback(async ({ preserveSelectedId = 0, force = false } = {}) => {
    const qRaw = String(busquedaContribuyenteAgua || "").trim();
    if (!qRaw) {
      setBusquedaContribuyenteRealizada(true);
      setContribuyentesFiltradosAgua([]);
      setErrorBusquedaContribuyenteAgua("");
      setSelectedContribuyenteAgua(null);
      showFlash("warning", "Digite apellidos completos, nombre y apellido, DNI o código completo.");
      return;
    }
    const idSeleccionado = Number(preserveSelectedId || selectedContribuyenteAgua?.id_contribuyente || 0);
    const cacheKey = buildSearchCacheKey(qRaw);
    const requestId = busquedaAguaRequestSeqRef.current + 1;
    busquedaAguaRequestSeqRef.current = requestId;
    const startedAt = Date.now();
    try {
      if (!force) {
        const cachedRows = readSearchCacheValue(busquedaAguaCacheRef, cacheKey);
        if (cachedRows) {
          setContribuyentesFiltradosAgua(cachedRows);
          setErrorBusquedaContribuyenteAgua("");
          setSelectedContribuyenteAgua(() => {
            if (!idSeleccionado) return null;
            return cachedRows.find((row) => Number(row?.id_contribuyente || 0) === idSeleccionado) || null;
          });
          setBusquedaContribuyenteRealizada(true);
          return;
        }
      }

      setErrorBusquedaContribuyenteAgua("");
      setBuscandoContribuyenteAgua(true);
      const res = await api.get("/caja/contribuyentes/buscar", {
        params: {
          q: qRaw,
          limit: SEARCH_RESULTS_LIMIT_AGUA
        }
      });
      if (requestId !== busquedaAguaRequestSeqRef.current) return;
      const filtrados = (Array.isArray(res.data) ? res.data : []).map((row) => ({
        ...row,
        id_contribuyente: Number(row?.id_contribuyente || 0),
        id_predio: Number(row?.id_predio || 0),
        meses_deuda: Number(row?.meses_deuda || 0),
        deuda_anio: round2(parseMonto(row?.deuda_anio ?? 0)),
        abono_anio: round2(parseMonto(row?.abono_anio ?? 0))
      }));
      if (import.meta.env.DEV) {
        const durationMs = Date.now() - startedAt;
        if (durationMs > SEARCH_WARN_THRESHOLD_MS) {
          console.warn("[CAJA][BUSQUEDA_AGUA_LENTA]", {
            q: qRaw,
            durationMs,
            results: filtrados.length
          });
        }
      }
      writeSearchCacheValue(busquedaAguaCacheRef, cacheKey, filtrados);
      setContribuyentesFiltradosAgua(filtrados);
      setErrorBusquedaContribuyenteAgua("");
      setSelectedContribuyenteAgua(() => {
        if (!idSeleccionado) return null;
        return filtrados.find((row) => Number(row?.id_contribuyente || 0) === idSeleccionado) || null;
      });
      setBusquedaContribuyenteRealizada(true);
    } catch (err) {
      if (requestId !== busquedaAguaRequestSeqRef.current) return;
      const msg = handleApiError(err, "No se pudo buscar contribuyentes.");
      setErrorBusquedaContribuyenteAgua(msg);
    } finally {
      if (requestId === busquedaAguaRequestSeqRef.current) {
        setBuscandoContribuyenteAgua(false);
      }
    }
  }, [busquedaContribuyenteAgua, handleApiError, selectedContribuyenteAgua?.id_contribuyente, showFlash]);

  const buscarContribuyentesLuz = useCallback(async ({ preserveSelectedId = 0, force = false } = {}) => {
    const qRaw = String(busquedaContribuyenteLuz || "").trim();
    if (!qRaw) {
      setBusquedaContribuyenteLuzRealizada(true);
      setContribuyentesFiltradosLuz([]);
      setErrorBusquedaContribuyenteLuz("");
      setSelectedContribuyenteLuz(null);
      showFlash("warning", "Digite zona, ID usuario, nombre o dirección para buscar en luz.");
      return;
    }

    const cacheKey = buildSearchCacheKey(qRaw);
    const requestId = busquedaLuzRequestSeqRef.current + 1;
    busquedaLuzRequestSeqRef.current = requestId;
    const idSeleccionado = Number(preserveSelectedId || selectedContribuyenteLuz?.id_suministro || 0);
    const startedAt = Date.now();
    try {
      if (!force) {
        const cachedRows = readSearchCacheValue(busquedaLuzCacheRef, cacheKey);
        if (cachedRows) {
          setContribuyentesFiltradosLuz(cachedRows);
          setErrorBusquedaContribuyenteLuz("");
          setSelectedContribuyenteLuz(() => {
            if (!idSeleccionado) return null;
            return cachedRows.find((row) => Number(row?.id_suministro || 0) === idSeleccionado) || null;
          });
          setBusquedaContribuyenteLuzRealizada(true);
          return;
        }
      }

      setErrorBusquedaContribuyenteLuz("");
      setBuscandoContribuyenteLuz(true);
      const res = await cajaLuzApi.get("/caja/suministros", {
        params: {
          q: qRaw,
          limit: SEARCH_RESULTS_LIMIT_LUZ
        }
      });
      if (requestId !== busquedaLuzRequestSeqRef.current) return;
      const filtrados = (Array.isArray(res.data) ? res.data : []).map((row) => ({
        ...row,
        id_suministro: Number(row?.id_suministro || 0),
        id_zona: Number(row?.id_zona || 0),
        meses_deuda: Number(row?.meses_deuda || 0),
        deuda_total: round2(parseMonto(row?.deuda_total ?? 0)),
        abono_total: round2(parseMonto(row?.abono_total ?? 0))
      }));
      if (import.meta.env.DEV) {
        const durationMs = Date.now() - startedAt;
        if (durationMs > SEARCH_WARN_THRESHOLD_MS) {
          console.warn("[CAJA][BUSQUEDA_LUZ_LENTA]", {
            q: qRaw,
            durationMs,
            results: filtrados.length
          });
        }
      }
      writeSearchCacheValue(busquedaLuzCacheRef, cacheKey, filtrados);

      setContribuyentesFiltradosLuz(filtrados);
      setErrorBusquedaContribuyenteLuz("");
      setSelectedContribuyenteLuz(() => {
        if (!idSeleccionado) return null;
        return filtrados.find((row) => Number(row?.id_suministro || 0) === idSeleccionado) || null;
      });
      setBusquedaContribuyenteLuzRealizada(true);
    } catch (err) {
      if (requestId !== busquedaLuzRequestSeqRef.current) return;
      const msg = handleApiError(err, "No se pudo buscar contribuyentes de luz.");
      setErrorBusquedaContribuyenteLuz(msg);
    } finally {
      if (requestId === busquedaLuzRequestSeqRef.current) {
        setBuscandoContribuyenteLuz(false);
      }
    }
  }, [busquedaContribuyenteLuz, handleApiError, selectedContribuyenteLuz?.id_suministro, showFlash]);

  const abrirCobroDirectoLuz = useCallback(async () => {
    const idSuministro = Number(selectedContribuyenteLuz?.id_suministro || 0);
    if (!idSuministro) {
      showFlash("warning", "Seleccione un contribuyente de luz para cobrar.");
      return;
    }
    setRecibosPendientesCobroLuz([]);
    setSeleccionCobroLuz({});
    setMetodoPagoLuz("EFECTIVO");
    setReferenciaPagoLuz("");
    setEstadoConfirmacionPagoLuz("CONFIRMADO");
    setMostrarModalCobroLuz(true);
    setLoadingPendientesCobroLuz(true);
    try {
      const res = await cajaLuzApi.get(`/caja/recibos/pendientes/${idSuministro}`);
      const pendientes = (Array.isArray(res.data) ? res.data : [])
        .map((row) => ({
          ...row,
          id_recibo: Number(row?.id_recibo || 0),
          anio: Number(row?.anio || 0),
          mes: Number(row?.mes || 0),
          deuda_mes: round2(parseMonto(row?.deuda_mes ?? row?.total_pagar ?? 0)),
          abono_mes: round2(parseMonto(row?.abono_mes ?? 0))
        }))
        .filter((row) => row.id_recibo > 0 && row.mes >= 1 && row.mes <= 12 && row.anio >= 1900);

      const initial = {};
      pendientes.forEach((row) => {
        const rowKey = getCobroLuzRowKey(row);
        const saldo = getCobroLuzRowSaldo(row);
        initial[rowKey] = {
          checked: false,
          monto: saldo.toFixed(2)
        };
      });

      setRecibosPendientesCobroLuz(pendientes);
      setSeleccionCobroLuz(initial);
      if (pendientes.length === 0) {
        showFlash("warning", "El suministro no tiene meses pendientes en luz.");
      }
    } catch (err) {
      setMostrarModalCobroLuz(false);
      handleApiError(err, "No se pudo cargar deuda pendiente de luz.");
    } finally {
      setLoadingPendientesCobroLuz(false);
    }
  }, [handleApiError, selectedContribuyenteLuz?.id_suministro, showFlash]);

  const abrirReimpresionLuz = useCallback(async () => {
    const idSuministro = Number(selectedContribuyenteLuz?.id_suministro || 0);
    if (!idSuministro) {
      showFlash("warning", "Seleccione un contribuyente de luz antes de reimprimir.");
      return;
    }
    setLoadingHistorialReimpresionLuz(true);
    try {
      const res = await cajaLuzApi.get(`/caja/recibos/historial/${idSuministro}`, { params: { anio: "all" } });
      const historial = Array.isArray(res.data) ? res.data : [];
      const pagados = historial
        .filter((row) => String(row?.estado || "").toUpperCase() === "PAGADO")
        .map((row) => ({
          ...row,
          id_recibo: Number(row?.id_recibo || 0),
          mes: Number(row?.mes || 0),
          anio: Number(row?.anio || 0)
        }))
        .filter((row) => row.id_recibo > 0 && row.mes >= 1 && row.mes <= 12 && row.anio >= 1900)
        .sort((a, b) => {
          if (a.anio !== b.anio) return b.anio - a.anio;
          if (a.mes !== b.mes) return b.mes - a.mes;
          return b.id_recibo - a.id_recibo;
        });
      if (pagados.length === 0) {
        showFlash("warning", "El suministro no tiene meses pagados para reimprimir.");
        setRecibosPagadosReimpresionLuz([]);
        setIdReciboReimpresionLuz(0);
        return;
      }
      setRecibosPagadosReimpresionLuz(pagados);
      setIdReciboReimpresionLuz(Number(pagados[0]?.id_recibo || 0));
      setMostrarModalReimpresionLuz(true);
    } catch (err) {
      handleApiError(err, "No se pudo cargar historial pagado de luz.");
    } finally {
      setLoadingHistorialReimpresionLuz(false);
    }
  }, [handleApiError, selectedContribuyenteLuz?.id_suministro, showFlash]);

  const confirmarReimpresionLuz = useCallback(() => {
    const idRecibo = Number(idReciboReimpresionLuz || 0);
    if (!idRecibo) {
      showFlash("warning", "Seleccione un mes pagado para reimprimir.");
      return;
    }
    const recibo = recibosPagadosReimpresionLuz.find((row) => Number(row?.id_recibo || 0) === idRecibo);
    if (!recibo) {
      showFlash("warning", "No se encontró el periodo seleccionado para reimpresión.");
      return;
    }

    setReciboLuzImpresion({
      recibo: {
        ...recibo,
        id_recibo: Number(recibo.id_recibo || 0)
      },
      suministro: {
        id_suministro: Number(selectedContribuyenteLuz?.id_suministro || 0),
        zona: selectedContribuyenteLuz?.zona || "",
        nro_medidor: selectedContribuyenteLuz?.nro_medidor || "",
        nro_medidor_real: selectedContribuyenteLuz?.nro_medidor_real || "",
        nombre_usuario: selectedContribuyenteLuz?.nombre_usuario || "",
        direccion: selectedContribuyenteLuz?.direccion || ""
      }
    });
    setMostrarModalReimpresionLuz(false);
  }, [idReciboReimpresionLuz, recibosPagadosReimpresionLuz, selectedContribuyenteLuz, showFlash]);

  const abrirModalConteoAgua = useCallback(() => {
    if (!permisos.canCaja) return;
    if (cajaCerradaAguaHoy) {
      showFlash("warning", "La caja de agua ya fue cerrada para hoy.");
      return;
    }
    setDeclaracionMetodosAgua(buildDeclaracionMetodosFromReporte(reporteAgua, resumenConteoAgua));
    setObservacionConteoAgua("");
    setMostrarModalConteoAgua(true);
  }, [cajaCerradaAguaHoy, permisos.canCaja, reporteAgua, resumenConteoAgua, showFlash]);

  const registrarConteoEfectivoAgua = useCallback(async () => {
    if (!permisos.canCaja) return;
    if (cajaCerradaAguaHoy) {
      showFlash("warning", "La caja de agua ya fue cerrada para hoy.");
      return;
    }
    const declaracionNormalizada = METODOS_PAGO_CAJA.reduce((acc, metodo) => {
      const monto = parseMonto(declaracionMetodosAgua?.[metodo.value]);
      acc[metodo.value] = round2(Math.max(0, monto));
      return acc;
    }, {});
    const totalDeclarado = totalDeclaracionMetodos(declaracionNormalizada);
    if (totalDeclarado < 0) {
      showFlash("danger", "Monto inválido para conteo de efectivo.");
      return;
    }
    const observacion = observacionConteoAgua;
    setEnviandoConteoAgua(true);
    try {
      const res = await api.post("/caja/conteo-efectivo", {
        monto_efectivo: declaracionNormalizada.EFECTIVO,
        declaracion_metodos: declaracionNormalizada,
        observacion,
        cerrar_caja: true
      });
      showFlash("success", res?.data?.mensaje || "Conteo de efectivo enviado.");
      setMostrarModalConteoAgua(false);
      await Promise.all([cargarConteoAgua(), cargarReporteAgua()]);
    } catch (err) {
      if (Number(err?.response?.status || 0) === 404) {
        showFlash("danger", "Ruta de conteo no disponible en el backend actual. Reinicie backend para aplicar la ruta.");
        return;
      }
      handleApiError(err, "No se pudo enviar el conteo de efectivo.");
    } finally {
      setEnviandoConteoAgua(false);
    }
  }, [cajaCerradaAguaHoy, cargarConteoAgua, cargarReporteAgua, declaracionMetodosAgua, handleApiError, observacionConteoAgua, permisos.canCaja, showFlash]);

  const cargarPeriodosCobroAgua = useCallback(async (
    idContribuyente,
    fechaCorte,
    { avisarVacio = false, permitirContingencia = false, force = false, preserveSelection = false } = {}
  ) => {
    const fecha = String(fechaCorte || "").trim();
    if (!isValidIsoDate(fecha)) return [];
    const permitirOverrideAdminFuturos = permisos.canAdminPagos && fecha !== toIsoDate();
    const cacheKey = buildCobroAguaCacheKey(idContribuyente, fecha, permitirContingencia, permitirOverrideAdminFuturos);
    const applyRows = (rowsToApply) => {
      const nextRows = Array.isArray(rowsToApply) ? rowsToApply : [];
      setRecibosPendientesCobroAgua(nextRows);
      setSeleccionCobroAgua((prev) => {
        const next = {};
        nextRows.forEach((row) => {
          const rowKey = getCobroAguaRowKey(row);
          const saldo = getCobroAguaRowSaldo(row);
          next[rowKey] = {
            checked: preserveSelection
              ? Boolean(prev[rowKey]?.checked) && canSelectCobroAguaRow(row, permisos, toIsoDate())
              : false,
            monto: preserveSelection
              ? finalizeMoneyInput(prev[rowKey]?.monto, { min: 0, max: round2(saldo), emptyValue: saldo.toFixed(2) })
              : saldo.toFixed(2)
          };
        });
        return next;
      });
      if (avisarVacio && nextRows.length === 0) {
        showFlash("warning", "No hay periodos disponibles para mostrar en cobro.");
      }
      return nextRows;
    };
    if (!force && cobroAguaCacheRef.current.has(cacheKey)) {
      return applyRows(cobroAguaCacheRef.current.get(cacheKey));
    }
    const requestId = ++cobroAguaRequestSeqRef.current;
    const [resPendientes, resHistorial] = await Promise.all([
      api.get(`/recibos/pendientes/${idContribuyente}`, {
        params: {
          incluir_adelantados: "S",
          adelantado_meses: 12,
          incluir_futuros_existentes: permitirContingencia ? "N" : "S",
          solo_futuros_habilitados: permitirOverrideAdminFuturos ? "N" : "S",
          fecha_corte: fecha
        }
      }),
      api.get(`/recibos/historial/${idContribuyente}`, {
        params: {
          anio: "all",
          fecha_corte: fecha,
          incluir_futuros: "S"
        }
      })
    ]);
    const pendientes = Array.isArray(resPendientes.data) ? resPendientes.data : [];
    const historial = Array.isArray(resHistorial.data) ? resHistorial.data : [];
    const buildCobroMapKey = (row = {}) => {
      const anio = Number(row?.anio || 0);
      const mes = Number(row?.mes || 0);
      return `p-${anio}-${mes}`;
    };
    const byPeriodo = new Map();
    historial.forEach((row) => {
      const mes = Number(row?.mes || 0);
      const anio = Number(row?.anio || 0);
      if (mes < 1 || mes > 12 || anio < 1900) return;
      const key = buildCobroMapKey(row);
      byPeriodo.set(key, normalizeCobroAguaRowConsistency({
        ...row,
        id_recibo: Number(row?.id_recibo || 0) || null,
        mes,
        anio,
        subtotal_agua: round2(parseMonto(row?.subtotal_agua)),
        subtotal_desague: round2(parseMonto(row?.subtotal_desague)),
        subtotal_limpieza: round2(parseMonto(row?.subtotal_limpieza)),
        subtotal_admin: round2(parseMonto(row?.subtotal_admin)),
        total_pagar: round2(parseMonto(row?.total_pagar ?? 0)),
        abono_mes: round2(parseMonto(row?.abono_mes ?? 0)),
        deuda_mes: round2(parseMonto(row?.deuda_mes ?? 0)),
        estado: String(row?.estado || ""),
        es_adelantado: false
      }, fecha));
    });
    pendientes.forEach((row) => {
      const mes = Number(row?.mes || 0);
      const anio = Number(row?.anio || 0);
      if (mes < 1 || mes > 12 || anio < 1900) return;
      const esAdelantadoSinRecibo = Number(row?.id_recibo || 0) <= 0 && Boolean(row?.es_adelantado);
      if (esAdelantadoSinRecibo) {
        const existeReciboRealMismoPeriodo = Array.from(byPeriodo.values()).some((it) =>
          Number(it?.anio || 0) === anio
          && Number(it?.mes || 0) === mes
          && Number(it?.id_recibo || 0) > 0
        );
        if (existeReciboRealMismoPeriodo) return;
      }
      const key = buildCobroMapKey(row);
      const prev = byPeriodo.get(key);
      const deudaMes = round2(parseMonto(row?.deuda_mes ?? row?.total_pagar ?? 0));
      byPeriodo.set(key, normalizeCobroAguaRowConsistency({
        ...(prev || {}),
        ...row,
        id_recibo: Number(row?.id_recibo || 0) > 0
          ? Number(row?.id_recibo || 0)
          : (Number(prev?.id_recibo || 0) || null),
        mes,
        anio,
        subtotal_agua: round2(parseMonto(row?.subtotal_agua ?? prev?.subtotal_agua, 0)),
        subtotal_desague: round2(parseMonto(row?.subtotal_desague ?? prev?.subtotal_desague, 0)),
        subtotal_limpieza: round2(parseMonto(row?.subtotal_limpieza ?? prev?.subtotal_limpieza, 0)),
        subtotal_admin: round2(parseMonto(row?.subtotal_admin ?? prev?.subtotal_admin, 0)),
        total_pagar: round2(parseMonto(row?.total_pagar ?? prev?.total_pagar ?? deudaMes, 0)),
        abono_mes: round2(parseMonto(row?.abono_mes ?? prev?.abono_mes ?? 0, 0)),
        deuda_mes: round2(parseMonto(deudaMes ?? prev?.deuda_mes ?? 0, 0)),
        estado: String(row?.estado || prev?.estado || ""),
        es_adelantado: Boolean(row?.es_adelantado) || (Number(row?.id_recibo ?? 0) <= 0 && deudaMes > 0)
      }, fecha));
    });
    const rows = Array.from(byPeriodo.values()).sort((a, b) => {
      const pa = (Number(a?.anio || 0) * 100) + Number(a?.mes || 0);
      const pb = (Number(b?.anio || 0) * 100) + Number(b?.mes || 0);
      if (pa !== pb) return pa - pb;
      const ia = Number(a?.id_recibo || 0);
      const ib = Number(b?.id_recibo || 0);
      if (ia !== ib) return ia - ib;
      return String(a?.estado || "").localeCompare(String(b?.estado || ""));
    });
    if (requestId !== cobroAguaRequestSeqRef.current) {
      return rows;
    }
    cobroAguaCacheRef.current.set(cacheKey, rows);
    return applyRows(rows);
  }, [permisos, permisos.canAdminPagos, showFlash]);

  const abrirCobroDirectoAgua = async () => {
    const idContribuyente = Number(selectedContribuyenteAgua?.id_contribuyente || 0);
    if (!idContribuyente) {
      showFlash("warning", "Seleccione un contribuyente para cobrar.");
      return;
    }
    if (cajaCerradaAguaHoy && !permisos.canAdminPagos) {
      showFlash("warning", "Caja cerrada para hoy. No se permiten más cobros.");
      return;
    }
    const hoy = toIsoDate();
    setFechaCobroAgua(hoy);
    setModoCobroAgua(COBRO_AGUA_MODOS.CAJA);
    setMotivoCobroAgua("");
    setMetodoPagoAgua("EFECTIVO");
    setReferenciaPagoAgua("");
    setEstadoConfirmacionPagoAgua("CONFIRMADO");
    setObservacionPagoAgua("");
    setPermitirContingenciaAgua(false);
    setRecibosPendientesCobroAgua([]);
    setSeleccionCobroAgua({});
    setAnioVistaCobroAgua(Number(hoy.slice(0, 4)) || 0);
    setActualizandoPeriodosCobroAgua(false);
    setMostrarModalCobroAgua(true);
    setLoadingPendientesCobroAgua(true);
    try {
      await cargarPeriodosCobroAgua(idContribuyente, hoy, {
        avisarVacio: true,
        permitirContingencia: false
      });
    } catch (err) {
      setMostrarModalCobroAgua(false);
      handleApiError(err, "No se pudo cargar los periodos de cobro del contribuyente.");
    } finally {
      setLoadingPendientesCobroAgua(false);
    }
  };

  const onChangeFechaCobroAgua = useCallback(async (nextFecha) => {
    const fecha = String(nextFecha || "").trim();
    setFechaCobroAgua(fecha);
    setAnioVistaCobroAgua(Number(fecha.slice(0, 4)) || 0);
    if (!mostrarModalCobroAgua) return;
    const idContribuyente = Number(selectedContribuyenteAgua?.id_contribuyente || 0);
    if (!idContribuyente || !isValidIsoDate(fecha)) return;
    const hoy = toIsoDate();
    const fechaMinima = permisos.fechaCobroMinima || "";
    if (fecha > hoy) return;
    if (fechaMinima && fecha < fechaMinima) return;
    setActualizandoPeriodosCobroAgua(true);
    try {
      await cargarPeriodosCobroAgua(idContribuyente, fecha, {
        permitirContingencia: permitirContingenciaAgua
      });
    } catch (err) {
      handleApiError(err, "No se pudo actualizar los periodos para la fecha seleccionada.");
    } finally {
      setActualizandoPeriodosCobroAgua(false);
    }
  }, [
    cargarPeriodosCobroAgua,
    handleApiError,
    mostrarModalCobroAgua,
    permisos.fechaCobroMinima,
    permitirContingenciaAgua,
    selectedContribuyenteAgua
  ]);

  const toggleContingenciaCobroAgua = useCallback(async () => {
    const next = !permitirContingenciaAgua;
    setPermitirContingenciaAgua(next);
    if (!mostrarModalCobroAgua) return;
    const idContribuyente = Number(selectedContribuyenteAgua?.id_contribuyente || 0);
    const fecha = String(fechaCobroAgua || "").trim();
    if (!idContribuyente || !isValidIsoDate(fecha)) return;
    setActualizandoPeriodosCobroAgua(true);
    try {
      await cargarPeriodosCobroAgua(idContribuyente, fecha, {
        permitirContingencia: next
      });
    } catch (err) {
      handleApiError(err, "No se pudo actualizar los periodos al cambiar modo de contingencia.");
    } finally {
      setActualizandoPeriodosCobroAgua(false);
    }
  }, [
    cargarPeriodosCobroAgua,
    fechaCobroAgua,
    handleApiError,
    mostrarModalCobroAgua,
    permitirContingenciaAgua,
    selectedContribuyenteAgua
  ]);

  const editarMontoPagoAgua = useCallback(async (row) => {
    if (!permisos.canCorregirPagos) return;
    if (!canCorrectCobroAguaRowByDate(row, permisos, toIsoDate())) {
      showFlash("warning", `Caja solo puede editar pagos registrados dentro de los ultimos ${MAX_RETROACTIVE_COBRO_DAYS_CAJA} dias.`);
      return;
    }
    const idPago = Number(row?.id_ultimo_pago || 0);
    if (!idPago) {
      showFlash("warning", "No se encontro el pago activo para editar este periodo.");
      return;
    }
    const periodo = `${String(row?.mes || "").padStart(2, "0")}/${row?.anio || "-"}`;
    const montoActual = round2(parseMonto(row?.abono_mes ?? 0));
    const montoMaximo = round2(parseMonto(row?.total_pagar ?? montoActual));
    const montoRaw = window.prompt(
      `Nuevo monto para ${periodo} (maximo ${montoMaximo.toFixed(2)}):`,
      montoActual.toFixed(2)
    );
    if (montoRaw === null) return;
    const nuevoMonto = round2(parseMonto(String(montoRaw || "").replace(",", ".")));
    if (nuevoMonto <= 0) {
      showFlash("warning", "Ingrese un monto válido para editar el pago.");
      return;
    }
    if (nuevoMonto > montoMaximo + 0.001) {
      showFlash("warning", `El monto no puede exceder ${formatMoney(montoMaximo)} en este periodo.`);
      return;
    }
    const motivo = String(
      window.prompt("Motivo de la edicion de monto:", `Correccion administrativa del periodo ${periodo}.`) || ""
    ).trim();
    if (!motivo) {
      showFlash("warning", "Debe indicar un motivo para editar el monto del pago.");
      return;
    }
    setEditandoPagoCobroAguaId(idPago);
    const idContribuyenteActual = Number(
      selectedContribuyenteAgua?.id_contribuyente
      || row?.id_contribuyente
      || 0
    );
    const fecha = String(fechaCobroAgua || "").trim() || toIsoDate();
    try {
      const res = await api.post(`/pagos/${idPago}/editar`, {
        monto_pagado: nuevoMonto,
        motivo
      });
      showFlash("success", res?.data?.mensaje || "Monto del pago actualizado.");
      invalidarCobroAguaCache();
      invalidarBusquedaCajaCache();
      const idContribuyenteRefresco = Number(
        res?.data?.pago?.id_contribuyente
        || idContribuyenteActual
        || 0
      );
      if (idContribuyenteRefresco > 0) {
        setActualizandoPeriodosCobroAgua(true);
        await cargarPeriodosCobroAgua(idContribuyenteRefresco, fecha, {
          permitirContingencia: permitirContingenciaAgua,
          force: true
        });
      }
      await Promise.all([
        recargarAgua(),
        buscarContribuyentesAgua({ preserveSelectedId: idContribuyenteRefresco, force: true })
      ]);
    } catch (err) {
      handleApiError(err, "No se pudo editar el monto del pago seleccionado.");
    } finally {
      setActualizandoPeriodosCobroAgua(false);
      setEditandoPagoCobroAguaId(0);
    }
  }, [
    buscarContribuyentesAgua,
    cargarPeriodosCobroAgua,
    fechaCobroAgua,
    handleApiError,
    invalidarCobroAguaCache,
    invalidarBusquedaCajaCache,
    permisos.canCorregirPagos,
    permitirContingenciaAgua,
    recargarAgua,
    selectedContribuyenteAgua,
    showFlash
  ]);

  const anularPagoMesCobroAgua = useCallback(async (row) => {
    if (!permisos.canCorregirPagos) return;
    if (!canCorrectCobroAguaRowByDate(row, permisos, toIsoDate())) {
      showFlash("warning", `Caja solo puede anular pagos registrados dentro de los ultimos ${MAX_RETROACTIVE_COBRO_DAYS_CAJA} dias.`);
      return;
    }
    const idRecibo = Number(row?.id_recibo || 0);
    if (!idRecibo) {
      showFlash("warning", "No se puede anular este periodo porque no tiene recibo asociado.");
      return;
    }
    const periodo = `${String(row?.mes || "").padStart(2, "0")}/${row?.anio || "-"}`;
    const motivo = String(
      window.prompt("Motivo de la anulacion:", `Correccion administrativa del periodo ${periodo}.`) || ""
    ).trim();
    if (!motivo) {
      showFlash("warning", "Debe indicar un motivo para anular el pago.");
      return;
    }
    const confirmado = window.confirm(`Anular todos los pagos activos del periodo ${periodo} para volver a registrarlo correctamente?`);
    if (!confirmado) return;
    const idContribuyente = Number(
      selectedContribuyenteAgua?.id_contribuyente
      || row?.id_contribuyente
      || 0
    );
    const fecha = String(fechaCobroAgua || "").trim() || toIsoDate();
    setAnulandoReciboCobroAguaId(idRecibo);
    try {
      const res = await api.post(`/pagos/recibo/${idRecibo}/anular-ultimo`, { motivo });
      showFlash("success", res?.data?.mensaje || "Pago anulado para correccion.");
      invalidarCobroAguaCache();
      invalidarBusquedaCajaCache();
      if (idContribuyente > 0) {
        setActualizandoPeriodosCobroAgua(true);
        await cargarPeriodosCobroAgua(idContribuyente, fecha, {
          permitirContingencia: permitirContingenciaAgua,
          force: true
        });
      }
      await Promise.all([
        recargarAgua(),
        buscarContribuyentesAgua({ preserveSelectedId: idContribuyente, force: true })
      ]);
    } catch (err) {
      handleApiError(err, "No se pudo anular el pago del periodo seleccionado.");
    } finally {
      setActualizandoPeriodosCobroAgua(false);
      setAnulandoReciboCobroAguaId(0);
    }
  }, [
    buscarContribuyentesAgua,
    cargarPeriodosCobroAgua,
    fechaCobroAgua,
    handleApiError,
    invalidarCobroAguaCache,
    invalidarBusquedaCajaCache,
    permisos.canCorregirPagos,
    recargarAgua,
    selectedContribuyenteAgua,
    permitirContingenciaAgua,
    showFlash
  ]);

  const setMontoCobroAgua = useCallback((rowKey, value, maxSaldo) => {
    const clamped = normalizeMoneyTyping(value, { max: round2(maxSaldo) });
    if (clamped === null) return;
    setSeleccionCobroAgua((prev) => ({
      ...prev,
      [rowKey]: {
        ...(prev[rowKey] || {}),
        monto: clamped
      }
    }));
  }, []);

  const finalizarMontoCobroAgua = useCallback((rowKey, maxSaldo) => {
    setSeleccionCobroAgua((prev) => ({
      ...prev,
      [rowKey]: {
        ...(prev[rowKey] || {}),
        monto: finalizeMoneyInput(prev[rowKey]?.monto, { min: 0, max: round2(maxSaldo), emptyValue: "0.00" })
      }
    }));
  }, []);

  const toggleCobroAgua = useCallback((rowKey) => {
    setSeleccionCobroAgua((prev) => ({
      ...prev,
      [rowKey]: {
        ...(prev[rowKey] || {}),
        checked: !prev[rowKey]?.checked
      }
    }));
  }, []);

  const totalCobroDirectoAgua = useMemo(() => round2(
    recibosPendientesCobroAgua.reduce((acc, row) => {
      const rowKey = getCobroAguaRowKey(row);
      const selected = seleccionCobroAgua[rowKey];
      if (!selected?.checked) return acc;
      return acc + parseMonto(selected?.monto);
    }, 0)
  ), [recibosPendientesCobroAgua, seleccionCobroAgua]);

  const setMontoCobroLuz = useCallback((rowKey, value, maxSaldo) => {
    const clamped = normalizeMoneyTyping(value, { max: round2(maxSaldo) });
    if (clamped === null) return;
    setSeleccionCobroLuz((prev) => ({
      ...prev,
      [rowKey]: {
        ...(prev[rowKey] || {}),
        monto: clamped
      }
    }));
  }, []);

  const finalizarMontoCobroLuz = useCallback((rowKey, maxSaldo) => {
    setSeleccionCobroLuz((prev) => ({
      ...prev,
      [rowKey]: {
        ...(prev[rowKey] || {}),
        monto: finalizeMoneyInput(prev[rowKey]?.monto, { min: 0, max: round2(maxSaldo), emptyValue: "0.00" })
      }
    }));
  }, []);

  const toggleCobroLuz = useCallback((rowKey) => {
    setSeleccionCobroLuz((prev) => ({
      ...prev,
      [rowKey]: {
        ...(prev[rowKey] || {}),
        checked: !prev[rowKey]?.checked
      }
    }));
  }, []);

  const totalCobroDirectoLuz = useMemo(() => round2(
    recibosPendientesCobroLuz.reduce((acc, row) => {
      const rowKey = getCobroLuzRowKey(row);
      const selected = seleccionCobroLuz[rowKey];
      if (!selected?.checked) return acc;
      return acc + parseMonto(selected?.monto);
    }, 0)
  ), [recibosPendientesCobroLuz, seleccionCobroLuz]);

  const cobrarDirectoAgua = useCallback(async () => {
    if (!permisos.canCaja) return;
    const idContribuyente = Number(selectedContribuyenteAgua?.id_contribuyente || 0);
    if (!idContribuyente) {
      showFlash("warning", "Seleccione un contribuyente para cobrar.");
      return;
    }
    const fechaPago = String(fechaCobroAgua || "").trim();
    const esCompensacion = modoCobroAgua === COBRO_AGUA_MODOS.COMPENSACION;
    const motivoCompensacion = String(motivoCobroAgua || "").trim();
    const hoy = toIsoDate();
    const fechaMinimaPermitida = permisos.fechaCobroMinima || "";
    if (!isValidIsoDate(fechaPago)) {
      showFlash("warning", "Seleccione una fecha valida para registrar el cobro.");
      return;
    }
    if (fechaPago > hoy) {
      showFlash("warning", "No se permite registrar cobros con fecha futura.");
      return;
    }
    if (fechaMinimaPermitida && fechaPago < fechaMinimaPermitida) {
      const limiteDias = Number(permisos.maxDiasRetroactivoCobro);
      showFlash(
        "warning",
        Number.isFinite(limiteDias) && limiteDias >= 0
          ? `Solo se permite registrar cobros con antiguedad maxima de ${limiteDias} dia(s). Fecha minima: ${fechaMinimaPermitida}.`
          : `No se permite registrar cobros con fecha menor a ${fechaMinimaPermitida}.`
      );
      return;
    }
    if (esCompensacion && !permisos.canAdminPagos) {
      showFlash("warning", "Solo Administracion puede registrar compensaciones.");
      return;
    }
    if (esCompensacion && !motivoCompensacion) {
      showFlash("warning", "Indique el motivo de la compensacion.");
      return;
    }
    const metodoPago = normalizeMetodoPagoCaja(metodoPagoAgua);
    const metodoConfig = getMetodoPagoConfig(metodoPago);
    const referenciaPago = String(referenciaPagoAgua || "").trim();
    const estadoConfirmacion = normalizeEstadoConfirmacionPago(estadoConfirmacionPagoAgua);
    const observacionPago = String(observacionPagoAgua || "").trim();
    if (!esCompensacion && metodoConfig.requiereReferencia && !referenciaPago) {
      showFlash("warning", `Ingrese numero de operacion o referencia para ${metodoConfig.label}.`);
      return;
    }
    const pagos = [];
    const anexoItems = [];
    for (const row of recibosPendientesCobroAgua) {
      const idRecibo = Number(row?.id_recibo || 0);
      const mes = Number(row?.mes || 0);
      const anio = Number(row?.anio || 0);
      const rowKey = getCobroAguaRowKey(row);
      const sel = seleccionCobroAgua[rowKey];
      const idAnulacionReferencia = Number(row?.id_anulacion_pendiente || 0);
      if (!sel?.checked) continue;
      const saldo = getCobroAguaRowSaldo(row);
      const monto = round2(parseMonto(sel?.monto));
      if (monto <= 0) continue;
      if (monto > saldo + 0.001) {
        showFlash("warning", `El monto ingresado excede el saldo del periodo ${mes}/${anio}.`);
        return;
      }
      if (idRecibo > 0) {
        pagos.push({
          id_recibo: idRecibo,
          anio,
          mes,
          monto_pagado: monto,
          id_anulacion_referencia: idAnulacionReferencia > 0 ? idAnulacionReferencia : undefined
        });
      } else if (mes >= 1 && mes <= 12 && anio >= 1900) {
        pagos.push({ anio, mes, monto_pagado: monto });
      } else {
        showFlash("warning", "Hay un periodo inválido seleccionado para cobro.");
        return;
      }
      anexoItems.push({
        id_recibo: idRecibo,
        ...buildDetalleProrrateadoRecibo(row, monto),
        mes,
        anio,
        monto_pagado: monto
      });
    }
    if (pagos.length === 0) {
      showFlash("warning", "Seleccione al menos un mes con monto válido para cobrar.");
      return;
    }
    const confirm = window.confirm(
      esCompensacion
        ? `Registrar compensacion por ${formatMoney(totalCobroDirectoAgua)} con fecha ${fechaPago} y dejarla fuera del reporte de caja?`
        : `Registrar cobro por ${formatMoney(totalCobroDirectoAgua)} con ${metodoConfig.label} y abrir impresion?`
    );
    if (!confirm) return;
    setCobrandoDirectoAgua(true);
    try {
      const res = await api.post("/pagos", {
        id_contribuyente: idContribuyente,
        pagos,
        fecha_pago: fechaPago,
        tipo_pago: esCompensacion ? COBRO_AGUA_MODOS.COMPENSACION : COBRO_AGUA_MODOS.CAJA,
        metodo_pago: esCompensacion ? undefined : metodoPago,
        referencia_operacion: esCompensacion ? undefined : referenciaPago,
        estado_confirmacion: esCompensacion ? undefined : estadoConfirmacion,
        observacion_pago: esCompensacion ? undefined : observacionPago,
        motivo: esCompensacion ? motivoCompensacion : undefined
      });
      showFlash("success", res?.data?.mensaje || "Cobro registrado correctamente.");
      const pagosAplicadosServidor = Array.isArray(res?.data?.pagos) ? res.data.pagos : [];
      const anexoItemsFinal = pagosAplicadosServidor.length > 0
        ? pagosAplicadosServidor.map((pago) => {
          const idPagoRecibo = Number(pago?.id_recibo || 0);
          const mesPago = Number(pago?.mes || 0);
          const anioPago = Number(pago?.anio || 0);
          const rowOriginal = recibosPendientesCobroAgua.find((row) => {
            const idRow = Number(row?.id_recibo || 0);
            if (idPagoRecibo > 0 && idRow === idPagoRecibo) return true;
            return Number(row?.mes || 0) === mesPago && Number(row?.anio || 0) === anioPago;
          });
          const montoAplicado = round2(parseMonto(pago?.monto_pagado ?? pago?.monto_cobrado ?? pago?.monto_autorizado));
          return {
            id_recibo: idPagoRecibo,
            ...(rowOriginal ? buildDetalleProrrateadoRecibo(rowOriginal, montoAplicado) : buildDetalleProrrateadoRecibo(pago, montoAplicado)),
            mes: mesPago || Number(rowOriginal?.mes || 0),
            anio: anioPago || Number(rowOriginal?.anio || 0),
            monto_pagado: montoAplicado
          };
        })
        : anexoItems;
      const huboAjusteSaldo = pagosAplicadosServidor.some((pago) => Boolean(pago?.ajustado_al_saldo));
      if (huboAjusteSaldo) {
        showFlash("info", "Uno o más montos se ajustaron al saldo real del recibo para evitar sobrecobros.");
      }
      const anexoData = buildAnexoDataFromPagoDirecto(selectedContribuyenteAgua, anexoItemsFinal);
      anexoData.pago = esCompensacion ? null : {
        metodo_pago: metodoPago,
        metodo_label: metodoConfig.label,
        referencia_operacion: referenciaPago,
        estado_confirmacion: estadoConfirmacion
      };
      setDatosAnexoCajaImprimir(anexoData);
      invalidarCobroAguaCache();
      invalidarBusquedaCajaCache();
      setMostrarModalCobroAgua(false);
      await Promise.all([
        recargarAgua(),
        buscarContribuyentesAgua({ preserveSelectedId: idContribuyente, force: true })
      ]);
    } catch (err) {
      handleApiError(err, "No se pudo registrar el cobro directo.");
    } finally {
      setCobrandoDirectoAgua(false);
    }
  }, [
    buscarContribuyentesAgua,
    handleApiError,
    invalidarCobroAguaCache,
    invalidarBusquedaCajaCache,
    permisos.canCaja,
    permisos.canAdminPagos,
    permisos.fechaCobroMinima,
    permisos.maxDiasRetroactivoCobro,
    recibosPendientesCobroAgua,
    recargarAgua,
    selectedContribuyenteAgua,
    seleccionCobroAgua,
    showFlash,
    fechaCobroAgua,
    modoCobroAgua,
    motivoCobroAgua,
    metodoPagoAgua,
    referenciaPagoAgua,
    estadoConfirmacionPagoAgua,
    observacionPagoAgua,
    totalCobroDirectoAgua
  ]);

  const cobrarDirectoLuz = useCallback(async () => {
    if (!permisos.canCaja) return;
    const idSuministro = Number(selectedContribuyenteLuz?.id_suministro || 0);
    if (!idSuministro) {
      showFlash("warning", "Seleccione un contribuyente de luz para cobrar.");
      return;
    }
    const metodoPago = normalizeMetodoPagoCaja(metodoPagoLuz);
    const metodoConfig = getMetodoPagoConfig(metodoPago);
    const referenciaPago = String(referenciaPagoLuz || "").trim();
    const estadoConfirmacion = normalizeEstadoConfirmacionPago(estadoConfirmacionPagoLuz);
    if (metodoConfig.requiereReferencia && !referenciaPago) {
      showFlash("warning", `Ingrese numero de operacion o referencia para ${metodoConfig.label}.`);
      return;
    }

    const items = [];
    for (const row of recibosPendientesCobroLuz) {
      const rowKey = getCobroLuzRowKey(row);
      const sel = seleccionCobroLuz[rowKey];
      if (!sel?.checked) continue;
      const saldo = getCobroLuzRowSaldo(row);
      const monto = round2(parseMonto(sel?.monto));
      if (monto <= 0) continue;
      if (monto > saldo + 0.001) {
        showFlash("warning", `El monto ingresado excede el saldo del periodo ${row?.mes}/${row?.anio}.`);
        return;
      }
      items.push({
        id_recibo: Number(row?.id_recibo || 0),
        monto_autorizado: monto
      });
    }

    if (items.length === 0) {
      showFlash("warning", "Seleccione al menos un mes con monto válido para cobrar en luz.");
      return;
    }

    const confirmado = window.confirm(`Registrar cobro de luz por ${formatMoney(totalCobroDirectoLuz)} con ${metodoConfig.label} y abrir impresion?`);
    if (!confirmado) return;

    setCobrandoDirectoLuz(true);
    try {
      const emision = await cajaLuzApi.post("/caja/ordenes-cobro", {
        id_suministro: idSuministro,
        items
      });
      const idOrden = Number(emision?.data?.orden?.id_orden || 0);
      if (!idOrden) {
        showFlash("warning", "No se pudo obtener el numero de orden de luz.");
        return;
      }
      const cobro = await cajaLuzApi.post(`/caja/ordenes-cobro/${idOrden}/cobrar`, {
        metodo_pago: metodoPago,
        referencia_operacion: referenciaPago,
        estado_confirmacion: estadoConfirmacion
      });
      showFlash("success", cobro?.data?.mensaje || emision?.data?.mensaje || "Cobro de luz registrado.");
      setMostrarModalCobroLuz(false);
      invalidarBusquedaCajaCache();
      await Promise.all([recargarLuz(), buscarContribuyentesLuz({ preserveSelectedId: idSuministro, force: true })]);
    } catch (err) {
      handleApiError(err, "No se pudo registrar cobro de luz.");
    } finally {
      setCobrandoDirectoLuz(false);
    }
  }, [
    buscarContribuyentesLuz,
    handleApiError,
    invalidarBusquedaCajaCache,
    metodoPagoLuz,
    referenciaPagoLuz,
    estadoConfirmacionPagoLuz,
    recibosPendientesCobroLuz,
    recargarLuz,
    seleccionCobroLuz,
    selectedContribuyenteLuz?.id_suministro,
    showFlash,
    totalCobroDirectoLuz
  ]);

  const handlePrintAnexoCaja = useReactToPrint({
    contentRef: anexoCajaRef,
    documentTitle: "Anexo_Recibo_Agua",
    pageStyle: ANEXO_PAGE_STYLE,
    onAfterPrint: () => {
      isPrintingAnexoCajaRef.current = false;
      setImprimiendoAnexoCaja(false);
      setDatosAnexoCajaImprimir(null);
    }
  });

  const handlePrintReciboLuz = useReactToPrint({
    contentRef: reciboLuzRef,
    documentTitle: "Recibo_Luz_Caja",
    pageStyle: RECIBO_LUZ_PAGE_STYLE,
    onAfterPrint: () => {
      imprimiendoReciboLuzRef.current = false;
      setReciboLuzImpresion(null);
    }
  });

  useEffect(() => {
    if (!datosAnexoCajaImprimir) return;
    if (isPrintingAnexoCajaRef.current) return;
    isPrintingAnexoCajaRef.current = true;
    setImprimiendoAnexoCaja(true);
    const raf = requestAnimationFrame(() => {
      if (anexoCajaRef.current) {
        handlePrintAnexoCaja();
      } else {
        isPrintingAnexoCajaRef.current = false;
        setImprimiendoAnexoCaja(false);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [datosAnexoCajaImprimir, handlePrintAnexoCaja]);

  useEffect(() => {
    if (!reciboLuzImpresion) return;
    if (imprimiendoReciboLuzRef.current) return;
    const raf = requestAnimationFrame(() => {
      if (reciboLuzRef.current) {
        imprimiendoReciboLuzRef.current = true;
        handlePrintReciboLuz();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [handlePrintReciboLuz, reciboLuzImpresion]);

  const abrirReimpresionAgua = useCallback(async () => {
    const idContribuyente = Number(selectedContribuyenteAgua?.id_contribuyente || 0);
    if (!idContribuyente) {
      showFlash("warning", "Seleccione un contribuyente antes de reimprimir.");
      return;
    }
    setLoadingHistorialReimpresionAgua(true);
    try {
      const res = await api.get(`/recibos/historial/${idContribuyente}`, { params: { anio: "all" } });
      const historial = Array.isArray(res.data) ? res.data : [];
      const pagados = historial
        .filter((row) => String(row?.estado || "").toUpperCase() === "PAGADO")
        .map((row) => ({
          ...row,
          id_recibo: Number(row?.id_recibo || 0),
          mes: Number(row?.mes || 0),
          anio: Number(row?.anio || 0)
        }))
        .filter((row) => row.id_recibo > 0 && row.mes >= 1 && row.mes <= 12 && row.anio >= 1900)
        .sort((a, b) => {
          if (a.anio !== b.anio) return b.anio - a.anio;
          if (a.mes !== b.mes) return b.mes - a.mes;
          return b.id_recibo - a.id_recibo;
        });
      if (pagados.length === 0) {
        showFlash("warning", "El contribuyente no tiene meses pagados para reimprimir.");
        setRecibosPagadosReimpresionAgua([]);
        setIdReciboReimpresionAgua(0);
        return;
      }
      setRecibosPagadosReimpresionAgua(pagados);
      setIdReciboReimpresionAgua(Number(pagados[0]?.id_recibo || 0));
      setMostrarModalReimpresionAgua(true);
    } catch (err) {
      handleApiError(err, "No se pudo cargar el historial pagado para reimpresión.");
    } finally {
      setLoadingHistorialReimpresionAgua(false);
    }
  }, [handleApiError, selectedContribuyenteAgua?.id_contribuyente, showFlash]);

  const confirmarReimpresionAgua = useCallback(() => {
    const idRecibo = Number(idReciboReimpresionAgua || 0);
    if (!idRecibo) {
      showFlash("warning", "Seleccione un mes pagado para reimprimir.");
      return;
    }
    const recibo = recibosPagadosReimpresionAgua.find((row) => Number(row?.id_recibo || 0) === idRecibo);
    if (!recibo) {
      showFlash("warning", "No se encontró el periodo seleccionado para reimpresión.");
      return;
    }
    const anexoData = buildAnexoDataFromReciboPagado(selectedContribuyenteAgua, recibo);
    setDatosAnexoCajaImprimir(anexoData);
    setMostrarModalReimpresionAgua(false);
  }, [idReciboReimpresionAgua, recibosPagadosReimpresionAgua, selectedContribuyenteAgua, showFlash]);

  const totalPendienteAgua = useMemo(
    () => contribuyentesFiltradosAgua.reduce((acc, item) => acc + parseMonto(item.deuda_anio), 0),
    [contribuyentesFiltradosAgua]
  );
  const aniosCobroAgua = useMemo(
    () => buildCobroAguaVisibleYears(
      recibosPendientesCobroAgua,
      Number(String(fechaCobroAgua || "").slice(0, 4)) || 0
    ),
    [fechaCobroAgua, recibosPendientesCobroAgua]
  );
  const indiceAnioVistaCobroAgua = useMemo(
    () => aniosCobroAgua.findIndex((year) => year === anioVistaCobroAgua),
    [anioVistaCobroAgua, aniosCobroAgua]
  );
  const recibosPendientesCobroAguaVista = useMemo(
    () => buildCobroAguaYearRows(recibosPendientesCobroAgua, anioVistaCobroAgua),
    [anioVistaCobroAgua, recibosPendientesCobroAgua]
  );
  useEffect(() => {
    if (aniosCobroAgua.length === 0) {
      setAnioVistaCobroAgua(0);
      return;
    }
    const preferredYear = Number(String(fechaCobroAgua || "").slice(0, 4)) || 0;
    setAnioVistaCobroAgua((current) => {
      if (aniosCobroAgua.includes(current)) return current;
      if (preferredYear && aniosCobroAgua.includes(preferredYear)) return preferredYear;
      return aniosCobroAgua[0];
    });
  }, [aniosCobroAgua, fechaCobroAgua]);
  const totalPendienteLuz = useMemo(
    () => contribuyentesFiltradosLuz.reduce((acc, item) => acc + parseMonto(item.deuda_total), 0),
    [contribuyentesFiltradosLuz]
  );

  const cardsAgua = useMemo(() => ([
    {
      label: "RECAUDADO HOY",
      value: formatMoney(reporteAgua?.total_general || reporteAgua?.total || 0),
      className: "bg-success text-white"
    },
    {
      label: "MOVIMIENTOS HOY",
      value: String(Number(reporteAgua?.cantidad_movimientos || 0)),
      className: "bg-primary text-white"
    },
    {
      label: "DEUDA EN BÚSQUEDA",
      value: formatMoney(totalPendienteAgua),
      className: "bg-danger text-white"
    }
  ]), [reporteAgua, totalPendienteAgua]);

  const cardsLuz = useMemo(() => ([
    {
      label: "RECAUDADO HOY",
      value: formatMoney(reporteLuz?.total || 0),
      className: "bg-success text-white"
    },
    {
      label: "MOVIMIENTOS HOY",
      value: String(Number(reporteLuz?.cantidad_movimientos || 0)),
      className: "bg-primary text-white"
    },
    {
      label: "DEUDA EN BUSQUEDA",
      value: formatMoney(totalPendienteLuz),
      className: "bg-danger text-white"
    }
  ]), [reporteLuz, totalPendienteLuz]);

  const totalesSistemaMetodosAgua = useMemo(() => {
    const source = reporteAgua?.totales_por_metodo || reporteAgua?.totales_metodos || {};
    return METODOS_PAGO_CAJA.reduce((acc, metodo) => {
      acc[metodo.value] = round2(parseMonto(source?.[metodo.value] ?? source?.[metodo.value.toLowerCase()] ?? 0));
      return acc;
    }, {});
  }, [reporteAgua]);
  const totalSistemaMetodosAgua = useMemo(
    () => METODOS_PAGO_CAJA.reduce((acc, metodo) => round2(acc + parseMonto(totalesSistemaMetodosAgua?.[metodo.value])), 0),
    [totalesSistemaMetodosAgua]
  );
  const totalDeclaradoConteoAgua = useMemo(
    () => totalDeclaracionMetodos(declaracionMetodosAgua),
    [declaracionMetodosAgua]
  );
  const diferenciaConteoAgua = useMemo(
    () => round2(totalDeclaradoConteoAgua - totalSistemaMetodosAgua),
    [totalDeclaradoConteoAgua, totalSistemaMetodosAgua]
  );
  const setDeclaracionMetodoAgua = useCallback((metodo, value) => {
    const normalized = normalizeMoneyTyping(value);
    if (normalized === null) return;
    setDeclaracionMetodosAgua((prev) => ({
      ...prev,
      [metodo]: normalized
    }));
  }, []);
  const finalizarDeclaracionMetodoAgua = useCallback((metodo) => {
    setDeclaracionMetodosAgua((prev) => ({
      ...prev,
      [metodo]: finalizeMoneyInput(prev?.[metodo], { min: 0, emptyValue: "0.00" })
    }));
  }, []);

  if (!usuarioSistema) {
    return (
      <LoginPage
        apiClient={api}
        tokenStorageKey={AGUA_TOKEN_KEY}
        titulo="Caja Municipal Unificada"
        subtitulo="Cobranza de Agua y Luz"
        loginPath="/auth/login"
        registerPath="/auth/registro"
        onBackToSelector={onBackToSelector}
        onLoginSuccess={(datos) => {
          const nextUser = datos ? { ...datos, rol: normalizeRole(datos.rol) } : null;
          if (!nextUser || !canEnterCajaModuleByRole(nextUser.rol)) {
            alert("Acceso denegado. Caja Municipal requiere una cuenta ADMIN, ADMIN_SEC o CAJERO.");
            return;
          }
          setUsuarioSistema(nextUser);
        }}
      />
    );
  }

  if (!accesoCajaPermitido) {
    return (
      <div className="d-flex align-items-center justify-content-center min-vh-100 bg-light p-3">
        <div className="card shadow-sm" style={{ maxWidth: "560px", width: "100%" }}>
          <div className="card-body">
            <h5 className="card-title mb-2">Acceso restringido a Caja Municipal</h5>
            <p className="text-muted mb-3">
              Solo cuentas de tipo <strong>Administrador</strong> o <strong>Cajero</strong> pueden ingresar a este modulo.
            </p>
            <div className="d-flex gap-2">
              {typeof onBackToSelector === "function" && (
                <button className="btn btn-primary" onClick={onBackToSelector}>
                  Cambiar modulo
                </button>
              )}
              <button className="btn btn-outline-danger" onClick={logout}>
                Cerrar sesion
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="d-flex flex-column min-vh-100 bg-light">
      <header className="bg-warning-subtle border-bottom p-3 d-flex justify-content-between align-items-center gap-2">
        <div>
          <h5 className="m-0 d-flex align-items-center gap-2">
            <FaCashRegister className="text-primary" />
            Caja Municipal Unificada
          </h5>
          <div className="small text-muted">
            Usuario: <strong>{usuarioSistema?.nombre || usuarioSistema?.username}</strong> | {permisos.roleLabel}
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <img src="/logo.png" alt="Logo municipal" style={{ width: "42px", height: "42px", objectFit: "contain" }} className="rounded border bg-white p-1" />
          {typeof onBackToSelector === "function" && (
            <button className="btn btn-outline-secondary btn-sm" onClick={onBackToSelector}>
              Cambiar modulo
            </button>
          )}
          <button className="btn btn-outline-danger btn-sm d-flex align-items-center gap-2" onClick={logout}>
            <FaSignOutAlt />
            Cerrar sesion
          </button>
        </div>
      </header>

      <div className="container-fluid py-3 flex-grow-1">
        {flash && (
          <div className={`alert alert-${flash.type === "danger" ? "danger" : flash.type === "warning" ? "warning" : "success"} py-2`}>
            {flash.text}
          </div>
        )}

        <ul className="nav nav-tabs">
          <li className="nav-item">
            <button className={`nav-link ${tab === "agua" ? "active" : ""}`} onClick={() => setTab("agua")}>
              <FaTint className="me-1" />
              Caja Agua
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link ${tab === "luz" ? "active" : ""}`} onClick={() => setTab("luz")}>
              <FaBolt className="me-1" />
              Caja Luz
            </button>
          </li>
        </ul>

        <div className="card border-top-0 shadow-sm">
          <div className="card-body">
            <div className="d-flex justify-content-end mb-3 gap-2 flex-wrap">
              {tab === "agua" ? (
                <>
                  <button
                    className="btn btn-outline-primary d-flex align-items-center justify-content-center"
                    onClick={recargarAgua}
                    disabled={loadingAgua || loadingReporteAgua || loadingConteoAgua}
                    title={(loadingAgua || loadingReporteAgua || loadingConteoAgua) ? "Actualizando..." : "Recargar agua"}
                    aria-label="Recargar agua"
                    style={{ width: "42px", height: "38px" }}
                  >
                    <FaSyncAlt />
                  </button>
                  <button
                    className="btn btn-outline-secondary d-flex align-items-center gap-2"
                    onClick={() => setMostrarReporteCajaAgua(true)}
                  >
                    Ver reporte
                  </button>
                  <button
                    className="btn btn-outline-success d-flex align-items-center gap-2"
                    onClick={abrirModalConteoAgua}
                    disabled={enviandoConteoAgua || cajaCerradaAguaHoy}
                    title={cajaCerradaAguaHoy ? "Caja cerrada para hoy" : "Enviar conteo de efectivo y cerrar caja de hoy"}
                  >
                    {enviandoConteoAgua ? "Enviando conteo..." : (cajaCerradaAguaHoy ? "Caja cerrada hoy" : "Conteo y cierre")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn btn-outline-primary d-flex align-items-center justify-content-center"
                    onClick={recargarLuz}
                    disabled={loadingLuz || loadingReporteLuz}
                    title={(loadingLuz || loadingReporteLuz) ? "Actualizando..." : "Recargar luz"}
                    aria-label="Recargar luz"
                    style={{ width: "42px", height: "38px" }}
                  >
                    <FaSyncAlt />
                  </button>
                  <button
                    className="btn btn-outline-secondary d-flex align-items-center gap-2"
                    onClick={() => setMostrarReporteCajaLuz(true)}
                  >
                    Ver reporte
                  </button>
                </>
              )}
            </div>

            {tab === "agua" && (
              <>
                <div className="row g-3 mb-3">
                  {cardsAgua.map((card) => (
                    <div className="col-12 col-md-4" key={card.label}>
                      <div className={`rounded p-3 ${card.className}`}>
                        <div className="small fw-semibold opacity-75">{card.label}</div>
                        <div className="fs-2 fw-bold">{card.value}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border rounded p-3 mb-3">
                  <div className="fw-semibold mb-2">Buscar contribuyente para caja</div>
                  <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
                    <input
                      type="text"
                      className="form-control"
                      style={{ maxWidth: "420px" }}
                      placeholder="Digite apellidos completos, nombre y apellido, DNI o código"
                      value={busquedaContribuyenteAgua}
                      onChange={(e) => setBusquedaContribuyenteAgua(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          buscarContribuyentesAgua();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-outline-primary"
                      onClick={buscarContribuyentesAgua}
                      disabled={buscandoContribuyenteAgua}
                    >
                      {buscandoContribuyenteAgua ? "Buscando..." : "Buscar"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={abrirCobroDirectoAgua}
                      disabled={!selectedContribuyenteAgua || loadingPendientesCobroAgua || cobrandoDirectoAgua || cajaCerradaAguaHoy}
                      title={!selectedContribuyenteAgua ? "Seleccione un contribuyente de la tabla" : "Seleccionar meses y cobrar"}
                    >
                      {loadingPendientesCobroAgua ? "Cargando deuda..." : (cobrandoDirectoAgua ? "Cobrando..." : "Cobrar")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={abrirReimpresionAgua}
                      disabled={!selectedContribuyenteAgua || loadingHistorialReimpresionAgua || imprimiendoAnexoCaja}
                      title={!selectedContribuyenteAgua ? "Seleccione un contribuyente de la tabla" : "Elegir mes pagado y reimprimir"}
                    >
                      {loadingHistorialReimpresionAgua ? "Cargando historial..." : "Reimprimir mes pagado"}
                    </button>
                  </div>
                  <div className="table-responsive border rounded" style={{ maxHeight: "240px" }}>
                    <table className="table table-sm table-hover mb-0">
                      <thead className="table-light sticky-top">
                        <tr>
                          <th>Código</th>
                          <th>Nombre</th>
                          <th>Dirección</th>
                          <th className="text-center">Meses deuda</th>
                          <th className="text-end">Deuda total</th>
                          <th className="text-end">Abono total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!busquedaContribuyenteRealizada && (
                          <tr>
                            <td colSpan="6" className="text-center py-3 text-muted">
                              La lista inicia vacía. Digite apellidos completos, nombre y apellido, DNI o código y presione Buscar.
                            </td>
                          </tr>
                        )}
                        {busquedaContribuyenteRealizada && buscandoContribuyenteAgua && (
                          <tr><td colSpan="6" className="text-center py-3">Buscando...</td></tr>
                        )}
                        {busquedaContribuyenteRealizada && !buscandoContribuyenteAgua && errorBusquedaContribuyenteAgua && (
                          <tr><td colSpan="6" className="text-center py-3 text-danger">{errorBusquedaContribuyenteAgua}</td></tr>
                        )}
                        {busquedaContribuyenteRealizada && !buscandoContribuyenteAgua && !errorBusquedaContribuyenteAgua && contribuyentesFiltradosAgua.length === 0 && (
                          <tr><td colSpan="6" className="text-center py-3 text-muted">Sin resultados para la búsqueda.</td></tr>
                        )}
                        {busquedaContribuyenteRealizada && !buscandoContribuyenteAgua && contribuyentesFiltradosAgua.map((c) => (
                          <tr
                            key={`${c.id_contribuyente}-${c.id_predio || 0}`}
                            className={Number(selectedContribuyenteAgua?.id_contribuyente || 0) === Number(c.id_contribuyente || 0) ? "table-primary" : ""}
                            onClick={() => setSelectedContribuyenteAgua(c)}
                            style={{ cursor: "pointer" }}
                          >
                            <td className="fw-semibold">{c.codigo_municipal || `ID ${c.id_contribuyente}`}</td>
                            <td>{c.nombre_completo || c.sec_nombre || "-"}</td>
                            <td>{formatDireccionDisplay(c.direccion_completa) || "-"}</td>
                            <td className="text-center">{Number(c.meses_deuda || 0)}</td>
                            <td className="text-end">{formatMoney(c.deuda_anio)}</td>
                            <td className="text-end">{formatMoney(c.abono_anio)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="small mb-2">
                  {cajaCerradaAguaHoy ? (
                    <span className="text-danger fw-semibold">
                      Caja de agua cerrada hoy. No se permiten más cobros hasta mañana.
                    </span>
                  ) : Number(resumenConteoAgua?.total_pendientes_hoy || 0) > 0 ? (
                    <span className="text-info">
                      Conteo pendiente para cierre: S/. {parseMonto(resumenConteoAgua?.monto_pendiente_hoy).toFixed(2)} ({Number(resumenConteoAgua?.total_pendientes_hoy || 0)} registro(s))
                    </span>
                  ) : (
                    <span className="text-muted">No hay conteo de efectivo pendiente para hoy.</span>
                  )}
                </div>

              </>
            )}

            {tab === "luz" && (
              <>
                <div className="row g-3 mb-3">
                  {cardsLuz.map((card) => (
                    <div className="col-12 col-md-4" key={card.label}>
                      <div className={`rounded p-3 ${card.className}`}>
                        <div className="small fw-semibold opacity-75">{card.label}</div>
                        <div className="fs-2 fw-bold">{card.value}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border rounded p-3 mb-3">
                  <div className="fw-semibold mb-2">Buscar contribuyente de luz para caja</div>
                  <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
                    <input
                      type="text"
                      className="form-control"
                      style={{ maxWidth: "460px" }}
                      placeholder="Digite zona, ID usuario, nombre o dirección"
                      value={busquedaContribuyenteLuz}
                      onChange={(e) => setBusquedaContribuyenteLuz(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          buscarContribuyentesLuz();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-outline-primary"
                      onClick={buscarContribuyentesLuz}
                      disabled={buscandoContribuyenteLuz}
                    >
                      {buscandoContribuyenteLuz ? "Buscando..." : "Buscar"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={abrirCobroDirectoLuz}
                      disabled={!selectedContribuyenteLuz || loadingPendientesCobroLuz || cobrandoDirectoLuz}
                      title={!selectedContribuyenteLuz ? "Seleccione un contribuyente de la tabla" : "Seleccionar meses y cobrar"}
                    >
                      {loadingPendientesCobroLuz ? "Cargando deuda..." : (cobrandoDirectoLuz ? "Cobrando..." : "Cobrar")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={abrirReimpresionLuz}
                      disabled={!selectedContribuyenteLuz || loadingHistorialReimpresionLuz}
                      title={!selectedContribuyenteLuz ? "Seleccione un contribuyente de la tabla" : "Elegir mes pagado y reimprimir"}
                    >
                      {loadingHistorialReimpresionLuz ? "Cargando historial..." : "Reimprimir mes pagado"}
                    </button>
                  </div>

                  <div className="table-responsive border rounded" style={{ maxHeight: "280px" }}>
                    <table className="table table-sm table-hover mb-0">
                      <thead className="table-light sticky-top">
                        <tr>
                          <th>Zona</th>
                          <th>ID usuario</th>
                          <th>Nombre</th>
                          <th>Dirección</th>
                          <th className="text-center">Meses deuda</th>
                          <th className="text-end">Deuda total</th>
                          <th className="text-end">Abono total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!busquedaContribuyenteLuzRealizada && (
                          <tr>
                            <td colSpan="7" className="text-center py-3 text-muted">
                              La lista inicia vacía. Digite zona, ID usuario, nombre o dirección y presione Buscar.
                            </td>
                          </tr>
                        )}
                        {busquedaContribuyenteLuzRealizada && buscandoContribuyenteLuz && (
                          <tr><td colSpan="7" className="text-center py-3">Buscando...</td></tr>
                        )}
                        {busquedaContribuyenteLuzRealizada && !buscandoContribuyenteLuz && errorBusquedaContribuyenteLuz && (
                          <tr><td colSpan="7" className="text-center py-3 text-danger">{errorBusquedaContribuyenteLuz}</td></tr>
                        )}
                        {busquedaContribuyenteLuzRealizada && !buscandoContribuyenteLuz && !errorBusquedaContribuyenteLuz && contribuyentesFiltradosLuz.length === 0 && (
                          <tr><td colSpan="7" className="text-center py-3 text-muted">Sin resultados para la búsqueda.</td></tr>
                        )}
                        {busquedaContribuyenteLuzRealizada && !buscandoContribuyenteLuz && contribuyentesFiltradosLuz.map((c) => (
                          <tr
                            key={`luz-${Number(c?.id_suministro || 0)}`}
                            className={Number(selectedContribuyenteLuz?.id_suministro || 0) === Number(c?.id_suministro || 0) ? "table-primary" : ""}
                            onClick={() => setSelectedContribuyenteLuz(c)}
                            style={{ cursor: "pointer" }}
                          >
                            <td className="fw-semibold">{c.zona || "-"}</td>
                            <td>{c.nro_medidor || "-"}</td>
                            <td>{c.nombre_usuario || "-"}</td>
                            <td>{c.direccion || "-"}</td>
                            <td className="text-center">{Number(c.meses_deuda || 0)}</td>
                            <td className="text-end">{formatMoney(c.deuda_total)}</td>
                            <td className="text-end">{formatMoney(c.abono_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

          </div>
        </div>
      </div>

      {mostrarModalConteoAgua && (
        <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Conteo y cierre de caja - Agua</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setMostrarModalConteoAgua(false)}
                  disabled={enviandoConteoAgua}
                ></button>
              </div>
              <div className="modal-body">
                <div className="alert alert-info py-2 small">
                  Declare el monto fisico o verificado por cada medio de pago. El sistema comparara estos importes contra los cobros registrados hoy.
                </div>
                <div className="table-responsive border rounded">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Medio</th>
                        <th className="text-end">Sistema</th>
                        <th className="text-end">Declarado</th>
                        <th className="text-end">Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {METODOS_PAGO_CAJA.map((metodo) => {
                        const sistema = round2(parseMonto(totalesSistemaMetodosAgua?.[metodo.value]));
                        const declarado = round2(parseMonto(declaracionMetodosAgua?.[metodo.value]));
                        const diferencia = round2(declarado - sistema);
                        return (
                          <tr key={`conteo-${metodo.value}`}>
                            <td>
                              <div className="fw-semibold">{metodo.label}</div>
                              {metodo.requiereReferencia && <div className="small text-muted">Verificar contra voucher o banca</div>}
                            </td>
                            <td className="text-end">{formatMoney(sistema)}</td>
                            <td className="text-end">
                              <div className="input-group input-group-sm ms-auto" style={{ maxWidth: "170px" }}>
                                <span className="input-group-text">S/.</span>
                                <input
                                  type="text"
                                  className="form-control text-end"
                                  inputMode="decimal"
                                  value={declaracionMetodosAgua?.[metodo.value] ?? ""}
                                  onChange={(e) => setDeclaracionMetodoAgua(metodo.value, e.target.value)}
                                  onBlur={() => finalizarDeclaracionMetodoAgua(metodo.value)}
                                  disabled={enviandoConteoAgua}
                                />
                              </div>
                            </td>
                            <td className={`text-end fw-semibold ${Math.abs(diferencia) >= 0.01 ? "text-danger" : "text-success"}`}>
                              {formatMoney(diferencia)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="table-light">
                      <tr>
                        <td className="fw-bold">Totales</td>
                        <td className="text-end fw-bold">{formatMoney(totalSistemaMetodosAgua)}</td>
                        <td className="text-end fw-bold">{formatMoney(totalDeclaradoConteoAgua)}</td>
                        <td className={`text-end fw-bold ${Math.abs(diferenciaConteoAgua) >= 0.01 ? "text-danger" : "text-success"}`}>
                          {formatMoney(diferenciaConteoAgua)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="mt-3">
                  <label className="form-label form-label-sm mb-1">Observacion de cierre</label>
                  <textarea
                    className="form-control form-control-sm"
                    rows={2}
                    value={observacionConteoAgua}
                    onChange={(e) => setObservacionConteoAgua(e.target.value)}
                    placeholder="Opcional: detalle de diferencias, vouchers pendientes, arqueo, etc."
                    disabled={enviandoConteoAgua}
                  />
                </div>
                {Math.abs(diferenciaConteoAgua) >= 0.01 && (
                  <div className="alert alert-warning py-2 small mt-3 mb-0">
                    Hay diferencia entre sistema y declarado. Puede cerrarse igual, pero quedara registrada para revision.
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => setMostrarModalConteoAgua(false)}
                  disabled={enviandoConteoAgua}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-success"
                  onClick={registrarConteoEfectivoAgua}
                  disabled={enviandoConteoAgua || cajaCerradaAguaHoy}
                >
                  {enviandoConteoAgua ? "Registrando cierre..." : "Registrar cierre"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {mostrarModalCobroAgua && (
        <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  Cobrar - {selectedContribuyenteAgua?.nombre_completo || selectedContribuyenteAgua?.sec_nombre || "Contribuyente"}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setMostrarModalCobroAgua(false)}
                  disabled={cobrandoDirectoAgua || anulandoReciboCobroAguaId > 0 || editandoPagoCobroAguaId > 0}
                ></button>
              </div>
              <div className="modal-body">
                <div className="small text-muted mb-3">
                  Se muestran deudas pendientes y periodos adelantados ya emitidos por ventanilla (Agua).
                  Si el usuario no trae recibo, puede activarse contingencia para generar periodos faltantes desde Caja.
                  Caja puede registrar y corregir cobros solo hasta 3 dias atras; administrador no tiene limite retroactivo. Para cambiar monto use "Editar monto"; para cambiar fecha primero anule y luego registre de nuevo el cobro.
                </div>
                <div className="row g-2 align-items-end mb-3">
                  <div className="col-sm-4 col-md-3">
                    <label className="form-label form-label-sm mb-1">Fecha del cobro</label>
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      value={fechaCobroAgua}
                      min={permisos.fechaCobroMinima}
                      max={permisos.fechaCobroMaxima}
                      onChange={(e) => onChangeFechaCobroAgua(e.target.value)}
                      disabled={!permisos.canSeleccionarFechaCobro || cobrandoDirectoAgua}
                    />
                  </div>
                  <div className="col-sm-8 col-md-6">
                    <div className="small text-muted">
                      {modoCobroAgua === COBRO_AGUA_MODOS.COMPENSACION && permisos.canAdminPagos
                        ? "La compensacion se registrara con la fecha seleccionada, afectara la deuda y quedara fuera del reporte de caja."
                        : permisos.canAdminPagos
                        ? "El cobro se registrara en el reporte de la fecha seleccionada. Administrador puede usar cualquier fecha pasada."
                        : `El cobro se registrara en el reporte de la fecha seleccionada. Caja puede usar hoy o hasta ${permisos.maxDiasRetroactivoCobro || 0} dia(s) atras.`}
                    </div>
                    {actualizandoPeriodosCobroAgua && !loadingPendientesCobroAgua && (
                      <div className="small text-muted mt-1">Actualizando periodos para la fecha seleccionada...</div>
                    )}
                  </div>
                  {permisos.canAdminPagos && (
                    <div className="col-sm-6 col-md-3">
                      <label className="form-label form-label-sm mb-1">Modalidad</label>
                      <select
                        className="form-select form-select-sm"
                        value={modoCobroAgua}
                        onChange={(e) => setModoCobroAgua(String(e.target.value || COBRO_AGUA_MODOS.CAJA))}
                        disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua || actualizandoPeriodosCobroAgua || anulandoReciboCobroAguaId > 0 || editandoPagoCobroAguaId > 0}
                      >
                        <option value={COBRO_AGUA_MODOS.CAJA}>Cobro de caja</option>
                        <option value={COBRO_AGUA_MODOS.COMPENSACION}>Compensacion</option>
                      </select>
                    </div>
                  )}
                  <div className="col-sm-12 col-md-3">
                    <div className="form-check form-switch mb-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="switch-contingencia-caja"
                        checked={permitirContingenciaAgua}
                        onChange={toggleContingenciaCobroAgua}
                        disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua || actualizandoPeriodosCobroAgua || anulandoReciboCobroAguaId > 0 || editandoPagoCobroAguaId > 0}
                      />
                      <label className="form-check-label small" htmlFor="switch-contingencia-caja">
                        Contingencia (emitir sin recibo)
                      </label>
                    </div>
                  </div>
                </div>
                {modoCobroAgua === COBRO_AGUA_MODOS.COMPENSACION && permisos.canAdminPagos && (
                  <div className="mb-3">
                    <div className="alert alert-warning py-2 small mb-2">
                      La compensacion cancelara la deuda y quedara en auditoria, pero no entrara al reporte de caja.
                    </div>
                    <label className="form-label form-label-sm mb-1">Motivo de la compensacion</label>
                    <textarea
                      className="form-control form-control-sm"
                      rows={2}
                      value={motivoCobroAgua}
                      onChange={(e) => setMotivoCobroAgua(e.target.value)}
                      placeholder="Ej. Compensacion en especie por materiales entregados a la municipalidad."
                      disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua || actualizandoPeriodosCobroAgua || anulandoReciboCobroAguaId > 0 || editandoPagoCobroAguaId > 0}
                    />
                  </div>
                )}
                {modoCobroAgua !== COBRO_AGUA_MODOS.COMPENSACION && (
                  <div className="border rounded p-2 mb-3">
                    <div className="fw-semibold small mb-2">Medio de pago</div>
                    <div className="row g-2 align-items-end">
                      <div className="col-sm-6 col-lg-3">
                        <label className="form-label form-label-sm mb-1">Método</label>
                        <select
                          className="form-select form-select-sm"
                          value={metodoPagoAgua}
                          onChange={(e) => {
                            const next = normalizeMetodoPagoCaja(e.target.value);
                            setMetodoPagoAgua(next);
                            if (next === "EFECTIVO") setReferenciaPagoAgua("");
                          }}
                          disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua || actualizandoPeriodosCobroAgua}
                        >
                          {METODOS_PAGO_CAJA.map((metodo) => (
                            <option key={metodo.value} value={metodo.value}>{metodo.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-sm-6 col-lg-3">
                        <label className="form-label form-label-sm mb-1">
                          Referencia {getMetodoPagoConfig(metodoPagoAgua).requiereReferencia ? "*" : ""}
                        </label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={referenciaPagoAgua}
                          onChange={(e) => setReferenciaPagoAgua(e.target.value)}
                          placeholder={getMetodoPagoConfig(metodoPagoAgua).requiereReferencia ? "Nro. operacion" : "Opcional"}
                          disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua || actualizandoPeriodosCobroAgua || metodoPagoAgua === "EFECTIVO"}
                        />
                      </div>
                      <div className="col-sm-6 col-lg-3">
                        <label className="form-label form-label-sm mb-1">Confirmación</label>
                        <select
                          className="form-select form-select-sm"
                          value={estadoConfirmacionPagoAgua}
                          onChange={(e) => setEstadoConfirmacionPagoAgua(normalizeEstadoConfirmacionPago(e.target.value))}
                          disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua || actualizandoPeriodosCobroAgua}
                        >
                          {ESTADOS_CONFIRMACION_PAGO.map((estado) => (
                            <option key={estado.value} value={estado.value}>{estado.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-sm-6 col-lg-3">
                        <label className="form-label form-label-sm mb-1">Observación</label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={observacionPagoAgua}
                          onChange={(e) => setObservacionPagoAgua(e.target.value)}
                          placeholder="Opcional"
                          disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua || actualizandoPeriodosCobroAgua}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {aniosCobroAgua.length > 0 && (
                  <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                    <div className="small text-muted">
                      Vista anual de periodos. Use las flechas para revisar anos anteriores o volver a anos mas recientes.
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => {
                          const nextYear = aniosCobroAgua[indiceAnioVistaCobroAgua + 1];
                          if (nextYear) setAnioVistaCobroAgua(nextYear);
                        }}
                        disabled={indiceAnioVistaCobroAgua < 0 || indiceAnioVistaCobroAgua >= aniosCobroAgua.length - 1}
                        title="Ver un año anterior"
                      >
                        <FaChevronLeft />
                      </button>
                      <span className="badge text-bg-light border">Ano {anioVistaCobroAgua || "-"}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => {
                          const nextYear = aniosCobroAgua[indiceAnioVistaCobroAgua - 1];
                          if (nextYear) setAnioVistaCobroAgua(nextYear);
                        }}
                        disabled={indiceAnioVistaCobroAgua <= 0}
                        title="Ver un año mas reciente"
                      >
                        <FaChevronRight />
                      </button>
                    </div>
                  </div>
                )}
                <div className="table-responsive border rounded">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: "36px" }}></th>
                        <th>Periodo</th>
                        <th className="text-end">Saldo</th>
                        <th className="text-end">Monto pagado</th>
                        <th className="text-end">Monto a cobrar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingPendientesCobroAgua && recibosPendientesCobroAgua.length === 0 && (
                        <tr>
                          <td colSpan="5" className="text-center text-muted py-3">Actualizando periodos...</td>
                        </tr>
                      )}
                      {!loadingPendientesCobroAgua && recibosPendientesCobroAgua.length === 0 && (
                        <tr>
                          <td colSpan="5" className="text-center text-muted py-3">Sin meses disponibles para cobro.</td>
                        </tr>
                      )}
                      {recibosPendientesCobroAguaVista.map((row) => {
                        const idRecibo = Number(row?.id_recibo || 0);
                        const idPagoUltimo = Number(row?.id_ultimo_pago || 0);
                        const rowKey = getCobroAguaRowKey(row);
                        const saldo = getCobroAguaRowSaldo(row);
                        const montoPagado = round2(parseMonto(row?.abono_mes ?? 0));
                        const sel = seleccionCobroAgua[rowKey] || { checked: false, monto: saldo.toFixed(2) };
                        const esSinRecibo = Boolean(row?.placeholder_sin_recibo);
                        const esAdelantado = !esSinRecibo && (Boolean(row?.es_adelantado) || idRecibo <= 0);
                        const puedeCobrar = !esSinRecibo && canSelectCobroAguaRow(row, permisos, toIsoDate());
                        const estadoUpper = String(row?.estado || "").trim().toUpperCase();
                        const tipoMovimientoAdmin = String(row?.tipo_movimiento_admin || "").trim().toUpperCase();
                        const estadoMovimientoAdmin = String(row?.estado_movimiento_admin || "").trim().toUpperCase();
                        const tieneReintegroPendiente = hasCobroAguaPendingReingreso(row) && estadoUpper !== "PAGADO";
                        const fueEditado = tipoMovimientoAdmin === "EDICION_MONTO" || estadoMovimientoAdmin === "EDITADO";
                        const fueReintegrado = tipoMovimientoAdmin === "REINTEGRACION" || estadoMovimientoAdmin === "REINTEGRADO";
                        const correccionDentroDeRango = canCorrectCobroAguaRowByDate(row, permisos, toIsoDate());
                        const puedeEditarMontoPago = permisos.canCorregirPagos && estadoUpper === "PAGADO" && idPagoUltimo > 0 && correccionDentroDeRango;
                        const puedeAnularPagoPeriodo = permisos.canCorregirPagos && estadoUpper === "PAGADO" && idRecibo > 0 && correccionDentroDeRango;
                        const estadoNoCobro = esSinRecibo ? "SIN RECIBO" : (estadoUpper === "PAGADO" ? "PAGADO" : "BLOQUEADO");
                        const checkboxBloqueado = cobrandoDirectoAgua
                          || loadingPendientesCobroAgua
                          || actualizandoPeriodosCobroAgua
                          || !puedeCobrar;
                        const checkboxChecked = puedeCobrar ? Boolean(sel?.checked) : false;
                        const anulandoEstaFila = idRecibo > 0 && anulandoReciboCobroAguaId === idRecibo;
                        const editandoEstaFila = idPagoUltimo > 0 && editandoPagoCobroAguaId === idPagoUltimo;
                        return (
                          <tr key={rowKey}>
                            <td className="text-center">
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={checkboxChecked}
                                onChange={() => {
                                  if (puedeCobrar) {
                                    toggleCobroAgua(rowKey);
                                  }
                                }}
                                disabled={checkboxBloqueado || anulandoEstaFila || editandoEstaFila}
                              />
                            </td>
                            <td>
                              {String(row?.mes || "").padStart(2, "0")}/{row?.anio || "-"}
                              {esSinRecibo && <span className="badge text-bg-secondary ms-2">SIN RECIBO</span>}
                              {esAdelantado && <span className="badge text-bg-warning ms-2">ADELANTADO</span>}
                              {tieneReintegroPendiente && <span className="badge text-bg-danger ms-2">REINGRESO PENDIENTE</span>}
                              {!tieneReintegroPendiente && fueReintegrado && <span className="badge text-bg-success ms-2">REINTEGRADO</span>}
                              {fueEditado && <span className="badge text-bg-info ms-2">EDITADO</span>}
                              {!puedeCobrar && permisos.canCorregirPagos && (estadoUpper === "PAGADO" || tieneReintegroPendiente) && !correccionDentroDeRango && (
                                <span className="badge text-bg-warning ms-2">FUERA DE RANGO</span>
                              )}
                              {!puedeCobrar && <span className="badge text-bg-secondary ms-2">{estadoNoCobro}</span>}
                              {!puedeCobrar && puedeEditarMontoPago && (
                                <button
                                  type="button"
                                  className="btn btn-link btn-sm p-0 ms-2 align-baseline"
                                  onClick={() => editarMontoPagoAgua(row)}
                                  disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua || actualizandoPeriodosCobroAgua || anulandoEstaFila || editandoEstaFila}
                                  title="Editar directamente el monto del ultimo pago registrado"
                                >
                                  {editandoEstaFila ? "Editando..." : "Editar monto"}
                                </button>
                              )}
                              {!puedeCobrar && puedeAnularPagoPeriodo && (
                                <button
                                  type="button"
                                  className="btn btn-link btn-sm p-0 ms-2 align-baseline text-danger"
                                  onClick={() => anularPagoMesCobroAgua(row)}
                                  disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua || actualizandoPeriodosCobroAgua || anulandoEstaFila || editandoEstaFila}
                                  title="Anular todos los pagos activos del periodo para volver a registrarlo desde cero"
                                >
                                  {anulandoEstaFila ? "Anulando..." : "Anular"}
                                </button>
                              )}
                            </td>
                            <td className="text-end">{formatMoney(saldo)}</td>
                            <td className="text-end">
                              {montoPagado > 0.001 ? (
                                <span className="fw-semibold">{formatMoney(montoPagado)}</span>
                              ) : (
                                <span className="text-muted">-</span>
                              )}
                            </td>
                            <td className="text-end">
                              <div className="input-group input-group-sm ms-auto" style={{ maxWidth: "170px" }}>
                                <span className="input-group-text">S/.</span>
                                <input
                                  type="text"
                                  className="form-control text-end"
                                  inputMode="decimal"
                                  value={sel?.monto ?? ""}
                                  onChange={(e) => setMontoCobroAgua(rowKey, e.target.value, saldo)}
                                  onBlur={() => finalizarMontoCobroAgua(rowKey, saldo)}
                                  disabled={!sel?.checked || cobrandoDirectoAgua || actualizandoPeriodosCobroAgua || !puedeCobrar || anulandoEstaFila || editandoEstaFila}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="alert alert-info mt-3 mb-0 text-center fw-semibold">
                  Total seleccionado: {formatMoney(totalCobroDirectoAgua)}
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => setMostrarModalCobroAgua(false)}
                  disabled={cobrandoDirectoAgua || anulandoReciboCobroAguaId > 0 || editandoPagoCobroAguaId > 0}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-success"
                  onClick={cobrarDirectoAgua}
                  disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua || actualizandoPeriodosCobroAgua || anulandoReciboCobroAguaId > 0 || editandoPagoCobroAguaId > 0}
                >
                  {cobrandoDirectoAgua ? "Procesando..." : (modoCobroAgua === COBRO_AGUA_MODOS.COMPENSACION ? "Registrar compensacion" : "Cobrar")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {mostrarModalReimpresionAgua && (
        <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  Reimprimir mes pagado - {selectedContribuyenteAgua?.nombre_completo || selectedContribuyenteAgua?.sec_nombre || "Contribuyente"}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setMostrarModalReimpresionAgua(false)}
                  disabled={imprimiendoAnexoCaja}
                ></button>
              </div>
              <div className="modal-body">
                <div className="small text-muted mb-3">
                  Seleccione el mes que ya fue pagado para reimprimir su anexo.
                </div>
                <div className="table-responsive border rounded">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: "36px" }}></th>
                        <th>Periodo</th>
                        <th className="text-end">Total pagado</th>
                        <th className="text-end">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recibosPagadosReimpresionAgua.length === 0 && (
                        <tr>
                          <td colSpan="4" className="text-center text-muted py-3">Sin meses pagados para reimpresion.</td>
                        </tr>
                      )}
                      {recibosPagadosReimpresionAgua.map((row) => {
                        const idRecibo = Number(row?.id_recibo || 0);
                        const mes = Number(row?.mes || 0);
                        const anio = Number(row?.anio || 0);
                        const mesNombre = MESES_ES[mes] || String(mes).padStart(2, "0");
                        const totalPagado = round2(parseMonto(row?.abono_mes || row?.total_pagar));
                        return (
                          <tr key={idRecibo}>
                            <td className="text-center">
                              <input
                                type="radio"
                                className="form-check-input"
                                name="recibo_reimpresion_agua"
                                checked={Number(idReciboReimpresionAgua) === idRecibo}
                                onChange={() => setIdReciboReimpresionAgua(idRecibo)}
                                disabled={imprimiendoAnexoCaja}
                              />
                            </td>
                            <td>{mesNombre} {anio}</td>
                            <td className="text-end">{formatMoney(totalPagado)}</td>
                            <td className="text-end"><span className="badge text-bg-success">PAGADO</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => setMostrarModalReimpresionAgua(false)}
                  disabled={imprimiendoAnexoCaja}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-outline-primary"
                  onClick={confirmarReimpresionAgua}
                  disabled={imprimiendoAnexoCaja || !idReciboReimpresionAgua}
                >
                  {imprimiendoAnexoCaja ? "Imprimiendo..." : "Reimprimir"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {mostrarModalCobroLuz && (
        <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  Cobrar Luz - {selectedContribuyenteLuz?.nombre_usuario || "Contribuyente"}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setMostrarModalCobroLuz(false)}
                  disabled={cobrandoDirectoLuz}
                ></button>
              </div>
              <div className="modal-body">
                <div className="small text-muted mb-3">
                  Seleccione los periodos de luz pendientes y confirme el cobro.
                </div>
                <div className="border rounded p-2 mb-3">
                  <div className="fw-semibold small mb-2">Medio de pago</div>
                  <div className="row g-2 align-items-end">
                    <div className="col-sm-4">
                      <label className="form-label form-label-sm mb-1">Metodo</label>
                      <select
                        className="form-select form-select-sm"
                        value={metodoPagoLuz}
                        onChange={(e) => {
                          const next = normalizeMetodoPagoCaja(e.target.value);
                          setMetodoPagoLuz(next);
                          if (next === "EFECTIVO") setReferenciaPagoLuz("");
                        }}
                        disabled={cobrandoDirectoLuz || loadingPendientesCobroLuz}
                      >
                        {METODOS_PAGO_CAJA.map((metodo) => (
                          <option key={`luz-${metodo.value}`} value={metodo.value}>{metodo.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-sm-4">
                      <label className="form-label form-label-sm mb-1">
                        Referencia {getMetodoPagoConfig(metodoPagoLuz).requiereReferencia ? "*" : ""}
                      </label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={referenciaPagoLuz}
                        onChange={(e) => setReferenciaPagoLuz(e.target.value)}
                        placeholder={getMetodoPagoConfig(metodoPagoLuz).requiereReferencia ? "Nro. operacion" : "Opcional"}
                        disabled={cobrandoDirectoLuz || loadingPendientesCobroLuz || metodoPagoLuz === "EFECTIVO"}
                      />
                    </div>
                    <div className="col-sm-4">
                      <label className="form-label form-label-sm mb-1">Confirmacion</label>
                      <select
                        className="form-select form-select-sm"
                        value={estadoConfirmacionPagoLuz}
                        onChange={(e) => setEstadoConfirmacionPagoLuz(normalizeEstadoConfirmacionPago(e.target.value))}
                        disabled={cobrandoDirectoLuz || loadingPendientesCobroLuz}
                      >
                        {ESTADOS_CONFIRMACION_PAGO.map((estado) => (
                          <option key={`luz-${estado.value}`} value={estado.value}>{estado.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="table-responsive border rounded">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: "36px" }}></th>
                        <th>Periodo</th>
                        <th className="text-end">Saldo</th>
                        <th className="text-end">Monto pagado</th>
                        <th className="text-end">Monto a cobrar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingPendientesCobroLuz && (
                        <tr><td colSpan="5" className="text-center text-muted py-3">Actualizando periodos...</td></tr>
                      )}
                      {!loadingPendientesCobroLuz && recibosPendientesCobroLuz.length === 0 && (
                        <tr><td colSpan="5" className="text-center text-muted py-3">Sin meses disponibles para cobro.</td></tr>
                      )}
                      {recibosPendientesCobroLuz.map((row) => {
                        const rowKey = getCobroLuzRowKey(row);
                        const saldo = getCobroLuzRowSaldo(row);
                        const montoPagado = round2(parseMonto(row?.abono_mes ?? 0));
                        const sel = seleccionCobroLuz[rowKey] || { checked: false, monto: saldo.toFixed(2) };
                        return (
                          <tr key={rowKey}>
                            <td className="text-center">
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={Boolean(sel?.checked)}
                                onChange={() => toggleCobroLuz(rowKey)}
                                disabled={cobrandoDirectoLuz}
                              />
                            </td>
                            <td>{String(row?.mes || "").padStart(2, "0")}/{row?.anio || "-"}</td>
                            <td className="text-end">{formatMoney(saldo)}</td>
                            <td className="text-end">
                              {montoPagado > 0.001 ? (
                                <span className="fw-semibold">{formatMoney(montoPagado)}</span>
                              ) : (
                                <span className="text-muted">-</span>
                              )}
                            </td>
                            <td className="text-end">
                              <div className="input-group input-group-sm ms-auto" style={{ maxWidth: "170px" }}>
                                <span className="input-group-text">S/.</span>
                                <input
                                  type="text"
                                  className="form-control text-end"
                                  inputMode="decimal"
                                  value={sel?.monto ?? ""}
                                  onChange={(e) => setMontoCobroLuz(rowKey, e.target.value, saldo)}
                                  onBlur={() => finalizarMontoCobroLuz(rowKey, saldo)}
                                  disabled={!sel?.checked || cobrandoDirectoLuz}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="alert alert-info mt-3 mb-0 text-center fw-semibold">
                  Total seleccionado: {formatMoney(totalCobroDirectoLuz)}
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => setMostrarModalCobroLuz(false)}
                  disabled={cobrandoDirectoLuz}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-success"
                  onClick={cobrarDirectoLuz}
                  disabled={cobrandoDirectoLuz || loadingPendientesCobroLuz}
                >
                  {cobrandoDirectoLuz ? "Procesando..." : "Cobrar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {mostrarModalReimpresionLuz && (
        <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  Reimprimir Luz - {selectedContribuyenteLuz?.nombre_usuario || "Contribuyente"}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setMostrarModalReimpresionLuz(false)}
                ></button>
              </div>
              <div className="modal-body">
                <div className="small text-muted mb-3">
                  Seleccione el mes pagado para reimprimir el recibo de luz.
                </div>
                <div className="table-responsive border rounded">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: "36px" }}></th>
                        <th>Periodo</th>
                        <th className="text-end">Total pagado</th>
                        <th className="text-end">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recibosPagadosReimpresionLuz.length === 0 && (
                        <tr>
                          <td colSpan="4" className="text-center text-muted py-3">Sin meses pagados para reimpresion.</td>
                        </tr>
                      )}
                      {recibosPagadosReimpresionLuz.map((row) => {
                        const idRecibo = Number(row?.id_recibo || 0);
                        const mes = Number(row?.mes || 0);
                        const anio = Number(row?.anio || 0);
                        const mesNombre = MESES_ES[mes] || String(mes).padStart(2, "0");
                        const totalPagado = round2(parseMonto(row?.abono_mes || row?.total_pagar));
                        return (
                          <tr key={idRecibo}>
                            <td className="text-center">
                              <input
                                type="radio"
                                className="form-check-input"
                                name="recibo_reimpresion_luz"
                                checked={Number(idReciboReimpresionLuz) === idRecibo}
                                onChange={() => setIdReciboReimpresionLuz(idRecibo)}
                              />
                            </td>
                            <td>{mesNombre} {anio}</td>
                            <td className="text-end">{formatMoney(totalPagado)}</td>
                            <td className="text-end"><span className="badge text-bg-success">PAGADO</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => setMostrarModalReimpresionLuz(false)}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-outline-primary"
                  onClick={confirmarReimpresionLuz}
                  disabled={!idReciboReimpresionLuz}
                >
                  Reimprimir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {mostrarReporteCajaAgua && (
        <Suspense fallback={<LazyModalFallback label="Cargando reporte de caja..." />}>
          <ModalCierre
            cerrarModal={() => setMostrarReporteCajaAgua(false)}
            darkMode={false}
            origen="caja"
            usuarioSistema={usuarioSistema}
          />
        </Suspense>
      )}

      {mostrarReporteCajaLuz && (
        <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Reporte Caja Luz</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setMostrarReporteCajaLuz(false)}
                ></button>
              </div>
              <div className="modal-body">
                <div className="row g-2 align-items-end mb-3">
                  <div className="col-12 col-sm-4 col-lg-3">
                    <label className="form-label form-label-sm mb-1">Fecha</label>
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      value={fechaReporteLuz}
                      max={toIsoDate()}
                      onChange={(e) => setFechaReporteLuz(e.target.value)}
                    />
                  </div>
                  <div className="col-auto">
                    <button
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => cargarReporteLuz(fechaReporteLuz)}
                      disabled={loadingReporteLuz}
                    >
                      {loadingReporteLuz ? "Consultando..." : "Consultar"}
                    </button>
                  </div>
                  <div className="col-12 col-sm-8 col-lg">
                    <div className="small text-muted">
                      Total: <strong>{formatMoney(reporteLuz?.total || 0)}</strong> | Movimientos: <strong>{Number(reporteLuz?.cantidad_movimientos || 0)}</strong>
                    </div>
                  </div>
                </div>

                <div className="table-responsive border rounded" style={{ maxHeight: "58vh" }}>
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead className="table-light sticky-top">
                      <tr>
                        <th>Fecha/hora</th>
                        <th>Zona</th>
                        <th>ID usuario</th>
                        <th>Contribuyente</th>
                        <th>Periodo</th>
                        <th className="text-end">Monto</th>
                        <th className="text-end">Orden</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!loadingReporteLuz && (!Array.isArray(reporteLuz?.movimientos) || reporteLuz.movimientos.length === 0) && (
                        <tr>
                          <td colSpan="7" className="text-center py-3 text-muted">Sin movimientos para la fecha seleccionada.</td>
                        </tr>
                      )}
                      {Array.isArray(reporteLuz?.movimientos) && reporteLuz.movimientos.map((row) => (
                        <tr key={`rep-luz-${Number(row?.id_pago || 0)}`}>
                          <td>{formatFechaHora(row?.fecha_pago)}</td>
                          <td>{row?.zona || "-"}</td>
                          <td>{row?.nro_medidor || "-"}</td>
                          <td>{row?.nombre_usuario || "-"}</td>
                          <td>{String(row?.mes || "").padStart(2, "0")}/{row?.anio || "-"}</td>
                          <td className="text-end">{formatMoney(row?.monto_pagado || 0)}</td>
                          <td className="text-end">{row?.id_orden_cobro ? `#${row.id_orden_cobro}` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setMostrarReporteCajaLuz(false)}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: "fixed", left: "-9999px", top: 0 }}>
        <ReciboAnexoCaja ref={anexoCajaRef} datos={datosAnexoCajaImprimir} />
      </div>
      <div style={{ position: "fixed", left: "-10000px", top: 0, width: "210mm", background: "#fff" }}>
        <ReciboLuz ref={reciboLuzRef} datos={reciboLuzImpresion} />
      </div>
    </div>
  );
}

export default CajaMunicipalApp;


