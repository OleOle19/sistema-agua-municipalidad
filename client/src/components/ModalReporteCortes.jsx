import { useEffect, useMemo, useState } from "react";
import api from "../api";
import { FaCut, FaFileExcel, FaFilePdf, FaPrint } from "react-icons/fa";
import { compareByDireccionAsc } from "../utils/cortesAddress";

const ESTADOS_CONEXION = {
  CON_CONEXION: "CON_CONEXION",
  SIN_CONEXION: "SIN_CONEXION",
  CORTADO: "CORTADO"
};

const normalizeEstadoConexion = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (["CON_CONEXION", "CONEXION", "ACTIVO", "CONECTADO"].includes(raw)) return ESTADOS_CONEXION.CON_CONEXION;
  if (["SIN_CONEXION", "SIN CONEXION", "SIN_SERVICIO", "NO_CONECTADO"].includes(raw)) return ESTADOS_CONEXION.SIN_CONEXION;
  if (["CORTADO", "CORTE", "SUSPENDIDO", "SUSPENSION"].includes(raw)) return ESTADOS_CONEXION.CORTADO;
  return ESTADOS_CONEXION.CON_CONEXION;
};

const STATUS_META = {
  CORTADO: {
    titulo: "Reporte de Cortados",
    claseBtn: "btn-danger",
    claseOutline: "btn-outline-danger",
    etiqueta: "Cortado"
  },
  CON_CONEXION: {
    titulo: "Reporte de Conexion Activa",
    claseBtn: "btn-success",
    claseOutline: "btn-outline-success",
    etiqueta: "Con conexion"
  },
  SIN_CONEXION: {
    titulo: "Reporte de Sin Conexion",
    claseBtn: "btn-secondary",
    claseOutline: "btn-outline-secondary",
    etiqueta: "Sin conexion"
  }
};

const currentDateValue = () => {
  const dt = new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const currentMonthValue = () => {
  const dt = new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

const currentYearValue = () => String(new Date().getFullYear());

const buildDownloadNameFromHeaders = (headers = {}, fallback = "reporte_estado_conexion.xlsx") => {
  const contentDisposition = String(headers?.["content-disposition"] || "");
  const match = contentDisposition.match(/filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i);
  const fileNameRaw = decodeURIComponent(match?.[1] || match?.[2] || "").trim();
  return fileNameRaw || fallback;
};

const normalizeRange = (desde, hasta) => {
  if (!desde || !hasta) return { desde, hasta };
  if (desde <= hasta) return { desde, hasta };
  return { desde: hasta, hasta: desde };
};

const buildPeriodoQuery = ({
  tipoPeriodo,
  periodoDia,
  periodoMes,
  periodoAnio,
  periodoDesde,
  periodoHasta,
  mesesProyeccion
}) => {
  if (tipoPeriodo === "todo") {
    return { tipo_periodo: "todo" };
  }
  if (tipoPeriodo === "dia") {
    return { tipo_periodo: "dia", fecha: periodoDia };
  }
  if (tipoPeriodo === "proyeccion") {
    return { tipo_periodo: "proyeccion", periodo: periodoMes, meses_proyeccion: mesesProyeccion };
  }
  if (tipoPeriodo === "anio") {
    return { tipo_periodo: "anio", anio: periodoAnio };
  }
  if (tipoPeriodo === "rango") {
    const normalized = normalizeRange(periodoDesde, periodoHasta);
    return { tipo_periodo: "rango", desde: normalized.desde, hasta: normalized.hasta };
  }
  return { tipo_periodo: "mes", periodo: periodoMes };
};

const describePeriodo = ({
  tipoPeriodo,
  periodoDia,
  periodoMes,
  periodoAnio,
  periodoDesde,
  periodoHasta
}) => {
  if (tipoPeriodo === "todo") return "Todo histórico: desde el inicio hasta hoy";
  if (tipoPeriodo === "dia") return `Día: ${periodoDia || "-"}`;
  if (tipoPeriodo === "anio") return `Año: ${periodoAnio || "-"}`;
  if (tipoPeriodo === "rango") {
    const normalized = normalizeRange(periodoDesde, periodoHasta);
    return `Intervalo: ${normalized.desde || "-"} a ${normalized.hasta || "-"}`;
  }
  return `Mes: ${periodoMes || "-"}`;
};

const describePeriodoExtendido = (params = {}) => {
  if (params?.tipoPeriodo === "proyeccion") {
    return `Proyeccion: base ${params?.periodoMes || "-"} | ${Number(params?.mesesProyeccion || 0)} mes(es)`;
  }
  return describePeriodo(params);
};

const parseAmount = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

const ModalReporteCortes = ({
  cerrarModal,
  contribuyentes = [],
  selectedIds = [],
  onImprimir,
  darkMode,
  estadoObjetivo = ESTADOS_CONEXION.CORTADO,
  canUseProyeccionFutura = true
}) => {
  const estadoFiltro = Object.prototype.hasOwnProperty.call(STATUS_META, estadoObjetivo)
    ? estadoObjetivo
    : ESTADOS_CONEXION.CORTADO;
  const meta = STATUS_META[estadoFiltro];

  const [modo, setModo] = useState("manual");
  const [manualIds, setManualIds] = useState(new Set(selectedIds));
  const [calles, setCalles] = useState([]);
  const [idCalle, setIdCalle] = useState("");
  const [busquedaManual, setBusquedaManual] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [exportandoExcel, setExportandoExcel] = useState(false);
  const [tipoPeriodo, setTipoPeriodo] = useState("mes");
  const [periodoDia, setPeriodoDia] = useState(currentDateValue());
  const [periodoMes, setPeriodoMes] = useState(currentMonthValue());
  const [periodoAnio, setPeriodoAnio] = useState(currentYearValue());
  const [periodoDesde, setPeriodoDesde] = useState(currentDateValue());
  const [periodoHasta, setPeriodoHasta] = useState(currentDateValue());
  const [mesesProyeccion, setMesesProyeccion] = useState(1);
  const [reporteRows, setReporteRows] = useState([]);
  const [cargandoReporte, setCargandoReporte] = useState(false);
  const [errorReporte, setErrorReporte] = useState("");
  const [proyeccionData, setProyeccionData] = useState(null);

  const usuariosBase = useMemo(() => {
    const rows = Array.isArray(contribuyentes) ? contribuyentes : [];
    return rows
      .filter((item) => normalizeEstadoConexion(item?.estado_conexion) === estadoFiltro)
      .slice()
      .sort(compareByDireccionAsc);
  }, [contribuyentes, estadoFiltro]);

  const permiteProyeccion = estadoFiltro === ESTADOS_CONEXION.CON_CONEXION && canUseProyeccionFutura;
  const isProyeccion = tipoPeriodo === "proyeccion";

  useEffect(() => {
    if (!permiteProyeccion && tipoPeriodo === "proyeccion") {
      setTipoPeriodo("mes");
    }
  }, [permiteProyeccion, tipoPeriodo]);

  useEffect(() => {
    const filtrados = new Set(usuariosBase.map((m) => Number(m.id_contribuyente)));
    setManualIds((prev) => {
      const next = new Set();
      for (const id of selectedIds) {
        const n = Number(id);
        if (filtrados.has(n)) next.add(n);
      }
      if (next.size > 0) return next;
      for (const id of prev) {
        if (filtrados.has(Number(id))) next.add(Number(id));
      }
      return next;
    });
  }, [selectedIds, usuariosBase]);

  useEffect(() => {
    const cargarCalles = async () => {
      try {
        const res = await api.get("/calles");
        setCalles(Array.isArray(res.data) ? res.data : []);
      } catch {
        setCalles([]);
      }
    };
    cargarCalles();
  }, []);

  useEffect(() => {
    let cancelado = false;
    const cargarReporte = async () => {
      setCargandoReporte(true);
      setErrorReporte("");
      try {
        const res = await api.get("/contribuyentes/reporte-estado-conexion", {
          params: {
            estado: estadoFiltro,
            ...buildPeriodoQuery({
              tipoPeriodo,
              periodoDia,
              periodoMes,
              periodoAnio,
              periodoDesde,
              periodoHasta,
              mesesProyeccion
            })
          }
        });
        if (cancelado) return;
        setReporteRows(Array.isArray(res?.data?.rows) ? res.data.rows : []);
        setProyeccionData(res?.data?.proyeccion || null);
      } catch (error) {
        if (cancelado) return;
        setReporteRows([]);
        setProyeccionData(null);
        setErrorReporte(error?.response?.data?.error || "No se pudo actualizar la información del reporte.");
      } finally {
        if (!cancelado) setCargandoReporte(false);
      }
    };
    cargarReporte();
    return () => {
      cancelado = true;
    };
  }, [estadoFiltro, tipoPeriodo, periodoDia, periodoMes, periodoAnio, periodoDesde, periodoHasta, mesesProyeccion]);

  const toggleManual = (id) => {
    setManualIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const calleNombre = useMemo(() => {
    const c = calles.find((x) => String(x.id_calle) === String(idCalle));
    return c?.nombre || "";
  }, [calles, idCalle]);

  const reporteMap = useMemo(
    () => new Map(reporteRows.map((item) => [Number(item?.id_contribuyente || 0), item])),
    [reporteRows]
  );

  const enriquecerRowDesdeMapa = (row, map = reporteMap) => {
    const detalle = map.get(Number(row?.id_contribuyente || 0)) || {};
    const mesesDeuda = Number(detalle?.meses_deuda ?? row?.meses_deuda ?? 0) || 0;
    const deudaTotal = parseAmount(detalle?.deuda_total ?? row?.deuda_total ?? row?.deuda_anio ?? 0);
    const abonoTotal = parseAmount(detalle?.abono_total ?? row?.abono_total ?? row?.abono_anio ?? 0);
    const montoMensual = parseAmount(detalle?.monto_mensual ?? row?.monto_mensual ?? row?.monto_referencia ?? 0);
    const totalProyectado = parseAmount(detalle?.total_proyectado ?? row?.total_proyectado ?? row?.monto_periodo ?? 0);
    const totalPredios = Number(detalle?.total_predios ?? row?.total_predios ?? 0) || 0;
    return {
      ...detalle,
      ...row,
      meses_deuda: mesesDeuda,
      deuda_total: deudaTotal,
      deuda_anio: deudaTotal,
      abono_total: abonoTotal,
      abono_anio: abonoTotal,
      monto_mensual: montoMensual,
      monto_referencia: montoMensual,
      monto_periodo: totalProyectado,
      total_proyectado: totalProyectado,
      total_predios: totalPredios
    };
  };

  const enriquecerRow = (row) => enriquecerRowDesdeMapa(row, reporteMap);

  const manualRows = useMemo(() => {
    const q = String(busquedaManual || "").trim().toLowerCase();
    if (!q) return usuariosBase;
    return usuariosBase.filter((m) => {
      const codigo = String(m?.codigo_municipal || "").toLowerCase();
      const nombre = String(m?.nombre_completo || "").toLowerCase();
      const direccion = String(m?.direccion_completa || "").toLowerCase();
      return codigo.includes(q) || nombre.includes(q) || direccion.includes(q);
    });
  }, [usuariosBase, busquedaManual]);

  const seleccion = useMemo(() => {
    let rows = [];
    if (modo === "todos") rows = usuariosBase;
    else if (modo === "calle") rows = idCalle ? usuariosBase.filter((m) => String(m.id_calle || "") === String(idCalle)) : [];
    else rows = usuariosBase.filter((m) => manualIds.has(Number(m.id_contribuyente)));
    return rows.slice().sort(compareByDireccionAsc);
  }, [modo, usuariosBase, idCalle, manualIds]);

  const seleccionEnriquecida = useMemo(
    () => seleccion.map((row) => enriquecerRow(row)),
    [seleccion, reporteMap]
  );

  const totalDeuda = useMemo(
    () => seleccionEnriquecida.reduce((acc, item) => acc + parseAmount(item.deuda_total), 0),
    [seleccionEnriquecida]
  );

  const totalAbono = useMemo(
    () => seleccionEnriquecida.reduce((acc, item) => acc + parseAmount(item.abono_total), 0),
    [seleccionEnriquecida]
  );

  const totalMensualProyeccion = useMemo(
    () => seleccionEnriquecida.reduce((acc, item) => acc + parseAmount(item.monto_mensual), 0),
    [seleccionEnriquecida]
  );

  const totalProyectado = useMemo(
    () => seleccionEnriquecida.reduce((acc, item) => acc + parseAmount(item.total_proyectado), 0),
    [seleccionEnriquecida]
  );

  const criterioDescripcion = useMemo(() => {
    const sufijo = isProyeccion ? ` | Proyeccion ${Number(mesesProyeccion || 0)} mes(es)` : "";
    if (modo === "todos") return `Todos (${meta.etiqueta})${sufijo}`;
    if (modo === "calle") return `${calleNombre ? `${meta.etiqueta} por calle: ${calleNombre}` : `${meta.etiqueta} por calle`}${sufijo}`;
    return `Seleccion manual (${meta.etiqueta})${sufijo}`;
  }, [modo, calleNombre, meta.etiqueta, isProyeccion, mesesProyeccion]);

  const prepararReporte = async (formato) => {
    if (seleccion.length === 0) {
      alert("No hay usuarios seleccionados para el reporte.");
      return;
    }
    const ids = seleccion
      .map((row) => Number(row.id_contribuyente))
      .filter((id) => Number.isInteger(id) && id > 0);

    setProcesando(true);
    try {
      const reporteRes = await api.get("/contribuyentes/reporte-estado-conexion", {
        params: {
          estado: estadoFiltro,
          ids: ids.join(","),
          ...buildPeriodoQuery({
            tipoPeriodo,
            periodoDia,
            periodoMes,
            periodoAnio,
            periodoDesde,
            periodoHasta,
            mesesProyeccion
          })
        }
      });
      const reporteItems = Array.isArray(reporteRes?.data?.rows) ? reporteRes.data.rows : [];
      const proyeccion = reporteRes?.data?.proyeccion || null;
      const reporteSeleccionMap = new Map(
        reporteItems.map((item) => [Number(item?.id_contribuyente || 0), item])
      );
      const requiereResumenCorte = estadoFiltro === ESTADOS_CONEXION.CORTADO && !isProyeccion;
      let resumenItems = [];
      if (requiereResumenCorte && ids.length > 0) {
        const resumenRes = await api.post("/contribuyentes/cortes/resumen", {
          ids_contribuyentes: ids
        });
        resumenItems = Array.isArray(resumenRes?.data?.items) ? resumenRes.data.items : [];
      }
      const resumenMap = new Map(
        resumenItems.map((item) => [Number(item.id_contribuyente), item])
      );
      const listaFinal = seleccion.map((row) => {
        const rowEnriquecida = enriquecerRowDesdeMapa(row, reporteSeleccionMap);
        if (!requiereResumenCorte) {
          return rowEnriquecida;
        }
        const resumen = resumenMap.get(Number(row.id_contribuyente)) || null;
        const evidencias = Array.isArray(resumen?.evidencias) ? resumen.evidencias : [];
        return {
          ...rowEnriquecida,
          corte_fecha: resumen?.fecha_evento || null,
          corte_motivo: resumen?.motivo || rowEnriquecida?.estado_conexion_motivo_ultimo || "",
          evidencia_resumen: evidencias.length > 0
            ? evidencias.map((ev) => String(ev.archivo_nombre || "").trim()).filter(Boolean).join(" | ")
            : "Sin evidencia adjunta"
        };
      });

      onImprimir?.({
        lista: listaFinal,
        criterio: {
          tipo: modo,
          descripcion: criterioDescripcion,
          estado_objetivo: estadoFiltro,
          estado_label: meta.etiqueta,
          modo_reporte: isProyeccion ? "proyeccion" : "estado"
        },
        formato,
        proyeccion,
        mostrar_evidencia: formato === "pdf" && requiereResumenCorte,
        generado_en: new Date().toISOString()
      });
    } catch (error) {
      alert(error?.response?.data?.error || "No se pudo preparar el reporte.");
    } finally {
      setProcesando(false);
    }
  };

  const exportarReporteExcel = async () => {
    setExportandoExcel(true);
    try {
      const idsSeleccionados = seleccion
        .map((row) => Number(row?.id_contribuyente || 0))
        .filter((id) => Number.isInteger(id) && id > 0);
      const params = {
        estado: estadoFiltro,
        ids: idsSeleccionados.join(","),
        ...buildPeriodoQuery({
          tipoPeriodo,
          periodoDia,
          periodoMes,
          periodoAnio,
          periodoDesde,
          periodoHasta,
          mesesProyeccion
        })
      };
      const res = await api.get("/contribuyentes/reporte-estado-conexion.xlsx", {
        params,
        responseType: "blob"
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildDownloadNameFromHeaders(
        res?.headers,
        `${isProyeccion ? "reporte_proyeccion_conexion_activa" : "reporte_estado_conexion"}_${currentMonthValue().replace("-", "")}.xlsx`
      );
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      let msg = "";
      const payload = err?.response?.data;
      if (typeof payload === "string") {
        msg = payload;
      } else if (payload instanceof Blob) {
        try {
          const text = await payload.text();
          const parsed = JSON.parse(text);
          msg = String(parsed?.error || "").trim();
        } catch {
          msg = "";
        }
      } else if (payload && typeof payload === "object") {
        msg = String(payload?.error || "").trim();
      }
      alert(msg || "No se pudo exportar el Excel del reporte.");
    } finally {
      setExportandoExcel(false);
    }
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff" } : {};
  const inputClass = darkMode ? "form-select bg-dark text-white border-secondary" : "form-select";
  const cardClass = darkMode ? "border border-secondary rounded p-2 bg-dark text-white" : "border rounded p-2";
  const fechaActual = currentDateValue();
  const mesActual = currentMonthValue();
  const anioActual = currentYearValue();

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content" style={modalStyle}>
          <div className="modal-header">
            <h5 className="modal-title"><FaCut className="me-2" /> {meta.titulo}</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>

          <div className="modal-body">
            <div className={`${cardClass} mb-3`}>
              <div className="small fw-bold mb-2">Estado objetivo</div>
              <button type="button" className={`btn btn-sm ${meta.claseBtn}`}>
                {meta.etiqueta} ({usuariosBase.length})
              </button>
            </div>

            <div className={`${cardClass} mb-3`}>
              <div className="row g-2 align-items-end">
                <div className="col-md-3">
                  <label className="form-label form-label-sm mb-1">Periodo</label>
                  <select
                    className={inputClass}
                    value={tipoPeriodo}
                    onChange={(e) => setTipoPeriodo(e.target.value)}
                  >
                    <option value="todo">Todo histórico</option>
                    <option value="dia">Día</option>
                    <option value="mes">Mes</option>
                    <option value="anio">Año</option>
                    <option value="rango">Intervalo de fechas</option>
                    {permiteProyeccion && <option value="proyeccion">Proyeccion futura</option>}
                  </select>
                </div>
                {tipoPeriodo === "dia" && (
                  <div className="col-md-3">
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      value={periodoDia}
                      max={fechaActual}
                      onChange={(e) => setPeriodoDia(e.target.value)}
                    />
                  </div>
                )}
                {tipoPeriodo === "mes" && (
                  <div className="col-md-3">
                    <input
                      type="month"
                      className="form-control form-control-sm"
                      value={periodoMes}
                      max={mesActual}
                      onChange={(e) => setPeriodoMes(e.target.value)}
                    />
                  </div>
                )}
                {tipoPeriodo === "proyeccion" && (
                  <>
                    <div className="col-md-3">
                      <label className="form-label form-label-sm mb-1">Mes de referencia</label>
                      <input
                        type="month"
                        className="form-control form-control-sm"
                        value={periodoMes}
                        max={mesActual}
                        onChange={(e) => setPeriodoMes(e.target.value)}
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label form-label-sm mb-1">Meses a proyectar</label>
                      <input
                        type="number"
                        min="1"
                        max="24"
                        className="form-control form-control-sm"
                        value={mesesProyeccion}
                        onChange={(e) => setMesesProyeccion(Math.min(24, Math.max(1, Number(e.target.value || 1) || 1)))}
                      />
                    </div>
                  </>
                )}
                {tipoPeriodo === "anio" && (
                  <div className="col-md-3">
                    <input
                      type="number"
                      min="1900"
                      max={anioActual}
                      className="form-control form-control-sm"
                      value={periodoAnio}
                      onChange={(e) => setPeriodoAnio(e.target.value)}
                    />
                  </div>
                )}
                {tipoPeriodo === "rango" && (
                  <>
                    <div className="col-md-4">
                      <label className="form-label form-label-sm mb-1">Desde</label>
                      <input
                        type="date"
                        className="form-control form-control-sm"
                        value={periodoDesde}
                        max={fechaActual}
                        onChange={(e) => setPeriodoDesde(e.target.value)}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label form-label-sm mb-1">Hasta</label>
                      <input
                        type="date"
                        className="form-control form-control-sm"
                        value={periodoHasta}
                        max={fechaActual}
                        onChange={(e) => setPeriodoHasta(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="small text-muted mt-2">
                {describePeriodoExtendido({
                  tipoPeriodo,
                  periodoDia,
                  periodoMes,
                  periodoAnio,
                  periodoDesde,
                  periodoHasta,
                  mesesProyeccion
                })}
              </div>
            </div>

            <div className="d-flex flex-wrap gap-2 mb-3">
              <button type="button" className={`btn btn-sm ${modo === "manual" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setModo("manual")}>
                Manual
              </button>
              <button type="button" className={`btn btn-sm ${modo === "calle" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setModo("calle")}>
                Por Calle
              </button>
              <button type="button" className={`btn btn-sm ${modo === "todos" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setModo("todos")}>
                Todos
              </button>
            </div>

            {modo === "manual" && (
              <div className={cardClass}>
                <div className="d-flex gap-2 mb-2">
                  <input
                    type="search"
                    className="form-control form-control-sm"
                    placeholder="Buscar por código, contribuyente o dirección"
                    value={busquedaManual}
                    onChange={(e) => setBusquedaManual(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setManualIds(new Set())}
                  >
                    Limpiar
                  </button>
                </div>
                <div style={{ maxHeight: "220px", overflowY: "auto" }}>
                  {manualRows.length === 0 ? (
                    <div className="small text-muted">No hay contribuyentes para este estado y filtro.</div>
                  ) : (
                    manualRows.map((m) => {
                      const row = enriquecerRow(m);
                      return (
                        <label key={m.id_contribuyente} className="d-flex align-items-center gap-2 small border-bottom py-1">
                          <input
                            type="checkbox"
                            checked={manualIds.has(Number(m.id_contribuyente))}
                            onChange={() => toggleManual(Number(m.id_contribuyente))}
                          />
                          <span className="fw-bold">{m.codigo_municipal}</span>
                          <span className="text-truncate">{m.nombre_completo}</span>
                          <span className="ms-auto text-end">
                            {isProyeccion
                              ? `Base: S/. ${parseAmount(row.monto_mensual).toFixed(2)} | Proy: S/. ${parseAmount(row.total_proyectado).toFixed(2)}`
                              : `D: S/. ${parseAmount(row.deuda_total).toFixed(2)} | A: S/. ${parseAmount(row.abono_total).toFixed(2)}`}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {modo === "calle" && (
              <div className={cardClass}>
                <label className="form-label small fw-bold">Seleccione calle</label>
                <select className={inputClass} value={idCalle} onChange={(e) => setIdCalle(e.target.value)}>
                  <option value="">-- Seleccione --</option>
                  {calles.map((c) => (
                    <option key={c.id_calle} value={c.id_calle}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {modo === "todos" && (
              <div className={cardClass}>
                Se incluiran todos los contribuyentes del estado seleccionado.
              </div>
            )}

            <div className="alert alert-warning mt-3 mb-2">
              <div><strong>Criterio:</strong> {criterioDescripcion}</div>
              <div><strong>Orden:</strong> Calle y numero ascendente</div>
              <div><strong>Usuarios seleccionados:</strong> {seleccion.length}</div>
              {isProyeccion ? (
                <>
                  <div><strong>Base mensual:</strong> S/. {totalMensualProyeccion.toFixed(2)}</div>
                  <div><strong>Total proyectado:</strong> S/. {totalProyectado.toFixed(2)}</div>
                  <div><strong>Meses proyectados:</strong> {Number(proyeccionData?.meses_proyeccion || mesesProyeccion)}</div>
                </>
              ) : (
                <>
                  <div><strong>Total deuda:</strong> S/. {totalDeuda.toFixed(2)}</div>
                  <div><strong>Total abono:</strong> S/. {totalAbono.toFixed(2)}</div>
                </>
              )}
              {cargandoReporte && <div className="small mt-1">Actualizando importes segun el periodo seleccionado...</div>}
              {!cargandoReporte && errorReporte && <div className="small mt-1 text-danger">{errorReporte}</div>}
            </div>

            <div className="table-responsive" style={{ maxHeight: "240px" }}>
              <table className={`table table-sm ${darkMode ? "table-dark" : "table-striped"}`}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Codigo</th>
                    <th>Contribuyente</th>
                    <th>Direccion</th>
                    {isProyeccion ? (
                      <>
                        <th className="text-center">Predios Activos</th>
                        <th className="text-end">Base Mensual</th>
                        <th className="text-end">Total Proyectado</th>
                      </>
                    ) : (
                      <>
                        <th className="text-center">Meses Deuda</th>
                        <th className="text-end">Deuda Total</th>
                        <th className="text-end">Abono Total</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {seleccionEnriquecida.length === 0 ? (
                    <tr><td colSpan="7" className="text-center py-3">Sin datos para mostrar.</td></tr>
                  ) : (
                    seleccionEnriquecida.map((m, idx) => (
                      <tr key={`${m.id_contribuyente}-${idx}`}>
                        <td>{idx + 1}</td>
                        <td className="fw-bold">{m.codigo_municipal}</td>
                        <td>{m.nombre_completo}</td>
                        <td>{m.direccion_completa}</td>
                        {isProyeccion ? (
                          <>
                            <td className="text-center">{Number(m.total_predios || 0)}</td>
                            <td className={`text-end ${parseAmount(m.monto_mensual) > 0 ? "fw-bold" : "text-muted"}`}>
                              S/. {parseAmount(m.monto_mensual).toFixed(2)}
                            </td>
                            <td className={`text-end ${parseAmount(m.total_proyectado) > 0 ? "fw-bold text-success" : "text-muted"}`}>
                              S/. {parseAmount(m.total_proyectado).toFixed(2)}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className={`text-center ${Number(m.meses_deuda || 0) > 0 ? "fw-bold text-danger" : ""}`}>{m.meses_deuda}</td>
                            <td className={`text-end ${parseAmount(m.deuda_total) > 0 ? "fw-bold" : "text-muted"}`}>
                              S/. {parseAmount(m.deuda_total).toFixed(2)}
                            </td>
                            <td className={`text-end ${parseAmount(m.abono_total) > 0 ? "fw-bold text-success" : "text-muted"}`}>
                              S/. {parseAmount(m.abono_total).toFixed(2)}
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={cerrarModal} disabled={procesando}>Cerrar</button>
            {!isProyeccion && (
              <button type="button" className={`btn ${meta.claseOutline}`} onClick={() => prepararReporte("print")} disabled={procesando}>
                <FaPrint className="me-2" />
                {procesando ? "Procesando..." : "Imprimir Reporte"}
              </button>
            )}
            <button type="button" className="btn btn-danger" onClick={() => prepararReporte("pdf")} disabled={procesando}>
              <FaFilePdf className="me-2" />
              {procesando ? "Procesando..." : "Exportar PDF"}
            </button>
            <button type="button" className="btn btn-success" onClick={exportarReporteExcel} disabled={exportandoExcel}>
              <FaFileExcel className="me-2" />
              {exportandoExcel ? "Exportando..." : "Exportar Excel"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalReporteCortes;


