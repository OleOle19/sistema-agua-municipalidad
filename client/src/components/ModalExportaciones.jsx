import { Suspense, lazy, useState } from "react";
import { FaBalanceScale, FaDatabase, FaDownload, FaEye, FaFileAlt, FaFileExcel, FaFolderOpen, FaMoneyBillWave, FaUsers } from "react-icons/fa";
import api from "../api";

const ModalComparacionesLegacy = lazy(() => import("./ModalComparacionesLegacy"));

const ModalExportaciones = ({ cerrarModal, darkMode, onBackup }) => {
  const [exportando, setExportando] = useState("");
  const [mostrarComparaciones, setMostrarComparaciones] = useState(false);
  const [adjuntosSistema, setAdjuntosSistema] = useState([]);
  const [cargandoAdjuntos, setCargandoAdjuntos] = useState(false);
  const [mostrarAdjuntos, setMostrarAdjuntos] = useState(false);

  const formatBytes = (bytes) => {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "-";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  };

  const descargarArchivo = async ({
    key,
    endpoint,
    nombreBase,
    extension,
    mimeType
  }) => {
    try {
      setExportando(key);
      const res = await api.get(endpoint, {
        responseType: "blob",
        timeout: 0
      });
      const fecha = new Date().toISOString().slice(0, 10);
      const blob = new Blob([res.data], {
        type: mimeType
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nombreBase}_${fecha}.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert("No se pudo exportar el archivo.");
    } finally {
      setExportando("");
    }
  };

  const descargarBackup = async () => {
    if (!onBackup) return;
    try {
      setExportando("backup");
      await onBackup();
    } finally {
      setExportando("");
    }
  };

  const cargarAdjuntosSistema = async () => {
    try {
      setCargandoAdjuntos(true);
      const res = await api.get("/admin/adjuntos-sistema", {
        params: { limit: 120 },
        timeout: 0
      });
      setAdjuntosSistema(Array.isArray(res.data?.items) ? res.data.items : []);
      setMostrarAdjuntos(true);
    } catch (err) {
      alert(err?.response?.data?.error || "No se pudieron cargar los adjuntos del sistema.");
    } finally {
      setCargandoAdjuntos(false);
    }
  };

  const abrirAdjunto = async (item, inline = false) => {
    try {
      setExportando(`adjunto_${item?.id_archivo || 0}`);
      const res = await api.get(item.descarga_url, {
        responseType: "blob",
        timeout: 0
      });
      const mimeType = item?.archivo_mime || "application/octet-stream";
      const blob = new Blob([res.data], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      if (inline && /^image\/|^application\/pdf$/i.test(mimeType)) {
        window.open(url, "_blank", "noopener,noreferrer");
        window.setTimeout(() => window.URL.revokeObjectURL(url), 30000);
        return;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = item?.archivo_nombre || `adjunto_${item?.id_archivo || "sistema"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err?.response?.data?.error || "No se pudo abrir el adjunto.");
    } finally {
      setExportando("");
    }
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-primary text-white"}`;
  const closeBtnClass = `btn-close ${darkMode ? "btn-close-white" : "btn-close-white"}`;
  const bodyCardClass = darkMode ? "border-secondary bg-dark text-white" : "";
  const lazyModalFallback = (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
      <div className="modal-dialog">
        <div className={`modal-content ${darkMode ? "bg-dark text-white border-secondary" : ""}`}>
          <div className="modal-body py-4 text-center">
            <div className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></div>
            <span>Cargando comparador...</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className="modal-title"><FaDatabase className="me-2" /> Respaldos y Exportaciones</h5>
            <button type="button" className={closeBtnClass} onClick={cerrarModal}></button>
          </div>

          <div className="modal-body">
            <p className="small mb-3">
              Selecciona el tipo de respaldo o exportacion que deseas generar.
            </p>

            <div className={`border rounded p-3 mb-3 ${bodyCardClass}`}>
              <div className="fw-bold mb-1 d-flex align-items-center gap-2">
                <FaDatabase /> Copia de seguridad SQL
              </div>
              <div className="small opacity-75 mb-2">
                Genera un respaldo completo de la base de datos en archivo .sql.
              </div>
              <button
                type="button"
                className="btn btn-info btn-sm text-white"
                disabled={exportando !== ""}
                onClick={descargarBackup}
              >
                <FaDatabase className="me-2" />
                {exportando === "backup" ? "Generando..." : "Descargar Backup SQL"}
              </button>
            </div>

            <div className={`border rounded p-3 mb-3 ${bodyCardClass}`}>
              <div className="fw-bold mb-1 d-flex align-items-center gap-2">
                <FaUsers /> Usuarios completos
              </div>
              <div className="small opacity-75 mb-2">
                Exporta padron completo con codigos, DNI/RUC, calle, direccion y datos del predio.
              </div>
              <button
                type="button"
                className="btn btn-success btn-sm"
                disabled={exportando !== ""}
                onClick={() => descargarArchivo({
                  key: "usuarios",
                  endpoint: "/exportar/usuarios-completo",
                  nombreBase: "usuarios_completo",
                  extension: "xlsx",
                  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                })}
              >
                <FaFileExcel className="me-2" />
                {exportando === "usuarios" ? "Exportando..." : "Exportar Usuarios"}
              </button>
            </div>

            <div className={`border rounded p-3 ${bodyCardClass}`}>
              <div className="fw-bold mb-1 d-flex align-items-center gap-2">
                <FaMoneyBillWave /> Pagos, deudas e historial
              </div>
              <div className="small opacity-75 mb-2">
                Exporta finanzas en Excel (3 hojas) o en TXT estilo legacy para comparacion externa.
              </div>
              <div className="d-flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={exportando !== ""}
                  onClick={() => descargarArchivo({
                    key: "finanzas",
                    endpoint: "/exportar/finanzas-completo",
                    nombreBase: "finanzas_completo",
                    extension: "xlsx",
                    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  })}
                >
                  <FaFileExcel className="me-2" />
                  {exportando === "finanzas" ? "Exportando..." : "Exportar Finanzas"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  disabled={exportando !== ""}
                  onClick={() => descargarArchivo({
                    key: "finanzas_txt",
                    endpoint: "/exportar/finanzas-completo.txt",
                    nombreBase: "finanzas_completo_legacy",
                    extension: "txt",
                    mimeType: "text/plain;charset=utf-8"
                  })}
                >
                  <FaFileAlt className="me-2" />
                  {exportando === "finanzas_txt" ? "Exportando..." : "Exportar TXT"}
                </button>
              </div>
            </div>

            <div className={`border rounded p-3 mt-3 ${bodyCardClass}`}>
              <div className="fw-bold mb-1 d-flex align-items-center gap-2">
                <FaBalanceScale /> Comparacion Base Antigua vs Actual
              </div>
              <div className="small opacity-75 mb-2">
                Sube la base legacy (plantilla fija), compara padron/deuda/recaudacion y guarda historial auditable.
              </div>
              <button
                type="button"
                className="btn btn-warning btn-sm"
                disabled={exportando !== ""}
                onClick={() => setMostrarComparaciones(true)}
              >
                <FaBalanceScale className="me-2" />
                Abrir Comparador
              </button>
            </div>

            <div className={`border rounded p-3 mt-3 ${bodyCardClass}`}>
              <div className="fw-bold mb-1 d-flex align-items-center gap-2">
                <FaFolderOpen /> Adjuntos del sistema
              </div>
              <div className="small opacity-75 mb-2">
                Muestra evidencias de corte y archivos adjuntos de contribuyentes sin entrar a carpetas del servidor.
              </div>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                disabled={exportando !== "" || cargandoAdjuntos}
                onClick={cargarAdjuntosSistema}
              >
                <FaFolderOpen className="me-2" />
                {cargandoAdjuntos ? "Cargando..." : "Ver Adjuntos"}
              </button>

              {mostrarAdjuntos && (
                <div className="table-responsive mt-3" style={{ maxHeight: "260px" }}>
                  <table className={`table table-sm mb-0 ${darkMode ? "table-dark" : "table-striped"}`}>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Origen</th>
                        <th>Codigo</th>
                        <th>Nombre</th>
                        <th>Archivo</th>
                        <th>Tamano</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adjuntosSistema.length === 0 ? (
                        <tr><td colSpan="7" className="text-center py-3">Sin adjuntos registrados.</td></tr>
                      ) : adjuntosSistema.map((item) => (
                        <tr key={`${item.origen}-${item.id_archivo}`}>
                          <td>{item.creado_en ? new Date(item.creado_en).toLocaleString("es-PE") : "-"}</td>
                          <td>{item.origen === "CORTE_EVIDENCIA" ? "Corte" : "Contribuyente"}</td>
                          <td>{item.codigo_municipal || "-"}</td>
                          <td>{item.nombre_completo || "-"}</td>
                          <td>
                            <div>{item.archivo_nombre || "-"}</div>
                            <div className="small opacity-75">{item.tipo_contexto || "-"}</div>
                          </td>
                          <td>{formatBytes(item.archivo_bytes)}</td>
                          <td>
                            <div className="d-flex gap-1">
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm"
                                disabled={exportando !== ""}
                                onClick={() => abrirAdjunto(item, true)}
                                title="Abrir"
                              >
                                <FaEye />
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm"
                                disabled={exportando !== ""}
                                onClick={() => abrirAdjunto(item, false)}
                                title="Descargar"
                              >
                                <FaDownload />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className={`modal-footer ${darkMode ? "border-secondary" : ""}`}>
            <button type="button" className={`btn ${darkMode ? "btn-secondary" : "btn-dark"}`} onClick={cerrarModal}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
      {mostrarComparaciones && (
        <Suspense fallback={lazyModalFallback}>
          <ModalComparacionesLegacy
            cerrarModal={() => setMostrarComparaciones(false)}
            darkMode={darkMode}
          />
        </Suspense>
      )}
    </div>
  );
};

export default ModalExportaciones;
