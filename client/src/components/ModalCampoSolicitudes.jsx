import { useEffect, useMemo, useState } from "react";
import api, { API_BASE_URL } from "../api";
import { FaCheck, FaClipboardCheck, FaMobileAlt, FaSyncAlt, FaTimes } from "react-icons/fa";

const ESTADO_LABELS = {
  PENDIENTE: "Pendiente",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado"
};

const FILTRO_OPTIONS = [
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "APROBADO", label: "Aprobadas" },
  { value: "RECHAZADO", label: "Rechazadas" },
  { value: "TODOS", label: "Todas" }
];

const normalizeText = (value) => String(value || "").trim().toUpperCase();
const normalizeSN = (value, fallback = "S") => {
  const normalized = normalizeText(value);
  if (normalized === "S" || normalized === "SI") return "S";
  if (normalized === "N" || normalized === "NO") return "N";
  return normalizeText(fallback) === "N" ? "N" : "S";
};
const isDifferent = (nuevo, actual) => normalizeText(nuevo) !== normalizeText(actual);

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

const renderChangeLine = (label, nuevo, actual) => (
  <div className="small" key={label}>
    <span className="fw-semibold">{label}:</span>{" "}
    <span className="text-success">{nuevo || "-"}</span>{" "}
    <span className="opacity-75">antes:</span>{" "}
    <span className="opacity-75">{actual || "-"}</span>
  </div>
);

const estadoBadgeClass = (estado) => {
  if (estado === "APROBADO") return "bg-success";
  if (estado === "RECHAZADO") return "bg-danger";
  return "bg-warning text-dark";
};

const ModalCampoSolicitudes = ({ cerrarModal, darkMode, onAplicado, campoAppUrl }) => {
  const [filtroEstado, setFiltroEstado] = useState("PENDIENTE");
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [procesandoId, setProcesandoId] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const cargarSolicitudes = async () => {
    try {
      setCargando(true);
      setError("");
      const params = { limit: 300 };
      if (filtroEstado !== "TODOS") params.estado = filtroEstado;
      const res = await api.get("/campo/solicitudes", { params });
      setSolicitudes(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err?.response?.data?.error || "No se pudo cargar la bandeja de campo.");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarSolicitudes();
  }, [filtroEstado]);

  const procesarSolicitud = async (solicitud, accion) => {
    const id = Number(solicitud?.id_solicitud);
    if (!Number.isInteger(id) || id <= 0) return;

    let payload = {};
    if (accion === "aprobar") {
      const nota = window.prompt("Nota de aprobacion (opcional):", "");
      if (nota === null) return;
      payload = { motivo_revision: nota.trim() };
    } else {
      const motivo = window.prompt("Motivo de rechazo (obligatorio):", "");
      if (motivo === null) return;
      if (!motivo.trim()) {
        alert("Debe escribir el motivo de rechazo.");
        return;
      }
      payload = { motivo_revision: motivo.trim() };
    }

    try {
      setProcesandoId(id);
      setError("");
      setMensaje("");
      await api.post(`/campo/solicitudes/${id}/${accion}`, payload);
      setMensaje(accion === "aprobar" ? "Solicitud aprobada y aplicada." : "Solicitud rechazada.");
      await cargarSolicitudes();
      if (onAplicado) onAplicado();
    } catch (err) {
      setError(err?.response?.data?.error || "No se pudo procesar la solicitud.");
    } finally {
      setProcesandoId(null);
    }
  };

  const rows = useMemo(() => solicitudes.map((s) => {
    const changes = [];
    const metadata = s?.metadata && typeof s.metadata === "object" ? s.metadata : {};
    const aguaActual = normalizeSN(s?.agua_actual_db, metadata.servicio_agua_actual || "S");
    const desagueActual = normalizeSN(s?.desague_actual_db, metadata.servicio_desague_actual || "S");
    const limpiezaActual = normalizeSN(s?.limpieza_actual_db, metadata.servicio_limpieza_actual || "S");
    const aguaNuevo = normalizeSN(metadata.servicio_agua_nuevo, aguaActual);
    const desagueNuevo = normalizeSN(metadata.servicio_desague_nuevo, desagueActual);
    const limpiezaNuevo = normalizeSN(metadata.servicio_limpieza_nuevo, limpiezaActual);
    if (s?.nombre_verificado && isDifferent(s.nombre_verificado, s.nombre_actual_db)) {
      changes.push(renderChangeLine("Nombre", s.nombre_verificado, s.nombre_actual_db));
    }
    if (s?.dni_verificado && isDifferent(s.dni_verificado, s.dni_actual_db)) {
      changes.push(renderChangeLine("DNI/RUC", s.dni_verificado, s.dni_actual_db));
    }
    if (s?.telefono_verificado && isDifferent(s.telefono_verificado, s.telefono_actual_db)) {
      changes.push(renderChangeLine("Telefono", s.telefono_verificado, s.telefono_actual_db));
    }
    if (s?.direccion_verificada && isDifferent(s.direccion_verificada, s.direccion_actual_db)) {
      changes.push(renderChangeLine("Direccion", s.direccion_verificada, s.direccion_actual_db));
    }
    if (normalizeText(s.estado_conexion_nuevo) !== normalizeText(s.estado_actual_db)) {
      changes.push(renderChangeLine("Estado conexion", s.estado_conexion_nuevo, s.estado_actual_db));
    }
    if (isDifferent(aguaNuevo, aguaActual)) {
      changes.push(renderChangeLine("Servicio agua", aguaNuevo, aguaActual));
    }
    if (isDifferent(desagueNuevo, desagueActual)) {
      changes.push(renderChangeLine("Servicio desague", desagueNuevo, desagueActual));
    }
    if (isDifferent(limpiezaNuevo, limpiezaActual)) {
      changes.push(renderChangeLine("Servicio limpieza", limpiezaNuevo, limpiezaActual));
    }

    return {
      solicitud: s,
      changes,
      metadata,
      servicios: { aguaNuevo, desagueNuevo, limpiezaNuevo }
    };
  }), [solicitudes]);

  const modalContentClass = `modal-content ${darkMode ? "text-white" : ""}`;
  const modalContentStyle = darkMode ? { backgroundColor: "#2b3035", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-primary text-white"}`;
  const closeBtnClass = `btn-close ${darkMode ? "btn-close-white" : "btn-close-white"}`;
  const tableClass = `table mb-0 ${darkMode ? "table-dark table-hover" : "table-hover"}`;
  const inputClass = `form-select form-select-sm ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const campoHref = campoAppUrl || `${API_BASE_URL}/campo-app/`;

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
      <div className="modal-dialog modal-xl">
        <div className={modalContentClass} style={modalContentStyle}>
          <div className={headerClass}>
            <h5 className="modal-title d-flex align-items-center gap-2">
              <FaClipboardCheck /> Bandeja de Solicitudes de Campo
            </h5>
            <button type="button" className={closeBtnClass} onClick={cerrarModal}></button>
          </div>

          <div className="modal-body p-0">
            <div className={`p-3 border-bottom d-flex flex-wrap align-items-center gap-2 ${darkMode ? "border-secondary" : ""}`}>
              <select
                className={inputClass}
                style={{ maxWidth: "180px" }}
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value)}
              >
                {FILTRO_OPTIONS.map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
              <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={cargarSolicitudes} disabled={cargando}>
                <FaSyncAlt /> Recargar
              </button>
              <a href={campoHref} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-info d-flex align-items-center gap-1">
                <FaMobileAlt /> Abrir App Campo
              </a>
              <div className="ms-auto small opacity-75">
                Total: <strong>{solicitudes.length}</strong>
              </div>
            </div>

            {mensaje && <div className="alert alert-success m-3 py-2 small">{mensaje}</div>}
            {error && <div className="alert alert-danger m-3 py-2 small">{error}</div>}

            <div className="table-responsive" style={{ maxHeight: "65vh" }}>
              <table className={tableClass}>
                <thead className={darkMode ? "" : "table-light"}>
                  <tr>
                    <th>Fecha</th>
                    <th>Contribuyente</th>
                    <th>Solicitud</th>
                    <th>Cambios</th>
                    <th>Estado</th>
                    <th style={{ minWidth: "170px" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {cargando ? (
                    <tr><td colSpan="6" className="text-center py-3">Cargando solicitudes...</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan="6" className="text-center py-3">No hay solicitudes para este filtro.</td></tr>
                  ) : rows.map(({ solicitud: s, changes, metadata, servicios }) => {
                    const pending = s.estado_solicitud === "PENDIENTE";
                    const disabled = procesandoId === s.id_solicitud;
                    return (
                      <tr key={s.id_solicitud}>
                        <td className="small align-top">
                          <div>{formatDateTime(s.creado_en)}</div>
                          <div className="opacity-75">Rev: {formatDateTime(s.revisado_en)}</div>
                        </td>
                        <td className="align-top">
                          <div className="fw-bold">{s.codigo_municipal || "-"}</div>
                          <div>{s.nombre_actual_db || "-"}</div>
                          <div className="small opacity-75">Solicita: {s.nombre_solicitante || "Usuario"}</div>
                        </td>
                        <td className="small align-top">
                          <div>
                            Estado: <strong>{s.estado_conexion_actual}</strong> {"->"} <strong>{s.estado_conexion_nuevo}</strong>
                          </div>
                          <div className="mt-1">
                            Visitado: <strong>{metadata.visitado_sn || "N"}</strong> | Cortado: <strong>{metadata.cortado_sn || "N"}</strong>
                          </div>
                          <div className="mt-1">
                            Servicios: Agua <strong>{servicios.aguaNuevo}</strong> | Desague <strong>{servicios.desagueNuevo}</strong> | Limpieza <strong>{servicios.limpiezaNuevo}</strong>
                          </div>
                          <div className="mt-1">
                            Fecha corte: <strong>{metadata.fecha_corte || "-"}</strong> | Inspector: <strong>{metadata.inspector || "-"}</strong>
                          </div>
                          <div className="mt-1">
                            Meses deuda: <strong>{metadata.meses_deuda ?? "-"}</strong> | Deuda: <strong>S/. {Number(metadata.deuda_total || 0).toFixed(2)}</strong>
                          </div>
                          <div className="mt-1 opacity-75">{s.observacion_campo || "Sin observacion."}</div>
                          {s.motivo_revision && <div className="mt-1 text-info">Revision: {s.motivo_revision}</div>}
                        </td>
                        <td className="align-top">
                          {changes.length > 0 ? changes : <span className="small opacity-75">Sin cambios de ficha.</span>}
                        </td>
                        <td className="align-top">
                          <span className={`badge ${estadoBadgeClass(s.estado_solicitud)}`}>
                            {ESTADO_LABELS[s.estado_solicitud] || s.estado_solicitud}
                          </span>
                        </td>
                        <td className="align-top">
                          {pending ? (
                            <div className="d-flex gap-2">
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-success d-flex align-items-center gap-1"
                                disabled={disabled}
                                onClick={() => procesarSolicitud(s, "aprobar")}
                              >
                                <FaCheck /> Aprobar
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1"
                                disabled={disabled}
                                onClick={() => procesarSolicitud(s, "rechazar")}
                              >
                                <FaTimes /> Rechazar
                              </button>
                            </div>
                          ) : (
                            <span className="small opacity-75">Procesada</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className={`modal-footer ${darkMode ? "border-secondary" : ""}`}>
            <button type="button" className={`btn ${darkMode ? "btn-secondary" : "btn-dark"}`} onClick={cerrarModal}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalCampoSolicitudes;
