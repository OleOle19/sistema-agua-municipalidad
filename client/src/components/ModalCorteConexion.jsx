import { useMemo, useState } from "react";
import { FaPlug, FaSearch, FaUpload } from "react-icons/fa";
import { compareByDireccionAsc } from "../utils/cortesAddress";

const ESTADOS_CONEXION = {
  CON_CONEXION: "CON_CONEXION",
  SIN_CONEXION: "SIN_CONEXION",
  CORTADO: "CORTADO"
};

const normalizeEstadoConexion = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (["CON_CONEXION", "CONEXION", "CONECTADO", "ACTIVO"].includes(raw)) return ESTADOS_CONEXION.CON_CONEXION;
  if (["SIN_CONEXION", "SIN CONEXION", "SIN_SERVICIO", "NO_CONECTADO", "INACTIVO"].includes(raw)) return ESTADOS_CONEXION.SIN_CONEXION;
  if (["CORTADO", "CORTE", "SUSPENDIDO", "SUSPENSION"].includes(raw)) return ESTADOS_CONEXION.CORTADO;
  return ESTADOS_CONEXION.CON_CONEXION;
};

const ModalCorteConexion = ({
  cerrarModal,
  contribuyentes = [],
  loading = false,
  onConfirmar,
  darkMode
}) => {
  const [busqueda, setBusqueda] = useState("");
  const [idSeleccionado, setIdSeleccionado] = useState(null);
  const [motivo, setMotivo] = useState("Corte de servicio registrado en oficina.");
  const [evidencias, setEvidencias] = useState([]);

  const base = useMemo(() => {
    const rows = Array.isArray(contribuyentes) ? contribuyentes : [];
    return rows
      .filter((item) => normalizeEstadoConexion(item?.estado_conexion) === ESTADOS_CONEXION.CON_CONEXION)
      .slice()
      .sort(compareByDireccionAsc);
  }, [contribuyentes]);

  const filtrados = useMemo(() => {
    const q = String(busqueda || "").trim().toLowerCase();
    if (!q) return base;
    return base.filter((item) => {
      const nombre = String(item?.nombre_completo || "").toLowerCase();
      const codigo = String(item?.codigo_municipal || "").toLowerCase();
      const dni = String(item?.dni_ruc || "").toLowerCase();
      const direccion = String(item?.direccion_completa || "").toLowerCase();
      return nombre.includes(q) || codigo.includes(q) || dni.includes(q) || direccion.includes(q);
    });
  }, [base, busqueda]);

  const contribuyenteSeleccionado = useMemo(
    () => base.find((item) => Number(item.id_contribuyente) === Number(idSeleccionado)) || null,
    [base, idSeleccionado]
  );

  const eliminarEvidencia = (idx) => {
    setEvidencias((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleFiles = (event) => {
    const files = Array.from(event?.target?.files || []);
    setEvidencias(files);
  };

  const confirmar = () => {
    const idContribuyente = Number(idSeleccionado);
    const motivoFinal = String(motivo || "").trim();
    if (!Number.isInteger(idContribuyente) || idContribuyente <= 0) {
      alert("Seleccione un contribuyente con conexión.");
      return;
    }
    if (!motivoFinal) {
      alert("Debe ingresar el motivo del corte.");
      return;
    }
    if (!Array.isArray(evidencias) || evidencias.length === 0) {
      alert("Debe adjuntar al menos una evidencia (PDF o imagen).");
      return;
    }
    onConfirmar?.({
      id_contribuyente: idContribuyente,
      motivo: motivoFinal,
      evidencias
    });
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff" } : {};
  const inputClass = darkMode ? "form-control bg-dark text-white border-secondary" : "form-control";
  const textareaClass = darkMode ? "form-control bg-dark text-white border-secondary" : "form-control";

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content" style={modalStyle}>
          <div className="modal-header">
            <h5 className="modal-title"><FaPlug className="me-2" /> Registrar Corte con Evidencia</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal} />
          </div>

          <div className="modal-body">
            <div className="input-group mb-3">
              <span className="input-group-text"><FaSearch /></span>
              <input
                type="text"
                className={inputClass}
                placeholder="Buscar por nombre, código, DNI o dirección..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                autoFocus
              />
            </div>

            <div className="table-responsive border rounded mb-3" style={{ maxHeight: "260px" }}>
              <table className={`table table-sm mb-0 ${darkMode ? "table-dark" : "table-hover"}`}>
                <thead>
                  <tr>
                    <th>Codigo</th>
                    <th>Contribuyente</th>
                    <th>DNI</th>
                    <th>Direccion</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="text-center py-3">No hay contribuyentes con conexión para este filtro.</td>
                    </tr>
                  ) : (
                    filtrados.map((item) => {
                      const activo = Number(item.id_contribuyente) === Number(idSeleccionado);
                      return (
                        <tr
                          key={item.id_contribuyente}
                          className={activo ? "table-primary" : ""}
                          style={{ cursor: "pointer" }}
                          onClick={() => setIdSeleccionado(Number(item.id_contribuyente))}
                        >
                          <td className="fw-bold">{item.codigo_municipal}</td>
                          <td>{item.nombre_completo}</td>
                          <td>{item.dni_ruc || "-"}</td>
                          <td>{item.direccion_completa}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="mb-2 small">
              Seleccionado:{" "}
              <strong>
                {contribuyenteSeleccionado
                  ? `${contribuyenteSeleccionado.codigo_municipal} - ${contribuyenteSeleccionado.nombre_completo}`
                  : "Ninguno"}
              </strong>
            </div>

            <div className="mb-3">
              <label className="form-label fw-bold">Motivo</label>
              <textarea
                className={textareaClass}
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Detalle del motivo del corte"
              />
            </div>

            <div className="mb-2">
              <label className="form-label fw-bold d-flex align-items-center gap-2">
                <FaUpload /> Evidencias (PDF, fotos, documentos)
              </label>
              <input
                type="file"
                className={inputClass}
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.doc,.docx,image/*,application/pdf"
                onChange={handleFiles}
              />
              <div className="form-text">Las evidencias quedan guardadas en el servidor municipal para auditoria del corte.</div>
            </div>

            {evidencias.length > 0 && (
              <div className="border rounded p-2">
                <div className="small fw-bold mb-1">Archivos adjuntos ({evidencias.length})</div>
                {evidencias.map((file, idx) => (
                  <div key={`${file.name}-${idx}`} className="d-flex align-items-center small border-bottom py-1">
                    <span className="text-truncate">{file.name}</span>
                    <span className="ms-auto text-muted">{Math.round((Number(file.size || 0) / 1024) * 10) / 10} KB</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-link text-danger ms-2 p-0"
                      onClick={() => eliminarEvidencia(idx)}
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={cerrarModal} disabled={loading}>Cancelar</button>
            <button type="button" className="btn btn-danger" onClick={confirmar} disabled={loading}>
              {loading ? "Registrando..." : "Registrar Corte"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalCorteConexion;
