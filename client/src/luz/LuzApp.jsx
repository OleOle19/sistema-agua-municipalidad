import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import {
  FaBolt,
  FaChartBar,
  FaCog,
  FaFileImport,
  FaHistory,
  FaList,
  FaPrint,
  FaReceipt,
  FaSave,
  FaSearch,
  FaSignOutAlt,
  FaSyncAlt,
  FaTrashAlt,
  FaUserShield
} from "react-icons/fa";
import LoginPage from "../components/LoginPage";
import luzApi from "./apiLuz";
import ReciboLuz from "./ReciboLuz";
import RecibosLuzLote from "./RecibosLuzLote";
import UsuariosLuzPanel from "./UsuariosLuzPanel";

const ROLE_ORDER = {
  BRIGADA: 1,
  CONSULTA: 2,
  CAJERO: 3,
  ADMIN_SEC: 4,
  ADMIN: 5
};

const ROLE_LABELS = {
  ADMIN: "Nivel 1 - Admin principal",
  ADMIN_SEC: "Nivel 2 - Ventanilla",
  CAJERO: "Nivel 3 - Operador de caja",
  CONSULTA: "Nivel 4 - Consulta",
  BRIGADA: "Nivel 5 - Brigada"
};

const MONTH_LABELS = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const LUZ_TOKEN_KEY = "token_luz";

const normalizeRole = (role) => {
  const raw = String(role || "").trim().toUpperCase();
  if (["ADMIN", "SUPERADMIN", "ADMIN_PRINCIPAL", "NIVEL_1"].includes(raw)) return "ADMIN";
  if (["ADMIN_SEC", "ADMIN_SECUNDARIO", "JEFE_CAJA", "NIVEL_2"].includes(raw)) return "ADMIN_SEC";
  if (["CAJERO", "OPERADOR_CAJA", "OPERADOR", "NIVEL_3"].includes(raw)) return "CAJERO";
  if (["BRIGADA", "BRIGADISTA", "CAMPO", "NIVEL_5"].includes(raw)) return "BRIGADA";
  return "CONSULTA";
};

const hasMinRole = (role, requiredRole) => {
  const currentLevel = ROLE_ORDER[normalizeRole(role)] || 0;
  const requiredLevel = ROLE_ORDER[normalizeRole(requiredRole)] || 0;
  return currentLevel >= requiredLevel;
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

const readStoredLuzUser = () => {
  const token = localStorage.getItem(LUZ_TOKEN_KEY);
  if (!token) return null;
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    localStorage.removeItem(LUZ_TOKEN_KEY);
    return null;
  }
  if (String(payload.sistema || "").toUpperCase() !== "LUZ") {
    localStorage.removeItem(LUZ_TOKEN_KEY);
    return null;
  }
  return {
    id_usuario: payload.id_usuario,
    username: payload.username,
    nombre: payload.nombre,
    rol: normalizeRole(payload.rol),
    sistema: "LUZ"
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

const parseMonto = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const parseEntero = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const parseIdNumerico = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};
const getPeriodoAnterior = (anio, mes) => {
  const anioNum = parseEntero(anio, 0);
  const mesNum = parseEntero(mes, 0);
  if (!anioNum || mesNum < 1 || mesNum > 12) return null;
  if (mesNum === 1) return { anio: anioNum - 1, mes: 12 };
  return { anio: anioNum, mes: mesNum - 1 };
};
const formatPeriodoCorto = (anio, mes) => `${String(mes).padStart(2, "0")}/${anio}`;
const compareMedidorAsc = (a, b) => {
  const medidorA = String(a?.nro_medidor || "").trim();
  const medidorB = String(b?.nro_medidor || "").trim();
  const onlyDigitsA = medidorA.replace(/\D/g, "");
  const onlyDigitsB = medidorB.replace(/\D/g, "");
  const hasDigitsA = onlyDigitsA.length > 0;
  const hasDigitsB = onlyDigitsB.length > 0;
  if (hasDigitsA !== hasDigitsB) return hasDigitsA ? -1 : 1;
  if (hasDigitsA && hasDigitsB) {
    const numA = Number.parseFloat(onlyDigitsA);
    const numB = Number.parseFloat(onlyDigitsB);
    if (numA !== numB) return numA - numB;
  }
  return medidorA.localeCompare(medidorB, "es", { numeric: true, sensitivity: "base" });
};

const formatMoney = (value) => `S/. ${parseMonto(value).toFixed(2)}`;
const formatPeriodo = (anio, mes) => `${String(mes).padStart(2, "0")}/${anio}`;
const formatFechaHora = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString("es-PE");
};
const formatFechaCorta = (value) => {
  if (!value) return "-";
  const text = String(value).trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) return text;
  return dt.toLocaleDateString("es-PE");
};

const createEmptySuministroForm = () => ({
  id_suministro: null,
  id_zona: "",
  zona_nombre: "",
  nro_medidor: "",
  nro_medidor_real: "",
  nombre_usuario: "",
  direccion: "",
  estado: "ACTIVO"
});

const createReciboDefaults = () => {
  const now = new Date();
  return {
    anio: String(now.getFullYear()),
    mes: String(now.getMonth() + 1),
    lectura_anterior: "",
    lectura_actual: "",
    fecha_emision: toIsoDate(),
    fecha_vencimiento: "",
    fecha_corte: "",
    observacion: ""
  };
};

const createImportState = () => ({
  archivoPadron: null,
  archivoLecturas: null,
  resultadoPadron: null,
  resultadoLecturas: null,
  subiendo: ""
});

const reciboLuzPageStyle = `
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

function LuzApp({ onBackToSelector }) {
  const [usuarioSistema, setUsuarioSistema] = useState(readStoredLuzUser);
  const [tab, setTab] = useState("padron");
  const [flash, setFlash] = useState(null);

  const [zonas, setZonas] = useState([]);
  const [filtros, setFiltros] = useState({ q: "", id_zona: "", estado: "TODOS" });
  const [suministros, setSuministros] = useState([]);
  const [loadingPadron, setLoadingPadron] = useState(false);

  const [selectedSuministroId, setSelectedSuministroId] = useState(null);
  const [suministroForm, setSuministroForm] = useState(createEmptySuministroForm);
  const [guardandoSuministro, setGuardandoSuministro] = useState(false);

  const [historial, setHistorial] = useState([]);
  const [pendientes, setPendientes] = useState([]);
  const [historialAnio, setHistorialAnio] = useState("all");
  const [loadingHistorial, setLoadingHistorial] = useState(false);

  const [reciboForm, setReciboForm] = useState(createReciboDefaults);
  const [lecturaAnteriorInfo, setLecturaAnteriorInfo] = useState({
    loading: false,
    encontrada: false,
    periodoAnterior: null,
    error: ""
  });
  const [emitiendoRecibo, setEmitiendoRecibo] = useState(false);

  const [tarifasForm, setTarifasForm] = useState({ tarifa_kwh: "1.00", cargo_fijo: "6.50" });
  const [fechasForm, setFechasForm] = useState({ dias_vencimiento: "6", dias_corte: "10" });
  const [guardandoConfig, setGuardandoConfig] = useState("");

  const [importacion, setImportacion] = useState(createImportState);
  const [auditoriaRows, setAuditoriaRows] = useState([]);
  const [auditoriaFiltro, setAuditoriaFiltro] = useState("");
  const [loadingAuditoria, setLoadingAuditoria] = useState(false);

  const [reciboImpresion, setReciboImpresion] = useState(null);
  const reciboRef = useRef(null);
  const imprimiendoRef = useRef(false);
  const [filtroZonaImpresion, setFiltroZonaImpresion] = useState("");
  const [periodoImpresion, setPeriodoImpresion] = useState(() => {
    const now = new Date();
    return {
      anio: String(now.getFullYear()),
      mes: String(now.getMonth() + 1)
    };
  });
  const [idsSuministrosImpresion, setIdsSuministrosImpresion] = useState([]);
  const [recibosLoteImpresion, setRecibosLoteImpresion] = useState([]);
  const [procesandoImpresionLote, setProcesandoImpresionLote] = useState(false);
  const recibosLoteRef = useRef(null);
  const imprimiendoLoteRef = useRef(false);

  const [fechaReporteCobranza, setFechaReporteCobranza] = useState(toIsoDate());
  const [reporteCobranza, setReporteCobranza] = useState(null);
  const [loadingReporteCobranza, setLoadingReporteCobranza] = useState(false);

  const rolActual = normalizeRole(usuarioSistema?.rol);
  const permisos = useMemo(() => ({
    role: rolActual,
    roleLabel: ROLE_LABELS[rolActual] || ROLE_LABELS.CONSULTA,
    canEmitirRecibo: hasMinRole(rolActual, "ADMIN_SEC"),
    canEditarPadron: hasMinRole(rolActual, "ADMIN_SEC"),
    canBorrarPadron: hasMinRole(rolActual, "ADMIN"),
    canImportarPadron: hasMinRole(rolActual, "ADMIN"),
    canImportarLecturas: hasMinRole(rolActual, "ADMIN"),
    canConfigurar: hasMinRole(rolActual, "ADMIN_SEC"),
    canManageUsers: hasMinRole(rolActual, "ADMIN"),
    canViewReportes: hasMinRole(rolActual, "CAJERO")
  }), [rolActual]);

  const suministroSeleccionado = useMemo(
    () => suministros.find((s) => Number(s.id_suministro) === Number(selectedSuministroId)) || null,
    [suministros, selectedSuministroId]
  );
  const suministrosOrdenados = useMemo(
    () => [...suministros].sort(compareMedidorAsc),
    [suministros]
  );
  const nextIdUsuarioSugerido = useMemo(() => {
    if (suministroForm.id_suministro) return "";
    const idZona = Number.parseInt(String(suministroForm.id_zona || ""), 10);
    const zonaNombre = String(suministroForm.zona_nombre || "").trim().toUpperCase();
    const mismosZona = suministros.filter((row) => {
      if (idZona > 0) return Number.parseInt(String(row.id_zona || ""), 10) === idZona;
      if (!zonaNombre) return false;
      return String(row.zona || "").trim().toUpperCase() === zonaNombre;
    });
    const maxId = mismosZona.reduce((acc, row) => {
      const n = parseIdNumerico(row?.nro_medidor);
      return n > acc ? n : acc;
    }, 0);
    return String(maxId + 1);
  }, [suministroForm.id_suministro, suministroForm.id_zona, suministroForm.zona_nombre, suministros]);

  const yearsHistorial = useMemo(() => {
    const set = new Set();
    for (const row of historial) {
      const anio = Number(row.anio);
      if (Number.isInteger(anio) && anio > 0) set.add(anio);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [historial]);

  const totalPendienteSeleccionado = useMemo(
    () => pendientes.reduce((acc, item) => acc + parseMonto(item.deuda_mes), 0),
    [pendientes]
  );
  const idsSuministrosImpresionSet = useMemo(
    () => new Set(idsSuministrosImpresion.map((id) => Number(id || 0))),
    [idsSuministrosImpresion]
  );

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
      localStorage.removeItem(LUZ_TOKEN_KEY);
      setUsuarioSistema(null);
    }
    showFlash("danger", msg);
    return msg;
  }, [showFlash]);

  const logout = useCallback(() => {
    localStorage.removeItem(LUZ_TOKEN_KEY);
    setUsuarioSistema(null);
    setSuministros([]);
    setZonas([]);
    setSelectedSuministroId(null);
    setHistorial([]);
    setPendientes([]);
    setIdsSuministrosImpresion([]);
    setRecibosLoteImpresion([]);
  }, []);

  const handlePrintRecibo = useReactToPrint({
    contentRef: reciboRef,
    documentTitle: "Recibo_Luz",
    pageStyle: reciboLuzPageStyle,
    onAfterPrint: () => {
      imprimiendoRef.current = false;
      setReciboImpresion(null);
    }
  });

  const handlePrintRecibosLote = useReactToPrint({
    contentRef: recibosLoteRef,
    documentTitle: "Recibos_Luz_Lote",
    pageStyle: reciboLuzPageStyle,
    onAfterPrint: () => {
      imprimiendoLoteRef.current = false;
      setRecibosLoteImpresion([]);
    }
  });

  useEffect(() => {
    if (!reciboImpresion) return;
    if (imprimiendoRef.current) return;
    const raf = requestAnimationFrame(() => {
      if (reciboRef.current) {
        imprimiendoRef.current = true;
        handlePrintRecibo();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [handlePrintRecibo, reciboImpresion]);

  useEffect(() => {
    if (!recibosLoteImpresion.length) return;
    if (imprimiendoLoteRef.current) return;
    const raf = requestAnimationFrame(() => {
      if (recibosLoteRef.current) {
        imprimiendoLoteRef.current = true;
        handlePrintRecibosLote();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [handlePrintRecibosLote, recibosLoteImpresion]);

  const cargarZonas = useCallback(async () => {
    try {
      const res = await luzApi.get("/zonas");
      setZonas(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      handleApiError(err, "No se pudo cargar zonas.");
    }
  }, [handleApiError]);

  const cargarSuministros = useCallback(async () => {
    setLoadingPadron(true);
    try {
      const params = {};
      if (String(filtros.q || "").trim()) params.q = filtros.q.trim();
      if (String(filtros.id_zona || "").trim()) params.id_zona = filtros.id_zona;
      if (filtros.estado && filtros.estado !== "TODOS") params.estado = filtros.estado;
      const res = await luzApi.get("/suministros", { params });
      const rows = Array.isArray(res.data) ? res.data : [];
      setSuministros(rows);
    } catch (err) {
      handleApiError(err, "No se pudo cargar padron de luz.");
    } finally {
      setLoadingPadron(false);
    }
  }, [filtros, handleApiError]);

  const cargarHistorial = useCallback(async (idSuministro) => {
    const id = Number(idSuministro || selectedSuministroId);
    if (!id) {
      setHistorial([]);
      return;
    }
    setLoadingHistorial(true);
    try {
      const res = await luzApi.get(`/recibos/historial/${id}`, { params: { anio: historialAnio } });
      setHistorial(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      handleApiError(err, "No se pudo cargar historial.");
    } finally {
      setLoadingHistorial(false);
    }
  }, [handleApiError, historialAnio, selectedSuministroId]);

  const cargarPendientes = useCallback(async (idSuministro) => {
    const id = Number(idSuministro || selectedSuministroId);
    if (!id) {
      setPendientes([]);
      return;
    }
    try {
      const res = await luzApi.get(`/recibos/pendientes/${id}`);
      setPendientes(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      handleApiError(err, "No se pudo cargar recibos pendientes.");
    }
  }, [handleApiError, selectedSuministroId]);

  const cargarLecturaAnterior = useCallback(async (idSuministro, anioRaw, mesRaw) => {
    const id = Number(idSuministro || 0);
    const anio = parseEntero(anioRaw, 0);
    const mes = parseEntero(mesRaw, 0);
    const periodoAnterior = getPeriodoAnterior(anio, mes);

    if (!id || !periodoAnterior) {
      setLecturaAnteriorInfo({
        loading: false,
        encontrada: false,
        periodoAnterior,
        error: ""
      });
      return;
    }

    setLecturaAnteriorInfo({
      loading: true,
      encontrada: false,
      periodoAnterior,
      error: ""
    });

    try {
      const res = await luzApi.get(`/recibos/lectura-anterior/${id}`, {
        params: { anio, mes }
      });
      const found = Boolean(res.data?.encontrada);
      const lectura = parseMonto(res.data?.lectura_anterior);
      setLecturaAnteriorInfo({
        loading: false,
        encontrada: found,
        periodoAnterior,
        error: ""
      });
      setReciboForm((prev) => {
        if (found) {
          return {
            ...prev,
            lectura_anterior: lectura.toFixed(2)
          };
        }
        return {
          ...prev,
          lectura_anterior: ""
        };
      });
    } catch (err) {
      setLecturaAnteriorInfo({
        loading: false,
        encontrada: false,
        periodoAnterior,
        error: String(err?.response?.data?.error || "No se pudo consultar lectura anterior.")
      });
      setReciboForm((prev) => ({
        ...prev,
        lectura_anterior: ""
      }));
    }
  }, []);

  const cargarConfig = useCallback(async () => {
    try {
      const [tarifas, fechas] = await Promise.all([
        luzApi.get("/config/tarifas"),
        luzApi.get("/config/fechas")
      ]);
      setTarifasForm({
        tarifa_kwh: String(parseMonto(tarifas.data?.tarifa_kwh).toFixed(2)),
        cargo_fijo: String(parseMonto(tarifas.data?.cargo_fijo).toFixed(2))
      });
      setFechasForm({
        dias_vencimiento: String(Number.parseInt(fechas.data?.dias_vencimiento, 10) || 6),
        dias_corte: String(Number.parseInt(fechas.data?.dias_corte, 10) || 10)
      });
    } catch (err) {
      handleApiError(err, "No se pudo cargar configuracion.");
    }
  }, [handleApiError]);

  const cargarAuditoria = useCallback(async () => {
    setLoadingAuditoria(true);
    try {
      const params = {};
      if (String(auditoriaFiltro || "").trim()) params.q = auditoriaFiltro.trim();
      const res = await luzApi.get("/auditoria", { params });
      setAuditoriaRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      if (Number(err?.response?.status || 0) === 404) {
        setAuditoriaRows([]);
        showFlash("warning", "Auditoria no disponible en el backend actual. Reinicie backend para aplicar la nueva ruta.");
      } else {
        handleApiError(err, "No se pudo cargar auditoria.");
      }
    } finally {
      setLoadingAuditoria(false);
    }
  }, [auditoriaFiltro, handleApiError, showFlash]);

  const cargarReporteCobranza = useCallback(async (fechaRef = fechaReporteCobranza) => {
    if (!permisos.canViewReportes) return;
    const fecha = String(fechaRef || "").trim();
    if (!isValidIsoDate(fecha)) {
      showFlash("warning", "Fecha de reporte invalida.");
      return;
    }
    setLoadingReporteCobranza(true);
    try {
      const res = await luzApi.get("/reportes/cobranza", {
        params: {
          tipo: "diario",
          fecha
        }
      });
      setReporteCobranza(res.data || null);
    } catch (err) {
      handleApiError(err, "No se pudo cargar reporte de cobranza.");
    } finally {
      setLoadingReporteCobranza(false);
    }
  }, [fechaReporteCobranza, handleApiError, permisos.canViewReportes, showFlash]);

  const enviarOrdenCajaDesdeRecibo = useCallback(async ({ recibo, suministro }) => {
    const idSuministro = Number(suministro?.id_suministro || 0);
    const idRecibo = Number(recibo?.id_recibo || 0);
    if (!idSuministro || !idRecibo) return;
    const saldoPendiente = parseMonto(recibo?.deuda_mes ?? (parseMonto(recibo?.total_pagar) - parseMonto(recibo?.abono_mes)));
    if (saldoPendiente <= 0.001) return;
    try {
      await luzApi.post("/ordenes-cobro", {
        id_suministro: idSuministro,
        items: [
          {
            id_recibo: idRecibo,
            monto_autorizado: saldoPendiente
          }
        ],
        observacion: "Emitida automaticamente desde ventanilla de luz al imprimir."
      });
    } catch (err) {
      const status = Number(err?.response?.status || 0);
      if (status === 409) return;
      handleApiError(err, "No se pudo enviar orden de cobro a caja.");
    }
  }, [handleApiError]);

  useEffect(() => {
    if (!usuarioSistema) return;
    cargarZonas();
    cargarSuministros();
    cargarConfig();
  }, [cargarConfig, cargarSuministros, cargarZonas, usuarioSistema]);

  useEffect(() => {
    if (tab !== "recibos") return;
    if (!selectedSuministroId || !usuarioSistema) {
      setHistorial([]);
      setPendientes([]);
      return;
    }
    cargarHistorial(selectedSuministroId);
    cargarPendientes(selectedSuministroId);
  }, [cargarHistorial, cargarPendientes, historialAnio, selectedSuministroId, tab, usuarioSistema]);

  useEffect(() => {
    if (tab !== "recibos") return;
    if (!selectedSuministroId || !usuarioSistema) {
      setLecturaAnteriorInfo({
        loading: false,
        encontrada: false,
        periodoAnterior: null,
        error: ""
      });
      setReciboForm((prev) => ({
        ...prev,
        lectura_anterior: "",
        fecha_emision: toIsoDate()
      }));
      return;
    }
    cargarLecturaAnterior(selectedSuministroId, reciboForm.anio, reciboForm.mes);
  }, [cargarLecturaAnterior, reciboForm.anio, reciboForm.mes, selectedSuministroId, tab, usuarioSistema]);

  useEffect(() => {
    if (!usuarioSistema || tab !== "auditoria") return;
    cargarAuditoria();
  }, [cargarAuditoria, tab, usuarioSistema]);

  useEffect(() => {
    if (tab !== "importar") return;
    if (permisos.canImportarPadron) return;
    setTab("padron");
  }, [permisos.canImportarPadron, tab]);

  useEffect(() => {
    if (!usuarioSistema || tab !== "reportes") return;
    if (!permisos.canViewReportes) return;
    cargarReporteCobranza(fechaReporteCobranza);
  }, [cargarReporteCobranza, fechaReporteCobranza, permisos.canViewReportes, tab, usuarioSistema]);

  useEffect(() => {
    if (!selectedSuministroId) return;
    const exists = suministros.some((s) => Number(s.id_suministro) === Number(selectedSuministroId));
    if (!exists) setSelectedSuministroId(null);
  }, [selectedSuministroId, suministros]);

  useEffect(() => {
    setIdsSuministrosImpresion((prev) => {
      const existentes = new Set(suministros.map((row) => Number(row.id_suministro || 0)));
      return prev.filter((id) => existentes.has(Number(id || 0)));
    });
  }, [suministros]);

  useEffect(() => {
    if (suministroForm.id_suministro) return;
    if (!nextIdUsuarioSugerido) return;
    setSuministroForm((prev) => {
      if (prev.id_suministro) return prev;
      const prevId = String(prev.nro_medidor || "").trim();
      const prevDir = String(prev.direccion || "").trim();
      const shouldSyncDireccion = !prevDir || prevDir === prevId;
      if (prevId === nextIdUsuarioSugerido && (!shouldSyncDireccion || prevDir === nextIdUsuarioSugerido)) {
        return prev;
      }
      return {
        ...prev,
        nro_medidor: nextIdUsuarioSugerido,
        direccion: shouldSyncDireccion ? nextIdUsuarioSugerido : prev.direccion
      };
    });
  }, [nextIdUsuarioSugerido, suministroForm.id_suministro]);

  const cargarFormularioDesdeSeleccionado = () => {
    if (!suministroSeleccionado) return;
    setSuministroForm({
      id_suministro: suministroSeleccionado.id_suministro,
      id_zona: String(suministroSeleccionado.id_zona || ""),
      zona_nombre: suministroSeleccionado.zona || "",
      nro_medidor: suministroSeleccionado.nro_medidor || "",
      nro_medidor_real: suministroSeleccionado.nro_medidor_real || "",
      nombre_usuario: suministroSeleccionado.nombre_usuario || "",
      direccion: suministroSeleccionado.direccion || "",
      estado: suministroSeleccionado.estado || "ACTIVO"
    });
  };

  const limpiarSeleccionSuministro = () => {
    setSelectedSuministroId(null);
    setSuministroForm(createEmptySuministroForm());
    setHistorial([]);
    setPendientes([]);
    setReciboForm((prev) => ({
      ...prev,
      lectura_anterior: "",
      lectura_actual: "",
      observacion: ""
    }));
  };

  const seleccionarSuministro = (row) => {
    if (!row) return;
    if (Number(selectedSuministroId) === Number(row.id_suministro)) {
      limpiarSeleccionSuministro();
      return;
    }
    setSelectedSuministroId(row.id_suministro);
    setSuministroForm({
      id_suministro: row.id_suministro,
      id_zona: String(row.id_zona || ""),
      zona_nombre: row.zona || "",
      nro_medidor: row.nro_medidor || "",
      nro_medidor_real: row.nro_medidor_real || "",
      nombre_usuario: row.nombre_usuario || "",
      direccion: row.direccion || "",
      estado: row.estado || "ACTIVO"
    });
  };

  const limpiarFormularioSuministro = () => {
    setSuministroForm(createEmptySuministroForm());
  };

  const guardarSuministro = async (e) => {
    e.preventDefault();
    if (!permisos.canEditarPadron) return;

    const payload = {
      nro_medidor: String(suministroForm.nro_medidor || "").trim(),
      nro_medidor_real: String(suministroForm.nro_medidor_real || "").trim(),
      nombre_usuario: String(suministroForm.nombre_usuario || "").trim(),
      direccion: String(suministroForm.direccion || "").trim(),
      estado: suministroForm.estado || "ACTIVO"
    };
    if (String(suministroForm.id_zona || "").trim()) {
      payload.id_zona = Number(suministroForm.id_zona);
    } else {
      payload.zona_nombre = String(suministroForm.zona_nombre || "").trim();
    }

    if (!payload.nro_medidor || !payload.nombre_usuario || (!payload.id_zona && !payload.zona_nombre)) {
      showFlash("warning", "Debe completar zona, ID y nombre.");
      return;
    }

    setGuardandoSuministro(true);
    try {
      if (suministroForm.id_suministro) {
        const res = await luzApi.put(`/suministros/${suministroForm.id_suministro}`, payload);
        showFlash("success", res.data?.mensaje || "Suministro actualizado.");
        setSelectedSuministroId(Number(suministroForm.id_suministro));
      } else {
        const res = await luzApi.post("/suministros", payload);
        showFlash("success", res.data?.mensaje || "Suministro registrado.");
        const nextId = Number(res.data?.suministro?.id_suministro || 0);
        if (nextId > 0) setSelectedSuministroId(nextId);
      }
      limpiarFormularioSuministro();
      await Promise.all([cargarZonas(), cargarSuministros()]);
    } catch (err) {
      handleApiError(err, "No se pudo guardar suministro.");
    } finally {
      setGuardandoSuministro(false);
    }
  };

  const eliminarSuministro = async () => {
    if (!permisos.canBorrarPadron || !suministroSeleccionado) return;
    const ok = window.confirm(`Eliminar suministro ID ${suministroSeleccionado.nro_medidor} de ${suministroSeleccionado.nombre_usuario}?`);
    if (!ok) return;
    try {
      const res = await luzApi.delete(`/suministros/${suministroSeleccionado.id_suministro}`);
      showFlash("success", res.data?.mensaje || "Suministro eliminado.");
      setSelectedSuministroId(null);
      setHistorial([]);
      setPendientes([]);
      await Promise.all([cargarSuministros(), cargarZonas()]);
    } catch (err) {
      handleApiError(err, "No se pudo eliminar suministro.");
    }
  };

  const emitirReciboManual = async (e) => {
    e.preventDefault();
    if (!permisos.canEmitirRecibo || !suministroSeleccionado) return;
    const lecturaAnteriorTxt = String(reciboForm.lectura_anterior || "").trim();
    const lecturaAnteriorNum = lecturaAnteriorTxt ? parseMonto(reciboForm.lectura_anterior) : 0;
    const lecturaActualNum = parseMonto(reciboForm.lectura_actual);
    if (lecturaAnteriorTxt && lecturaActualNum < lecturaAnteriorNum) {
      showFlash("warning", "Lectura actual debe ser mayor o igual que lectura anterior.");
      return;
    }

    const payload = {
      id_suministro: Number(suministroSeleccionado.id_suministro),
      anio: Number.parseInt(reciboForm.anio, 10),
      mes: Number.parseInt(reciboForm.mes, 10),
      lectura_actual: lecturaActualNum,
      fecha_emision: reciboForm.fecha_emision || toIsoDate(),
      observacion: String(reciboForm.observacion || "").trim()
    };
    if (lecturaAnteriorTxt) {
      payload.lectura_anterior = lecturaAnteriorNum;
    }
    if (String(reciboForm.fecha_vencimiento || "").trim()) payload.fecha_vencimiento = reciboForm.fecha_vencimiento;
    if (String(reciboForm.fecha_corte || "").trim()) payload.fecha_corte = reciboForm.fecha_corte;

    setEmitiendoRecibo(true);
    try {
      const res = await luzApi.post("/recibos", payload);
      showFlash("success", res.data?.mensaje || "Lectura registrada.");
      const suministroRecibo = {
        ...suministroSeleccionado,
        ...(res.data?.suministro || {})
      };
      await enviarOrdenCajaDesdeRecibo({
        recibo: res.data?.recibo || null,
        suministro: suministroRecibo
      });
      setReciboImpresion({
        recibo: res.data?.recibo || null,
        suministro: suministroRecibo
      });
      setReciboForm((prev) => ({ ...createReciboDefaults(), anio: prev.anio, mes: prev.mes }));
      await Promise.all([
        cargarSuministros(),
        cargarHistorial(suministroSeleccionado.id_suministro),
        cargarPendientes(suministroSeleccionado.id_suministro)
      ]);
    } catch (err) {
      handleApiError(err, "No se pudo registrar lectura.");
    } finally {
      setEmitiendoRecibo(false);
    }
  };

  const imprimirDesdeHistorial = async (row) => {
    if (!row || !suministroSeleccionado) return;
    await enviarOrdenCajaDesdeRecibo({
      recibo: row,
      suministro: suministroSeleccionado
    });
    setReciboImpresion({
      recibo: {
        ...row,
        id_recibo: row.id_recibo,
        fecha_emision: row.fecha_emision,
        fecha_vencimiento: row.fecha_vencimiento,
        fecha_corte: row.fecha_corte
      },
      suministro: suministroSeleccionado
    });
  };

  const toggleSuministroImpresion = useCallback((idSuministro) => {
    const id = Number(idSuministro || 0);
    if (!id) return;
    setIdsSuministrosImpresion((prev) => {
      if (prev.includes(id)) return prev.filter((it) => it !== id);
      return [...prev, id];
    });
  }, []);

  const seleccionarTodosSuministrosImpresion = useCallback(() => {
    setIdsSuministrosImpresion(
      suministrosOrdenados
        .map((row) => Number(row.id_suministro || 0))
        .filter((id) => id > 0)
    );
  }, [suministrosOrdenados]);

  const limpiarSuministrosImpresion = useCallback(() => {
    setIdsSuministrosImpresion([]);
  }, []);

  const obtenerObjetivosImpresion = useCallback((modo) => {
    const modoNorm = String(modo || "").toLowerCase();
    if (modoNorm === "seleccion") {
      const ids = new Set(idsSuministrosImpresion.map((id) => Number(id || 0)).filter((id) => id > 0));
      return suministrosOrdenados.filter((row) => ids.has(Number(row.id_suministro || 0)));
    }
    if (modoNorm === "zona") {
      const idZona = Number.parseInt(String(filtroZonaImpresion || ""), 10);
      if (!Number.isFinite(idZona) || idZona <= 0) return [];
      return suministrosOrdenados.filter((row) => Number.parseInt(String(row.id_zona || ""), 10) === idZona);
    }
    return suministrosOrdenados;
  }, [filtroZonaImpresion, idsSuministrosImpresion, suministrosOrdenados]);

  const imprimirRecibosLote = useCallback(async (modo) => {
    if (!permisos.canEmitirRecibo) return;

    const anio = parseEntero(periodoImpresion.anio, 0);
    const mes = parseEntero(periodoImpresion.mes, 0);
    if (!anio || mes < 1 || mes > 12) {
      showFlash("warning", "Periodo de impresion invalido.");
      return;
    }

    const objetivos = obtenerObjetivosImpresion(modo);
    if (objetivos.length === 0) {
      if (String(modo || "").toLowerCase() === "zona") {
        showFlash("warning", "No hay contribuyentes en zona seleccionada.");
        return;
      }
      if (String(modo || "").toLowerCase() === "seleccion") {
        showFlash("warning", "Seleccione al menos un contribuyente para impresion.");
        return;
      }
      showFlash("warning", "No hay contribuyentes para impresion.");
      return;
    }

    setProcesandoImpresionLote(true);
    try {
      const filas = await Promise.all(
        objetivos.map(async (suministro) => {
          const idSuministro = Number(suministro.id_suministro || 0);
          if (!idSuministro) return null;
          try {
            const res = await luzApi.get(`/recibos/historial/${idSuministro}`, { params: { anio } });
            const historialRows = Array.isArray(res.data) ? res.data : [];
            const candidatos = historialRows
              .filter((row) => Number(row?.anio) === anio && Number(row?.mes) === mes)
              .sort((a, b) => Number(b?.id_recibo || 0) - Number(a?.id_recibo || 0));
            if (!candidatos.length) return null;
            return {
              recibo: candidatos[0],
              suministro
            };
          } catch {
            return null;
          }
        })
      );

      const recibos = filas
        .filter(Boolean)
        .sort((a, b) => compareMedidorAsc(a?.suministro, b?.suministro));

      if (!recibos.length) {
        showFlash("warning", `No hay recibos emitidos para ${formatPeriodo(anio, mes)} en seleccion solicitada.`);
        return;
      }

      const faltantes = objetivos.length - recibos.length;
      setRecibosLoteImpresion(recibos);
      if (faltantes > 0) {
        showFlash("warning", `Listo para imprimir ${recibos.length} recibo(s). ${faltantes} contribuyente(s) sin recibo en periodo.`);
      } else {
        showFlash("success", `Listo para imprimir ${recibos.length} recibo(s) de ${formatPeriodo(anio, mes)}.`);
      }
    } finally {
      setProcesandoImpresionLote(false);
    }
  }, [obtenerObjetivosImpresion, permisos.canEmitirRecibo, periodoImpresion.anio, periodoImpresion.mes, showFlash]);

  const guardarTarifas = async (e) => {
    e.preventDefault();
    if (!permisos.canConfigurar) return;
    setGuardandoConfig("tarifas");
    try {
      const res = await luzApi.put("/config/tarifas", {
        tarifa_kwh: parseMonto(tarifasForm.tarifa_kwh),
        cargo_fijo: parseMonto(tarifasForm.cargo_fijo)
      });
      showFlash("success", res.data?.mensaje || "Tarifas actualizadas.");
      await cargarConfig();
    } catch (err) {
      handleApiError(err, "No se pudo guardar tarifas.");
    } finally {
      setGuardandoConfig("");
    }
  };

  const guardarFechas = async (e) => {
    e.preventDefault();
    if (!permisos.canConfigurar) return;
    setGuardandoConfig("fechas");
    try {
      const res = await luzApi.put("/config/fechas", {
        dias_vencimiento: Number.parseInt(fechasForm.dias_vencimiento, 10) || 0,
        dias_corte: Number.parseInt(fechasForm.dias_corte, 10) || 0
      });
      showFlash("success", res.data?.mensaje || "Fechas actualizadas.");
      await cargarConfig();
    } catch (err) {
      handleApiError(err, "No se pudo guardar fechas.");
    } finally {
      setGuardandoConfig("");
    }
  };

  const importarArchivo = async (tipo) => {
    if (!permisos.canImportarPadron) {
      showFlash("warning", "Solo administrador puede importar en el modulo de luz.");
      return;
    }
    const isPadron = tipo === "padron";
    const endpoint = isPadron ? "/importar/padron" : "/importar/lecturas";
    const file = isPadron ? importacion.archivoPadron : importacion.archivoLecturas;
    if (!file) {
      showFlash("warning", "Seleccione un archivo primero.");
      return;
    }
    const formData = new FormData();
    formData.append("archivo", file);
    setImportacion((prev) => ({ ...prev, subiendo: tipo }));
    try {
      const res = await luzApi.post(endpoint, formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      showFlash("success", res.data?.mensaje || "Archivo procesado.");
      setImportacion((prev) => ({
        ...prev,
        resultadoPadron: isPadron ? res.data : prev.resultadoPadron,
        resultadoLecturas: !isPadron ? res.data : prev.resultadoLecturas
      }));
      await Promise.all([
        cargarSuministros(),
        cargarZonas(),
        selectedSuministroId ? cargarHistorial(selectedSuministroId) : Promise.resolve(),
        selectedSuministroId ? cargarPendientes(selectedSuministroId) : Promise.resolve()
      ]);
    } catch (err) {
      handleApiError(err, "No se pudo importar archivo.");
    } finally {
      setImportacion((prev) => ({ ...prev, subiendo: "" }));
    }
  };

  if (!usuarioSistema) {
    return (
      <LoginPage
        apiClient={luzApi}
        tokenStorageKey={LUZ_TOKEN_KEY}
        titulo="Sistema Luz Municipal"
        subtitulo="Municipalidad Distrital de Pueblo Nuevo"
        loginPath="/auth/login"
        registerPath="/auth/registro"
        onBackToSelector={onBackToSelector}
        onLoginSuccess={(datos) => {
          const baseUser = datos?.id_usuario ? datos : datos;
          setUsuarioSistema(baseUser ? { ...baseUser, rol: normalizeRole(baseUser.rol), sistema: "LUZ" } : null);
        }}
      />
    );
  }

  return (
    <div className="d-flex flex-column min-vh-100 bg-light">
      <header className="bg-warning-subtle border-bottom p-3 d-flex justify-content-between align-items-center gap-2">
        <div>
          <h5 className="m-0 d-flex align-items-center gap-2">
            <FaBolt className="text-warning" />
            Sistema de Luz Municipal
          </h5>
          <div className="small text-muted">
            Usuario: <strong>{usuarioSistema?.nombre || usuarioSistema?.username}</strong> | {permisos.roleLabel}
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <img
            src="/logo.png"
            alt="Logo municipal"
            style={{ width: "42px", height: "42px", objectFit: "contain" }}
            className="rounded border bg-white p-1"
          />
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
            <button className={`nav-link ${tab === "padron" ? "active" : ""}`} onClick={() => setTab("padron")}>
              <FaList className="me-1" />
              Padron
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link ${tab === "recibos" ? "active" : ""}`} onClick={() => setTab("recibos")}>
              <FaReceipt className="me-1" />
              Recibos
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link ${tab === "config" ? "active" : ""}`} onClick={() => setTab("config")}>
              <FaCog className="me-1" />
              Config
            </button>
          </li>
          {permisos.canViewReportes && (
            <li className="nav-item">
              <button className={`nav-link ${tab === "reportes" ? "active" : ""}`} onClick={() => setTab("reportes")}>
                <FaChartBar className="me-1" />
                Reportes
              </button>
            </li>
          )}
          {permisos.canImportarPadron && (
            <li className="nav-item">
              <button className={`nav-link ${tab === "importar" ? "active" : ""}`} onClick={() => setTab("importar")}>
                <FaFileImport className="me-1" />
                Importar
              </button>
            </li>
          )}
          <li className="nav-item">
            <button className={`nav-link ${tab === "auditoria" ? "active" : ""}`} onClick={() => setTab("auditoria")}>
              <FaHistory className="me-1" />
              Auditoria
            </button>
          </li>
          {permisos.canManageUsers && (
            <li className="nav-item">
              <button className={`nav-link ${tab === "usuarios" ? "active" : ""}`} onClick={() => setTab("usuarios")}>
                <FaUserShield className="me-1" />
                Usuarios
              </button>
            </li>
          )}
        </ul>

        <div className="card border-top-0 shadow-sm">
          <div className="card-body">
            {tab === "padron" && (
              <div className="row g-3" onClick={limpiarSeleccionSuministro}>
                <div className="col-12 col-xl-8" onClick={(e) => e.stopPropagation()}>
                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <div className="input-group" style={{ maxWidth: "280px" }}>
                      <span className="input-group-text"><FaSearch /></span>
                      <input
                        className="form-control"
                        placeholder="Buscar por nombre, id o zona"
                        value={filtros.q}
                        onChange={(e) => setFiltros((prev) => ({ ...prev, q: e.target.value }))}
                      />
                    </div>
                    <select
                      className="form-select"
                      style={{ maxWidth: "220px" }}
                      value={filtros.id_zona}
                      onChange={(e) => setFiltros((prev) => ({ ...prev, id_zona: e.target.value }))}
                    >
                      <option value="">Todas las zonas</option>
                      {zonas.map((z) => (
                        <option key={z.id_zona} value={z.id_zona}>{z.nombre}</option>
                      ))}
                    </select>
                    <select
                      className="form-select"
                      style={{ maxWidth: "190px" }}
                      value={filtros.estado}
                      onChange={(e) => setFiltros((prev) => ({ ...prev, estado: e.target.value }))}
                    >
                      <option value="TODOS">Todos</option>
                      <option value="ACTIVO">Activo</option>
                      <option value="CORTADO">Cortado</option>
                      <option value="INACTIVO">Inactivo</option>
                    </select>
                    <button className="btn btn-outline-primary d-flex align-items-center gap-2" onClick={cargarSuministros} disabled={loadingPadron}>
                      <FaSyncAlt />
                      {loadingPadron ? "Actualizando..." : "Recargar"}
                    </button>
                  </div>

                  <div className="table-responsive border rounded" style={{ maxHeight: "58vh" }}>
                    <table className="table table-hover table-sm align-middle mb-0">
                      <thead className="table-light sticky-top">
                        <tr>
                          <th style={{ minWidth: "120px" }}>Zona</th>
                          <th style={{ minWidth: "120px" }}>ID</th>
                          <th style={{ minWidth: "140px" }}>Medidor real</th>
                          <th style={{ minWidth: "260px" }}>Usuario</th>
                          <th style={{ minWidth: "100px" }}>Estado</th>
                          <th className="text-end text-nowrap" style={{ minWidth: "120px" }}>Deuda</th>
                          <th className="text-center text-nowrap" style={{ minWidth: "70px" }}>Meses</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingPadron && suministros.length === 0 && (
                          <tr><td colSpan="7" className="text-center py-3">Cargando...</td></tr>
                        )}
                        {!loadingPadron && suministros.length === 0 && (
                          <tr><td colSpan="7" className="text-center py-3 text-muted">Sin registros</td></tr>
                        )}
                        {suministrosOrdenados.map((row) => (
                          <tr
                            key={row.id_suministro}
                            className={Number(selectedSuministroId) === Number(row.id_suministro) ? "table-primary" : ""}
                            style={{ cursor: "pointer" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              seleccionarSuministro(row);
                            }}
                          >
                            <td>{row.zona}</td>
                            <td className="fw-semibold">{row.nro_medidor || "-"}</td>
                            <td className="text-muted">{row.nro_medidor_real || "-"}</td>
                            <td>
                              <div className="fw-semibold">{row.nombre_usuario}</div>
                              {String(row.direccion || "").trim() && (
                                <div className="small text-muted">{row.direccion}</div>
                              )}
                            </td>
                            <td>
                              <span className={`badge ${row.estado === "ACTIVO" ? "bg-success" : row.estado === "CORTADO" ? "bg-danger" : "bg-secondary"}`}>
                                {row.estado}
                              </span>
                            </td>
                            <td className="text-end text-nowrap">{formatMoney(row.deuda_total)}</td>
                            <td className="text-center text-nowrap">{Number(row.meses_deuda || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="col-12 col-xl-4" onClick={(e) => e.stopPropagation()}>
                  <div className="card border">
                    <div className="card-header d-flex justify-content-between align-items-center">
                      <strong>{suministroForm.id_suministro ? "Editar suministro" : "Nuevo suministro"}</strong>
                      {suministroSeleccionado && (
                        <button className="btn btn-outline-secondary btn-sm" onClick={cargarFormularioDesdeSeleccionado}>
                          Cargar seleccionado
                        </button>
                      )}
                    </div>
                    <div className="card-body">
                      <form onSubmit={guardarSuministro}>
                        <div className="mb-2">
                          <label className="form-label">Zona</label>
                          <select
                            className="form-select"
                            value={suministroForm.id_zona}
                            onChange={(e) => setSuministroForm((prev) => ({ ...prev, id_zona: e.target.value }))}
                          >
                            <option value="">Nueva zona...</option>
                            {zonas.map((z) => (
                              <option key={z.id_zona} value={z.id_zona}>{z.nombre}</option>
                            ))}
                          </select>
                        </div>
                        {!String(suministroForm.id_zona || "").trim() && (
                          <div className="mb-2">
                            <label className="form-label">Nombre de zona</label>
                            <input
                              className="form-control"
                              value={suministroForm.zona_nombre}
                              onChange={(e) => setSuministroForm((prev) => ({ ...prev, zona_nombre: e.target.value }))}
                            />
                          </div>
                        )}
                        <div className="mb-2">
                          <label className="form-label">ID usuario (autogenerado por zona)</label>
                          <input
                            className="form-control"
                            value={suministroForm.nro_medidor}
                            onChange={(e) => setSuministroForm((prev) => ({ ...prev, nro_medidor: e.target.value }))}
                            readOnly={!suministroForm.id_suministro}
                            required
                          />
                          {!suministroForm.id_suministro && (
                            <div className="form-text">Se calcula segun orden creciente de IDs en zona seleccionada.</div>
                          )}
                        </div>
                        <div className="mb-2">
                          <label className="form-label">Nro medidor (pendiente de validacion)</label>
                          <input
                            className="form-control"
                            value={suministroForm.nro_medidor_real}
                            onChange={(e) => setSuministroForm((prev) => ({ ...prev, nro_medidor_real: e.target.value }))}
                            placeholder="Digite nro de medidor real"
                          />
                        </div>
                        <div className="mb-2">
                          <label className="form-label">Nombre usuario</label>
                          <input
                            className="form-control"
                            value={suministroForm.nombre_usuario}
                            onChange={(e) => setSuministroForm((prev) => ({ ...prev, nombre_usuario: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="mb-2">
                          <label className="form-label">Direccion</label>
                          <input
                            className="form-control"
                            value={suministroForm.direccion}
                            onChange={(e) => setSuministroForm((prev) => ({ ...prev, direccion: e.target.value }))}
                          />
                        </div>
                        <div className="mb-3">
                          <label className="form-label">Estado</label>
                          <select
                            className="form-select"
                            value={suministroForm.estado}
                            onChange={(e) => setSuministroForm((prev) => ({ ...prev, estado: e.target.value }))}
                          >
                            <option value="ACTIVO">ACTIVO</option>
                            <option value="CORTADO">CORTADO</option>
                            <option value="INACTIVO">INACTIVO</option>
                          </select>
                        </div>
                        <div className="d-flex flex-wrap gap-2">
                          <button type="submit" disabled={!permisos.canEditarPadron || guardandoSuministro} className="btn btn-primary btn-sm d-flex align-items-center gap-2">
                            <FaSave />
                            {guardandoSuministro ? "Guardando..." : "Guardar"}
                          </button>
                          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={limpiarFormularioSuministro}>
                            Limpiar
                          </button>
                          <button type="button" className="btn btn-outline-dark btn-sm" onClick={limpiarSeleccionSuministro}>
                            Deseleccionar
                          </button>
                          {permisos.canBorrarPadron && (
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm d-flex align-items-center gap-2"
                              disabled={!suministroSeleccionado}
                              onClick={eliminarSuministro}
                            >
                              <FaTrashAlt />
                              Eliminar
                            </button>
                          )}
                        </div>
                      </form>
                    </div>
                  </div>

                  {suministroSeleccionado && (
                    <div className="card border mt-3">
                      <div className="card-body">
                        <div className="fw-semibold mb-1">{suministroSeleccionado.nombre_usuario}</div>
                        <div className="small text-muted">ID: {suministroSeleccionado.nro_medidor}</div>
                        <div className="small text-muted">Medidor: {suministroSeleccionado.nro_medidor_real || "-"}</div>
                        <div className="small text-muted">Zona: {suministroSeleccionado.zona}</div>
                        <div className="small text-muted">Deuda: {formatMoney(suministroSeleccionado.deuda_total)}</div>
                        <div className="small text-muted">Meses deuda: {suministroSeleccionado.meses_deuda}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {tab === "recibos" && (
              <div className="row g-3">
                <div className="col-12 col-xl-4">
                  <div className="card border">
                    <div className="card-header fw-semibold">Registro mensual de lectura</div>
                    <div className="card-body">
                      {!suministroSeleccionado ? (
                        <div className="text-muted small">Seleccione un suministro en Padron para registrar lectura mensual.</div>
                      ) : (
                        <>
                          <div className="small mb-3">
                            <div><strong>Usuario:</strong> {suministroSeleccionado.nombre_usuario}</div>
                            <div><strong>Zona:</strong> {suministroSeleccionado.zona}</div>
                            <div><strong>ID:</strong> {suministroSeleccionado.nro_medidor}</div>
                            <div><strong>Medidor:</strong> -</div>
                          </div>
                          <form onSubmit={emitirReciboManual}>
                            <div className="row g-2">
                              <div className="col-6">
                                <label className="form-label">Año</label>
                                <input
                                  type="number"
                                  className="form-control"
                                  min="2000"
                                  max="2200"
                                  value={reciboForm.anio}
                                  onChange={(e) => setReciboForm((prev) => ({ ...prev, anio: e.target.value }))}
                                  required
                                />
                              </div>
                              <div className="col-6">
                                <label className="form-label">Mes</label>
                                <input
                                  type="number"
                                  className="form-control"
                                  min="1"
                                  max="12"
                                  value={reciboForm.mes}
                                  onChange={(e) => setReciboForm((prev) => ({ ...prev, mes: e.target.value }))}
                                  required
                                />
                              </div>
                              <div className="col-6">
                                <label className="form-label">Lectura anterior</label>
                                <input
                                  type="number"
                                  className="form-control"
                                  step="0.01"
                                  value={reciboForm.lectura_anterior}
                                  onChange={(e) => setReciboForm((prev) => ({ ...prev, lectura_anterior: e.target.value }))}
                                  disabled={lecturaAnteriorInfo.loading}
                                />
                                <div className="form-text">
                                  {lecturaAnteriorInfo.loading && "Buscando lectura del mes anterior..."}
                                  {!lecturaAnteriorInfo.loading && lecturaAnteriorInfo.encontrada && lecturaAnteriorInfo.periodoAnterior && (
                                    <>Auto desde {formatPeriodoCorto(lecturaAnteriorInfo.periodoAnterior.anio, lecturaAnteriorInfo.periodoAnterior.mes)}.</>
                                  )}
                                  {!lecturaAnteriorInfo.loading && !lecturaAnteriorInfo.encontrada && lecturaAnteriorInfo.periodoAnterior && (
                                    <>Sin registro en {formatPeriodoCorto(lecturaAnteriorInfo.periodoAnterior.anio, lecturaAnteriorInfo.periodoAnterior.mes)}. Puede dejar valor referencial vacio o ingresarlo manual.</>
                                  )}
                                  {!lecturaAnteriorInfo.loading && !lecturaAnteriorInfo.periodoAnterior && "Ingrese año y mes validos."}
                                  {!lecturaAnteriorInfo.loading && lecturaAnteriorInfo.error && ` ${lecturaAnteriorInfo.error}`}
                                </div>
                              </div>
                              <div className="col-6">
                                <label className="form-label">Lectura actual</label>
                                <input
                                  type="number"
                                  className="form-control"
                                  min={String(lecturaAnteriorInfo.loading ? 0 : Math.max(0, parseMonto(reciboForm.lectura_anterior)))}
                                  step="0.01"
                                  value={reciboForm.lectura_actual}
                                  onChange={(e) => setReciboForm((prev) => ({ ...prev, lectura_actual: e.target.value }))}
                                  required
                                />
                              </div>
                              <div className="col-4">
                                <label className="form-label">Emision</label>
                                <input
                                  type="date"
                                  className="form-control"
                                  value={reciboForm.fecha_emision}
                                  readOnly
                                  disabled
                                />
                              </div>
                              <div className="col-4">
                                <label className="form-label">Vencimiento</label>
                                <input
                                  type="date"
                                  className="form-control"
                                  value={reciboForm.fecha_vencimiento}
                                  onChange={(e) => setReciboForm((prev) => ({ ...prev, fecha_vencimiento: e.target.value }))}
                                />
                              </div>
                              <div className="col-4">
                                <label className="form-label">Corte</label>
                                <input
                                  type="date"
                                  className="form-control"
                                  value={reciboForm.fecha_corte}
                                  onChange={(e) => setReciboForm((prev) => ({ ...prev, fecha_corte: e.target.value }))}
                                />
                              </div>
                            </div>
                            <div className="mt-2">
                              <label className="form-label">Observacion</label>
                              <textarea
                                rows="2"
                                className="form-control"
                                value={reciboForm.observacion}
                                onChange={(e) => setReciboForm((prev) => ({ ...prev, observacion: e.target.value }))}
                              />
                            </div>
                            <button
                              type="submit"
                              className="btn btn-primary mt-3 d-flex align-items-center gap-2"
                              disabled={!permisos.canEmitirRecibo || emitiendoRecibo}
                            >
                              <FaReceipt />
                              {emitiendoRecibo ? "Registrando..." : "Registrar lectura"}
                            </button>
                          </form>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="card border mt-3">
                    <div className="card-header fw-semibold">Recibos pendientes del suministro</div>
                    <div className="card-body p-2">
                      {!suministroSeleccionado && <div className="small text-muted p-2">Sin suministro seleccionado.</div>}
                      {suministroSeleccionado && pendientes.length === 0 && <div className="small text-muted p-2">Sin pendientes.</div>}
                      {suministroSeleccionado && pendientes.length > 0 && (
                        <div className="table-responsive" style={{ maxHeight: "220px" }}>
                          <table className="table table-sm mb-0">
                            <thead>
                              <tr>
                                <th>Periodo</th>
                                <th className="text-end">Saldo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pendientes.map((p) => (
                                <tr key={p.id_recibo}>
                                  <td>{formatPeriodo(p.anio, p.mes)}</td>
                                  <td className="text-end">{formatMoney(p.deuda_mes)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr>
                                <th>Total</th>
                                <th className="text-end">{formatMoney(totalPendienteSeleccionado)}</th>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                </div>

                <div className="col-12 col-xl-8">
                  <div className="card border mb-2">
                    <div className="card-body p-2">
                      <div className="d-flex flex-wrap gap-2 align-items-end">
                        <button className="btn btn-outline-primary btn-sm d-flex align-items-center gap-2" onClick={() => cargarHistorial()}>
                          <FaSyncAlt />
                          Recargar historial
                        </button>
                        <div>
                          <label className="form-label form-label-sm mb-1 small text-muted">Historial</label>
                          <select
                            className="form-select form-select-sm"
                            style={{ minWidth: "150px" }}
                            value={historialAnio}
                            onChange={(e) => setHistorialAnio(e.target.value)}
                          >
                            <option value="all">Todos los años</option>
                            {yearsHistorial.map((y) => (
                              <option key={y} value={y}>{y}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="form-label form-label-sm mb-1 small text-muted">Año impresión</label>
                          <input
                            type="number"
                            min="2000"
                            max="2200"
                            className="form-control form-control-sm"
                            style={{ width: "110px" }}
                            value={periodoImpresion.anio}
                            onChange={(e) => setPeriodoImpresion((prev) => ({ ...prev, anio: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="form-label form-label-sm mb-1 small text-muted">Mes impresión</label>
                          <input
                            type="number"
                            min="1"
                            max="12"
                            className="form-control form-control-sm"
                            style={{ width: "90px" }}
                            value={periodoImpresion.mes}
                            onChange={(e) => setPeriodoImpresion((prev) => ({ ...prev, mes: e.target.value }))}
                          />
                        </div>
                        <button
                          className="btn btn-outline-dark btn-sm d-flex align-items-center gap-2"
                          disabled={procesandoImpresionLote}
                          onClick={() => imprimirRecibosLote("todos")}
                        >
                          <FaPrint />
                          {procesandoImpresionLote ? "Preparando..." : "Imprimir todos"}
                        </button>
                      </div>

                      <div className="row g-2 mt-1">
                        <div className="col-12 col-lg-5">
                          <div className="d-flex gap-2 align-items-end">
                            <div className="flex-grow-1">
                              <label className="form-label form-label-sm mb-1 small text-muted">Zona</label>
                              <select
                                className="form-select form-select-sm"
                                value={filtroZonaImpresion}
                                onChange={(e) => setFiltroZonaImpresion(e.target.value)}
                              >
                                <option value="">Seleccione zona...</option>
                                {zonas.map((z) => (
                                  <option key={z.id_zona} value={z.id_zona}>{z.nombre}</option>
                                ))}
                              </select>
                            </div>
                            <button
                              className="btn btn-outline-dark btn-sm d-flex align-items-center gap-2"
                              disabled={procesandoImpresionLote}
                              onClick={() => imprimirRecibosLote("zona")}
                            >
                              <FaPrint />
                              Imprimir zona
                            </button>
                          </div>
                        </div>
                        <div className="col-12 col-lg-7">
                          <div className="d-flex flex-wrap gap-2 align-items-center">
                            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={seleccionarTodosSuministrosImpresion}>
                              Seleccionar todos
                            </button>
                            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={limpiarSuministrosImpresion}>
                              Limpiar
                            </button>
                            <button
                              className="btn btn-outline-dark btn-sm d-flex align-items-center gap-2"
                              disabled={procesandoImpresionLote || idsSuministrosImpresion.length === 0}
                              onClick={() => imprimirRecibosLote("seleccion")}
                            >
                              <FaPrint />
                              Imprimir seleccion ({idsSuministrosImpresion.length})
                            </button>
                          </div>
                          <div className="border rounded p-2 mt-2" style={{ maxHeight: "130px", overflowY: "auto" }}>
                            {suministrosOrdenados.length === 0 && (
                              <div className="small text-muted">Sin contribuyentes en padron.</div>
                            )}
                            {suministrosOrdenados.map((row) => {
                              const idSuministro = Number(row.id_suministro || 0);
                              return (
                                <label key={`chk-print-${idSuministro}`} className="d-flex align-items-center gap-2 small mb-1">
                                  <input
                                    type="checkbox"
                                    checked={idsSuministrosImpresionSet.has(idSuministro)}
                                    onChange={() => toggleSuministroImpresion(idSuministro)}
                                  />
                                  <span>
                                    {row.zona || "-"} | {row.nro_medidor || "-"} | {row.nombre_usuario || "Contribuyente"}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="table-responsive border rounded" style={{ maxHeight: "70vh" }}>
                    <table className="table table-sm table-hover align-middle mb-0">
                      <thead className="table-light sticky-top">
                        <tr>
                          <th>Periodo</th>
                          <th className="text-end">Lect. Ant</th>
                          <th className="text-end">Lect. Act</th>
                          <th className="text-end">Consumo</th>
                          <th className="text-end">Energia</th>
                          <th className="text-end">Mantenimiento</th>
                          <th className="text-end">Total</th>
                          <th>Estado</th>
                          <th>Fechas</th>
                          <th className="text-center">Recibo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingHistorial && <tr><td colSpan="10" className="text-center py-3">Cargando...</td></tr>}
                        {!loadingHistorial && historial.length === 0 && (
                          <tr><td colSpan="10" className="text-center py-3 text-muted">Sin historial</td></tr>
                        )}
                        {!loadingHistorial && historial.map((row) => (
                          <tr key={row.id_recibo}>
                            <td>{MONTH_LABELS[Number(row.mes)] || row.mes} {row.anio}</td>
                            <td className="text-end">{parseMonto(row.lectura_anterior).toFixed(2)}</td>
                            <td className="text-end">{parseMonto(row.lectura_actual).toFixed(2)}</td>
                            <td className="text-end">{parseMonto(row.consumo_kwh).toFixed(2)}</td>
                            <td className="text-end">{formatMoney(row.energia_activa)}</td>
                            <td className="text-end">{formatMoney(row.mantenimiento)}</td>
                            <td className="text-end fw-semibold">{formatMoney(row.total_pagar)}</td>
                            <td>
                              <span className={`badge ${row.estado === "PAGADO" ? "bg-success" : row.estado === "PARCIAL" ? "bg-warning text-dark" : "bg-secondary"}`}>
                                {row.estado}
                              </span>
                            </td>
                            <td className="small">
                              <div>E: {formatFechaCorta(row.fecha_emision)}</div>
                              <div>V: {formatFechaCorta(row.fecha_vencimiento)}</div>
                              <div>C: {formatFechaCorta(row.fecha_corte)}</div>
                            </td>
                            <td className="text-center">
                              <button className="btn btn-outline-dark btn-sm" onClick={() => imprimirDesdeHistorial(row)}>
                                <FaPrint />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
            {tab === "config" && (
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <div className="card border">
                    <div className="card-header fw-semibold">Tarifas</div>
                    <div className="card-body">
                      <form onSubmit={guardarTarifas}>
                        <div className="mb-2">
                          <label className="form-label">Tarifa por kWh</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="form-control"
                            value={tarifasForm.tarifa_kwh}
                            onChange={(e) => setTarifasForm((prev) => ({ ...prev, tarifa_kwh: e.target.value }))}
                          />
                        </div>
                        <div className="mb-3">
                          <label className="form-label">Mantenimiento y otros</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="form-control"
                            value={tarifasForm.cargo_fijo}
                            onChange={(e) => setTarifasForm((prev) => ({ ...prev, cargo_fijo: e.target.value }))}
                          />
                        </div>
                        <button className="btn btn-primary" type="submit" disabled={!permisos.canConfigurar || guardandoConfig === "tarifas"}>
                          Guardar tarifas
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
                <div className="col-12 col-md-6">
                  <div className="card border">
                    <div className="card-header fw-semibold">Fechas por defecto</div>
                    <div className="card-body">
                      <form onSubmit={guardarFechas}>
                        <div className="mb-2">
                          <label className="form-label">Dias para vencimiento</label>
                          <input
                            type="number"
                            min="0"
                            max="90"
                            className="form-control"
                            value={fechasForm.dias_vencimiento}
                            onChange={(e) => setFechasForm((prev) => ({ ...prev, dias_vencimiento: e.target.value }))}
                          />
                        </div>
                        <div className="mb-3">
                          <label className="form-label">Dias para corte</label>
                          <input
                            type="number"
                            min="0"
                            max="120"
                            className="form-control"
                            value={fechasForm.dias_corte}
                            onChange={(e) => setFechasForm((prev) => ({ ...prev, dias_corte: e.target.value }))}
                          />
                        </div>
                        <button className="btn btn-primary" type="submit" disabled={!permisos.canConfigurar || guardandoConfig === "fechas"}>
                          Guardar fechas
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {tab === "reportes" && permisos.canViewReportes && (
              <div className="row g-3">
                <div className="col-12">
                  <div className="card border">
                    <div className="card-header d-flex flex-wrap gap-2 align-items-center justify-content-between">
                      <strong>Reporte diario de cobranza (luz)</strong>
                      <div className="d-flex flex-wrap gap-2 align-items-center">
                        <input
                          type="date"
                          className="form-control form-control-sm"
                          style={{ width: "170px" }}
                          value={fechaReporteCobranza}
                          max={toIsoDate()}
                          onChange={(e) => setFechaReporteCobranza(e.target.value)}
                        />
                        <button
                          className="btn btn-outline-primary btn-sm d-flex align-items-center gap-2"
                          onClick={() => cargarReporteCobranza(fechaReporteCobranza)}
                          disabled={loadingReporteCobranza}
                        >
                          <FaSyncAlt />
                          {loadingReporteCobranza ? "Consultando..." : "Consultar"}
                        </button>
                      </div>
                    </div>
                    <div className="card-body">
                      <div className="row g-2 mb-3">
                        <div className="col-12 col-md-4">
                          <div className="rounded p-3 bg-success text-white">
                            <div className="small fw-semibold opacity-75">TOTAL RECAUDADO</div>
                            <div className="fs-4 fw-bold">{formatMoney(reporteCobranza?.total || 0)}</div>
                          </div>
                        </div>
                        <div className="col-12 col-md-4">
                          <div className="rounded p-3 bg-primary text-white">
                            <div className="small fw-semibold opacity-75">MOVIMIENTOS</div>
                            <div className="fs-4 fw-bold">{Number(reporteCobranza?.cantidad_movimientos || 0)}</div>
                          </div>
                        </div>
                        <div className="col-12 col-md-4">
                          <div className="rounded p-3 bg-dark text-white">
                            <div className="small fw-semibold opacity-75">FECHA CONSULTA</div>
                            <div className="fs-5 fw-bold">{reporteCobranza?.fecha_referencia || fechaReporteCobranza}</div>
                          </div>
                        </div>
                      </div>

                      <div className="table-responsive border rounded" style={{ maxHeight: "62vh" }}>
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
                            {!loadingReporteCobranza && (!Array.isArray(reporteCobranza?.movimientos) || reporteCobranza.movimientos.length === 0) && (
                              <tr>
                                <td colSpan="7" className="text-center py-3 text-muted">Sin movimientos para la fecha consultada.</td>
                              </tr>
                            )}
                            {Array.isArray(reporteCobranza?.movimientos) && reporteCobranza.movimientos.map((row) => (
                              <tr key={`rep-vent-luz-${Number(row?.id_pago || 0)}`}>
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
                  </div>
                </div>
              </div>
            )}
            {tab === "usuarios" && (
              <UsuariosLuzPanel
                visible={tab === "usuarios"}
                usuarioActivo={usuarioSistema}
                canManageUsers={permisos.canManageUsers}
                onFlash={showFlash}
              />
            )}

            {tab === "importar" && (
              <div className="row g-3">
                <div className="col-12 col-lg-6">
                  <div className="card border">
                    <div className="card-header fw-semibold">Importar padron inicial</div>
                    <div className="card-body">
                      <div className="small text-muted mb-2">
                        Formato esperado: archivo Excel por hojas, donde cada hoja representa una zona.
                      </div>
                      <input
                        type="file"
                        className="form-control"
                        accept=".xlsx,.xls,.csv"
                        onChange={(e) => setImportacion((prev) => ({ ...prev, archivoPadron: e.target.files?.[0] || null }))}
                      />
                      <button
                        className="btn btn-primary mt-3"
                        disabled={!permisos.canImportarPadron || importacion.subiendo === "padron"}
                        onClick={() => importarArchivo("padron")}
                      >
                        {importacion.subiendo === "padron" ? "Importando..." : "Importar padron"}
                      </button>
                      {importacion.resultadoPadron && (
                        <div className="mt-3 small">
                          <div><strong>Recibidos:</strong> {importacion.resultadoPadron.total_recibidos}</div>
                          <div><strong>Importados:</strong> {importacion.resultadoPadron.total_importados}</div>
                          <div><strong>Rechazados:</strong> {importacion.resultadoPadron.total_rechazados}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="col-12 col-lg-6">
                  <div className="card border">
                    <div className="card-header fw-semibold">Importar lecturas masivas</div>
                    <div className="card-body">
                      <div className="small text-muted mb-2">
                        Plantilla: zona, id_usuario (columna nro_medidor), año, mes, lectura_actual, observación(opcional).
                      </div>
                      <input
                        type="file"
                        className="form-control"
                        accept=".xlsx,.xls,.csv"
                        onChange={(e) => setImportacion((prev) => ({ ...prev, archivoLecturas: e.target.files?.[0] || null }))}
                      />
                      <button
                        className="btn btn-primary mt-3"
                        disabled={!permisos.canImportarLecturas || importacion.subiendo === "lecturas"}
                        onClick={() => importarArchivo("lecturas")}
                      >
                        {importacion.subiendo === "lecturas" ? "Importando..." : "Importar lecturas"}
                      </button>
                      {importacion.resultadoLecturas && (
                        <div className="mt-3 small">
                          <div><strong>Recibidos:</strong> {importacion.resultadoLecturas.total_recibidos}</div>
                          <div><strong>Importados:</strong> {importacion.resultadoLecturas.total_importados}</div>
                          <div><strong>Rechazados:</strong> {importacion.resultadoLecturas.total_rechazados}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {(importacion.resultadoPadron?.rechazos?.length > 0 || importacion.resultadoLecturas?.rechazos?.length > 0) && (
                  <div className="col-12">
                    <div className="card border">
                      <div className="card-header fw-semibold">Rechazos de importacion (muestra)</div>
                      <div className="card-body p-0">
                        <div className="table-responsive" style={{ maxHeight: "280px" }}>
                          <table className="table table-sm mb-0">
                            <thead className="table-light sticky-top">
                              <tr>
                                <th>Tipo</th>
                                <th>Linea</th>
                                <th>Zona</th>
                                <th>ID usuario</th>
                                <th>Año/Mes</th>
                                <th>Motivo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...(importacion.resultadoPadron?.rechazos || []), ...(importacion.resultadoLecturas?.rechazos || [])].map((r, idx) => (
                                <tr key={`${r.tipo}-${idx}`}>
                                  <td>{r.tipo}</td>
                                  <td>{r.linea || "-"}</td>
                                  <td>{r.zona || "-"}</td>
                                  <td>{r.nro_medidor || "-"}</td>
                                  <td>{r.anio ? `${r.anio}/${r.mes || ""}` : "-"}</td>
                                  <td>{r.motivo}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {tab === "auditoria" && (
              <div className="row g-3">
                <div className="col-12">
                  <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
                    <div className="input-group" style={{ maxWidth: "360px" }}>
                      <span className="input-group-text"><FaSearch /></span>
                      <input
                        className="form-control"
                        placeholder="Buscar por usuario, accion o detalle"
                        value={auditoriaFiltro}
                        onChange={(e) => setAuditoriaFiltro(e.target.value)}
                      />
                    </div>
                    <button className="btn btn-outline-primary btn-sm d-flex align-items-center gap-2" onClick={cargarAuditoria} disabled={loadingAuditoria}>
                      <FaSyncAlt />
                      Recargar auditoria
                    </button>
                  </div>

                  <div className="table-responsive border rounded" style={{ maxHeight: "72vh" }}>
                    <table className="table table-sm table-hover align-middle mb-0">
                      <thead className="table-light sticky-top">
                        <tr>
                          <th style={{ minWidth: "170px" }}>Fecha</th>
                          <th style={{ minWidth: "170px" }}>Usuario</th>
                          <th style={{ minWidth: "220px" }}>Accion</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingAuditoria && <tr><td colSpan="4" className="text-center py-3">Cargando...</td></tr>}
                        {!loadingAuditoria && auditoriaRows.length === 0 && (
                          <tr><td colSpan="4" className="text-center py-3 text-muted">Sin registros de auditoria.</td></tr>
                        )}
                        {!loadingAuditoria && auditoriaRows.map((row) => (
                          <tr key={row.id_auditoria}>
                            <td>{formatFechaHora(row.fecha)}</td>
                            <td>{row.usuario || "-"}</td>
                            <td><span className="badge bg-secondary">{row.accion}</span></td>
                            <td>{row.detalle || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ position: "fixed", left: "-10000px", top: 0, width: "210mm", background: "#fff" }}>
        <ReciboLuz ref={reciboRef} datos={reciboImpresion} />
      </div>
      <div style={{ position: "fixed", left: "-10000px", top: 0, width: "210mm", background: "#fff" }}>
        <RecibosLuzLote ref={recibosLoteRef} items={recibosLoteImpresion} />
      </div>
    </div>
  );
}

export default LuzApp;

