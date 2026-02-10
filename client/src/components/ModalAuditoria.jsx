import { useState, useEffect } from "react";
import api from "../api";
import { FaShieldAlt, FaHistory } from "react-icons/fa";

const ModalAuditoria = ({ cerrarModal, darkMode }) => {
  const [logs, setLogs] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const cargarLogs = async () => {
      try {
        const res = await api.get("/auditoria");
        setLogs(res.data);
      } catch (error) {
        console.error("Error cargando auditoría");
      } finally {
        setCargando(false);
      }
    };
    cargarLogs();
  }, []);

  const formatFecha = (isoString) => {
    const date = new Date(isoString);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  };

  // Clases condicionales
  const modalContentClass = `modal-content ${darkMode ? "text-white" : ""}`;
  const modalContentStyle = darkMode ? { backgroundColor: "#2b3035", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-secondary text-white"}`;
  const closeBtnClass = `btn-close ${darkMode ? "btn-close-white" : ""}`;
  const tableClass = `table align-middle ${darkMode ? "table-dark table-hover" : "table-hover"}`;

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-lg">
        <div className={modalContentClass} style={modalContentStyle}>
          <div className={headerClass}>
            <h5 className="modal-title"><FaShieldAlt className="me-2"/> Bitácora de Seguridad y Auditoría</h5>
            <button type="button" className={closeBtnClass} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body p-0">
            <div className="table-responsive" style={{ maxHeight: "60vh" }}>
              <table className={tableClass}>
                <thead className={darkMode ? "" : "table-light"}>
                  <tr>
                    <th>Fecha / Hora</th>
                    <th>Usuario</th>
                    <th>Acción</th>
                    <th>Detalle del Evento</th>
                  </tr>
                </thead>
                <tbody>
                  {cargando ? (
                    <tr><td colSpan="4" className="text-center p-3">Cargando bitácora...</td></tr>
                  ) : logs.length === 0 ? (
                    <tr><td colSpan="4" className="text-center p-3">El sistema está inmaculado. No hay registros.</td></tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id_auditoria}>
                        <td style={{whiteSpace: 'nowrap'}}>{formatFecha(log.fecha)}</td>
                        <td className="fw-bold">{log.usuario}</td>
                        <td>
                          <span className={`badge ${log.accion.includes('ELIMINAR') ? 'bg-danger' : 'bg-success'}`}>
                            {log.accion}
                          </span>
                        </td>
                        <td className="small opacity-75">{log.detalle}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className={`modal-footer ${darkMode ? "border-secondary" : ""}`}>
            <button type="button" className={`btn ${darkMode ? "btn-secondary" : "btn-dark"}`} onClick={cerrarModal}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalAuditoria;
