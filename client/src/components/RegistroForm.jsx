import { useState, useEffect } from "react";
import axios from "axios";
import api from "../api";
import ModalCalles from "./ModalCalles";
import { FaSave, FaSearch } from "react-icons/fa";

const RegistroForm = ({ onGuardar, darkMode }) => {
  const [formData, setFormData] = useState({
    codigo_municipal: "", dni_ruc: "", nombre_completo: "", telefono: "", 
    id_calle: "", numero_casa: "", manzana: "", lote: ""
  });
  
  const [calles, setCalles] = useState([]);
  const [mostrarModalCalles, setMostrarModalCalles] = useState(false);
  const [buscando, setBuscando] = useState(false);

  // CLASES CONDICIONALES PARA MODO OSCURO
  const cardClass = `card shadow-sm ${darkMode ? 'text-white border-secondary' : 'bg-light'}`;
  const cardStyle = darkMode ? { backgroundColor: "#2b3035" } : {};
  const headerClass = `card-header ${darkMode ? 'bg-dark text-white border-secondary' : 'bg-primary text-white'}`;
  const inputClass = `form-control ${darkMode ? 'bg-dark text-white border-secondary' : ''}`;
  const selectClass = `form-select ${darkMode ? 'bg-dark text-white border-secondary' : ''}`;
  const labelClass = `form-label fw-bold small ${darkMode ? 'text-white' : 'text-dark'}`;

  const cargarCalles = async () => {
    try {
      const res = await api.get("/calles");
      setCalles(res.data);
    } catch (error) { console.error("Error cargando calles"); }
  };

  useEffect(() => { cargarCalles(); }, []);

  const buscarDNI = async () => {
    if (formData.dni_ruc.length !== 8) return alert("El DNI debe tener 8 dígitos");
    setBuscando(true);
    try {
      const res = await axios.get(`https://api.apis.net.pe/v1/dni?numero=${formData.dni_ruc}`);
      if (res.data && res.data.nombre) {
        setFormData(prev => ({ ...prev, nombre_completo: res.data.nombre }));
      } else { alert("No encontrado en RENIEC (Use API válida)"); }
    } catch (error) { alert("Error al consultar DNI"); } 
    finally { setBuscando(false); }
  };

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.nombre_completo || !formData.id_calle) return alert("Faltan datos obligatorios");
    try {
      await api.post("/contribuyentes", formData);
      alert("Contribuyente registrado con éxito");
      setFormData({ codigo_municipal: "", dni_ruc: "", nombre_completo: "", telefono: "", id_calle: "", numero_casa: "", manzana: "", lote: "" });
      onGuardar();
    } catch (error) { alert(error.response?.data?.error || "Error al guardar"); }
  };

  return (
    <div className={cardClass} style={cardStyle}>
      <div className={headerClass}>
        <div className="d-flex justify-content-between align-items-center">
          <h5 className="mb-0 d-flex align-items-center"><FaSave className="me-2"/> Nuevo Registro de Contribuyente</h5>
          <button className="btn btn-sm btn-outline-light" onClick={() => setMostrarModalCalles(true)}>+ Gestionar Calles</button>
        </div>
      </div>
      <div className="card-body p-4">
        {mostrarModalCalles && <ModalCalles cerrarModal={() => { setMostrarModalCalles(false); cargarCalles(); }} darkMode={darkMode} />}
        
        <form onSubmit={handleSubmit}>
          <h6 className={`border-bottom pb-2 mb-3 ${darkMode ? "border-secondary" : "text-primary"}`}>1. Datos Personales</h6>
          <div className="row g-3 mb-3">
            <div className="col-md-3">
              <label className={labelClass}>DNI / RUC</label>
              <div className="input-group">
                <input type="text" className={inputClass} name="dni_ruc" value={formData.dni_ruc} onChange={handleChange} maxLength={11} required />
                <button type="button" className="btn btn-info" onClick={buscarDNI} disabled={buscando}><FaSearch/></button>
              </div>
            </div>
            <div className="col-md-5">
              <label className={labelClass}>Nombre Completo / Razón Social</label>
              <input type="text" className={inputClass} name="nombre_completo" value={formData.nombre_completo} onChange={handleChange} required />
            </div>
            <div className="col-md-2">
              <label className={labelClass}>Cód. Municipal</label>
              <input type="text" className={inputClass} name="codigo_municipal" value={formData.codigo_municipal} onChange={handleChange} placeholder="Autogenerado" />
            </div>
            <div className="col-md-2">
              <label className={labelClass}>Teléfono</label>
              <input type="text" className={inputClass} name="telefono" value={formData.telefono} onChange={handleChange} />
            </div>
          </div>

          <h6 className={`border-bottom pb-2 mb-3 ${darkMode ? "border-secondary" : "text-primary"}`}>2. Dirección del Predio</h6>
          <div className="row g-3 mb-4">
            <div className="col-md-6">
              <label className={labelClass}>Calle</label>
              <select className={selectClass} name="id_calle" value={formData.id_calle} onChange={handleChange} required>
                <option value="">-- Seleccione --</option>
                {calles.map(c => (
                  <option key={c.id_calle} value={c.id_calle}>
                    {c.nombre} {c.zona_barrio && c.zona_barrio.trim() !== "" ? `(${c.zona_barrio})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2"><label className={labelClass}>N°</label><input type="text" className={inputClass} name="numero_casa" value={formData.numero_casa} onChange={handleChange} /></div>
            <div className="col-md-2"><label className={labelClass}>Mz.</label><input type="text" className={inputClass} name="manzana" value={formData.manzana} onChange={handleChange} /></div>
             <div className="col-md-2"><label className={labelClass}>Lt.</label><input type="text" className={inputClass} name="lote" value={formData.lote} onChange={handleChange} /></div>
          </div>

          <button type="submit" className="btn btn-success w-100 py-2 fw-bold">Guardar Registro</button>
        </form>
      </div>
    </div>
  );
};

export default RegistroForm;
