const test = require("node:test");
const assert = require("node:assert/strict");
const { canAccessCaja, canAccessModule, isCajaDeniedForRole, isCajaUndoDeniedForRole } = require("../role-policy");

test("Ventanilla conserva Caja y el nuevo administrador secundario no entra", () => {
  assert.equal(canAccessCaja("ADMIN"), true);
  assert.equal(canAccessCaja("ADMIN_SEC"), true);
  assert.equal(canAccessCaja("CAJERO"), true);
  assert.equal(canAccessCaja("ADMIN_AUX"), false);
  assert.equal(canAccessCaja("CONSULTA"), false);
});

test("el nuevo administrador secundario puede consultar reportes, pero no operar Caja", () => {
  assert.equal(isCajaDeniedForRole("ADMIN_AUX", "GET", "/caja/reporte"), false);
  assert.equal(isCajaDeniedForRole("ADMIN_AUX", "GET", "/caja/reporte/excel"), false);
  assert.equal(isCajaDeniedForRole("ADMIN_AUX", "GET", "/caja/alertas-riesgo"), false);
  assert.equal(isCajaDeniedForRole("ADMIN_AUX", "GET", "/caja/ordenes-cobro"), true);
  assert.equal(isCajaDeniedForRole("ADMIN_AUX", "POST", "/pagos"), true);
  assert.equal(isCajaDeniedForRole("ADMIN_AUX", "POST", "/pagos/8/anular"), true);
  assert.equal(isCajaDeniedForRole("ADMIN_AUX", "GET", "/auditoria"), false);
  assert.equal(isCajaDeniedForRole("ADMIN_SEC", "POST", "/pagos"), false);
  assert.equal(isCajaDeniedForRole("ADMIN", "POST", "/pagos"), false);
});

test("cada rol solo inicia sesion en los modulos que le corresponden", () => {
  assert.equal(canAccessModule("ADMIN", "AGUA"), true);
  assert.equal(canAccessModule("ADMIN", "LUZ"), true);
  assert.equal(canAccessModule("ADMIN", "CAJA"), true);
  assert.equal(canAccessModule("ADMIN", "CAMPO"), true);
  assert.equal(canAccessModule("ADMIN_AUX", "AGUA"), true);
  assert.equal(canAccessModule("ADMIN_AUX", "CAJA"), false);
  assert.equal(canAccessModule("ADMIN_AUX", "LUZ"), false);
  assert.equal(canAccessModule("ADMIN_AUX", "CAMPO"), false);
  assert.equal(canAccessModule("ADMIN_SEC", "AGUA"), true);
  assert.equal(canAccessModule("ADMIN_SEC", "LUZ"), true);
  assert.equal(canAccessModule("ADMIN_SEC", "CAJA"), true);
  assert.equal(canAccessModule("ADMIN_SEC", "CAMPO"), false);
  assert.equal(canAccessModule("CAJERO", "CAJA"), true);
  assert.equal(canAccessModule("CAJERO", "AGUA"), false);
  assert.equal(canAccessModule("CAJERO", "LUZ"), false);
  assert.equal(canAccessModule("BRIGADA", "CAMPO"), true);
  assert.equal(canAccessModule("BRIGADA", "AGUA"), false);
  assert.equal(canAccessModule("CONSULTA", "AGUA"), true);
  assert.equal(canAccessModule("CONSULTA", "LUZ"), true);
  assert.equal(canAccessModule("CONSULTA", "CAJA"), false);
});

test("el nuevo administrador secundario no puede revertir anulaciones de Caja desde Auditoría", () => {
  assert.equal(isCajaUndoDeniedForRole("ADMIN_AUX", "PAGO_ANULADO"), true);
  assert.equal(isCajaUndoDeniedForRole("ADMIN_AUX", "ORDEN_COBRO_ANULADA"), true);
  assert.equal(isCajaUndoDeniedForRole("ADMIN_AUX", "CONTRIBUYENTE_EDITADO"), false);
  assert.equal(isCajaUndoDeniedForRole("ADMIN_SEC", "PAGO_ANULADO"), false);
  assert.equal(isCajaUndoDeniedForRole("ADMIN", "PAGO_ANULADO"), false);
});
