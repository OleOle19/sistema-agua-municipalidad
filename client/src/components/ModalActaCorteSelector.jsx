import { useEffect, useMemo, useState } from "react";
import api from "../api";
import { FaFileInvoiceDollar } from "react-icons/fa";
import { compareByDireccionAsc } from "../utils/cortesAddress";

const esDeudor = (c) => {
  const meses = Number(c?.meses_deuda || 0);
  const deuda = parseFloat(c?.deuda_anio || 0) || 0;
  return meses > 0 || deuda > 0;
};

const ModalActaCorteSelector = ({
  cerrarModal,
  contribuyentes = [],
  selectedIds = [],
  onConfirmar,
  darkMode,
  loading = false
}) => {
  const [modo, setModo] = useState("manual");
  const [manualIds, setManualIds] = useState(new Set(selectedIds));
  const [calles, setCalles] = useState([]);
  const [idCalle, setIdCalle] = useState("");
  const [sector, setSector] = useState("");

  const deudores = useMemo(() => {
    const rows = Array.isArray(contribuyentes) ? contribuyentes.filter(esDeudor) : [];
    return rows.slice().sort(compareByDireccionAsc);
  }, [contribuyentes]);

  const sectores = useMemo(() => {
    const unique = new Set();
    deudores.forEach((d) => {
      const raw = String(d?.sec_nombre || "").trim();
      if (raw) unique.add(raw);
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b, "es"));
  }, [deudores]);

  useEffect(() => {
    const cargarCalles = async () => {
      try {
        const res = await api.get("/calles");
        setCalles(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        setCalles([]);
      }
    };
    cargarCalles();
  }, []);

  const calleNombre = useMemo(() => {
    const c = calles.find((x) => String(x.id_calle) === String(idCalle));
    return c?.nombre || "";
  }, [calles, idCalle]);

  const seleccion = useMemo(() => {
    if (modo === "todos") return deudores;
    if (modo === "calle") return idCalle ? deudores.filter((m) => String(m.id_calle || "") === String(idCalle)) : [];
    if (modo === "sector") return sector ? deudores.filter((m) => String(m.sec_nombre || "").trim() === String(sector).trim()) : [];
    return deudores.filter((m) => manualIds.has(m.id_contribuyente));
  }, [modo, deudores, idCalle, sector, manualIds]);

  const criterioDescripcion = useMemo(() => {
    if (modo === "todos") return "Todos los deudores";
    if (modo === "calle") return calleNombre ? `Deudores por calle: ${calleNombre}` : "Deudores por calle";
    if (modo === "sector") return sector ? `Deudores por sector: ${sector}` : "Deudores por sector";
    return "Seleccion manual de deudores";
  }, [modo, calleNombre, sector]);

  const totalDeuda = useMemo(
    () => seleccion.reduce((acc, item) => acc + (parseFloat(item.deuda_anio) || 0), 0),
    [seleccion]
  );

  const toggleManual = (id) => {
    setManualIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmar = () => {
    const ids = seleccion
      .map((m) => Number(m.id_contribuyente))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length === 0) {
      alert("No hay deudores seleccionados para generar actas.");
      return;
    }
    onConfirmar?.(ids, criterioDescripcion);
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff" } : {};
  const inputClass = darkMode ? "form-select bg-dark text-white border-secondary" : "form-select";
  const cardClass = darkMode ? "border border-secondary rounded p-2 bg-dark text-white" : "border rounded p-2";

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content" style={modalStyle}>
          <div className="modal-header">
            <h5 className="modal-title"><FaFileInvoiceDollar className="me-2" /> Seleccionar Deudores para Acta</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>

          <div className="modal-body">
            <div className="d-flex flex-wrap gap-2 mb-3">
              <button type="button" className={`btn btn-sm ${modo === "manual" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setModo("manual")}>
                Manual
              </button>
              <button type="button" className={`btn btn-sm ${modo === "calle" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setModo("calle")}>
                Por Calle
              </button>
              <button type="button" className={`btn btn-sm ${modo === "sector" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setModo("sector")}>
                Por Sector
              </button>
              <button type="button" className={`btn btn-sm ${modo === "todos" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setModo("todos")}>
                Todos
              </button>
            </div>

            {modo === "manual" && (
              <div className={cardClass}>
                <div className="d-flex gap-2 mb-2">
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setManualIds(new Set(selectedIds))}>
                    Usar seleccion actual ({selectedIds.length})
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setManualIds(new Set(deudores.map((m) => m.id_contribuyente)))}>
                    Marcar todos deudores
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setManualIds(new Set())}>
                    Limpiar
                  </button>
                </div>
                <div style={{ maxHeight: "220px", overflowY: "auto" }}>
                  {deudores.length === 0 ? (
                    <div className="small text-muted">No hay deudores para seleccionar.</div>
                  ) : (
                    deudores.map((m) => (
                      <label key={m.id_contribuyente} className="d-flex align-items-center gap-2 small border-bottom py-1">
                        <input
                          type="checkbox"
                          checked={manualIds.has(m.id_contribuyente)}
                          onChange={() => toggleManual(m.id_contribuyente)}
                        />
                        <span className="fw-bold">{m.codigo_municipal}</span>
                        <span className="text-truncate">{m.nombre_completo}</span>
                        <span className="ms-auto">S/. {parseFloat(m.deuda_anio || 0).toFixed(2)}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            {modo === "calle" && (
              <div className={cardClass}>
                <label className="form-label small fw-bold">Seleccione calle</label>
                <select className={inputClass} value={idCalle} onChange={(e) => setIdCalle(e.target.value)}>
                  <option value="">-- Seleccione --</option>
                  {calles.map((c) => (
                    <option key={c.id_calle} value={c.id_calle}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {modo === "sector" && (
              <div className={cardClass}>
                <label className="form-label small fw-bold">Seleccione sector</label>
                <select className={inputClass} value={sector} onChange={(e) => setSector(e.target.value)}>
                  <option value="">-- Seleccione --</option>
                  {sectores.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {modo === "todos" && (
              <div className={cardClass}>
                Se incluiran todos los deudores del sistema.
              </div>
            )}

            <div className="alert alert-warning mt-3 mb-2">
              <div><strong>Criterio:</strong> {criterioDescripcion}</div>
              <div><strong>Orden:</strong> Calle y numero ascendente</div>
              <div><strong>Deudores seleccionados:</strong> {seleccion.length}</div>
              <div><strong>Total deuda:</strong> S/. {totalDeuda.toFixed(2)}</div>
            </div>

            <div className="table-responsive" style={{ maxHeight: "240px" }}>
              <table className={`table table-sm ${darkMode ? "table-dark" : "table-striped"}`}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Codigo</th>
                    <th>Contribuyente</th>
                    <th>Direccion</th>
                    <th>Sector</th>
                    <th className="text-center">Meses</th>
                    <th className="text-end">Deuda</th>
                  </tr>
                </thead>
                <tbody>
                  {seleccion.length === 0 ? (
                    <tr><td colSpan="7" className="text-center py-3">Sin datos para mostrar.</td></tr>
                  ) : (
                    seleccion.map((m, idx) => (
                      <tr key={`${m.id_contribuyente}-${idx}`}>
                        <td>{idx + 1}</td>
                        <td className="fw-bold">{m.codigo_municipal}</td>
                        <td>{m.nombre_completo}</td>
                        <td>{m.direccion_completa}</td>
                        <td>{m.sec_nombre || "-"}</td>
                        <td className="text-center fw-bold text-danger">{m.meses_deuda}</td>
                        <td className="text-end fw-bold">S/. {parseFloat(m.deuda_anio || 0).toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={cerrarModal} disabled={loading}>Cerrar</button>
            <button type="button" className="btn btn-warning" onClick={confirmar} disabled={loading}>
              {loading ? "Generando..." : "Generar Actas"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalActaCorteSelector;


