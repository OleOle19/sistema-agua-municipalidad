import { useState, useEffect, useCallback } from "react";
import api from "../api";
import { FaTrashAlt, FaExclamationTriangle } from "react-icons/fa";
import { confirmAction } from "../utils/confirmAction";

const ModalEliminar = ({ usuario, cerrarModal, alGuardar, onFlash = null }) => {
  const [deudas, setDeudas] = useState([]);

  const showFlash = useCallback((type, text) => {
    if (typeof onFlash === "function") onFlash(type, text);
  }, [onFlash]);

  useEffect(() => {
    const cargarDeudas = async () => {
      try {
        const res = await api.get(`/recibos/pendientes/${usuario.id_contribuyente}`);
        setDeudas(res.data);
      } catch {
        showFlash("danger", "Error cargando deudas.");
      }
    };
    cargarDeudas();
  }, [showFlash, usuario]);

  const eliminarDeuda = async (id_recibo, mes, anio) => {
    if (!await confirmAction(
      `Se borrará la deuda de ${mes}/${anio}. Esta acción no se puede deshacer.`,
      { title: "Eliminar deuda", confirmLabel: "Eliminar", variant: "danger" }
    )) return;
    try {
      await api.delete(`/recibos/${id_recibo}`);
      setDeudas((prev) => prev.filter((recibo) => Number(recibo.id_recibo) !== Number(id_recibo)));
      showFlash("success", `Deuda eliminada: ${mes}/${anio}.`);
      alGuardar();
    } catch {
      showFlash("danger", "Error al eliminar la deuda.");
    }
  };

  const nombreMes = (n) => ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][n];

  const deudasPendientes = deudas.filter((recibo) => recibo.estado === "PENDIENTE");

  const modalStyle = {};
  const headerClass = "modal-header bg-danger text-white";
  const listGroupItemClass = "list-group-item d-flex justify-content-between align-items-center";

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className="modal-title"><FaTrashAlt className="me-2" /> Eliminar Deudas / Usuario</h5>
            <button type="button" className="btn-close btn-close-white" onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            <div className="alert alert-warning d-flex align-items-center">
              <FaExclamationTriangle className="me-3 fs-4" />
              <small>Solo se pueden eliminar recibos PENDIENTES.</small>
            </div>

            <h6 className="mb-3">Contribuyente: <strong>{usuario.nombre_completo}</strong></h6>

            {deudasPendientes.length === 0 ? (
              <p className="text-muted text-center py-3">Este usuario no tiene deudas pendientes para eliminar.</p>
            ) : (
              <ul className="list-group">
                {deudasPendientes.map((recibo) => (
                  <li key={recibo.id_recibo} className={listGroupItemClass}>
                    <div>
                      <strong>{nombreMes(recibo.mes)} - {recibo.anio}</strong>
                      <div className="text-muted small">Monto: S/. {recibo.deuda_mes ?? recibo.total_pagar}</div>
                    </div>
                    <button className="btn btn-outline-danger btn-sm" onClick={() => eliminarDeuda(recibo.id_recibo, nombreMes(recibo.mes), recibo.anio)}>
                      <FaTrashAlt /> Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalEliminar;
