import { useState, useEffect } from "react";
import api from "../api";
import { FaTrashAlt, FaExclamationTriangle } from "react-icons/fa";

const ModalEliminar = ({ usuario, cerrarModal, alGuardar, darkMode }) => {
  const [deudas, setDeudas] = useState([]);

  useEffect(() => {
    const cargarDeudas = async () => {
      try {
        const res = await api.get(`/recibos/pendientes/${usuario.id_contribuyente}`);
        setDeudas(res.data);
      } catch (error) { alert("Error cargando deudas"); }
    };
    cargarDeudas();
  }, [usuario]);

  const eliminarDeuda = async (id_recibo, mes, anio) => {
    if(!window.confirm(`¿ESTÁ SEGURO? Se borrará la deuda de ${mes}/${anio}.`)) return;
    try {
      await api.delete(`/recibos/${id_recibo}`);
      alert("Deuda eliminada."); alGuardar(); cerrarModal();
    } catch (error) { alert("Error al eliminar"); }
  };

  const nombreMes = (n) => ["","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][n];

  // Estilos
  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-danger text-white"}`;
  const listGroupItemClass = `list-group-item d-flex justify-content-between align-items-center ${darkMode ? "bg-dark text-white border-secondary" : ""}`;

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className="modal-title"><FaTrashAlt className="me-2"/> Eliminar Deudas / Usuario</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            
            <div className={`alert d-flex align-items-center ${darkMode ? "alert-dark border-secondary" : "alert-warning"}`}>
              <FaExclamationTriangle className="me-3 fs-4" />
              <small>Solo se pueden eliminar recibos PENDIENTES.</small>
            </div>

            <h6 className="mb-3">Contribuyente: <strong>{usuario.nombre_completo}</strong></h6>

            {deudas.length === 0 ? (
              <p className="text-muted text-center py-3">Este usuario no tiene deudas pendientes para eliminar.</p>
            ) : (
              <ul className="list-group">
                {deudas.map((recibo) => (
                  <li key={recibo.id_recibo} className={listGroupItemClass}>
                    <div>
                      <strong>{nombreMes(recibo.mes)} - {recibo.anio}</strong>
                      <div className="text-muted small">Monto: S/. {recibo.total_pagar}</div>
                    </div>
                    <button className="btn btn-outline-danger btn-sm" onClick={() => eliminarDeuda(recibo.id_recibo, nombreMes(recibo.mes), recibo.anio)}>
                      <FaTrashAlt /> Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={`modal-footer ${darkMode ? "border-secondary" : ""}`}>
            <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalEliminar;
