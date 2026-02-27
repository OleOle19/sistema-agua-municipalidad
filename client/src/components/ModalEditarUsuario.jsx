import { useState, useEffect } from "react";
import api from "../api";

const normalizeEstadoConexion = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (["CON_CONEXION", "CONEXION", "CONECTADO", "ACTIVO"].includes(raw)) return "CON_CONEXION";
  if (["SIN_CONEXION", "SIN CONEXION", "SIN_SERVICIO", "NO_CONECTADO", "INACTIVO"].includes(raw)) return "SIN_CONEXION";
  if (["CORTADO", "CORTE", "SUSPENDIDO"].includes(raw)) return "CORTADO";
  return "CON_CONEXION";
};
const normalizeCodigoMunicipalInput = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const onlyDigits = raw.replace(/\D/g, "");
  if (onlyDigits) return onlyDigits.slice(0, 8).padStart(6, "0");
  return raw.toUpperCase().slice(0, 32);
};

const ModalEditarUsuario = ({ usuario, cerrarModal, alGuardar, darkMode }) => {
  const [formData, setFormData] = useState({
    nombre_completo: "",
    codigo_municipal: "",
    sec_cod: "",
    sec_nombre: "",
    estado_conexion: "CON_CONEXION",
    dni_ruc: "",
    telefono: "",
    id_calle: "",
    numero_casa: "",
    manzana: "",
    lote: ""
  });

  const [calles, setCalles] = useState([]);
  const [sectores, setSectores] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const cargarDatos = async () => {
      try {
        const [resCalles, resSectores, resDetalle] = await Promise.all([
          api.get("/calles"),
          api.get("/sectores"),
          api.get(`/contribuyentes/detalle/${usuario.id_contribuyente}`)
        ]);
        setCalles(resCalles.data);
        setSectores(Array.isArray(resSectores.data) ? resSectores.data : []);
        const u = resDetalle.data;
        setFormData({
          nombre_completo: u.nombre_completo || "",
          codigo_municipal: u.codigo_municipal || "",
          sec_cod: u.sec_cod || "",
          sec_nombre: u.sec_nombre || "",
          estado_conexion: normalizeEstadoConexion(u.estado_conexion),
          dni_ruc: u.dni_ruc || "",
          telefono: u.telefono || "",
          id_calle: u.id_calle || "",
          numero_casa: u.numero_casa || "",
          manzana: u.manzana || "",
          lote: u.lote || ""
        });
        setCargando(false);
      } catch (error) {
        cerrarModal();
      }
    };
    cargarDatos();
  }, [usuario]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "codigo_municipal") {
      setFormData({ ...formData, codigo_municipal: normalizeCodigoMunicipalInput(value) });
      return;
    }
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/contribuyentes/${usuario.id_contribuyente}`, formData);
      alert("Usuario actualizado");
      alGuardar();
      cerrarModal();
    } catch (error) {
      alert(error.response?.data?.error || "Error al actualizar");
    }
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-warning"}`;
  const inputClass = `form-control ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const selectClass = `form-select ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const sectorNormalizado = String(formData.sec_nombre || "").trim().toLowerCase();
  const sectorActualExiste = sectores.some(
    (s) => String(s?.sec_nombre || "").trim().toLowerCase() === sectorNormalizado
  );

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
                <h6 className={`border-bottom pb-2 mb-3 ${darkMode ? "border-secondary" : "text-primary"}`}>Informacion Personal</h6>
                <div className="row g-3 mb-3">
                  <div className="col-md-3"><label className="form-label small fw-bold">ID Contribuyente</label><input type="text" className={inputClass} value={usuario.id_contribuyente} readOnly disabled /></div>
                  <div className="col-md-3">
                    <label className="form-label small fw-bold">Codigo Municipal</label>
                    <input
                      type="text"
                      className={inputClass}
                      name="codigo_municipal"
                      value={formData.codigo_municipal}
                      onChange={handleChange}
                      onBlur={() => setFormData((prev) => ({ ...prev, codigo_municipal: normalizeCodigoMunicipalInput(prev.codigo_municipal) }))}
                      required
                    />
                  </div>
                  <div className="col-md-3"><label className="form-label small fw-bold">DNI / RUC</label><input type="text" className={inputClass} name="dni_ruc" value={formData.dni_ruc} onChange={handleChange} /></div>
                  <div className="col-md-3"><label className="form-label small fw-bold">Telefono</label><input type="text" className={inputClass} name="telefono" value={formData.telefono} onChange={handleChange} /></div>
                  <div className="col-md-12"><label className="form-label small fw-bold">Nombre Completo</label><input type="text" className={inputClass} name="nombre_completo" value={formData.nombre_completo} onChange={handleChange} required /></div>
                  <div className="col-md-12">
                    <label className="form-label small fw-bold">Nombre del Sector</label>
                    <select className={selectClass} name="sec_nombre" value={formData.sec_nombre} onChange={handleChange}>
                      <option value="">-- Seleccionar --</option>
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
                    <label className="form-label small fw-bold">Estado de Conexion</label>
                    <select className={selectClass} name="estado_conexion" value={formData.estado_conexion} onChange={handleChange}>
                      <option value="CON_CONEXION">Con conexion</option>
                      <option value="SIN_CONEXION">Sin conexion</option>
                      <option value="CORTADO">Corte de conexion</option>
                    </select>
                  </div>
                </div>

                <h6 className={`border-bottom pb-2 mb-3 ${darkMode ? "border-secondary" : "text-primary"}`}>Direccion del Predio</h6>
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-bold">Calle / Jiron / Avenida</label>
                    <select className={selectClass} name="id_calle" value={formData.id_calle} onChange={handleChange} required>
                      <option value="">-- Seleccionar --</option>
                      {calles.map((c) => (
                        <option key={c.id_calle} value={c.id_calle}>{c.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-2"><label className="form-label small fw-bold">Nro</label><input type="text" className={inputClass} name="numero_casa" value={formData.numero_casa} onChange={handleChange} /></div>
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
