import { useState, useEffect } from "react";
import api from "../api";
import { FaUserCheck, FaUserTimes, FaUserShield } from "react-icons/fa";

const ModalUsuarios = ({ cerrarModal, usuarioActivo }) => {
  const [usuarios, setUsuarios] = useState([]);

  // Cargar la lista al abrir
  const cargarUsuarios = async () => {
    try {
      const res = await api.get("/admin/usuarios");
      setUsuarios(res.data);
    } catch (error) {
      alert("Error al cargar usuarios");
    }
  };

  useEffect(() => { cargarUsuarios(); }, []);

  // Función para cambiar estado (Aprobar o Bloquear)
  const cambiarEstado = async (id, nuevoEstado) => {
    try {
      await api.put(`/admin/usuarios/${id}`, { estado: nuevoEstado });
      cargarUsuarios(); // Recargamos la lista para ver el cambio
    } catch (error) {
      alert("Error al actualizar estado");
    }
  };

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header bg-dark text-white">
            <h5 className="modal-title"><FaUserShield className="me-2"/> Gestión de Accesos y Usuarios</h5>
            <button type="button" className="btn-close btn-close-white" onClick={cerrarModal}></button>
          </div>
          <div className="modal-body bg-light">
            <div className="alert alert-info small">
              Hola <strong>{usuarioActivo.nombre}</strong>. Aquí puedes autorizar a los nuevos empleados.
            </div>

            <div className="table-responsive bg-white border rounded">
              <table className="table table-hover mb-0 text-center align-middle">
                <thead className="table-secondary">
                  <tr>
                    <th>Usuario</th>
                    <th>Nombre</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => (
                    <tr key={u.id_usuario}>
                      <td className="fw-bold">{u.username}</td>
                      <td>{u.nombre_completo}</td>
                      <td>
                        <span className={`badge ${u.rol === 'ADMIN' ? 'bg-primary' : 'bg-secondary'}`}>
                          {u.rol}
                        </span>
                      </td>
                      <td>
                        {u.estado === 'PENDIENTE' && <span className="badge bg-warning text-dark">⏳ Pendiente</span>}
                        {u.estado === 'ACTIVO' && <span className="badge bg-success">✅ Activo</span>}
                        {u.estado === 'BLOQUEADO' && <span className="badge bg-danger">🚫 Bloqueado</span>}
                      </td>
                      <td>
                        {/* No te puedes bloquear a ti mismo */}
                        {u.id_usuario !== usuarioActivo.id_usuario && (
                          <div className="btn-group">
                            {u.estado !== 'ACTIVO' && (
                              <button 
                                className="btn btn-sm btn-outline-success" 
                                title="Aprobar Acceso"
                                onClick={() => cambiarEstado(u.id_usuario, 'ACTIVO')}
                              >
                                <FaUserCheck/> Aprobar
                              </button>
                            )}
                            {u.estado !== 'BLOQUEADO' && (
                              <button 
                                className="btn btn-sm btn-outline-danger" 
                                title="Revocar Acceso"
                                onClick={() => cambiarEstado(u.id_usuario, 'BLOQUEADO')}
                              >
                                <FaUserTimes/> Bloquear
                              </button>
                            )}
                          </div>
                        )}
                        {u.id_usuario === usuarioActivo.id_usuario && <span className="text-muted small italic">(Tú)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalUsuarios;
