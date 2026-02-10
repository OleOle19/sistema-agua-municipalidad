import { useState, useEffect } from "react";
import api from "../api";

const ModalDeuda = ({ usuario, cerrarModal, alGuardar, darkMode }) => {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [cargando, setCargando] = useState(false);
  const tarifasBase = { agua: 7.5, desague: 3.5, limpieza: 3.5, admin: 0.5 };
  const [servicios, setServicios] = useState({
    agua: true,
    desague: true,
    limpieza: true,
    admin: true
  });

  const montos = {
    agua: servicios.agua ? tarifasBase.agua : 0,
    desague: servicios.desague ? tarifasBase.desague : 0,
    limpieza: servicios.limpieza ? tarifasBase.limpieza : 0,
    admin: servicios.admin ? tarifasBase.admin : 0
  };
  const totalServicios = Object.values(montos).reduce((sum, v) => sum + v, 0);

  const guardarDeuda = async () => {
    setCargando(true);
    try {
      if (totalServicios <= 0) {
        alert("Debe seleccionar al menos un servicio.");
        setCargando(false);
        return;
      }
      await api.post("/recibos", {
        id_contribuyente: usuario.id_contribuyente,
        anio: anio,
        mes: mes,
        montos
      });
      alert(`Deuda registrada correctamente para ${usuario.nombre_completo}`);
      alGuardar(); cerrarModal();
    } catch (error) { alert(error.response?.data?.error || "Error al registrar deuda"); } 
    finally { setCargando(false); }
  };

  // Estilos
  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-primary text-white"}`;
  const inputClass = `form-control ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const selectClass = `form-select ${darkMode ? "bg-dark text-white border-secondary" : ""}`;

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className="modal-title">Registrar Deuda Individual</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            <p className="mb-3">
              Contribuyente: <strong>{usuario.nombre_completo}</strong><br/>
              <span className="small opacity-75">Código: {usuario.codigo_municipal}</span>
            </p>

            <div className="row g-3">
              <div className="col-6">
                <label className="form-label">Año</label>
                <input type="number" className={inputClass} value={anio} onChange={(e) => setAnio(e.target.value)} />
              </div>
              <div className="col-6">
                <label className="form-label">Mes</label>
                <select className={selectClass} value={mes} onChange={(e) => setMes(e.target.value)}>
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                    <option key={m} value={m}>{["","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][m]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={`mt-3 border rounded p-2 ${darkMode ? "bg-dark border-secondary" : "bg-light"}`}>
              <div className="small fw-bold text-center text-primary">Servicios a Cobrar</div>
              <div className="d-flex align-items-center justify-content-between mt-2">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="svc-agua" checked={servicios.agua} onChange={() => setServicios(s => ({ ...s, agua: !s.agua }))} />
                  <label className="form-check-label" htmlFor="svc-agua">Agua Potable</label>
                </div>
                <span className={`fw-bold ${servicios.agua ? "" : "text-muted"}`}>S/ {tarifasBase.agua.toFixed(2)}</span>
              </div>
              <div className="d-flex align-items-center justify-content-between mt-1">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="svc-desague" checked={servicios.desague} onChange={() => setServicios(s => ({ ...s, desague: !s.desague }))} />
                  <label className="form-check-label" htmlFor="svc-desague">Desagüe</label>
                </div>
                <span className={`fw-bold ${servicios.desague ? "" : "text-muted"}`}>S/ {tarifasBase.desague.toFixed(2)}</span>
              </div>
              <div className="d-flex align-items-center justify-content-between mt-1">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="svc-limpieza" checked={servicios.limpieza} onChange={() => setServicios(s => ({ ...s, limpieza: !s.limpieza }))} />
                  <label className="form-check-label" htmlFor="svc-limpieza">Limpieza Pública</label>
                </div>
                <span className={`fw-bold ${servicios.limpieza ? "" : "text-muted"}`}>S/ {tarifasBase.limpieza.toFixed(2)}</span>
              </div>
              <div className="d-flex align-items-center justify-content-between mt-1">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="svc-admin" checked={servicios.admin} onChange={() => setServicios(s => ({ ...s, admin: !s.admin }))} />
                  <label className="form-check-label" htmlFor="svc-admin">Gastos Administrativos</label>
                </div>
                <span className={`fw-bold ${servicios.admin ? "" : "text-muted"}`}>S/ {tarifasBase.admin.toFixed(2)}</span>
              </div>
              <div className="text-end fw-bold mt-2">Total a cobrar: S/ {totalServicios.toFixed(2)}</div>
            </div>
          </div>
          <div className={`modal-footer ${darkMode ? "border-secondary" : ""}`}>
            <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cancelar</button>
            <button type="button" className="btn btn-success" onClick={guardarDeuda} disabled={cargando}>
              {cargando ? "Procesando..." : "Generar Recibo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalDeuda;

