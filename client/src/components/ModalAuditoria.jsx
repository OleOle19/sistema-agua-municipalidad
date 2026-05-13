import { useState, useEffect, useMemo, useCallback } from "react";
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
  anulaciones_reintegradas: "Anulaciones reintegradas"
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
  { value: "TODOS", label: "Todos" },
  { value: "GET", label: "Consultas" },
  { value: "POST", label: "Registros" },
  { value: "PUT", label: "Cambios" },
  { value: "PATCH", label: "Ajustes" },
  { value: "DELETE", label: "Eliminaciones" },
  { value: "SISTEMA", label: "Sistema" }
];

const getActionBadgeClass = (accion) => {
  const txt = String(accion || "").toUpperCase();
  if (!txt) return "bg-secondary";
  if (txt.includes("DELETE") || txt.includes("ELIMINAR") || txt.includes("ANULAR")) return "bg-danger";
  if (txt.includes("PUT") || txt.includes("PATCH") || txt.includes("UPDATE")) return "bg-warning text-dark";
  if (txt.includes("GET") || txt.includes("EXPORT")) return "bg-info text-dark";
  return "bg-success";
};

const normalizeAuditSearch = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const getActionMethod = (accion) => {
  const raw = String(accion || "").trim();
  const match = raw.match(/^(GET|POST|PUT|PATCH|DELETE)\b/i);
  return match ? match[1].toUpperCase() : "SISTEMA";
};

const isSensitiveAction = (accion) => {
  const txt = String(accion || "").toUpperCase();
  return txt.includes("DELETE")
    || txt.includes("ANULAR")
    || txt.includes("PASSWORD")
    || txt.includes("BACKUP")
    || txt.includes("CERR")
    || txt.includes("CORTE")
    || txt.includes("ELIMIN");
};

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
const isUndoableAuditAction = (log = {}) => String(log?.accion || "").trim().toUpperCase() === "CAMPO_SOLICITUD_APROBADA";

const ModalAuditoria = ({ cerrarModal, darkMode }) => {
  const [logs, setLogs] = useState([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [deshaciendoId, setDeshaciendoId] = useState(0);
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroMetodo, setFiltroMetodo] = useState("TODOS");
  const [soloSensibles, setSoloSensibles] = useState(false);
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [pagina, setPagina] = useState(1);

  const formatFecha = (isoString) => {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "-";
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  };

  const construirParamsConsulta = useCallback((pageValue = pagina) => {
    const params = {
      page: pageValue,
      page_size: AUDITORIA_PAGE_SIZE
    };
    const texto = String(filtroTexto || "").trim();
    if (texto) params.q = texto;
    if (filtroMetodo !== "TODOS") params.method = filtroMetodo;
    if (soloSensibles) params.sensitive = "S";
    if (fechaDesde) params.fecha_desde = fechaDesde;
    if (fechaHasta) params.fecha_hasta = fechaHasta;
    return params;
  }, [fechaDesde, fechaHasta, filtroMetodo, filtroTexto, pagina, soloSensibles]);

  const cargarLogs = useCallback(async (pageValue = pagina) => {
    try {
      setCargando(true);
      const res = await api.get("/auditoria", {
        params: construirParamsConsulta(pageValue)
      });
      const rows = Array.isArray(res?.data?.rows)
        ? res.data.rows
        : (Array.isArray(res?.data) ? res.data : []);
      setLogs(rows);
      setTotalLogs(Number(res?.data?.total || 0));
      setPagina(Math.max(1, Number(res?.data?.page || pageValue || 1)));
    } catch {
      console.error("Error cargando auditoria");
      setLogs([]);
      setTotalLogs(0);
    } finally {
      setCargando(false);
    }
  }, [construirParamsConsulta, pagina]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      cargarLogs();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [cargarLogs]);

  const totalPaginas = useMemo(
    () => Math.max(1, Math.ceil(Number(totalLogs || 0) / AUDITORIA_PAGE_SIZE)),
    [totalLogs]
  );
  const rangoInicio = totalLogs > 0 ? ((pagina - 1) * AUDITORIA_PAGE_SIZE) + 1 : 0;
  const rangoFin = totalLogs > 0 ? Math.min(((pagina - 1) * AUDITORIA_PAGE_SIZE) + logs.length, totalLogs) : 0;

  const descargarExcel = async () => {
    try {
      setExportando(true);
      const res = await api.get("/exportar/auditoria", {
        params: construirParamsConsulta(1),
        responseType: "blob",
        timeout: 0
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "auditoria.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert("No se pudo exportar la auditoria.");
    } finally {
      setExportando(false);
    }
  };
  const deshacerAuditoria = async (log) => {
    const idAuditoria = Number(log?.id_auditoria || 0);
    if (!idAuditoria) return;
    const confirmado = window.confirm("Se intentara deshacer esta aprobacion de solicitud de campo. Continuar?");
    if (!confirmado) return;
    try {
      setDeshaciendoId(idAuditoria);
      const res = await api.post(`/auditoria/${idAuditoria}/deshacer`);
      window.alert(res?.data?.mensaje || "Solicitud deshecha correctamente.");
      await cargarLogs();
    } catch (err) {
      window.alert(String(err?.response?.data?.error || "No se pudo deshacer la auditoria."));
    } finally {
      setDeshaciendoId(0);
    }
  };

  const modalContentClass = `modal-content ${darkMode ? "text-white" : ""}`;
  const modalContentStyle = darkMode ? { backgroundColor: "#2b3035", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-secondary text-white"}`;
  const closeBtnClass = `btn-close ${darkMode ? "btn-close-white" : ""}`;
  const tableClass = `table mb-0 ${darkMode ? "table-dark table-hover" : "table-hover"}`;
  const filtroInputClass = `form-control form-control-sm ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const filtroSelectClass = `form-select form-select-sm ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const filtroGroupTextClass = `input-group-text ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const detalleCardStyle = darkMode
    ? { backgroundColor: "#20262c", border: "1px solid #495057" }
    : { backgroundColor: "#f8f9fa", border: "1px solid #dee2e6" };

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className={modalContentClass} style={modalContentStyle}>
          <div className={headerClass}>
            <h5 className="modal-title"><FaShieldAlt className="me-2" /> Bitacora de Seguridad y Movimientos</h5>
            <button type="button" className={closeBtnClass} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body p-0">
            <div className={`p-3 border-bottom ${darkMode ? "border-secondary" : ""}`}>
              <div className="row g-2 align-items-center">
                <div className="col-xl-4 col-lg-6">
                  <div className="input-group input-group-sm">
                    <span className={filtroGroupTextClass}><FaSearch /></span>
                    <input
                      type="text"
                      className={filtroInputClass}
                      placeholder="Buscar por usuario, movimiento o detalle..."
                      value={filtroTexto}
                      onChange={(e) => {
                        setPagina(1);
                        setFiltroTexto(e.target.value);
                      }}
                    />
                  </div>
                </div>
                <div className="col-xl-2 col-md-3">
                  <select
                    className={filtroSelectClass}
                    value={filtroMetodo}
                    onChange={(e) => {
                      setPagina(1);
                      setFiltroMetodo(e.target.value);
                    }}
                  >
                    {METHOD_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-xl-2 col-md-3">
                  <div className="input-group input-group-sm">
                    <span className={filtroGroupTextClass}>Desde</span>
                    <input
                      type="date"
                      className={filtroInputClass}
                      value={fechaDesde}
                      onChange={(e) => {
                        setPagina(1);
                        setFechaDesde(e.target.value);
                      }}
                    />
                  </div>
                </div>
                <div className="col-xl-2 col-md-3">
                  <div className="input-group input-group-sm">
                    <span className={filtroGroupTextClass}>Hasta</span>
                    <input
                      type="date"
                      className={filtroInputClass}
                      value={fechaHasta}
                      onChange={(e) => {
                        setPagina(1);
                        setFechaHasta(e.target.value);
                      }}
                    />
                  </div>
                </div>
                <div className="col-xl-2 col-md-3">
                  <div className="d-flex flex-column flex-md-row gap-2 justify-content-md-end align-items-md-center">
                    <div className="form-check form-switch mt-1 mb-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="auditoria-sensibles"
                        checked={soloSensibles}
                        onChange={(e) => {
                          setPagina(1);
                          setSoloSensibles(e.target.checked);
                        }}
                      />
                      <label className="form-check-label small" htmlFor="auditoria-sensibles">Solo delicados</label>
                    </div>
                    <button
                      type="button"
                      className={`btn btn-sm ${darkMode ? "btn-outline-light" : "btn-outline-secondary"}`}
                      onClick={() => cargarLogs()}
                      disabled={cargando}
                    >
                      <FaSyncAlt className="me-1" /> Recargar
                    </button>
                  </div>
                </div>
              </div>
              <div className="small mt-2 opacity-75 d-flex flex-wrap gap-3">
                <span>Mostrando {rangoInicio}-{rangoFin} de {totalLogs} registro(s)</span>
                <span>Pagina {pagina} de {totalPaginas}</span>
                <span>Lote de {AUDITORIA_PAGE_SIZE}</span>
              </div>
            </div>
            <div className="table-responsive" style={{ maxHeight: "60vh" }}>
              <table className={tableClass} style={{ minWidth: "980px" }}>
                <colgroup>
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "54%" }} />
                </colgroup>
                <thead className={darkMode ? "" : "table-light"}>
                  <tr>
                    <th>Fecha / Hora</th>
                    <th>Usuario</th>
                    <th>Movimiento</th>
                    <th>Resumen</th>
                  </tr>
                </thead>
                <tbody>
                  {cargando ? (
                    <tr><td colSpan="4" className="text-center p-3">Cargando bitacora...</td></tr>
                  ) : logs.length === 0 ? (
                    <tr><td colSpan="4" className="text-center p-3">{totalLogs === 0 ? "No hay registros." : "No hay registros para este filtro."}</td></tr>
                  ) : (
                    logs.map((log) => {
                      const accionSimple = toFriendlyAction(log.accion);
                      const detalleRows = parseDetalle(log.detalle);
                      return (
                        <tr key={log.id_auditoria}>
                          <td className="align-top text-nowrap">{formatFecha(log.fecha)}</td>
                          <td className="fw-bold align-top">{log.usuario || "SISTEMA"}</td>
                          <td className="align-top">
                            <span className={`badge ${getActionBadgeClass(log.accion)}`}>
                              {accionSimple}
                            </span>
                          </td>
                          <td className="align-top">
                            <div className="rounded-3 p-2 w-100" style={detalleCardStyle}>
                              {isUndoableAuditAction(log) && (
                                <div className="d-flex justify-content-end mb-2">
                                  <button
                                    type="button"
                                    className={`btn btn-sm ${darkMode ? "btn-outline-warning" : "btn-outline-danger"}`}
                                    onClick={() => deshacerAuditoria(log)}
                                    disabled={deshaciendoId === Number(log.id_auditoria || 0)}
                                  >
                                    <FaUndo className="me-1" />
                                    {deshaciendoId === Number(log.id_auditoria || 0) ? "Deshaciendo..." : "Deshacer"}
                                  </button>
                                </div>
                              )}
                              {detalleRows.length === 0 ? (
                                <span className="small text-muted">Sin detalle</span>
                              ) : (
                                detalleRows.map((item, idx) => {
                                  const labelKey = String(item.label || "").trim().toLowerCase();
                                  const valueToRender = formatValueForDisplay(item.label, item.text, item.isJson);
                                  const showAsCodeBlock = item.isJson
                                    && labelKey !== "params"
                                    && labelKey !== "body"
                                    && labelKey !== "cambios_aplicados"
                                    && labelKey !== "cambios_solicitados"
                                    && labelKey !== "detalle_recibos"
                                    && labelKey !== "contribuyentes"
                                    && labelKey !== "anulaciones_reintegradas";
                                  return (
                                    <div key={`${log.id_auditoria}-${idx}`} className={idx < detalleRows.length - 1 ? "mb-2" : ""}>
                                      <div className="small text-uppercase fw-semibold opacity-75">{prettyLabel(item.label)}</div>
                                      {showAsCodeBlock ? (
                                        <pre
                                          className="mb-0 small"
                                          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "Consolas, monospace" }}
                                        >
                                          {valueToRender}
                                        </pre>
                                      ) : (
                                        <div className="small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                          {valueToRender}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className={`modal-footer ${darkMode ? "border-secondary" : ""} d-flex justify-content-between gap-2 flex-wrap`}>
            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                className={`btn btn-sm ${darkMode ? "btn-outline-light" : "btn-outline-secondary"}`}
                onClick={() => setPagina((current) => Math.max(1, current - 1))}
                disabled={cargando || pagina <= 1}
              >
                <FaChevronLeft />
              </button>
              <span className="small opacity-75">Pagina {pagina} de {totalPaginas}</span>
              <button
                type="button"
                className={`btn btn-sm ${darkMode ? "btn-outline-light" : "btn-outline-secondary"}`}
                onClick={() => setPagina((current) => Math.min(totalPaginas, current + 1))}
                disabled={cargando || pagina >= totalPaginas}
              >
                <FaChevronRight />
              </button>
            </div>
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-success" onClick={descargarExcel} disabled={exportando}>
                <FaFileExcel className="me-2" />
                {exportando ? "Exportando..." : "Exportar Excel"}
              </button>
              <button type="button" className={`btn ${darkMode ? "btn-secondary" : "btn-dark"}`} onClick={cerrarModal}>Cerrar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalAuditoria;
