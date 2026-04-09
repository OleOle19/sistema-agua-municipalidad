const toFinite = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const round2 = (value) => Math.round((toFinite(value, 0) + Number.EPSILON) * 100) / 100;

export const parseMoneyInput = (value, fallback = 0) => {
  const normalized = String(value ?? "").trim().replace(",", ".");
  return toFinite(normalized, fallback);
};

export const normalizeMoneyTyping = (value, { max = Number.POSITIVE_INFINITY } = {}) => {
  const raw = String(value ?? "").replace(",", ".").trim();
  if (raw === "") return "";
  if (raw === ".") return "0.";
  if (!/^\d*(\.\d{0,2})?$/.test(raw)) return null;

  const parsed = parseMoneyInput(raw, Number.NaN);
  if (!Number.isFinite(parsed)) return raw;
  if (Number.isFinite(max) && parsed > max + 0.0001) {
    return round2(max).toFixed(2);
  }
  return raw;
};

export const finalizeMoneyInput = (
  value,
  {
    min = 0,
    max = Number.POSITIVE_INFINITY,
    emptyValue = "0.00"
  } = {}
) => {
  const raw = String(value ?? "").trim();
  if (!raw) return emptyValue;
  let numeric = parseMoneyInput(raw, Number.NaN);
  if (!Number.isFinite(numeric)) return emptyValue;
  if (Number.isFinite(min)) numeric = Math.max(min, numeric);
  if (Number.isFinite(max)) numeric = Math.min(max, numeric);
  return round2(numeric).toFixed(2);
};
