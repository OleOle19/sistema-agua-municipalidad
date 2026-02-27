import { useState, useEffect } from "react";
import api from "../api";
import { FaTrashAlt, FaEdit, FaSave, FaTimes, FaPlus } from "react-icons/fa";

const ModalCalles = ({ cerrarModal, darkMode, canDeleteCalles = false }) => {
  const [calles, setCalles] = useState([]);
  const [nuevaCalle, setNuevaCalle] = useState({ nombre: "", zona_barrio: "" });
  const [calleEditando, setCalleEditando] = useState(null);

  const cargarCalles = async () => {
    try {
      const res = await api.get("/calles");
      setCalles(res.data);
    } catch (error) { console.error("Error al cargar calles"); }
  };

  useEffect(() => { cargarCalles(); }, []);

  const agregarCalle = async () => {
    if (!nuevaCalle.nombre.trim()) return alert("Escriba un nombre");
    try {
      await api.post("/calles", nuevaCalle);
      setNuevaCalle({ nombre: "", zona_barrio: "" });
      cargarCalles();
    } catch (error) { alert("Error al agregar"); }
  };

  const eliminarCalle = async (id) => {
    if (!window.confirm("¿Seguro de borrar esta calle?")) return;
    try {
      await api.delete(`/calles/${id}`);
      cargarCalles();
    } catch (error) { alert(error.response?.data?.error || "Error al eliminar"); }
  };

  const activarEdicion = (calle) => { setCalleEditando(calle); };
  
  const guardarEdicion = async () => {
    try {
      await api.put(`/calles/${calleEditando.id_calle}`, calleEditando);
      setCalleEditando(null);
      cargarCalles();
    } catch (error) { alert("Error al actualizar"); }
  };

  // Estilos Dark Mode
  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const inputClass = `form-control ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const listGroupItemClass = `list-group-item d-flex justify-content-between align-items-center ${darkMode ? "bg-dark text-white border-secondary" : ""}`;

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className={`modal-header ${darkMode ? "bg-dark border-secondary" : "bg-light"}`}>
            <h5 className="modal-title">Gestión de Calles</h5>
            <button className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            
            {/* Formulario Agregar */}
            <div className="input-group mb-3">
              <input type="text" className={inputClass} placeholder="Nombre Calle" value={nuevaCalle.nombre} onChange={(e) => setNuevaCalle({...nuevaCalle, nombre: e.target.value})} />
              <input type="text" className={inputClass} placeholder="Zona/Barrio" value={nuevaCalle.zona_barrio} onChange={(e) => setNuevaCalle({...nuevaCalle, zona_barrio: e.target.value})} />
              <button className="btn btn-primary" onClick={agregarCalle}><FaPlus/></button>
            </div>

            {/* Lista */}
            <div className="list-group list-group-flush" style={{ maxHeight: "400px", overflowY: "auto" }}>
              {calles.map(c => (
                <div key={c.id_calle} className={listGroupItemClass}>
                  {calleEditando && calleEditando.id_calle === c.id_calle ? (
                    <div className="d-flex gap-2 w-100">
                      <input type="text" className={`form-control form-control-sm ${darkMode ? "bg-secondary text-white border-secondary" : ""}`} value={calleEditando.nombre} onChange={(e) => setCalleEditando({...calleEditando, nombre: e.target.value})} />
                      <input type="text" className={`form-control form-control-sm ${darkMode ? "bg-secondary text-white border-secondary" : ""}`} value={calleEditando.zona_barrio} onChange={(e) => setCalleEditando({...calleEditando, zona_barrio: e.target.value})} />
                      <button className="btn btn-sm btn-success" onClick={guardarEdicion}><FaSave/></button>
                      <button className="btn btn-sm btn-secondary" onClick={() => setCalleEditando(null)}><FaTimes/></button>
                    </div>
                  ) : (
                    <>
                      <span>{c.nombre} {c.zona_barrio && c.zona_barrio.trim() !== "" ? ` (${c.zona_barrio})` : ""}</span>
                      <div>
                        <button className="btn btn-sm text-primary me-2" onClick={() => activarEdicion(c)}><FaEdit/></button>
                        {canDeleteCalles && (
                          <button className="btn btn-sm text-danger" onClick={() => eliminarCalle(c.id_calle)}><FaTrashAlt/></button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalCalles;
