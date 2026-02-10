import { useState, useEffect } from "react";
import api from "../api";
import { FaLayerGroup, FaBuilding, FaUsers } from "react-icons/fa";

const ModalDeudaMasiva = ({ cerrarModal, alGuardar, idsSeleccionados = [], darkMode }) => {
  const [modo, setModo] = useState(idsSeleccionados.length > 0 ? "seleccion" : "todos");
  const [calles, setCalles] = useState([]);
  const [loading, setLoading] = useState(false);
  const currentYear = new Date().getFullYear();
  const tarifasDefault = { agua: "7.50", desague: "3.50", limpieza: "3.50", admin: "0.50" };

  const [form, setForm] = useState({
    id_calle: "",
    mes: new Date().getMonth() + 1,
    anio: currentYear,
    agua: tarifasDefault.agua,
    desague: tarifasDefault.desague,
    limpieza: tarifasDefault.limpieza,
    admin: tarifasDefault.admin
  });
  const [servicios, setServicios] = useState({
    agua: true,
    desague: true,
    limpieza: true,
    admin: true
  });

  useEffect(() => {
    api.get("/calles").then(res => setCalles(res.data));
  }, []);

  const parseMonto = (value) => {
    const normalized = typeof value === "string" ? value.replace(",", ".") : value;
    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const toggleServicio = (key) => {
    setServicios(prev => {
      const next = !prev[key];
      setForm(formPrev => {
        if (!next) return { ...formPrev, [key]: "0.00" };
        const current = parseMonto(formPrev[key]);
        const restored = current > 0 ? formPrev[key] : tarifasDefault[key];
        return { ...formPrev, [key]: restored };
      });
      return { ...prev, [key]: next };
    });
  };

  const totalServicios = ["agua", "desague", "limpieza", "admin"].reduce((sum, key) => {
    if (!servicios[key]) return sum;
    return sum + parseMonto(form[key]);
  }, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (modo === "calle" && !form.id_calle) return alert("Seleccione una calle");
    if (totalServicios <= 0) return alert("Debe seleccionar al menos un servicio.");
    if (!confirm(`¿Está seguro de generar deuda masiva en modo: ${modo.toUpperCase()}?`)) return;

    setLoading(true);
    try {
      const montosPayload = {
        agua: servicios.agua ? form.agua : 0,
        desague: servicios.desague ? form.desague : 0,
        limpieza: servicios.limpieza ? form.limpieza : 0,
        admin: servicios.admin ? form.admin : 0
      };
      const payload = {
        tipo_seleccion: modo,
        ids_usuarios: idsSeleccionados,
        id_calle: form.id_calle,
        mes: form.mes,
        anio: form.anio,
        montos: montosPayload
      };
      const res = await api.post("/recibos/generar-masivo", payload);
      alert(res.data.mensaje);
      alGuardar(); cerrarModal();
    } catch (error) { alert("Error al generar deuda."); } 
    finally { setLoading(false); }
  };

  // Estilos
  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const inputClass = `form-control form-control-sm ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const selectClass = `form-select ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const btnOutlineClass = (active) => active ? "btn-primary" : (darkMode ? "btn-outline-light" : "btn-outline-secondary");

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className={`modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-primary text-white"}`}>
            <h5 className="modal-title">Generación Masiva de Deuda</h5>
            <button className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            
            <form onSubmit={handleSubmit}>
              <div className={`d-flex justify-content-around mb-4 border-bottom pb-3 ${darkMode ? "border-secondary" : ""}`}>
                <button type="button" className={`btn btn-sm ${btnOutlineClass(modo==='seleccion')}`} onClick={()=>setModo('seleccion')} disabled={idsSeleccionados.length===0}>
                    <FaUsers className="mb-1 d-block mx-auto"/> Selección ({idsSeleccionados.length})
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
                      <label className="form-label">Seleccionar Calle</label>
                      <select className={selectClass} value={form.id_calle} onChange={e => setForm({...form, id_calle: e.target.value})}>
                          <option value="">-- Seleccione --</option>
                          {calles.map(c => <option key={c.id_calle} value={c.id_calle}>{c.nombre}</option>)}
                      </select>
                  </div>
              )}

              <div className="row g-2 mb-3">
                <div className="col-6">
                    <label className="small fw-bold">Mes</label>
                    <select className={selectClass} value={form.mes} onChange={e => setForm({...form, mes: e.target.value})}>
                        {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{["","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][m]}</option>)}
                    </select>
                </div>
                <div className="col-6">
                    <label className="small fw-bold">Año</label>
                    <input type="number" className={inputClass} value={form.anio} onChange={e => setForm({...form, anio: e.target.value})} />
                </div>
              </div>

              <div className={`row g-2 mb-3 border p-2 rounded ${darkMode ? "bg-dark border-secondary" : "bg-light"}`}>
                  <div className="col-12 small fw-bold text-center text-primary">Tarifa a Aplicar</div>
                  <div className="col-3">
                      <div className="form-check">
                          <input className="form-check-input" type="checkbox" id="masivo-agua" checked={servicios.agua} onChange={() => toggleServicio("agua")} />
                          <label className="form-check-label small" htmlFor="masivo-agua">Agua</label>
                      </div>
                      <input type="number" step="0.01" className={inputClass} value={form.agua} onChange={e=>setForm({...form, agua: e.target.value})} disabled={!servicios.agua} />
                  </div>
                  <div className="col-3">
                      <div className="form-check">
                          <input className="form-check-input" type="checkbox" id="masivo-desague" checked={servicios.desague} onChange={() => toggleServicio("desague")} />
                          <label className="form-check-label small" htmlFor="masivo-desague">Desagüe</label>
                      </div>
                      <input type="number" step="0.01" className={inputClass} value={form.desague} onChange={e=>setForm({...form, desague: e.target.value})} disabled={!servicios.desague} />
                  </div>
                  <div className="col-3">
                      <div className="form-check">
                          <input className="form-check-input" type="checkbox" id="masivo-limpieza" checked={servicios.limpieza} onChange={() => toggleServicio("limpieza")} />
                          <label className="form-check-label small" htmlFor="masivo-limpieza">Limpieza</label>
                      </div>
                      <input type="number" step="0.01" className={inputClass} value={form.limpieza} onChange={e=>setForm({...form, limpieza: e.target.value})} disabled={!servicios.limpieza} />
                  </div>
                  <div className="col-3">
                      <div className="form-check">
                          <input className="form-check-input" type="checkbox" id="masivo-admin" checked={servicios.admin} onChange={() => toggleServicio("admin")} />
                          <label className="form-check-label small" htmlFor="masivo-admin">Admin</label>
                      </div>
                      <input type="number" step="0.01" className={inputClass} value={form.admin} onChange={e=>setForm({...form, admin: e.target.value})} disabled={!servicios.admin} />
                  </div>
                  <div className="col-12 text-end fw-bold mt-1">Total: S/ {totalServicios.toFixed(2)}</div>
              </div>

              <div className="d-flex justify-content-end gap-2">
                <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "Procesando..." : "Generar Deuda"}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalDeudaMasiva;
