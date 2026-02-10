import { useState, useEffect } from "react";
import api from "../api";
import { FaLayerGroup, FaBuilding, FaUsers, FaPrint } from "react-icons/fa";

const ModalImpresionMasiva = ({ cerrarModal, alConfirmar, idsSeleccionados = [], darkMode }) => {
  const [calles, setCalles] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [modo, setModo] = useState(idsSeleccionados.length > 0 ? "seleccion" : "calle");
  const currentYear = new Date().getFullYear();
  const [seleccion, setSeleccion] = useState({ id_calle: "", mes: new Date().getMonth() + 1, anio: currentYear });

  useEffect(() => {
    api.get("/calles").then(res => setCalles(res.data)).catch(err => console.error(err));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (modo === 'calle' && !seleccion.id_calle) return alert("Seleccione una calle");
    setCargando(true);
    try {
      const payload = { ...seleccion, tipo_seleccion: modo, ids_usuarios: idsSeleccionados };
      const res = await api.post("/recibos/masivos", payload);
      alConfirmar(res.data); cerrarModal();
    } catch (error) { alert(error.response?.data?.error || "Error al buscar recibos."); } 
    finally { setCargando(false); }
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-dark text-white"}`;
  const inputClass = `form-control ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const selectClass = `form-select ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const btnOutlineClass = (active) => active ? "btn-primary" : (darkMode ? "btn-outline-light" : "btn-outline-secondary");

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className="modal-title"><FaPrint className="me-2"/> Impresión Masiva</h5>
            <button className={`btn-close ${darkMode ? "btn-close-white" : "btn-close-white"}`} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            
            <form onSubmit={handleSubmit}>
              <div className={`d-flex justify-content-around mb-4 border-bottom pb-3 ${darkMode ? "border-secondary" : ""}`}>
                <button type="button" className={`btn btn-sm ${btnOutlineClass(modo==='seleccion')}`} onClick={()=>setModo('seleccion')} disabled={idsSeleccionados.length===0}>
                    <FaUsers className="mb-1 d-block mx-auto"/> Selección
                </button>
                <button type="button" className={`btn btn-sm ${btnOutlineClass(modo==='calle')}`} onClick={()=>setModo('calle')}>
                    <FaBuilding className="mb-1 d-block mx-auto"/> Por Calle
                </button>
                <button type="button" className={`btn btn-sm ${btnOutlineClass(modo==='todos')}`} onClick={()=>setModo('todos')}>
                    <FaLayerGroup className="mb-1 d-block mx-auto"/> Todos
                </button>
              </div>

              {modo === 'calle' && (
                  <div className="mb-3">
                    <label className="form-label fw-bold">Seleccionar Calle</label>
                    <select className={selectClass} value={seleccion.id_calle} onChange={e => setSeleccion({...seleccion, id_calle: e.target.value})}>
                      <option value="">-- Seleccione --</option>
                      {calles.map(c => <option key={c.id_calle} value={c.id_calle}>{c.nombre}</option>)}
                    </select>
                  </div>
              )}

              <div className="row mb-3">
                <div className="col-6">
                    <label className="form-label fw-bold">Mes</label>
                    <select className={selectClass} value={seleccion.mes} onChange={e => setSeleccion({...seleccion, mes: e.target.value})}>
                        {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                            <option key={m} value={m}>{["","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][m]}</option>
                        ))}
                    </select>
                </div>
                <div className="col-6">
                    <label className="form-label fw-bold">Año</label>
                    <input type="number" className={inputClass} value={seleccion.anio} onChange={e => setSeleccion({...seleccion, anio: e.target.value})} />
                </div>
              </div>
              
              <div className="d-flex justify-content-end gap-2">
                <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={cargando}>
                    {cargando ? "Procesando..." : "Imprimir"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalImpresionMasiva;
