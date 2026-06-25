export const ESTADOS_CONEXION = {
  CON_CONEXION: "CON_CONEXION",
  SIN_CONEXION: "SIN_CONEXION",
  CORTADO: "CORTADO"
};

const MAPA_ESTADOS_CONEXION = [
  { value: ESTADOS_CONEXION.CON_CONEXION, aliases: ["CON_CONEXION", "CONEXION", "CONECTADO", "ACTIVO"] },
  { value: ESTADOS_CONEXION.SIN_CONEXION, aliases: ["SIN_CONEXION", "SIN CONEXION", "SIN_SERVICIO", "NO_CONECTADO", "INACTIVO"] },
  { value: ESTADOS_CONEXION.CORTADO, aliases: ["CORTADO", "CORTE", "SUSPENDIDO", "SUSPENSION"] }
];

export const ESTADO_CONEXION_LABELS = {
  CON_CONEXION: "Con conexión",
  SIN_CONEXION: "Sin conexión",
  CORTADO: "Cortado"
};

export const normalizeEstadoConexion = (value, fallback = ESTADOS_CONEXION.SIN_CONEXION) => {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return fallback;
  const match = MAPA_ESTADOS_CONEXION.find((item) => item.aliases.includes(raw));
  return match?.value || fallback;
};

export const isEstadoConexionActiva = (value) =>
  normalizeEstadoConexion(value) === ESTADOS_CONEXION.CON_CONEXION;
