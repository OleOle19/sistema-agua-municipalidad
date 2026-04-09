import { useEffect, useMemo, useState } from "react";
import api from "../api";
import { FaCut, FaFilePdf, FaPrint } from "react-icons/fa";
import { compareByDireccionAsc } from "../utils/cortesAddress";

const ESTADOS_CONEXION = {
  CON_CONEXION: "CON_CONEXION",
  SIN_CONEXION: "SIN_CONEXION",
  CORTADO: "CORTADO"
};

const normalizeEstadoConexion = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (["CON_CONEXION", "CONEXION", "ACTIVO", "CONECTADO"].includes(raw)) return ESTADOS_CONEXION.CON_CONEXION;
  if (["SIN_CONEXION", "SIN CONEXION", "SIN_SERVICIO", "NO_CONECTADO"].includes(raw)) return ESTADOS_CONEXION.SIN_CONEXION;
  if (["CORTADO", "CORTE", "SUSPENDIDO", "SUSPENSION"].includes(raw)) return ESTADOS_CONEXION.CORTADO;
  return ESTADOS_CONEXION.CON_CONEXION;
};

const STATUS_META = {
  CORTADO: {
    titulo: "Reporte de Cortados",
    claseBtn: "btn-danger",
    claseOutline: "btn-outline-danger",
    etiqueta: "Cortado"
  },
  CON_CONEXION: {
    titulo: "Reporte de Conexión Activa",
    claseBtn: "btn-success",
    claseOutline: "btn-outline-success",
    etiqueta: "Con conexión"
  },
  SIN_CONEXION: {
    titulo: "Reporte de Sin Conexión",
    claseBtn: "btn-secondary",
    claseOutline: "btn-outline-secondary",
    etiqueta: "Sin conexión"
  }
};

const ModalReporteCortes = ({
  cerrarModal,
  contribuyentes = [],
  selectedIds = [],
  onImprimir,
  darkMode,
  estadoObjetivo = ESTADOS_CONEXION.CORTADO
}) => {
  const estadoFiltro = Object.prototype.hasOwnProperty.call(STATUS_META, estadoObjetivo)
    ? estadoObjetivo
    : ESTADOS_CONEXION.CORTADO;
  const meta = STATUS_META[estadoFiltro];

  const [modo, setModo] = useState("manual");
  const [manualIds, setManualIds] = useState(new Set(selectedIds));
  const [calles, setCalles] = useState([]);
  const [idCalle, setIdCalle] = useState("");
  const [procesando, setProcesando] = useState(false);

  const usuariosBase = useMemo(() => {
    const rows = Array.isArray(contribuyentes) ? contribuyentes : [];
    return rows
      .filter((item) => normalizeEstadoConexion(item?.estado_conexion) === estadoFiltro)
      .slice()
      .sort(compareByDireccionAsc);
  }, [contribuyentes, estadoFiltro]);

  useEffect(() => {
    const filtrados = new Set(usuariosBase.map((m) => Number(m.id_contribuyente)));
    setManualIds((prev) => {
      const next = new Set();
      for (const id of selectedIds) {
        const n = Number(id);
        if (filtrados.has(n)) next.add(n);
      }
      if (next.size > 0) return next;
      for (const id of prev) {
        if (filtrados.has(Number(id))) next.add(Number(id));
      }
      return next;
    });
  }, [selectedIds, usuariosBase]);

  useEffect(() => {
    const cargarCalles = async () => {
      try {
        const res = await api.get("/calles");
        setCalles(Array.isArray(res.data) ? res.data : []);
      } catch {
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
    else if (modo === "calle") rows = idCalle ? usuariosBase.filter((m) => String(m.id_calle || "") === String(idCalle)) : [];
    else rows = usuariosBase.filter((m) => manualIds.has(Number(m.id_contribuyente)));
    return rows.slice().sort(compareByDireccionAsc);
  }, [modo, usuariosBase, idCalle, manualIds]);

  const totalDeuda = useMemo(
    () => seleccion.reduce((acc, item) => acc + (parseFloat(item.deuda_anio) || 0), 0),
    [seleccion]
  );

  const criterioDescripcion = useMemo(() => {
    if (modo === "todos") return `Todos (${meta.etiqueta})`;
    if (modo === "calle") return calleNombre ? `${meta.etiqueta} por calle: ${calleNombre}` : `${meta.etiqueta} por calle`;
    return `Seleccion manual (${meta.etiqueta})`;
  }, [modo, calleNombre, meta.etiqueta]);

  const prepararReporte = async (formato) => {
    if (seleccion.length === 0) {
      alert("No hay usuarios seleccionados para el reporte.");
      return;
    }
    const ids = seleccion
      .map((row) => Number(row.id_contribuyente))
      .filter((id) => Number.isInteger(id) && id > 0);

    setProcesando(true);
    try {
      const requiereResumenCorte = estadoFiltro === ESTADOS_CONEXION.CORTADO;
      let resumenItems = [];
      if (requiereResumenCorte && ids.length > 0) {
        const resumenRes = await api.post("/contribuyentes/cortes/resumen", {
          ids_contribuyentes: ids
        });
        resumenItems = Array.isArray(resumenRes?.data?.items) ? resumenRes.data.items : [];
      }
      const resumenMap = new Map(
        resumenItems.map((item) => [Number(item.id_contribuyente), item])
      );
      const listaFinal = seleccion.map((row) => {
        if (!requiereResumenCorte) {
          return { ...row };
        }
        const resumen = resumenMap.get(Number(row.id_contribuyente)) || null;
        const evidencias = Array.isArray(resumen?.evidencias) ? resumen.evidencias : [];
        return {
          ...row,
          corte_fecha: resumen?.fecha_evento || null,
          corte_motivo: resumen?.motivo || row?.estado_conexion_motivo_ultimo || "",
          evidencia_resumen: evidencias.length > 0
            ? evidencias.map((ev) => String(ev.archivo_nombre || "").trim()).filter(Boolean).join(" | ")
            : "Sin evidencia adjunta"
        };
      });

      onImprimir?.({
        lista: listaFinal,
        criterio: {
          tipo: modo,
          descripcion: criterioDescripcion,
          estado_objetivo: estadoFiltro,
          estado_label: meta.etiqueta
        },
        formato,
        mostrar_evidencia: formato === "pdf" && requiereResumenCorte,
        generado_en: new Date().toISOString()
      });
    } catch (error) {
      alert(error?.response?.data?.error || "No se pudo preparar el reporte.");
    } finally {
      setProcesando(false);
    }
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff" } : {};
  const inputClass = darkMode ? "form-select bg-dark text-white border-secondary" : "form-select";
  const cardClass = darkMode ? "border border-secondary rounded p-2 bg-dark text-white" : "border rounded p-2";

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content" style={modalStyle}>
          <div className="modal-header">
            <h5 className="modal-title"><FaCut className="me-2" /> {meta.titulo}</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>

          <div className="modal-body">
            <div className={`${cardClass} mb-3`}>
              <div className="small fw-bold mb-2">Estado objetivo</div>
              <button type="button" className={`btn btn-sm ${meta.claseBtn}`}>
                {meta.etiqueta} ({usuariosBase.length})
              </button>
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
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setManualIds(new Set(selectedIds.map((id) => Number(id)).filter((id) => usuariosBase.some((u) => Number(u.id_contribuyente) === id))))}>
                    Usar seleccion actual ({selectedIds.length})
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setManualIds(new Set(usuariosBase.map((m) => Number(m.id_contribuyente))))}>
                    Marcar todos
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setManualIds(new Set())}>
                    Limpiar
                  </button>
                </div>
                <div style={{ maxHeight: "220px", overflowY: "auto" }}>
                  {usuariosBase.length === 0 ? (
                    <div className="small text-muted">No hay contribuyentes para este estado.</div>
                  ) : (
                    usuariosBase.map((m) => (
                      <label key={m.id_contribuyente} className="d-flex align-items-center gap-2 small border-bottom py-1">
                        <input
                          type="checkbox"
                          checked={manualIds.has(Number(m.id_contribuyente))}
                          onChange={() => toggleManual(Number(m.id_contribuyente))}
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
                Se incluiran todos los contribuyentes del estado seleccionado.
              </div>
            )}

            <div className="alert alert-warning mt-3 mb-2">
              <div><strong>Criterio:</strong> {criterioDescripcion}</div>
              <div><strong>Orden:</strong> Calle y numero ascendente</div>
              <div><strong>Usuarios seleccionados:</strong> {seleccion.length}</div>
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
            <button type="button" className="btn btn-secondary" onClick={cerrarModal} disabled={procesando}>Cerrar</button>
            <button type="button" className={`btn ${meta.claseOutline}`} onClick={() => prepararReporte("print")} disabled={procesando}>
              <FaPrint className="me-2" />
              {procesando ? "Procesando..." : "Imprimir Reporte"}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => prepararReporte("pdf")} disabled={procesando}>
              <FaFilePdf className="me-2" />
              {procesando ? "Procesando..." : "Exportar PDF"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalReporteCortes;
