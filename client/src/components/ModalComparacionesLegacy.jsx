import { useEffect, useMemo, useState } from "react";
import { FaDownload, FaFileExcel, FaFilter, FaHistory, FaPlay, FaSearch, FaSyncAlt, FaTable } from "react-icons/fa";
import api from "../api";

const badgeClassByCategoria = (categoria = "") => {
  const raw = String(categoria || "").trim().toUpperCase();
  if (raw === "CAMBIO") return "text-bg-warning";
  if (raw === "SOLO_ANTIGUA") return "text-bg-danger";
  if (raw === "SOLO_NUEVA") return "text-bg-success";
  if (raw === "AMBIGUA") return "text-bg-secondary";
  return "text-bg-info";
};
const labelCategoria = (categoria = "") => {
  const raw = String(categoria || "").trim().toUpperCase();
  if (raw === "CAMBIO") return "Cambio";
  if (raw === "SOLO_ANTIGUA") return "Solo antigua";
  if (raw === "SOLO_NUEVA") return "Solo nueva";
  if (raw === "AMBIGUA") return "Cambio";
  return raw || "-";
};
const categoriaSortRank = (categoria = "") => {
  const raw = String(categoria || "").trim().toUpperCase();
  if (raw === "CAMBIO") return 1;
  if (raw === "SOLO_ANTIGUA") return 2;
  if (raw === "SOLO_NUEVA") return 3;
  return 9;
};
const resolveDetalleId = (d) => String(d?.codigo_municipal || d?.clave || d?.dni_ruc || "-").trim() || "-";
const labelTipoDetalle = (d) => {
  const motivo = String(d?.payload_json?.motivo || "").trim().toUpperCase();
  if ((d?.categoria === "SOLO_ANTIGUA" && motivo === "ELIMINADO") || String(d?.valor_nuevo || "").trim().toUpperCase() === "ELIMINADO") {
    return "Eliminado";
  }
  return labelCategoria(d?.categoria);
};

const formatNum = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";
};

const downloadBlob = (blobData, fileName) => {
  const url = window.URL.createObjectURL(blobData);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

const DETALLE_VISTA = {
  USUARIOS: "USUARIOS",
  FINANZAS: "FINANZAS"
};
const DETALLE_FINANZAS_SUB = {
  PAGOS: "PAGOS",
  DEUDAS: "DEUDAS",
  HISTORIAL: "HISTORIAL"
};
const DETALLE_CATEGORIAS = [
  { value: "CAMBIO", label: "Cambio" },
  { value: "SOLO_ANTIGUA", label: "Solo antigua" },
  { value: "SOLO_NUEVA", label: "Solo nueva" }
];
const getSeccionParamByVista = (vista, subVista) => {
  if (vista === DETALLE_VISTA.USUARIOS) return "PADRON";
  if (subVista === DETALLE_FINANZAS_SUB.PAGOS) return "RECAUDACION";
  if (subVista === DETALLE_FINANZAS_SUB.DEUDAS) return "DEUDA";
  return "DEUDA,RECAUDACION";
};

const ModalComparacionesLegacy = ({ cerrarModal, darkMode }) => {
  const [tab, setTab] = useState("nueva");
  const [modoCarga, setModoCarga] = useState("exportes");
  const [archivoLegacy, setArchivoLegacy] = useState(null);
  const [archivoUsuarios, setArchivoUsuarios] = useState(null);
  const [archivoFinanzas, setArchivoFinanzas] = useState(null);
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [ejecutando, setEjecutando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");

  const [historial, setHistorial] = useState([]);
  const [historialTotal, setHistorialTotal] = useState(0);
  const [historialPage, setHistorialPage] = useState(1);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const [corridaSeleccionada, setCorridaSeleccionada] = useState(null);
  const [detalle, setDetalle] = useState([]);
  const [detalleTotal, setDetalleTotal] = useState(0);
  const [detallePage, setDetallePage] = useState(1);
  const [detalleSeccion, setDetalleSeccion] = useState("");
  const [detalleCategoria, setDetalleCategoria] = useState("");
  const [detalleQ, setDetalleQ] = useState("");
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [detalleVista, setDetalleVista] = useState(DETALLE_VISTA.USUARIOS);
  const [detalleVistaFinanzas, setDetalleVistaFinanzas] = useState(DETALLE_FINANZAS_SUB.PAGOS);

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-primary text-white"}`;
  const inputClass = `form-control ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const selectClass = `form-select ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const tableClass = `table table-sm ${darkMode ? "table-dark table-hover" : "table-striped"}`;
  const cardClass = `border rounded p-2 ${darkMode ? "border-secondary" : ""}`;

  const totalPagesHistorial = Math.max(1, Math.ceil(Number(historialTotal || 0) / 20));
  const totalPagesDetalle = Math.max(1, Math.ceil(Number(detalleTotal || 0) / 200));

  const cargarHistorial = async (page = 1) => {
    try {
      setCargandoHistorial(true);
      const res = await api.get("/comparaciones/legacy", {
        params: { page, page_size: 20 }
      });
      setHistorial(Array.isArray(res.data?.data) ? res.data.data : []);
      setHistorialTotal(Number(res.data?.total || 0));
      setHistorialPage(Number(res.data?.page || page));
    } catch (err) {
      setError(err?.response?.data?.error || "No se pudo cargar historial.");
    } finally {
      setCargandoHistorial(false);
    }
  };

  const cargarResumen = async (idCorrida) => {
    const res = await api.get(`/comparaciones/legacy/${idCorrida}/resumen`);
    setCorridaSeleccionada(res.data || null);
  };

  const cargarDetalle = async (idCorrida, page = 1) => {
    if (!idCorrida) return;
    try {
      setCargandoDetalle(true);
      const seccionPreset = getSeccionParamByVista(detalleVista, detalleVistaFinanzas);
      const res = await api.get(`/comparaciones/legacy/${idCorrida}/detalle`, {
        params: {
          page,
          page_size: 200,
          seccion: (detalleSeccion || seccionPreset) || undefined,
          categoria: detalleCategoria || undefined,
          q: detalleQ || undefined
        }
      });
      setDetalle(Array.isArray(res.data?.data) ? res.data.data : []);
      setDetalleTotal(Number(res.data?.total || 0));
      setDetallePage(Number(res.data?.page || page));
    } catch (err) {
      setError(err?.response?.data?.error || "No se pudo cargar detalle.");
    } finally {
      setCargandoDetalle(false);
    }
  };

  const ejecutarComparacion = async (e) => {
    e.preventDefault();
    if (modoCarga === "exportes" && (!archivoUsuarios || !archivoFinanzas)) {
      setError("Seleccione ambos archivos: usuarios y finanzas.");
      return;
    }
    if (modoCarga === "plantilla" && !archivoLegacy) {
      setError("Seleccione el archivo de plantilla (.xlsx).");
      return;
    }
    const formData = new FormData();
    if (modoCarga === "exportes") {
      formData.append("archivo_usuarios", archivoUsuarios);
      formData.append("archivo_finanzas", archivoFinanzas);
    } else {
      formData.append("archivo_legacy", archivoLegacy);
    }
    if (fechaDesde) formData.append("fecha_desde", fechaDesde);
    if (fechaHasta) formData.append("fecha_hasta", fechaHasta);
    try {
      setEjecutando(true);
      setError("");
      setMensaje("Ejecutando comparacion. Esto puede tardar...");
      const res = await api.post("/comparaciones/legacy/run", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 0
      });
      const idCorrida = Number(res.data?.id_corrida || 0);
      setMensaje(`Comparacion completada. Corrida #${idCorrida}.`);
      await cargarHistorial(1);
      if (idCorrida > 0) {
        await cargarResumen(idCorrida);
        await cargarDetalle(idCorrida, 1);
        setTab("detalle");
      }
    } catch (err) {
      setError(err?.response?.data?.error || "No se pudo ejecutar la comparacion.");
      setMensaje("");
    } finally {
      setEjecutando(false);
    }
  };

  const abrirCorrida = async (row) => {
    const idCorrida = Number(row?.id_corrida || 0);
    if (!idCorrida) return;
    setError("");
    await cargarResumen(idCorrida);
    await cargarDetalle(idCorrida, 1);
    setTab("detalle");
  };

  const descargarPlantilla = async () => {
    try {
      const res = await api.get("/comparaciones/legacy/plantilla", { responseType: "blob", timeout: 0 });
      downloadBlob(new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `plantilla_comparacion_legacy_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      setError(err?.response?.data?.error || "No se pudo descargar plantilla.");
    }
  };

  const exportarCorrida = async () => {
    const idCorrida = Number(corridaSeleccionada?.id_corrida || 0);
    if (!idCorrida) return;
    try {
      const res = await api.get(`/comparaciones/legacy/${idCorrida}/exportar`, { responseType: "blob", timeout: 0 });
      downloadBlob(new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `comparacion_legacy_${idCorrida}.xlsx`);
    } catch (err) {
      setError(err?.response?.data?.error || "No se pudo exportar corrida.");
    }
  };

  useEffect(() => {
    cargarHistorial(1);
  }, []);

  useEffect(() => {
    if (!corridaSeleccionada?.id_corrida || tab !== "detalle") return;
    cargarDetalle(Number(corridaSeleccionada.id_corrida), 1);
  }, [detalleSeccion, detalleCategoria, detalleVista, detalleVistaFinanzas]);

  const categoriaOptions = useMemo(() => {
    return DETALLE_CATEGORIAS;
  }, []);

  const etiquetaVistaDetalle = useMemo(() => {
    if (detalleVista === DETALLE_VISTA.USUARIOS) return "Usuarios > Padron";
    if (detalleVistaFinanzas === DETALLE_FINANZAS_SUB.PAGOS) return "Finanzas > Pagos";
    if (detalleVistaFinanzas === DETALLE_FINANZAS_SUB.DEUDAS) return "Finanzas > Deudas";
    return "Finanzas > Historial";
  }, [detalleVista, detalleVistaFinanzas]);

  const resumenCards = useMemo(() => {
    if (!corridaSeleccionada) return null;
    const resumenActual = corridaSeleccionada?.resumen_json || {};
    const meta = resumenActual?.meta || {};
    const padron = resumenActual?.padron || {};
    const deuda = resumenActual?.deuda || {};
    const recaudacion = resumenActual?.recaudacion || {};
    return (
      <div className="row g-2 mb-3">
        <div className="col-md-5">
          <div className={cardClass}>
            <div className="fw-bold mb-1">Usuarios (Padron)</div>
            <div className="small">Filas legacy: <strong>{Number(meta?.total_padron_legacy || 0)}</strong></div>
            <div className="small">Cambios registros: <strong>{Number(padron?.cambios_registros || 0)}</strong></div>
            <div className="small">Solo antigua: <strong>{Number(padron?.solo_antigua || 0)}</strong></div>
            <div className="small">Solo nueva: <strong>{Number(padron?.solo_nueva || 0)}</strong></div>
          </div>
        </div>
        <div className="col-md-7">
          <div className={cardClass}>
            <div className="fw-bold mb-2">Finanzas</div>
            <div className="row g-2">
              <div className="col-md-4">
                <div className={`rounded p-2 ${darkMode ? "bg-dark-subtle text-dark" : "bg-light"}`}>
                  <div className="small fw-semibold">Pagos (Recaudacion)</div>
                  <div className="small">Filas legacy: <strong>{Number(meta?.total_pagos_legacy || 0)}</strong></div>
                  <div className="small">Diario delta: <strong>{Number(recaudacion?.diario?.registros_con_delta || 0)}</strong></div>
                  <div className="small">Mensual delta: <strong>{Number(recaudacion?.mensual?.registros_con_delta || 0)}</strong></div>
                </div>
              </div>
              <div className="col-md-4">
                <div className={`rounded p-2 ${darkMode ? "bg-dark-subtle text-dark" : "bg-light"}`}>
                  <div className="small fw-semibold">Deudas</div>
                  <div className="small">Filas legacy: <strong>{Number(meta?.total_deudas_legacy || 0)}</strong></div>
                  <div className="small">Delta global: <strong>S/. {formatNum(deuda?.delta_global)}</strong></div>
                  <div className="small">Registros delta: <strong>{Number(deuda?.registros_con_delta || 0)}</strong></div>
                </div>
              </div>
              <div className="col-md-4">
                <div className={`rounded p-2 ${darkMode ? "bg-dark-subtle text-dark" : "bg-light"}`}>
                  <div className="small fw-semibold">Historial</div>
                  <div className="small">Rango: <strong>{meta?.fecha_desde || "-"} a {meta?.fecha_hasta || "-"}</strong></div>
                  <div className="small">Total detalles: <strong>{Number(meta?.total_detalles || 0)}</strong></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }, [corridaSeleccionada, cardClass, darkMode]);

  const detalleOrdenado = useMemo(() => {
    return [...detalle].sort((a, b) => {
      const idA = resolveDetalleId(a);
      const idB = resolveDetalleId(b);
      const idCmp = idA.localeCompare(idB);
      if (idCmp !== 0) return idCmp;
      const rankCmp = categoriaSortRank(a?.categoria) - categoriaSortRank(b?.categoria);
      if (rankCmp !== 0) return rankCmp;
      const campoCmp = String(a?.campo || "").localeCompare(String(b?.campo || ""));
      if (campoCmp !== 0) return campoCmp;
      return Number(a?.id_detalle || 0) - Number(b?.id_detalle || 0);
    });
  }, [detalle]);

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className="modal-title"><FaTable className="me-2" /> Comparacion Base Antigua vs Actual</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : "btn-close-white"}`} onClick={cerrarModal}></button>
          </div>

          <div className="modal-body">
            <div className="d-flex flex-wrap gap-2 mb-3">
              <button className={`btn btn-sm ${tab === "nueva" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("nueva")}><FaPlay className="me-1" /> Nueva comparacion</button>
              <button className={`btn btn-sm ${tab === "detalle" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("detalle")}><FaFilter className="me-1" /> Resumen y detalle</button>
              <button className={`btn btn-sm ${tab === "historial" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("historial")}><FaHistory className="me-1" /> Historial</button>
              <button className="btn btn-sm btn-outline-success ms-auto" onClick={descargarPlantilla}><FaDownload className="me-1" /> Descargar plantilla</button>
            </div>

            {mensaje && <div className="alert alert-success py-2 small">{mensaje}</div>}
            {error && <div className="alert alert-danger py-2 small">{error}</div>}

            {tab === "nueva" && (
              <form onSubmit={ejecutarComparacion} className={cardClass}>
                <div className="row g-2 align-items-end">
                  <div className="col-md-4">
                    <label className="form-label small mb-1">Modo de carga</label>
                    <select className={selectClass} value={modoCarga} onChange={(e) => setModoCarga(e.target.value)}>
                      <option value="exportes">2 archivos exportados (Usuarios + Finanzas)</option>
                      <option value="plantilla">Plantilla unica (3 hojas)</option>
                    </select>
                  </div>
                  {modoCarga === "exportes" ? (
                    <>
                      <div className="col-md-4">
                        <label className="form-label small mb-1">Usuarios exportado (.xlsx)</label>
                        <input
                          type="file"
                          accept=".xlsx"
                          className={inputClass}
                          onChange={(e) => setArchivoUsuarios(e.target.files?.[0] || null)}
                          required
                        />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label small mb-1">Finanzas exportado (.xlsx)</label>
                        <input
                          type="file"
                          accept=".xlsx"
                          className={inputClass}
                          onChange={(e) => setArchivoFinanzas(e.target.files?.[0] || null)}
                          required
                        />
                      </div>
                    </>
                  ) : (
                    <div className="col-md-8">
                      <label className="form-label small mb-1">Archivo plantilla comparador (.xlsx)</label>
                      <input
                        type="file"
                        accept=".xlsx"
                        className={inputClass}
                        onChange={(e) => setArchivoLegacy(e.target.files?.[0] || null)}
                        required
                      />
                    </div>
                  )}
                  <div className="col-md-4">
                    <small className="opacity-75">
                      Recomendado: usar los excels de <strong>Exportar Usuarios</strong> y <strong>Exportar Finanzas</strong>.
                    </small>
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small mb-1">Desde (opcional)</label>
                    <input type="date" className={inputClass} value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small mb-1">Hasta (opcional)</label>
                    <input type="date" className={inputClass} value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
                  </div>
                  <div className="col-md-2 d-grid">
                    <button type="submit" className="btn btn-primary" disabled={ejecutando}>
                      {ejecutando ? "Procesando..." : "Ejecutar"}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {tab === "historial" && (
              <div className={cardClass}>
                <div className="d-flex align-items-center mb-2">
                  <div className="fw-bold">Corridas registradas</div>
                  <button type="button" className="btn btn-sm btn-outline-secondary ms-auto" onClick={() => cargarHistorial(historialPage)} disabled={cargandoHistorial}>
                    <FaSyncAlt className="me-1" /> Recargar
                  </button>
                </div>
                <div className="table-responsive">
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Fecha</th>
                        <th>Archivo</th>
                        <th>Estado</th>
                        <th>Padron cambios</th>
                        <th>Detalles</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cargandoHistorial ? (
                        <tr><td colSpan="7">Cargando...</td></tr>
                      ) : historial.length === 0 ? (
                        <tr><td colSpan="7">Sin corridas.</td></tr>
                      ) : historial.map((h) => (
                        <tr key={h.id_corrida}>
                          <td>{h.id_corrida}</td>
                          <td>{h.creado_en ? new Date(h.creado_en).toLocaleString() : "-"}</td>
                          <td>{h.archivo_nombre || "-"}</td>
                          <td><span className={`badge ${h.estado === "COMPLETADA" ? "text-bg-success" : h.estado === "ERROR" ? "text-bg-danger" : "text-bg-warning"}`}>{h.estado}</span></td>
                          <td>{Number(h?.resumen_json?.padron?.cambios_registros || 0)}</td>
                          <td>{Number(h?.resumen_json?.meta?.total_detalles || 0)}</td>
                          <td className="text-end">
                            <button className="btn btn-sm btn-outline-primary" onClick={() => abrirCorrida(h)}>Ver</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="d-flex justify-content-between align-items-center mt-2">
                  <small className="opacity-75">Total: {historialTotal}</small>
                  <div className="btn-group btn-group-sm">
                    <button className="btn btn-outline-secondary" disabled={historialPage <= 1} onClick={() => cargarHistorial(historialPage - 1)}>Anterior</button>
                    <button className="btn btn-outline-secondary disabled">{historialPage}/{totalPagesHistorial}</button>
                    <button className="btn btn-outline-secondary" disabled={historialPage >= totalPagesHistorial} onClick={() => cargarHistorial(historialPage + 1)}>Siguiente</button>
                  </div>
                </div>
              </div>
            )}

            {tab === "detalle" && (
              <div>
                {corridaSeleccionada ? (
                  <>
                    <div className={`${cardClass} mb-2`}>
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <div><strong>Corrida:</strong> #{corridaSeleccionada.id_corrida}</div>
                        <div><strong>Estado:</strong> {corridaSeleccionada.estado}</div>
                        <div><strong>Rango:</strong> {corridaSeleccionada.fecha_desde || "-"} a {corridaSeleccionada.fecha_hasta || "-"}</div>
                        <button className="btn btn-sm btn-outline-success ms-auto" onClick={exportarCorrida}><FaFileExcel className="me-1" /> Exportar Excel</button>
                      </div>
                    </div>
                    {resumenCards}
                    <div className={cardClass}>
                      <div className="mb-2">
                        <div className="btn-group btn-group-sm mb-2">
                          <button
                            className={`btn ${detalleVista === DETALLE_VISTA.USUARIOS ? "btn-primary" : "btn-outline-primary"}`}
                            onClick={() => {
                              setDetalleVista(DETALLE_VISTA.USUARIOS);
                              setDetalleCategoria("");
                              setDetalleSeccion("");
                              setDetallePage(1);
                            }}
                          >
                            Usuarios
                          </button>
                          <button
                            className={`btn ${detalleVista === DETALLE_VISTA.FINANZAS ? "btn-primary" : "btn-outline-primary"}`}
                            onClick={() => {
                              setDetalleVista(DETALLE_VISTA.FINANZAS);
                              setDetalleCategoria("");
                              setDetalleSeccion("");
                              setDetallePage(1);
                            }}
                          >
                            Finanzas
                          </button>
                        </div>
                        {detalleVista === DETALLE_VISTA.FINANZAS && (
                          <div className="btn-group btn-group-sm ms-md-2 mb-2">
                            <button
                              className={`btn ${detalleVistaFinanzas === DETALLE_FINANZAS_SUB.PAGOS ? "btn-success" : "btn-outline-success"}`}
                              onClick={() => {
                                setDetalleVistaFinanzas(DETALLE_FINANZAS_SUB.PAGOS);
                                setDetalleCategoria("");
                                setDetalleSeccion("");
                                setDetallePage(1);
                              }}
                            >
                              Pagos
                            </button>
                            <button
                              className={`btn ${detalleVistaFinanzas === DETALLE_FINANZAS_SUB.DEUDAS ? "btn-success" : "btn-outline-success"}`}
                              onClick={() => {
                                setDetalleVistaFinanzas(DETALLE_FINANZAS_SUB.DEUDAS);
                                setDetalleCategoria("");
                                setDetalleSeccion("");
                                setDetallePage(1);
                              }}
                            >
                              Deudas
                            </button>
                            <button
                              className={`btn ${detalleVistaFinanzas === DETALLE_FINANZAS_SUB.HISTORIAL ? "btn-success" : "btn-outline-success"}`}
                              onClick={() => {
                                setDetalleVistaFinanzas(DETALLE_FINANZAS_SUB.HISTORIAL);
                                setDetalleCategoria("");
                                setDetalleSeccion("");
                                setDetallePage(1);
                              }}
                            >
                              Historial
                            </button>
                          </div>
                        )}
                        <div className="small opacity-75">Vista actual: <strong>{etiquetaVistaDetalle}</strong></div>
                      </div>
                      <div className="row g-2 mb-2">
                        <div className="col-md-3">
                          <label className="form-label small mb-1">Categoria</label>
                          <select className={selectClass} value={detalleCategoria} onChange={(e) => setDetalleCategoria(e.target.value)}>
                            <option value="">Todas</option>
                            {categoriaOptions.map((cat) => (
                              <option key={cat.value} value={cat.value}>{cat.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-md-7">
                          <label className="form-label small mb-1">Buscar</label>
                          <input className={inputClass} value={detalleQ} onChange={(e) => setDetalleQ(e.target.value)} placeholder="Codigo, DNI, campo..." />
                        </div>
                        <div className="col-md-2 d-grid">
                          <label className="form-label small mb-1">&nbsp;</label>
                          <button className="btn btn-outline-primary" onClick={() => cargarDetalle(Number(corridaSeleccionada.id_corrida), 1)}><FaSearch className="me-1" /> Buscar</button>
                        </div>
                      </div>
                      <div className="table-responsive">
                        <table className={tableClass}>
                          <thead>
                            <tr>
                              <th>Tipo</th>
                              <th>ID</th>
                              <th>DNI</th>
                              <th>Columna Excel</th>
                              <th>Antiguo</th>
                              <th>Nuevo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cargandoDetalle ? (
                              <tr><td colSpan="6">Cargando detalle...</td></tr>
                            ) : detalleOrdenado.length === 0 ? (
                              <tr><td colSpan="6">Sin resultados.</td></tr>
                            ) : detalleOrdenado.map((d) => (
                              <tr key={d.id_detalle}>
                                <td><span className={`badge ${badgeClassByCategoria(d.categoria)}`}>{labelTipoDetalle(d)}</span></td>
                                <td>{resolveDetalleId(d)}</td>
                                <td>{d.dni_ruc || "-"}</td>
                                <td>{d.campo || "-"}</td>
                                <td>{d.valor_antiguo || "-"}</td>
                                <td>{d.valor_nuevo || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="d-flex justify-content-between align-items-center mt-2">
                        <small className="opacity-75">Total detalle: {detalleTotal}</small>
                        <div className="btn-group btn-group-sm">
                          <button className="btn btn-outline-secondary" disabled={detallePage <= 1} onClick={() => cargarDetalle(Number(corridaSeleccionada.id_corrida), detallePage - 1)}>Anterior</button>
                          <button className="btn btn-outline-secondary disabled">{detallePage}/{totalPagesDetalle}</button>
                          <button className="btn btn-outline-secondary" disabled={detallePage >= totalPagesDetalle} onClick={() => cargarDetalle(Number(corridaSeleccionada.id_corrida), detallePage + 1)}>Siguiente</button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className={cardClass}>Seleccione una corrida en Historial o ejecute una nueva comparacion.</div>
                )}
              </div>
            )}
          </div>

          <div className={`modal-footer ${darkMode ? "border-secondary" : ""}`}>
            <button type="button" className={`btn ${darkMode ? "btn-secondary" : "btn-dark"}`} onClick={cerrarModal}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalComparacionesLegacy;
