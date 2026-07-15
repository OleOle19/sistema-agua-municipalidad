import { useState } from "react";
import { FaKey, FaUserShield } from "react-icons/fa";
import api from "../api";
import MunicipalBackdrop from "./MunicipalBackdrop";

const MIN_PASSWORD_LEN = 8;

const LoginPage = ({
  onLoginSuccess,
  apiClient = api,
  tokenStorageKey = "token",
  titulo = "Sistema Agua Potable",
  subtitulo = "Municipalidad Distrital de Pueblo Nuevo",
  loginPath = "/auth/login",
  registerPath = "/auth/registro",
  changePasswordPath = "/auth/cambiar-password",
  onBackToSelector = null
}) => {
  const [modo, setModo] = useState("LOGIN");
  const [form, setForm] = useState({
    username: "",
    password: "",
    nombre_completo: "",
    password_actual: "",
    password_nuevo: "",
    password_confirmacion: ""
  });
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const limpiarMensajes = () => {
    setError("");
    setMensaje("");
  };

  const limpiarFormulario = () => {
    setForm({
      username: "",
      password: "",
      nombre_completo: "",
      password_actual: "",
      password_nuevo: "",
      password_confirmacion: ""
    });
  };

  const switchModo = (nextModo) => {
    setModo(nextModo);
    limpiarMensajes();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    limpiarMensajes();

    try {
      if (modo === "LOGIN") {
        const res = await apiClient.post(loginPath, {
          username: form.username,
          password: form.password
        });
        if (res.data?.token) {
          localStorage.setItem(tokenStorageKey, res.data.token);
        }
        onLoginSuccess(res.data);
        return;
      }

      if (modo === "REGISTRO") {
        const res = await apiClient.post(registerPath, {
          username: form.username,
          password: form.password,
          nombre_completo: form.nombre_completo
        });
        setMensaje(res.data?.mensaje || "Solicitud enviada.");
        setModo("LOGIN");
        setError("");
        limpiarFormulario();
        return;
      }

      const username = String(form.username || "").trim();
      const passwordActual = String(form.password_actual || "");
      const passwordNuevo = String(form.password_nuevo || "");
      const passwordConfirmacion = String(form.password_confirmacion || "");
      if (!username || !passwordActual || !passwordNuevo || !passwordConfirmacion) {
        setError("Complete todos los campos para cambiar la contraseña.");
        return;
      }
      if (passwordNuevo.length < MIN_PASSWORD_LEN) {
        setError(`La nueva contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres.`);
        return;
      }
      if (passwordNuevo !== passwordConfirmacion) {
        setError("La confirmación de la nueva contraseña no coincide.");
        return;
      }

      await apiClient.post(changePasswordPath, {
        username,
        password_actual: passwordActual,
        password_nuevo: passwordNuevo
      });

      setMensaje("Contraseña actualizada. Ya puede iniciar sesión.");
      setModo("LOGIN");
      setError("");
      setForm((prev) => ({
        ...prev,
        password: "",
        password_actual: "",
        password_nuevo: "",
        password_confirmacion: ""
      }));
    } catch (err) {
      setError(err.response?.data?.error || "Error de conexión");
    }
  };

  return (
    <div className="login-shell">
      <MunicipalBackdrop className="login-stage" contentClassName="login-stage__content" variant="login">
        <div className="login-card card shadow-lg p-4">
          {typeof onBackToSelector === "function" && (
            <div className="d-flex justify-content-end mb-2">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onBackToSelector}>
                Cambiar modulo
              </button>
            </div>
          )}

          <div className="text-center mb-4">
            <div className="bg-primary text-white rounded-circle d-inline-flex p-3 mb-2">
              <FaUserShield size={40} />
            </div>
            <h3 className="fw-bold text-primary">{titulo}</h3>
            <p className="text-muted small">{subtitulo}</p>
          </div>

          {error && <div className="alert alert-danger text-center small">{error}</div>}
          {mensaje && <div className="alert alert-success text-center small">{mensaje}</div>}

          <form onSubmit={handleSubmit}>
            {modo === "REGISTRO" && (
              <div className="mb-3">
                <label className="form-label" htmlFor="login-nombre-completo">Nombre completo</label>
                <input id="login-nombre-completo" type="text" className="form-control" name="nombre_completo" value={form.nombre_completo} onChange={handleChange} required />
              </div>
            )}

            <div className="mb-3">
              <label className="form-label" htmlFor="login-username">Usuario</label>
              <input id="login-username" type="text" className="form-control" name="username" value={form.username} onChange={handleChange} autoComplete="username" required />
            </div>

            {modo === "LOGIN" && (
              <div className="mb-3">
                <label className="form-label" htmlFor="login-password">Contraseña</label>
                <div className="input-group">
                  <span className="input-group-text"><FaKey /></span>
                  <input id="login-password" type="password" className="form-control" name="password" value={form.password} onChange={handleChange} autoComplete="current-password" required />
                </div>
              </div>
            )}

            {modo === "REGISTRO" && (
              <div className="mb-3">
                <label className="form-label" htmlFor="registro-password">Contraseña inicial</label>
                <div className="input-group">
                  <span className="input-group-text"><FaKey /></span>
                  <input id="registro-password" type="password" className="form-control" name="password" value={form.password} onChange={handleChange} autoComplete="new-password" required />
                </div>
                <div className="form-text">Mínimo {MIN_PASSWORD_LEN} caracteres.</div>
              </div>
            )}

            {modo === "CAMBIO" && (
              <>
                <div className="alert alert-warning small py-2">
                  Por seguridad, debes confirmar tu contraseña actual antes de registrar una nueva.
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="cambio-password-actual">Contraseña actual</label>
                  <div className="input-group">
                    <span className="input-group-text"><FaKey /></span>
                    <input
                      id="cambio-password-actual"
                      type="password"
                      className="form-control"
                      name="password_actual"
                      value={form.password_actual}
                      onChange={handleChange}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="cambio-password-nueva">Nueva contraseña</label>
                  <div className="input-group">
                    <span className="input-group-text"><FaKey /></span>
                    <input
                      id="cambio-password-nueva"
                      type="password"
                      className="form-control"
                      name="password_nuevo"
                      value={form.password_nuevo}
                      onChange={handleChange}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                  <div className="form-text">Mínimo {MIN_PASSWORD_LEN} caracteres.</div>
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="cambio-password-confirmacion">Confirmar nueva contraseña</label>
                  <div className="input-group">
                    <span className="input-group-text"><FaKey /></span>
                    <input
                      id="cambio-password-confirmacion"
                      type="password"
                      className="form-control"
                      name="password_confirmacion"
                      value={form.password_confirmacion}
                      onChange={handleChange}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </div>
              </>
            )}

            <button type="submit" className="btn btn-primary w-100 py-2 fw-bold shadow-sm">
              {modo === "LOGIN" ? "INGRESAR AL SISTEMA" : modo === "REGISTRO" ? "ENVIAR SOLICITUD" : "CAMBIAR CONTRASEÑA"}
            </button>
          </form>

          <div className="text-center mt-3 pt-3 border-top">
            {modo === "LOGIN" ? (
              <small>
                ¿No tienes cuenta?{" "}
                <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => switchModo("REGISTRO")}>
                  Solicitar acceso
                </button>
                {" | "}
                <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => switchModo("CAMBIO")}>
                  Cambiar contraseña
                </button>
              </small>
            ) : modo === "REGISTRO" ? (
              <small>
                ¿Ya tienes cuenta?{" "}
                <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => switchModo("LOGIN")}>
                  Iniciar sesión
                </button>
              </small>
            ) : (
              <small>
                Volver a{" "}
                <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => switchModo("LOGIN")}>
                  Iniciar sesión
                </button>
              </small>
            )}
          </div>
        </div>
      </MunicipalBackdrop>
    </div>
  );
};

export default LoginPage;
