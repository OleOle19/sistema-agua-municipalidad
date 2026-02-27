import { useState, useEffect } from "react";
import api from "../api";
import { FaSave, FaTrashAlt, FaUserShield } from "react-icons/fa";

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Nivel 1 - Admin principal" },
  { value: "ADMIN_SEC", label: "Nivel 2 - Admin secundario / caja" },
  { value: "CAJERO", label: "Nivel 3 - Operador de caja" },
  { value: "CONSULTA", label: "Nivel 4 - Consulta" },
  { value: "BRIGADA", label: "Nivel 5 - Brigada de campo" }
];

const STATUS_OPTIONS = [
  { value: "ACTIVO", label: "Activo" },
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "BLOQUEADO", label: "Bloqueado" }
];

const badgeEstado = (estado) => {
  if (estado === "ACTIVO") return <span className="badge bg-success">Activo</span>;
  if (estado === "BLOQUEADO") return <span className="badge bg-danger">Bloqueado</span>;
  return <span className="badge bg-warning text-dark">Pendiente</span>;
};

const getRolLabel = (rol) => {
  const found = ROLE_OPTIONS.find((r) => r.value === rol);
  return found ? found.label : rol;
};

const ModalUsuarios = ({ cerrarModal, usuarioActivo }) => {
  const [usuarios, setUsuarios] = useState([]);
  const [ediciones, setEdiciones] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);
  const [usuarioEliminarId, setUsuarioEliminarId] = useState("");
  const [eliminandoId, setEliminandoId] = useState(null);

  const cargarUsuarios = async () => {
    try {
      const res = await api.get("/admin/usuarios");
      const rows = Array.isArray(res.data) ? res.data : [];
      setUsuarios(rows);
      const draft = {};
      rows.forEach((u) => {
        draft[u.id_usuario] = {
          rol: u.rol || "CONSULTA",
          estado: u.estado || "PENDIENTE"
        };
      });
      setEdiciones(draft);
    } catch (error) {
      alert(error?.response?.data?.error || "Error al cargar usuarios");
    }
  };

  useEffect(() => { cargarUsuarios(); }, []);

  useEffect(() => {
    if (!usuarioEliminarId) return;
    const existe = usuarios.some((u) => String(u.id_usuario) === String(usuarioEliminarId));
    if (!existe) setUsuarioEliminarId("");
  }, [usuarios, usuarioEliminarId]);

  const actualizarCampo = (idUsuario, campo, valor) => {
    setEdiciones((prev) => ({
      ...prev,
      [idUsuario]: {
        ...(prev[idUsuario] || {}),
        [campo]: valor
      }
    }));
  };

  const guardarUsuario = async (u) => {
    const cambios = ediciones[u.id_usuario];
    if (!cambios) return;

    const mismoRol = (cambios.rol || "") === (u.rol || "");
    const mismoEstado = (cambios.estado || "") === (u.estado || "");
    if (mismoRol && mismoEstado) return;

    try {
      setGuardandoId(u.id_usuario);
      await api.put(`/admin/usuarios/${u.id_usuario}`, {
        rol: cambios.rol,
        estado: cambios.estado
      });
      await cargarUsuarios();
    } catch (error) {
      alert(error?.response?.data?.error || "Error al actualizar usuario");
    } finally {
      setGuardandoId(null);
    }
  };

  const eliminarUsuarioSistema = async () => {
    const id = Number(usuarioEliminarId);
    if (!Number.isInteger(id) || id <= 0) {
      alert("Seleccione un usuario para eliminar.");
      return;
    }
    const target = usuarios.find((u) => Number(u.id_usuario) === id);
    if (!target) {
      alert("Usuario no encontrado.");
      return;
    }
    if (!window.confirm(`Se eliminará el usuario "${target.username}". Esta acción no se puede deshacer. ¿Continuar?`)) {
      return;
    }

    try {
      setEliminandoId(id);
      await api.delete(`/admin/usuarios/${id}`);
      alert("Usuario eliminado.");
      setUsuarioEliminarId("");
      await cargarUsuarios();
    } catch (error) {
      alert(error?.response?.data?.error || "Error al eliminar usuario");
    } finally {
      setEliminandoId(null);
    }
  };

  const esAdminPrincipal = String(usuarioActivo?.rol || "").trim().toUpperCase() === "ADMIN";
  const opcionesEliminar = usuarios.filter((u) => u.id_usuario !== usuarioActivo?.id_usuario);

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content">
          <div className="modal-header bg-dark text-white">
            <h5 className="modal-title"><FaUserShield className="me-2"/> Separacion de poderes - Usuarios</h5>
            <button type="button" className="btn-close btn-close-white" onClick={cerrarModal}></button>
          </div>
          <div className="modal-body bg-light">
            <div className="alert alert-info small mb-3">
              Usuario actual: <strong>{usuarioActivo?.nombre || "-"}</strong>. Solo el Nivel 1 puede cambiar rol y estado.
            </div>

            <div className="table-responsive bg-white border rounded">
              <table className="table table-hover mb-0 align-middle">
                <thead className="table-secondary text-center">
                  <tr>
                    <th>Usuario</th>
                    <th>Nombre</th>
                    <th>Rol actual</th>
                    <th>Nuevo rol</th>
                    <th>Estado actual</th>
                    <th>Nuevo estado</th>
                    <th>Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => {
                    const edit = ediciones[u.id_usuario] || { rol: u.rol, estado: u.estado };
                    const esPropio = u.id_usuario === usuarioActivo?.id_usuario;
                    const tieneCambios = edit.rol !== u.rol || edit.estado !== u.estado;
                    return (
                      <tr key={u.id_usuario}>
                        <td className="fw-bold">{u.username}</td>
                        <td>{u.nombre_completo}</td>
                        <td><span className="badge bg-primary">{getRolLabel(u.rol)}</span></td>
                        <td>
                          <select
                            className="form-select form-select-sm"
                            value={edit.rol}
                            onChange={(e) => actualizarCampo(u.id_usuario, "rol", e.target.value)}
                            disabled={guardandoId === u.id_usuario}
                          >
                            {ROLE_OPTIONS.map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="text-center">{badgeEstado(u.estado)}</td>
                        <td>
                          <select
                            className="form-select form-select-sm"
                            value={edit.estado}
                            onChange={(e) => actualizarCampo(u.id_usuario, "estado", e.target.value)}
                            disabled={guardandoId === u.id_usuario}
                          >
                            {STATUS_OPTIONS.map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="text-center">
                          <button
                            className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1"
                            onClick={() => guardarUsuario(u)}
                            disabled={!tieneCambios || guardandoId === u.id_usuario}
                            title={esPropio ? "No puedes bloquearte ni bajarte de nivel 1" : "Guardar cambios"}
                          >
                            <FaSave/> Guardar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {esAdminPrincipal && (
              <div className="border rounded bg-white mt-3 p-3">
                <div className="fw-bold text-danger mb-2">Eliminar usuario (solo Admin Principal)</div>
                <div className="small text-muted mb-2">
                  El usuario eliminado ya no podrá iniciar sesión en el sistema.
                </div>
                <div className="d-flex flex-wrap gap-2 align-items-center">
                  <select
                    className="form-select form-select-sm"
                    style={{ maxWidth: "420px" }}
                    value={usuarioEliminarId}
                    onChange={(e) => setUsuarioEliminarId(e.target.value)}
                    disabled={eliminandoId !== null}
                  >
                    <option value="">-- Seleccione usuario --</option>
                    {opcionesEliminar.map((u) => (
                      <option key={u.id_usuario} value={u.id_usuario}>
                        {u.username} - {u.nombre_completo}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                    onClick={eliminarUsuarioSistema}
                    disabled={!usuarioEliminarId || eliminandoId !== null}
                  >
                    <FaTrashAlt />
                    {eliminandoId !== null ? "Eliminando..." : "Eliminar usuario"}
                  </button>
                </div>
              </div>
            )}
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
