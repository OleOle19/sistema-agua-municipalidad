import { useCallback, useEffect, useMemo, useState } from "react";
import { FaPlus, FaSave, FaTrashAlt, FaUserShield } from "react-icons/fa";
import luzApi from "./apiLuz";

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Nivel 1 - Admin principal" },
  { value: "ADMIN_SEC", label: "Nivel 2 - Ventanilla" },
  { value: "CAJERO", label: "Nivel 3 - Operador de caja" },
  { value: "CONSULTA", label: "Nivel 4 - Consulta" },
  { value: "BRIGADA", label: "Nivel 5 - Brigada" }
];
const STATUS_OPTIONS = [
  { value: "ACTIVO", label: "Activo" },
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "BLOQUEADO", label: "Bloqueado" }
];
const MIN_PASSWORD_LEN = 8;

const badgeEstado = (estado) => {
  const raw = String(estado || "").toUpperCase();
  if (raw === "ACTIVO") return <span className="badge bg-success">ACTIVO</span>;
  if (raw === "BLOQUEADO") return <span className="badge bg-danger">BLOQUEADO</span>;
  return <span className="badge bg-warning text-dark">PENDIENTE</span>;
};

const defaultNuevoUsuario = () => ({
  username: "",
  nombre_completo: "",
  password: "",
  rol: "CONSULTA",
  estado: "ACTIVO"
});

function UsuariosLuzPanel({ visible, usuarioActivo, canManageUsers, onFlash }) {
  const [usuarios, setUsuarios] = useState([]);
  const [ediciones, setEdiciones] = useState({});
  const [nuevo, setNuevo] = useState(defaultNuevoUsuario);
  const [cargando, setCargando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [guardandoId, setGuardandoId] = useState(0);
  const [eliminarId, setEliminarId] = useState("");
  const [eliminandoId, setEliminandoId] = useState(0);

  const showFlash = useCallback((type, text) => {
    if (typeof onFlash === "function") onFlash(type, text);
  }, [onFlash]);

  const cargarUsuarios = useCallback(async () => {
    if (!canManageUsers) return;
    setCargando(true);
    try {
      const res = await luzApi.get("/admin/usuarios");
      const rows = Array.isArray(res.data) ? res.data : [];
      setUsuarios(rows);
      const draft = {};
      for (const u of rows) {
        draft[u.id_usuario] = {
          rol: u.rol || "CONSULTA",
          estado: u.estado || "PENDIENTE",
          password: ""
        };
      }
      setEdiciones(draft);
    } catch (err) {
      showFlash("danger", String(err?.response?.data?.error || "No se pudo cargar usuarios."));
    } finally {
      setCargando(false);
    }
  }, [canManageUsers, showFlash]);

  useEffect(() => {
    if (!visible) return;
    cargarUsuarios();
  }, [cargarUsuarios, visible]);

  useEffect(() => {
    if (!eliminarId) return;
    const exists = usuarios.some((u) => String(u.id_usuario) === String(eliminarId));
    if (!exists) setEliminarId("");
  }, [eliminarId, usuarios]);

  const actualizarEdicion = (idUsuario, campo, valor) => {
    setEdiciones((prev) => ({
      ...prev,
      [idUsuario]: {
        ...(prev[idUsuario] || {}),
        [campo]: valor
      }
    }));
  };

  const crearUsuario = async (e) => {
    e.preventDefault();
    if (!canManageUsers || creando) return;

    const username = String(nuevo.username || "").trim();
    const nombre = String(nuevo.nombre_completo || "").trim();
    const password = String(nuevo.password || "");
    if (username.length < 3) {
      showFlash("warning", "Username invalido. Minimo 3 caracteres.");
      return;
    }
    if (nombre.length < 5) {
      showFlash("warning", "Nombre invalido. Minimo 5 caracteres.");
      return;
    }
    if (password.length < MIN_PASSWORD_LEN) {
      showFlash("warning", `La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres.`);
      return;
    }

    setCreando(true);
    try {
      const res = await luzApi.post("/admin/usuarios", {
        username,
        nombre_completo: nombre,
        password,
        rol: nuevo.rol,
        estado: nuevo.estado
      });
      showFlash("success", res.data?.mensaje || "Usuario creado.");
      setNuevo(defaultNuevoUsuario());
      await cargarUsuarios();
    } catch (err) {
      showFlash("danger", String(err?.response?.data?.error || "No se pudo crear usuario."));
    } finally {
      setCreando(false);
    }
  };

  const guardarUsuario = async (usuario) => {
    if (!canManageUsers || !usuario) return;
    const edit = ediciones[usuario.id_usuario] || {};
    const payload = {};

    if (String(edit.rol || "") !== String(usuario.rol || "")) payload.rol = edit.rol;
    if (String(edit.estado || "") !== String(usuario.estado || "")) payload.estado = edit.estado;
    if (String(edit.password || "").length > 0) {
      if (String(edit.password).length < MIN_PASSWORD_LEN) {
        showFlash("warning", `La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres.`);
        return;
      }
      payload.password = edit.password;
    }
    if (Object.keys(payload).length === 0) return;

    setGuardandoId(Number(usuario.id_usuario));
    try {
      const res = await luzApi.put(`/admin/usuarios/${usuario.id_usuario}`, payload);
      showFlash("success", res.data?.mensaje || "Usuario actualizado.");
      await cargarUsuarios();
    } catch (err) {
      showFlash("danger", String(err?.response?.data?.error || "No se pudo actualizar usuario."));
    } finally {
      setGuardandoId(0);
    }
  };

  const eliminarUsuario = async () => {
    if (!canManageUsers) return;
    const id = Number.parseInt(String(eliminarId || ""), 10);
    if (!Number.isInteger(id) || id <= 0) return;
    const target = usuarios.find((u) => Number(u.id_usuario) === id);
    if (!target) {
      showFlash("warning", "Usuario no encontrado.");
      return;
    }
    if (!window.confirm(`Eliminar usuario ${target.username}? Esta accion no se puede deshacer.`)) {
      return;
    }

    setEliminandoId(id);
    try {
      const res = await luzApi.delete(`/admin/usuarios/${id}`);
      showFlash("success", res.data?.mensaje || "Usuario eliminado.");
      setEliminarId("");
      await cargarUsuarios();
    } catch (err) {
      showFlash("danger", String(err?.response?.data?.error || "No se pudo eliminar usuario."));
    } finally {
      setEliminandoId(0);
    }
  };

  const opcionesEliminar = useMemo(
    () => usuarios.filter((u) => Number(u.id_usuario) !== Number(usuarioActivo?.id_usuario || 0)),
    [usuarioActivo?.id_usuario, usuarios]
  );

  if (!canManageUsers) {
    return (
      <div className="alert alert-warning mb-0">
        Solo el Nivel 1 puede gestionar usuarios en el modulo de luz.
      </div>
    );
  }

  return (
    <div className="row g-3">
      <div className="col-12">
        <div className="alert alert-info small mb-0 d-flex align-items-center gap-2">
          <FaUserShield />
          Usuario actual: <strong>{usuarioActivo?.nombre || usuarioActivo?.username || "-"}</strong>. Solo Nivel 1 puede crear, editar o eliminar usuarios.
        </div>
      </div>

      <div className="col-12 col-xl-4">
        <div className="card border">
          <div className="card-header fw-semibold">Crear usuario de luz</div>
          <div className="card-body">
            <form onSubmit={crearUsuario}>
              <div className="mb-2">
                <label className="form-label">Username</label>
                <input
                  className="form-control"
                  value={nuevo.username}
                  onChange={(e) => setNuevo((prev) => ({ ...prev, username: e.target.value }))}
                  required
                />
              </div>
              <div className="mb-2">
                <label className="form-label">Nombre completo</label>
                <input
                  className="form-control"
                  value={nuevo.nombre_completo}
                  onChange={(e) => setNuevo((prev) => ({ ...prev, nombre_completo: e.target.value }))}
                  required
                />
              </div>
              <div className="mb-2">
                <label className="form-label">Password inicial</label>
                <input
                  type="password"
                  className="form-control"
                  value={nuevo.password}
                  onChange={(e) => setNuevo((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder={`Minimo ${MIN_PASSWORD_LEN} caracteres`}
                  required
                />
              </div>
              <div className="mb-2">
                <label className="form-label">Rol</label>
                <select
                  className="form-select"
                  value={nuevo.rol}
                  onChange={(e) => setNuevo((prev) => ({ ...prev, rol: e.target.value }))}
                >
                  {ROLE_OPTIONS.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
              </div>
              <div className="mb-3">
                <label className="form-label">Estado</label>
                <select
                  className="form-select"
                  value={nuevo.estado}
                  onChange={(e) => setNuevo((prev) => ({ ...prev, estado: e.target.value }))}
                >
                  {STATUS_OPTIONS.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn-primary d-flex align-items-center gap-2" disabled={creando}>
                <FaPlus />
                {creando ? "Creando..." : "Crear usuario"}
              </button>
            </form>
          </div>
        </div>

        <div className="card border mt-3">
          <div className="card-header fw-semibold text-danger">Eliminar usuario</div>
          <div className="card-body">
            <select
              className="form-select mb-2"
              value={eliminarId}
              onChange={(e) => setEliminarId(e.target.value)}
              disabled={eliminandoId > 0}
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
              className="btn btn-outline-danger d-flex align-items-center gap-2"
              onClick={eliminarUsuario}
              disabled={!eliminarId || eliminandoId > 0}
            >
              <FaTrashAlt />
              {eliminandoId > 0 ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
        </div>
      </div>

      <div className="col-12 col-xl-8">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="fw-semibold">Usuarios del sistema de luz</div>
          <button type="button" className="btn btn-outline-primary btn-sm" onClick={cargarUsuarios} disabled={cargando}>
            {cargando ? "Actualizando..." : "Recargar"}
          </button>
        </div>
        <div className="table-responsive border rounded" style={{ maxHeight: "74vh" }}>
          <table className="table table-sm table-hover align-middle mb-0">
            <thead className="table-light sticky-top">
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Password actual</th>
                <th>Nueva password</th>
                <th className="text-center">Accion</th>
              </tr>
            </thead>
            <tbody>
              {cargando && usuarios.length === 0 && (
                <tr><td colSpan="7" className="text-center py-3">Cargando...</td></tr>
              )}
              {!cargando && usuarios.length === 0 && (
                <tr><td colSpan="7" className="text-center py-3 text-muted">Sin usuarios registrados.</td></tr>
              )}
              {usuarios.map((u) => {
                const edit = ediciones[u.id_usuario] || { rol: u.rol, estado: u.estado, password: "" };
                const tieneCambios = (
                  String(edit.rol || "") !== String(u.rol || "") ||
                  String(edit.estado || "") !== String(u.estado || "") ||
                  String(edit.password || "").length > 0
                );
                return (
                  <tr key={u.id_usuario}>
                    <td className="fw-semibold">{u.username}</td>
                    <td>{u.nombre_completo}</td>
                    <td style={{ minWidth: "210px" }}>
                      <select
                        className="form-select form-select-sm"
                        value={edit.rol}
                        onChange={(e) => actualizarEdicion(u.id_usuario, "rol", e.target.value)}
                        disabled={guardandoId === u.id_usuario}
                      >
                        {ROLE_OPTIONS.map((op) => (
                          <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ minWidth: "150px" }}>
                      <div className="mb-1">{badgeEstado(u.estado)}</div>
                      <select
                        className="form-select form-select-sm"
                        value={edit.estado}
                        onChange={(e) => actualizarEdicion(u.id_usuario, "estado", e.target.value)}
                        disabled={guardandoId === u.id_usuario}
                      >
                        {STATUS_OPTIONS.map((op) => (
                          <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ minWidth: "170px" }}>
                      <code>{String(u.password_visible || "(no disponible)")}</code>
                    </td>
                    <td style={{ minWidth: "220px" }}>
                      <input
                        type="password"
                        className="form-control form-control-sm"
                        value={edit.password || ""}
                        onChange={(e) => actualizarEdicion(u.id_usuario, "password", e.target.value)}
                        placeholder={`Minimo ${MIN_PASSWORD_LEN} caracteres`}
                        autoComplete="new-password"
                        disabled={guardandoId === u.id_usuario}
                      />
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        className="btn btn-outline-success btn-sm d-inline-flex align-items-center gap-1"
                        onClick={() => guardarUsuario(u)}
                        disabled={!tieneCambios || guardandoId === u.id_usuario}
                      >
                        <FaSave />
                        Guardar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default UsuariosLuzPanel;
