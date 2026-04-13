import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useReactToPrint } from "react-to-print";
import { FaPrint, FaMoneyBillWave } from "react-icons/fa";
import api from "../api";

const MOVIMIENTOS_PAGE_SIZE = 120;
const EMPTY_REPORTE = {
  total: "0.00",
  total_general: "0.00",
  cantidad_movimientos: 0,
  paginacion: { pagina: 1, page_size: MOVIMIENTOS_PAGE_SIZE, total_paginas: 1 },
  movimientos: []
};

const ROLE_ORDER = { BRIGADA: 1, CONSULTA: 2, CAJERO: 3, ADMIN_SEC: 4, ADMIN: 5 };
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

const formatMoney = (value) => {
  const num = Number.parseFloat(value);
  return Number.isFinite(num)
    ? num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
};

const formatFechaHoraLocal = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("es-PE");
};

const formatFechaLocal = (value) => {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("es-PE");
};

const formatFechaCorta = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split("-");
    return `${d}/${m}/${y}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  const d = String(parsed.getDate()).padStart(2, "0");
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const y = parsed.getFullYear();
  return `${d}/${m}/${y}`;
};

const formatMontoReporte = (value) => {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
};

const todayIso = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addIsoDays = (isoDateRaw, deltaDays) => {
  const iso = String(isoDateRaw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + Number(deltaDays || 0));
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const toMonthValue = (isoDate) => String(isoDate || "").slice(0, 7);
const toYearValue = (isoDate) => String(isoDate || "").slice(0, 4);

const ModalCierre = ({ cerrarModal, darkMode, origen = "ventanilla", usuarioSistema = null }) => {
  const [reporteTipo, setReporteTipo] = useState("diario");
  const [fechaConsulta, setFechaConsulta] = useState(todayIso());
  const [fechaDesdeRango, setFechaDesdeRango] = useState(todayIso());
  const [fechaHastaRango, setFechaHastaRango] = useState(todayIso());
  const [cargando, setCargando] = useState(false);
  const [exportandoExcel, setExportandoExcel] = useState(false);
  const [paginaMovimientos, setPaginaMovimientos] = useState(1);
  const [reporte, setReporte] = useState(EMPTY_REPORTE);
  const [cargandoAlertas, setCargandoAlertas] = useState(false);
  const [cargandoAdmin, setCargandoAdmin] = useState(false);
  const [movimientosAdmin, setMovimientosAdmin] = useState([]);
  const [alertasRiesgo, setAlertasRiesgo] = useState({
    severidad: "NORMAL",
    resumen: {
      total_alertas: 0,
      anulaciones_frecuentes: 0,
      reemisiones_recibo: 0,
      cobros_fuera_horario: 0,
      cierres_desviacion: 0
    },
    alertas: {
      anulaciones_frecuentes: [],
      reemisiones_recibo: [],
      cobros_fuera_horario: [],
      cierres_desviacion: []
    }
  });

  const componentRef = useRef();
  const adminRangeRef = useRef({ desde: "", hasta: "" });
  const printPageStyle = `
    @media print {
      .no-print {
        display: none !important;
      }
    }
  `;
  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `Reporte_Ventanilla_Caja_${reporteTipo}_${fechaConsulta}`,
    pageStyle: printPageStyle
  });

  const esCaja = origen === "caja";
  const esAdminPrincipal = esCaja && hasMinRole(usuarioSistema?.rol, "ADMIN");

  const cargarCaja = useCallback(async (signal) => {
    try {
      setCargando(true);
      const res = await api.get("/caja/reporte", {
        params: {
          tipo: reporteTipo,
          fecha: fechaConsulta,
          ...(reporteTipo === "rango" ? {
            fecha_desde: fechaDesdeRango,
            fecha_hasta: fechaHastaRango
          } : {}),
          page: paginaMovimientos,
          page_size: MOVIMIENTOS_PAGE_SIZE
        },
        signal
      });
      setReporte(res.data || EMPTY_REPORTE);
    } catch (error) {
      if (error?.code === "ERR_CANCELED" || error?.name === "CanceledError") return;
      console.error(error);
      setReporte(EMPTY_REPORTE);
    } finally {
      if (!signal?.aborted) setCargando(false);
    }
  }, [fechaConsulta, fechaDesdeRango, fechaHastaRango, paginaMovimientos, reporteTipo]);

  const cargarAlertasRiesgo = useCallback(async (signal) => {
    try {
      setCargandoAlertas(true);
      const res = await api.get("/caja/alertas-riesgo", {
        params: { window_hours: 24 },
        signal
      });
      setAlertasRiesgo(res?.data || {
        severidad: "NORMAL",
        resumen: {
          total_alertas: 0,
          anulaciones_frecuentes: 0,
          reemisiones_recibo: 0,
          cobros_fuera_horario: 0,
          cierres_desviacion: 0
        },
        alertas: {
          anulaciones_frecuentes: [],
          reemisiones_recibo: [],
          cobros_fuera_horario: [],
          cierres_desviacion: []
        }
      });
    } catch (error) {
      if (error?.code === "ERR_CANCELED" || error?.name === "CanceledError") return;
      console.error(error);
    } finally {
      if (!signal?.aborted) setCargandoAlertas(false);
    }
  }, []);

  const cargarMovimientosAdmin = useCallback(async (fechaDesde, fechaHasta, signal) => {
    if (!esAdminPrincipal) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaDesde || ""))) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaHasta || ""))) return;
    try {
      setCargandoAdmin(true);
      const res = await api.get("/admin/pagos-anulados", {
        params: {
          fecha_desde: fechaDesde,
          fecha_hasta: fechaHasta,
          limit: 1000
        },
        signal
      });
      const rows = Array.isArray(res?.data?.movimientos) ? res.data.movimientos : [];
      setMovimientosAdmin(rows);
    } catch (error) {
      if (error?.code === "ERR_CANCELED" || error?.name === "CanceledError") return;
      console.error(error);
      setMovimientosAdmin([]);
    } finally {
      if (!signal?.aborted) setCargandoAdmin(false);
    }
  }, [esAdminPrincipal]);

  const exportarExcel = async () => {
    try {
      setExportandoExcel(true);
      const res = await api.get("/caja/reporte/excel", {
        params: {
          tipo: reporteTipo,
          fecha: fechaConsulta,
          ...(reporteTipo === "rango" ? {
            fecha_desde: fechaDesdeRango,
            fecha_hasta: fechaHastaRango
          } : {})
        },
        responseType: "blob",
        timeout: 0
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reporte_ventanilla_caja_${reporteTipo}_${fechaConsulta}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert("No se pudo exportar el reporte en Excel.");
    } finally {
      setExportandoExcel(false);
    }
  };

  useEffect(() => {
    setPaginaMovimientos(1);
  }, [reporteTipo, fechaConsulta, fechaDesdeRango, fechaHastaRango]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      cargarCaja(controller.signal);
    }, 120);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [cargarCaja]);

  useEffect(() => {
    const controller = new AbortController();
    cargarAlertasRiesgo(controller.signal);
    return () => controller.abort();
  }, [cargarAlertasRiesgo]);

  useEffect(() => {
    if (!esAdminPrincipal) {
      adminRangeRef.current = { desde: "", hasta: "" };
      setMovimientosAdmin([]);
      return;
    }
    const desde = String(reporte?.rango?.desde || "");
    const hastaExclusivo = String(reporte?.rango?.hasta_exclusivo || "");
    const hasta = addIsoDays(hastaExclusivo, -1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return;
    adminRangeRef.current = { desde, hasta };
    const controller = new AbortController();
    cargarMovimientosAdmin(desde, hasta, controller.signal);
    return () => controller.abort();
  }, [cargarMovimientosAdmin, esAdminPrincipal, reporte?.rango?.desde, reporte?.rango?.hasta_exclusivo]);

  const movimientos = Array.isArray(reporte.movimientos) ? reporte.movimientos : [];
  const totalPaginas = Math.max(1, Number(reporte?.paginacion?.total_paginas || 1));
  const paginaActual = Math.max(1, Number(reporte?.paginacion?.pagina || paginaMovimientos));
  const pageSizeActual = Math.max(1, Number(reporte?.paginacion?.page_size || MOVIMIENTOS_PAGE_SIZE));
  const inicioIndice = (paginaActual - 1) * pageSizeActual;
  const totalGeneral = formatMoney(reporte.total_general || reporte.total || 0);
  const alertasResumen = alertasRiesgo?.resumen || {};
  const alertasDetalle = alertasRiesgo?.alertas || {};
  const totalAnuladoAdmin = formatMoney(
    movimientosAdmin.reduce((acc, row) => acc + Number(row?.monto_pagado || 0), 0)
  );
  const periodoLabel = reporteTipo === "semanal"
    ? "Semanal"
    : reporteTipo === "mensual"
      ? "Mensual"
      : reporteTipo === "anual"
        ? "Anual"
        : reporteTipo === "rango"
          ? "Intervalo"
        : "Diario";
  const graficosCaja = reporte?.graficos || {};
  const recaudacionTemporal = Array.isArray(graficosCaja.recaudacion_temporal) ? graficosCaja.recaudacion_temporal : [];
  const topContribuyentes = Array.isArray(graficosCaja.top_contribuyentes) ? graficosCaja.top_contribuyentes : [];
  const recaudacionPeriodoRaw = Array.isArray(graficosCaja.recaudacion_por_periodo) ? graficosCaja.recaudacion_por_periodo : [];
  const recaudacionPeriodo = useMemo(() => {
    if (reporteTipo !== "anual") return recaudacionPeriodoRaw;
    const year = toYearValue(fechaConsulta);
    if (!/^\d{4}$/.test(year)) return recaudacionPeriodoRaw;
    return recaudacionPeriodoRaw.filter((row) => {
      const periodo = String(row?.periodo || "").trim();
      return periodo.endsWith(`/${year}`);
    });
  }, [recaudacionPeriodoRaw, reporteTipo, fechaConsulta]);
  const maxTemporal = Math.max(1, ...recaudacionTemporal.map((r) => Number(r?.total || 0)));
  const maxTop = Math.max(1, ...topContribuyentes.map((r) => Number(r?.total || 0)));
  const maxPeriodo = Math.max(1, ...recaudacionPeriodo.map((r) => Number(r?.total || 0)));
  const movimientosReporte = useMemo(() => {
    const rows = [...movimientos];
    rows.sort((a, b) => {
      const fa = String(a?.fecha || "");
      const fb = String(b?.fecha || "");
      if (fa !== fb) return fa.localeCompare(fb);
      const na = String(a?.nombre_completo || "");
      const nb = String(b?.nombre_completo || "");
      if (na !== nb) return na.localeCompare(nb, "es");
      return Number(a?.id_pago || 0) - Number(b?.id_pago || 0);
    });
    return rows;
  }, [movimientos]);
  const gruposReporte = useMemo(() => {
    const byFecha = new Map();
    movimientosReporte.forEach((row) => {
      const fecha = String(row?.fecha || "").trim() || "SIN_FECHA";
      if (!byFecha.has(fecha)) byFecha.set(fecha, new Map());
      const contribuyentes = byFecha.get(fecha);
      const key = `${row?.id_contribuyente || 0}|${row?.codigo_municipal || ""}|${row?.nombre_completo || ""}`;
      if (!contribuyentes.has(key)) {
        contribuyentes.set(key, {
          codigo_municipal: row?.codigo_municipal || "",
          nombre_completo: row?.nombre_completo || "-",
          items: []
        });
      }
      contribuyentes.get(key).items.push(row);
    });
    return Array.from(byFecha.entries()).map(([fecha, contribuyentes]) => ({
      fecha,
      contribuyentes: Array.from(contribuyentes.values())
    }));
  }, [movimientosReporte]);
  const totalAguaReporte = useMemo(
    () => movimientosReporte.reduce((acc, row) => acc + Number(row?.monto_agua || 0), 0),
    [movimientosReporte]
  );
  const totalDesagueReporte = useMemo(
    () => movimientosReporte.reduce((acc, row) => acc + Number(row?.monto_desague || 0), 0),
    [movimientosReporte]
  );
  const totalLimpiezaReporte = useMemo(
    () => movimientosReporte.reduce((acc, row) => acc + Number(row?.monto_limpieza || 0), 0),
    [movimientosReporte]
  );
  const totalGastosReporte = useMemo(
    () => movimientosReporte.reduce((acc, row) => acc + Number(row?.monto_gastos || 0), 0),
    [movimientosReporte]
  );
  const totalAbonoReporte = useMemo(
    () => movimientosReporte.reduce((acc, row) => acc + Number(row?.monto_pagado || 0), 0),
    [movimientosReporte]
  );
  const fechaDesdeImpresion = formatFechaCorta(reporte?.rango?.desde || "");
  const fechaHastaImpresion = formatFechaCorta(addIsoDays(reporte?.rango?.hasta_exclusivo || "", -1));

  const yearActual = Number(todayIso().slice(0, 4));
  const yearsDisponibles = useMemo(() => {
    const years = [];
    for (let year = yearActual; year >= yearActual - 15; year -= 1) years.push(String(year));
    const yearSeleccionado = toYearValue(fechaConsulta);
    if (yearSeleccionado && !years.includes(yearSeleccionado)) {
      years.unshift(yearSeleccionado);
    }
    return years;
  }, [fechaConsulta, yearActual]);

  const onChangePeriodo = useCallback((nextTipo) => {
    const actual = fechaConsulta || todayIso();
    const year = toYearValue(actual) || String(yearActual);
    const month = String(actual).slice(5, 7) || "01";
    const day = String(actual).slice(8, 10) || "01";
    if (nextTipo === "mensual") {
      setFechaConsulta(`${year}-${month}-01`);
    } else if (nextTipo === "anual") {
      setFechaConsulta(`${year}-01-01`);
    } else if (nextTipo === "rango") {
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(actual) ? actual : todayIso();
      setFechaConsulta(iso);
      setFechaDesdeRango(iso);
      setFechaHastaRango(iso);
    } else {
      setFechaConsulta(`${year}-${month}-${day}`);
    }
    setReporteTipo(nextTipo);
  }, [fechaConsulta, yearActual]);

  const onChangeFechaReferencia = useCallback((rawValue) => {
    const value = String(rawValue || "");
    if (reporteTipo === "mensual") {
      if (!/^\d{4}-\d{2}$/.test(value)) return;
      setFechaConsulta(`${value}-01`);
      return;
    }
    if (reporteTipo === "anual") {
      if (!/^\d{4}$/.test(value)) return;
      setFechaConsulta(`${value}-01-01`);
      return;
    }
    if (reporteTipo === "rango") return;
    setFechaConsulta(value);
  }, [reporteTipo]);

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff" } : { backgroundColor: "#fff" };
  const tituloModal = "Reporte";
  const colorTotal = "text-primary";

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content" style={modalStyle}>
          <div className="modal-header bg-primary text-white">
            <h5 className="modal-title"><FaMoneyBillWave className="me-2" /> {tituloModal}</h5>
            <button type="button" className="btn-close btn-close-white" onClick={cerrarModal}></button>
          </div>

          <div className="modal-body">
            <div className="row g-2 align-items-end mb-3 no-print">
              <div className="col-12 col-md-4 col-lg-3">
                <label className="form-label small mb-1">Periodo</label>
                <select
                  className="form-select form-select-sm"
                  value={reporteTipo}
                  onChange={(e) => onChangePeriodo(e.target.value)}
                >
                  <option value="diario">Diario</option>
                  <option value="semanal">Semanal</option>
                  <option value="mensual">Mensual</option>
                  <option value="anual">Anual</option>
                  <option value="rango">Intervalo de fechas</option>
                </select>
              </div>
              <div className="col-12 col-md-5 col-lg-4">
                <label className="form-label small mb-1">{reporteTipo === "rango" ? "Intervalo" : "Fecha de referencia"}</label>
                {reporteTipo === "rango" ? (
                  <div className="d-flex gap-2 flex-nowrap">
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      style={{ minWidth: "150px" }}
                      value={fechaDesdeRango}
                      onChange={(e) => setFechaDesdeRango(e.target.value)}
                    />
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      style={{ minWidth: "150px" }}
                      value={fechaHastaRango}
                      onChange={(e) => setFechaHastaRango(e.target.value)}
                    />
                  </div>
                ) : reporteTipo === "anual" ? (
                  <select
                    className="form-select form-select-sm"
                    value={toYearValue(fechaConsulta)}
                    onChange={(e) => onChangeFechaReferencia(e.target.value)}
                  >
                    {yearsDisponibles.map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={reporteTipo === "mensual" ? "month" : "date"}
                    className="form-control form-control-sm"
                    value={reporteTipo === "mensual" ? toMonthValue(fechaConsulta) : fechaConsulta}
                    onChange={(e) => onChangeFechaReferencia(e.target.value)}
                  />
                )}
              </div>
              <div className="col-12 col-md d-flex flex-column align-items-md-end">
                <div className={`fs-5 fw-bold ${colorTotal}`}>Total Caja: S/. {totalGeneral}</div>
                {esAdminPrincipal && (
                  <div className="small text-muted">Admin: anulados en rango = {movimientosAdmin.length}</div>
                )}
              </div>
              <div className="col-12 col-md-auto d-flex justify-content-md-end">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => {
                    cargarCaja().catch(() => {});
                    cargarAlertasRiesgo().catch(() => {});
                    if (esAdminPrincipal) {
                      const { desde, hasta } = adminRangeRef.current;
                      if (desde && hasta) {
                        cargarMovimientosAdmin(desde, hasta).catch(() => {});
                      }
                    }
                  }}
                  disabled={cargando || cargandoAlertas || cargandoAdmin}
                >
                  {(cargando || cargandoAlertas || cargandoAdmin) ? "Actualizando..." : "Actualizar"}
                </button>
              </div>
            </div>

            <div className="border rounded p-3 mb-3 no-print">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="fw-bold">Alertas de riesgo (ultimas 24h)</div>
                <div className={`badge ${alertasRiesgo?.severidad === "ALTA" ? "bg-danger" : alertasRiesgo?.severidad === "MEDIA" ? "bg-warning text-dark" : "bg-success"}`}>
                  {alertasRiesgo?.severidad || "NORMAL"}
                </div>
              </div>
              {cargandoAlertas && <div className="small text-muted mb-2">Actualizando alertas...</div>}
              <div className="row g-2 mb-2">
                <div className="col-md-3"><div className="border rounded p-2 small">Total alertas: <strong>{alertasResumen.total_alertas || 0}</strong></div></div>
                <div className="col-md-3"><div className="border rounded p-2 small">Anulaciones frecuentes: <strong>{alertasResumen.anulaciones_frecuentes || 0}</strong></div></div>
                <div className="col-md-3"><div className="border rounded p-2 small">Reemisiones recibo: <strong>{alertasResumen.reemisiones_recibo || 0}</strong></div></div>
                <div className="col-md-3"><div className="border rounded p-2 small">Cobros fuera horario: <strong>{alertasResumen.cobros_fuera_horario || 0}</strong></div></div>
                <div className="col-md-3"><div className="border rounded p-2 small">Cierres con desviacion: <strong>{alertasResumen.cierres_desviacion || 0}</strong></div></div>
              </div>
              {(alertasResumen.total_alertas || 0) > 0 && (
                <div className="small">
                  {(alertasDetalle?.anulaciones_frecuentes || []).slice(0, 3).map((a, idx) => (
                    <div key={`anul-${idx}`}>- Anulaciones altas: {a.username} ({a.total_anulaciones})</div>
                  ))}
                  {(alertasDetalle?.reemisiones_recibo || []).slice(0, 3).map((a, idx) => (
                    <div key={`ree-${idx}`}>- Reemision de recibo: {a.total_ordenes} ordenes</div>
                  ))}
                  {(alertasDetalle?.cobros_fuera_horario || []).slice(0, 3).map((a, idx) => (
                    <div key={`off-${idx}`}>- Cobro fuera horario: orden {a.id_orden} ({a.username})</div>
                  ))}
                  {(alertasDetalle?.cierres_desviacion || []).slice(0, 3).map((a, idx) => (
                    <div key={`cierre-${idx}`}>
                      - Cierre con desviacion: {formatFechaLocal(a.fecha_referencia)} {a.creado_en ? `(${formatFechaHoraLocal(a.creado_en)})` : ""} (S/. {formatMoney(a.desviacion)})
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="row g-3 mb-3 no-print">
              <div className="col-12 col-lg-4">
                <div className="border rounded p-3 h-100">
                  <div className="fw-bold mb-2">Recaudacion mensual</div>
                  {recaudacionTemporal.length === 0 ? (
                    <div className="small text-muted">Sin datos para el periodo.</div>
                  ) : (
                    recaudacionTemporal.slice(0, 8).map((r, idx) => {
                      const total = Number(r?.total || 0);
                      return (
                        <div key={`temp-${idx}`} className="mb-2">
                          <div className="d-flex justify-content-between small">
                            <span>{r?.etiqueta || "-"}</span>
                            <span>S/. {formatMoney(total)}</span>
                          </div>
                          <div className="progress" style={{ height: "8px" }}>
                            <div className="progress-bar" style={{ width: `${Math.max(2, Math.round((total / maxTemporal) * 100))}%` }}></div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="col-12 col-lg-4">
                <div className="border rounded p-3 h-100">
                  <div className="fw-bold mb-2">Top contribuyentes recaudados</div>
                  {topContribuyentes.length === 0 ? (
                    <div className="small text-muted">Sin datos para el periodo.</div>
                  ) : (
                    topContribuyentes.slice(0, 8).map((r, idx) => {
                      const total = Number(r?.total || 0);
                      return (
                        <div key={`top-${idx}`} className="mb-2">
                          <div className="d-flex justify-content-between small">
                            <span className="text-truncate" style={{ maxWidth: "180px" }}>{r?.nombre_completo || r?.codigo_municipal || "-"}</span>
                            <span>S/. {formatMoney(total)}</span>
                          </div>
                          <div className="progress" style={{ height: "8px" }}>
                            <div className="progress-bar bg-success" style={{ width: `${Math.max(2, Math.round((total / maxTop) * 100))}%` }}></div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="col-12 col-lg-4">
                <div className="border rounded p-3 h-100">
                  <div className="fw-bold mb-2">Recaudacion por mes de cobro</div>
                  {recaudacionPeriodo.length === 0 ? (
                    <div className="small text-muted">Sin datos para el periodo.</div>
                  ) : (
                    recaudacionPeriodo.slice(0, 8).map((r, idx) => {
                      const total = Number(r?.total || 0);
                      return (
                        <div key={`periodo-${idx}`} className="mb-2">
                          <div className="d-flex justify-content-between small">
                            <span>{r?.periodo || "-"}</span>
                            <span>S/. {formatMoney(total)}</span>
                          </div>
                          <div className="progress" style={{ height: "8px" }}>
                            <div className="progress-bar bg-warning" style={{ width: `${Math.max(2, Math.round((total / maxPeriodo) * 100))}%` }}></div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div ref={componentRef} className="p-3" style={{ backgroundColor: "#fff", color: "#000", fontFamily: "'Times New Roman', serif" }}>
              <div className="d-flex justify-content-between align-items-start mb-2" style={{ fontSize: "13px" }}>
                <div className="d-flex align-items-start gap-2">
                  <img
                    src="/logo.png"
                    alt="Logo Municipalidad"
                    style={{ width: "44px", height: "44px", objectFit: "contain" }}
                  />
                  <div>
                    <div><strong>MUNICIPALIDAD DISTRITAL DE PUEBLO NUEVO</strong></div>
                    <div>Area de Administracion Tributaria - Agua Potable</div>
                    <div className="fw-bold mt-1" style={{ fontSize: "17px", letterSpacing: "0.3px" }}>
                      INFORME DE INGRESOS TRIBUTARIOS
                    </div>
                  </div>
                </div>
                <div className="text-end">
                  <div>{formatFechaCorta(fechaConsulta)}</div>
                  <div><strong>Desde</strong> {fechaDesdeImpresion || "-"}</div>
                  <div><strong>Hasta</strong> {fechaHastaImpresion || "-"}</div>
                </div>
              </div>
              <hr className="mt-1 mb-2" />

              <table className="table table-sm mb-0" style={{ fontSize: "12px" }}>
                <thead>
                  <tr className="border border-dark">
                    <th style={{ width: "34%" }}>Fecha / Contribuyente</th>
                    <th className="text-center" style={{ width: "14%" }}>Recibo</th>
                    <th className="text-center" style={{ width: "7%" }}>Año</th>
                    <th className="text-center" style={{ width: "6%" }}>Mes</th>
                    <th className="text-end" style={{ width: "8%" }}>Agua</th>
                    <th className="text-end" style={{ width: "8%" }}>Desague</th>
                    <th className="text-end" style={{ width: "8%" }}>Limpieza</th>
                    <th className="text-end" style={{ width: "7%" }}>Gastos</th>
                    <th className="text-end" style={{ width: "8%" }}>Abono</th>
                  </tr>
                </thead>
                <tbody>
                  {gruposReporte.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-3 border">No hay movimientos para el rango consultado.</td>
                    </tr>
                  ) : (
                    gruposReporte.map((grupoFecha) => (
                      <tr key={`fecha-${grupoFecha.fecha}`}>
                        <td colSpan={9} className="p-0 border-0">
                          <table className="table table-sm mb-0" style={{ fontSize: "12px" }}>
                            <tbody>
                              <tr>
                                <td colSpan={9} className="fw-bold border-top border-dark border-bottom">
                                  Fecha {formatFechaCorta(grupoFecha.fecha)}
                                </td>
                              </tr>
                              {grupoFecha.contribuyentes.map((contrib, idxContrib) => (
                                <tr key={`contrib-${grupoFecha.fecha}-${idxContrib}`}>
                                  <td colSpan={9} className="p-0 border-0">
                                    <table className="table table-sm mb-0" style={{ fontSize: "12px" }}>
                                      <tbody>
                                        <tr>
                                          <td colSpan={9} className="fw-semibold border-bottom">
                                            {String(contrib.nombre_completo || "-").toUpperCase()}
                                          </td>
                                        </tr>
                                        {contrib.items.map((item) => (
                                          <tr key={`item-${item.id_pago}`}>
                                            <td style={{ width: "34%" }}></td>
                                            <td className="text-center" style={{ width: "14%" }}>{item.numero_recibo || item.codigo_impresion || "-"}</td>
                                            <td className="text-center" style={{ width: "7%" }}>{item.anio || "-"}</td>
                                            <td className="text-center" style={{ width: "6%" }}>{String(item.mes || "").padStart(2, "0")}</td>
                                            <td className="text-end" style={{ width: "8%" }}>{formatMontoReporte(item.monto_agua || 0)}</td>
                                            <td className="text-end" style={{ width: "8%" }}>{formatMontoReporte(item.monto_desague || 0)}</td>
                                            <td className="text-end" style={{ width: "8%" }}>{formatMontoReporte(item.monto_limpieza || 0)}</td>
                                            <td className="text-end" style={{ width: "7%" }}>{formatMontoReporte(item.monto_gastos || 0)}</td>
                                            <td className="text-end fw-bold" style={{ width: "8%" }}>{formatMontoReporte(item.monto_pagado || 0)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-top border-dark">
                    <td className="fw-bold">Total Fechas</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td className="text-end fw-bold">{formatMontoReporte(totalAguaReporte)}</td>
                    <td className="text-end fw-bold">{formatMontoReporte(totalDesagueReporte)}</td>
                    <td className="text-end fw-bold">{formatMontoReporte(totalLimpiezaReporte)}</td>
                    <td className="text-end fw-bold">{formatMontoReporte(totalGastosReporte)}</td>
                    <td className="text-end fw-bold">{formatMontoReporte(totalAbonoReporte)}</td>
                  </tr>
                </tfoot>
              </table>

              {totalPaginas > 1 && (
                <div className="d-flex justify-content-between align-items-center mt-2 no-print">
                  <small className="text-muted">
                    Mostrando {inicioIndice + 1} - {Math.min(inicioIndice + movimientos.length, Number(reporte?.cantidad_movimientos || 0))} de {Number(reporte?.cantidad_movimientos || 0)}
                  </small>
                  <div className="btn-group btn-group-sm">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      disabled={paginaActual <= 1}
                      onClick={() => setPaginaMovimientos((p) => Math.max(1, p - 1))}
                    >
                      Anterior
                    </button>
                    <button type="button" className="btn btn-outline-secondary disabled">
                      {paginaActual}/{totalPaginas}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      disabled={paginaActual >= totalPaginas}
                      onClick={() => setPaginaMovimientos((p) => Math.min(totalPaginas, p + 1))}
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}

              {esAdminPrincipal && (
                <div className="mt-4 pt-3 border-top border-2 border-dark">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <h6 className="fw-bold m-0">ANEXO ADMINISTRATIVO - PAGOS ANULADOS/EDITADOS</h6>
                    <div className="small fw-semibold">Total anulado: S/. {totalAnuladoAdmin}</div>
                  </div>
                  <div className="small mb-2">
                    Este anexo es solo para administrador e incluye trazabilidad de correcciones (anulaciones para reingreso de pago).
                  </div>
                  {cargandoAdmin && (
                    <div className="small text-muted mb-2">Actualizando movimientos administrativos...</div>
                  )}
                  <table className="table table-sm table-striped border border-dark" style={{ fontSize: "11px" }}>
                    <thead className="table-secondary">
                      <tr>
                        <th className="text-center">#</th>
                        <th>PAGO ORIGINAL</th>
                        <th>ANULADO EN</th>
                        <th>CODIGO</th>
                        <th>CONTRIBUYENTE</th>
                        <th className="text-center">PERIODO</th>
                        <th className="text-end">MONTO</th>
                        <th>MOTIVO</th>
                        <th>ANULADO POR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movimientosAdmin.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="text-center py-2">Sin anulaciones en este rango.</td>
                        </tr>
                      ) : (
                        movimientosAdmin.map((row, idx) => (
                          <tr key={`adm-${row?.id_anulacion || idx}`}>
                            <td className="text-center">{idx + 1}</td>
                            <td>{formatFechaHoraLocal(row?.fecha_pago_original) || "-"}</td>
                            <td>{formatFechaHoraLocal(row?.anulado_en) || "-"}</td>
                            <td>{row?.codigo_municipal || "-"}</td>
                            <td>{row?.nombre_completo || "-"}</td>
                            <td className="text-center">{row?.mes ? `${row.mes}/${row?.anio || ""}` : "-"}</td>
                            <td className="text-end fw-bold">{formatMoney(row?.monto_pagado || 0)}</td>
                            <td>{row?.motivo_anulacion || "-"}</td>
                            <td>{row?.username_anula || "-"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn btn-success" onClick={exportarExcel} disabled={cargando || exportandoExcel}>
              {exportandoExcel ? "Exportando..." : "Exportar Excel"}
            </button>
            <button className="btn btn-primary" onClick={handlePrint} disabled={cargando}>
              <FaPrint /> Exportar PDF
            </button>
            <button className="btn btn-secondary" onClick={cerrarModal}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalCierre;

