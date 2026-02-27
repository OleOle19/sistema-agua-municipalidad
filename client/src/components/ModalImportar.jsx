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
    accept: ".txt,.csv",
    ayuda: [
      { icono: <FaHistory className="me-1" />, titulo: "TXT/CSV", detalle: "historial de deudas y pagos (ej. CATORCE.txt)." }
    ],
    procesando: "Importando historial de deudas y pagos (puede tardar varios minutos)..."
  },
  verificacion: {
    titulo: "Verificacion Campo",
    endpoint: "/importar/verificacion-campo",
    accept: ".xlsx,.xls,.csv",
    ayuda: [
      { icono: <FaFileExcel className="me-1" />, titulo: "Plantilla de campo", detalle: "archivo de brigada para actualizar datos y estado de conexion." }
    ],
    procesando: "Importando verificacion de campo..."
  }
};

const ModalImportar = ({ cerrarModal, alTerminar, darkMode }) => {
  const [tipo, setTipo] = useState("padron");
  const [archivo, setArchivo] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [rechazos, setRechazos] = useState([]);
  const [resumenRechazos, setResumenRechazos] = useState({});
  const [totalRechazados, setTotalRechazados] = useState(0);
  const [rechazosMostrados, setRechazosMostrados] = useState(0);

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

      if (tipo === "historial") {
        const resumen = `Recibos: ${datos.total_recibos_procesados ?? 0} | Pagos: ${datos.total_pagos_registrados ?? 0} | Leidas: ${datos.lineas_leidas ?? 0} | Omitidas: ${datos.lineas_omitidas ?? 0} | Rechazadas: ${datos.total_rechazados ?? 0}`;
        setMensaje(`${datos.mensaje || "Historial importado correctamente."}\n${resumen}`);
      } else if (tipo === "verificacion") {
        const resumen = `Recibidos: ${datos.total_recibidos ?? 0} | Actualizados: ${datos.total_importados ?? 0} | Eventos estado: ${datos.total_eventos_estado ?? 0} | Rechazados: ${datos.total_rechazados ?? 0}`;
        setMensaje(`${datos.mensaje || "Verificacion importada correctamente."}\n${resumen}`);
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

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-success text-white"}`;
  const inputClass = `form-control ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const tabClass = (key) => `btn btn-sm ${tipo === key ? "btn-primary" : (darkMode ? "btn-outline-light" : "btn-outline-secondary")}`;
  const alertClass = mensaje.startsWith("Error") ? "alert-danger" : "alert-success";
  const resumenItems = Object.entries(resumenRechazos || {}).filter(([, val]) => Number(val) > 0);

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className="modal-title">Importacion de Datos</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : "btn-close-white"}`} onClick={cerrarModal}></button>
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
                }}
              >
                Historial
              </button>
              <button
                type="button"
                className={tabClass("verificacion")}
                disabled={cargando}
                onClick={() => {
                  setTipo("verificacion");
                  setArchivo(null);
                  setMensaje("");
                  setRechazos([]);
                  setResumenRechazos({});
                  setTotalRechazados(0);
                  setRechazosMostrados(0);
                }}
              >
                Verificacion Campo
              </button>
            </div>

            <div className={`alert small ${darkMode ? "alert-dark border-secondary" : "alert-info"}`}>
              <strong>{conf.titulo}:</strong>
              <ul className="mb-0 ps-3 mt-1">
                {conf.ayuda.map((item, idx) => (
                  <li key={idx}>{item.icono}<strong>{item.titulo}:</strong> {item.detalle}</li>
                ))}
              </ul>
            </div>

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
                <div className={`border rounded p-2 mb-3 small ${darkMode ? "border-warning text-light" : "border-warning"}`}>
                  <div className="fw-bold mb-1">Registros no importados: {totalRechazados}</div>
                  {resumenItems.length > 0 && (
                    <div className="mb-2">
                      {resumenItems.map(([k, v]) => (
                        <span key={k} className="badge text-bg-secondary me-1 mb-1">{k}: {v}</span>
                      ))}
                    </div>
                  )}
                  <div className="table-responsive" style={{ maxHeight: "220px" }}>
                    <table className={`table table-sm mb-0 ${darkMode ? "table-dark" : "table-striped"}`}>
                      <thead>
                        <tr>
                          <th>Linea</th>
                          <th>Codigo</th>
                          <th>Periodo</th>
                          <th>Tipo</th>
                          <th>Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rechazos.length === 0 ? (
                          <tr><td colSpan="5">Sin detalle disponible.</td></tr>
                        ) : rechazos.map((r, idx) => {
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
