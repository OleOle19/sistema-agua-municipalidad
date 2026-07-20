import { useEffect, useMemo, useState } from "react";
import api from "../api";
import { FaCheck, FaChevronLeft, FaChevronRight, FaClipboardCheck, FaFileDownload, FaSyncAlt, FaTimes } from "react-icons/fa";
import { confirmAction } from "../utils/confirmAction";

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
const SOLICITUDES_PAGE_SIZE = 100;

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

const renderChangeLine = (label, nuevo, actual, key = label) => (
  <div className="small" key={key}>
    <span className="fw-semibold">{label}:</span>{" "}
    <span className="text-success">{nuevo || "-"}</span>{" "}
    <span className="opacity-75">antes:</span>{" "}
    <span className="opacity-75">{actual || "-"}</span>
  </div>
);
const renderInfoLine = (label, value, key = label) => (
  <div className="small" key={key}>
    <span className="fw-semibold">{label}:</span>{" "}
    <span className="text-success">{value || "-"}</span>
  </div>
);
const renderServerChangeEntry = (entry = {}, index = 0) => {
  const campo = String(entry?.campo || "Cambio").trim() || "Cambio";
  const nuevo = String(entry?.despues || entry?.valor_nuevo || "").trim();
  const actual = String(entry?.antes || entry?.valor_anterior || "").trim();
  if (!nuevo) return null;
  if (actual) return renderChangeLine(campo, nuevo, actual, `api-${campo}-${index}`);
  return renderInfoLine(campo, nuevo || "-", `api-${campo}-${index}`);
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

const getSeguimientoTone = (tipo) => {
  if (!tipo) return null;
  const palette = {
      NO_VISITADO: { bg: "#ffe3d1", fg: "#1f2937", accent: "#c2410c", line: "#9a3412" },
      OBSERVACION: { bg: "#dff4ff", fg: "#0f172a", accent: "#0369a1", line: "#075985" },
      NO_VISITADO_Y_OBSERVACION: { bg: "#fff0c9", fg: "#1f2937", accent: "#b45309", line: "#92400e" }
  };
  return palette[tipo] || null;
};

const ModalCampoSolicitudes = ({ cerrarModal, onAplicado, onFlash }) => {
  const [filtroEstado, setFiltroEstado] = useState("PENDIENTE");
  const [busquedaContribuyente, setBusquedaContribuyente] = useState("");
  const [filtroCalle, setFiltroCalle] = useState("TODAS");
  const [organizarPor, setOrganizarPor] = useState("FECHA");
  const [ordenGrupo, setOrdenGrupo] = useState("DESC");
  const [ordenItems, setOrdenItems] = useState("DESC");
  const [pagina, setPagina] = useState(1);
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [procesandoId, setProcesandoId] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const cargarSolicitudes = async ({ silent = false } = {}) => {
    try {
      if (!silent) setCargando(true);
      setError("");
      const params = { limit: 2000, estado: filtroEstado };
      const res = await api.get("/campo/solicitudes", { params });
      setSolicitudes(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err?.response?.data?.error || "No se pudo cargar la bandeja de campo.");
    } finally {
      if (!silent) setCargando(false);
    }
  };

  useEffect(() => {
    cargarSolicitudes();
  }, [filtroEstado]);

  useEffect(() => {
    setOrdenGrupo(organizarPor === "CALLE" ? "ASC" : "DESC");
  }, [organizarPor]);

  useEffect(() => {
    setPagina(1);
  }, [busquedaContribuyente, filtroCalle, organizarPor, ordenGrupo, ordenItems, filtroEstado]);

  const abrirFotoSolicitud = async (idSolicitud) => {
    const id = Number(idSolicitud || 0);
    if (!id) return;
    try {
      const res = await api.get(`/campo/solicitudes/${id}/foto`);
      const foto = String(res?.data?.foto_fachada_base64 || "").trim();
      if (!foto) throw new Error("Sin foto.");
      const link = document.createElement("a");
      link.href = foto;
      link.target = "_blank";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      const mensajeError = err?.response?.data?.error || "No se pudo abrir la foto de la solicitud.";
      setError(mensajeError);
      if (typeof onFlash === "function") {
        onFlash("danger", mensajeError);
      }
    }
  };

  const procesarSolicitud = async (solicitud, accion) => {
    const id = Number(solicitud?.solicitud?.id_solicitud || solicitud?.id_solicitud);
    if (!Number.isInteger(id) || id <= 0) return;

    let payload = {};
    if (accion === "aprobar") {
      const puedeAplicarAutomatico = Boolean(solicitud?.autoApplySafe);
      let aplicarCambiosSN = "N";
      if (puedeAplicarAutomatico) {
        const aplicarAhora = await confirmAction(
          "La solicitud tiene cambios claros. Puede aplicarlos automáticamente ahora o aprobarla sin aplicar para revisarla manualmente.",
          { title: "Aprobar solicitud", confirmLabel: "Aplicar ahora", cancelLabel: "Aprobar sin aplicar" }
        );
        aplicarCambiosSN = aplicarAhora ? "S" : "N";
      } else {
        window.alert("Esta solicitud quedara aprobada sin aplicacion automatica. Primero revisa ficha y haz cambios manuales si hace falta.");
      }
      payload = {
        aplicar_cambios_sn: aplicarCambiosSN
      };
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
      const res = await api.post(`/campo/solicitudes/${id}/${accion}`, payload);
      setMensaje(accion === "aprobar" ? "Solicitud aprobada (sin aplicación automática)." : "Solicitud rechazada.");
      const mensajeExito = res?.data?.mensaje || (accion === "aprobar" ? "Solicitud aprobada." : "Solicitud rechazada.");
      setMensaje(mensajeExito);
      setSolicitudes((prev) => {
        const updated = (Array.isArray(prev) ? prev : []).map((item) => {
          if (Number(item?.id_solicitud || 0) !== id) return item;
          const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
          return {
            ...item,
            estado_solicitud: accion === "aprobar" ? "APROBADO" : "RECHAZADO",
            revisado_en: new Date().toISOString(),
            motivo_revision: accion === "rechazar" ? payload.motivo_revision : item?.motivo_revision,
            metadata: accion === "aprobar"
              ? {
                ...metadata,
                aplicacion_pendiente_sn: res?.data?.aplicada_automaticamente === false ? "S" : "N",
                aplicacion_automatica_sn: res?.data?.aplicada_automaticamente === false ? "N" : "S"
              }
              : metadata
          };
        });
        if (filtroEstado === "PENDIENTE") {
          return updated.filter((item) => String(item?.estado_solicitud || "").trim().toUpperCase() === "PENDIENTE");
        }
        return updated;
      });
      if (typeof onFlash === "function") {
        onFlash("success", mensajeExito);
      }
      if (onAplicado) {
        Promise.resolve(onAplicado()).catch(() => {});
      }
      cargarSolicitudes({ silent: true }).catch(() => {});
    } catch (err) {
      const mensajeError = err?.response?.data?.error || "No se pudo procesar la solicitud.";
      setError(mensajeError);
      if (typeof onFlash === "function") {
        onFlash("danger", mensajeError);
      }
    } finally {
      setProcesandoId(null);
    }
  };

  const rows = useMemo(() => solicitudes.map((s) => {
    const apiChanges = Array.isArray(s?.cambios_items)
      ? s.cambios_items.map((entry, index) => renderServerChangeEntry(entry, index)).filter(Boolean)
      : [];
    const changes = apiChanges.length > 0 ? apiChanges : [];
    const metadata = s?.metadata && typeof s.metadata === "object" ? s.metadata : {};
    const tipoSolicitud = normalizeText(s?.tipo_solicitud || metadata?.tipo_solicitud || "ACTUALIZACION");
    const isAltaPredio = tipoSolicitud === "ALTA_PREDIO" || tipoSolicitud === "ALTA_PREDIO_TEMPORAL";
    const verificacionEstado = normalizeText(metadata?.verificacion_estado || "VERIFICADO");
    const verificacionMotivo = normalizeText(metadata?.verificacion_motivo || "");
    const predioTemporalSN = normalizeSN(metadata?.predio_temporal_sn, "N");
    const fotoFachada = metadata?.foto_fachada_base64 || null;
    const fotoDisponible = Boolean(fotoFachada || s?.has_foto);
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
    const contribuyenteLabel = isAltaPredio
      ? String(s?.nombre_verificado || "").trim()
      : String(s?.nombre_actual_db || "").trim();
    const montosAbono = parseMontosList(metadata.montos_mensuales_24m);
    const montosAbonoTxt = montosAbono.length > 0 ? montosAbono.map((n) => n.toFixed(2)).join(", ") : "-";
    const calleRaw = String(s?.nombre_calle_db || metadata?.nombre_calle || metadata?.calle || "").trim();
    const calleLabel = calleRaw || inferCalleFromDireccion(
      s?.direccion_actual_db || s?.direccion_verificada || metadata?.referencia_direccion
    ) || "Sin calle";
    if (changes.length === 0 && isAltaPredio) {
      if (s?.direccion_verificada) changes.push(renderInfoLine("Direccion", s.direccion_verificada));
      if (metadata?.referencia_direccion) changes.push(renderInfoLine("Referencia", metadata.referencia_direccion));
      if (s?.nombre_verificado) changes.push(renderInfoLine("Nombre", s.nombre_verificado));
      if (s?.dni_verificado) changes.push(renderInfoLine("DNI/RUC", s.dni_verificado));
      if (s?.telefono_verificado) changes.push(renderInfoLine("Telefono", s.telefono_verificado));
    } else if (changes.length === 0) {
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
    const hasStructuredChanges = changes.length > 0;
    const autoApplySafe = !isAltaPredio
      && hasStructuredChanges
      && visitadoSN === "S"
      && verificacionEstado !== "NO_VERIFICADO";

    return {
      solicitud: s,
      changes,
      metadata,
      tipoSolicitud,
      servicios: { aguaNuevo, desagueNuevo, limpiezaNuevo },
      seguimientoPendiente,
      seguimientoMotivo,
      contribuyenteLabel,
      visitadoSN,
      hasObservacion,
      montosAbonoTxt,
      calleLabel,
      verificacionEstado,
      verificacionMotivo,
      predioTemporalSN,
      fotoFachada,
      fotoDisponible,
      hasStructuredChanges,
      autoApplySafe
    };
  }), [solicitudes]);

  const rowsFiltrados = useMemo(() => {
    const needle = String(busquedaContribuyente || "").trim().toLowerCase();
    return rows.filter((row) => {
      const contribuyente = String(row?.contribuyenteLabel || "").toLowerCase();
      const calle = String(row?.calleLabel || "").trim();
      const coincideContribuyente = !needle || contribuyente.includes(needle);
      const coincideCalle = filtroCalle === "TODAS" || calle === filtroCalle;
      return coincideContribuyente && coincideCalle;
    });
  }, [filtroCalle, rows, busquedaContribuyente]);

  const callesDisponibles = useMemo(() => {
    const unique = new Set();
    rows.forEach((row) => {
      const calle = String(row?.calleLabel || "").trim();
      if (calle) unique.add(calle);
    });
    return ["TODAS", ...Array.from(unique).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))];
  }, [rows]);

  const totalVisibleSolicitudes = rowsFiltrados.length;
  const totalPaginas = useMemo(
    () => Math.max(1, Math.ceil(totalVisibleSolicitudes / SOLICITUDES_PAGE_SIZE)),
    [totalVisibleSolicitudes]
  );
  const rangoInicio = totalVisibleSolicitudes > 0 ? ((pagina - 1) * SOLICITUDES_PAGE_SIZE) + 1 : 0;
  const rangoFin = totalVisibleSolicitudes > 0
    ? Math.min(((pagina - 1) * SOLICITUDES_PAGE_SIZE) + SOLICITUDES_PAGE_SIZE, totalVisibleSolicitudes)
    : 0;

  useEffect(() => {
    setPagina((current) => Math.min(current, totalPaginas));
  }, [totalPaginas]);

  const rowsPaginados = useMemo(() => {
    const inicio = (pagina - 1) * SOLICITUDES_PAGE_SIZE;
    return rowsFiltrados.slice(inicio, inicio + SOLICITUDES_PAGE_SIZE);
  }, [pagina, rowsFiltrados]);

  const groupedRows = useMemo(() => {
    const groups = new Map();
    rowsPaginados.forEach((row) => {
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
  }, [rowsPaginados, organizarPor, ordenGrupo, ordenItems]);

  const modalContentClass = "modal-content";
  const modalContentStyle = {};
  const headerClass = "modal-header bg-primary text-white";
  const closeBtnClass = "btn-close btn-close-white";
  const tableClass = "table table-hover mb-0";
  const inputClass = "form-select form-select-sm";
  const exportarSolicitudesExcel = async () => {
    try {
      setError("");
      setMensaje("");
      const requestConfig = {
        params: {
          estado: filtroEstado,
          limit: 5000,
          organizar_por: organizarPor,
          orden_grupo: ordenGrupo,
          orden_items: ordenItems
        },
        responseType: "blob"
      };
      let res = null;
      let lastError = null;
      const endpoints = [
        "/campo/solicitudes/exportar",
        "/campo/solicitudes/exportar.xlsx",
        "/campo/solicitudes/reporte-empadronados",
        "/campo/solicitudes/reporte-empadronados.xlsx"
      ];
      for (const endpoint of endpoints) {
        try {
          res = await api.get(endpoint, requestConfig);
          break;
        } catch (err) {
          lastError = err;
          if (Number(err?.response?.status || 0) === 404) continue;
          throw err;
        }
      }
      if (!res) throw lastError || new Error("No se pudo generar el informe Excel.");
      const disposition = String(res?.headers?.["content-disposition"] || "");
      const fileNameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
      const fileName = decodeURIComponent(fileNameMatch?.[1] || fileNameMatch?.[2] || "").trim() || `solicitudes_campo_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const blob = new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      const totalSolicitudes = Number(res?.headers?.["x-total-solicitudes"] || 0);
      setMensaje(totalSolicitudes > 0
        ? `Excel generado: ${totalSolicitudes} solicitud(es).`
        : "Excel de solicitudes generado correctamente.");
    } catch (err) {
      setError(err?.response?.data?.error || "No se pudo generar el Excel de solicitudes.");
    }
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
            <div className="p-3 border-bottom d-flex flex-wrap align-items-center gap-2">
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
                style={{ maxWidth: "240px" }}
                value={filtroCalle}
                onChange={(e) => setFiltroCalle(e.target.value)}
              >
                {callesDisponibles.map((calle) => (
                  <option key={calle} value={calle}>
                    {calle === "TODAS" ? "Calles: todas" : calle}
                  </option>
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
              <input
                type="text"
                className="form-control form-control-sm"
                style={{ maxWidth: "240px" }}
                placeholder="Buscar contribuyente..."
                value={busquedaContribuyente}
                onChange={(e) => setBusquedaContribuyente(e.target.value)}
              />
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
              <button type="button" className="btn btn-sm btn-outline-success d-flex align-items-center gap-1" onClick={() => exportarSolicitudesExcel()} disabled={cargando}>
                <FaFileDownload /> Excel Solicitudes
              </button>
              <div className="ms-auto small opacity-75 d-flex flex-wrap gap-3">
                <span>Mostrando {rangoInicio}-{rangoFin} de {totalVisibleSolicitudes} solicitud(es)</span>
                <span>Pagina {pagina} de {totalPaginas}</span>
                <span>Lote de {SOLICITUDES_PAGE_SIZE}</span>
                <span>Grupos en pagina: {groupedRows.length}</span>
              </div>
            </div>

            {mensaje && <div className="alert alert-success m-3 py-2 small">{mensaje}</div>}
            {error && <div className="alert alert-danger m-3 py-2 small">{error}</div>}

            <div className="table-responsive" style={{ maxHeight: "65vh" }}>
              <table className={tableClass}>
                <thead className="table-light">
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
                      <tr key={`group-${group.key}`} className="table-light">
                        <td colSpan="6" className="small fw-semibold">
                          {organizarPor === "CALLE" ? "Calle" : "Fecha"}: {group.label} <span className="opacity-75 ms-2">({group.items.length} solicitudes)</span>
                        </td>
                      </tr>
                    );
                    const groupItems = group.items.map((rowData) => {
                      const { solicitud: s, changes, metadata, tipoSolicitud, servicios, seguimientoPendiente, seguimientoMotivo, visitadoSN, hasObservacion, montosAbonoTxt, calleLabel, verificacionEstado, verificacionMotivo, predioTemporalSN, fotoDisponible, autoApplySafe } = rowData;
                      const pending = s.estado_solicitud === "PENDIENTE";
                      const disabled = procesandoId === s.id_solicitud;
                      const isAltaPredio = tipoSolicitud === "ALTA_PREDIO";
                      const seguimientoTipo = getSeguimientoTipo(visitadoSN, hasObservacion);
                      const tone = seguimientoPendiente ? getSeguimientoTone(seguimientoTipo) : null;
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
                                {fotoDisponible && (
                                  <div className="mt-1">
                                    <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => abrirFotoSolicitud(s.id_solicitud)}>Ver foto</button>
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="mt-1">
                                  Estado: <strong>{s.estado_conexion_actual}</strong> {"->"} <strong>{s.estado_conexion_nuevo}</strong>
                                </div>
                                <div className="mt-1">
                                  Visitado: <strong>{metadata.visitado_sn || "N"}</strong> | Estado nuevo: <strong>{s.estado_conexion_nuevo || "-"}</strong>
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
                                {fotoDisponible && (
                                  <div className="mt-1">
                                    <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => abrirFotoSolicitud(s.id_solicitud)}>Ver foto</button>
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
                                <div className="mt-1 small">
                                  Aprobacion sugerida: <strong>{autoApplySafe ? "Automatica" : "Manual"}</strong>
                                </div>
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
                                  onClick={() => procesarSolicitud(rowData, "aprobar")}
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

          <div className="modal-footer d-flex justify-content-between gap-2 flex-wrap">
            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setPagina((current) => Math.max(1, current - 1))}
                disabled={cargando || pagina <= 1}
              >
                <FaChevronLeft />
              </button>
              <span className="small opacity-75">Pagina {pagina} de {totalPaginas}</span>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setPagina((current) => Math.min(totalPaginas, current + 1))}
                disabled={cargando || pagina >= totalPaginas}
              >
                <FaChevronRight />
              </button>
            </div>
            <button type="button" className="btn btn-dark" onClick={cerrarModal}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalCampoSolicitudes;
