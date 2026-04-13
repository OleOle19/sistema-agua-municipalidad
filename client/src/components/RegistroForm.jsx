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
  const [adjuntos, setAdjuntos] = useState([]);

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
    } catch {
      console.error("Error cargando calles");
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [callesRes, sectoresRes] = await Promise.all([
          api.get("/calles"),
          api.get("/sectores")
        ]);
        if (!cancelled) {
          setCalles(callesRes.data);
          setSectores(Array.isArray(sectoresRes.data) ? sectoresRes.data : []);
        }
      } catch {
        if (!cancelled) {
          setCalles([]);
          setSectores([]);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });
  const onSelectAdjuntos = (event) => {
    const files = Array.from(event?.target?.files || []);
    setAdjuntos(files);
  };
  const quitarAdjunto = (idx) => {
    setAdjuntos((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.nombre_completo || !formData.id_calle) return alert("Faltan datos obligatorios");
    try {
      const payload = new FormData();
      payload.append("dni_ruc", formData.dni_ruc || "");
      payload.append("nombre_completo", formData.nombre_completo || "");
      payload.append("sec_nombre", formData.sec_nombre || "");
      payload.append("estado_conexion", formData.estado_conexion || "");
      payload.append("id_calle", formData.id_calle || "");
      payload.append("numero_casa", formData.numero_casa || "");
      payload.append("manzana", formData.manzana || "");
      payload.append("lote", formData.lote || "");
      adjuntos.forEach((file) => payload.append("adjuntos", file));
      const res = await api.post("/contribuyentes", payload, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      const totalAdjuntos = Number(res?.data?.adjuntos_registrados || 0);
      alert(
        totalAdjuntos > 0
          ? `Contribuyente registrado con exito. Adjuntos guardados: ${totalAdjuntos}.`
          : "Contribuyente registrado con exito"
      );
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
      setAdjuntos([]);
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
                <option value="CORTADO">Cortado</option>
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

          <h6 className={`border-bottom pb-2 mb-3 ${darkMode ? "border-secondary" : "text-primary"}`}>3. Adjuntos del Contribuyente</h6>
          <div className="mb-3">
            <label className={labelClass}>Documentos / fotos (opcional)</label>
            <input
              type="file"
              className={inputClass}
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
              onChange={onSelectAdjuntos}
            />
            <div className="form-text">Se guardan en el servidor municipal para trazabilidad del registro.</div>
          </div>
          {adjuntos.length > 0 && (
            <div className="border rounded p-2 mb-4">
              <div className="small fw-bold mb-1">Archivos seleccionados ({adjuntos.length})</div>
              {adjuntos.map((file, idx) => (
                <div key={`${file.name}-${idx}`} className="d-flex align-items-center small border-bottom py-1">
                  <span className="text-truncate">{file.name}</span>
                  <span className="ms-auto text-muted">{Math.round((Number(file.size || 0) / 1024) * 10) / 10} KB</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-link text-danger ms-2 p-0"
                    onClick={() => quitarAdjunto(idx)}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}

          <button type="submit" className="btn btn-success w-100 py-2 fw-bold">Guardar Registro</button>
        </form>
      </div>
    </div>
  );
};

export default RegistroForm;
