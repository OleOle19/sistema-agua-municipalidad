import { useState, useRef, useEffect, useMemo, memo } from "react";
import { useReactToPrint } from "react-to-print";
import { FaPrint, FaMoneyBillWave } from "react-icons/fa";
import api from "../api";

const MOVIMIENTOS_PAGE_SIZE = 120;

const formatMoney = (value) => {
  const num = parseFloat(value);
  return Number.isFinite(num)
    ? num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
};

const formatMoneyCompact = (value) => {
  const num = Number(value || 0);
  const abs = Math.abs(num);
  if (!Number.isFinite(num)) return "0";
  if (abs >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  if (abs >= 100) return num.toFixed(0);
  return num.toFixed(2);
};

const ChartCard = memo(function ChartCard({ title, data = [], labelKey, valueKey, color = "#0d6efd", emptyText = "Sin datos" }) {
  const max = data.reduce((m, d) => Math.max(m, Number(d?.[valueKey] || 0)), 0);
  const dense = data.length >= 10;
  return (
    <div className="border rounded p-3 h-100">
      <div className="fw-bold mb-2">{title}</div>
      <div className="small text-muted mb-2">Montos en S/.</div>
      {data.length === 0 ? (
        <div className="small text-muted">{emptyText}</div>
      ) : (
        <div style={{ minHeight: "180px", display: "flex", alignItems: "flex-end", gap: "8px" }}>
          {data.map((item, idx) => {
            const val = Number(item?.[valueKey] || 0);
            const h = max > 0 ? Math.max((val / max) * 140, 6) : 6;
            return (
              <div key={`${item?.[labelKey] || idx}-${idx}`} className="d-flex flex-column align-items-center" style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="fw-bold mb-1 text-center"
                  title={`S/. ${formatMoney(val)}`}
                  style={{
                    fontSize: dense ? "0.76rem" : "0.83rem",
                    lineHeight: 1.1,
                    whiteSpace: "nowrap",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}
                >
                  {formatMoneyCompact(val)}
                </div>
                <div style={{ width: "100%", maxWidth: "36px", height: `${h}px`, background: color, borderRadius: "4px 4px 0 0" }} />
                <div className="small text-center mt-1 text-truncate w-100" title={String(item?.[labelKey] || "")}>
                  {item?.[labelKey]}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

const ModalCierre = ({ cerrarModal, darkMode }) => {
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm = String(hoy.getMonth() + 1).padStart(2, "0");
  const dd = String(hoy.getDate()).padStart(2, "0");

  const [tipo, setTipo] = useState("diario");
  const [fechaDia, setFechaDia] = useState(`${yyyy}-${mm}-${dd}`);
  const [mesRef, setMesRef] = useState(`${yyyy}-${mm}`);
  const [anioRef, setAnioRef] = useState(String(yyyy));
  const [cargando, setCargando] = useState(false);
  const [exportandoExcel, setExportandoExcel] = useState(false);
  const [paginaMovimientos, setPaginaMovimientos] = useState(1);
  const [reporte, setReporte] = useState({
    total: "0.00",
    cantidad_movimientos: 0,
    paginacion: { pagina: 1, page_size: MOVIMIENTOS_PAGE_SIZE, total_paginas: 1 },
    movimientos: [],
    graficos: {
      recaudacion_temporal: [],
      top_contribuyentes: [],
      recaudacion_por_periodo: []
    },
    rango: { desde: "", hasta_exclusivo: "" }
  });
  const [efectivoDeclarado, setEfectivoDeclarado] = useState("");
  const [observacionCierre, setObservacionCierre] = useState("");
  const [registrandoCierre, setRegistrandoCierre] = useState(false);
  const [resultadoCierre, setResultadoCierre] = useState(null);
  const [cargandoAlertas, setCargandoAlertas] = useState(false);
  const [alertasRiesgo, setAlertasRiesgo] = useState({
    severidad: "NORMAL",
    resumen: {
      total_alertas: 0,
      anulaciones_frecuentes: 0,
      reemisiones_recibo: 0,
      cobros_fuera_horario: 0
    },
    alertas: {
      anulaciones_frecuentes: [],
      reemisiones_recibo: [],
      cobros_fuera_horario: []
    }
  });

  const componentRef = useRef();

  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `Reporte_Caja_${tipo}_${new Date().toISOString().slice(0, 10)}`
  });

  const fechaConsulta = useMemo(() => {
    if (tipo === "mensual") {
      return /^\d{4}-\d{2}$/.test(mesRef) ? `${mesRef}-01` : `${yyyy}-${mm}-01`;
    }
    if (tipo === "anual") {
      return /^\d{4}$/.test(anioRef) ? `${anioRef}-01-01` : `${yyyy}-01-01`;
    }
    return fechaDia;
  }, [tipo, fechaDia, mesRef, anioRef]);
  const filtroKey = useMemo(() => `${tipo}|${fechaConsulta}`, [tipo, fechaConsulta]);
  const lastFiltroKeyRef = useRef("");

  const tituloPeriodo = useMemo(() => {
    if (tipo === "diario") return "Diario";
    if (tipo === "semanal") return "Semanal";
    if (tipo === "mensual") return "Mensual";
    return "Anual";
  }, [tipo]);

  const cargarCaja = async (signal) => {
    try {
      setCargando(true);
      const res = await api.get(`/caja/reporte`, {
        params: {
          tipo,
          fecha: fechaConsulta,
          page: paginaMovimientos,
          page_size: MOVIMIENTOS_PAGE_SIZE
        },
        signal
      });
      setReporte(res.data || {});
    } catch (error) {
      if (error?.code === "ERR_CANCELED" || error?.name === "CanceledError") return;
      console.error(error);
      setReporte({
        total: "0.00",
        cantidad_movimientos: 0,
        paginacion: { pagina: 1, page_size: MOVIMIENTOS_PAGE_SIZE, total_paginas: 1 },
        movimientos: [],
        graficos: {
          recaudacion_temporal: [],
          top_contribuyentes: [],
          recaudacion_por_periodo: []
        },
        rango: { desde: "", hasta_exclusivo: "" }
      });
    } finally {
      if (!signal?.aborted) setCargando(false);
    }
  };

  const exportarExcel = async () => {
    try {
      setExportandoExcel(true);
      const res = await api.get(`/caja/reporte/excel`, {
        params: { tipo, fecha: fechaConsulta },
        responseType: "blob",
        timeout: 0
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reporte_caja_${tipo}_${fechaConsulta}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert("No se pudo exportar el reporte en Excel.");
    } finally {
      setExportandoExcel(false);
    }
  };

  const cargarAlertasRiesgo = async (signal) => {
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
          cobros_fuera_horario: 0
        },
        alertas: {
          anulaciones_frecuentes: [],
          reemisiones_recibo: [],
          cobros_fuera_horario: []
        }
      });
    } catch (error) {
      if (error?.code === "ERR_CANCELED" || error?.name === "CanceledError") return;
      console.error(error);
    } finally {
      if (!signal?.aborted) setCargandoAlertas(false);
    }
  };

  const registrarCierre = async () => {
    const efectivo = parseFloat(String(efectivoDeclarado || "").replace(",", "."));
    if (!Number.isFinite(efectivo) || efectivo < 0) {
      alert("Ingrese un monto valido para efectivo declarado.");
      return;
    }
    setRegistrandoCierre(true);
    try {
      const res = await api.post("/caja/cierre", {
        tipo,
        fecha: fechaConsulta,
        efectivo_declarado: efectivo,
        observacion: observacionCierre
      });
      const cierre = res?.data?.cierre || null;
      setResultadoCierre(cierre);
      await cargarCaja();
      await cargarAlertasRiesgo();
    } catch (error) {
      alert(error?.response?.data?.error || "No se pudo registrar el cierre de caja.");
    } finally {
      setRegistrandoCierre(false);
    }
  };

  useEffect(() => {
    const filtroCambio = lastFiltroKeyRef.current !== filtroKey;
    if (filtroCambio) {
      lastFiltroKeyRef.current = filtroKey;
      if (paginaMovimientos !== 1) {
        setPaginaMovimientos(1);
        return;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      cargarCaja(controller.signal);
    }, 120);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [filtroKey, paginaMovimientos]);

  useEffect(() => {
    const controller = new AbortController();
    cargarAlertasRiesgo(controller.signal);
    const timer = setInterval(() => {
      cargarAlertasRiesgo(controller.signal);
    }, 30000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!resultadoCierre && !efectivoDeclarado) {
      setEfectivoDeclarado(String(reporte.total || "0.00"));
    }
  }, [reporte.total, resultadoCierre, efectivoDeclarado]);

  const movimientos = Array.isArray(reporte.movimientos) ? reporte.movimientos : [];
  const totalPaginas = Math.max(1, Number(reporte?.paginacion?.total_paginas || 1));
  const paginaActual = Math.max(1, Number(reporte?.paginacion?.pagina || paginaMovimientos));
  const pageSizeActual = Math.max(1, Number(reporte?.paginacion?.page_size || MOVIMIENTOS_PAGE_SIZE));
  const inicioIndice = (paginaActual - 1) * pageSizeActual;
  const total = formatMoney(reporte.total);
  const chartTemporal = reporte?.graficos?.recaudacion_temporal || [];
  const chartTop = reporte?.graficos?.top_contribuyentes || [];
  const chartPeriodo = reporte?.graficos?.recaudacion_por_periodo || [];
  const chartTopData = useMemo(
    () => chartTop.map((r) => ({ label: `${r.codigo_municipal} - ${r.nombre_completo}`, total: r.total })),
    [chartTop]
  );
  const alertasResumen = alertasRiesgo?.resumen || {};
  const alertasDetalle = alertasRiesgo?.alertas || {};

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff" } : { backgroundColor: "#fff" };

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content" style={modalStyle}>
          <div className="modal-header">
            <h5 className="modal-title"><FaMoneyBillWave className="me-2" /> Reporte de Cobranza</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>

          <div className="modal-body">
            <div className="d-flex flex-wrap gap-2 align-items-end mb-3 no-print">
              <div>
                <label className="form-label small mb-1">Periodo</label>
                <select className="form-select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  <option value="diario">Diario</option>
                  <option value="semanal">Semanal</option>
                  <option value="mensual">Mensual</option>
                  <option value="anual">Anual</option>
                </select>
              </div>

              {(tipo === "diario" || tipo === "semanal") && (
                <div>
                  <label className="form-label small mb-1">Fecha referencia</label>
                  <input type="date" className="form-control" value={fechaDia} onChange={(e) => setFechaDia(e.target.value)} />
                </div>
              )}

              {tipo === "mensual" && (
                <div>
                  <label className="form-label small mb-1">Mes</label>
                  <input type="month" className="form-control" value={mesRef} onChange={(e) => setMesRef(e.target.value)} />
                </div>
              )}

              {tipo === "anual" && (
                <div>
                  <label className="form-label small mb-1">Año</label>
                  <input type="number" className="form-control" min="2000" max="2100" value={anioRef} onChange={(e) => setAnioRef(e.target.value)} />
                </div>
              )}

              <div className="ms-auto fs-4 fw-bold text-success">
                Total: S/. {total}
              </div>
            </div>

            <div className="border rounded p-3 mb-3 no-print">
              <div className="fw-bold mb-2">Cierre de caja automatizado</div>
              <div className="d-flex flex-wrap gap-2 align-items-end">
                <div>
                  <label className="form-label small mb-1">Efectivo declarado</label>
                  <input
                    type="text"
                    className="form-control"
                    value={efectivoDeclarado}
                    onChange={(e) => setEfectivoDeclarado(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="flex-grow-1">
                  <label className="form-label small mb-1">Observacion (opcional)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={observacionCierre}
                    onChange={(e) => setObservacionCierre(e.target.value)}
                    placeholder="Detalle de cierre"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={registrarCierre}
                  disabled={registrandoCierre || cargando}
                >
                  {registrandoCierre ? "Registrando..." : "Registrar cierre"}
                </button>
              </div>
              {resultadoCierre && (
                <div className={`mt-3 alert ${resultadoCierre.alerta_desviacion ? "alert-danger" : "alert-success"} mb-0`}>
                  <div className="fw-bold">Ultimo cierre registrado (ID {resultadoCierre.id_cierre})</div>
                  <div>
                    Sistema: S/. {formatMoney(resultadoCierre.total_sistema)} | Declarado: S/. {formatMoney(resultadoCierre.efectivo_declarado)} | Desviacion: S/. {formatMoney(resultadoCierre.desviacion)}
                  </div>
                  <div>
                    Umbral alerta: S/. {formatMoney(resultadoCierre.umbral_alerta)} | Estado: {resultadoCierre.alerta_desviacion ? "ALERTA" : "OK"}
                  </div>
                </div>
              )}
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
              </div>
              {(alertasResumen.total_alertas || 0) > 0 && (
                <div className="small">
                  {(alertasDetalle?.anulaciones_frecuentes || []).slice(0, 3).map((a, idx) => (
                    <div key={`anul-${idx}`}>- Anulaciones altas: {a.username} ({a.total_anulaciones})</div>
                  ))}
                  {(alertasDetalle?.reemisiones_recibo || []).slice(0, 3).map((a, idx) => (
                    <div key={`ree-${idx}`}>- Reemision recibo {a.id_recibo}: {a.total_ordenes} ordenes</div>
                  ))}
                  {(alertasDetalle?.cobros_fuera_horario || []).slice(0, 3).map((a, idx) => (
                    <div key={`off-${idx}`}>- Cobro fuera horario: orden {a.id_orden} ({a.username})</div>
                  ))}
                </div>
              )}
            </div>

            <div ref={componentRef} className="p-3" style={{ backgroundColor: "#fff", color: "#000" }}>
              <div className="row mb-3 border-bottom border-2 border-dark pb-2">
                <div className="col-2 text-center d-flex align-items-center justify-content-center">
                  <img src="/logo.png" alt="Logo" style={{ width: "60px", height: "60px", objectFit: "contain" }} />
                </div>
                <div className="col-7 text-center">
                  <h4 className="fw-bold m-0">MUNICIPALIDAD DISTRITAL DE PUEBLO NUEVO</h4>
                  <h5 className="m-0">REPORTE DETALLADO DE INGRESOS DE CAJA</h5>
                  <p className="small m-0">Area de Administracion Tributaria - Agua Potable</p>
                </div>
                <div className="col-3 text-end small">
                  <div><strong>Periodo:</strong> {tituloPeriodo}</div>
                  <div><strong>Desde:</strong> {reporte?.rango?.desde || "-"}</div>
                  <div><strong>Hasta:</strong> {reporte?.rango?.hasta_exclusivo || "-"}</div>
                  <div><strong>Movimientos:</strong> {reporte?.cantidad_movimientos || 0}</div>
                </div>
              </div>

              <div className="row g-3 mb-3">
                <div className="col-md-6">
                  <ChartCard title="Recaudacion en el periodo" data={chartTemporal} labelKey="etiqueta" valueKey="total" color="#0d6efd" />
                </div>
                <div className="col-md-6">
                  <ChartCard
                    title="Top contribuyentes recaudados"
                    data={chartTopData}
                    labelKey="label"
                    valueKey="total"
                    color="#198754"
                  />
                </div>
                <div className="col-12">
                  <ChartCard title="Recaudacion por periodo tributario (mes/año)" data={chartPeriodo} labelKey="periodo" valueKey="total" color="#fd7e14" />
                </div>
              </div>

              <table className="table table-sm table-striped border border-dark" style={{ fontSize: "12px" }}>
                <thead className="table-dark text-white">
                  <tr>
                    <th className="text-center">#</th>
                    <th>FECHA</th>
                    <th className="text-center">HORA</th>
                    <th className="text-center">COD. IMP.</th>
                    <th>CODIGO</th>
                    <th>CONTRIBUYENTE</th>
                    <th className="text-center">PERIODO</th>
                    <th className="text-end">MONTO (S/.)</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="text-center p-3">No hay movimientos para el periodo seleccionado.</td>
                    </tr>
                  ) : (
                    movimientos.map((m, i) => (
                      <tr key={`${m.id_pago}-${i}`}>
                        <td className="text-center">{inicioIndice + i + 1}</td>
                        <td>{m.fecha}</td>
                        <td className="text-center">{m.hora}</td>
                        <td className="text-center fw-bold">{m.codigo_impresion || "-"}</td>
                        <td className="fw-bold">{m.codigo_municipal}</td>
                        <td>{m.nombre_completo}</td>
                        <td className="text-center">{m.mes}/{m.anio}</td>
                        <td className="text-end fw-bold">{formatMoney(m.monto_pagado)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="table-light border-top border-dark fw-bold" style={{ fontSize: "14px" }}>
                    <td colSpan="7" className="text-end pe-3">TOTAL RECAUDADO:</td>
                    <td className="text-end">S/. {total}</td>
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
