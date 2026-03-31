import { useState } from "react";
import api from "../api";

const toNumber = (value, fallback = 0) => {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ModalDeuda = ({ usuario, cerrarModal, alGuardar, darkMode }) => {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [cargando, setCargando] = useState(false);

  const tarifasBase = {
    agua: toNumber(usuario?.tarifa_agua, 7.5),
    desague: toNumber(usuario?.tarifa_desague, 3.5),
    limpieza: toNumber(usuario?.tarifa_limpieza, 3.5),
    admin: toNumber(usuario?.tarifa_admin, 0.5),
    extra: toNumber(usuario?.tarifa_extra, 0)
  };

  const [form, setForm] = useState({
    agua: tarifasBase.agua.toFixed(2),
    desague: tarifasBase.desague.toFixed(2),
    limpieza: tarifasBase.limpieza.toFixed(2),
    admin: tarifasBase.admin.toFixed(2),
    extra: tarifasBase.extra.toFixed(2)
  });

  const [servicios, setServicios] = useState({
    agua: true,
    desague: true,
    limpieza: true,
    admin: true,
    extra: tarifasBase.extra > 0
  });

  const toggleServicio = (key) => {
    setServicios((prev) => {
      const next = !prev[key];
      setForm((prevForm) => {
        if (!next) return { ...prevForm, [key]: "0.00" };
        const actual = toNumber(prevForm[key], 0);
        const restored = actual > 0 ? prevForm[key] : tarifasBase[key].toFixed(2);
        return { ...prevForm, [key]: restored };
      });
      return { ...prev, [key]: next };
    });
  };

  const montos = {
    agua: servicios.agua ? toNumber(form.agua, 0) : 0,
    desague: servicios.desague ? toNumber(form.desague, 0) : 0,
    limpieza: servicios.limpieza ? toNumber(form.limpieza, 0) : 0,
    admin: (servicios.admin ? toNumber(form.admin, 0) : 0) + (servicios.extra ? toNumber(form.extra, 0) : 0)
  };
  const totalServicios = Object.values(montos).reduce((sum, v) => sum + v, 0);

  const guardarDeuda = async () => {
    setCargando(true);
    try {
      if (totalServicios <= 0) {
        alert("Debe seleccionar al menos un servicio o extra.");
        setCargando(false);
        return;
      }
      await api.post("/recibos", {
        id_contribuyente: usuario.id_contribuyente,
        anio,
        mes,
        montos
      });
      alert(`Deuda registrada correctamente para ${usuario.nombre_completo}`);
      alGuardar();
      cerrarModal();
    } catch (error) {
      alert(error.response?.data?.error || "Error al registrar deuda");
    } finally {
      setCargando(false);
    }
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-primary text-white"}`;
  const inputClass = `form-control ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const selectClass = `form-select ${darkMode ? "bg-dark text-white border-secondary" : ""}`;

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className="modal-title">Registrar Deuda Individual</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            <p className="mb-3">
              Contribuyente: <strong>{usuario.nombre_completo}</strong><br />
              <span className="small opacity-75">Codigo: {usuario.codigo_municipal}</span>
            </p>

            <div className="row g-3">
              <div className="col-6">
                <label className="form-label">Anio</label>
                <input type="number" className={inputClass} value={anio} onChange={(e) => setAnio(e.target.value)} />
              </div>
              <div className="col-6">
                <label className="form-label">Mes</label>
                <select className={selectClass} value={mes} onChange={(e) => setMes(e.target.value)}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                    <option key={m} value={m}>{["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][m]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={`mt-3 border rounded p-2 ${darkMode ? "bg-dark border-secondary" : "bg-light"}`}>
              <div className="small fw-bold text-center text-primary">Servicios a Cobrar</div>

              <div className="d-flex align-items-center justify-content-between mt-2 gap-2">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="svc-agua" checked={servicios.agua} onChange={() => toggleServicio("agua")} />
                  <label className="form-check-label" htmlFor="svc-agua">Agua Potable</label>
                </div>
                <input type="number" step="0.01" min="0" className={`${inputClass} text-end`} style={{ maxWidth: "120px" }} value={form.agua} onChange={(e) => setForm((p) => ({ ...p, agua: e.target.value }))} disabled={!servicios.agua} />
              </div>

              <div className="d-flex align-items-center justify-content-between mt-1 gap-2">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="svc-desague" checked={servicios.desague} onChange={() => toggleServicio("desague")} />
                  <label className="form-check-label" htmlFor="svc-desague">Desague</label>
                </div>
                <input type="number" step="0.01" min="0" className={`${inputClass} text-end`} style={{ maxWidth: "120px" }} value={form.desague} onChange={(e) => setForm((p) => ({ ...p, desague: e.target.value }))} disabled={!servicios.desague} />
              </div>

              <div className="d-flex align-items-center justify-content-between mt-1 gap-2">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="svc-limpieza" checked={servicios.limpieza} onChange={() => toggleServicio("limpieza")} />
                  <label className="form-check-label" htmlFor="svc-limpieza">Limpieza Publica</label>
                </div>
                <input type="number" step="0.01" min="0" className={`${inputClass} text-end`} style={{ maxWidth: "120px" }} value={form.limpieza} onChange={(e) => setForm((p) => ({ ...p, limpieza: e.target.value }))} disabled={!servicios.limpieza} />
              </div>

              <div className="d-flex align-items-center justify-content-between mt-1 gap-2">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="svc-admin" checked={servicios.admin} onChange={() => toggleServicio("admin")} />
                  <label className="form-check-label" htmlFor="svc-admin">Gastos Administrativos</label>
                </div>
                <input type="number" step="0.01" min="0" className={`${inputClass} text-end`} style={{ maxWidth: "120px" }} value={form.admin} onChange={(e) => setForm((p) => ({ ...p, admin: e.target.value }))} disabled={!servicios.admin} />
              </div>

              <div className="d-flex align-items-center justify-content-between mt-1 gap-2">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="svc-extra" checked={servicios.extra} onChange={() => toggleServicio("extra")} />
                  <label className="form-check-label" htmlFor="svc-extra">Extra</label>
                </div>
                <input type="number" step="0.01" min="0" className={`${inputClass} text-end`} style={{ maxWidth: "120px" }} value={form.extra} onChange={(e) => setForm((p) => ({ ...p, extra: e.target.value }))} disabled={!servicios.extra} />
              </div>

              <div className="text-end fw-bold mt-2">Total a cobrar: S/ {totalServicios.toFixed(2)}</div>
            </div>
          </div>
          <div className={`modal-footer ${darkMode ? "border-secondary" : ""}`}>
            <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cancelar</button>
            <button type="button" className="btn btn-success" onClick={guardarDeuda} disabled={cargando}>
              {cargando ? "Procesando..." : "Generar Recibo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalDeuda;
