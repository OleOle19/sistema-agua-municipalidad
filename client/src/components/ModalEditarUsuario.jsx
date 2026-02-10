import { useState, useEffect } from "react";
import api from "../api";

const ModalEditarUsuario = ({ usuario, cerrarModal, alGuardar, darkMode }) => {
  const [formData, setFormData] = useState({
    nombre_completo: "", codigo_municipal: "", dni_ruc: "", telefono: "",
    id_calle: "", numero_casa: "", manzana: "", lote: ""
  });
  
  const [calles, setCalles] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const cargarDatos = async () => {
      try {
        const resCalles = await api.get("/calles");
        setCalles(resCalles.data);
        const resDetalle = await api.get(`/contribuyentes/detalle/${usuario.id_contribuyente}`);
        const u = resDetalle.data;
        setFormData({
          nombre_completo: u.nombre_completo || "", codigo_municipal: u.codigo_municipal || "", dni_ruc: u.dni_ruc || "", telefono: u.telefono || "",
          id_calle: u.id_calle || "", numero_casa: u.numero_casa || "", manzana: u.manzana || "", lote: u.lote || ""
        });
        setCargando(false);
      } catch (error) { cerrarModal(); }
    };
    cargarDatos();
  }, [usuario]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/contribuyentes/${usuario.id_contribuyente}`, formData);
      alert("Usuario actualizado"); alGuardar(); cerrarModal();
    } catch (error) { alert("Error al actualizar"); }
  };

  // Estilos
  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-warning"}`;
  const inputClass = `form-control ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const selectClass = `form-select ${darkMode ? "bg-dark text-white border-secondary" : ""}`;

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className={`modal-title ${darkMode ? "" : "text-dark"}`}>Editar Datos del Contribuyente</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            {cargando ? <p>Cargando...</p> : (
              <form onSubmit={handleSubmit}>
                <h6 className={`border-bottom pb-2 mb-3 ${darkMode ? "border-secondary" : "text-primary"}`}>Información Personal</h6>
                <div className="row g-3 mb-3">
                  <div className="col-md-3"><label className="form-label small fw-bold">Código Municipal</label><input type="text" className={inputClass} name="codigo_municipal" value={formData.codigo_municipal} onChange={handleChange} /></div>
                  <div className="col-md-3"><label className="form-label small fw-bold">DNI / RUC</label><input type="text" className={inputClass} name="dni_ruc" value={formData.dni_ruc} onChange={handleChange} /></div>
                  <div className="col-md-6"><label className="form-label small fw-bold">Nombre Completo</label><input type="text" className={inputClass} name="nombre_completo" value={formData.nombre_completo} onChange={handleChange} required /></div>
                  <div className="col-md-4"><label className="form-label small fw-bold">Teléfono</label><input type="text" className={inputClass} name="telefono" value={formData.telefono} onChange={handleChange} /></div>
                </div>

                <h6 className={`border-bottom pb-2 mb-3 ${darkMode ? "border-secondary" : "text-primary"}`}>Dirección del Predio</h6>
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-bold">Calle / Jirón / Avenida</label>
                    <select className={selectClass} name="id_calle" value={formData.id_calle} onChange={handleChange} required>
                      <option value="">-- Seleccionar --</option>
                      {calles.map(c => (
                        <option key={c.id_calle} value={c.id_calle}>{c.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-2"><label className="form-label small fw-bold">N°</label><input type="text" className={inputClass} name="numero_casa" value={formData.numero_casa} onChange={handleChange} /></div>
                  <div className="col-md-2"><label className="form-label small fw-bold">Mz.</label><input type="text" className={inputClass} name="manzana" value={formData.manzana} onChange={handleChange} /></div>
                  <div className="col-md-2"><label className="form-label small fw-bold">Lt.</label><input type="text" className={inputClass} name="lote" value={formData.lote} onChange={handleChange} /></div>
                </div>

                <div className={`modal-footer px-0 pb-0 mt-3 ${darkMode ? "border-secondary" : ""}`}>
                  <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cancelar</button>
                  <button type="submit" className="btn btn-primary fw-bold">Guardar Cambios</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalEditarUsuario;
