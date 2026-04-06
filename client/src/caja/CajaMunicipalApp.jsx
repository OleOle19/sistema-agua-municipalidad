import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { FaBolt, FaCashRegister, FaPrint, FaSignOutAlt, FaSyncAlt, FaTint } from "react-icons/fa";
import api from "../api";
import LoginPage from "../components/LoginPage";
import ReciboAnexoCaja from "../components/ReciboAnexoCaja";
import cajaLuzApi from "./apiCajaLuz";

const AGUA_TOKEN_KEY = "token_agua";

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

const ANEXO_PAGE_STYLE = `
  @page {
    size: A4 landscape;
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

const parseMonto = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeCodigoMunicipal = (value) => String(value || "").trim().toUpperCase();

const formatMoney = (value) => `S/. ${parseMonto(value).toFixed(2)}`;

const formatFechaHora = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString("es-PE");
};

const round2 = (value) => Math.round((parseMonto(value) + Number.EPSILON) * 100) / 100;

const pickFirstText = (...values) => {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
};

const buildAnexoDataFromOrden = (orden) => {
  const items = Array.isArray(orden?.items) ? orden.items : [];
  const resumenServicios = items.reduce((acc, it) => ({
    agua: round2(acc.agua + parseMonto(it?.subtotal_agua)),
    desague: round2(acc.desague + parseMonto(it?.subtotal_desague)),
    limpieza: round2(acc.limpieza + parseMonto(it?.subtotal_limpieza)),
    admin: round2(acc.admin + parseMonto(it?.subtotal_admin))
  }), {
    agua: 0,
    desague: 0,
    limpieza: 0,
    admin: 0
  });

  const detalles = [
    { concepto: "SERVICIO DE AGUA", importe: resumenServicios.agua },
    { concepto: "SERVICIO DE DESAGUE", importe: resumenServicios.desague },
    { concepto: "LIMPIEZA PUBLICA", importe: resumenServicios.limpieza },
    { concepto: "SERVICIO ADMIN", importe: resumenServicios.admin }
  ].filter((row) => row.importe > 0);

  const totalOrden = round2(parseMonto(orden?.total_orden));
  if (detalles.length === 0 && totalOrden > 0) {
    detalles.push({ concepto: "SERVICIOS", importe: totalOrden });
  } else if (detalles.length > 0) {
    const totalDetalle = round2(detalles.reduce((acc, row) => acc + parseMonto(row.importe), 0));
    const diferencia = round2(totalOrden - totalDetalle);
    if (Math.abs(diferencia) >= 0.01) {
      const lastIdx = detalles.length - 1;
      detalles[lastIdx] = {
        ...detalles[lastIdx],
        importe: round2(parseMonto(detalles[lastIdx].importe) + diferencia)
      };
    }
  }

  const contribuyente = orden?.contribuyente || {};
  return {
    entidad: "MUNICIPALIDAD DISTRITAL DE PUEBLO NUEVO",
    entidad_detalle: "ARCO 301  RUC. 20192401004",
    contribuyente: {
      codigo_municipal: pickFirstText(contribuyente.codigo_municipal, orden?.codigo_municipal),
      nombre_completo: pickFirstText(contribuyente.nombre_completo, orden?.nombre_contribuyente, orden?.nombre_completo),
      calle: pickFirstText(contribuyente.direccion, orden?.direccion_contribuyente),
      ruc: pickFirstText(contribuyente.dni_ruc, orden?.dni_ruc)
    },
    total: totalOrden,
    detalles
  };
};

const getNombreContribuyenteOrden = (orden) => (
  pickFirstText(
    orden?.contribuyente?.nombre_completo,
    orden?.nombre_contribuyente,
    orden?.nombre_completo
  ) || "-"
);

function CajaMunicipalApp({ onBackToSelector }) {
  const [usuarioSistema, setUsuarioSistema] = useState(readStoredAguaUser);
  const [tab, setTab] = useState("agua");
  const [flash, setFlash] = useState(null);

  const [ordenesAgua, setOrdenesAgua] = useState([]);
  const [loadingAgua, setLoadingAgua] = useState(false);
  const [procesoAgua, setProcesoAgua] = useState(0);
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
  const [indiceContribuyentes, setIndiceContribuyentes] = useState({ byId: new Map(), byCodigo: new Map() });
  const cajaCerradaAguaHoy = Boolean(resumenConteoAgua?.caja_cerrada_hoy);

  const [ordenesLuz, setOrdenesLuz] = useState([]);
  const [loadingLuz, setLoadingLuz] = useState(false);
  const [procesoLuz, setProcesoLuz] = useState(0);
  const [reporteLuz, setReporteLuz] = useState(null);
  const [loadingReporteLuz, setLoadingReporteLuz] = useState(false);

  const [datosAnexoCajaImprimir, setDatosAnexoCajaImprimir] = useState(null);
  const anexoCajaRef = useRef(null);
  const isPrintingAnexoCajaRef = useRef(false);

  const rolActual = normalizeRole(usuarioSistema?.rol);
  const accesoCajaPermitido = canEnterCajaModuleByRole(rolActual);
  const permisos = useMemo(() => ({
    role: rolActual,
    roleLabel: ROLE_LABELS[rolActual] || ROLE_LABELS.CONSULTA,
    canCaja: accesoCajaPermitido,
    canAnular: accesoCajaPermitido && hasMinRole(rolActual, "ADMIN_SEC")
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
    setOrdenesAgua([]);
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
    setIndiceContribuyentes({ byId: new Map(), byCodigo: new Map() });
  }, []);

  const cargarOrdenesAgua = useCallback(async () => {
    if (!permisos.canCaja) return;
    setLoadingAgua(true);
    try {
      const res = await api.get("/caja/ordenes-cobro/pendientes");
      setOrdenesAgua(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      handleApiError(err, "No se pudo cargar ordenes de agua.");
    } finally {
      setLoadingAgua(false);
    }
  }, [handleApiError, permisos.canCaja]);

  const cargarIndiceContribuyentesAgua = useCallback(async () => {
    try {
      const res = await api.get("/contribuyentes");
      const rows = Array.isArray(res.data) ? res.data : [];
      const byId = new Map();
      const byCodigo = new Map();
      rows.forEach((row) => {
        const id = Number(row?.id_contribuyente || 0);
        const nombre = pickFirstText(row?.nombre_completo, row?.sec_nombre);
        const codigo = normalizeCodigoMunicipal(row?.codigo_municipal);
        if (id > 0 && nombre) byId.set(id, nombre);
        if (codigo && nombre && !byCodigo.has(codigo)) byCodigo.set(codigo, nombre);
      });
      setIndiceContribuyentes({ byId, byCodigo });
    } catch {
      setIndiceContribuyentes({ byId: new Map(), byCodigo: new Map() });
    }
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
    await Promise.all([cargarOrdenesAgua(), cargarReporteAgua(), cargarConteoAgua()]);
  }, [cargarOrdenesAgua, cargarReporteAgua, cargarConteoAgua]);

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
    if (!usuarioSistema || !permisos.canCaja) return;
    cargarIndiceContribuyentesAgua();
  }, [cargarIndiceContribuyentesAgua, permisos.canCaja, usuarioSistema]);

  useEffect(() => {
    if (!usuarioSistema || !permisos.canCaja || tab !== "agua") return undefined;
    const timer = setInterval(() => {
      cargarConteoAgua();
    }, 10000);
    return () => clearInterval(timer);
  }, [cargarConteoAgua, permisos.canCaja, tab, usuarioSistema]);

  const resolverNombreContribuyenteAgua = useCallback((orden) => {
    const nombreDirecto = getNombreContribuyenteOrden(orden);
    if (nombreDirecto !== "-") return nombreDirecto;
    const idContribuyente = Number(
      orden?.contribuyente?.id_contribuyente
      || orden?.id_contribuyente
      || 0
    );
    if (idContribuyente > 0 && indiceContribuyentes.byId.has(idContribuyente)) {
      return String(indiceContribuyentes.byId.get(idContribuyente));
    }
    const codigo = normalizeCodigoMunicipal(orden?.contribuyente?.codigo_municipal || orden?.codigo_municipal);
    if (codigo && indiceContribuyentes.byCodigo.has(codigo)) {
      return String(indiceContribuyentes.byCodigo.get(codigo));
    }
    return "-";
  }, [indiceContribuyentes]);

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

  const cobrarAgua = async (idOrden) => {
    if (!permisos.canCaja) return;
    if (cajaCerradaAguaHoy) {
      showFlash("warning", "Caja cerrada para hoy. No se permiten más cobros.");
      return;
    }
    if (!window.confirm(`Cobrar orden de agua #${idOrden}?`)) return;
    setProcesoAgua(idOrden);
    try {
      const res = await api.post(`/caja/ordenes-cobro/${idOrden}/cobrar`);
      showFlash("success", res.data?.mensaje || "Cobro registrado.");
      await recargarAgua();
    } catch (err) {
      handleApiError(err, "No se pudo cobrar orden de agua.");
    } finally {
      setProcesoAgua(0);
    }
  };

  const anularAgua = async (idOrden) => {
    if (!permisos.canAnular) return;
    const motivo = window.prompt("Motivo de anulacion (min 5 caracteres):", "");
    if (!motivo) return;
    setProcesoAgua(idOrden);
    try {
      const res = await api.post(`/caja/ordenes-cobro/${idOrden}/anular`, { motivo });
      showFlash("success", res.data?.mensaje || "Orden anulada.");
      await recargarAgua();
    } catch (err) {
      handleApiError(err, "No se pudo anular orden de agua.");
    } finally {
      setProcesoAgua(0);
    }
  };

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

  const anularLuz = async (idOrden) => {
    if (!permisos.canAnular) return;
    const motivo = window.prompt("Motivo de anulacion (min 5 caracteres):", "");
    if (!motivo) return;
    setProcesoLuz(idOrden);
    try {
      const res = await cajaLuzApi.post(`/caja/ordenes-cobro/${idOrden}/anular`, { motivo });
      showFlash("success", res.data?.mensaje || "Orden anulada.");
      await recargarLuz();
    } catch (err) {
      handleApiError(err, "No se pudo anular orden de luz.");
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
      setDatosAnexoCajaImprimir(null);
    }
  });

  useEffect(() => {
    if (!datosAnexoCajaImprimir) return;
    if (isPrintingAnexoCajaRef.current) return;
    isPrintingAnexoCajaRef.current = true;
    const raf = requestAnimationFrame(() => {
      if (anexoCajaRef.current) {
        handlePrintAnexoCaja();
      } else {
        isPrintingAnexoCajaRef.current = false;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [datosAnexoCajaImprimir, handlePrintAnexoCaja]);

  const totalPendienteAgua = useMemo(
    () => ordenesAgua.reduce((acc, item) => acc + parseMonto(item.total_orden), 0),
    [ordenesAgua]
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
      label: "PENDIENTE EN CAJA",
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
                    className="btn btn-outline-success d-flex align-items-center gap-2"
                    onClick={registrarConteoEfectivoAgua}
                    disabled={enviandoConteoAgua || cajaCerradaAguaHoy}
                    title={cajaCerradaAguaHoy ? "Caja cerrada para hoy" : "Enviar conteo de efectivo y cerrar caja de hoy"}
                  >
                    {enviandoConteoAgua ? "Enviando conteo..." : (cajaCerradaAguaHoy ? "Caja cerrada hoy" : "Conteo efectivo")}
                  </button>
                  <button className="btn btn-outline-primary d-flex align-items-center gap-2" onClick={recargarAgua} disabled={loadingAgua || loadingReporteAgua || loadingConteoAgua}>
                    <FaSyncAlt />
                    {(loadingAgua || loadingReporteAgua || loadingConteoAgua) ? "Actualizando..." : "Recargar agua"}
                  </button>
                </>
              ) : (
                <button className="btn btn-outline-primary d-flex align-items-center gap-2" onClick={recargarLuz} disabled={loadingLuz || loadingReporteLuz}>
                  <FaSyncAlt />
                  {(loadingLuz || loadingReporteLuz) ? "Actualizando..." : "Recargar luz"}
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

                <div className="table-responsive border rounded" style={{ maxHeight: "58vh" }}>
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead className="table-light sticky-top">
                      <tr>
                        <th>Orden</th>
                        <th>Fecha</th>
                        <th>Codigo</th>
                        <th>Contribuyente</th>
                        <th>Recibo ref.</th>
                        <th className="text-end">Total</th>
                        <th className="text-center">Items</th>
                        <th className="text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingAgua && ordenesAgua.length === 0 && <tr><td colSpan="8" className="text-center py-3">Cargando...</td></tr>}
                      {!loadingAgua && ordenesAgua.length === 0 && (
                        <tr><td colSpan="8" className="text-center py-3 text-muted">Sin ordenes pendientes.</td></tr>
                      )}
                      {ordenesAgua.map((ord) => (
                        <tr key={ord.id_orden}>
                          <td>#{ord.id_orden}</td>
                          <td>{formatFechaHora(ord.creado_en)}</td>
                          <td>{ord.codigo_municipal || `ID ${ord.id_contribuyente}`}</td>
                          <td>{resolverNombreContribuyenteAgua(ord)}</td>
                          <td>{ord.codigo_recibo || "-"}</td>
                          <td className="text-end">{formatMoney(ord.total_orden)}</td>
                          <td className="text-center">{Array.isArray(ord.items) ? ord.items.length : 0}</td>
                          <td className="text-center">
                            <div className="btn-group btn-group-sm">
                              <button
                                className="btn btn-outline-secondary d-flex align-items-center gap-1"
                                disabled={procesoAgua === ord.id_orden}
                                onClick={() => setDatosAnexoCajaImprimir(buildAnexoDataFromOrden(ord))}
                                title="Imprimir anexo"
                              >
                                <FaPrint />
                                Anexo
                              </button>
                              <button className="btn btn-success" disabled={!permisos.canCaja || procesoAgua === ord.id_orden || cajaCerradaAguaHoy} onClick={() => cobrarAgua(ord.id_orden)}>
                                Cobrar
                              </button>
                              <button className="btn btn-outline-danger" disabled={!permisos.canAnular || procesoAgua === ord.id_orden} onClick={() => anularAgua(ord.id_orden)}>
                                Anular
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
                              <button className="btn btn-outline-danger" disabled={!permisos.canAnular || procesoLuz === ord.id_orden} onClick={() => anularLuz(ord.id_orden)}>
                                Anular
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

      <div style={{ position: "fixed", left: "-9999px", top: 0 }}>
        <ReciboAnexoCaja ref={anexoCajaRef} datos={datosAnexoCajaImprimir} />
      </div>
    </div>
  );
}

export default CajaMunicipalApp;
