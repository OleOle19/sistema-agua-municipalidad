import { useState } from "react";
import api from "../api";
import { FaUserShield, FaKey, FaUserPlus } from "react-icons/fa";

const LoginPage = ({ onLoginSuccess }) => {
  const [modo, setModo] = useState("LOGIN"); // 'LOGIN' o 'REGISTRO'
  const [form, setForm] = useState({ username: "", password: "", nombre_completo: "" });
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setMensaje("");

    try {
      if (modo === "LOGIN") {
        const res = await api.post("/auth/login", {
          username: form.username,
          password: form.password
        });
        if (res.data?.token) {
          localStorage.setItem("token", res.data.token);
        }
        // Si el login es exitoso, pasamos los datos del usuario al componente Padre (App)
        onLoginSuccess(res.data);
      } else {
        const res = await api.post("/auth/registro", form);
        setMensaje(res.data.mensaje);
        setModo("LOGIN"); // Volver al login para que espere
        setForm({ username: "", password: "", nombre_completo: "" });
      }
    } catch (err) {
      setError(err.response?.data?.error || "Error de conexión");
    }
  };

  return (
    <div className="d-flex justify-content-center align-items-center vh-100 bg-light">
      <div className="card shadow-lg p-4" style={{ width: "400px" }}>
        <div className="text-center mb-4">
          <div className="bg-primary text-white rounded-circle d-inline-flex p-3 mb-2">
            <FaUserShield size={40} />
          </div>
          <h3 className="fw-bold text-primary">Sistema Agua Potable</h3>
          <p className="text-muted small">Municipalidad Distrital de Pueblo Nuevo</p>
        </div>

        {error && <div className="alert alert-danger text-center small">{error}</div>}
        {mensaje && <div className="alert alert-success text-center small">{mensaje}</div>}

        <form onSubmit={handleSubmit}>
          {modo === "REGISTRO" && (
            <div className="mb-3">
              <label className="form-label">Nombre Completo</label>
              <input type="text" className="form-control" name="nombre_completo" value={form.nombre_completo} onChange={handleChange} required />
            </div>
          )}
          
          <div className="mb-3">
            <label className="form-label">Usuario</label>
            <input type="text" className="form-control" name="username" value={form.username} onChange={handleChange} required />
          </div>
          
          <div className="mb-3">
            <label className="form-label">Contraseña</label>
            <div className="input-group">
              <span className="input-group-text"><FaKey/></span>
              <input type="password" className="form-control" name="password" value={form.password} onChange={handleChange} required />
            </div>
          </div>

          <button type="submit" className="btn btn-primary w-100 py-2 fw-bold shadow-sm">
            {modo === "LOGIN" ? "INGRESAR AL SISTEMA" : "ENVIAR SOLICITUD"}
          </button>
        </form>

        <div className="text-center mt-3 pt-3 border-top">
          {modo === "LOGIN" ? (
            <small>
              ¿No tienes cuenta? <a href="#" onClick={(e) => {e.preventDefault(); setModo("REGISTRO"); setError("");}}>Solicitar acceso</a>
            </small>
          ) : (
             <small>
              ¿Ya tienes cuenta? <a href="#" onClick={(e) => {e.preventDefault(); setModo("LOGIN"); setError("");}}>Iniciar Sesión</a>
            </small>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
