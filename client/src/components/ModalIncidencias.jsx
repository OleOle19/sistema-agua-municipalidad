import { useState, useEffect } from "react";
import api from "../api";
import { FaTools, FaCheckCircle, FaExclamationTriangle, FaPhone, FaHardHat } from "react-icons/fa";

const ModalIncidencias = ({ cerrarModal, usuarioSeleccionado, darkMode }) => {
  const [incidencias, setIncidencias] = useState([]);
  const [form, setForm] = useState({
    tipo_incidencia: "FUGA_CALLE",
    descripcion: "",
    telefono_contacto: "",
    nombre_reportante: ""
  });
  const [modoAtencion, setModoAtencion] = useState(null); 
  const [solucion, setSolucion] = useState("");

  useEffect(() => {
    if (usuarioSeleccionado) {
      setForm(prev => ({
        ...prev,
        nombre_reportante: usuarioSeleccionado.nombre_completo,
      }));
    }
    cargarIncidencias();
  }, [usuarioSeleccionado]);

  const cargarIncidencias = async () => {
    try {
      const res = await api.get("/incidencias");
      setIncidencias(res.data);
    } catch (error) { console.error("Error cargar incidencias"); }
  };

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const reportar = async (e) => {
    e.preventDefault();
    try {
      await api.post("/incidencias", form);
      alert("Reportado correctamente");
      setForm({ tipo_incidencia: "FUGA_CALLE", descripcion: "", telefono_contacto: "", nombre_reportante: "" });
      cargarIncidencias();
    } catch (error) { alert("Error al reportar"); }
  };

  const resolver = async (id) => {
    if (!solucion.trim()) return alert("Describa la solución");
    try {
      await api.put(`/incidencias/${id}`, { solucion });
      setModoAtencion(null);
      setSolucion("");
      cargarIncidencias();
    } catch (error) { alert("Error al resolver"); }
  };

  // ESTILOS MODO OSCURO
  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-warning"}`;
  const inputClass = `form-control form-control-sm ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const selectClass = `form-select form-select-sm ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const tableClass = `table align-middle small ${darkMode ? "table-dark table-hover" : "table-bordered"}`;
  const footerClass = `modal-footer ${darkMode ? "bg-dark border-secondary" : "bg-light"}`;

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className={`modal-title fw-bold ${darkMode ? "" : "text-dark"}`}><FaTools className="me-2"/> Centro de Incidencias y Reclamos</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            <div className="row">
              
              {/* COLUMNA IZQUIERDA: FORMULARIO */}
              <div className={`col-md-4 border-end ${darkMode ? "border-secondary" : ""}`}>
                <h6 className="fw-bold mb-3"><FaExclamationTriangle className="text-danger me-2"/> Reportar Nueva Incidencia</h6>
                <form onSubmit={reportar}>
                  <div className="mb-2">
                    <label className="form-label small fw-bold">Tipo de Problema</label>
                    <select className={selectClass} name="tipo_incidencia" value={form.tipo_incidencia} onChange={handleChange}>
                      <option value="FUGA_CALLE">Fuga de Agua en Calle</option>
                      <option value="FUGA_DOMICILIO">Fuga en Domicilio</option>
                      <option value="FALTA_AGUA">No llega agua</option>
                      <option value="CALIDAD_AGUA">Agua sucia / turbia</option>
                      <option value="ALCANTARILLADO">Atoro de Desagüe</option>
                      <option value="OTROS">Otro Reclamo</option>
                    </select>
                  </div>
                  <div className="mb-2">
                    <label className="form-label small fw-bold">Descripción / Dirección Exacta</label>
                    <textarea className={inputClass} rows="3" name="descripcion" value={form.descripcion} onChange={handleChange} required placeholder="Ej: Av. Grau 505, fuga grande..."></textarea>
                  </div>
                  <div className="mb-2">
                    <label className="form-label small fw-bold">Nombre quien reporta</label>
                    <input type="text" className={inputClass} name="nombre_reportante" value={form.nombre_reportante} onChange={handleChange} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-bold">Teléfono Contacto</label>
                    <input type="text" className={inputClass} name="telefono_contacto" value={form.telefono_contacto} onChange={handleChange} />
                  </div>
                  <button type="submit" className="btn btn-warning w-100 fw-bold"><FaExclamationTriangle/> Registrar Reporte</button>
                </form>
              </div>

              {/* COLUMNA DERECHA: LISTADO */}
              <div className="col-md-8">
                <h6 className="fw-bold mb-3"><FaHardHat className="text-primary me-2"/> Incidencias Pendientes y Resueltas</h6>
                <div className="table-responsive" style={{ maxHeight: "400px" }}>
                  <table className={tableClass}>
                    <thead className={darkMode ? "" : "table-light"}>
                      <tr>
                        <th>Estado</th>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Descripción</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incidencias.map(i => (
                        <tr key={i.id_incidencia}>
                          <td>
                            {i.estado === 'PENDIENTE' 
                              ? <span className="badge bg-danger">Pendiente</span> 
                              : <span className="badge bg-success">Resuelto</span>}
                          </td>
                          <td style={{whiteSpace:'nowrap'}}>{new Date(i.fecha_reporte).toLocaleDateString()}</td>
                          <td className="fw-bold small">{i.tipo_incidencia.replace('_', ' ')}</td>
                          <td>
                            <div className="small fw-bold">{i.nombre_reportante}</div>
                            <div className="small">{i.descripcion}</div>
                            {i.solucion && <div className={`mt-1 p-1 rounded small ${darkMode ? "bg-dark border border-success" : "bg-success bg-opacity-10 text-success"}`}><FaCheckCircle/> {i.solucion}</div>}
                          </td>
                          <td>
                            {i.estado === 'PENDIENTE' && (
                              modoAtencion === i.id_incidencia ? (
                                <div className="d-flex flex-column gap-1">
                                  <textarea className={inputClass} placeholder="¿Qué se hizo?" value={solucion} onChange={e=>setSolucion(e.target.value)} autoFocus></textarea>
                                  <button className="btn btn-sm btn-success" onClick={() => resolver(i.id_incidencia)}>Finalizar</button>
                                  <button className="btn btn-sm btn-secondary" onClick={() => setModoAtencion(null)}>Cancelar</button>
                                </div>
                              ) : (
                                <button className="btn btn-sm btn-outline-primary" onClick={() => setModoAtencion(i.id_incidencia)}>Atender</button>
                              )
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          </div>
          <div className={footerClass}>
             <small className={darkMode ? "text-muted me-auto" : "text-muted me-auto"}>Si seleccionas un usuario en la pantalla principal, sus datos se llenarán automáticamente aquí.</small>
             <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cerrar Panel</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalIncidencias;
