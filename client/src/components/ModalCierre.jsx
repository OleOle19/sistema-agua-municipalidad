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

const todayIso = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const toMonthValue = (isoDate) => String(isoDate || "").slice(0, 7);
const toYearValue = (isoDate) => String(isoDate || "").slice(0, 4);

const ModalCierre = ({ cerrarModal, darkMode, origen = "ventanilla" }) => {
  const [reporteTipo, setReporteTipo] = useState("diario");
  const [fechaConsulta, setFechaConsulta] = useState(todayIso());
  const [cargando, setCargando] = useState(false);
  const [exportandoExcel, setExportandoExcel] = useState(false);
  const [paginaMovimientos, setPaginaMovimientos] = useState(1);
  const [reporte, setReporte] = useState(EMPTY_REPORTE);
  const [anulandoPagoId, setAnulandoPagoId] = useState(0);
  const [cargandoAlertas, setCargandoAlertas] = useState(false);
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
  const printPageStyle = `
    @media print {
      .no-print {
        display: none !important;
      }
    }
  `;
  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `${origen === "caja" ? "Reporte_Caja" : "Reporte_Ventanilla"}_${reporteTipo}_${fechaConsulta}`,
    pageStyle: printPageStyle
  });

  const cargarCaja = useCallback(async (signal) => {
    try {
      setCargando(true);
      const res = await api.get("/caja/reporte", {
        params: {
          tipo: reporteTipo,
          fecha: fechaConsulta,
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
  }, [fechaConsulta, paginaMovimientos, reporteTipo]);

  const exportarExcel = async () => {
    try {
      setExportandoExcel(true);
      const res = await api.get("/caja/reporte/excel", {
        params: { tipo: reporteTipo, fecha: fechaConsulta },
        responseType: "blob",
        timeout: 0
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reporte_caja_${reporteTipo}_${fechaConsulta}.xlsx`;
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

  const anularPago = useCallback(async (mov) => {
    if (!mov?.id_pago) return;
    const idPago = Number(mov.id_pago);
    const monto = Number(mov?.monto_pagado || 0);
    const periodo = `${String(mov?.mes || "").padStart(2, "0")}/${mov?.anio || "-"}`;
    const confirmar = window.confirm(`Anular pago #${idPago} de S/. ${formatMoney(monto)} (${periodo})?`);
    if (!confirmar) return;
    const motivo = String(window.prompt("Motivo de anulacion (minimo 5 caracteres):", "") || "").trim();
    if (motivo.length < 5) {
      window.alert("Debe ingresar un motivo valido (minimo 5 caracteres).");
      return;
    }
    setAnulandoPagoId(idPago);
    try {
      const res = await api.post(`/pagos/${idPago}/anular`, { motivo });
      window.alert(res?.data?.mensaje || "Pago anulado correctamente.");
      await Promise.all([cargarCaja(), cargarAlertasRiesgo()]);
    } catch (error) {
      const msg = error?.response?.data?.error || "No se pudo anular el pago.";
      window.alert(msg);
    } finally {
      setAnulandoPagoId(0);
    }
  }, [cargarAlertasRiesgo, cargarCaja]);

  useEffect(() => {
    setPaginaMovimientos(1);
  }, [reporteTipo, fechaConsulta]);

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
    const timer = setInterval(() => {
      cargarAlertasRiesgo(controller.signal);
    }, 30000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [cargarAlertasRiesgo]);

  const movimientos = Array.isArray(reporte.movimientos) ? reporte.movimientos : [];
  const totalPaginas = Math.max(1, Number(reporte?.paginacion?.total_paginas || 1));
  const paginaActual = Math.max(1, Number(reporte?.paginacion?.pagina || paginaMovimientos));
  const pageSizeActual = Math.max(1, Number(reporte?.paginacion?.page_size || MOVIMIENTOS_PAGE_SIZE));
  const inicioIndice = (paginaActual - 1) * pageSizeActual;
  const totalGeneral = formatMoney(reporte.total_general || reporte.total || 0);
  const alertasResumen = alertasRiesgo?.resumen || {};
  const alertasDetalle = alertasRiesgo?.alertas || {};
  const periodoLabel = reporteTipo === "semanal"
    ? "Semanal"
    : reporteTipo === "mensual"
      ? "Mensual"
      : reporteTipo === "anual"
        ? "Anual"
        : "Diario";
  const graficosCaja = reporte?.graficos || {};
  const recaudacionTemporal = Array.isArray(graficosCaja.recaudacion_temporal) ? graficosCaja.recaudacion_temporal : [];
  const topContribuyentes = Array.isArray(graficosCaja.top_contribuyentes) ? graficosCaja.top_contribuyentes : [];
  const recaudacionPeriodo = Array.isArray(graficosCaja.recaudacion_por_periodo) ? graficosCaja.recaudacion_por_periodo : [];
  const maxTemporal = Math.max(1, ...recaudacionTemporal.map((r) => Number(r?.total || 0)));
  const maxTop = Math.max(1, ...topContribuyentes.map((r) => Number(r?.total || 0)));
  const maxPeriodo = Math.max(1, ...recaudacionPeriodo.map((r) => Number(r?.total || 0)));

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
    setFechaConsulta(value);
  }, [reporteTipo]);

  const esCaja = origen === "caja";
  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff" } : { backgroundColor: "#fff" };
  const tituloModal = esCaja ? "Reporte de Caja" : "Reporte de Ventanilla";
  const subtituloImpresion = esCaja
    ? "REPORTE DETALLADO DE INGRESOS - CAJA"
    : "REPORTE DETALLADO DE INGRESOS - VENTANILLA";
  const colorTotal = esCaja ? "text-success" : "text-primary";
  const columnasTabla = esCaja ? 9 : 8;
  const colSpanTotal = 7;

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content" style={modalStyle}>
          <div className={`modal-header ${esCaja ? "bg-success text-white" : "bg-primary text-white"}`}>
            <h5 className="modal-title"><FaMoneyBillWave className="me-2" /> {tituloModal}</h5>
            <button type="button" className="btn-close btn-close-white" onClick={cerrarModal}></button>
          </div>

          <div className="modal-body">
            <div className="d-flex flex-wrap gap-2 align-items-end mb-3 no-print">
              <div>
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
                </select>
              </div>
              <div>
                <label className="form-label small mb-1">Fecha de referencia</label>
                {reporteTipo === "anual" ? (
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
              <div className="ms-auto d-flex flex-column align-items-end">
                <div className={`fs-5 fw-bold ${colorTotal}`}>Total Caja: S/. {totalGeneral}</div>
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
                    <div key={`ree-${idx}`}>- Reemision recibo {a.id_recibo}: {a.total_ordenes} ordenes</div>
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
                  <div className="fw-bold mb-2">Recaudacion por periodo tributario</div>
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

            <div ref={componentRef} className="p-3" style={{ backgroundColor: "#fff", color: "#000" }}>
              <div className="row mb-3 border-bottom border-2 border-dark pb-2">
                <div className="col-2 text-center d-flex align-items-center justify-content-center">
                  <img src="/logo.png" alt="Logo" style={{ width: "60px", height: "60px", objectFit: "contain" }} />
                </div>
                <div className="col-7 text-center">
                  <h4 className="fw-bold m-0">MUNICIPALIDAD DISTRITAL DE PUEBLO NUEVO</h4>
                  <h5 className="m-0">{subtituloImpresion}</h5>
                  <p className="small m-0">Area de Administracion Tributaria - Agua Potable</p>
                </div>
                <div className="col-3 text-end small">
                  <div><strong>Fecha:</strong> {fechaConsulta}</div>
                  <div><strong>Periodo:</strong> {periodoLabel}</div>
                  <div><strong>Movimientos:</strong> {reporte?.cantidad_movimientos || 0}</div>
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
                    {esCaja && <th className="text-center no-print">ACCIONES</th>}
                  </tr>
                </thead>
                <tbody>
                  {movimientos.length === 0 ? (
                    <tr>
                      <td colSpan={columnasTabla} className="text-center p-3">No hay movimientos para el dia.</td>
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
                        {esCaja && (
                          <td className="text-center no-print">
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm"
                              onClick={() => anularPago(m)}
                              disabled={cargando || anulandoPagoId === Number(m.id_pago || 0)}
                            >
                              {anulandoPagoId === Number(m.id_pago || 0) ? "Anulando..." : "Anular"}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="table-light border-top border-dark fw-bold" style={{ fontSize: "14px" }}>
                    <td colSpan={colSpanTotal} className="text-end pe-3">TOTAL CAJA:</td>
                    <td className={`text-end ${esCaja ? "text-success" : "text-primary"}`}>S/. {totalGeneral}</td>
                    {esCaja && <td className="no-print"></td>}
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
