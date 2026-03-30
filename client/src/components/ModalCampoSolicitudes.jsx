import { useEffect, useMemo, useState } from "react";
import api, { API_BASE_URL } from "../api";
import { FaCheck, FaClipboardCheck, FaFileDownload, FaMobileAlt, FaSyncAlt, FaTimes } from "react-icons/fa";

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
const ORGANIZAR_OPTIONS = [
  { value: "FECHA", label: "Organizar: Fecha" },
  { value: "CALLE", label: "Organizar: Calle" }
];
const ORDEN_GRUPO_OPTIONS = {
  FECHA: [
    { value: "DESC", label: "Grupos: fecha reciente primero" },
    { value: "ASC", label: "Grupos: fecha antigua primero" }
  ],
  CALLE: [
    { value: "ASC", label: "Grupos: calle A-Z" },
    { value: "DESC", label: "Grupos: calle Z-A" }
  ]
};
const ORDEN_ITEMS_OPTIONS = [
  { value: "DESC", label: "Solicitudes: recientes primero" },
  { value: "ASC", label: "Solicitudes: antiguas primero" }
];
const TIPO_SOLICITUD_LABELS = {
  ACTUALIZACION: "Actualizacion ficha",
  ALTA_DIRECCION_ALTERNA: "Alta direccion alterna",
  ALTA_PREDIO: "Alta predio nuevo",
  ALTA_PREDIO_TEMPORAL: "Alta predio temporal"
};

const normalizeText = (value) => String(value || "").trim().toUpperCase();
const normalizeSN = (value, fallback = "S") => {
  const normalized = normalizeText(value);
  if (normalized === "S" || normalized === "SI") return "S";
  if (normalized === "N" || normalized === "NO") return "N";
  return normalizeText(fallback) === "N" ? "N" : "S";
};
const seguimientoMotivoLabel = (value) => {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (raw === "NO_VISITADO") return "No visitado";
  if (raw === "NO_VERIFICADO") return "No verificado";
  if (raw === "OBSERVACION") return "Con observacion";
  if (raw === "NO_VISITADO|OBSERVACION" || raw === "NO_VISITADO_Y_OBSERVACION") return "No visitado + observacion";
  if (raw.includes("NO_VERIFICADO") && raw.includes("OBSERVACION")) return "No verificado + observacion";
  if (raw.includes("NO_VERIFICADO") && raw.includes("NO_VISITADO")) return "No visitado + no verificado";
  return raw;
};
const verificacionMotivoLabel = (value) => {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (raw === "AUSENTE") return "Usuario ausente";
  if (raw === "DIRECCION_INCORRECTA") return "Direccion incorrecta";
  if (raw === "SIN_RECIBO") return "Sin recibo de agua";
  if (raw === "NO_UBICADO") return "No se ubico el predio";
  return raw;
};
const parseMontosList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((x) => Number.parseFloat(x))
      .filter((n) => Number.isFinite(n));
  }
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((x) => Number.parseFloat(String(x || "").trim()))
    .filter((n) => Number.isFinite(n));
};
const isDifferent = (nuevo, actual) => normalizeText(nuevo) !== normalizeText(actual);

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};
const toMs = (value) => {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
};
const buildDateGroup = (value) => {
  const ms = toMs(value);
  if (!ms) return { key: "SIN_FECHA", label: "Sin fecha", sortMs: 0 };
  const date = new Date(ms);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const key = `${y}-${m}-${d}`;
  const label = date.toLocaleDateString("es-PE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
  const sortMs = new Date(y, date.getMonth(), date.getDate()).getTime();
  return { key, label, sortMs };
};
const inferCalleFromDireccion = (direccion) => {
  const raw = String(direccion || "").trim();
  if (!raw) return "";
  const firstPart = raw.split(",")[0].trim();
  if (firstPart) return firstPart;
  return raw;
};

const renderChangeLine = (label, nuevo, actual) => (
  <div className="small" key={label}>
    <span className="fw-semibold">{label}:</span>{" "}
    <span className="text-success">{nuevo || "-"}</span>{" "}
    <span className="opacity-75">antes:</span>{" "}
    <span className="opacity-75">{actual || "-"}</span>
  </div>
);
const renderInfoLine = (label, value) => (
  <div className="small" key={label}>
    <span className="fw-semibold">{label}:</span>{" "}
    <span className="text-success">{value || "-"}</span>
  </div>
);
const csvEscape = (value) => {
  const text = String(value ?? "");
  if (/[\",\n]/.test(text)) return `"${text.replace(/\"/g, "\"\"")}"`;
  return text;
};

const estadoBadgeClass = (estado) => {
  if (estado === "APROBADO") return "bg-success";
  if (estado === "RECHAZADO") return "bg-danger";
  return "bg-warning text-dark";
};

const getSeguimientoTipo = (visitadoSN, hasObservacion) => {
  if (visitadoSN === "N" && hasObservacion) return "NO_VISITADO_Y_OBSERVACION";
  if (visitadoSN === "N") return "NO_VISITADO";
  if (hasObservacion) return "OBSERVACION";
  return "";
};

const getSeguimientoTone = (tipo, darkMode) => {
  if (!tipo) return null;
  const palette = darkMode
    ? {
      NO_VISITADO: { bg: "#4a2a1b", fg: "#ffe4d6", accent: "#fb923c", line: "#fdba74" },
      OBSERVACION: { bg: "#123245", fg: "#d9f0ff", accent: "#38bdf8", line: "#7dd3fc" },
      NO_VISITADO_Y_OBSERVACION: { bg: "#4a3a16", fg: "#fff0c2", accent: "#f59e0b", line: "#fcd34d" }
    }
    : {
      NO_VISITADO: { bg: "#ffe3d1", fg: "#1f2937", accent: "#c2410c", line: "#9a3412" },
      OBSERVACION: { bg: "#dff4ff", fg: "#0f172a", accent: "#0369a1", line: "#075985" },
      NO_VISITADO_Y_OBSERVACION: { bg: "#fff0c9", fg: "#1f2937", accent: "#b45309", line: "#92400e" }
    };
  return palette[tipo] || null;
};

const ModalCampoSolicitudes = ({ cerrarModal, darkMode, onAplicado, campoAppUrl }) => {
  const [filtroEstado, setFiltroEstado] = useState("PENDIENTE");
  const [organizarPor, setOrganizarPor] = useState("FECHA");
  const [ordenGrupo, setOrdenGrupo] = useState("DESC");
  const [ordenItems, setOrdenItems] = useState("DESC");
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [procesandoId, setProcesandoId] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const cargarSolicitudes = async () => {
    try {
      setCargando(true);
      setError("");
      const params = { limit: 2000, estado: filtroEstado };
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

  useEffect(() => {
    setOrdenGrupo(organizarPor === "CALLE" ? "ASC" : "DESC");
  }, [organizarPor]);

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
    const tipoSolicitud = normalizeText(s?.tipo_solicitud || metadata?.tipo_solicitud || "ACTUALIZACION");
    const isAltaPredio = tipoSolicitud === "ALTA_PREDIO" || tipoSolicitud === "ALTA_PREDIO_TEMPORAL";
    const verificacionEstado = normalizeText(metadata?.verificacion_estado || "VERIFICADO");
    const verificacionMotivo = normalizeText(metadata?.verificacion_motivo || "");
    const predioTemporalSN = normalizeSN(metadata?.predio_temporal_sn, "N");
    const fotoFachada = metadata?.foto_fachada_base64 || null;
    const aguaActual = normalizeSN(s?.agua_actual_db, metadata.servicio_agua_actual || "S");
    const desagueActual = normalizeSN(s?.desague_actual_db, metadata.servicio_desague_actual || "S");
    const limpiezaActual = normalizeSN(s?.limpieza_actual_db, metadata.servicio_limpieza_actual || "S");
    const aguaNuevo = normalizeSN(metadata.servicio_agua_nuevo, aguaActual);
    const desagueNuevo = normalizeSN(metadata.servicio_desague_nuevo, desagueActual);
    const limpiezaNuevo = normalizeSN(metadata.servicio_limpieza_nuevo, limpiezaActual);
    const visitadoSN = normalizeSN(metadata.visitado_sn, "N");
    const hasObservacion = Boolean(String(s?.observacion_campo || metadata?.motivo_obs || "").trim());
    const seguimientoPendiente = isAltaPredio ? false : (
      normalizeSN(metadata.seguimiento_pendiente_sn, "N") === "S" ||
      visitadoSN === "N" ||
      hasObservacion
    );
    const seguimientoMotivo = isAltaPredio ? "" : seguimientoMotivoLabel(
      metadata.seguimiento_motivo
      || (visitadoSN === "N" && hasObservacion ? "NO_VISITADO|OBSERVACION" : (visitadoSN === "N" ? "NO_VISITADO" : (hasObservacion ? "OBSERVACION" : "")))
    );
    const montosAbono = parseMontosList(metadata.montos_mensuales_24m);
    const montosAbonoTxt = montosAbono.length > 0 ? montosAbono.map((n) => n.toFixed(2)).join(", ") : "-";
    const calleRaw = String(s?.nombre_calle_db || metadata?.nombre_calle || metadata?.calle || "").trim();
    const calleLabel = calleRaw || inferCalleFromDireccion(
      s?.direccion_actual_db || s?.direccion_verificada || metadata?.referencia_direccion
    ) || "Sin calle";
    if (isAltaPredio) {
      if (s?.direccion_verificada) changes.push(renderInfoLine("Direccion", s.direccion_verificada));
      if (metadata?.referencia_direccion) changes.push(renderInfoLine("Referencia", metadata.referencia_direccion));
      if (s?.nombre_verificado) changes.push(renderInfoLine("Nombre", s.nombre_verificado));
      if (s?.dni_verificado) changes.push(renderInfoLine("DNI/RUC", s.dni_verificado));
      if (s?.telefono_verificado) changes.push(renderInfoLine("Telefono", s.telefono_verificado));
    } else {
      if (s?.nombre_verificado && isDifferent(s.nombre_verificado, s.nombre_actual_db)) {
        changes.push(renderChangeLine("Nombre", s.nombre_verificado, s.nombre_actual_db));
      }
      if (s?.dni_verificado && isDifferent(s.dni_verificado, s.dni_actual_db)) {
        changes.push(renderChangeLine("DNI/RUC", s.dni_verificado, s.dni_actual_db));
      }
      if (s?.telefono_verificado && isDifferent(s.telefono_verificado, s.telefono_actual_db)) {
        changes.push(renderChangeLine("Telefono", s.telefono_verificado, s.telefono_actual_db));
      }
      if (s?.direccion_verificada) {
        const direccionBase = tipoSolicitud === "ALTA_DIRECCION_ALTERNA"
          ? s?.direccion_alterna_actual_db
          : s?.direccion_actual_db;
        if (isDifferent(s.direccion_verificada, direccionBase)) {
          changes.push(renderChangeLine(
            tipoSolicitud === "ALTA_DIRECCION_ALTERNA" ? "Direccion adicional" : "Direccion",
            s.direccion_verificada,
            direccionBase
          ));
        }
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
    }

    return {
      solicitud: s,
      changes,
      metadata,
      tipoSolicitud,
      servicios: { aguaNuevo, desagueNuevo, limpiezaNuevo },
      seguimientoPendiente,
      seguimientoMotivo,
      visitadoSN,
      hasObservacion,
      montosAbonoTxt,
      calleLabel,
      verificacionEstado,
      verificacionMotivo,
      predioTemporalSN,
      fotoFachada
    };
  }), [solicitudes]);

  const groupedRows = useMemo(() => {
    const groups = new Map();
    rows.forEach((row) => {
      if (organizarPor === "CALLE") {
        const label = String(row?.calleLabel || "").trim() || "Sin calle";
        const key = normalizeText(label) || "SIN_CALLE";
        if (!groups.has(key)) {
          groups.set(key, { key, label, sortValue: label, items: [] });
        }
        groups.get(key).items.push(row);
        return;
      }
      const dateGroup = buildDateGroup(row?.solicitud?.creado_en);
      if (!groups.has(dateGroup.key)) {
        groups.set(dateGroup.key, { key: dateGroup.key, label: dateGroup.label, sortValue: dateGroup.sortMs, items: [] });
      }
      groups.get(dateGroup.key).items.push(row);
    });

    const itemFactor = ordenItems === "ASC" ? 1 : -1;
    const list = Array.from(groups.values()).map((group) => ({
      ...group,
      items: (group.items || []).slice().sort((a, b) => itemFactor * (toMs(a?.solicitud?.creado_en) - toMs(b?.solicitud?.creado_en)))
    }));
    if (organizarPor === "CALLE") {
      const factor = ordenGrupo === "DESC" ? -1 : 1;
      return list.sort((a, b) => factor * String(a.label || "").localeCompare(String(b.label || ""), "es", { sensitivity: "base" }));
    }
    const factor = ordenGrupo === "ASC" ? 1 : -1;
    return list.sort((a, b) => factor * (Number(a.sortValue || 0) - Number(b.sortValue || 0)));
  }, [rows, organizarPor, ordenGrupo, ordenItems]);

  const totalVisibleSolicitudes = useMemo(
    () => groupedRows.reduce((acc, g) => acc + g.items.length, 0),
    [groupedRows]
  );

  const modalContentClass = `modal-content ${darkMode ? "text-white" : ""}`;
  const modalContentStyle = darkMode ? { backgroundColor: "#2b3035", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-primary text-white"}`;
  const closeBtnClass = `btn-close ${darkMode ? "btn-close-white" : "btn-close-white"}`;
  const tableClass = `table mb-0 ${darkMode ? "table-dark table-hover" : "table-hover"}`;
  const inputClass = `form-select form-select-sm ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const campoHref = campoAppUrl || `${API_BASE_URL}/campo-app/`;
  const generarInformeEmpadronados = () => {
    const sourceRows = groupedRows.flatMap((group) => group.items);
    if (sourceRows.length === 0) {
      alert("No hay solicitudes visibles para generar informe.");
      return;
    }

    const headers = [
      "id_solicitud",
      "fecha_registro",
      "estado_solicitud",
      "solicitante",
      "calle",
      "codigo_municipal",
      "contribuyente",
      "tipo_solicitud",
      "direccion_reportada",
      "verificacion",
      "motivo_no_verificacion",
      "pendiente_proxima_visita",
      "inspector",
      "observacion"
    ];

    const lines = sourceRows.map(({ solicitud: s, metadata, tipoSolicitud, seguimientoPendiente, verificacionEstado, verificacionMotivo, calleLabel }) => {
      const isAltaPredio = tipoSolicitud === "ALTA_PREDIO" || tipoSolicitud === "ALTA_PREDIO_TEMPORAL";
      const tipoTxt = TIPO_SOLICITUD_LABELS[tipoSolicitud] || tipoSolicitud || "ACTUALIZACION";
      const direccionTxt = String(s?.direccion_verificada || metadata?.referencia_direccion || "").trim();
      const contribuyenteTxt = isAltaPredio
        ? String(s?.nombre_verificado || "Sin nombre").trim()
        : String(s?.nombre_actual_db || "").trim();
      const values = [
        Number(s?.id_solicitud || 0),
        formatDateTime(s?.creado_en),
        String(s?.estado_solicitud || ""),
        String(s?.nombre_solicitante || ""),
        String(calleLabel || ""),
        String(s?.codigo_municipal || (isAltaPredio ? "PREDIO-NUEVO" : "")),
        contribuyenteTxt,
        tipoTxt,
        direccionTxt,
        verificacionEstado === "NO_VERIFICADO" ? "No verificado" : "Verificado",
        verificacionMotivoLabel(verificacionMotivo),
        seguimientoPendiente ? "SI" : "NO",
        String(metadata?.inspector || ""),
        String(s?.observacion_campo || "")
      ];
      return values.map(csvEscape).join(",");
    });

    const csv = [headers.map(csvEscape).join(","), ...lines].join("\n");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `informe_empadronados_${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMensaje(`Informe generado: ${sourceRows.length} registro(s) exportado(s).`);
    setError("");
  };

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
              <select
                className={inputClass}
                style={{ maxWidth: "220px" }}
                value={organizarPor}
                onChange={(e) => setOrganizarPor(e.target.value)}
              >
                {ORGANIZAR_OPTIONS.map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
              <select
                className={inputClass}
                style={{ maxWidth: "260px" }}
                value={ordenGrupo}
                onChange={(e) => setOrdenGrupo(e.target.value)}
              >
                {(ORDEN_GRUPO_OPTIONS[organizarPor] || ORDEN_GRUPO_OPTIONS.FECHA).map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
              <select
                className={inputClass}
                style={{ maxWidth: "260px" }}
                value={ordenItems}
                onChange={(e) => setOrdenItems(e.target.value)}
              >
                {ORDEN_ITEMS_OPTIONS.map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
              <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={cargarSolicitudes} disabled={cargando}>
                <FaSyncAlt /> Recargar
              </button>
              <button type="button" className="btn btn-sm btn-outline-success d-flex align-items-center gap-1" onClick={generarInformeEmpadronados} disabled={cargando || totalVisibleSolicitudes === 0}>
                <FaFileDownload /> Generar informe
              </button>
              <a href={campoHref} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-info d-flex align-items-center gap-1">
                <FaMobileAlt /> Abrir App Campo
              </a>
              <div className="ms-auto small opacity-75">
                Mostrando: <strong>{totalVisibleSolicitudes}</strong> de <strong>{solicitudes.length}</strong> | Grupos: <strong>{groupedRows.length}</strong>
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
                  ) : groupedRows.flatMap((group) => {
                    const groupHeader = (
                      <tr key={`group-${group.key}`} className={darkMode ? "table-secondary" : "table-light"}>
                        <td colSpan="6" className="small fw-semibold">
                          {organizarPor === "CALLE" ? "Calle" : "Fecha"}: {group.label} <span className="opacity-75 ms-2">({group.items.length} solicitudes)</span>
                        </td>
                      </tr>
                    );
                    const groupItems = group.items.map(({ solicitud: s, changes, metadata, tipoSolicitud, servicios, seguimientoPendiente, seguimientoMotivo, visitadoSN, hasObservacion, montosAbonoTxt, calleLabel, verificacionEstado, verificacionMotivo, predioTemporalSN, fotoFachada }) => {
                      const pending = s.estado_solicitud === "PENDIENTE";
                      const disabled = procesandoId === s.id_solicitud;
                      const isAltaPredio = tipoSolicitud === "ALTA_PREDIO";
                      const seguimientoTipo = getSeguimientoTipo(visitadoSN, hasObservacion);
                      const tone = seguimientoPendiente ? getSeguimientoTone(seguimientoTipo, darkMode) : null;
                      const rowStyle = tone ? { backgroundColor: tone.bg, color: tone.fg } : undefined;
                      const firstCellStyle = tone ? { borderLeft: `6px solid ${tone.accent}` } : undefined;
                      const badgeStyle = tone ? { backgroundColor: tone.accent, color: "#fff" } : undefined;
                      const seguimientoLineStyle = seguimientoPendiente && tone
                        ? { color: tone.line, fontWeight: 700 }
                        : { opacity: 0.75 };
                      return (
                        <tr key={s.id_solicitud} style={rowStyle}>
                          <td className="small align-top" style={firstCellStyle}>
                            <div>{formatDateTime(s.creado_en)}</div>
                            <div className="opacity-75">Rev: {formatDateTime(s.revisado_en)}</div>
                          </td>
                          <td className="align-top">
                            <div className="fw-bold">{s.codigo_municipal || (isAltaPredio ? "PREDIO-NUEVO" : "-")}</div>
                            <div>{s.nombre_actual_db || (isAltaPredio ? (s.nombre_verificado || "Sin nombre") : "-")}</div>
                            {isAltaPredio && (
                              <div className="small opacity-75">Direccion: {s.direccion_verificada || metadata.referencia_direccion || "-"}</div>
                            )}
                            <div className="small opacity-75">Calle: {calleLabel || "-"}</div>
                            <div className="small opacity-75">Solicita: {s.nombre_solicitante || "Usuario"}</div>
                          </td>
                          <td className="small align-top">
                            <div>
                              Tipo: <strong>{TIPO_SOLICITUD_LABELS[tipoSolicitud] || tipoSolicitud || "Actualizacion ficha"}</strong>
                            </div>
                            {isAltaPredio ? (
                              <>
                                <div className="mt-1">
                                  Direccion: <strong>{s.direccion_verificada || "-"}</strong>
                                </div>
                                {metadata.referencia_direccion && (
                                  <div className="mt-1">
                                    Referencia: <strong>{metadata.referencia_direccion}</strong>
                                  </div>
                                )}
                                <div className="mt-1">
                                  Inspector: <strong>{metadata.inspector || "-"}</strong>
                                </div>
                                <div className="mt-1">
                                  Verificacion: <strong>{verificacionEstado === "NO_VERIFICADO" ? "No verificado" : "Verificado"}</strong>
                                  {verificacionMotivo && (
                                    <> | Motivo: <strong>{verificacionMotivoLabel(verificacionMotivo)}</strong></>
                                  )}
                                </div>
                                {(verificacionEstado === "NO_VERIFICADO" || predioTemporalSN === "S") && (
                                  <div className="mt-1">
                                    Pendiente proxima visita: <strong>SI</strong>
                                  </div>
                                )}
                                {fotoFachada && (
                                  <div className="mt-1">
                                    <a href={fotoFachada} target="_blank" rel="noreferrer">Ver foto</a>
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="mt-1">
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
                                  Verificacion: <strong>{verificacionEstado === "NO_VERIFICADO" ? "No verificado" : "Verificado"}</strong>
                                  {verificacionMotivo && (
                                    <> | Motivo: <strong>{verificacionMotivoLabel(verificacionMotivo)}</strong></>
                                  )}
                                </div>
                                {fotoFachada && (
                                  <div className="mt-1">
                                    <a href={fotoFachada} target="_blank" rel="noreferrer">Ver foto</a>
                                  </div>
                                )}
                                <div className="mt-1">
                                  Meses deuda: <strong>{metadata.meses_deuda ?? "-"}</strong> | Deuda: <strong>S/. {Number(metadata.deuda_total || 0).toFixed(2)}</strong>
                                </div>
                                <div className="mt-1">
                                  Mensual sistema: <strong>S/. {Number(metadata.cargo_mensual_ultimo || 0).toFixed(2)}</strong> | Montos referencia 24m: <strong>{montosAbonoTxt}</strong>
                                </div>
                                <div className="mt-1">
                                  Ultima emision recibo: <strong>{metadata.ultima_emision_periodo || "-"}</strong>
                                </div>
                                <div className="mt-1">
                                  Ultimo mes pagado: <strong>{metadata.ultimo_mes_pagado_periodo || "-"}</strong>
                                </div>
                                <div className="mt-1" style={seguimientoLineStyle}>
                                  {seguimientoPendiente && (
                                    <span className="badge me-2" style={badgeStyle}>
                                      {seguimientoTipo === "NO_VISITADO_Y_OBSERVACION"
                                        ? "No visitado + obs"
                                        : (visitadoSN === "N" ? "No visitado" : "Con observacion")}
                                    </span>
                                  )}
                                  Pendiente proxima visita: <strong>{seguimientoPendiente ? "SI" : "NO"}</strong>{seguimientoMotivo ? ` (${seguimientoMotivo})` : ""}
                                </div>
                                {visitadoSN === "S" && hasObservacion && (
                                  <div className="mt-1 small" style={tone ? { color: tone.line } : {}}>
                                    Observacion registrada en visita efectiva (queda para seguimiento).
                                  </div>
                                )}
                              </>
                            )}
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
                    });
                    return [groupHeader, ...groupItems];
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
