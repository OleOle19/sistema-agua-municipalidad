const normalizeRole = (role) => {
  const raw = String(role || "").trim().toUpperCase();
  if (["ADMIN", "SUPERADMIN", "ADMIN_PRINCIPAL", "NIVEL_1"].includes(raw)) return "ADMIN";
  if (["ADMIN_AUX", "ADMINISTRADOR_SECUNDARIO", "SUBADMIN"].includes(raw)) return "ADMIN_AUX";
  if (["ADMIN_SEC", "ADMIN_SECUNDARIO", "JEFE_CAJA", "NIVEL_2"].includes(raw)) return "ADMIN_SEC";
  if (["CAJERO", "OPERADOR_CAJA", "OPERADOR", "NIVEL_3"].includes(raw)) return "CAJERO";
  if (["BRIGADA", "BRIGADISTA", "CAMPO", "NIVEL_5"].includes(raw)) return "BRIGADA";
  return "CONSULTA";
};

const canAccessCaja = (role) => ["ADMIN", "ADMIN_SEC", "CAJERO"].includes(normalizeRole(role));

const normalizeModule = (moduleName) => {
  const raw = String(moduleName || "").trim().toUpperCase();
  if (["AGUA", "WATER"].includes(raw)) return "AGUA";
  if (["LUZ", "ELECTRICIDAD"].includes(raw)) return "LUZ";
  if (["CAJA", "CAJA_MUNICIPAL"].includes(raw)) return "CAJA";
  if (["CAMPO", "APP_CAMPO"].includes(raw)) return "CAMPO";
  return "";
};

const canAccessModule = (role, moduleName) => {
  const normalizedRole = normalizeRole(role);
  const normalizedModule = normalizeModule(moduleName);
  if (!normalizedModule) return false;
  if (normalizedRole === "ADMIN") return true;
  if (normalizedRole === "ADMIN_AUX") return normalizedModule === "AGUA";
  if (normalizedRole === "ADMIN_SEC") return ["AGUA", "LUZ", "CAJA"].includes(normalizedModule);
  if (normalizedRole === "CONSULTA") return ["AGUA", "LUZ"].includes(normalizedModule);
  if (normalizedRole === "CAJERO") return normalizedModule === "CAJA";
  if (normalizedRole === "BRIGADA") return normalizedModule === "CAMPO";
  return false;
};

const isCajaOperation = (method, pathname) => {
  const currentMethod = String(method || "GET").trim().toUpperCase();
  const path = String(pathname || "").split("?")[0];
  if (path === "/caja" || path.startsWith("/caja/")) return true;
  return ["POST", "PUT", "PATCH", "DELETE"].includes(currentMethod)
    && (path === "/pagos" || path.startsWith("/pagos/"));
};

const isCajaReadOnlyReport = (method, pathname) => {
  if (String(method || "GET").trim().toUpperCase() !== "GET") return false;
  const path = String(pathname || "").split("?")[0];
  return ["/caja/reporte", "/caja/reporte/excel", "/caja/alertas-riesgo"].includes(path);
};

const isCajaDeniedForRole = (role, method, pathname) => (
  normalizeRole(role) === "ADMIN_AUX"
  && isCajaOperation(method, pathname)
  && !isCajaReadOnlyReport(method, pathname)
);

const isCajaUndoDeniedForRole = (role, undoType) => (
  normalizeRole(role) === "ADMIN_AUX"
  && ["PAGO_ANULADO", "ORDEN_COBRO_ANULADA"].includes(String(undoType || "").trim().toUpperCase())
);

module.exports = {
  canAccessCaja,
  canAccessModule,
  isCajaDeniedForRole,
  isCajaOperation,
  isCajaReadOnlyReport,
  isCajaUndoDeniedForRole,
  normalizeModule,
  normalizeRole
};
