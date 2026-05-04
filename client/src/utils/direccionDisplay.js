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

const stripGenericSinNumero = (value) => {
  const text = normalizeSpaces(value);
  if (!text) return "";
  const cleaned = normalizeSpaces(
    text
      .replace(/\bS\s*\/?\s*N\b/gi, " ")
      .replace(/\bSIN\s+N[UÚ]MERO\b/gi, " ")
  );
  return cleaned || text;
};

const stripAddressTags = (value) => collapseRepeatedPhrase(
  stripGenericSinNumero(value)
    .replace(/\bNRO\s*:?\s*[A-Z0-9-]+/gi, " ")
    .replace(/\bMZ\s*:?\s*[A-Z0-9-]*/gi, " ")
    .replace(/\bLT\s*:?\s*[A-Z0-9-]*/gi, " ")
    .replace(/\bN[º°]\s*[A-Z0-9-]+/gi, " ")
    .replace(/\s+:\s*/g, " ")
);

export const formatDireccionDisplay = (value) => {
  const raw = normalizeSpaces(value);
  if (!raw) return "";

  const source = stripGenericSinNumero(raw);
  const nro = extractTag(source, "NRO") || extractTag(source, "N[º°]");
  const mz = extractTag(source, "MZ");
  const lt = extractTag(source, "LT");
  const base = stripAddressTags(source);

  const parts = [];
  if (base) parts.push(base);
  if (nro) parts.push(`NRO: ${nro}`);
  if (mz) parts.push(`MZ: ${mz}`);
  if (lt) parts.push(`LT: ${lt}`);

  return normalizeSpaces(parts.join(" ")) || source || raw;
};
