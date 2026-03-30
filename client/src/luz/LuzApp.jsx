import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import {
  FaBolt,
  FaCalendarAlt,
  FaCashRegister,
  FaCog,
  FaFileImport,
  FaList,
  FaPrint,
  FaReceipt,
  FaSave,
  FaSearch,
  FaSignOutAlt,
  FaSyncAlt,
  FaTrashAlt
} from "react-icons/fa";
import LoginPage from "../components/LoginPage";
import luzApi from "./apiLuz";
import ReciboLuz from "./ReciboLuz";

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

const parseMonto = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMoney = (value) => `S/. ${parseMonto(value).toFixed(2)}`;
const formatPeriodo = (anio, mes) => `${String(mes).padStart(2, "0")}/${anio}`;
const formatFechaHora = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString("es-PE");
};

const createEmptySuministroForm = () => ({
  id_suministro: null,
  id_zona: "",
  zona_nombre: "",
  nro_medidor: "",
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
    fecha_emision: "",
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
  const [emitiendoRecibo, setEmitiendoRecibo] = useState(false);

  const [ordenObservacion, setOrdenObservacion] = useState("");
  const [ordenesPendientes, setOrdenesPendientes] = useState([]);
  const [soloOrdenesDelSeleccionado, setSoloOrdenesDelSeleccionado] = useState(true);
  const [loadingOrdenes, setLoadingOrdenes] = useState(false);
  const [ordenEnProceso, setOrdenEnProceso] = useState(0);

  const [tarifasForm, setTarifasForm] = useState({ tarifa_kwh: "1.00", cargo_fijo: "6.50" });
  const [fechasForm, setFechasForm] = useState({ dias_vencimiento: "6", dias_corte: "10" });
  const [guardandoConfig, setGuardandoConfig] = useState("");

  const [reporteTipo, setReporteTipo] = useState("diario");
  const [reporteFecha, setReporteFecha] = useState(toIsoDate());
  const [reporteCaja, setReporteCaja] = useState(null);
  const [loadingReporte, setLoadingReporte] = useState(false);

  const [importacion, setImportacion] = useState(createImportState);

  const [reciboImpresion, setReciboImpresion] = useState(null);
  const reciboRef = useRef(null);
  const imprimiendoRef = useRef(false);

  const rolActual = normalizeRole(usuarioSistema?.rol);
  const permisos = useMemo(() => ({
    role: rolActual,
    roleLabel: ROLE_LABELS[rolActual] || ROLE_LABELS.CONSULTA,
    canCaja: hasMinRole(rolActual, "CAJERO"),
    canEmitirRecibo: hasMinRole(rolActual, "ADMIN_SEC"),
    canEditarPadron: hasMinRole(rolActual, "ADMIN_SEC"),
    canBorrarPadron: hasMinRole(rolActual, "ADMIN"),
    canImportarPadron: hasMinRole(rolActual, "ADMIN"),
    canConfigurar: hasMinRole(rolActual, "ADMIN_SEC")
  }), [rolActual]);

  const suministroSeleccionado = useMemo(
    () => suministros.find((s) => Number(s.id_suministro) === Number(selectedSuministroId)) || null,
    [suministros, selectedSuministroId]
  );

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

  const totalOrdenesPendientes = useMemo(
    () => ordenesPendientes.reduce((acc, item) => acc + parseMonto(item.total_orden), 0),
    [ordenesPendientes]
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
    setOrdenesPendientes([]);
  }, []);

  const handlePrintRecibo = useReactToPrint({
    contentRef: reciboRef,
    documentTitle: "Recibo_Luz",
    onAfterPrint: () => {
      imprimiendoRef.current = false;
      setReciboImpresion(null);
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

  const cargarOrdenesPendientes = useCallback(async () => {
    setLoadingOrdenes(true);
    try {
      const params = {};
      if (soloOrdenesDelSeleccionado && Number(selectedSuministroId) > 0) {
        params.id_suministro = Number(selectedSuministroId);
      }
      const res = await luzApi.get("/caja/ordenes-cobro/pendientes", { params });
      setOrdenesPendientes(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      handleApiError(err, "No se pudo cargar ordenes pendientes.");
    } finally {
      setLoadingOrdenes(false);
    }
  }, [handleApiError, selectedSuministroId, soloOrdenesDelSeleccionado]);

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

  const cargarReporte = useCallback(async () => {
    if (!permisos.canCaja) return;
    setLoadingReporte(true);
    try {
      const res = await luzApi.get("/caja/reporte", {
        params: { tipo: reporteTipo, fecha: reporteFecha }
      });
      setReporteCaja(res.data || null);
    } catch (err) {
      handleApiError(err, "No se pudo generar reporte de caja.");
    } finally {
      setLoadingReporte(false);
    }
  }, [handleApiError, permisos.canCaja, reporteFecha, reporteTipo]);

  useEffect(() => {
    if (!usuarioSistema) return;
    cargarZonas();
    cargarSuministros();
    cargarConfig();
    if (permisos.canCaja) {
      cargarOrdenesPendientes();
      cargarReporte();
    }
  }, [cargarConfig, cargarOrdenesPendientes, cargarReporte, cargarSuministros, cargarZonas, permisos.canCaja, usuarioSistema]);

  useEffect(() => {
    if (!selectedSuministroId || !usuarioSistema) {
      setHistorial([]);
      setPendientes([]);
      return;
    }
    cargarHistorial(selectedSuministroId);
    cargarPendientes(selectedSuministroId);
  }, [cargarHistorial, cargarPendientes, historialAnio, selectedSuministroId, usuarioSistema]);

  useEffect(() => {
    if (!soloOrdenesDelSeleccionado || !permisos.canCaja || !usuarioSistema) return;
    cargarOrdenesPendientes();
  }, [cargarOrdenesPendientes, permisos.canCaja, soloOrdenesDelSeleccionado, selectedSuministroId, usuarioSistema]);

  useEffect(() => {
    if (!selectedSuministroId) return;
    const exists = suministros.some((s) => Number(s.id_suministro) === Number(selectedSuministroId));
    if (!exists) setSelectedSuministroId(null);
  }, [selectedSuministroId, suministros]);

  const cargarFormularioDesdeSeleccionado = () => {
    if (!suministroSeleccionado) return;
    setSuministroForm({
      id_suministro: suministroSeleccionado.id_suministro,
      id_zona: String(suministroSeleccionado.id_zona || ""),
      zona_nombre: suministroSeleccionado.zona || "",
      nro_medidor: suministroSeleccionado.nro_medidor || "",
      nombre_usuario: suministroSeleccionado.nombre_usuario || "",
      direccion: suministroSeleccionado.direccion || "",
      estado: suministroSeleccionado.estado || "ACTIVO"
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
      showFlash("warning", "Debe completar zona, medidor y nombre.");
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
    const ok = window.confirm(`Eliminar suministro ${suministroSeleccionado.nro_medidor} de ${suministroSeleccionado.nombre_usuario}?`);
    if (!ok) return;
    try {
      const res = await luzApi.delete(`/suministros/${suministroSeleccionado.id_suministro}`);
      showFlash("success", res.data?.mensaje || "Suministro eliminado.");
      setSelectedSuministroId(null);
      setHistorial([]);
      setPendientes([]);
      await Promise.all([cargarSuministros(), cargarZonas(), cargarOrdenesPendientes()]);
    } catch (err) {
      handleApiError(err, "No se pudo eliminar suministro.");
    }
  };

  const emitirReciboManual = async (e) => {
    e.preventDefault();
    if (!permisos.canEmitirRecibo || !suministroSeleccionado) return;
    const payload = {
      id_suministro: Number(suministroSeleccionado.id_suministro),
      anio: Number.parseInt(reciboForm.anio, 10),
      mes: Number.parseInt(reciboForm.mes, 10),
      lectura_actual: parseMonto(reciboForm.lectura_actual),
      observacion: String(reciboForm.observacion || "").trim()
    };
    if (String(reciboForm.lectura_anterior || "").trim()) {
      payload.lectura_anterior = parseMonto(reciboForm.lectura_anterior);
    }
    if (String(reciboForm.fecha_emision || "").trim()) payload.fecha_emision = reciboForm.fecha_emision;
    if (String(reciboForm.fecha_vencimiento || "").trim()) payload.fecha_vencimiento = reciboForm.fecha_vencimiento;
    if (String(reciboForm.fecha_corte || "").trim()) payload.fecha_corte = reciboForm.fecha_corte;

    setEmitiendoRecibo(true);
    try {
      const res = await luzApi.post("/recibos", payload);
      showFlash("success", res.data?.mensaje || "Recibo generado.");
      const suministroRecibo = {
        ...suministroSeleccionado,
        ...(res.data?.suministro || {})
      };
      setReciboImpresion({
        recibo: res.data?.recibo || null,
        suministro: suministroRecibo
      });
      setReciboForm((prev) => ({ ...createReciboDefaults(), anio: prev.anio, mes: prev.mes }));
      await Promise.all([
        cargarSuministros(),
        cargarHistorial(suministroSeleccionado.id_suministro),
        cargarPendientes(suministroSeleccionado.id_suministro),
        cargarOrdenesPendientes()
      ]);
    } catch (err) {
      handleApiError(err, "No se pudo emitir recibo.");
    } finally {
      setEmitiendoRecibo(false);
    }
  };

  const imprimirDesdeHistorial = (row) => {
    if (!row || !suministroSeleccionado) return;
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

  const emitirOrdenCobro = async () => {
    if (!permisos.canEmitirRecibo) return;
    if (!suministroSeleccionado) {
      showFlash("warning", "Seleccione un suministro.");
      return;
    }
    try {
      const res = await luzApi.post("/caja/ordenes-cobro", {
        id_suministro: suministroSeleccionado.id_suministro,
        observacion: String(ordenObservacion || "").trim()
      });
      showFlash("success", res.data?.mensaje || "Orden emitida.");
      setOrdenObservacion("");
      await Promise.all([
        cargarOrdenesPendientes(),
        cargarPendientes(suministroSeleccionado.id_suministro),
        cargarSuministros()
      ]);
    } catch (err) {
      handleApiError(err, "No se pudo emitir orden de cobro.");
    }
  };

  const cobrarOrden = async (idOrden) => {
    if (!permisos.canCaja) return;
    const ok = window.confirm(`Cobrar orden ${idOrden}?`);
    if (!ok) return;
    setOrdenEnProceso(idOrden);
    try {
      const res = await luzApi.post(`/caja/ordenes-cobro/${idOrden}/cobrar`);
      showFlash("success", res.data?.mensaje || "Cobro registrado.");
      await Promise.all([
        cargarOrdenesPendientes(),
        cargarSuministros(),
        cargarReporte(),
        selectedSuministroId ? cargarHistorial(selectedSuministroId) : Promise.resolve(),
        selectedSuministroId ? cargarPendientes(selectedSuministroId) : Promise.resolve()
      ]);
    } catch (err) {
      handleApiError(err, "No se pudo cobrar orden.");
    } finally {
      setOrdenEnProceso(0);
    }
  };

  const anularOrden = async (idOrden) => {
    if (!permisos.canEmitirRecibo) return;
    const motivo = window.prompt("Motivo de anulacion (min 5 caracteres):", "");
    if (!motivo) return;
    setOrdenEnProceso(idOrden);
    try {
      const res = await luzApi.post(`/caja/ordenes-cobro/${idOrden}/anular`, { motivo });
      showFlash("success", res.data?.mensaje || "Orden anulada.");
      await cargarOrdenesPendientes();
    } catch (err) {
      handleApiError(err, "No se pudo anular orden.");
    } finally {
      setOrdenEnProceso(0);
    }
  };

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
            <button className={`nav-link ${tab === "caja" ? "active" : ""}`} onClick={() => setTab("caja")}>
              <FaCashRegister className="me-1" />
              Caja
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link ${tab === "config" ? "active" : ""}`} onClick={() => setTab("config")}>
              <FaCog className="me-1" />
              Config
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link ${tab === "importar" ? "active" : ""}`} onClick={() => setTab("importar")}>
              <FaFileImport className="me-1" />
              Importar
            </button>
          </li>
        </ul>

        <div className="card border-top-0 shadow-sm">
          <div className="card-body">
            {tab === "padron" && (
              <div className="row g-3">
                <div className="col-12 col-xl-8">
                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <div className="input-group" style={{ maxWidth: "280px" }}>
                      <span className="input-group-text"><FaSearch /></span>
                      <input
                        className="form-control"
                        placeholder="Buscar por nombre, medidor o zona"
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
                    <button className="btn btn-outline-primary d-flex align-items-center gap-2" onClick={cargarSuministros}>
                      <FaSyncAlt />
                      Recargar
                    </button>
                  </div>

                  <div className="table-responsive border rounded" style={{ maxHeight: "58vh" }}>
                    <table className="table table-hover table-sm align-middle mb-0">
                      <thead className="table-light sticky-top">
                        <tr>
                          <th>Zona</th>
                          <th>Medidor</th>
                          <th>Usuario</th>
                          <th>Estado</th>
                          <th className="text-end">Deuda</th>
                          <th className="text-center">Meses</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingPadron && (
                          <tr><td colSpan="6" className="text-center py-3">Cargando...</td></tr>
                        )}
                        {!loadingPadron && suministros.length === 0 && (
                          <tr><td colSpan="6" className="text-center py-3 text-muted">Sin registros</td></tr>
                        )}
                        {!loadingPadron && suministros.map((row) => (
                          <tr
                            key={row.id_suministro}
                            className={Number(selectedSuministroId) === Number(row.id_suministro) ? "table-primary" : ""}
                            style={{ cursor: "pointer" }}
                            onClick={() => setSelectedSuministroId(row.id_suministro)}
                          >
                            <td>{row.zona}</td>
                            <td>{row.nro_medidor}</td>
                            <td>
                              <div className="fw-semibold">{row.nombre_usuario}</div>
                              <div className="small text-muted">{row.direccion || "-"}</div>
                            </td>
                            <td>
                              <span className={`badge ${row.estado === "ACTIVO" ? "bg-success" : row.estado === "CORTADO" ? "bg-danger" : "bg-secondary"}`}>
                                {row.estado}
                              </span>
                            </td>
                            <td className="text-end">{formatMoney(row.deuda_total)}</td>
                            <td className="text-center">{Number(row.meses_deuda || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="col-12 col-xl-4">
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
                          <label className="form-label">Nro medidor</label>
                          <input
                            className="form-control"
                            value={suministroForm.nro_medidor}
                            onChange={(e) => setSuministroForm((prev) => ({ ...prev, nro_medidor: e.target.value }))}
                            required
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
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm d-flex align-items-center gap-2"
                            disabled={!permisos.canBorrarPadron || !suministroSeleccionado}
                            onClick={eliminarSuministro}
                          >
                            <FaTrashAlt />
                            Eliminar
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>

                  {suministroSeleccionado && (
                    <div className="card border mt-3">
                      <div className="card-body">
                        <div className="fw-semibold mb-1">{suministroSeleccionado.nombre_usuario}</div>
                        <div className="small text-muted">Medidor: {suministroSeleccionado.nro_medidor}</div>
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
                    <div className="card-header fw-semibold">Emision manual por lectura</div>
                    <div className="card-body">
                      {!suministroSeleccionado ? (
                        <div className="text-muted small">Seleccione un suministro en Padron para emitir recibo.</div>
                      ) : (
                        <>
                          <div className="small mb-3">
                            <div><strong>Usuario:</strong> {suministroSeleccionado.nombre_usuario}</div>
                            <div><strong>Zona:</strong> {suministroSeleccionado.zona}</div>
                            <div><strong>Medidor:</strong> {suministroSeleccionado.nro_medidor}</div>
                          </div>
                          <form onSubmit={emitirReciboManual}>
                            <div className="row g-2">
                              <div className="col-6">
                                <label className="form-label">Anio</label>
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
                                <label className="form-label">Lectura anterior (opcional)</label>
                                <input
                                  type="number"
                                  className="form-control"
                                  step="0.01"
                                  value={reciboForm.lectura_anterior}
                                  onChange={(e) => setReciboForm((prev) => ({ ...prev, lectura_anterior: e.target.value }))}
                                />
                              </div>
                              <div className="col-6">
                                <label className="form-label">Lectura actual</label>
                                <input
                                  type="number"
                                  className="form-control"
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
                                  onChange={(e) => setReciboForm((prev) => ({ ...prev, fecha_emision: e.target.value }))}
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
                              {emitiendoRecibo ? "Generando..." : "Generar recibo"}
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
                  <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
                    <button className="btn btn-outline-primary btn-sm d-flex align-items-center gap-2" onClick={() => cargarHistorial()}>
                      <FaSyncAlt />
                      Recargar historial
                    </button>
                    <select
                      className="form-select form-select-sm"
                      style={{ maxWidth: "160px" }}
                      value={historialAnio}
                      onChange={(e) => setHistorialAnio(e.target.value)}
                    >
                      <option value="all">Todos los anios</option>
                      {yearsHistorial.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
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
                              <div>E: {row.fecha_emision || "-"}</div>
                              <div>V: {row.fecha_vencimiento || "-"}</div>
                              <div>C: {row.fecha_corte || "-"}</div>
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
            {tab === "caja" && (
              <div className="row g-3">
                <div className="col-12 col-xl-4">
                  <div className="card border">
                    <div className="card-header fw-semibold">Emitir orden de cobro</div>
                    <div className="card-body">
                      {!suministroSeleccionado ? (
                        <div className="text-muted small">Seleccione un suministro en Padron.</div>
                      ) : (
                        <>
                          <div className="small mb-2"><strong>Usuario:</strong> {suministroSeleccionado.nombre_usuario}</div>
                          <div className="small mb-2"><strong>Medidor:</strong> {suministroSeleccionado.nro_medidor}</div>
                          <div className="small mb-2"><strong>Pendiente:</strong> {formatMoney(totalPendienteSeleccionado)}</div>
                          <label className="form-label mt-2">Observacion</label>
                          <textarea
                            rows="2"
                            className="form-control"
                            value={ordenObservacion}
                            onChange={(e) => setOrdenObservacion(e.target.value)}
                          />
                          <button
                            className="btn btn-primary mt-3"
                            onClick={emitirOrdenCobro}
                            disabled={!permisos.canEmitirRecibo || totalPendienteSeleccionado <= 0}
                          >
                            Emitir orden con todos los pendientes
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="card border mt-3">
                    <div className="card-header fw-semibold d-flex justify-content-between align-items-center">
                      <span>Reporte caja</span>
                      <button className="btn btn-outline-primary btn-sm" onClick={cargarReporte} disabled={!permisos.canCaja || loadingReporte}>
                        <FaSyncAlt />
                      </button>
                    </div>
                    <div className="card-body">
                      <div className="row g-2 mb-3">
                        <div className="col-6">
                          <label className="form-label">Tipo</label>
                          <select className="form-select" value={reporteTipo} onChange={(e) => setReporteTipo(e.target.value)}>
                            <option value="diario">Diario</option>
                            <option value="mensual">Mensual</option>
                            <option value="anual">Anual</option>
                          </select>
                        </div>
                        <div className="col-6">
                          <label className="form-label">Fecha</label>
                          <input
                            type="date"
                            className="form-control"
                            value={reporteFecha}
                            onChange={(e) => setReporteFecha(e.target.value)}
                          />
                        </div>
                      </div>
                      <button className="btn btn-outline-primary btn-sm" disabled={!permisos.canCaja || loadingReporte} onClick={cargarReporte}>
                        <FaCalendarAlt className="me-1" />
                        Consultar
                      </button>
                      {reporteCaja && (
                        <div className="mt-3 small">
                          <div><strong>Rango:</strong> {reporteCaja?.rango?.desde || "-"} a {reporteCaja?.rango?.hasta_exclusivo || "-"}</div>
                          <div><strong>Movimientos:</strong> {reporteCaja?.cantidad_movimientos || 0}</div>
                          <div><strong>Total:</strong> {formatMoney(reporteCaja?.total)}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="col-12 col-xl-8">
                  <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
                    <button className="btn btn-outline-primary btn-sm d-flex align-items-center gap-2" onClick={cargarOrdenesPendientes}>
                      <FaSyncAlt />
                      Recargar ordenes
                    </button>
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="soloSeleccionado"
                        checked={soloOrdenesDelSeleccionado}
                        onChange={(e) => setSoloOrdenesDelSeleccionado(e.target.checked)}
                      />
                      <label className="form-check-label" htmlFor="soloSeleccionado">
                        Solo suministro seleccionado
                      </label>
                    </div>
                    <div className="ms-auto fw-semibold">
                      Total pendiente en caja: {formatMoney(totalOrdenesPendientes)}
                    </div>
                  </div>
                  <div className="table-responsive border rounded" style={{ maxHeight: "48vh" }}>
                    <table className="table table-sm table-hover align-middle mb-0">
                      <thead className="table-light sticky-top">
                        <tr>
                          <th>Orden</th>
                          <th>Fecha</th>
                          <th>Suministro</th>
                          <th className="text-end">Total</th>
                          <th className="text-center">Items</th>
                          <th className="text-center">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingOrdenes && <tr><td colSpan="6" className="text-center py-3">Cargando...</td></tr>}
                        {!loadingOrdenes && ordenesPendientes.length === 0 && (
                          <tr><td colSpan="6" className="text-center py-3 text-muted">Sin ordenes pendientes</td></tr>
                        )}
                        {!loadingOrdenes && ordenesPendientes.map((ord) => (
                          <tr key={ord.id_orden}>
                            <td>#{ord.id_orden}</td>
                            <td>{formatFechaHora(ord.creado_en)}</td>
                            <td>
                              <div className="fw-semibold">{ord.suministro?.nombre_usuario}</div>
                              <div className="small text-muted">{ord.suministro?.zona} | {ord.suministro?.nro_medidor}</div>
                            </td>
                            <td className="text-end">{formatMoney(ord.total_orden)}</td>
                            <td className="text-center">{Array.isArray(ord.items) ? ord.items.length : 0}</td>
                            <td className="text-center">
                              <div className="btn-group btn-group-sm">
                                <button
                                  className="btn btn-success"
                                  disabled={!permisos.canCaja || ordenEnProceso === ord.id_orden}
                                  onClick={() => cobrarOrden(ord.id_orden)}
                                >
                                  Cobrar
                                </button>
                                <button
                                  className="btn btn-outline-danger"
                                  disabled={!permisos.canEmitirRecibo || ordenEnProceso === ord.id_orden}
                                  onClick={() => anularOrden(ord.id_orden)}
                                >
                                  Anular
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {reporteCaja && (
                    <div className="table-responsive border rounded mt-3" style={{ maxHeight: "28vh" }}>
                      <table className="table table-sm mb-0">
                        <thead className="table-light sticky-top">
                          <tr>
                            <th>Fecha</th>
                            <th>Orden</th>
                            <th>Periodo</th>
                            <th>Usuario</th>
                            <th>Medidor</th>
                            <th className="text-end">Monto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(reporteCaja.movimientos || []).length === 0 && (
                            <tr><td colSpan="6" className="text-center py-2 text-muted">Sin movimientos para el rango.</td></tr>
                          )}
                          {(reporteCaja.movimientos || []).map((mov) => (
                            <tr key={mov.id_pago}>
                              <td>{mov.fecha} {mov.hora}</td>
                              <td>{mov.id_orden_cobro ? `#${mov.id_orden_cobro}` : "-"}</td>
                              <td>{formatPeriodo(mov.anio, mov.mes)}</td>
                              <td>{mov.nombre_usuario}</td>
                              <td>{mov.nro_medidor}</td>
                              <td className="text-end">{formatMoney(mov.monto_pagado)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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
                        Plantilla: zona, nro_medidor, anio, mes, lectura_actual, observacion(opcional).
                      </div>
                      <input
                        type="file"
                        className="form-control"
                        accept=".xlsx,.xls,.csv"
                        onChange={(e) => setImportacion((prev) => ({ ...prev, archivoLecturas: e.target.files?.[0] || null }))}
                      />
                      <button
                        className="btn btn-primary mt-3"
                        disabled={!permisos.canEmitirRecibo || importacion.subiendo === "lecturas"}
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
                                <th>Medidor</th>
                                <th>Anio/Mes</th>
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
          </div>
        </div>
      </div>

      <div style={{ position: "fixed", left: "-10000px", top: 0, width: "148mm", background: "#fff" }}>
        <ReciboLuz ref={reciboRef} datos={reciboImpresion} />
      </div>
    </div>
  );
}

export default LuzApp;
