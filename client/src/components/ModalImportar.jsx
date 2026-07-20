import { useState } from "react";
import { FaFileUpload, FaFileExcel, FaFileCode, FaHistory } from "react-icons/fa";
import api from "../api";

const TIPOS_IMPORTACION = {
  padron: {
    titulo: "Padron",
    endpoint: "/importar/padron",
    accept: ".xml,.xlsx,.xls,.csv",
    ayuda: [
      { icono: <FaFileCode className="me-1" />, titulo: "XML (recomendado)", detalle: "formato municipal." },
      { icono: <FaFileExcel className="me-1" />, titulo: "Excel/CSV", detalle: "actualizaciones masivas de contribuyentes." }
    ],
    procesando: "Procesando padron y actualizando contribuyentes..."
  },
  historial: {
    titulo: "Historial Deudas/Pagos",
    endpoint: "/importar/historial",
    accept: ".txt,.csv,.xlsx,.xls",
    ayuda: [
      { icono: <FaHistory className="me-1" />, titulo: "TXT/CSV", detalle: "historial de deudas y pagos (ej. CATORCE.txt)." },
      { icono: <FaFileExcel className="me-1" />, titulo: "Excel (XLSX)", detalle: "recomendado para reemplazar historial antiguo. Columna CONTRIBUYENTE acepta codigo municipal o nombre exacto. Orden esperado: CONTRIBUYENTE, FECHA, ANIO/AÑO, MES, AGUA, DESAGUE, LIMPIEZA, ADMINISTRACION o GASTOS ADMINISTRATIVOS, EXTRAS, ABONO, TOTAL. Si FECHA viene llena, se respeta como fecha real de pago." }
    ],
    procesando: "Importando historial de deudas y pagos (puede tardar varios minutos)..."
  }
};

const ModalImportar = ({ cerrarModal, alTerminar }) => {
  const [tipo, setTipo] = useState("padron");
  const [archivo, setArchivo] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [rechazos, setRechazos] = useState([]);
  const [resumenRechazos, setResumenRechazos] = useState({});
  const [totalRechazados, setTotalRechazados] = useState(0);
  const [rechazosMostrados, setRechazosMostrados] = useState(0);
  const [filtroRechazo, setFiltroRechazo] = useState("todos");
  const [omitidos, setOmitidos] = useState([]);
  const [resumenOmitidos, setResumenOmitidos] = useState({});
  const [totalOmitidosSinRechazo, setTotalOmitidosSinRechazo] = useState(0);
  const [filtroOmitido, setFiltroOmitido] = useState("todos");

  const conf = TIPOS_IMPORTACION[tipo];

  const handleSubir = async (e) => {
    e.preventDefault();
    if (!archivo) {
      alert("Selecciona un archivo");
      return;
    }

    const formData = new FormData();
    formData.append("archivo", archivo);

    setCargando(true);
    setMensaje(conf.procesando);
    setRechazos([]);
    setResumenRechazos({});
    setTotalRechazados(0);
    setRechazosMostrados(0);
    setFiltroRechazo("todos");
    setOmitidos([]);
    setResumenOmitidos({});
    setTotalOmitidosSinRechazo(0);
    setFiltroOmitido("todos");

    try {
      const res = await api.post(conf.endpoint, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 0
      });

      const datos = res.data || {};
      setRechazos(Array.isArray(datos.rechazos) ? datos.rechazos : []);
      setResumenRechazos(datos.resumen_rechazos || {});
      setTotalRechazados(Number(datos.total_rechazados || 0));
      setRechazosMostrados(Number(datos.rechazos_mostrados || (Array.isArray(datos.rechazos) ? datos.rechazos.length : 0)));
      setOmitidos(Array.isArray(datos.omitidos) ? datos.omitidos : []);
      setResumenOmitidos(datos.resumen_omitidos || {});
      setTotalOmitidosSinRechazo(Number(datos.total_omitidos_sin_rechazo || 0));

      if (tipo === "historial") {
        const resumen = `Recibos: ${datos.total_recibos_procesados ?? 0} | Pagos: ${datos.total_pagos_registrados ?? 0} | Leidas: ${datos.lineas_leidas ?? 0} | Omitidas: ${datos.lineas_omitidas ?? 0} | Rechazadas: ${datos.total_rechazados ?? 0}`;
        setMensaje(`${datos.mensaje || "Historial importado correctamente."}\n${resumen}`);
      } else {
        const resumen = `Recibidos: ${datos.total_recibidos ?? 0} | Importados: ${datos.total_importados ?? 0} | Rechazados: ${datos.total_rechazados ?? 0}`;
        setMensaje(`${datos.mensaje || "Importacion completada."}\n${resumen}`);
      }

      alTerminar();
    } catch (error) {
      const detalle = error.response?.data?.error || error.message;
      setMensaje(`Error al importar: ${detalle}`);
    } finally {
      setCargando(false);
    }
  };

  const modalStyle = {};
  const headerClass = "modal-header bg-success text-white";
  const inputClass = "form-control";
  const tabClass = (key) => `btn btn-sm ${tipo === key ? "btn-primary" : "btn-outline-secondary"}`;
  const alertClass = mensaje.startsWith("Error") ? "alert-danger" : "alert-success";
  const resumenItems = Object.entries(resumenRechazos || {}).filter(([, val]) => Number(val) > 0);
  const rechazosFiltrados = filtroRechazo === "todos"
    ? rechazos
    : rechazos.filter((item) => item?.tipo === filtroRechazo);
  const resumenOmitidosItems = Object.entries(resumenOmitidos || {}).filter(([, val]) => Number(val) > 0);
  const omitidosFiltrados = filtroOmitido === "todos"
    ? omitidos
    : omitidos.filter((item) => item?.tipo === filtroOmitido);

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className="modal-title">Importacion de Datos</h5>
            <button type="button" className="btn-close btn-close-white" onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            <div className="d-flex gap-2 mb-3">
              <button
                type="button"
                className={tabClass("padron")}
                disabled={cargando}
                onClick={() => {
                  setTipo("padron");
                  setArchivo(null);
                  setMensaje("");
                  setRechazos([]);
                  setResumenRechazos({});
                  setTotalRechazados(0);
                  setRechazosMostrados(0);
                  setFiltroRechazo("todos");
                  setOmitidos([]);
                  setResumenOmitidos({});
                  setTotalOmitidosSinRechazo(0);
                  setFiltroOmitido("todos");
                }}
              >
                Padron
              </button>
              <button
                type="button"
                className={tabClass("historial")}
                disabled={cargando}
                onClick={() => {
                  setTipo("historial");
                  setArchivo(null);
                  setMensaje("");
                  setRechazos([]);
                  setResumenRechazos({});
                  setTotalRechazados(0);
                  setRechazosMostrados(0);
                  setFiltroRechazo("todos");
                  setOmitidos([]);
                  setResumenOmitidos({});
                  setTotalOmitidosSinRechazo(0);
                  setFiltroOmitido("todos");
                }}
              >
                Historial
              </button>
            </div>

            <div className="alert alert-info small">
              <strong>{conf.titulo}:</strong>
              <ul className="mb-0 ps-3 mt-1">
                {conf.ayuda.map((item, idx) => (
                  <li key={idx}>{item.icono}<strong>{item.titulo}:</strong> {item.detalle}</li>
                ))}
              </ul>
            </div>

            {tipo === "historial" && (
              <div className="alert alert-warning small">
                <strong>Reemplazo de pagos antiguos:</strong> si el Excel trae un mismo contribuyente y periodo ya existente, el importador reemplaza pagos de ese periodo y actualiza el recibo. Igual haz respaldo antes de una carga historica grande, sobre todo si vas a rehacer meses completos.
              </div>
            )}

            <form onSubmit={handleSubir}>
              <div className="mb-3">
                <label className="form-label fw-bold">Seleccionar Archivo</label>
                <input
                  key={tipo}
                  type="file"
                  className={inputClass}
                  accept={conf.accept}
                  onChange={(e) => setArchivo(e.target.files?.[0] || null)}
                  required
                />
              </div>

              {mensaje && (
                <div className={`alert ${alertClass} small`} style={{ whiteSpace: "pre-line" }}>
                  {mensaje}
                </div>
              )}

              {totalRechazados > 0 && (
                <div className="border border-warning rounded p-2 mb-3 small">
                  <div className="fw-bold mb-1">Registros no importados: {totalRechazados}</div>
                  {resumenItems.length > 0 && (
                    <div className="mb-2">
                      <button
                        type="button"
                        className={`btn btn-sm me-1 mb-1 ${filtroRechazo === "todos" ? "btn-primary" : "btn-outline-secondary"}`}
                        onClick={() => setFiltroRechazo("todos")}
                      >
                        todos: {totalRechazados}
                      </button>
                      {resumenItems.map(([k, v]) => (
                        <button
                          key={k}
                          type="button"
                          className={`btn btn-sm me-1 mb-1 ${filtroRechazo === k ? "btn-primary" : "btn-outline-secondary"}`}
                          onClick={() => setFiltroRechazo(k)}
                        >
                          {k}: {v}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="table-responsive" style={{ maxHeight: "420px" }}>
                    <table className="table table-sm table-striped mb-0">
                      <thead>
                        <tr>
                          <th>Linea</th>
                          <th>Codigo/Nombre</th>
                          <th>Periodo</th>
                          <th>Tipo</th>
                          <th>Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rechazosFiltrados.length === 0 ? (
                          <tr><td colSpan="5">Sin detalle disponible.</td></tr>
                        ) : rechazosFiltrados.map((r, idx) => {
                          const periodo = (r.anio && r.mes) ? `${String(r.mes).padStart(2, "0")}/${r.anio}` : "-";
                          return (
                            <tr key={`${r.linea || "x"}-${idx}`}>
                              <td>{r.linea || "-"}</td>
                              <td>{r.codigo_municipal || "-"}</td>
                              <td>{periodo}</td>
                              <td>{r.tipo || "-"}</td>
                              <td>{r.motivo || "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {rechazosMostrados < totalRechazados && (
                    <div className="text-muted mt-2">
                      Mostrando {rechazosMostrados} de {totalRechazados} rechazados.
                    </div>
                  )}
                  {rechazosFiltrados.length > 0 && (
                    <div className="text-muted mt-2">
                      Viendo {rechazosFiltrados.length} registros del filtro actual.
                    </div>
                  )}
                </div>
              )}

              {totalOmitidosSinRechazo > 0 && (
                <div className="border border-info rounded p-2 mb-3 small">
                  <div className="fw-bold mb-1">Registros omitidos sin rechazo: {totalOmitidosSinRechazo}</div>
                  {resumenOmitidosItems.length > 0 && (
                    <div className="mb-2">
                      <button
                        type="button"
                        className={`btn btn-sm me-1 mb-1 ${filtroOmitido === "todos" ? "btn-primary" : "btn-outline-secondary"}`}
                        onClick={() => setFiltroOmitido("todos")}
                      >
                        todos: {totalOmitidosSinRechazo}
                      </button>
                      {resumenOmitidosItems.map(([k, v]) => (
                        <button
                          key={k}
                          type="button"
                          className={`btn btn-sm me-1 mb-1 ${filtroOmitido === k ? "btn-primary" : "btn-outline-secondary"}`}
                          onClick={() => setFiltroOmitido(k)}
                        >
                          {k}: {v}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="table-responsive" style={{ maxHeight: "260px" }}>
                    <table className="table table-sm table-striped mb-0">
                      <thead>
                        <tr>
                          <th>Linea</th>
                          <th>Codigo/Nombre</th>
                          <th>Periodo</th>
                          <th>Tipo</th>
                          <th>Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {omitidosFiltrados.length === 0 ? (
                          <tr><td colSpan="5">Sin detalle disponible.</td></tr>
                        ) : omitidosFiltrados.map((r, idx) => {
                          const periodo = (r.anio && r.mes) ? `${String(r.mes).padStart(2, "0")}/${r.anio}` : "-";
                          return (
                            <tr key={`${r.linea || "o"}-${idx}`}>
                              <td>{r.linea || "-"}</td>
                              <td>{r.codigo_municipal || "-"}</td>
                              <td>{periodo}</td>
                              <td>{r.tipo || "-"}</td>
                              <td>{r.motivo || "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {omitidosFiltrados.length > 0 && (
                    <div className="text-muted mt-2">
                      Viendo {omitidosFiltrados.length} registros del filtro actual.
                    </div>
                  )}
                </div>
              )}

              <div className="d-flex justify-content-end gap-2">
                <button type="button" className="btn btn-secondary" onClick={cerrarModal} disabled={cargando}>Cancelar</button>
                <button type="submit" className="btn btn-success fw-bold" disabled={cargando}>
                  {cargando ? "Importando..." : <><FaFileUpload className="me-2" /> Iniciar Carga</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalImportar;
