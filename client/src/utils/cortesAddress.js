const STREET_NOISE_TOKENS = new Set([
  "av",
  "avenida",
  "jr",
  "jiron",
  "calle",
  "ca",
  "pasaje",
  "psje",
  "pje",
  "prolongacion",
  "prol",
  "urb",
  "sector",
  "mz",
  "manzana",
  "lt",
  "lote",
  "nro",
  "no",
  "num",
  "numero",
  "int",
  "interior",
  "dpto",
  "departamento",
  "block",
  "bloque"
]);

export const normalizeText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const isRomanToken = (token) => /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(token);

export const extractAddressNumber = (item) => {
  const fromNumeroCasa = String(item?.numero_casa || "").match(/\d+/);
  if (fromNumeroCasa) return Number(fromNumeroCasa[0]);
  const fromDireccion = String(item?.direccion_completa || "").match(/\d+/);
  if (fromDireccion) return Number(fromDireccion[0]);
  return Number.MAX_SAFE_INTEGER;
};

export const normalizeStreetFromAddress = (value) => {
  const compact = normalizeText(value)
    .replace(/\ba\s*v\b/g, " av ")
    .replace(/\bj\s*r\b/g, " jr ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = compact
    .split(" ")
    .filter(Boolean)
    .filter((token) => {
      if (/^\d+[a-z]?$/.test(token)) return false;
      if (STREET_NOISE_TOKENS.has(token)) return false;
      if (token.length === 1 && !isRomanToken(token)) return false;
      return true;
    });

  return tokens.join(" ").trim() || "~";
};

export const getStreetGroupKey = (item) => {
  const idCalle = Number(item?.id_calle);
  if (Number.isInteger(idCalle) && idCalle > 0) return `id:${idCalle}`;
  return `txt:${normalizeStreetFromAddress(item?.direccion_completa)}`;
};

export const getStreetDisplayName = (item) => normalizeStreetFromAddress(item?.direccion_completa);

export const compareByDireccionAsc = (a, b) => {
  const streetA = getStreetDisplayName(a);
  const streetB = getStreetDisplayName(b);
  const byStreet = streetA.localeCompare(streetB, "es");
  if (byStreet !== 0) return byStreet;

  const numA = extractAddressNumber(a);
  const numB = extractAddressNumber(b);
  if (numA !== numB) return numA - numB;

  return normalizeText(a?.nombre_completo).localeCompare(normalizeText(b?.nombre_completo), "es");
};
