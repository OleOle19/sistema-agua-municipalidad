import { useState, useEffect } from "react";
import api from "../api";
import ModalCalles from "./ModalCalles";
import { FaSave } from "react-icons/fa";

const RegistroForm = ({ onGuardar, darkMode, canDeleteCalles = false }) => {
  const [formData, setFormData] = useState({
    codigo_municipal: "",
    dni_ruc: "",
    nombre_completo: "",
    sec_nombre: "",
    estado_conexion: "CON_CONEXION",
    id_calle: "",
    numero_casa: "",
    manzana: "",
    lote: ""
  });

  const [calles, setCalles] = useState([]);
  const [sectores, setSectores] = useState([]);
  const [mostrarModalCalles, setMostrarModalCalles] = useState(false);

  const cardClass = `card shadow-sm ${darkMode ? "text-white border-secondary" : "bg-light"}`;
  const cardStyle = darkMode ? { backgroundColor: "#2b3035" } : {};
  const headerClass = `card-header ${darkMode ? "bg-dark text-white border-secondary" : "bg-primary text-white"}`;
  const inputClass = `form-control ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const selectClass = `form-select ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const labelClass = `form-label fw-bold small ${darkMode ? "text-white" : "text-dark"}`;

  const cargarCalles = async () => {
    try {
      const res = await api.get("/calles");
      setCalles(res.data);
    } catch (error) {
      console.error("Error cargando calles");
    }
  };

  const cargarSectores = async () => {
    try {
      const res = await api.get("/sectores");
      setSectores(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error cargando sectores");
    }
  };

  useEffect(() => {
    cargarCalles();
    cargarSectores();
  }, []);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.nombre_completo || !formData.id_calle) return alert("Faltan datos obligatorios");
    try {
      const payload = {
        dni_ruc: formData.dni_ruc,
        nombre_completo: formData.nombre_completo,
        sec_nombre: formData.sec_nombre,
        estado_conexion: formData.estado_conexion,
        id_calle: formData.id_calle,
        numero_casa: formData.numero_casa,
        manzana: formData.manzana,
        lote: formData.lote
      };
      await api.post("/contribuyentes", payload);
      alert("Contribuyente registrado con exito");
      setFormData({
        codigo_municipal: "",
        dni_ruc: "",
        nombre_completo: "",
        sec_nombre: "",
        estado_conexion: "CON_CONEXION",
        id_calle: "",
        numero_casa: "",
        manzana: "",
        lote: ""
      });
      onGuardar();
    } catch (error) {
      alert(error.response?.data?.error || "Error al guardar");
    }
  };

  const sectorNormalizado = String(formData.sec_nombre || "").trim().toLowerCase();
  const sectorActualExiste = sectores.some(
    (s) => String(s?.sec_nombre || "").trim().toLowerCase() === sectorNormalizado
  );

  return (
    <div className={cardClass} style={cardStyle}>
      <div className={headerClass}>
        <div className="d-flex justify-content-between align-items-center">
          <h5 className="mb-0 d-flex align-items-center"><FaSave className="me-2" /> Nuevo Registro de Contribuyente</h5>
          <button className="btn btn-sm btn-outline-light" onClick={() => setMostrarModalCalles(true)}>+ Gestionar Calles</button>
        </div>
      </div>
      <div className="card-body p-4">
        {mostrarModalCalles && <ModalCalles cerrarModal={() => { setMostrarModalCalles(false); cargarCalles(); }} darkMode={darkMode} canDeleteCalles={canDeleteCalles} />}

        <form onSubmit={handleSubmit}>
          <h6 className={`border-bottom pb-2 mb-3 ${darkMode ? "border-secondary" : "text-primary"}`}>1. Datos Personales</h6>
          <div className="row g-3 mb-3">
            <div className="col-md-3">
              <label className={labelClass}>DNI / RUC</label>
              <input type="text" className={inputClass} name="dni_ruc" value={formData.dni_ruc} onChange={handleChange} maxLength={11} required />
            </div>
            <div className="col-md-5">
              <label className={labelClass}>Nombre Completo / Razon Social</label>
              <input type="text" className={inputClass} name="nombre_completo" value={formData.nombre_completo} onChange={handleChange} required />
            </div>
            <div className="col-md-2">
              <label className={labelClass}>Cod. Municipal</label>
              <input
                type="text"
                className={inputClass}
                name="codigo_municipal"
                value={formData.codigo_municipal}
                placeholder="Autogenerado"
                readOnly
                disabled
              />
            </div>
            <div className="col-md-6">
              <label className={labelClass}>Nombre del Sector</label>
              <select className={selectClass} name="sec_nombre" value={formData.sec_nombre} onChange={handleChange}>
                <option value="">-- Seleccione --</option>
                {sectores.map((s) => (
                  <option key={s.sec_nombre} value={s.sec_nombre}>
                    {s.sec_nombre}{s.sec_cod ? ` (${s.sec_cod})` : ""}
                  </option>
                ))}
                {!!formData.sec_nombre && !sectorActualExiste && (
                  <option value={formData.sec_nombre}>{formData.sec_nombre} (actual)</option>
                )}
              </select>
            </div>
            <div className="col-md-6">
              <label className={labelClass}>Estado de Conexion</label>
              <select className={selectClass} name="estado_conexion" value={formData.estado_conexion} onChange={handleChange}>
                <option value="CON_CONEXION">Con conexion</option>
                <option value="SIN_CONEXION">Sin conexion</option>
                <option value="CORTADO">Corte de conexion</option>
              </select>
            </div>
          </div>

          <h6 className={`border-bottom pb-2 mb-3 ${darkMode ? "border-secondary" : "text-primary"}`}>2. Direccion del Predio</h6>
          <div className="row g-3 mb-4">
            <div className="col-md-6">
              <label className={labelClass}>Calle</label>
              <select className={selectClass} name="id_calle" value={formData.id_calle} onChange={handleChange} required>
                <option value="">-- Seleccione --</option>
                {calles.map((c) => (
                  <option key={c.id_calle} value={c.id_calle}>
                    {c.nombre} {c.zona_barrio && c.zona_barrio.trim() !== "" ? `(${c.zona_barrio})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2"><label className={labelClass}>Nro</label><input type="text" className={inputClass} name="numero_casa" value={formData.numero_casa} onChange={handleChange} /></div>
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
