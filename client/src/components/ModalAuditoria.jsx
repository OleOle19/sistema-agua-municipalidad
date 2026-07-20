import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import api from "../api";
import {
  FaChevronLeft,
  FaChevronRight,
  FaFileExcel,
  FaSearch,
  FaShieldAlt,
  FaSyncAlt,
  FaUndo
} from "react-icons/fa";

const ACTION_LABELS = {
  ORDEN_COBRO_COBRADA: "Orden de cobro cobrada",
  ORDEN_COBRO_EMITIDA: "Orden de cobro emitida",
  ORDEN_COBRO_ANULADA: "Orden de cobro anulada",
  PAGO_ANULADO_LOGICO: "Pago anulado (archivo admin)",
  PAGO_REINTEGRADO: "Pago reintegrado",
  PAGO_EDITADO_MONTO: "Pago editado",
  CAJA_CIERRE_REGISTRADO: "Cierre de caja registrado",
  COBRO_DIRECTO_REGISTRADO: "Cobro directo registrado",
  AUTH_PASSWORD_CAMBIO: "Cambio de clave",
  AUTH_REGISTRO: "Registro de usuario",
  AUTH_LOGIN: "Inicio de sesion",
  ACCESO_NO_AUTENTICADO: "Acceso no autenticado",
  ACCESO_DENEGADO_ROL: "Acceso denegado por rol",
  AUDITORIA_DESHECHA: "Cambio deshecho",
  AUDITORIA_REVERSION_APLICADA: "Reversion de auditoria aplicada",
  ADMIN_LUZ_USUARIO_CREADO: "Usuario de luz creado",
  ADMIN_LUZ_USUARIO_ACTUALIZADO: "Usuario de luz actualizado",
  ADMIN_LUZ_USUARIO_ELIMINADO: "Usuario de luz eliminado",
  CAMPO_SOLICITUD_DESHECHA: "Solicitud de campo deshecha"
};
const CAMPO_TIPO_SOLICITUD_LABELS = {
  ACTUALIZACION: "Actualizacion ficha",
  ALTA_DIRECCION_ALTERNA: "Alta direccion alterna",
  ALTA_PREDIO: "Alta predio nuevo",
  ALTA_PREDIO_TEMPORAL: "Alta predio temporal"
};

const SIMPLE_ROUTE_RULES = [
  { method: "POST", pattern: /^\/auth\/login$/i, label: "Inicio de sesion" },
  { method: "POST", pattern: /^\/auth\/change-password$/i, label: "Cambio de clave" },
  { method: "POST", pattern: /^\/auth\/cambiar-password$/i, label: "Cambio de clave" },
  { method: "POST", pattern: /^\/caja\/ordenes-cobro$/i, label: "Emitir orden de cobro" },
  { method: "POST", pattern: /^\/caja\/ordenes-cobro\/\d+\/cobrar$/i, label: "Cobrar orden de cobro" },
  { method: "POST", pattern: /^\/caja\/ordenes-cobro\/\d+\/anular$/i, label: "Anular orden de cobro" },
  { method: "POST", pattern: /^\/pagos$/i, label: "Registrar pago" },
  { method: "POST", pattern: /^\/pagos\/\d+\/editar$/i, label: "Editar monto de pago" },
  { method: "POST", pattern: /^\/pagos\/\d+\/anular$/i, label: "Anular pago" },
  { method: "POST", pattern: /^\/pagos\/recibo\/\d+\/anular-ultimo$/i, label: "Anular pagos por periodo" },
  { method: "POST", pattern: /^\/caja\/cierre$/i, label: "Registrar cierre de caja" },
  { method: "GET", pattern: /^\/contribuyentes\/reporte-estado-conexion$/i, label: "Consultar reporte de conexiones" },
  { method: "GET", pattern: /^\/contribuyentes\/reporte-estado-conexion\.xlsx$/i, label: "Exportar reporte de conexiones" },
  { method: "GET", pattern: /^\/exportar\/auditoria$/i, label: "Exportar auditoria" },
  { method: "GET", pattern: /^\/caja\/reporte\/excel$/i, label: "Exportar reporte de caja (Excel)" },
  { method: "POST", pattern: /^\/importar\/historial$/i, label: "Importar historial" },
  { method: "POST", pattern: /^\/importar\/padron$/i, label: "Importar padron" },
  { method: "POST", pattern: /^\/admin\/backup/i, label: "Crear respaldo de base de datos" }
];

const LABEL_TRANSLATIONS = {
  evento: "Evento",
  params: "Parametros",
  body: "Datos enviados",
  id: "ID",
  id_cierre: "ID cierre",
  id_pago: "ID pago",
  id_orden: "ID orden",
  id_contribuyente: "ID contribuyente",
  orden: "Orden",
  contribuyente: "Contribuyente",
  total: "Total",
  total_sistema: "Total sistema",
  efectivo: "Efectivo declarado",
  efectivo_declarado: "Efectivo declarado",
  desviacion: "Desviacion",
  alerta: "Alerta",
  recibos: "Recibos",
  ip: "IP",
  tipo: "Tipo",
  fecha: "Fecha",
  username: "Usuario",
  password: "Clave",
  rol: "Rol",
  ruta: "Ruta",
  sistema: "Sistema",
  estado: "Estado",
  cargo_reimpresion: "Cargo reimpresion",
  motivo: "Motivo",
  codigo_recibo: "Codigo recibo",
  codigo: "Codigo",
  autorizacion: "Autorizacion",
  minutos: "Minutos",
  acceso: "Tipo acceso",
  solicitud: "Solicitud",
  tipo_solicitud: "Tipo solicitud",
  aplicacion: "Aplicacion",
  cambios_aplicados: "Cambios aplicados",
  cambios_solicitados: "Cambios solicitados",
  recibos_recalculados: "Recibos futuros recalculados",
  id_direccion_alterna: "ID direccion alterna",
  nota_revision: "Nota revision",
  codigo_municipal: "Codigo municipal",
  nombre_completo: "Nombre completo",
  observacion_campo: "Observacion de campo",
  direccion_verificada: "Direccion verificada",
  referencia_direccion: "Referencia direccion",
  verificacion_estado: "Estado verificacion",
  verificacion_motivo: "Motivo verificacion",
  auditoria_origen: "Auditoria origen",
  recibos_restaurados: "Recibos restaurados",
  deshecho_por: "Deshecho por",
  cantidad_recibos: "Cantidad de recibos",
  total_aplicado: "Total cobrado",
  contribuyentes: "Contribuyentes",
  detalle_recibos: "Detalle de cobros",
  monto_cobrado: "Monto cobrado",
  saldo_pendiente: "Saldo pendiente",
  periodo: "Periodo",
  anulaciones_reintegradas: "Anulaciones reintegradas",
  tipo_pago: "Tipo pago"
};
const AUDITORIA_PAGE_SIZE = 200;
const MONEY_FORMATTER = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const formatArrayHint = (value) => {
  const match = String(value || "").trim().match(/^\[array:(\d+)\]$/i);
  if (!match) return null;
  return `${Number(match[1] || 0)} registro(s)`;
};

const METHOD_FILTER_OPTIONS = [
  { value: "TODOS", label: "Tipo: TODOS" },
  { value: "COMPENSACION", label: "Tipo: Compensaciones" },
  { value: "GET", label: "Tipo: Consultas" },
  { value: "POST", label: "Tipo: Registros" },
  { value: "PUT", label: "Tipo: Ediciones" },
  { value: "PATCH", label: "Tipo: Ajustes" },
  { value: "DELETE", label: "Tipo: Eliminaciones" },
  { value: "SISTEMA", label: "Tipo: Procesos internos" }
];
const CATEGORY_FILTER_OPTIONS = [
  "TODOS", "SEGURIDAD", "CAJA", "DEUDA", "PADRON", "CAMPO", "DATOS", "ADMINISTRACION", "CONSULTA", "SISTEMA"
];

const toFriendlyHttpAction = (method, pathRaw) => {
  const path = String(pathRaw || "").split("?")[0].trim();
  const hit = SIMPLE_ROUTE_RULES.find((rule) => rule.method === method && rule.pattern.test(path));
  if (hit) return hit.label;
  return `${method} ${path}`.trim();
};

const toFriendlyAction = (accion) => {
  const raw = String(accion || "").trim();
  if (!raw) return "Sin accion";
  const upper = raw.toUpperCase();
  if (ACTION_LABELS[upper]) return ACTION_LABELS[upper];
  const httpMatch = raw.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i);
  if (httpMatch) {
    return toFriendlyHttpAction(httpMatch[1].toUpperCase(), httpMatch[2]);
  }
  return raw.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};

const prettyLabel = (label) => {
  const raw = String(label || "").trim();
  if (!raw) return "Detalle";
  const normalized = raw.toLowerCase();
  if (LABEL_TRANSLATIONS[normalized]) return LABEL_TRANSLATIONS[normalized];
  return raw.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};

const parseValue = (rawValue) => {
  const value = String(rawValue || "").trim();
  if (!value) return { text: "-", isJson: false };
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    try {
      return { text: JSON.stringify(JSON.parse(value), null, 2), isJson: true };
    } catch {
      return { text: value, isJson: false };
    }
  }
  return { text: value, isJson: false };
};

const formatScalar = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Si" : "No";
  const arrayHint = formatArrayHint(value);
  if (arrayHint) return arrayHint;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};
const formatMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value ?? "-");
  return MONEY_FORMATTER.format(amount);
};
const formatAuditDateOnly = (value) => {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || "-";
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString();
};
const formatContribuyenteLine = (row = {}) => {
  const id = Number(row?.id_contribuyente || 0);
  const codigo = String(row?.codigo_municipal || "").trim();
  const nombre = String(row?.nombre_completo || "").trim();
  const parts = [];
  if (id > 0) parts.push(`ID ${id}`);
  if (codigo) parts.push(`Cod. ${codigo}`);
  if (nombre) parts.push(nombre);
  return parts.join(" | ") || "-";
};
const formatDetalleRecibosValue = (valueText) => {
  try {
    const parsed = JSON.parse(valueText);
    if (!Array.isArray(parsed)) return valueText;
    const lines = parsed.map((row) => {
      const parts = [];
      if (row?.periodo) parts.push(String(row.periodo));
      if (Number(row?.id_recibo) > 0) parts.push(`Recibo ${row.id_recibo}`);
      if (String(row?.tipo_pago || "").trim().toUpperCase() === "COMPENSACION") parts.push("Compensación");
      if (row?.monto_cobrado !== undefined) parts.push(`Cobro ${formatMoney(row.monto_cobrado)}`);
      if (row?.saldo_pendiente !== undefined) parts.push(`Saldo ${formatMoney(row.saldo_pendiente)}`);
      if (row?.estado) parts.push(`Estado ${row.estado}`);
      if (Number(row?.id_anulacion_referencia) > 0) parts.push(`Reintegro de anulacion ${row.id_anulacion_referencia}`);
      return parts.join(" | ");
    }).filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : "Sin detalle";
  } catch {
    return valueText;
  }
};
const formatContribuyentesValue = (valueText) => {
  try {
    const parsed = JSON.parse(valueText);
    if (!Array.isArray(parsed)) return valueText;
    const lines = parsed.map((row) => formatContribuyenteLine(row)).filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : "Sin contribuyentes";
  } catch {
    return valueText;
  }
};
const formatAnulacionesReintegradasValue = (valueText) => {
  try {
    const parsed = JSON.parse(valueText);
    if (!Array.isArray(parsed)) return valueText;
    const lines = parsed.map((row) => {
      const parts = [];
      if (Number(row?.id_anulacion) > 0) parts.push(`Anulacion ${row.id_anulacion}`);
      if (Number(row?.id_pago_reintegrado) > 0) parts.push(`Pago ${row.id_pago_reintegrado}`);
      if (Number(row?.id_recibo) > 0) parts.push(`Recibo ${row.id_recibo}`);
      return parts.join(" | ");
    }).filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : "Sin anulaciones";
  } catch {
    return valueText;
  }
};

const formatValueForDisplay = (label, valueText, isJson) => {
  const key = String(label || "").trim().toLowerCase();

  if (key === "evento") {
    return toFriendlyAction(valueText);
  }

  if (key === "alerta") {
    const val = String(valueText || "").trim().toUpperCase();
    if (val === "S") return "Si";
    if (val === "N") return "No";
  }

  if (key === "password" && String(valueText || "").trim().toUpperCase() === "[REDACTED]") {
    return "Oculta por seguridad";
  }

  if (key === "detalle_recibos") {
    const arrayHint = formatArrayHint(valueText);
    if (arrayHint) return arrayHint;
  }

  if (key === "tipo_solicitud") {
    const normalized = String(valueText || "").trim().toUpperCase();
    return CAMPO_TIPO_SOLICITUD_LABELS[normalized] || valueText;
  }

  if (key === "fecha_pago") {
    return formatAuditDateOnly(valueText);
  }

  if (key === "tipo_pago") {
    const normalized = String(valueText || "").trim().toUpperCase();
    if (normalized === "COMPENSACION") return "Compensación";
    if (normalized === "CAJA") return "Caja";
  }

  if (["total", "total_aplicado", "monto_cobrado", "saldo_pendiente"].includes(key)) {
    return formatMoney(valueText);
  }

  if (key === "contribuyentes" && isJson) {
    return formatContribuyentesValue(valueText);
  }

  if (key === "detalle_recibos" && isJson) {
    return formatDetalleRecibosValue(valueText);
  }

  if (key === "anulaciones_reintegradas" && isJson) {
    return formatAnulacionesReintegradasValue(valueText);
  }

  if (isJson && (key === "params" || key === "body")) {
    try {
      const parsed = JSON.parse(valueText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return valueText;
      const lines = Object.entries(parsed).map(([k, v]) => `${prettyLabel(k)}: ${formatScalar(v)}`);
      return lines.length > 0 ? lines.join("\n") : "Sin datos";
    } catch {
      return valueText;
    }
  }

  if (isJson && (key === "cambios_aplicados" || key === "cambios_solicitados")) {
    try {
      const parsed = JSON.parse(valueText);
      if (Array.isArray(parsed)) {
        const lines = parsed.map((item) => String(item || "").trim()).filter(Boolean);
        return lines.length > 0 ? lines.join("\n") : "Sin cambios";
      }
      return valueText;
    } catch {
      return valueText;
    }
  }

  return valueText;
};

const parseDetalle = (detalle) => {
  const raw = String(detalle || "").trim();
  if (!raw) return [];

  const rows = [];
  raw
    .split("|")
    .map((block) => block.trim())
    .filter(Boolean)
    .forEach((block) => {
      if (block.includes(";") && block.includes("=")) {
        block
          .split(";")
          .map((piece) => piece.trim())
          .filter(Boolean)
          .forEach((piece) => {
            const idx = piece.indexOf("=");
            if (idx <= 0) {
              rows.push({ label: "Evento", ...parseValue(piece) });
              return;
            }
            const label = piece.slice(0, idx).trim();
            const value = piece.slice(idx + 1).trim();
            rows.push({ label, ...parseValue(value) });
          });
        return;
      }

      const idx = block.indexOf("=");
      if (idx > 0) {
        const label = block.slice(0, idx).trim();
        const value = block.slice(idx + 1).trim();
        rows.push({ label, ...parseValue(value) });
      } else {
        rows.push({ label: "Evento", ...parseValue(block) });
      }
    });

  return rows;
};
const INTERNAL_AUDIT_LABELS = new Set([
  "undo_type",
  "undo_snapshot_b64",
  "undo_aplicado_sn",
  "undo_aplicado_por",
  "undo_aplicado_en"
]);
const getUndoTypeFromRows = (rows = []) => {
  const match = (Array.isArray(rows) ? rows : []).find(
    (item) => String(item?.label || "").trim().toLowerCase() === "undo_type"
  );
  return String(match?.text || "").trim().toUpperCase();
};
const isUndoAlreadyApplied = (rows = []) => {
  const match = (Array.isArray(rows) ? rows : []).find(
    (item) => String(item?.label || "").trim().toLowerCase() === "undo_aplicado_sn"
  );
  return String(match?.text || "").trim().toUpperCase() === "S";
};
const isInternalAuditLabel = (label) => INTERNAL_AUDIT_LABELS.has(String(label || "").trim().toLowerCase());
const isUndoableAuditAction = (log = {}, detalleRows = []) => {
  if (String(log?.reversion_aplicada_sn || "").trim().toUpperCase() === "S") return false;
  if (isUndoAlreadyApplied(detalleRows)) return false;
  const undoType = getUndoTypeFromRows(detalleRows);
  if (undoType) return true;
  return String(log?.accion || "").trim().toUpperCase() === "CAMPO_SOLICITUD_APROBADA";
};
const getUndoPrompt = (undoType = "", accion = "") => {
  const type = String(undoType || "").trim().toUpperCase();
  if (type === "CONTRIBUYENTE_EDITADO") return "Se intentara deshacer esta edicion de contribuyente. Continuar?";
  if (type === "CONTRIBUYENTE_ELIMINADO") return "Se intentara restaurar este contribuyente eliminado. Continuar?";
  if (type === "RECIBO_ELIMINADO") return "Se intentara restaurar esta deuda eliminada. Continuar?";
  if (type === "PAGO_ANULADO") return "Se intentara deshacer esta anulacion de pago. Continuar?";
  if (type === "ORDEN_COBRO_ANULADA") return "Se intentara deshacer esta anulacion de orden. Continuar?";
  if (String(accion || "").trim().toUpperCase() === "CAMPO_SOLICITUD_APROBADA") {
    return "Se intentara deshacer esta aprobacion de solicitud de campo. Continuar?";
  }
  return "Se intentara deshacer este movimiento. Continuar?";
};

const ModalAuditoria = ({ cerrarModal, darkMode, onUndoApplied = null, canUndo = false }) => {
  const [logs, setLogs] = useState([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [usuariosDisponibles, setUsuariosDisponibles] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [deshaciendoId, setDeshaciendoId] = useState(0);
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroMetodo, setFiltroMetodo] = useState("TODOS");
  const [filtroCategoria, setFiltroCategoria] = useState("TODOS");
  const [filtroUsuarioId, setFiltroUsuarioId] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [pagina, setPagina] = useState(1);
  const [seleccionado, setSeleccionado] = useState(null);
  const [reversionPendiente, setReversionPendiente] = useState(null);
  const [motivoReversion, setMotivoReversion] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const requestSequenceRef = useRef(0);
  const abortRef = useRef(null);

  const formatFecha = (isoString) => {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("es-PE");
  };
  const resetPage = (setter, value) => {
    setPagina(1);
    setter(value);
  };

  const construirParamsConsulta = useCallback((pageValue = pagina) => {
    const params = { page: pageValue, page_size: AUDITORIA_PAGE_SIZE, sistema: "AGUA" };
    const texto = String(filtroTexto || "").trim();
    if (texto) params.q = texto;
    if (filtroMetodo !== "TODOS") params.method = filtroMetodo;
    if (filtroCategoria !== "TODOS") params.categoria = filtroCategoria;
    if (filtroUsuarioId) params.usuario_id = filtroUsuarioId;
    if (fechaDesde) params.fecha_desde = fechaDesde;
    if (fechaHasta) params.fecha_hasta = fechaHasta;
    return params;
  }, [
    fechaDesde, fechaHasta, filtroCategoria, filtroMetodo, filtroTexto, filtroUsuarioId, pagina
  ]);

  const cargarLogs = useCallback(async (pageValue = pagina) => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setCargando(true);
      setError("");
      const res = await api.get("/auditoria", {
        params: construirParamsConsulta(pageValue),
        signal: controller.signal
      });
      if (sequence !== requestSequenceRef.current) return;
      const rows = Array.isArray(res?.data?.rows) ? res.data.rows : (Array.isArray(res?.data) ? res.data : []);
      setLogs(rows);
      setTotalLogs(Number(res?.data?.total || 0));
      setUsuariosDisponibles(Array.isArray(res?.data?.usuarios) ? res.data.usuarios : []);
      setWarnings(Array.isArray(res?.data?.warnings) ? res.data.warnings : []);
      setPagina(Math.max(1, Number(res?.data?.page || pageValue || 1)));
      setSeleccionado((current) => {
        if (!current) return null;
        return rows.find((row) => row.id_auditoria === current.id_auditoria) || current;
      });
    } catch (err) {
      if (err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return;
      if (sequence !== requestSequenceRef.current) return;
      setLogs([]);
      setTotalLogs(0);
      setError(String(err?.response?.data?.error || "No se pudo cargar la auditoria."));
    } finally {
      if (sequence === requestSequenceRef.current) setCargando(false);
    }
  }, [construirParamsConsulta, pagina]);

  useEffect(() => {
    const timer = window.setTimeout(() => cargarLogs(), 300);
    return () => window.clearTimeout(timer);
  }, [cargarLogs]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const totalPaginas = useMemo(() => Math.max(1, Math.ceil(Number(totalLogs || 0) / AUDITORIA_PAGE_SIZE)), [totalLogs]);
  const rangoInicio = totalLogs > 0 ? ((pagina - 1) * AUDITORIA_PAGE_SIZE) + 1 : 0;
  const rangoFin = totalLogs > 0 ? Math.min(((pagina - 1) * AUDITORIA_PAGE_SIZE) + logs.length, totalLogs) : 0;
  const detalleSeleccionado = useMemo(() => parseDetalle(seleccionado?.detalle), [seleccionado]);
  const detalleVisible = useMemo(() => detalleSeleccionado.filter((item) => !isInternalAuditLabel(item.label)), [detalleSeleccionado]);
  const undoTypeSeleccionado = getUndoTypeFromRows(detalleSeleccionado);

  const descargarExcel = async () => {
    try {
      setExportando(true);
      setError("");
      const res = await api.get("/exportar/auditoria", {
        params: construirParamsConsulta(1),
        responseType: "blob",
        timeout: 0
      });
      const blob = new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `auditoria_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setMensaje("Auditoria exportada con los filtros actuales.");
    } catch (err) {
      setError(String(err?.response?.data?.error || "No se pudo exportar la auditoria."));
    } finally {
      setExportando(false);
    }
  };

  const confirmarReversion = async () => {
    const log = reversionPendiente;
    const idAuditoria = Number(log?.id_auditoria || 0);
    const motivo = String(motivoReversion || "").replace(/\s+/g, " ").trim();
    if (!idAuditoria || motivo.length < 5) {
      setError("Indique un motivo de al menos 5 caracteres.");
      return;
    }
    try {
      setDeshaciendoId(idAuditoria);
      setError("");
      const res = await api.post(`/auditoria/${idAuditoria}/deshacer`, { motivo });
      setMensaje(res?.data?.mensaje || "Movimiento deshecho correctamente.");
      setReversionPendiente(null);
      setMotivoReversion("");
      if (typeof onUndoApplied === "function") await onUndoApplied(res?.data || null, log);
      await cargarLogs();
    } catch (err) {
      setError(String(err?.response?.data?.error || "No se pudo deshacer la auditoria."));
    } finally {
      setDeshaciendoId(0);
    }
  };

  const modalContentClass = `modal-content ${darkMode ? "text-white" : ""}`;
  const modalContentStyle = darkMode ? { backgroundColor: "#2b3035", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-secondary text-white"}`;
  const closeBtnClass = `btn-close ${darkMode ? "btn-close-white" : ""}`;
  const tableClass = `table table-sm align-middle mb-0 ${darkMode ? "table-dark table-hover" : "table-hover"}`;
  const filtroInputClass = `form-control form-control-sm ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const filtroSelectClass = `form-select form-select-sm ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const filtroGroupTextClass = `input-group-text ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const panelClass = `border rounded-3 ${darkMode ? "border-secondary bg-dark" : "bg-light"}`;

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
      <div className="modal-dialog modal-fullscreen-xl-down modal-xl">
        <div className={modalContentClass} style={modalContentStyle}>
          <div className={headerClass}>
            <div>
              <h5 className="modal-title"><FaShieldAlt className="me-2" /> Auditoría Municipal</h5>
              <div className="small opacity-75">Movimientos y cambios realizados en el sistema de agua</div>
            </div>
            <button type="button" className={closeBtnClass} onClick={cerrarModal} aria-label="Cerrar auditoria" />
          </div>
          <div className="modal-body p-0">
            <div className={`p-3 border-bottom ${darkMode ? "border-secondary" : ""}`}>
              {error && <div className="alert alert-danger py-2 mb-2">{error}</div>}
              {mensaje && <div className="alert alert-success py-2 mb-2">{mensaje}</div>}
              {warnings.length > 0 && <div className="alert alert-warning py-2 mb-2">Vista parcial: {warnings.join(" · ")}</div>}
              <div className="row g-2">
                <div className="col-xl-5 col-lg-6">
                  <div className="input-group input-group-sm">
                    <span className={filtroGroupTextClass}><FaSearch /></span>
                    <input className={filtroInputClass} placeholder="Buscar evento, usuario o detalle..." value={filtroTexto} onChange={(e) => resetPage(setFiltroTexto, e.target.value)} />
                  </div>
                </div>
                <div className="col-xl-2 col-md-3"><select className={filtroSelectClass} value={filtroCategoria} onChange={(e) => resetPage(setFiltroCategoria, e.target.value)}>{CATEGORY_FILTER_OPTIONS.map((v) => <option key={v} value={v}>Area: {v === "SISTEMA" ? "GENERAL" : v}</option>)}</select></div>
                <div className="col-xl-2 col-md-3"><select className={filtroSelectClass} value={filtroMetodo} onChange={(e) => resetPage(setFiltroMetodo, e.target.value)}>{METHOD_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                <div className="col-xl-3 col-md-4">
                  <select className={filtroSelectClass} value={filtroUsuarioId} onChange={(e) => resetPage(setFiltroUsuarioId, e.target.value)}>
                    <option value="">Usuario: TODOS</option>
                    {usuariosDisponibles.map((usuario) => (
                      <option key={usuario.id_usuario} value={usuario.id_usuario}>
                        {usuario.username}{usuario.nombre && usuario.nombre !== usuario.username ? ` - ${usuario.nombre}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-xl-2 col-md-3"><div className="input-group input-group-sm"><span className={filtroGroupTextClass}>Desde</span><input type="date" className={filtroInputClass} value={fechaDesde} onChange={(e) => resetPage(setFechaDesde, e.target.value)} /></div></div>
                <div className="col-xl-2 col-md-3"><div className="input-group input-group-sm"><span className={filtroGroupTextClass}>Hasta</span><input type="date" className={filtroInputClass} value={fechaHasta} onChange={(e) => resetPage(setFechaHasta, e.target.value)} /></div></div>
                <div className="col-xl-1 col-md-3 d-flex align-items-center justify-content-xl-end">
                  <button type="button" className={`btn btn-sm ${darkMode ? "btn-outline-light" : "btn-outline-secondary"}`} onClick={() => cargarLogs()} disabled={cargando}><FaSyncAlt className="me-1" /> Recargar</button>
                </div>
              </div>
              <div className="small mt-2 opacity-75">Mostrando {rangoInicio}-{rangoFin} de {totalLogs} · Página {pagina} de {totalPaginas}</div>
            </div>

            <div className="row g-0">
              <div className={seleccionado ? "col-xl-8" : "col-12"}>
                <div className="table-responsive" style={{ maxHeight: "55vh" }}>
                  <table className={tableClass} style={{ minWidth: "720px" }}>
                    <thead className={`${darkMode ? "" : "table-light"} sticky-top`}><tr><th>Fecha</th><th>Usuario</th><th>Evento</th><th></th></tr></thead>
                    <tbody>
                      {cargando ? <tr><td colSpan="4" className="text-center p-4">Cargando bitacora...</td></tr> : logs.length === 0 ? <tr><td colSpan="4" className="text-center p-4">No hay registros para estos filtros.</td></tr> : logs.map((log) => (
                        <tr key={log.id_auditoria} className={seleccionado?.id_auditoria === log.id_auditoria ? "table-active" : ""}>
                          <td className="text-nowrap small">{formatFecha(log.fecha)}</td>
                          <td><div className="fw-semibold">{log.usuario || "SISTEMA"}</div>{log.actor_rol && <div className="small opacity-75">{log.actor_rol}</div>}</td>
                          <td><div className="fw-semibold small">{toFriendlyAction(log.evento || log.accion)}</div><div className="small opacity-75">{log.categoria || "SISTEMA"}</div></td>
                          <td><button type="button" className={`btn btn-sm ${darkMode ? "btn-outline-light" : "btn-outline-primary"}`} onClick={() => { setSeleccionado(log); setReversionPendiente(null); setMotivoReversion(""); }}>Ver detalle</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {seleccionado && (
                <aside className={`col-xl-4 border-start ${darkMode ? "border-secondary" : ""}`}>
                  <div className="p-3" style={{ maxHeight: "55vh", overflowY: "auto" }}>
                    <div className="d-flex justify-content-between gap-2 mb-3"><div><div className="fw-bold">Detalle del movimiento</div><div className="small opacity-75">ID {seleccionado.id_auditoria}</div></div><button type="button" className={closeBtnClass} onClick={() => setSeleccionado(null)} aria-label="Cerrar detalle" /></div>
                    <div className={`${panelClass} p-2 mb-2 small`}><div className="fw-semibold">{toFriendlyAction(seleccionado.evento || seleccionado.accion)}</div><div>{formatFecha(seleccionado.fecha)} · {seleccionado.usuario || "SISTEMA"}</div>{seleccionado.request_id && <div className="text-break opacity-75">Solicitud: {seleccionado.request_id}</div>}</div>
                    {detalleVisible.map((item, idx) => <div key={`${seleccionado.id_auditoria}-detail-${idx}`} className={`${panelClass} p-2 mb-2`}><div className="small text-uppercase fw-semibold opacity-75">{prettyLabel(item.label)}</div><div className="small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{formatValueForDisplay(item.label, item.text, item.isJson)}</div></div>)}
                    {seleccionado.metadata && Object.keys(seleccionado.metadata).length > 0 && <div className={`${panelClass} p-2 mb-2`}><div className="small text-uppercase fw-semibold opacity-75">Metadata estructurada</div><pre className="small mb-0" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(seleccionado.metadata, null, 2)}</pre></div>}
                    {seleccionado.datos_antes && <div className={`${panelClass} p-2 mb-2`}><div className="small text-uppercase fw-semibold opacity-75">Antes</div><pre className="small mb-0" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(seleccionado.datos_antes, null, 2)}</pre></div>}
                    {seleccionado.datos_despues && <div className={`${panelClass} p-2 mb-2`}><div className="small text-uppercase fw-semibold opacity-75">Despues</div><pre className="small mb-0" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(seleccionado.datos_despues, null, 2)}</pre></div>}
                    {seleccionado.reversion_aplicada_sn === "S" && <div className="alert alert-info py-2 small">Movimiento revertido{seleccionado.reversion_motivo ? `: ${seleccionado.reversion_motivo}` : "."}</div>}
                    {canUndo && isUndoableAuditAction(seleccionado, detalleSeleccionado) && (
                      <div className="border border-danger rounded-3 p-2 mt-3">
                        {!reversionPendiente ? <button type="button" className="btn btn-outline-danger btn-sm w-100" onClick={() => { setReversionPendiente(seleccionado); setMotivoReversion(""); }}><FaUndo className="me-1" /> Deshacer movimiento</button> : <><div className="small fw-semibold mb-1">{getUndoPrompt(undoTypeSeleccionado, seleccionado.accion)}</div><textarea className={filtroInputClass} rows="3" maxLength="500" placeholder="Motivo obligatorio de la reversion" value={motivoReversion} onChange={(e) => setMotivoReversion(e.target.value)} /><div className="d-flex gap-2 mt-2"><button type="button" className="btn btn-danger btn-sm" disabled={deshaciendoId > 0 || motivoReversion.trim().length < 5} onClick={confirmarReversion}>{deshaciendoId > 0 ? "Deshaciendo..." : "Confirmar"}</button><button type="button" className="btn btn-outline-secondary btn-sm" disabled={deshaciendoId > 0} onClick={() => { setReversionPendiente(null); setMotivoReversion(""); }}>Cancelar</button></div></>}
                      </div>
                    )}
                  </div>
                </aside>
              )}
            </div>
          </div>
          <div className={`modal-footer ${darkMode ? "border-secondary" : ""} d-flex justify-content-between gap-2 flex-wrap`}>
            <div className="d-flex align-items-center gap-2"><button type="button" className={`btn btn-sm ${darkMode ? "btn-outline-light" : "btn-outline-secondary"}`} onClick={() => setPagina((current) => Math.max(1, current - 1))} disabled={cargando || pagina <= 1}><FaChevronLeft /></button><span className="small opacity-75">Página {pagina} de {totalPaginas}</span><button type="button" className={`btn btn-sm ${darkMode ? "btn-outline-light" : "btn-outline-secondary"}`} onClick={() => setPagina((current) => Math.min(totalPaginas, current + 1))} disabled={cargando || pagina >= totalPaginas}><FaChevronRight /></button></div>
            <div className="d-flex gap-2"><button type="button" className="btn btn-success" onClick={descargarExcel} disabled={exportando}><FaFileExcel className="me-2" />{exportando ? "Exportando..." : "Exportar Excel"}</button><button type="button" className={`btn ${darkMode ? "btn-secondary" : "btn-dark"}`} onClick={cerrarModal}>Cerrar</button></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalAuditoria;
