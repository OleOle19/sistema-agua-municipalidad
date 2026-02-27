import { useEffect, useMemo, useState } from "react";
import api from "../api";
import { FaCut, FaPrint } from "react-icons/fa";
import { compareByDireccionAsc } from "../utils/cortesAddress";

const esDeudorParaCorte = (c) => {
  const meses = Number(c?.meses_deuda || 0);
  const deuda = parseFloat(c?.deuda_anio || 0) || 0;
  const estadoConexion = String(c?.estado_conexion || "CON_CONEXION").trim().toUpperCase();
  return (meses >= 2 || deuda > 0) && estadoConexion === "CON_CONEXION";
};

const ModalReporteCortes = ({ cerrarModal, contribuyentes = [], selectedIds = [], onImprimir, darkMode }) => {
  const [alcance, setAlcance] = useState("deudores");
  const [modo, setModo] = useState("manual");
  const [manualIds, setManualIds] = useState(new Set(selectedIds));
  const [calles, setCalles] = useState([]);
  const [idCalle, setIdCalle] = useState("");

  const usuariosBase = useMemo(() => {
    const rows = Array.isArray(contribuyentes) ? contribuyentes : [];
    const filtrados = alcance === "todos" ? rows : rows.filter(esDeudorParaCorte);
    return filtrados.slice().sort(compareByDireccionAsc);
  }, [contribuyentes, alcance]);

  const deudoresTotalesSistema = useMemo(
    () => (Array.isArray(contribuyentes) ? contribuyentes : []).filter(esDeudorParaCorte).length,
    [contribuyentes]
  );

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

  const toggleManual = (id) => {
    setManualIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const calleNombre = useMemo(() => {
    const c = calles.find((x) => String(x.id_calle) === String(idCalle));
    return c?.nombre || "";
  }, [calles, idCalle]);

  const seleccion = useMemo(() => {
    let rows = [];
    if (modo === "todos") rows = usuariosBase;
    else if (modo === "calle") {
      rows = idCalle ? usuariosBase.filter((m) => String(m.id_calle || "") === String(idCalle)) : [];
    } else {
      rows = usuariosBase.filter((m) => manualIds.has(m.id_contribuyente));
    }
    return rows.slice().sort(compareByDireccionAsc);
  }, [modo, usuariosBase, idCalle, manualIds]);

  const totalDeuda = useMemo(
    () => seleccion.reduce((acc, item) => acc + (parseFloat(item.deuda_anio) || 0), 0),
    [seleccion]
  );

  const deudoresSeleccionados = useMemo(
    () => seleccion.filter(esDeudorParaCorte).length,
    [seleccion]
  );

  const criterioDescripcion = useMemo(() => {
    const alcanceTxt = alcance === "todos" ? "todos los usuarios" : "solo deudores";
    if (modo === "todos") return alcance === "todos" ? "Todos los usuarios" : "Todos los deudores";
    if (modo === "calle") return calleNombre ? `${alcanceTxt} por calle: ${calleNombre}` : `${alcanceTxt} por calle`;
    return `Seleccion manual (${alcanceTxt})`;
  }, [modo, calleNombre, alcance]);

  const confirmarImpresion = () => {
    if (seleccion.length === 0) {
      alert("No hay usuarios seleccionados para el reporte.");
      return;
    }
    onImprimir?.({
      lista: seleccion,
      criterio: {
        tipo: modo,
        descripcion: criterioDescripcion,
        alcance
      },
      generado_en: new Date().toISOString()
    });
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff" } : {};
  const inputClass = darkMode ? "form-select bg-dark text-white border-secondary" : "form-select";
  const cardClass = darkMode ? "border border-secondary rounded p-2 bg-dark text-white" : "border rounded p-2";

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content" style={modalStyle}>
          <div className="modal-header">
            <h5 className="modal-title"><FaCut className="me-2" /> Reporte de Cortes</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>

          <div className="modal-body">
            <div className={`${cardClass} mb-3`}>
              <div className="small fw-bold mb-2">Alcance</div>
              <div className="d-flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`btn btn-sm ${alcance === "deudores" ? "btn-danger" : "btn-outline-danger"}`}
                  onClick={() => setAlcance("deudores")}
                >
                  Solo deudores ({deudoresTotalesSistema})
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${alcance === "todos" ? "btn-success" : "btn-outline-success"}`}
                  onClick={() => setAlcance("todos")}
                >
                  Todos los usuarios ({Array.isArray(contribuyentes) ? contribuyentes.length : 0})
                </button>
              </div>
            </div>

            <div className="d-flex flex-wrap gap-2 mb-3">
              <button type="button" className={`btn btn-sm ${modo === "manual" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setModo("manual")}>
                Manual
              </button>
              <button type="button" className={`btn btn-sm ${modo === "calle" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setModo("calle")}>
                Por Calle
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
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setManualIds(new Set(usuariosBase.map((m) => m.id_contribuyente)))}>
                    Marcar todos {alcance === "todos" ? "usuarios" : "deudores"}
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setManualIds(new Set())}>
                    Limpiar
                  </button>
                </div>
                <div style={{ maxHeight: "220px", overflowY: "auto" }}>
                  {usuariosBase.length === 0 ? (
                    <div className="small text-muted">No hay usuarios para seleccionar con este alcance.</div>
                  ) : (
                    usuariosBase.map((m) => (
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

            {modo === "todos" && (
              <div className={cardClass}>
                {alcance === "todos"
                  ? "Se incluiran todos los usuarios del sistema."
                  : "Se incluiran todos los usuarios deudores del sistema."}
              </div>
            )}

            <div className="alert alert-warning mt-3 mb-2">
              <div><strong>Criterio:</strong> {criterioDescripcion}</div>
              <div><strong>Orden:</strong> Calle y numero ascendente (ej. Av. Grau 100 a 200)</div>
              <div><strong>Usuarios seleccionados:</strong> {seleccion.length}</div>
              {alcance === "todos" && (
                <div><strong>Deudores en seleccion:</strong> {deudoresSeleccionados}</div>
              )}
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
                    <th className="text-center">Meses</th>
                    <th className="text-end">Deuda</th>
                  </tr>
                </thead>
                <tbody>
                  {seleccion.length === 0 ? (
                    <tr><td colSpan="6" className="text-center py-3">Sin datos para mostrar.</td></tr>
                  ) : (
                    seleccion.map((m, idx) => (
                      <tr key={`${m.id_contribuyente}-${idx}`}>
                        <td>{idx + 1}</td>
                        <td className="fw-bold">{m.codigo_municipal}</td>
                        <td>{m.nombre_completo}</td>
                        <td>{m.direccion_completa}</td>
                        <td className={`text-center ${Number(m.meses_deuda || 0) > 0 ? "fw-bold text-danger" : ""}`}>{m.meses_deuda}</td>
                        <td className={`text-end ${parseFloat(m.deuda_anio || 0) > 0 ? "fw-bold" : "text-muted"}`}>
                          S/. {parseFloat(m.deuda_anio || 0).toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cerrar</button>
            <button type="button" className="btn btn-danger" onClick={confirmarImpresion}>
              <FaPrint className="me-2" />
              Imprimir Reporte
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalReporteCortes;


