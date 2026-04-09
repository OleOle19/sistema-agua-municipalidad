import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { FaBolt, FaCashRegister, FaSignOutAlt, FaSyncAlt, FaTint } from "react-icons/fa";
import api from "../api";
import LoginPage from "../components/LoginPage";
import ReciboAnexoCaja from "../components/ReciboAnexoCaja";
import ModalCierre from "../components/ModalCierre";
import cajaLuzApi from "./apiCajaLuz";
import realtime from "../realtime";

const AGUA_TOKEN_KEY = "token_agua";

const ROLE_LABELS = {
  ADMIN: "Nivel 1 - Admin principal",
  ADMIN_SEC: "Nivel 2 - Ventanilla",
  CAJERO: "Nivel 3 - Operador de caja",
  CONSULTA: "Nivel 4 - Consulta",
  BRIGADA: "Nivel 5 - Brigada"
};

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
const shiftIsoDateByYears = (isoDate, deltaYears) => {
  const text = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return toIsoDate();
  const [year, month, day] = text.split("-").map((v) => Number(v));
  const targetYear = year + Number(deltaYears || 0);
  for (let currentDay = day; currentDay >= 1; currentDay -= 1) {
    const candidate = `${String(targetYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(currentDay).padStart(2, "0")}`;
    if (isValidIsoDate(candidate)) return candidate;
  }
  return `${String(targetYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
};

const parseMonto = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSearchText = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

const tokenizeSearchText = (value) => normalizeSearchText(value)
  .split(" ")
  .map((t) => t.trim())
  .filter(Boolean);

const normalizeDigits = (value) => String(value || "").replace(/\D/g, "");

const normalizeCodigo = (value) => String(value || "")
  .toUpperCase()
  .replace(/\s+/g, "")
  .trim();

const MAX_DIAS_CORRECCION_PAGO = 7;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const formatMoney = (value) => `S/. ${parseMonto(value).toFixed(2)}`;
const MESES_ES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const formatFechaHora = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString("es-PE");
};

const round2 = (value) => Math.round((parseMonto(value) + Number.EPSILON) * 100) / 100;
const getCobroAguaRowKey = (row = {}) => {
  const idRecibo = Number(row?.id_recibo || 0);
  if (idRecibo > 0) return `r-${idRecibo}`;
  const anio = Number(row?.anio || 0);
  const mes = Number(row?.mes || 0);
  return `p-${anio}-${mes}`;
};
const getCobroAguaRowSaldo = (row = {}) => round2(parseMonto(row?.deuda_mes ?? row?.total_pagar ?? 0));
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
const diffDaysBetweenIsoDates = (fromIso, toIso) => {
  if (!isValidIsoDate(fromIso) || !isValidIsoDate(toIso)) return Number.NaN;
  const [fromYear, fromMonth, fromDay] = fromIso.split("-").map((v) => Number(v));
  const [toYear, toMonth, toDay] = toIso.split("-").map((v) => Number(v));
  const fromMs = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toMs = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.floor((toMs - fromMs) / DAY_IN_MS);
};
const canEditarAnularPagoPeriodo = (row = {}, hoyIso = toIsoDate()) => {
  const fechaUltimoPago = normalizeDateOnlyText(row?.fecha_ultimo_pago);
  const dias = diffDaysBetweenIsoDates(fechaUltimoPago, hoyIso);
  if (!Number.isFinite(dias)) return false;
  return dias >= 0 && dias <= MAX_DIAS_CORRECCION_PAGO;
};
const canSelectCobroAguaRow = (row = {}) => {
  const saldo = getCobroAguaRowSaldo(row);
  const estado = String(row?.estado || "").trim().toUpperCase();
  if (saldo <= 0.001) return false;
  if (estado === "PAGADO") return false;
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
  const agua = parseMonto(recibo?.subtotal_agua);
  const desague = parseMonto(recibo?.subtotal_desague);
  const limpieza = parseMonto(recibo?.subtotal_limpieza);
  const admin = parseMonto(recibo?.subtotal_admin);
  const base = round2(agua + desague + limpieza + admin);
  if (base <= 0) {
    return {
      subtotal_agua: round2(montoCobro),
      subtotal_desague: 0,
      subtotal_limpieza: 0,
      subtotal_admin: 0
    };
  }
  const factor = round2(parseMonto(montoCobro) / base);
  let pAgua = round2(agua * factor);
  let pDesague = round2(desague * factor);
  let pLimpieza = round2(limpieza * factor);
  let pAdmin = round2(admin * factor);
  const ajuste = round2(parseMonto(montoCobro) - (pAgua + pDesague + pLimpieza + pAdmin));
  pAdmin = round2(pAdmin + ajuste);
  return {
    subtotal_agua: pAgua,
    subtotal_desague: pDesague,
    subtotal_limpieza: pLimpieza,
    subtotal_admin: pAdmin
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
      calle: pickFirstText(contribuyente?.direccion_completa, contribuyente?.direccion),
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
      calle: pickFirstText(contribuyente?.direccion_completa, contribuyente?.direccion),
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
  const [padronContribuyentesAgua, setPadronContribuyentesAgua] = useState([]);
  const [busquedaContribuyenteAgua, setBusquedaContribuyenteAgua] = useState("");
  const [buscandoContribuyenteAgua, setBuscandoContribuyenteAgua] = useState(false);
  const [busquedaContribuyenteRealizada, setBusquedaContribuyenteRealizada] = useState(false);
  const [contribuyentesFiltradosAgua, setContribuyentesFiltradosAgua] = useState([]);
  const [selectedContribuyenteAgua, setSelectedContribuyenteAgua] = useState(null);
  const [mostrarModalCobroAgua, setMostrarModalCobroAgua] = useState(false);
  const [loadingPendientesCobroAgua, setLoadingPendientesCobroAgua] = useState(false);
  const [cobrandoDirectoAgua, setCobrandoDirectoAgua] = useState(false);
  const [anulandoReciboCobroAguaId, setAnulandoReciboCobroAguaId] = useState(0);
  const [recibosPendientesCobroAgua, setRecibosPendientesCobroAgua] = useState([]);
  const [seleccionCobroAgua, setSeleccionCobroAgua] = useState({});
  const [fechaCobroAgua, setFechaCobroAgua] = useState(toIsoDate());
  const [mostrarModalReimpresionAgua, setMostrarModalReimpresionAgua] = useState(false);
  const [loadingHistorialReimpresionAgua, setLoadingHistorialReimpresionAgua] = useState(false);
  const [recibosPagadosReimpresionAgua, setRecibosPagadosReimpresionAgua] = useState([]);
  const [idReciboReimpresionAgua, setIdReciboReimpresionAgua] = useState(0);
  const [mostrarReporteCajaAgua, setMostrarReporteCajaAgua] = useState(false);
  const cajaCerradaAguaHoy = Boolean(resumenConteoAgua?.caja_cerrada_hoy);

  const [ordenesLuz, setOrdenesLuz] = useState([]);
  const [loadingLuz, setLoadingLuz] = useState(false);
  const [procesoLuz, setProcesoLuz] = useState(0);
  const [reporteLuz, setReporteLuz] = useState(null);
  const [loadingReporteLuz, setLoadingReporteLuz] = useState(false);

  const [datosAnexoCajaImprimir, setDatosAnexoCajaImprimir] = useState(null);
  const [ultimoAnexoCaja, setUltimoAnexoCaja] = useState(null);
  const [imprimiendoAnexoCaja, setImprimiendoAnexoCaja] = useState(false);
  const anexoCajaRef = useRef(null);
  const isPrintingAnexoCajaRef = useRef(false);

  const rolActual = normalizeRole(usuarioSistema?.rol);
  const accesoCajaPermitido = canEnterCajaModuleByRole(rolActual);
  const permisos = useMemo(() => ({
    role: rolActual,
    roleLabel: ROLE_LABELS[rolActual] || ROLE_LABELS.CONSULTA,
    canCaja: accesoCajaPermitido
  }), [accesoCajaPermitido, rolActual]);

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
    const msg = String(err?.response?.data?.error || fallback || "Error de conexion");
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
    setOrdenesLuz([]);
    setReporteAgua(null);
    setReporteLuz(null);
    setResumenConteoAgua({
      fecha_referencia: "",
      total_pendientes_hoy: 0,
      monto_pendiente_hoy: 0,
      ultimo_pendiente: null,
      caja_cerrada_hoy: false,
      cierre_hoy: null
    });
    setPadronContribuyentesAgua([]);
    setContribuyentesFiltradosAgua([]);
    setBusquedaContribuyenteAgua("");
    setBuscandoContribuyenteAgua(false);
    setBusquedaContribuyenteRealizada(false);
    setSelectedContribuyenteAgua(null);
    setMostrarModalCobroAgua(false);
    setLoadingPendientesCobroAgua(false);
    setCobrandoDirectoAgua(false);
    setRecibosPendientesCobroAgua([]);
    setSeleccionCobroAgua({});
    setFechaCobroAgua(toIsoDate());
    setMostrarModalReimpresionAgua(false);
    setLoadingHistorialReimpresionAgua(false);
    setRecibosPagadosReimpresionAgua([]);
    setIdReciboReimpresionAgua(0);
    setMostrarReporteCajaAgua(false);
    setUltimoAnexoCaja(null);
    setImprimiendoAnexoCaja(false);
  }, []);

  const cargarOrdenesLuz = useCallback(async () => {
    if (!permisos.canCaja) return;
    setLoadingLuz(true);
    try {
      const res = await cajaLuzApi.get("/caja/ordenes-cobro/pendientes");
      setOrdenesLuz(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      handleApiError(err, "No se pudo cargar ordenes de luz.");
    } finally {
      setLoadingLuz(false);
    }
  }, [handleApiError, permisos.canCaja]);

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

  const cargarReporteLuz = useCallback(async () => {
    if (!permisos.canCaja) return;
    setLoadingReporteLuz(true);
    try {
      const res = await cajaLuzApi.get("/caja/reporte", { params: { tipo: "diario", fecha: toIsoDate() } });
      setReporteLuz(res.data || null);
    } catch (err) {
      handleApiError(err, "No se pudo cargar reporte de luz.");
    } finally {
      setLoadingReporteLuz(false);
    }
  }, [handleApiError, permisos.canCaja]);

  const recargarAgua = useCallback(async () => {
    await Promise.all([cargarResumenAgua(), cargarConteoAgua()]);
  }, [cargarResumenAgua, cargarConteoAgua]);

  const recargarLuz = useCallback(async () => {
    await Promise.all([cargarOrdenesLuz(), cargarReporteLuz()]);
  }, [cargarOrdenesLuz, cargarReporteLuz]);

  useEffect(() => {
    if (!usuarioSistema) return;
    if (tab === "agua") {
      recargarAgua();
    } else {
      recargarLuz();
    }
  }, [recargarAgua, recargarLuz, tab, usuarioSistema]);

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

  const buscarContribuyentesAgua = useCallback(async () => {
    const qRaw = String(busquedaContribuyenteAgua || "").trim();
    if (!qRaw) {
      setBusquedaContribuyenteRealizada(true);
      setContribuyentesFiltradosAgua([]);
      setSelectedContribuyenteAgua(null);
      showFlash("warning", "Digite apellidos completos, nombre y apellido, DNI o código completo.");
      return;
    }
    const qNombre = normalizeSearchText(qRaw);
    const qNombreTokens = tokenizeSearchText(qRaw);
    const qDni = normalizeDigits(qRaw);
    const qCodigo = normalizeCodigo(qRaw);
    const usarBusquedaNombrePorTokens = qNombreTokens.length >= 2;

    setBuscandoContribuyenteAgua(true);
    try {
      let base = padronContribuyentesAgua;
      if (!Array.isArray(base) || base.length === 0) {
        const res = await api.get("/contribuyentes");
        base = Array.isArray(res.data) ? res.data : [];
        setPadronContribuyentesAgua(base);
      }
      const filtrados = base.filter((row) => {
        const nombre = normalizeSearchText(row?.nombre_completo || row?.sec_nombre);
        const nombreTokens = tokenizeSearchText(nombre);
        const dni = normalizeDigits(row?.dni_ruc);
        const codigo = normalizeCodigo(row?.codigo_municipal || row?.sec_cod);
        const coincideNombre = usarBusquedaNombrePorTokens
          ? qNombreTokens.every((tok) => nombreTokens.includes(tok))
          : (qNombre && nombre === qNombre);
        return coincideNombre
          || (qDni && dni === qDni)
          || (qCodigo && codigo === qCodigo);
      }).slice(0, 200);
      setContribuyentesFiltradosAgua(filtrados);
      setSelectedContribuyenteAgua(null);
      setBusquedaContribuyenteRealizada(true);
    } catch (err) {
      handleApiError(err, "No se pudo buscar contribuyentes.");
    } finally {
      setBuscandoContribuyenteAgua(false);
    }
  }, [busquedaContribuyenteAgua, handleApiError, padronContribuyentesAgua, showFlash]);

  const registrarConteoEfectivoAgua = useCallback(async () => {
    if (!permisos.canCaja) return;
    if (cajaCerradaAguaHoy) {
      showFlash("warning", "La caja de agua ya fue cerrada para hoy.");
      return;
    }
    const montoPrevio = parseMonto(resumenConteoAgua?.ultimo_pendiente?.monto_efectivo);
    const montoSugerido = montoPrevio > 0 ? montoPrevio.toFixed(2) : "";
    const montoRaw = window.prompt("Ingrese conteo de efectivo (S/.):", montoSugerido);
    if (montoRaw === null) return;
    const monto = Number.parseFloat(String(montoRaw).replace(",", "."));
    if (!Number.isFinite(monto) || monto < 0) {
      showFlash("danger", "Monto invalido para conteo de efectivo.");
      return;
    }
    const observacion = window.prompt("Observacion opcional:", "") || "";
    setEnviandoConteoAgua(true);
    try {
      const res = await api.post("/caja/conteo-efectivo", {
        monto_efectivo: monto,
        observacion,
        cerrar_caja: true
      });
      showFlash("success", res?.data?.mensaje || "Conteo de efectivo enviado.");
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
  }, [cajaCerradaAguaHoy, cargarConteoAgua, cargarReporteAgua, handleApiError, permisos.canCaja, resumenConteoAgua?.ultimo_pendiente?.monto_efectivo, showFlash]);

  const cargarPeriodosCobroAgua = useCallback(async (idContribuyente, fechaCorte, { avisarVacio = false } = {}) => {
    const fecha = String(fechaCorte || "").trim();
    if (!isValidIsoDate(fecha)) return;
    const [resPendientes, resHistorial] = await Promise.all([
      api.get(`/recibos/pendientes/${idContribuyente}`, {
        params: {
          incluir_adelantados: "S",
          adelantado_meses: 12,
          fecha_corte: fecha
        }
      }),
      api.get(`/recibos/historial/${idContribuyente}`, {
        params: {
          anio: "all",
          fecha_corte: fecha
        }
      })
    ]);
    const pendientes = Array.isArray(resPendientes.data) ? resPendientes.data : [];
    const historial = Array.isArray(resHistorial.data) ? resHistorial.data : [];
    const byPeriodo = new Map();
    historial.forEach((row) => {
      const mes = Number(row?.mes || 0);
      const anio = Number(row?.anio || 0);
      if (mes < 1 || mes > 12 || anio < 1900) return;
      const key = `${anio}-${mes}`;
      byPeriodo.set(key, {
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
      });
    });
    pendientes.forEach((row) => {
      const mes = Number(row?.mes || 0);
      const anio = Number(row?.anio || 0);
      if (mes < 1 || mes > 12 || anio < 1900) return;
      const key = `${anio}-${mes}`;
      const prev = byPeriodo.get(key);
      const deudaMes = round2(parseMonto(row?.deuda_mes ?? row?.total_pagar ?? 0));
      byPeriodo.set(key, {
        ...(prev || {}),
        ...row,
        id_recibo: Number(row?.id_recibo ?? prev?.id_recibo ?? 0) || null,
        mes,
        anio,
        subtotal_agua: round2(parseMonto(row?.subtotal_agua ?? prev?.subtotal_agua)),
        subtotal_desague: round2(parseMonto(row?.subtotal_desague ?? prev?.subtotal_desague)),
        subtotal_limpieza: round2(parseMonto(row?.subtotal_limpieza ?? prev?.subtotal_limpieza)),
        subtotal_admin: round2(parseMonto(row?.subtotal_admin ?? prev?.subtotal_admin)),
        total_pagar: round2(parseMonto(row?.total_pagar ?? prev?.total_pagar ?? deudaMes)),
        abono_mes: round2(parseMonto(row?.abono_mes ?? prev?.abono_mes ?? 0)),
        deuda_mes: deudaMes,
        estado: String(row?.estado || prev?.estado || ""),
        es_adelantado: Boolean(row?.es_adelantado) || (Number(row?.id_recibo ?? 0) <= 0 && deudaMes > 0)
      });
    });
    const rows = Array.from(byPeriodo.values()).sort((a, b) => {
      const pa = (Number(a?.anio || 0) * 100) + Number(a?.mes || 0);
      const pb = (Number(b?.anio || 0) * 100) + Number(b?.mes || 0);
      return pa - pb;
    });
    const fechaBase = new Date(`${fecha}T00:00:00`);
    const fechaMinima = new Date(fechaBase);
    fechaMinima.setMonth(fechaMinima.getMonth() - 12);
    const periodoMinimoNum = (fechaMinima.getFullYear() * 100) + (fechaMinima.getMonth() + 1);
    const rowsFiltradas = rows.filter((row) => {
      const anio = Number(row?.anio || 0);
      const mes = Number(row?.mes || 0);
      const periodoNum = (anio * 100) + mes;
      const saldo = getCobroAguaRowSaldo(row);
      if (saldo > 0.001) return true;
      return periodoNum >= periodoMinimoNum;
    });
    const initial = {};
    rowsFiltradas.forEach((row) => {
      const rowKey = getCobroAguaRowKey(row);
      const saldo = getCobroAguaRowSaldo(row);
      initial[rowKey] = {
        checked: false,
        monto: saldo.toFixed(2)
      };
    });
    setRecibosPendientesCobroAgua(rowsFiltradas);
    setSeleccionCobroAgua(initial);
    if (avisarVacio && rowsFiltradas.length === 0) {
      showFlash("warning", "No hay periodos disponibles para mostrar en cobro.");
    }
  }, [showFlash]);

  const abrirCobroDirectoAgua = async () => {
    const idContribuyente = Number(selectedContribuyenteAgua?.id_contribuyente || 0);
    if (!idContribuyente) {
      showFlash("warning", "Seleccione un contribuyente para cobrar.");
      return;
    }
    if (cajaCerradaAguaHoy) {
      showFlash("warning", "Caja cerrada para hoy. No se permiten más cobros.");
      return;
    }
    const hoy = toIsoDate();
    setFechaCobroAgua(hoy);
    setRecibosPendientesCobroAgua([]);
    setSeleccionCobroAgua({});
    setMostrarModalCobroAgua(true);
    setLoadingPendientesCobroAgua(true);
    try {
      await cargarPeriodosCobroAgua(idContribuyente, hoy, { avisarVacio: true });
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
    if (!mostrarModalCobroAgua) return;
    const idContribuyente = Number(selectedContribuyenteAgua?.id_contribuyente || 0);
    if (!idContribuyente || !isValidIsoDate(fecha)) return;
    const hoy = toIsoDate();
    const fechaMinima = shiftIsoDateByYears(hoy, -1);
    if (fecha > hoy || fecha < fechaMinima) return;
    setLoadingPendientesCobroAgua(true);
    try {
      await cargarPeriodosCobroAgua(idContribuyente, fecha);
    } catch (err) {
      handleApiError(err, "No se pudo actualizar los periodos para la fecha seleccionada.");
    } finally {
      setLoadingPendientesCobroAgua(false);
    }
  }, [cargarPeriodosCobroAgua, handleApiError, mostrarModalCobroAgua, selectedContribuyenteAgua]);

  const anularPagoMesCobroAgua = useCallback(async (row) => {
    if (!permisos.canCaja) return;
    const idRecibo = Number(row?.id_recibo || 0);
    if (!idRecibo) {
      showFlash("warning", "No se puede anular este periodo porque no tiene recibo asociado.");
      return;
    }
    const hoy = toIsoDate();
    const fechaUltimoPagoIso = normalizeDateOnlyText(row?.fecha_ultimo_pago);
    const diasDesdeUltimoPago = diffDaysBetweenIsoDates(fechaUltimoPagoIso, hoy);
    const dentroDeVentana = Number.isFinite(diasDesdeUltimoPago)
      && diasDesdeUltimoPago >= 0
      && diasDesdeUltimoPago <= MAX_DIAS_CORRECCION_PAGO;
    if (!dentroDeVentana) {
      const fechaTxt = fechaUltimoPagoIso || "desconocida";
      showFlash(
        "warning",
        `Solo se puede editar/anular dentro de ${MAX_DIAS_CORRECCION_PAGO} dias. Ultimo pago: ${fechaTxt}.`
      );
      return;
    }
    const periodo = `${String(row?.mes || "").padStart(2, "0")}/${row?.anio || "-"}`;
    const confirmado = window.confirm(`Anular el ultimo pago del periodo ${periodo} para corregirlo?`);
    if (!confirmado) return;
    const idContribuyente = Number(selectedContribuyenteAgua?.id_contribuyente || 0);
    const fecha = String(fechaCobroAgua || "").trim();
    setAnulandoReciboCobroAguaId(idRecibo);
    try {
      const res = await api.post(`/pagos/recibo/${idRecibo}/anular-ultimo`);
      showFlash("success", res?.data?.mensaje || "Pago anulado para correccion.");
      await Promise.all([
        cargarPeriodosCobroAgua(idContribuyente, fecha || toIsoDate()),
        recargarAgua(),
        buscarContribuyentesAgua()
      ]);
    } catch (err) {
      handleApiError(err, "No se pudo anular el pago del periodo seleccionado.");
    } finally {
      setAnulandoReciboCobroAguaId(0);
    }
  }, [
    buscarContribuyentesAgua,
    cargarPeriodosCobroAgua,
    fechaCobroAgua,
    handleApiError,
    permisos.canCaja,
    recargarAgua,
    selectedContribuyenteAgua,
    showFlash
  ]);

  const setMontoCobroAgua = useCallback((rowKey, value, maxSaldo) => {
    const raw = String(value || "").replace(",", ".");
    if (raw && !/^\d*(\.\d{0,2})?$/.test(raw)) return;
    const parsed = parseMonto(raw);
    const clamped = raw === ""
      ? ""
      : round2(Math.min(Math.max(parsed, 0), round2(maxSaldo))).toFixed(2);
    setSeleccionCobroAgua((prev) => ({
      ...prev,
      [rowKey]: {
        ...(prev[rowKey] || {}),
        monto: clamped
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

  const cobrarDirectoAgua = useCallback(async () => {
    if (!permisos.canCaja) return;
    const idContribuyente = Number(selectedContribuyenteAgua?.id_contribuyente || 0);
    if (!idContribuyente) {
      showFlash("warning", "Seleccione un contribuyente para cobrar.");
      return;
    }
    const fechaPago = String(fechaCobroAgua || "").trim();
    const hoy = toIsoDate();
    const fechaMinima = shiftIsoDateByYears(hoy, -1);
    if (!isValidIsoDate(fechaPago)) {
      showFlash("warning", "Seleccione una fecha valida para registrar el cobro.");
      return;
    }
    if (fechaPago > hoy) {
      showFlash("warning", "No se permite registrar cobros con fecha futura.");
      return;
    }
    if (fechaPago < fechaMinima) {
      showFlash("warning", `Solo se permite registrar cobros hasta un anio atras. Fecha minima: ${fechaMinima}.`);
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
      if (!sel?.checked) continue;
      const saldo = getCobroAguaRowSaldo(row);
      const monto = round2(parseMonto(sel?.monto));
      if (monto <= 0) continue;
      if (monto > saldo + 0.001) {
        showFlash("warning", `El monto ingresado excede el saldo del periodo ${mes}/${anio}.`);
        return;
      }
      if (idRecibo > 0) {
        pagos.push({ id_recibo: idRecibo, monto_pagado: monto });
      } else if (mes >= 1 && mes <= 12 && anio >= 1900) {
        pagos.push({ anio, mes, monto_pagado: monto });
      } else {
        showFlash("warning", "Hay un periodo invalido seleccionado para cobro.");
        return;
      }
      anexoItems.push({
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
    const confirm = window.confirm(`Registrar cobro por ${formatMoney(totalCobroDirectoAgua)} con fecha ${fechaPago} y abrir impresion?`);
    if (!confirm) return;
    setCobrandoDirectoAgua(true);
    try {
      const res = await api.post("/pagos", {
        id_contribuyente: idContribuyente,
        pagos,
        fecha_pago: fechaPago
      });
      showFlash("success", res?.data?.mensaje || "Cobro registrado correctamente.");
      const anexoData = buildAnexoDataFromPagoDirecto(selectedContribuyenteAgua, anexoItems);
      setUltimoAnexoCaja(anexoData);
      setDatosAnexoCajaImprimir(anexoData);
      setMostrarModalCobroAgua(false);
      await Promise.all([recargarAgua(), buscarContribuyentesAgua()]);
    } catch (err) {
      handleApiError(err, "No se pudo registrar el cobro directo.");
    } finally {
      setCobrandoDirectoAgua(false);
    }
  }, [
    buscarContribuyentesAgua,
    handleApiError,
    permisos.canCaja,
    recibosPendientesCobroAgua,
    recargarAgua,
    selectedContribuyenteAgua,
    seleccionCobroAgua,
    showFlash,
    fechaCobroAgua,
    totalCobroDirectoAgua
  ]);

  const cobrarLuz = async (idOrden) => {
    if (!permisos.canCaja) return;
    if (!window.confirm(`Cobrar orden de luz #${idOrden}?`)) return;
    setProcesoLuz(idOrden);
    try {
      const res = await cajaLuzApi.post(`/caja/ordenes-cobro/${idOrden}/cobrar`);
      showFlash("success", res.data?.mensaje || "Cobro registrado.");
      await recargarLuz();
    } catch (err) {
      handleApiError(err, "No se pudo cobrar orden de luz.");
    } finally {
      setProcesoLuz(0);
    }
  };

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

  const reimprimirUltimoAnexoCaja = useCallback(() => {
    if (!ultimoAnexoCaja) {
      showFlash("warning", "No hay un anexo reciente para reimprimir.");
      return;
    }
    if (imprimiendoAnexoCaja || isPrintingAnexoCajaRef.current) return;
    setDatosAnexoCajaImprimir(ultimoAnexoCaja);
  }, [imprimiendoAnexoCaja, ultimoAnexoCaja, showFlash]);

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
      handleApiError(err, "No se pudo cargar el historial pagado para reimpresion.");
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
      showFlash("warning", "No se encontro el periodo seleccionado para reimpresion.");
      return;
    }
    const anexoData = buildAnexoDataFromReciboPagado(selectedContribuyenteAgua, recibo);
    setUltimoAnexoCaja(anexoData);
    setDatosAnexoCajaImprimir(anexoData);
    setMostrarModalReimpresionAgua(false);
  }, [idReciboReimpresionAgua, recibosPagadosReimpresionAgua, selectedContribuyenteAgua, showFlash]);

  const totalPendienteAgua = useMemo(
    () => contribuyentesFiltradosAgua.reduce((acc, item) => acc + parseMonto(item.deuda_anio), 0),
    [contribuyentesFiltradosAgua]
  );

  const totalPendienteLuz = useMemo(
    () => ordenesLuz.reduce((acc, item) => acc + parseMonto(item.total_orden), 0),
    [ordenesLuz]
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
      label: "PENDIENTE EN CAJA",
      value: formatMoney(totalPendienteLuz),
      className: "bg-danger text-white"
    }
  ]), [reporteLuz, totalPendienteLuz]);

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
            alert("Acceso denegado. El modulo Caja Municipal solo permite cuentas ADMIN o CAJERO.");
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
                    onClick={registrarConteoEfectivoAgua}
                    disabled={enviandoConteoAgua || cajaCerradaAguaHoy}
                    title={cajaCerradaAguaHoy ? "Caja cerrada para hoy" : "Enviar conteo de efectivo y cerrar caja de hoy"}
                  >
                    {enviandoConteoAgua ? "Enviando conteo..." : (cajaCerradaAguaHoy ? "Caja cerrada hoy" : "Conteo y cierre")}
                  </button>
                </>
              ) : (
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
                          <th>Codigo</th>
                          <th>Nombre</th>
                          <th>Direccion</th>
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
                        {busquedaContribuyenteRealizada && !buscandoContribuyenteAgua && contribuyentesFiltradosAgua.length === 0 && (
                          <tr><td colSpan="6" className="text-center py-3 text-muted">Sin resultados para la busqueda.</td></tr>
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
                            <td>{c.direccion_completa || "-"}</td>
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

                <div className="table-responsive border rounded" style={{ maxHeight: "58vh" }}>
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead className="table-light sticky-top">
                      <tr>
                        <th>Orden</th>
                        <th>Fecha</th>
                        <th>Zona</th>
                        <th>Suministro</th>
                        <th>ID usuario</th>
                        <th className="text-end">Total</th>
                        <th className="text-center">Items</th>
                        <th className="text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingLuz && ordenesLuz.length === 0 && <tr><td colSpan="8" className="text-center py-3">Cargando...</td></tr>}
                      {!loadingLuz && ordenesLuz.length === 0 && (
                        <tr><td colSpan="8" className="text-center py-3 text-muted">Sin ordenes pendientes.</td></tr>
                      )}
                      {ordenesLuz.map((ord) => (
                        <tr key={ord.id_orden}>
                          <td>#{ord.id_orden}</td>
                          <td>{formatFechaHora(ord.creado_en)}</td>
                          <td>{ord.suministro?.zona || "-"}</td>
                          <td>{ord.suministro?.nombre_usuario || "-"}</td>
                          <td>{ord.suministro?.nro_medidor || "-"}</td>
                          <td className="text-end">{formatMoney(ord.total_orden)}</td>
                          <td className="text-center">{Array.isArray(ord.items) ? ord.items.length : 0}</td>
                          <td className="text-center">
                            <div className="btn-group btn-group-sm">
                              <button className="btn btn-success" disabled={!permisos.canCaja || procesoLuz === ord.id_orden} onClick={() => cobrarLuz(ord.id_orden)}>
                                Cobrar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

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
                  disabled={cobrandoDirectoAgua}
                ></button>
              </div>
              <div className="modal-body">
                <div className="small text-muted mb-3">
                  Se muestran deudas pendientes y periodos de los ultimos 12 meses segun la fecha de cobro seleccionada.
                  Los periodos pagados pueden corregirse desde esta misma tabla con "Editar/Anular".
                </div>
                <div className="row g-2 align-items-end mb-3">
                  <div className="col-sm-4 col-md-3">
                    <label className="form-label form-label-sm mb-1">Fecha del cobro</label>
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      value={fechaCobroAgua}
                      min={shiftIsoDateByYears(toIsoDate(), -1)}
                      max={toIsoDate()}
                      onChange={(e) => onChangeFechaCobroAgua(e.target.value)}
                      disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua}
                    />
                  </div>
                  <div className="col-sm-8 col-md-9">
                    <div className="small text-muted">
                      El cobro se registrara en el reporte de la fecha seleccionada. Retroactivo maximo: 1 anio.
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
                        <th className="text-end">Monto a cobrar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingPendientesCobroAgua && (
                        <tr>
                          <td colSpan="4" className="text-center text-muted py-3">Actualizando periodos...</td>
                        </tr>
                      )}
                      {!loadingPendientesCobroAgua && recibosPendientesCobroAgua.length === 0 && (
                        <tr>
                          <td colSpan="4" className="text-center text-muted py-3">Sin meses disponibles para cobro.</td>
                        </tr>
                      )}
                      {recibosPendientesCobroAgua.map((row) => {
                        const idRecibo = Number(row?.id_recibo || 0);
                        const rowKey = getCobroAguaRowKey(row);
                        const saldo = getCobroAguaRowSaldo(row);
                        const sel = seleccionCobroAgua[rowKey] || { checked: false, monto: saldo.toFixed(2) };
                        const esAdelantado = Boolean(row?.es_adelantado) || idRecibo <= 0;
                        const puedeCobrar = canSelectCobroAguaRow(row);
                        const estadoUpper = String(row?.estado || "").trim().toUpperCase();
                        const dentroVentanaEdicion = canEditarAnularPagoPeriodo(row, toIsoDate());
                        const puedeAnularPagoPeriodo = estadoUpper === "PAGADO" && idRecibo > 0 && dentroVentanaEdicion;
                        const pagoFueraVentanaEdicion = estadoUpper === "PAGADO" && idRecibo > 0 && !dentroVentanaEdicion;
                        const estadoNoCobro = estadoUpper === "PAGADO" ? "PAGADO" : "BLOQUEADO";
                        const checkboxBloqueado = cobrandoDirectoAgua
                          || loadingPendientesCobroAgua
                          || (!puedeCobrar && !puedeAnularPagoPeriodo);
                        const checkboxChecked = puedeCobrar ? Boolean(sel?.checked) : false;
                        const anulandoEstaFila = idRecibo > 0 && anulandoReciboCobroAguaId === idRecibo;
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
                                  } else if (puedeAnularPagoPeriodo) {
                                    anularPagoMesCobroAgua(row);
                                  }
                                }}
                                disabled={checkboxBloqueado || anulandoEstaFila}
                              />
                            </td>
                            <td>
                              {String(row?.mes || "").padStart(2, "0")}/{row?.anio || "-"}
                              {esAdelantado && <span className="badge text-bg-warning ms-2">ADELANTADO</span>}
                              {!puedeCobrar && <span className="badge text-bg-secondary ms-2">{estadoNoCobro}</span>}
                              {!puedeCobrar && puedeAnularPagoPeriodo && (
                                <button
                                  type="button"
                                  className="btn btn-link btn-sm p-0 ms-2 align-baseline"
                                  onClick={() => anularPagoMesCobroAgua(row)}
                                  disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua || anulandoEstaFila}
                                  title="Anular ultimo pago del periodo para registrar el monto corregido"
                                >
                                  {anulandoEstaFila ? "Anulando..." : "Editar/Anular"}
                                </button>
                              )}
                              {!puedeCobrar && pagoFueraVentanaEdicion && (
                                <span
                                  className="badge text-bg-dark ms-2"
                                  title={`Solo se permite editar/anular hasta ${MAX_DIAS_CORRECCION_PAGO} dias despues del pago.`}
                                >
                                  Fuera de ventana
                                </span>
                              )}
                            </td>
                            <td className="text-end">{formatMoney(saldo)}</td>
                            <td className="text-end">
                              <div className="input-group input-group-sm ms-auto" style={{ maxWidth: "170px" }}>
                                <span className="input-group-text">S/.</span>
                                <input
                                  type="text"
                                  className="form-control text-end"
                                  value={sel?.monto ?? ""}
                                  onChange={(e) => setMontoCobroAgua(rowKey, e.target.value, saldo)}
                                  disabled={!sel?.checked || cobrandoDirectoAgua || !puedeCobrar || anulandoEstaFila}
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
                  disabled={cobrandoDirectoAgua || anulandoReciboCobroAguaId > 0}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-success"
                  onClick={cobrarDirectoAgua}
                  disabled={cobrandoDirectoAgua || loadingPendientesCobroAgua || anulandoReciboCobroAguaId > 0}
                >
                  {cobrandoDirectoAgua ? "Procesando..." : "Cobrar"}
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

      {mostrarReporteCajaAgua && (
        <ModalCierre
          cerrarModal={() => setMostrarReporteCajaAgua(false)}
          darkMode={false}
          origen="caja"
          usuarioSistema={usuarioSistema}
        />
      )}

      <div style={{ position: "fixed", left: "-9999px", top: 0 }}>
        <ReciboAnexoCaja ref={anexoCajaRef} datos={datosAnexoCajaImprimir} />
      </div>
    </div>
  );
}

export default CajaMunicipalApp;


