const normalizeSpaces = (value) => String(value ?? "")
  .replace(/\s+/g, " ")
  .trim();

const normalizeComparable = (value) => normalizeSpaces(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^A-Z0-9 ]/gi, "")
  .toUpperCase();

const cleanTagValue = (value) => {
  const text = normalizeSpaces(value).replace(/^[:#-]+|[:#-]+$/g, "").trim();
  if (!text) return "";
  const upper = text.toUpperCase();
  if (upper === "NRO" || upper === "MZ" || upper === "LT") return "";
  if (/^0+$/.test(text)) return "";
  return text;
};

const extractTag = (text, label) => {
  const match = String(text || "").match(new RegExp(`\\b${label}\\s*:?\\s*([A-Z0-9-]+)`, "i"));
  return cleanTagValue(match?.[1] || "");
};

const collapseRepeatedPhrase = (value) => {
  const text = normalizeSpaces(value);
  if (!text) return "";
  const directMatch = text.match(/^(.+?)\s+\1$/i);
  if (directMatch?.[1]) return normalizeSpaces(directMatch[1]);

  const words = text.split(" ");
  if (words.length % 2 !== 0) return text;
  const half = words.length / 2;
  const first = words.slice(0, half).join(" ");
  const second = words.slice(half).join(" ");
  return normalizeComparable(first) === normalizeComparable(second) ? first : text;
};

const stripAddressTags = (value) => collapseRepeatedPhrase(
  normalizeSpaces(value)
    .replace(/\bNRO\s*:?\s*[A-Z0-9-]+/gi, " ")
    .replace(/\bMZ\s*:?\s*[A-Z0-9-]*/gi, " ")
    .replace(/\bLT\s*:?\s*[A-Z0-9-]*/gi, " ")
    .replace(/\bN[º°]\s*[A-Z0-9-]+/gi, " ")
    .replace(/\s+:\s*/g, " ")
);

const parseLegacyNumeroMzLt = (value) => {
  const raw = normalizeSpaces(value);
  if (!raw) {
    return { numero: "", manzana: "", lote: "" };
  }

  const hasLabels = /\b(?:NRO|MZ|LT|N[º°])\s*:?\s*/i.test(raw);
  const numero = extractTag(raw, "NRO") || extractTag(raw, "N[º°]");
  const manzana = extractTag(raw, "MZ");
  const lote = extractTag(raw, "LT");

  if (hasLabels) {
    return { numero, manzana, lote };
  }

  const plain = cleanTagValue(raw);
  return { numero: plain, manzana: "", lote: "" };
};

const normalizeLegacyReference = (streetName, reference) => {
  const base = stripAddressTags(reference);
  if (!base) return "";
  const baseNorm = normalizeComparable(base);
  const streetNorm = normalizeComparable(streetName);
  if (streetNorm && baseNorm === streetNorm) return "";
  return base;
};

module.exports = {
  normalizeSpaces,
  parseLegacyNumeroMzLt,
  normalizeLegacyReference,
  stripAddressTags
};
