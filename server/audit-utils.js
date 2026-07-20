const DEFAULT_REDACT_KEYS = new Set([
  "password",
  "password_actual",
  "password_nuevo",
  "password_confirmacion",
  "password_visible",
  "contrasena",
  "clave",
  "secret",
  "jwt_secret",
  "token",
  "authorization",
  "cookie",
  "archivo",
  "foto_medidor_base64"
]);

const normalizeAuditKey = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toLowerCase();

const shouldRedactAuditKey = (key) => {
  const normalized = normalizeAuditKey(key);
  if (DEFAULT_REDACT_KEYS.has(normalized)) return true;
  return normalized.includes("password")
    || normalized.includes("contrasena")
    || normalized.endsWith("token")
    || normalized.includes("secret")
    || normalized === "api_key"
    || normalized === "apikey"
    || normalized === "private_key"
    || normalized.includes("base64")
    || normalized === "auth";
};

const redactAuditPayload = (value, options = {}, depth = 0) => {
  const maxDepth = Math.max(1, Number(options.maxDepth || 5));
  const maxArrayItems = Math.max(1, Number(options.maxArrayItems || 30));
  const maxStringLength = Math.max(40, Number(options.maxStringLength || 500));
  if (depth > maxDepth) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    const normalized = value.replace(/\r?\n/g, " ").trim();
    return normalized.length > maxStringLength
      ? `${normalized.slice(0, Math.max(0, maxStringLength - 3))}...`
      : normalized;
  }
  if (["number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, maxArrayItems).map((item) => redactAuditPayload(item, options, depth + 1));
    if (value.length > maxArrayItems) items.push(`[OMITIDOS:${value.length - maxArrayItems}]`);
    return items;
  }
  if (typeof value === "object") {
    const output = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = shouldRedactAuditKey(key)
        ? "[REDACTED]"
        : redactAuditPayload(nestedValue, options, depth + 1);
    }
    return output;
  }
  return String(value);
};

const normalizeAuditEventCode = (value, fallback = "EVENTO_SISTEMA") => {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return fallback;
  const http = raw.match(/^(GET|POST|PUT|PATCH|DELETE)\s+([^?\s]+)/);
  if (http) {
    const route = http[2]
      .replace(/\/[0-9]+(?=\/|$)/g, "/:ID")
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:ID")
      .replace(/[^A-Z0-9/:_-]+/g, "_")
      .replace(/[:/]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return `${http[1]}_${route || "ROOT"}`.slice(0, 120);
  }
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || fallback;
};

const normalizeAuditActivityFilter = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "SISTEMA", "COMPENSACION"].includes(raw)
    ? raw
    : "TODOS";
};

const inferAuditCategory = (eventCode, method = "") => {
  const event = normalizeAuditEventCode(eventCode);
  const httpMethod = String(method || "").trim().toUpperCase();
  if (event.includes("AUTH") || event.includes("LOGIN") || event.includes("PASSWORD") || event.includes("ACCESO")) return "SEGURIDAD";
  if (event.includes("PAGO") || event.includes("COBRO") || event.includes("CAJA") || event.includes("CIERRE")) return "CAJA";
  if (event.includes("RECIBO") || event.includes("DEUDA")) return "DEUDA";
  if (event.includes("CONTRIBUYENTE") || event.includes("SUMINISTRO") || event.includes("PREDIO")) return "PADRON";
  if (event.includes("CAMPO") || event.includes("CORTE") || event.includes("ACTA")) return "CAMPO";
  if (event.includes("IMPORT") || event.includes("EXPORT") || event.includes("BACKUP")) return "DATOS";
  if (event.includes("USUARIO") || event.includes("CONFIG") || event.includes("TARIFA")) return "ADMINISTRACION";
  if (httpMethod === "GET") return "CONSULTA";
  return "SISTEMA";
};

const inferAuditRisk = (eventCode, category = "") => {
  const event = normalizeAuditEventCode(eventCode);
  const currentCategory = String(category || inferAuditCategory(event)).toUpperCase();
  if (
    event.includes("ELIMIN")
    || event.includes("DELETE")
    || event.includes("ANUL")
    || event.includes("PASSWORD")
    || event.includes("DESHECH")
    || event.includes("REINTEGR")
    || event.includes("BACKUP")
    || event.includes("IMPORT")
    || event.includes("ACCESO_DENEGADO")
  ) return "ALTO";
  if (["CAJA", "DEUDA", "SEGURIDAD", "ADMINISTRACION"].includes(currentCategory)) return "MEDIO";
  return "BAJO";
};

const inferAuditEntity = (pathRaw = "", params = {}) => {
  const path = String(pathRaw || "").split("?")[0];
  const candidates = [
    ["id_contribuyente", "CONTRIBUYENTE"],
    ["id_recibo", "RECIBO"],
    ["id_pago", "PAGO"],
    ["id_orden", "ORDEN_COBRO"],
    ["id_suministro", "SUMINISTRO"],
    ["id_solicitud", "SOLICITUD_CAMPO"],
    ["id", null]
  ];
  for (const [key, type] of candidates) {
    const value = params?.[key];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    let inferredType = type;
    if (!inferredType) {
      if (/contribuyentes/i.test(path)) inferredType = "CONTRIBUYENTE";
      else if (/recibos/i.test(path)) inferredType = "RECIBO";
      else if (/pagos/i.test(path)) inferredType = "PAGO";
      else if (/ordenes-cobro/i.test(path)) inferredType = "ORDEN_COBRO";
      else if (/suministros/i.test(path)) inferredType = "SUMINISTRO";
      else if (/solicitudes/i.test(path)) inferredType = "SOLICITUD_CAMPO";
      else inferredType = "RECURSO";
    }
    return { entidad_tipo: inferredType, entidad_id: String(value).trim().slice(0, 120) };
  }
  return { entidad_tipo: null, entidad_id: null };
};

module.exports = {
  inferAuditCategory,
  inferAuditEntity,
  inferAuditRisk,
  normalizeAuditActivityFilter,
  normalizeAuditEventCode,
  redactAuditPayload,
  shouldRedactAuditKey
};
