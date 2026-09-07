const test = require("node:test");
const assert = require("node:assert/strict");

const { resolvePaymentCorrectionState } = require("../payment-correction-state");

test("mantiene una anulación realmente pendiente", () => {
  assert.equal(resolvePaymentCorrectionState({
    tipo_movimiento_admin: "ANULACION",
    estado_movimiento_admin: "PENDIENTE_REINTEGRO",
    id_pago_original_movimiento_admin: 120,
    id_ultimo_pago: null
  }), "PENDIENTE_REINTEGRO");
});

test("no confunde un pago activo anterior con un reintegro", () => {
  assert.equal(resolvePaymentCorrectionState({
    tipo_movimiento_admin: "ANULACION",
    estado_movimiento_admin: "PENDIENTE_REINTEGRO",
    id_pago_original_movimiento_admin: 120,
    id_ultimo_pago: 115
  }), "PENDIENTE_REINTEGRO");
});

test("reconoce un reintegro enlazado explícitamente", () => {
  assert.equal(resolvePaymentCorrectionState({
    tipo_movimiento_admin: "ANULACION",
    estado_movimiento_admin: "PENDIENTE_REINTEGRO",
    id_pago_original_movimiento_admin: 120,
    id_pago_reintegrado_movimiento_admin: 135
  }), "REINTEGRADO");
});

test("reconoce reintegros antiguos por el pago activo posterior", () => {
  assert.equal(resolvePaymentCorrectionState({
    tipo_movimiento_admin: "ANULACION",
    estado_movimiento_admin: "PENDIENTE_REINTEGRO",
    id_pago_original_movimiento_admin: 120,
    id_ultimo_pago: 135
  }), "REINTEGRADO");
});

test("no altera otros movimientos administrativos", () => {
  assert.equal(resolvePaymentCorrectionState({
    tipo_movimiento_admin: "EDICION_MONTO",
    estado_movimiento_admin: "EDITADO",
    id_pago_original_movimiento_admin: 120,
    id_ultimo_pago: 135
  }), "EDITADO");
});
