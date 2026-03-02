import { useState, useEffect } from "react";
import api from "../api";
import { FaShieldAlt, FaFileExcel } from "react-icons/fa";

const ACTION_LABELS = {
  ORDEN_COBRO_COBRADA: "Orden de cobro cobrada",
  ORDEN_COBRO_EMITIDA: "Orden de cobro emitida",
  ORDEN_COBRO_ANULADA: "Orden de cobro anulada",
  CAJA_CIERRE_REGISTRADO: "Cierre de caja registrado",
  COBRO_DIRECTO_REGISTRADO: "Cobro directo registrado"
};

const SIMPLE_ROUTE_RULES = [
  { method: "POST", pattern: /^\/caja\/ordenes-cobro$/i, label: "Emitir orden de cobro" },
  { method: "POST", pattern: /^\/caja\/ordenes-cobro\/\d+\/cobrar$/i, label: "Cobrar orden de cobro" },
  { method: "POST", pattern: /^\/caja\/ordenes-cobro\/\d+\/anular$/i, label: "Anular orden de cobro" },
  { method: "POST", pattern: /^\/caja\/cierre$/i, label: "Registrar cierre de caja" },
  { method: "GET", pattern: /^\/exportar\/auditoria$/i, label: "Exportar auditoria" },
  { method: "GET", pattern: /^\/caja\/reporte\/excel$/i, label: "Exportar reporte de caja (Excel)" },
  { method: "POST", pattern: /^\/admin\/backup/i, label: "Crear respaldo de base de datos" }
];

const LABEL_TRANSLATIONS = {
  evento: "Evento",
  params: "Parametros",
  body: "Datos enviados",
  id: "ID",
  id_cierre: "ID cierre",
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
  cargo_reimpresion: "Cargo reimpresion",
  motivo: "Motivo"
};

const getActionBadgeClass = (accion) => {
  const txt = String(accion || "").toUpperCase();
  if (!txt) return "bg-secondary";
  if (txt.includes("DELETE") || txt.includes("ELIMINAR") || txt.includes("ANULAR")) return "bg-danger";
  if (txt.includes("PUT") || txt.includes("PATCH") || txt.includes("UPDATE")) return "bg-warning text-dark";
  if (txt.includes("GET") || txt.includes("EXPORT")) return "bg-info text-dark";
  return "bg-success";
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
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
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

const ModalAuditoria = ({ cerrarModal, darkMode }) => {
  const [logs, setLogs] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    const cargarLogs = async () => {
      try {
        const res = await api.get("/auditoria");
        setLogs(res.data);
      } catch (error) {
        console.error("Error cargando auditoria");
      } finally {
        setCargando(false);
      }
    };
    cargarLogs();
  }, []);

  const formatFecha = (isoString) => {
    const date = new Date(isoString);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  };

  const descargarExcel = async () => {
    try {
      setExportando(true);
      const res = await api.get("/exportar/auditoria", {
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
    } catch (error) {
      alert("No se pudo exportar la auditoria.");
    } finally {
      setExportando(false);
    }
  };

  const modalContentClass = `modal-content ${darkMode ? "text-white" : ""}`;
  const modalContentStyle = darkMode ? { backgroundColor: "#2b3035", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-secondary text-white"}`;
  const closeBtnClass = `btn-close ${darkMode ? "btn-close-white" : ""}`;
  const tableClass = `table mb-0 ${darkMode ? "table-dark table-hover" : "table-hover"}`;
  const detalleCardStyle = darkMode
    ? { backgroundColor: "#20262c", border: "1px solid #495057" }
    : { backgroundColor: "#f8f9fa", border: "1px solid #dee2e6" };

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className={modalContentClass} style={modalContentStyle}>
          <div className={headerClass}>
            <h5 className="modal-title"><FaShieldAlt className="me-2" /> Bitacora de Seguridad y Auditoria</h5>
            <button type="button" className={closeBtnClass} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body p-0">
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
                    <th>Accion</th>
                    <th>Detalle del Evento</th>
                  </tr>
                </thead>
                <tbody>
                  {cargando ? (
                    <tr><td colSpan="4" className="text-center p-3">Cargando bitacora...</td></tr>
                  ) : logs.length === 0 ? (
                    <tr><td colSpan="4" className="text-center p-3">No hay registros.</td></tr>
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
                            {accionSimple !== log.accion && (
                              <div className="small opacity-75 mt-1" style={{ wordBreak: "break-word" }}>
                                {log.accion}
                              </div>
                            )}
                          </td>
                          <td className="align-top">
                            <div className="rounded-3 p-2 w-100" style={detalleCardStyle}>
                              {detalleRows.length === 0 ? (
                                <span className="small text-muted">Sin detalle</span>
                              ) : (
                                detalleRows.map((item, idx) => {
                                  const labelKey = String(item.label || "").trim().toLowerCase();
                                  const valueToRender = formatValueForDisplay(item.label, item.text, item.isJson);
                                  const showAsCodeBlock = item.isJson && labelKey !== "params" && labelKey !== "body";
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
                                )})
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
          <div className={`modal-footer ${darkMode ? "border-secondary" : ""}`}>
            <button type="button" className="btn btn-success" onClick={descargarExcel} disabled={exportando}>
              <FaFileExcel className="me-2" />
              {exportando ? "Exportando..." : "Exportar Excel"}
            </button>
            <button type="button" className={`btn ${darkMode ? "btn-secondary" : "btn-dark"}`} onClick={cerrarModal}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalAuditoria;
