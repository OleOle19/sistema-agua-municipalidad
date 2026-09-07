const toPositiveInt = (value) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const resolvePaymentCorrectionState = (row = {}) => {
  const type = String(row.tipo_movimiento_admin || row.tipo_movimiento || "").trim().toUpperCase();
  const state = String(row.estado_movimiento_admin || row.estado_correccion || "").trim().toUpperCase();
  if (type !== "ANULACION" || state !== "PENDIENTE_REINTEGRO") return state;

  const originalPaymentId = toPositiveInt(
    row.id_pago_original_movimiento_admin ?? row.id_pago_original
  );
  const replacementPaymentId = toPositiveInt(
    row.id_pago_reintegrado_movimiento_admin ?? row.id_pago_reintegrado
  );
  const latestActivePaymentId = toPositiveInt(row.id_ultimo_pago);

  if (replacementPaymentId > 0) return "REINTEGRADO";
  if (originalPaymentId > 0 && latestActivePaymentId > originalPaymentId) return "REINTEGRADO";
  return state;
};

module.exports = { resolvePaymentCorrectionState };
