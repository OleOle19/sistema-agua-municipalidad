import { useEffect, useState } from "react";
import api from "../api";
import { FaEye, FaEyeSlash, FaSave, FaTrashAlt, FaUserShield } from "react-icons/fa";

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Nivel 1 - Admin principal" },
  { value: "ADMIN_AUX", label: "Nivel 2 - Admin secundario" },
  { value: "ADMIN_SEC", label: "Nivel 3 - Ventanilla" },
  { value: "CAJERO", label: "Nivel 4 - Operador de caja" },
  { value: "CONSULTA", label: "Nivel 5 - Consulta" },
  { value: "BRIGADA", label: "Nivel 6 - Brigada de campo" }
];

const STATUS_OPTIONS = [
  { value: "ACTIVO", label: "Activo" },
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "BLOQUEADO", label: "Bloqueado" }
];

const MIN_PASSWORD_LEN = 8;

const badgeEstado = (estado) => {
  if (estado === "ACTIVO") return <span className="badge bg-success">Activo</span>;
  if (estado === "BLOQUEADO") return <span className="badge bg-danger">Bloqueado</span>;
  return <span className="badge bg-warning text-dark">Pendiente</span>;
};

const getRolLabel = (rol) => {
  const found = ROLE_OPTIONS.find((r) => r.value === rol);
  return found ? found.label : rol;
};

const ModalUsuarios = ({ cerrarModal, usuarioActivo, onFlash = null }) => {
  const [usuarios, setUsuarios] = useState([]);
  const [ediciones, setEdiciones] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);
  const [usuarioEliminarId, setUsuarioEliminarId] = useState("");
  const [eliminandoId, setEliminandoId] = useState(null);
  const [credenciales, setCredenciales] = useState({});
  const [credencialesVisibles, setCredencialesVisibles] = useState({});
  const [consultandoPasswordId, setConsultandoPasswordId] = useState(null);
  const esAdminPrincipal = String(usuarioActivo?.rol || "").trim().toUpperCase() === "ADMIN";

  const showFlash = (type, text) => {
    if (typeof onFlash === "function") onFlash(type, text);
  };

  const cargarUsuarios = async () => {
    try {
      const res = await api.get("/admin/usuarios");
      const rows = Array.isArray(res.data) ? res.data : [];
      setUsuarios(rows);
      const draft = {};
      rows.forEach((u) => {
        draft[u.id_usuario] = {
          rol: u.rol || "CONSULTA",
          estado: u.estado || "PENDIENTE",
          password: ""
        };
      });
      setEdiciones(draft);
      setCredenciales({});
      setCredencialesVisibles({});
    } catch (error) {
      showFlash("danger", error?.response?.data?.error || "Error al cargar usuarios");
    }
  };

  useEffect(() => {
    cargarUsuarios();
  }, []);

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
    const nuevaPassword = String(cambios.password || "");
    const quiereCambiarPassword = esAdminPrincipal && nuevaPassword.length > 0;

    if (quiereCambiarPassword && nuevaPassword.length < MIN_PASSWORD_LEN) {
      return showFlash("warning", `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres.`);
    }

    const payload = {};
    if (!mismoRol) payload.rol = cambios.rol;
    if (!mismoEstado) payload.estado = cambios.estado;
    if (quiereCambiarPassword) payload.password = nuevaPassword;

    if (Object.keys(payload).length === 0) return;

    try {
      setGuardandoId(u.id_usuario);
      await api.put(`/admin/usuarios/${u.id_usuario}`, payload);
      await cargarUsuarios();
      if (quiereCambiarPassword) {
        showFlash("success", `Contraseña actualizada para "${u.username}".`);
      } else {
        showFlash("success", `Usuario "${u.username}" actualizado.`);
      }
    } catch (error) {
      showFlash("danger", error?.response?.data?.error || "Error al actualizar usuario");
    } finally {
      setGuardandoId(null);
    }
  };

  const consultarPassword = async (u) => {
    if (!esAdminPrincipal || !u?.id_usuario) return;
    const id = Number(u.id_usuario);
    if (Object.prototype.hasOwnProperty.call(credenciales, id)) {
      setCredencialesVisibles((prev) => ({ ...prev, [id]: !prev[id] }));
      return;
    }
    try {
      setConsultandoPasswordId(id);
      const res = await api.get(`/admin/usuarios/${id}/password`);
      const password = res.data?.disponible ? String(res.data?.password || "") : "";
      setCredenciales((prev) => ({ ...prev, [id]: password }));
      setCredencialesVisibles((prev) => ({ ...prev, [id]: Boolean(password) }));
      if (!password) {
        showFlash("info", `La contraseña anterior de "${u.username}" no es recuperable. Asigne una nueva para habilitar su consulta.`);
      }
    } catch (error) {
      showFlash("danger", error?.response?.data?.error || "No se pudo consultar la contraseña");
    } finally {
      setConsultandoPasswordId(null);
    }
  };

  const eliminarUsuarioSistema = async () => {
    const id = Number(usuarioEliminarId);
    if (!Number.isInteger(id) || id <= 0) {
      showFlash("warning", "Seleccione un usuario para eliminar.");
      return;
    }
    const target = usuarios.find((u) => Number(u.id_usuario) === id);
    if (!target) {
      showFlash("warning", "Usuario no encontrado.");
      return;
    }
    try {
      setEliminandoId(id);
      await api.delete(`/admin/usuarios/${id}`);
      showFlash("success", "Usuario eliminado.");
      setUsuarioEliminarId("");
      await cargarUsuarios();
    } catch (error) {
      showFlash("danger", error?.response?.data?.error || "Error al eliminar usuario");
    } finally {
      setEliminandoId(null);
    }
  };

  const opcionesEliminar = usuarios.filter((u) => u.id_usuario !== usuarioActivo?.id_usuario);

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content">
          <div className="modal-header bg-dark text-white">
            <h5 className="modal-title"><FaUserShield className="me-2" /> Gestión de usuarios</h5>
            <button type="button" className="btn-close btn-close-white" onClick={cerrarModal}></button>
          </div>
          <div className="modal-body bg-light">
            <div className="alert alert-info small mb-3">
              Usuario actual: <strong>{usuarioActivo?.nombre || "-"}</strong>. {esAdminPrincipal
                ? "Puede modificar usuarios y consultar o cambiar contraseñas. Estas acciones quedan registradas en Auditoría."
                : "Modo de consulta: puede revisar los usuarios, pero no modificarlos ni eliminarlos."}
            </div>

            <div className="table-responsive bg-white border rounded">
              <table className="table table-hover mb-0 align-middle">
                <thead className="table-secondary text-center">
                  <tr>
                    <th>Usuario</th>
                    <th>Nombre</th>
                    <th>Rol actual</th>
                    <th>Estado actual</th>
                    {esAdminPrincipal && <th>Nuevo rol</th>}
                    {esAdminPrincipal && <th>Nuevo estado</th>}
                    {esAdminPrincipal && <th>Credencial</th>}
                    {esAdminPrincipal && <th>Nueva contraseña</th>}
                    {esAdminPrincipal && <th>Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => {
                    const edit = ediciones[u.id_usuario] || { rol: u.rol, estado: u.estado, password: "" };
                    const targetEsPrincipal = String(u.rol || "").toUpperCase() === "ADMIN";
                    const puedeEditar = esAdminPrincipal;
                    const passwordConsultada = Object.prototype.hasOwnProperty.call(credenciales, Number(u.id_usuario));
                    const passwordActual = credenciales[Number(u.id_usuario)] || "";
                    const tieneCambios = (
                      puedeEditar && (
                        edit.rol !== u.rol ||
                        edit.estado !== u.estado ||
                        (esAdminPrincipal && String(edit.password || "").length > 0)
                      )
                    );
                    return (
                      <tr key={u.id_usuario}>
                        <td className="fw-bold">{u.username}</td>
                        <td>{u.nombre_completo}</td>
                        <td><span className="badge bg-primary">{getRolLabel(u.rol)}</span></td>
                        <td className="text-center">{badgeEstado(u.estado)}</td>
                        {esAdminPrincipal && <td>
                          <select
                            className="form-select form-select-sm"
                            value={edit.rol}
                            onChange={(e) => actualizarCampo(u.id_usuario, "rol", e.target.value)}
                            disabled={!puedeEditar || guardandoId === u.id_usuario}
                          >
                            {ROLE_OPTIONS.filter((op) => esAdminPrincipal || targetEsPrincipal || op.value !== "ADMIN").map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>
                        </td>}
                        {esAdminPrincipal && <td>
                          <select
                            className="form-select form-select-sm"
                            value={edit.estado}
                            onChange={(e) => actualizarCampo(u.id_usuario, "estado", e.target.value)}
                            disabled={!puedeEditar || guardandoId === u.id_usuario}
                          >
                            {STATUS_OPTIONS.map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>
                        </td>}
                        {esAdminPrincipal && <td style={{ minWidth: "170px" }}>
                          <div className="d-flex align-items-center gap-1">
                              {passwordConsultada && passwordActual ? (
                                <input
                                  type={credencialesVisibles[u.id_usuario] ? "text" : "password"}
                                  className="form-control form-control-sm"
                                  value={passwordActual}
                                  readOnly
                                  aria-label={`Contraseña actual de ${u.username}`}
                                />
                              ) : (
                                <span className="text-muted small flex-grow-1">
                                  {u.password_disponible ? "Cifrada" : "No recuperable"}
                                </span>
                              )}
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                onClick={() => consultarPassword(u)}
                                disabled={consultandoPasswordId === u.id_usuario || (passwordConsultada && !passwordActual)}
                                aria-label={`${credencialesVisibles[u.id_usuario] ? "Ocultar" : "Ver"} contraseña de ${u.username}`}
                                title={credencialesVisibles[u.id_usuario] ? "Ocultar contraseña" : "Ver contraseña"}
                              >
                                {credencialesVisibles[u.id_usuario] ? <FaEyeSlash /> : <FaEye />}
                              </button>
                          </div>
                        </td>}
                        {esAdminPrincipal && <td style={{ minWidth: "220px" }}>
                          <input
                            type="password"
                            className="form-control form-control-sm"
                            value={edit.password || ""}
                            onChange={(e) => actualizarCampo(u.id_usuario, "password", e.target.value)}
                            placeholder={`Mínimo ${MIN_PASSWORD_LEN} caracteres`}
                            autoComplete="new-password"
                            disabled={!esAdminPrincipal || guardandoId === u.id_usuario}
                          />
                        </td>}
                        {esAdminPrincipal && <td className="text-center">
                          <button
                            className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1"
                            onClick={() => guardarUsuario(u)}
                            disabled={!tieneCambios || guardandoId === u.id_usuario}
                            title="Guardar cambios"
                          >
                            <FaSave /> Guardar
                          </button>
                        </td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {esAdminPrincipal && <div className="border rounded bg-white mt-3 p-3">
                <div className="fw-bold text-danger mb-2">Eliminar usuario</div>
                <div className="small text-muted mb-2">
                  El usuario eliminado ya no podrá iniciar sesión.
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
            </div>}
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
