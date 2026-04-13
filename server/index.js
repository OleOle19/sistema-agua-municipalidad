const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const express = require("express");
const app = express();
const cors = require("cors");
const pool = require("./db");
const luzRouter = require("./luz/router");
const { importarDeudas } = require("./importar_deudas");
const ExcelJS = require('exceljs');
const xml2js = require('xml2js');
const multer = require('multer');
require("dotenv").config();
const { Readable } = require('stream');
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { WebSocketServer } = require("ws");
const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.AUTO_DEUDA_TIMEZONE || "America/Lima";

// --- HELPERS DE DIRECCIÓN ---
const normalizarNombreCalle = (valor) => {
  return (valor || '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '');
};

const extraerCalleYNumero = (direccionRaw) => {
  const direccion = (direccionRaw || '').toString().trim();
  if (!direccion) return { calle: 'SIN CALLE', numero: '' };

  const match = direccion.match(/^(.*?)(?:\s*(?:N|N°|Nº|NÂ°|NÂº|NO|NUM|NUMERO|#)\s*[:.]?\s*)(\d+[A-Z]?|S\/N)?$/i);
  if (match) {
    const calle = match[1].trim();
    const numero = (match[2] || '').trim();
    return { calle: calle || 'SIN CALLE', numero };
  }

  const matchFinalNumero = direccion.match(/^(.*\D)\s+(\d+[A-Z]?)$/);
  if (matchFinalNumero) {
    return { calle: matchFinalNumero[1].trim(), numero: matchFinalNumero[2].trim() };
  }

  return { calle: direccion, numero: '' };
};

const getFechaPartesZona = (date = new Date(), timeZone = APP_TIMEZONE) => {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = dtf.formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    anio: Number(map.year),
    mes: Number(map.month),
    dia: Number(map.day),
    hora: Number(map.hour) % 24,
    minuto: Number(map.minute),
    segundo: Number(map.second)
  };
};
const toISODate = (date = new Date()) => {
  const { anio, mes, dia } = getFechaPartesZona(date, APP_TIMEZONE);
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
};
const getCurrentYear = () => getFechaPartesZona(new Date(), APP_TIMEZONE).anio;
const getCurrentMonth = () => getFechaPartesZona(new Date(), APP_TIMEZONE).mes;
const getNextPeriod = (date = new Date()) => {
  const { anio: anioActual, mes: mesActual } = getFechaPartesZona(date, APP_TIMEZONE);
  const anio = mesActual === 12 ? (anioActual + 1) : anioActual;
  const mes = mesActual === 12 ? 1 : (mesActual + 1);
  return { anio, mes, periodoNum: (anio * 100) + mes };
};
const parseMonto = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const MAX_RECHAZOS_IMPORTACION = Number(process.env.MAX_RECHAZOS_IMPORTACION || 500);
const IMPORT_MAX_FILE_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.IMPORT_MAX_FILE_BYTES || (25 * 1024 * 1024))
);
const IMPORT_UPLOAD_DIR = path.join(__dirname, ".tmp", "imports");
const ensureImportUploadDir = () => {
  try {
    fs.mkdirSync(IMPORT_UPLOAD_DIR, { recursive: true });
  } catch {}
};
const uploadImport = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        ensureImportUploadDir();
        return cb(null, IMPORT_UPLOAD_DIR);
      } catch (err) {
        return cb(err);
      }
    },
    filename: (req, file, cb) => {
      const extRaw = String(path.extname(file?.originalname || ".tmp") || ".tmp").toLowerCase();
      const ext = extRaw.length > 10 ? ".tmp" : extRaw;
      return cb(null, `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext || ".tmp"}`);
    }
  }),
  limits: { fileSize: IMPORT_MAX_FILE_BYTES }
});
const uploadImportSingle = (fieldName) => (req, res, next) => {
  uploadImport.single(fieldName)(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: `El archivo excede el límite permitido (${Math.round(IMPORT_MAX_FILE_BYTES / (1024 * 1024))}MB).`
      });
    }
    return res.status(400).json({ error: err.message || "No se pudo procesar el archivo." });
  });
};
const cleanupUploadedTempFile = (file) => {
  const filePath = String(file?.path || "").trim();
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
};
const readTextFromUploadedFile = (file) => {
  const filePath = String(file?.path || "").trim();
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf8");
  }
  if (Buffer.isBuffer(file?.buffer)) {
    return file.buffer.toString("utf8");
  }
  return "";
};
const createReadStreamFromUploadedFile = (file) => {
  const filePath = String(file?.path || "").trim();
  if (filePath && fs.existsSync(filePath)) {
    return fs.createReadStream(filePath, { encoding: "utf8" });
  }
  if (Buffer.isBuffer(file?.buffer)) {
    return Readable.from([file.buffer.toString("utf8")]);
  }
  return null;
};
const loadWorkbookFromImportFile = async (file) => {
  const workbook = new ExcelJS.Workbook();
  const filePath = String(file?.path || "").trim();
  if (filePath && fs.existsSync(filePath)) {
    try {
      await workbook.xlsx.readFile(filePath);
      return workbook;
    } catch {
      await workbook.csv.readFile(filePath);
      return workbook;
    }
  }
  const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.alloc(0);
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    const stream = Readable.from([buffer]);
    await workbook.csv.read(stream);
  }
  return workbook;
};
const validateUploadFileType = (file, { allowedExts = [], allowedMimeTypes = [] } = {}) => {
  const name = String(file?.originalname || "").trim().toLowerCase();
  const ext = String(path.extname(name) || "").toLowerCase();
  const mime = String(file?.mimetype || "").trim().toLowerCase();
  if (!name || !ext) return "Archivo inválido.";
  if (!allowedExts.includes(ext)) {
    return `Formato no válido. Extensiones permitidas: ${allowedExts.join(", ")}.`;
  }
  if (!mime || !allowedMimeTypes.includes(mime)) {
    return `Tipo MIME no permitido: ${mime || "desconocido"}.`;
  }
  return "";
};
const LEGACY_COMPARACION_MAX_FILE_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.LEGACY_COMPARACION_MAX_FILE_BYTES || (100 * 1024 * 1024))
);
const LEGACY_COMPARACION_TOLERANCIA = Math.max(
  0,
  parseMonto(process.env.LEGACY_COMPARACION_TOLERANCIA, 0.01)
);
const LEGACY_COMPARACION_DETAIL_INSERT_CHUNK = 300;
const LEGACY_COMPARACION_UPLOAD_DIR = path.join(__dirname, ".tmp", "comparaciones_legacy_uploads");
const ensureLegacyUploadDir = () => {
  try {
    fs.mkdirSync(LEGACY_COMPARACION_UPLOAD_DIR, { recursive: true });
  } catch {}
};
const uploadLegacyComparacion = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        ensureLegacyUploadDir();
        return cb(null, LEGACY_COMPARACION_UPLOAD_DIR);
      } catch (err) {
        return cb(err);
      }
    },
    filename: (req, file, cb) => {
      const extRaw = String(path.extname(file?.originalname || ".xlsx") || ".xlsx");
      const ext = extRaw.length <= 10 ? extRaw : ".xlsx";
      const unique = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext || ".xlsx"}`;
      return cb(null, unique);
    }
  }),
  limits: { fileSize: LEGACY_COMPARACION_MAX_FILE_BYTES }
});
const CORTE_EVIDENCIA_MAX_FILE_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.CORTE_EVIDENCIA_MAX_FILE_BYTES || (15 * 1024 * 1024))
);
const CORTE_EVIDENCIA_MAX_FILES = Math.min(
  20,
  Math.max(1, Number(process.env.CORTE_EVIDENCIA_MAX_FILES || 8))
);
const CORTE_EVIDENCIA_UPLOAD_DIR = path.join(__dirname, "uploads", "cortes_evidencia");
const CORTE_EVIDENCIA_ALLOWED_EXTS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".doc",
  ".docx"
]);
const CORTE_EVIDENCIA_ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream"
]);
const ensureCorteEvidenciaUploadDir = () => {
  try {
    fs.mkdirSync(CORTE_EVIDENCIA_UPLOAD_DIR, { recursive: true });
  } catch {}
};
const sanitizeFilenamePart = (value, maxLen = 64) => {
  const ascii = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (ascii || "archivo").slice(0, Math.max(1, Number(maxLen) || 64));
};
const isCorteEvidenciaTipoPermitido = (file) => {
  const ext = String(path.extname(file?.originalname || "") || "").toLowerCase();
  if (!CORTE_EVIDENCIA_ALLOWED_EXTS.has(ext)) return false;
  const mime = String(file?.mimetype || "").trim().toLowerCase();
  if (!mime) return true;
  if (mime.startsWith("image/")) return true;
  return CORTE_EVIDENCIA_ALLOWED_MIMES.has(mime);
};
const cleanupUploadedTempFiles = (files = []) => {
  for (const file of Array.isArray(files) ? files : []) {
    cleanupUploadedTempFile(file);
  }
};
const uploadCorteEvidencia = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        ensureCorteEvidenciaUploadDir();
        return cb(null, CORTE_EVIDENCIA_UPLOAD_DIR);
      } catch (err) {
        return cb(err);
      }
    },
    filename: (req, file, cb) => {
      const originalName = String(file?.originalname || "evidencia").trim();
      const extRaw = String(path.extname(originalName) || "").toLowerCase();
      const ext = CORTE_EVIDENCIA_ALLOWED_EXTS.has(extRaw) ? extRaw : ".bin";
      const base = sanitizeFilenamePart(path.basename(originalName, extRaw), 40);
      const unique = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}_${base}${ext}`;
      return cb(null, unique);
    }
  }),
  limits: {
    fileSize: CORTE_EVIDENCIA_MAX_FILE_BYTES,
    files: CORTE_EVIDENCIA_MAX_FILES
  }
});
const uploadCorteEvidenciaArray = (fieldName = "evidencias") => (req, res, next) => {
  uploadCorteEvidencia.array(fieldName, CORTE_EVIDENCIA_MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    cleanupUploadedTempFiles(req?.files);
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: `Un archivo excede el límite permitido (${Math.round(CORTE_EVIDENCIA_MAX_FILE_BYTES / (1024 * 1024))}MB).`
      });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        error: `Solo se permiten hasta ${CORTE_EVIDENCIA_MAX_FILES} archivo(s) por corte.`
      });
    }
    return res.status(400).json({ error: err.message || "No se pudieron procesar los archivos de evidencia." });
  });
};
const CONTRIBUYENTE_ADJUNTO_MAX_FILE_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.CONTRIBUYENTE_ADJUNTO_MAX_FILE_BYTES || (20 * 1024 * 1024))
);
const CONTRIBUYENTE_ADJUNTO_MAX_FILES = Math.min(
  20,
  Math.max(1, Number(process.env.CONTRIBUYENTE_ADJUNTO_MAX_FILES || 8))
);
const CONTRIBUYENTE_ADJUNTO_UPLOAD_DIR = path.join(__dirname, "uploads", "contribuyentes_adjuntos");
const CONTRIBUYENTE_ADJUNTO_ALLOWED_EXTS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx"
]);
const CONTRIBUYENTE_ADJUNTO_ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream"
]);
const ensureContribuyenteAdjuntoUploadDir = () => {
  try {
    fs.mkdirSync(CONTRIBUYENTE_ADJUNTO_UPLOAD_DIR, { recursive: true });
  } catch {}
};
const isContribuyenteAdjuntoTipoPermitido = (file) => {
  const ext = String(path.extname(file?.originalname || "") || "").toLowerCase();
  if (!CONTRIBUYENTE_ADJUNTO_ALLOWED_EXTS.has(ext)) return false;
  const mime = String(file?.mimetype || "").trim().toLowerCase();
  if (!mime) return true;
  if (mime.startsWith("image/")) return true;
  return CONTRIBUYENTE_ADJUNTO_ALLOWED_MIMES.has(mime);
};
const uploadContribuyenteAdjuntos = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        ensureContribuyenteAdjuntoUploadDir();
        return cb(null, CONTRIBUYENTE_ADJUNTO_UPLOAD_DIR);
      } catch (err) {
        return cb(err);
      }
    },
    filename: (req, file, cb) => {
      const originalName = String(file?.originalname || "adjunto").trim();
      const extRaw = String(path.extname(originalName) || "").toLowerCase();
      const ext = CONTRIBUYENTE_ADJUNTO_ALLOWED_EXTS.has(extRaw) ? extRaw : ".bin";
      const base = sanitizeFilenamePart(path.basename(originalName, extRaw), 40);
      const unique = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}_${base}${ext}`;
      return cb(null, unique);
    }
  }),
  limits: {
    fileSize: CONTRIBUYENTE_ADJUNTO_MAX_FILE_BYTES,
    files: CONTRIBUYENTE_ADJUNTO_MAX_FILES
  }
});
const uploadContribuyenteAdjuntosArray = (fieldName = "adjuntos") => (req, res, next) => {
  uploadContribuyenteAdjuntos.array(fieldName, CONTRIBUYENTE_ADJUNTO_MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    cleanupUploadedTempFiles(req?.files);
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: `Un archivo excede el límite permitido (${Math.round(CONTRIBUYENTE_ADJUNTO_MAX_FILE_BYTES / (1024 * 1024))}MB).`
      });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        error: `Solo se permiten hasta ${CONTRIBUYENTE_ADJUNTO_MAX_FILES} archivo(s) por contribuyente.`
      });
    }
    return res.status(400).json({ error: err.message || "No se pudieron procesar los archivos adjuntos." });
  });
};
const AUTO_DEUDA_TIMEZONE = process.env.AUTO_DEUDA_TIMEZONE || APP_TIMEZONE;
const AUTO_DEUDA_CHECK_MS = Number(process.env.AUTO_DEUDA_CHECK_MS || (60 * 60 * 1000));
const AUTO_DEUDA_ACTIVA = process.env.AUTO_DEUDA_ACTIVA !== "0";
const ALLOW_DIRECT_PAYMENTS = process.env.ALLOW_DIRECT_PAYMENTS === "1";
const REALTIME_WS_ENABLED = process.env.REALTIME_WS_ENABLED === "1";
const REALTIME_AUTH_TIMEOUT_MS = Math.max(1000, Number(process.env.REALTIME_AUTH_TIMEOUT_MS || 5000));
const REALTIME_PING_TIMEOUT_MS = Math.max(10000, Number(process.env.REALTIME_PING_TIMEOUT_MS || 45000));
const AUTO_DEUDA_BASE = {
  agua: parseMonto(process.env.AUTO_DEUDA_AGUA, 7.5),
  desague: parseMonto(process.env.AUTO_DEUDA_DESAGUE, 3.5),
  limpieza: parseMonto(process.env.AUTO_DEUDA_LIMPIEZA, 3.5),
  admin: parseMonto(process.env.AUTO_DEUDA_ADMIN, 0.5)
};
const AUDIT_REDACT_KEYS = new Set([
  "password",
  "password_actual",
  "password_nuevo",
  "password_confirmacion",
  "password_visible",
  "token",
  "archivo"
]);
const ESTADOS_CONEXION = {
  CON_CONEXION: "CON_CONEXION",
  SIN_CONEXION: "SIN_CONEXION",
  CORTADO: "CORTADO"
};
const FUENTES_ESTADO_CONEXION = {
  INFERIDO: "INFERIDO",
  IMPORTACION: "IMPORTACION",
  OFICINA: "OFICINA",
  CAMPO: "CAMPO"
};
const ESTADOS_SOLICITUD_CAMPO = {
  PENDIENTE: "PENDIENTE",
  APROBADO: "APROBADO",
  RECHAZADO: "RECHAZADO"
};
const TIPOS_SOLICITUD_CAMPO = {
  ACTUALIZACION: "ACTUALIZACION",
  ALTA_DIRECCION_ALTERNA: "ALTA_DIRECCION_ALTERNA",
  ALTA_PREDIO: "ALTA_PREDIO",
  ALTA_PREDIO_TEMPORAL: "ALTA_PREDIO_TEMPORAL"
};
const ESTADOS_ORDEN_COBRO = {
  PENDIENTE: "PENDIENTE",
  COBRADA: "COBRADA",
  ANULADA: "ANULADA"
};
const TIPOS_ORDEN_COBRO = {
  NORMAL: "NORMAL",
  ADELANTADO: "ADELANTADO"
};
const ESTADOS_CONTEO_EFECTIVO = {
  PENDIENTE: "PENDIENTE",
  APLICADO: "APLICADO",
  ANULADO: "ANULADO"
};
const FUENTE_SOLICITUD_CAMPO = "APP_CAMPO";
const MOTIVOS_CAMBIO_RAZON_SOCIAL_VALIDOS = new Set([
  "FALLECIMIENTO_TITULAR",
  "TRANSFERENCIA_PROPIEDAD",
  "TRASPASO_CONYUGAL",
  "CORRECCION_DATOS",
  "OTRO"
]);
const LOGIN_RATE_LIMIT_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || (10 * 60 * 1000));
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 25);
const LOGIN_LOCK_THRESHOLD = Number(process.env.LOGIN_LOCK_THRESHOLD || 5);
const LOGIN_LOCK_DURATION_MS = Number(process.env.LOGIN_LOCK_DURATION_MS || (15 * 60 * 1000));
const CAJA_CIERRE_ALERTA_UMBRAL = parseMonto(process.env.CAJA_CIERRE_ALERTA_UMBRAL, 2);
const CAJA_RIESGO_WINDOW_HOURS = Math.min(168, Math.max(1, Number(process.env.CAJA_RIESGO_WINDOW_HOURS || 24)));
const CAJA_RIESGO_ANULACIONES_UMBRAL = Math.min(20, Math.max(1, Number(process.env.CAJA_RIESGO_ANULACIONES_UMBRAL || 3)));
const MAX_RETROACTIVE_COBRO_YEARS = Math.min(5, Math.max(0, Number(process.env.MAX_RETROACTIVE_COBRO_YEARS || 1)));
const MAX_DIAS_CORRECCION_PAGO = Math.min(30, Math.max(1, Number(process.env.MAX_DIAS_CORRECCION_PAGO || 7)));
const PAGO_OPERATIVO_CAJA_SQL = "(p.id_orden_cobro IS NOT NULL OR COALESCE(NULLIF(TRIM(p.usuario_cajero), ''), '') <> '')";
const normalizeHoraHM = (value, fallback) => {
  const raw = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(raw)) return fallback;
  const hh = Number(raw.slice(0, 2));
  const mm = Number(raw.slice(3, 5));
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};
const CAJA_HORA_INICIO = normalizeHoraHM(process.env.CAJA_HORA_INICIO, "07:00");
const CAJA_HORA_FIN = normalizeHoraHM(process.env.CAJA_HORA_FIN, "19:00");
const CAJA_AUTO_CIERRE_HORA = normalizeHoraHM(process.env.CAJA_AUTO_CIERRE_HORA, "16:00");
const CAJA_AUTO_CIERRE_CHECK_MS = Math.max(60 * 1000, Number(process.env.CAJA_AUTO_CIERRE_CHECK_MS || (5 * 60 * 1000)));
const loginIpRateMap = new Map();
const loginUserFailMap = new Map();

const normalizeEstadoConexion = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if ([
    "CON_CONEXION", "CONEXION", "CONECTADO", "ACTIVO", "EN_SERVICIO"
  ].includes(raw)) return ESTADOS_CONEXION.CON_CONEXION;
  if ([
    "SIN_CONEXION", "SIN CONEXION", "SIN_SERVICIO", "PENDIENTE_CONEXION", "INACTIVO", "NO_CONECTADO"
  ].includes(raw)) return ESTADOS_CONEXION.SIN_CONEXION;
  if ([
    "CORTADO", "CORTE", "SUSPENDIDO", "SUSPENSION"
  ].includes(raw)) return ESTADOS_CONEXION.CORTADO;
  return ESTADOS_CONEXION.CON_CONEXION;
};

const tryNormalizeEstadoConexion = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  if ([
    "CON_CONEXION", "CONEXION", "CONECTADO", "ACTIVO", "EN_SERVICIO"
  ].includes(raw)) return ESTADOS_CONEXION.CON_CONEXION;
  if ([
    "SIN_CONEXION", "SIN CONEXION", "SIN_SERVICIO", "PENDIENTE_CONEXION", "INACTIVO", "NO_CONECTADO"
  ].includes(raw)) return ESTADOS_CONEXION.SIN_CONEXION;
  if ([
    "CORTADO", "CORTE", "SUSPENDIDO", "SUSPENSION"
  ].includes(raw)) return ESTADOS_CONEXION.CORTADO;
  return null;
};

const normalizeFuenteEstadoConexion = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(FUENTES_ESTADO_CONEXION, raw)) return raw;
  return FUENTES_ESTADO_CONEXION.INFERIDO;
};

const normalizeTipoSolicitudCampo = (value, fallback = TIPOS_SOLICITUD_CAMPO.ACTUALIZACION) => {
  const raw = String(value || "").trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(TIPOS_SOLICITUD_CAMPO, raw)) return raw;
  return Object.prototype.hasOwnProperty.call(TIPOS_SOLICITUD_CAMPO, fallback)
    ? fallback
    : TIPOS_SOLICITUD_CAMPO.ACTUALIZACION;
};
const normalizeVerificacionEstado = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  return raw === "NO_VERIFICADO" ? "NO_VERIFICADO" : "VERIFICADO";
};
const normalizeVerificacionMotivo = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  if (["AUSENTE", "DIRECCION_INCORRECTA", "SIN_RECIBO", "NO_UBICADO"].includes(raw)) return raw;
  return null;
};
const normalizeFotoBase64 = (value, maxLen = 900000) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!raw.startsWith("data:image/")) return null;
  if (raw.length > maxLen) return "__TOO_LARGE__";
  return raw;
};

const normalizeSN = (value, fallback = "N") => {
  const raw = String(value || "").trim().toUpperCase();
  if (["S", "1", "SI", "TRUE", "Y", "YES"].includes(raw)) return "S";
  if (["N", "0", "NO", "FALSE"].includes(raw)) return "N";
  return fallback;
};
const SQL_SN_POSITIVOS = "('S', '1', 'SI', 'TRUE', 'Y', 'YES')";
const SQL_SN_NEGATIVOS = "('N', '0', 'NO', 'FALSE')";
const sqlSnEsSi = (sqlExpr, fallback = "S") => {
  const fallbackSN = normalizeSN(fallback, "N");
  const normalizado = `UPPER(COALESCE(NULLIF(TRIM(CAST(${sqlExpr} AS text)), ''), '${fallbackSN}'))`;
  if (fallbackSN === "S") return `${normalizado} NOT IN ${SQL_SN_NEGATIVOS}`;
  return `${normalizado} IN ${SQL_SN_POSITIVOS}`;
};
const normalizeMotivoCambioRazonSocial = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  return MOTIVOS_CAMBIO_RAZON_SOCIAL_VALIDOS.has(raw) ? raw : "";
};
const motivoCambioRazonSocialLabel = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "FALLECIMIENTO_TITULAR") return "Fallecimiento del titular";
  if (raw === "TRANSFERENCIA_PROPIEDAD") return "Transferencia de propiedad";
  if (raw === "TRASPASO_CONYUGAL") return "Traspaso conyugal";
  if (raw === "CORRECCION_DATOS") return "Correccion de datos";
  if (raw === "OTRO") return "Otro";
  return raw;
};

const normalizeDateOnly = (value) => {
  if (!value) return null;
  const formatDateOnly = (yyyy, mm, dd) =>
    `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const isValidDateParts = (yyyy, mm, dd) => {
    if (!Number.isInteger(yyyy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return false;
    if (yyyy < 1900 || yyyy > 9999 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
    const probe = new Date(Date.UTC(yyyy, mm - 1, dd));
    return probe.getUTCFullYear() === yyyy && (probe.getUTCMonth() + 1) === mm && probe.getUTCDate() === dd;
  };

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = value.getMonth() + 1;
    const dd = value.getDate();
    return isValidDateParts(yyyy, mm, dd) ? formatDateOnly(yyyy, mm, dd) : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const yyyy = Number(isoMatch[1]);
    const mm = Number(isoMatch[2]);
    const dd = Number(isoMatch[3]);
    return isValidDateParts(yyyy, mm, dd) ? formatDateOnly(yyyy, mm, dd) : null;
  }

  const dmyMatch = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const dd = Number(dmyMatch[1]);
    const mm = Number(dmyMatch[2]);
    const yyyy = Number(dmyMatch[3]);
    return isValidDateParts(yyyy, mm, dd) ? formatDateOnly(yyyy, mm, dd) : null;
  }

  return null;
};
const getRetroactiveCobroMinDate = (baseDateIso = toISODate(), yearsBack = MAX_RETROACTIVE_COBRO_YEARS) => {
  const base = normalizeDateOnly(baseDateIso);
  if (!base) return null;
  const safeYearsBack = Math.max(0, Number.isFinite(Number(yearsBack)) ? Number(yearsBack) : 0);
  if (safeYearsBack <= 0) return base;
  const [baseYear, baseMonth, baseDay] = base.split("-").map((v) => Number(v));
  const targetYear = baseYear - safeYearsBack;
  const monthText = String(baseMonth).padStart(2, "0");
  for (let day = baseDay; day >= 1; day -= 1) {
    const candidate = `${String(targetYear).padStart(4, "0")}-${monthText}-${String(day).padStart(2, "0")}`;
    if (normalizeDateOnly(candidate)) return candidate;
  }
  return `${String(targetYear).padStart(4, "0")}-${monthText}-01`;
};
const validateCobroDateWindow = (requestedDateRaw, hoyIso = toISODate()) => {
  const hoy = normalizeDateOnly(hoyIso) || toISODate();
  const fechaSolicitada = normalizeDateOnly(requestedDateRaw) || hoy;
  if (fechaSolicitada > hoy) {
    return {
      ok: false,
      fecha: fechaSolicitada,
      hoy,
      minPermitida: getRetroactiveCobroMinDate(hoy),
      error: "No se permite registrar cobros con fecha futura."
    };
  }
  const minPermitida = getRetroactiveCobroMinDate(hoy);
  if (minPermitida && fechaSolicitada < minPermitida) {
    return {
      ok: false,
      fecha: fechaSolicitada,
      hoy,
      minPermitida,
      error: `Solo se permite registrar cobros con antiguedad maxima de ${MAX_RETROACTIVE_COBRO_YEARS} año(s). Fecha minima permitida: ${minPermitida}.`
    };
  }
  return { ok: true, fecha: fechaSolicitada, hoy, minPermitida };
};
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const isoDateToUtcMs = (isoDateRaw) => {
  const iso = normalizeDateOnly(isoDateRaw);
  if (!iso) return null;
  const [yyyy, mm, dd] = iso.split("-").map((v) => Number(v));
  if (!Number.isInteger(yyyy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return null;
  return Date.UTC(yyyy, mm - 1, dd);
};
const diffDaysBetweenIsoDates = (fromIsoRaw, toIsoRaw) => {
  const fromMs = isoDateToUtcMs(fromIsoRaw);
  const toMs = isoDateToUtcMs(toIsoRaw);
  if (fromMs === null || toMs === null) return null;
  return Math.floor((toMs - fromMs) / DAY_IN_MS);
};
const shiftIsoDateByDays = (isoDateRaw, deltaDays = 0) => {
  const iso = normalizeDateOnly(isoDateRaw);
  if (!iso) return null;
  const [yyyy, mm, dd] = iso.split("-").map((v) => Number(v));
  const probe = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (Number.isNaN(probe.getTime())) return null;
  probe.setUTCDate(probe.getUTCDate() + Number(deltaDays || 0));
  const y = probe.getUTCFullYear();
  const m = String(probe.getUTCMonth() + 1).padStart(2, "0");
  const d = String(probe.getUTCDate()).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${m}-${d}`;
};
const getPagoCorrectionMinDate = (hoyIso = toISODate()) => {
  const hoy = normalizeDateOnly(hoyIso) || toISODate();
  const hoyMs = isoDateToUtcMs(hoy);
  if (hoyMs === null) return hoy;
  const minDate = new Date(hoyMs - (MAX_DIAS_CORRECCION_PAGO * DAY_IN_MS));
  return normalizeDateOnly(minDate) || hoy;
};
const validatePagoCorrectionWindow = (fechaPagoRaw, hoyIso = toISODate()) => {
  const hoy = normalizeDateOnly(hoyIso) || toISODate();
  const fechaPago = normalizeDateOnly(fechaPagoRaw);
  const fechaMinima = getPagoCorrectionMinDate(hoy);

  if (!fechaPago) {
    return {
      ok: false,
      fechaPago: null,
      hoy,
      fechaMinima,
      diasTranscurridos: null,
      error: "No se pudo validar la fecha del pago original para anular/editar."
    };
  }

  const diasTranscurridos = diffDaysBetweenIsoDates(fechaPago, hoy);
  if (!Number.isInteger(diasTranscurridos)) {
    return {
      ok: false,
      fechaPago,
      hoy,
      fechaMinima,
      diasTranscurridos: null,
      error: "No se pudo calcular la antiguedad del pago para anular/editar."
    };
  }

  if (diasTranscurridos < 0) {
    return {
      ok: false,
      fechaPago,
      hoy,
      fechaMinima,
      diasTranscurridos,
      error: `No se puede anular/editar un pago con fecha futura (${fechaPago}).`
    };
  }

  if (diasTranscurridos > MAX_DIAS_CORRECCION_PAGO) {
    return {
      ok: false,
      fechaPago,
      hoy,
      fechaMinima,
      diasTranscurridos,
      error: `Solo se permite anular/editar pagos dentro de ${MAX_DIAS_CORRECCION_PAGO} dia(s). Fecha pago: ${fechaPago}. Fecha minima permitida hoy (${hoy}): ${fechaMinima}.`
    };
  }

  return {
    ok: true,
    fechaPago,
    hoy,
    fechaMinima,
    diasTranscurridos
  };
};
const parseDateYearMonth = (isoDateRaw, fallback = {}) => {
  const normalized = normalizeDateOnly(isoDateRaw);
  if (!normalized) {
    return {
      iso: null,
      anio: Number(fallback.anio || 0),
      mes: Number(fallback.mes || 0),
      periodoNum: (Number(fallback.anio || 0) * 100) + Number(fallback.mes || 0)
    };
  }
  const [anio, mes] = normalized.split("-").map((v) => Number(v));
  return {
    iso: normalized,
    anio,
    mes,
    periodoNum: (anio * 100) + mes
  };
};

const normalizeLimitedText = (value, maxLen = 250) => {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) : text;
};

const parsePositiveInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};
const getCurrentPeriodoNum = () => {
  const { anio, mes } = getFechaPartesZona(new Date(), APP_TIMEZONE);
  return (anio * 100) + mes;
};
const validateReciboPeriodoNoFuturo = (anioInput, mesInput) => {
  const anio = parsePositiveInt(anioInput, 0);
  const mes = parsePositiveInt(mesInput, 0);
  if (!anio || mes < 1 || mes > 12) {
    return { ok: false, error: "Año y mes son requeridos." };
  }
  if ((anio * 100) + mes > getCurrentPeriodoNum()) {
    return { ok: false, error: "No se permite registrar deuda en un periodo futuro." };
  }
  return { ok: true, anio, mes };
};
const normalizeCodigoReciboInput = (value) => parsePositiveInt(value, 0);
const normalizeTipoOrdenCobro = (value, fallback = TIPOS_ORDEN_COBRO.NORMAL) => {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === TIPOS_ORDEN_COBRO.ADELANTADO) return TIPOS_ORDEN_COBRO.ADELANTADO;
  if (raw === TIPOS_ORDEN_COBRO.NORMAL) return TIPOS_ORDEN_COBRO.NORMAL;
  return fallback;
};
const sanitizePeriodosAdelantados = (rowsRaw = []) => {
  const rows = clampArray(rowsRaw, 36);
  const seen = new Set();
  const out = [];
  for (const raw of rows) {
    const anio = parsePositiveInt(raw?.anio, 0);
    const mes = parsePositiveInt(raw?.mes, 0);
    if (!anio || mes < 1 || mes > 12) continue;
    const key = `${anio}-${mes}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ anio, mes, periodo_num: (anio * 100) + mes });
  }
  out.sort((a, b) => a.periodo_num - b.periodo_num);
  return out;
};
const roundMonto2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const parsePositiveMonto = (value) => {
  const parsed = roundMonto2(parseMonto(value, 0));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
};
const parseOptionalTarifaMonto = (value) => {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = roundMonto2(parseMonto(raw, Number.NaN));
  if (!Number.isFinite(parsed) || parsed < 0) return "__INVALID__";
  return parsed;
};
const parseOptionalServicioSN = (value) => {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = normalizeSN(raw, "__INVALID__");
  if (normalized !== "S" && normalized !== "N") return "__INVALID__";
  return normalized;
};
const clampArray = (rows, max = 200) => {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, Math.max(1, Math.min(1000, max)));
};

const recalcularRecibosFuturosPorServicios = async (
  client,
  idContribuyente,
  {
    desdePeriodoNum = getNextPeriod().periodoNum,
    montosBase = AUTO_DEUDA_BASE,
    incluirPendientesHistoricos = false
  } = {}
) => {
  const id = parsePositiveInt(idContribuyente, 0);
  if (!id) return { actualizados: 0 };

  const montoAgua = roundMonto2(parseMonto(montosBase?.agua, AUTO_DEUDA_BASE.agua));
  const montoDesague = roundMonto2(parseMonto(montosBase?.desague, AUTO_DEUDA_BASE.desague));
  const montoLimpieza = roundMonto2(parseMonto(montosBase?.limpieza, AUTO_DEUDA_BASE.limpieza));
  const montoAdmin = roundMonto2(parseMonto(montosBase?.admin, AUTO_DEUDA_BASE.admin));
  const periodoSolicitado = Number.isFinite(Number(desdePeriodoNum))
    ? Number(desdePeriodoNum)
    : getNextPeriod().periodoNum;
  const periodoMinimoFuturo = getNextPeriod().periodoNum;
  const periodo = incluirPendientesHistoricos
    ? Math.max(0, periodoSolicitado)
    : Math.max(periodoSolicitado, periodoMinimoFuturo);

  await client.query(`
    UPDATE predios
    SET
      agua_sn = CASE WHEN ${sqlSnEsSi("agua_sn", "S")} THEN 'S' ELSE 'N' END,
      desague_sn = CASE WHEN ${sqlSnEsSi("desague_sn", "S")} THEN 'S' ELSE 'N' END,
      limpieza_sn = CASE WHEN ${sqlSnEsSi("limpieza_sn", "S")} THEN 'S' ELSE 'N' END,
      activo_sn = CASE WHEN ${sqlSnEsSi("activo_sn", "S")} THEN 'S' ELSE 'N' END
    WHERE id_contribuyente = $1
      AND (
        agua_sn IS NULL
        OR desague_sn IS NULL
        OR limpieza_sn IS NULL
        OR activo_sn IS NULL
        OR COALESCE(NULLIF(UPPER(TRIM(CAST(agua_sn AS text))), ''), 'S') NOT IN ('S', 'N')
        OR COALESCE(NULLIF(UPPER(TRIM(CAST(desague_sn AS text))), ''), 'S') NOT IN ('S', 'N')
        OR COALESCE(NULLIF(UPPER(TRIM(CAST(limpieza_sn AS text))), ''), 'S') NOT IN ('S', 'N')
        OR COALESCE(NULLIF(UPPER(TRIM(CAST(activo_sn AS text))), ''), 'S') NOT IN ('S', 'N')
      )
  `, [id]);

  const resultado = await client.query(`
    WITH objetivo AS (
      SELECT
        r.id_recibo,
        CASE
          WHEN ${sqlSnEsSi("p.activo_sn", "S")} AND ${sqlSnEsSi("p.agua_sn", "S")}
            THEN COALESCE(p.tarifa_agua, $2::numeric)
          ELSE 0::numeric
        END AS nuevo_agua,
        CASE
          WHEN ${sqlSnEsSi("p.activo_sn", "S")} AND ${sqlSnEsSi("p.desague_sn", "S")}
            THEN COALESCE(p.tarifa_desague, $3::numeric)
          ELSE 0::numeric
        END AS nuevo_desague,
        CASE
          WHEN ${sqlSnEsSi("p.activo_sn", "S")} AND ${sqlSnEsSi("p.limpieza_sn", "S")}
            THEN COALESCE(p.tarifa_limpieza, $4::numeric)
          ELSE 0::numeric
        END AS nuevo_limpieza,
        CASE
          WHEN ${sqlSnEsSi("p.activo_sn", "S")}
            THEN COALESCE(p.tarifa_admin, $5::numeric) + COALESCE(p.tarifa_extra, 0::numeric)
          ELSE 0::numeric
        END AS nuevo_admin
      FROM recibos r
      INNER JOIN predios p ON p.id_predio = r.id_predio
      WHERE p.id_contribuyente = $1
        AND r.estado = 'PENDIENTE'
        AND (
          $7::boolean = true
          OR ((r.anio::int * 100) + r.mes::int) >= $6::int
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pagos pg
          WHERE pg.id_recibo = r.id_recibo
        )
    )
    UPDATE recibos r
    SET
      subtotal_agua = o.nuevo_agua,
      subtotal_desague = o.nuevo_desague,
      subtotal_limpieza = o.nuevo_limpieza,
      subtotal_admin = o.nuevo_admin,
      total_pagar = o.nuevo_agua + o.nuevo_desague + o.nuevo_limpieza + o.nuevo_admin
    FROM objetivo o
    WHERE r.id_recibo = o.id_recibo
      AND (
        COALESCE(r.subtotal_agua, 0) <> o.nuevo_agua OR
        COALESCE(r.subtotal_desague, 0) <> o.nuevo_desague OR
        COALESCE(r.subtotal_limpieza, 0) <> o.nuevo_limpieza OR
        COALESCE(r.subtotal_admin, 0) <> o.nuevo_admin OR
        COALESCE(r.total_pagar, 0) <> (o.nuevo_agua + o.nuevo_desague + o.nuevo_limpieza + o.nuevo_admin)
      )
    RETURNING r.id_recibo
  `, [id, montoAgua, montoDesague, montoLimpieza, montoAdmin, periodo, incluirPendientesHistoricos]);

  return { actualizados: Number(resultado.rowCount || 0) };
};

const repararRecibosPendientesSnLegacy = async () => {
  const client = await pool.connect();
  try {
    const fix = await client.query(`
      WITH objetivo AS (
        SELECT
          r.id_recibo,
          CASE
            WHEN UPPER(COALESCE(p.activo_sn, 'S')) = 'S' AND UPPER(COALESCE(p.agua_sn, 'S')) = 'S'
              THEN COALESCE(p.tarifa_agua, $1::numeric)
            ELSE 0::numeric
          END AS old_agua,
          CASE
            WHEN UPPER(COALESCE(p.activo_sn, 'S')) = 'S' AND UPPER(COALESCE(p.desague_sn, 'S')) = 'S'
              THEN COALESCE(p.tarifa_desague, $2::numeric)
            ELSE 0::numeric
          END AS old_desague,
          CASE
            WHEN UPPER(COALESCE(p.activo_sn, 'S')) = 'S' AND UPPER(COALESCE(p.limpieza_sn, 'S')) = 'S'
              THEN COALESCE(p.tarifa_limpieza, $3::numeric)
            ELSE 0::numeric
          END AS old_limpieza,
          CASE
            WHEN UPPER(COALESCE(p.activo_sn, 'S')) = 'S'
              THEN COALESCE(p.tarifa_admin, $4::numeric) + COALESCE(p.tarifa_extra, 0::numeric)
            ELSE 0::numeric
          END AS old_admin,
          CASE
            WHEN ${sqlSnEsSi("p.activo_sn", "S")} AND ${sqlSnEsSi("p.agua_sn", "S")}
              THEN COALESCE(p.tarifa_agua, $1::numeric)
            ELSE 0::numeric
          END AS new_agua,
          CASE
            WHEN ${sqlSnEsSi("p.activo_sn", "S")} AND ${sqlSnEsSi("p.desague_sn", "S")}
              THEN COALESCE(p.tarifa_desague, $2::numeric)
            ELSE 0::numeric
          END AS new_desague,
          CASE
            WHEN ${sqlSnEsSi("p.activo_sn", "S")} AND ${sqlSnEsSi("p.limpieza_sn", "S")}
              THEN COALESCE(p.tarifa_limpieza, $3::numeric)
            ELSE 0::numeric
          END AS new_limpieza,
          CASE
            WHEN ${sqlSnEsSi("p.activo_sn", "S")}
              THEN COALESCE(p.tarifa_admin, $4::numeric) + COALESCE(p.tarifa_extra, 0::numeric)
            ELSE 0::numeric
          END AS new_admin
        FROM recibos r
        INNER JOIN predios p ON p.id_predio = r.id_predio
        WHERE r.estado = 'PENDIENTE'
          AND NOT EXISTS (
            SELECT 1
            FROM pagos pg
            WHERE pg.id_recibo = r.id_recibo
          )
      ),
      actualizables AS (
        SELECT
          id_recibo,
          old_agua,
          old_desague,
          old_limpieza,
          old_admin,
          (old_agua + old_desague + old_limpieza + old_admin) AS old_total,
          new_agua,
          new_desague,
          new_limpieza,
          new_admin,
          (new_agua + new_desague + new_limpieza + new_admin) AS new_total
        FROM objetivo
        WHERE
          old_agua <> new_agua
          OR old_desague <> new_desague
          OR old_limpieza <> new_limpieza
          OR old_admin <> new_admin
      )
      UPDATE recibos r
      SET
        subtotal_agua = a.new_agua,
        subtotal_desague = a.new_desague,
        subtotal_limpieza = a.new_limpieza,
        subtotal_admin = a.new_admin,
        total_pagar = a.new_total
      FROM actualizables a
      WHERE r.id_recibo = a.id_recibo
        AND COALESCE(r.subtotal_agua, 0) = a.old_agua
        AND COALESCE(r.subtotal_desague, 0) = a.old_desague
        AND COALESCE(r.subtotal_limpieza, 0) = a.old_limpieza
        AND COALESCE(r.subtotal_admin, 0) = a.old_admin
        AND COALESCE(r.total_pagar, 0) = a.old_total
      RETURNING r.id_recibo
    `, [AUTO_DEUDA_BASE.agua, AUTO_DEUDA_BASE.desague, AUTO_DEUDA_BASE.limpieza, AUTO_DEUDA_BASE.admin]);
    const total = Number(fix.rowCount || 0);
    if (total > 0) {
      console.log(`[MIGRACION_SN] Recibos pendientes corregidos por flags legacy: ${total}`);
      invalidateContribuyentesCache();
    }
  } catch (err) {
    console.error("[MIGRACION_SN] Error corrigiendo recibos pendientes legacy:", err);
  } finally {
    client.release();
  }
};

const normalizeCodigoMunicipal = (value, padTo = 6) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const onlyDigits = raw.replace(/\D/g, "");
  if (onlyDigits) return onlyDigits.slice(0, 8).padStart(padTo, "0");
  return raw.toUpperCase().slice(0, 32);
};

const generateNextCodigoMunicipal = async (client) => {
  const resMaxSix = await client.query(`
    SELECT COALESCE(MAX(codigo_municipal::bigint), 0) AS max_codigo
    FROM contribuyentes
    WHERE codigo_municipal ~ '^[0-9]{1,6}$'
  `);
  const maxSix = Number(resMaxSix.rows[0]?.max_codigo || 0);
  if (Number.isFinite(maxSix) && maxSix > 0 && maxSix < 999999) {
    return String(maxSix + 1).padStart(6, "0");
  }

  const resMaxAny = await client.query(`
    SELECT COALESCE(MAX(codigo_municipal::bigint), 0) AS max_codigo
    FROM contribuyentes
    WHERE codigo_municipal ~ '^[0-9]+$'
  `);
  const maxAny = Number(resMaxAny.rows[0]?.max_codigo || 0);
  if (!Number.isFinite(maxAny) || maxAny < 0 || maxAny >= 99999999) {
    throw new Error("CODIGO_MUNICIPAL_OVERFLOW");
  }
  if (maxAny < 999999) return String(maxAny + 1).padStart(6, "0");
  return String(maxAny + 1);
};

const resolveCalleIdByNombre = async (client, calleNombreRaw, fallbackIdCalle = null) => {
  const fallback = parsePositiveInt(fallbackIdCalle, 0) || null;
  const nombreNormalizado = normalizarNombreCalle(calleNombreRaw || "");
  if (!nombreNormalizado) return fallback;

  const existente = await client.query(
    `SELECT id_calle
     FROM calles
     WHERE UPPER(TRIM(nombre)) = $1
     ORDER BY id_calle ASC
     LIMIT 1`,
    [nombreNormalizado]
  );
  if (existente.rows.length > 0) return Number(existente.rows[0].id_calle);

  const creado = await client.query(
    "INSERT INTO calles (nombre) VALUES ($1) RETURNING id_calle",
    [nombreNormalizado]
  );
  return Number(creado.rows[0].id_calle);
};

const estadoConexionToPredio = (estadoConexion) => {
  const estado = normalizeEstadoConexion(estadoConexion);
  if (estado === ESTADOS_CONEXION.CORTADO) {
    return { activo_sn: "N", estado_servicio: "CORTADO" };
  }
  if (estado === ESTADOS_CONEXION.SIN_CONEXION) {
    return { activo_sn: "N", estado_servicio: "SIN_CONEXION" };
  }
  return { activo_sn: "S", estado_servicio: "ACTIVO" };
};

const normalizeLoginUsername = (value) => String(value || "").trim().toLowerCase().slice(0, 120);
const getRequestIp = (req) => {
  const fromHeader = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((v) => v.trim())
    .find(Boolean);
  return (fromHeader || req.ip || req.socket?.remoteAddress || "unknown").slice(0, 120);
};

const cleanupLoginSecurityMaps = (nowMs = Date.now()) => {
  for (const [key, value] of loginIpRateMap.entries()) {
    if (!value || nowMs >= Number(value.resetAt || 0)) {
      loginIpRateMap.delete(key);
    }
  }
  for (const [key, value] of loginUserFailMap.entries()) {
    if (!value) {
      loginUserFailMap.delete(key);
      continue;
    }
    const lockUntil = Number(value.lockUntil || 0);
    const updatedAt = Number(value.updatedAt || 0);
    if (lockUntil && nowMs < lockUntil) continue;
    if (!lockUntil && nowMs - updatedAt < LOGIN_RATE_LIMIT_WINDOW_MS) continue;
    loginUserFailMap.delete(key);
  }
};

const getIpRateInfo = (ipKey, nowMs = Date.now()) => {
  const current = loginIpRateMap.get(ipKey);
  if (!current || nowMs >= Number(current.resetAt || 0)) {
    const next = { count: 0, resetAt: nowMs + LOGIN_RATE_LIMIT_WINDOW_MS };
    loginIpRateMap.set(ipKey, next);
    return next;
  }
  return current;
};

const getUserFailInfo = (usernameKey) => {
  if (!loginUserFailMap.has(usernameKey)) {
    loginUserFailMap.set(usernameKey, { count: 0, lockUntil: 0, updatedAt: Date.now() });
  }
  return loginUserFailMap.get(usernameKey);
};

const registerLoginFailure = (usernameKey) => {
  if (!usernameKey) return;
  const nowMs = Date.now();
  const info = getUserFailInfo(usernameKey);
  if (Number(info.lockUntil || 0) && nowMs < Number(info.lockUntil || 0)) return;
  info.count = Number(info.count || 0) + 1;
  info.updatedAt = nowMs;
  if (info.count >= LOGIN_LOCK_THRESHOLD) {
    info.lockUntil = nowMs + LOGIN_LOCK_DURATION_MS;
    info.count = 0;
  }
  loginUserFailMap.set(usernameKey, info);
};

const clearLoginFailure = (usernameKey) => {
  if (!usernameKey) return;
  loginUserFailMap.delete(usernameKey);
};

const buildDireccionSql = (calleAlias = "ca", predioAlias = "p") => `
  TRIM(
    REGEXP_REPLACE(
      CONCAT_WS(
        ' ',
        CASE
          WHEN COALESCE(TRIM(${calleAlias}.nombre), '') = '' THEN NULLIF(TRIM(${predioAlias}.referencia_direccion), '')
          WHEN COALESCE(TRIM(${predioAlias}.referencia_direccion), '') = '' THEN TRIM(${calleAlias}.nombre)
          WHEN POSITION(
            REGEXP_REPLACE(LOWER(COALESCE(TRIM(${calleAlias}.nombre), '')), '[^[:alnum:]]', '', 'g')
            IN REGEXP_REPLACE(LOWER(COALESCE(TRIM(${predioAlias}.referencia_direccion), '')), '[^[:alnum:]]', '', 'g')
          ) > 0
            OR POSITION(
              REGEXP_REPLACE(LOWER(COALESCE(TRIM(${predioAlias}.referencia_direccion), '')), '[^[:alnum:]]', '', 'g')
              IN REGEXP_REPLACE(LOWER(COALESCE(TRIM(${calleAlias}.nombre), '')), '[^[:alnum:]]', '', 'g')
            ) > 0
          THEN
            CASE
              WHEN LENGTH(REGEXP_REPLACE(LOWER(COALESCE(TRIM(${predioAlias}.referencia_direccion), '')), '[^[:alnum:]]', '', 'g'))
                   >= LENGTH(REGEXP_REPLACE(LOWER(COALESCE(TRIM(${calleAlias}.nombre), '')), '[^[:alnum:]]', '', 'g'))
              THEN TRIM(${predioAlias}.referencia_direccion)
              ELSE TRIM(${calleAlias}.nombre)
            END
          ELSE CONCAT(TRIM(${calleAlias}.nombre), ' ', TRIM(${predioAlias}.referencia_direccion))
        END,
        CASE
          WHEN COALESCE(TRIM(${predioAlias}.numero_casa), '') = '' THEN NULL
          WHEN POSITION(
            REGEXP_REPLACE(LOWER(COALESCE(TRIM(${predioAlias}.numero_casa), '')), '[^[:alnum:]]', '', 'g')
            IN REGEXP_REPLACE(
              LOWER(CONCAT(COALESCE(TRIM(${calleAlias}.nombre), ''), ' ', COALESCE(TRIM(${predioAlias}.referencia_direccion), ''))),
              '[^[:alnum:]]',
              '',
              'g'
            )
          ) > 0 THEN NULL
          ELSE TRIM(${predioAlias}.numero_casa)
        END
      ),
      '\\s+',
      ' ',
      'g'
    )
  )
`;

// --- CONFIGURACIÓN JWT (SEGURIDAD) ---
const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const SECURITY_STRICT_STARTUP = Object.prototype.hasOwnProperty.call(process.env, "SECURITY_STRICT_STARTUP")
  ? process.env.SECURITY_STRICT_STARTUP === "1"
  : NODE_ENV === "production";
const JWT_SECRET_DEFAULT = "cambia_esto_en_produccion";
const JWT_SECRET = process.env.JWT_SECRET || JWT_SECRET_DEFAULT;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";
const AUTH_OPTIONAL_DEV = process.env.AUTH_OPTIONAL_DEV === "1";
const serverHostForSecurity = String(process.env.SERVER_HOST || "").trim().toLowerCase();
const explicitLocalHost = ["127.0.0.1", "localhost", "::1"].includes(serverHostForSecurity);
const jwtWeakSecret = !JWT_SECRET || JWT_SECRET === JWT_SECRET_DEFAULT || String(JWT_SECRET).trim().length < 32;
if (SECURITY_STRICT_STARTUP && jwtWeakSecret) {
  throw new Error("[SECURITY] JWT_SECRET inseguro. Configure una clave >= 32 caracteres.");
}
if (AUTH_OPTIONAL_DEV && !explicitLocalHost) {
  throw new Error("[SECURITY] AUTH_OPTIONAL_DEV=1 solo permitido con SERVER_HOST local explícito (localhost/127.0.0.1/::1).");
}

const isBcryptHash = (value) => typeof value === "string" && value.startsWith("$2");

const ROLE_LEVELS = {
  BRIGADA: 1,    // Nivel 5: brigada de campo
  CONSULTA: 2,   // Nivel 4: solo lectura
  CAJERO: 3,     // Nivel 3: operaciones de caja
  ADMIN_SEC: 4,  // Nivel 2: supervisor de caja / operaciones
  ADMIN: 5       // Nivel 1: admin principal
};

const ROLE_LABELS = {
  ADMIN: "Nivel 1 - Admin principal",
  ADMIN_SEC: "Nivel 2 - Ventanilla",
  CAJERO: "Nivel 3 - Operador de caja",
  CONSULTA: "Nivel 4 - Consulta",
  BRIGADA: "Nivel 5 - Brigada de campo"
};

const normalizeRole = (role) => {
  const raw = String(role || "").trim().toUpperCase();
  if (["ADMIN", "SUPERADMIN", "ADMIN_PRINCIPAL", "NIVEL_1"].includes(raw)) return "ADMIN";
  if (["ADMIN_SEC", "ADMIN_SECUNDARIO", "JEFE_CAJA", "NIVEL_2"].includes(raw)) return "ADMIN_SEC";
  if (["CAJERO", "OPERADOR_CAJA", "OPERADOR", "NIVEL_3"].includes(raw)) return "CAJERO";
  if (["BRIGADA", "BRIGADISTA", "CAMPO", "NIVEL_5"].includes(raw)) return "BRIGADA";
  if (["CONSULTA", "LECTURA", "NIVEL_4"].includes(raw)) return "CONSULTA";
  return "CONSULTA";
};

const isKnownRoleValue = (role) => {
  const raw = String(role || "").trim().toUpperCase();
  return [
    "ADMIN", "SUPERADMIN", "ADMIN_PRINCIPAL", "NIVEL_1",
    "ADMIN_SEC", "ADMIN_SECUNDARIO", "JEFE_CAJA", "NIVEL_2",
    "CAJERO", "OPERADOR_CAJA", "OPERADOR", "NIVEL_3",
    "BRIGADA", "BRIGADISTA", "CAMPO", "NIVEL_5",
    "CONSULTA", "LECTURA", "NIVEL_4"
  ].includes(raw);
};

const roleLevel = (role) => ROLE_LEVELS[normalizeRole(role)] || 0;
const hasMinRole = (currentRole, requiredRole) => roleLevel(currentRole) >= roleLevel(requiredRole);

const issueToken = (user, sistema = "AGUA") => jwt.sign(
  {
    id_usuario: user.id_usuario,
    username: user.username,
    rol: normalizeRole(user.rol),
    nombre: user.nombre_completo,
    sistema: String(sistema || "AGUA").toUpperCase()
  },
  JWT_SECRET,
  { expiresIn: JWT_EXPIRES_IN }
);

const resolveUserFromToken = async (token, expectedSystem = "AGUA") => {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const tokenSystem = String(payload?.sistema || "AGUA").trim().toUpperCase();
    const expected = String(expectedSystem || "AGUA").trim().toUpperCase();
    if (tokenSystem !== expected) {
      return { ok: false, status: 403, error: "Token no corresponde a este sistema." };
    }
    const user = await pool.query(
      "SELECT id_usuario, username, nombre_completo, rol, estado FROM usuarios_sistema WHERE id_usuario = $1",
      [payload.id_usuario]
    );
    if (user.rows.length === 0) {
      return { ok: false, status: 401, error: "Usuario no válido" };
    }
    const dbUser = user.rows[0];
    if (dbUser.estado !== "ACTIVO") {
      return { ok: false, status: 403, error: "Usuario no activo" };
    }
    return {
      ok: true,
      user: {
        id_usuario: dbUser.id_usuario,
        username: dbUser.username,
        nombre: dbUser.nombre_completo,
        rol: normalizeRole(dbUser.rol),
        estado: dbUser.estado,
        sistema: expected
      }
    };
  } catch {
    return { ok: false, status: 401, error: "Token inválido o expirado" };
  }
};

const authenticateToken = async (req, res, next) => {
  if (req.user?.id_usuario) return next();
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    if (AUTH_OPTIONAL_DEV) {
      req.user = {
        id_usuario: 0,
        username: "dev",
        nombre: "Modo Desarrollo",
        rol: "ADMIN",
        estado: "ACTIVO",
        sistema: "AGUA"
      };
      return next();
    }
    return res.status(401).json({ error: "No autorizado" });
  }
  const resolved = await resolveUserFromToken(token, "AGUA");
  if (!resolved.ok) {
    return res.status(resolved.status || 401).json({ error: resolved.error || "No autorizado" });
  }
  req.user = resolved.user;
  return next();
};

const resolveRealtimeUser = async (token) => {
  if (!token) {
    if (!AUTH_OPTIONAL_DEV) return { ok: false, status: 401, error: "No autorizado" };
    return { ok: true, user: getRealtimeDevUser() };
  }
  return resolveUserFromToken(token, "AGUA");
};

const getRealtimeDevUser = () => ({
  id_usuario: 0,
  username: "dev",
  nombre: "Modo Desarrollo",
  rol: "ADMIN",
  estado: "ACTIVO",
  sistema: "AGUA"
});

const tryParseJson = (raw) => {
  try {
    const text = typeof raw === "string" ? raw : String(raw || "");
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const requireAdmin = (req, res, next) => {
  if (!hasMinRole(req.user?.rol, "ADMIN_SEC")) {
    return res.status(403).json({ error: "Acceso denegado" });
  }
  return next();
};

const requireSuperAdmin = (req, res, next) => {
  if (!hasMinRole(req.user?.rol, "ADMIN")) {
    return res.status(403).json({ error: "Acceso denegado" });
  }
  return next();
};

const PROTECTED_API_PREFIXES = [
  "/calles",
  "/sectores",
  "/contribuyentes",
  "/recibos",
  "/pagos",
  "/impresiones",
  "/actas-corte",
  "/campo",
  "/caja",
  "/dashboard",
  "/auditoria",
  "/exportar",
  "/admin",
  "/importar",
  "/comparaciones"
];

const ACCESS_RULES = [
  { methods: ["GET"], pattern: /^\/campo\/contribuyentes\/buscar$/, minRole: "BRIGADA" },
  { methods: ["GET"], pattern: /^\/campo\/offline-snapshot$/, minRole: "BRIGADA" },
  { methods: ["POST"], pattern: /^\/campo\/solicitudes$/, minRole: "BRIGADA" },
  { methods: ["GET"], pattern: /^\/campo\/seguimiento(\/|$)/, minRole: "BRIGADA" },
  { methods: ["GET"], pattern: /^\/campo\/solicitudes\/reporte-empadronados(?:\.xlsx)?$/, minRole: "ADMIN_SEC" },
  { methods: ["GET"], pattern: /^\/campo\/solicitudes$/, minRole: "ADMIN_SEC" },
  { methods: ["POST"], pattern: /^\/campo\/solicitudes\/\d+\/aprobar$/, minRole: "ADMIN_SEC" },
  { methods: ["POST"], pattern: /^\/campo\/solicitudes\/\d+\/rechazar$/, minRole: "ADMIN_SEC" },

  { methods: ["GET"], pattern: /^\/admin\/usuarios$/, minRole: "ADMIN" },
  { methods: ["PUT"], pattern: /^\/admin\/usuarios\/\d+$/, minRole: "ADMIN" },
  { methods: ["DELETE"], pattern: /^\/admin\/usuarios\/\d+$/, minRole: "ADMIN" },
  { methods: ["GET"], pattern: /^\/admin\/backup$/, minRole: "ADMIN" },
  { methods: ["GET"], pattern: /^\/admin\/pagos-anulados$/, minRole: "ADMIN" },
  { methods: ["GET"], pattern: /^\/admin\/campo-remoto\/estado$/, minRole: "ADMIN_SEC" },

  { methods: ["POST"], pattern: /^\/importar\/padron$/, minRole: "ADMIN" },
  { methods: ["POST"], pattern: /^\/importar\/historial$/, minRole: "ADMIN" },
  { methods: ["POST"], pattern: /^\/importar\/verificacion-campo$/, minRole: "ADMIN_SEC" },

  { methods: ["GET"], pattern: /^\/exportar\/usuarios-completo$/, minRole: "ADMIN" },
  { methods: ["GET"], pattern: /^\/exportar\/finanzas-completo(?:\.txt)?$/, minRole: "ADMIN" },
  { methods: ["POST"], pattern: /^\/comparaciones\/legacy\/run$/, minRole: "ADMIN" },
  { methods: ["GET"], pattern: /^\/comparaciones\/legacy$/, minRole: "ADMIN" },
  { methods: ["GET"], pattern: /^\/comparaciones\/legacy\/plantilla$/, minRole: "ADMIN" },
  { methods: ["GET"], pattern: /^\/comparaciones\/legacy\/\d+\/resumen$/, minRole: "ADMIN" },
  { methods: ["GET"], pattern: /^\/comparaciones\/legacy\/\d+\/detalle$/, minRole: "ADMIN" },
  { methods: ["GET"], pattern: /^\/comparaciones\/legacy\/\d+\/exportar$/, minRole: "ADMIN" },

  { methods: ["GET"], pattern: /^\/auditoria$/, minRole: "ADMIN_SEC" },
  { methods: ["GET"], pattern: /^\/exportar\/auditoria$/, minRole: "ADMIN_SEC" },
  { methods: ["GET"], pattern: /^\/exportar\/padron$/, minRole: "ADMIN_SEC" },
  { methods: ["GET"], pattern: /^\/exportar\/verificacion-campo$/, minRole: "ADMIN_SEC" },
  { methods: ["GET"], pattern: /^\/exportar\/arbitrios\/\d+$/, minRole: "CONSULTA" },

  { methods: ["POST", "PUT"], pattern: /^\/calles(\/|$)/, minRole: "ADMIN_SEC" },
  { methods: ["DELETE"], pattern: /^\/calles(\/|$)/, minRole: "ADMIN" },
  { methods: ["POST", "PUT"], pattern: /^\/contribuyentes(\/|$)/, minRole: "ADMIN_SEC" },
  { methods: ["DELETE"], pattern: /^\/contribuyentes\/\d+$/, minRole: "ADMIN" },
  { methods: ["POST"], pattern: /^\/recibos$/, minRole: "ADMIN_SEC" },
  { methods: ["POST"], pattern: /^\/recibos\/generar-masivo$/, minRole: "ADMIN_SEC" },
  { methods: ["DELETE"], pattern: /^\/recibos\/\d+$/, minRole: "ADMIN" },
  { methods: ["POST"], pattern: /^\/actas-corte\/generar$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/actas-corte\/generar-lote$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/caja\/ordenes-cobro$/, minRole: "ADMIN_SEC" },
  { methods: ["GET"], pattern: /^\/caja\/ordenes-cobro$/, minRole: "CAJERO" },
  { methods: ["GET"], pattern: /^\/caja\/ordenes-cobro\/pendientes$/, minRole: "CAJERO" },
  { methods: ["GET"], pattern: /^\/caja\/ordenes-cobro\/resumen-pendientes$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/caja\/permisos-adelantado\/solicitar$/, minRole: "ADMIN_SEC" },
  { methods: ["GET"], pattern: /^\/caja\/permisos-adelantado\/\d+$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/caja\/ordenes-cobro\/\d+\/cobrar$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/caja\/ordenes-cobro\/\d+\/anular$/, minRole: "ADMIN_SEC" },
  { methods: ["POST"], pattern: /^\/caja\/conteo-efectivo$/, minRole: "CAJERO" },
  { methods: ["GET"], pattern: /^\/caja\/conteo-efectivo\/resumen$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/caja\/cierre$/, minRole: "CAJERO" },
  { methods: ["GET"], pattern: /^\/caja\/alertas-riesgo$/, minRole: "CAJERO" },
  { methods: ["GET"], pattern: /^\/caja\/reporte\/excel$/, minRole: "CAJERO" },

  { methods: ["POST"], pattern: /^\/pagos$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/pagos\/\d+\/anular$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/pagos\/recibo\/\d+\/anular-ultimo$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/impresiones\/generar-codigo$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/recibos\/masivos$/, minRole: "CAJERO" },
  { methods: ["GET"], pattern: /^\/caja\/reporte$/, minRole: "CAJERO" },
  { methods: ["GET"], pattern: /^\/caja\/diaria$/, minRole: "CAJERO" },

  { methods: ["GET"], pattern: /^\/dashboard\/resumen$/, minRole: "CONSULTA" },
  { methods: ["GET"], pattern: /^\/calles$/, minRole: "BRIGADA" },
  { methods: ["GET"], pattern: /^\/sectores$/, minRole: "CONSULTA" },
  { methods: ["GET"], pattern: /^\/contribuyentes(\/|$)/, minRole: "CONSULTA" },
  { methods: ["GET"], pattern: /^\/recibos\/pendientes\/\d+$/, minRole: "CONSULTA" },
  { methods: ["GET"], pattern: /^\/recibos\/historial\/\d+$/, minRole: "CONSULTA" }
];

const isProtectedApiPath = (pathname = "") =>
  PROTECTED_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const resolveRequiredRole = (method, pathname) => {
  const currentMethod = String(method || "GET").toUpperCase();
  for (const rule of ACCESS_RULES) {
    if (!rule.methods.includes(currentMethod)) continue;
    if (rule.pattern.test(pathname)) return rule.minRole;
  }
  return "CONSULTA";
};

const authorizeByRole = (req, res, next) => {
  const requiredRole = resolveRequiredRole(req.method, req.path);
  if (!hasMinRole(req.user?.rol, requiredRole)) {
    return res.status(403).json({
      error: `Acceso denegado. Requiere ${ROLE_LABELS[requiredRole] || requiredRole}.`
    });
  }
  return next();
};

let importacionHistorialEnCurso = false;
let autoDeudaEnCurso = false;
let ultimoPeriodoAutoDeuda = null;
const comparacionesLegacyLocks = new Set();
const CONTRIBUYENTES_CACHE_TTL_MS = Number(process.env.CONTRIBUYENTES_CACHE_TTL_MS || 20000);
const REPORTE_CAJA_CACHE_TTL_MS = Number(process.env.REPORTE_CAJA_CACHE_TTL_MS || 15000);
const DASHBOARD_CACHE_TTL_MS = Number(process.env.DASHBOARD_CACHE_TTL_MS || 15000);
let contribuyentesCache = { expiresAt: 0, data: null };
let reportesCajaCache = new Map();
let dashboardCache = { expiresAt: 0, data: null, day: null };

const invalidateReportesCajaCache = () => {
  reportesCajaCache.clear();
};

const invalidateContribuyentesCache = () => {
  contribuyentesCache = { expiresAt: 0, data: null };
  invalidateReportesCajaCache();
  dashboardCache = { expiresAt: 0, data: null, day: null };
};

const REALTIME_CHANNELS = new Set(["caja", "deuda"]);
const isWsOpen = (ws) => ws && ws.readyState === 1;

const realtimeHub = {
  enabled: REALTIME_WS_ENABLED,
  connectedClients: new Set(),
  register(ws, meta = {}) {
    const entry = {
      ws,
      authenticated: false,
      user: null,
      meta,
      createdAt: Date.now(),
      lastPingAt: Date.now()
    };
    this.connectedClients.add(entry);
    return entry;
  },
  unregister(entry) {
    if (!entry) return;
    this.connectedClients.delete(entry);
  },
  sendToClient(entry, payload) {
    if (!entry || !isWsOpen(entry.ws)) return false;
    try {
      entry.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  },
  broadcast(channel, action, entity = {}) {
    if (!this.enabled) return 0;
    if (!REALTIME_CHANNELS.has(channel)) return 0;
    const payload = {
      type: "event",
      channel,
      action,
      entity,
      server_ts: new Date().toISOString()
    };
    let sent = 0;
    for (const entry of this.connectedClients) {
      if (!entry.authenticated) continue;
      if (this.sendToClient(entry, payload)) sent += 1;
    }
    if (sent > 0) {
      console.log(`[RT] ${channel}/${action} -> ${sent} cliente(s)`);
    }
    return sent;
  }
};

// --- AUDITORÍA ---
const registrarAuditoria = async (client, accion, detalle, usuario = "SISTEMA") => {
  const db = client || pool;
  try {
    await db.query(
      "INSERT INTO auditoria (usuario, accion, detalle) VALUES ($1, $2, $3)",
      [usuario, accion, detalle]
    );
  } catch (err) {
    console.error("Error guardando auditoría:", err.message);
  }
};

const ensureCodigosImpresionTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS codigos_impresion (
      id_codigo BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_usuario INTEGER NULL,
      id_contribuyente INTEGER NULL,
      recibos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      total_monto NUMERIC(12, 2) NOT NULL DEFAULT 0
    )
  `);
};

const ensureActasCorteTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS actas_corte (
      id_acta BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_usuario INTEGER NULL,
      id_contribuyente INTEGER NOT NULL,
      codigo_municipal VARCHAR(32) NULL,
      meses_deuda INTEGER NOT NULL DEFAULT 0,
      deuda_total NUMERIC(12, 2) NOT NULL DEFAULT 0
    )
  `);
};

const ensureOrdenesCobroTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ordenes_cobro (
      id_orden BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      id_usuario_emite INTEGER NULL,
      id_usuario_cobra INTEGER NULL,
      id_usuario_anula INTEGER NULL,
      id_contribuyente INTEGER NOT NULL REFERENCES contribuyentes(id_contribuyente),
      codigo_municipal VARCHAR(32) NULL,
      codigo_recibo INTEGER NULL,
      total_orden NUMERIC(12, 2) NOT NULL DEFAULT 0,
      cargo_reimpresion NUMERIC(12, 2) NOT NULL DEFAULT 0,
      motivo_cargo_reimpresion TEXT NULL,
      recibos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      observacion TEXT NULL,
      motivo_anulacion TEXT NULL,
      cobrado_en TIMESTAMP NULL,
      anulado_en TIMESTAMP NULL
    )
  `);
  await client.query(`
    ALTER TABLE ordenes_cobro
    ADD COLUMN IF NOT EXISTS tipo_orden VARCHAR(20) NOT NULL DEFAULT 'NORMAL'
  `);
  await client.query(`
    ALTER TABLE ordenes_cobro
    ADD COLUMN IF NOT EXISTS codigo_recibo INTEGER NULL
  `);
  await client.query(`
    ALTER TABLE ordenes_cobro
    ADD COLUMN IF NOT EXISTS cargo_reimpresion NUMERIC(12, 2) NOT NULL DEFAULT 0
  `);
  await client.query(`
    ALTER TABLE ordenes_cobro
    ADD COLUMN IF NOT EXISTS motivo_cargo_reimpresion TEXT NULL
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_ordenes_cobro_cargo_reimpresion_nonnegative'
      ) THEN
        ALTER TABLE ordenes_cobro
        ADD CONSTRAINT chk_ordenes_cobro_cargo_reimpresion_nonnegative
        CHECK (cargo_reimpresion >= 0);
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_ordenes_cobro_estado'
      ) THEN
        ALTER TABLE ordenes_cobro
        ADD CONSTRAINT chk_ordenes_cobro_estado
        CHECK (estado IN ('PENDIENTE', 'COBRADA', 'ANULADA'));
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_ordenes_cobro_total_positive'
      ) THEN
        ALTER TABLE ordenes_cobro
        ADD CONSTRAINT chk_ordenes_cobro_total_positive
        CHECK (total_orden > 0);
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_ordenes_cobro_tipo_orden'
      ) THEN
        ALTER TABLE ordenes_cobro
        ADD CONSTRAINT chk_ordenes_cobro_tipo_orden
        CHECK (tipo_orden IN ('NORMAL', 'ADELANTADO'));
      END IF;
    END $$;
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ordenes_cobro_estado_creado
    ON ordenes_cobro (estado, creado_en DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ordenes_cobro_contribuyente_estado
    ON ordenes_cobro (id_contribuyente, estado, creado_en DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ordenes_cobro_tipo_estado
    ON ordenes_cobro (tipo_orden, estado, creado_en DESC)
  `);
};

const ensureCajaCierresTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS caja_cierres (
      id_cierre BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_usuario INTEGER NULL,
      tipo VARCHAR(20) NOT NULL,
      fecha_referencia DATE NOT NULL,
      desde DATE NOT NULL,
      hasta_exclusivo DATE NOT NULL,
      total_sistema NUMERIC(12, 2) NOT NULL DEFAULT 0,
      efectivo_declarado NUMERIC(12, 2) NOT NULL DEFAULT 0,
      desviacion NUMERIC(12, 2) NOT NULL DEFAULT 0,
      alerta_desviacion_sn CHAR(1) NOT NULL DEFAULT 'N',
      observacion TEXT NULL
    )
  `);
  await client.query(`
    ALTER TABLE caja_cierres
    ADD COLUMN IF NOT EXISTS cierre_bloquea_sn CHAR(1) NOT NULL DEFAULT 'N'
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_caja_cierres_tipo'
      ) THEN
        ALTER TABLE caja_cierres
        ADD CONSTRAINT chk_caja_cierres_tipo
        CHECK (tipo IN ('diario', 'semanal', 'mensual', 'anual'));
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_caja_cierres_alerta'
      ) THEN
        ALTER TABLE caja_cierres
        ADD CONSTRAINT chk_caja_cierres_alerta
        CHECK (alerta_desviacion_sn IN ('S', 'N'));
      END IF;
    END $$;
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_caja_cierres_creado_en
    ON caja_cierres (creado_en DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_caja_cierres_tipo_fecha
    ON caja_cierres (tipo, fecha_referencia DESC)
  `);
};

const ensureCajaConteosEfectivoTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS caja_conteos_efectivo (
      id_conteo BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_usuario INTEGER NULL,
      fecha_referencia DATE NOT NULL,
      monto_efectivo NUMERIC(12, 2) NOT NULL DEFAULT 0,
      estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      observacion TEXT NULL,
      id_cierre BIGINT NULL REFERENCES caja_cierres(id_cierre)
    )
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_caja_cierres_bloquea'
      ) THEN
        ALTER TABLE caja_cierres
        ADD CONSTRAINT chk_caja_cierres_bloquea
        CHECK (cierre_bloquea_sn IN ('S', 'N'));
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_caja_conteos_efectivo_monto_nonnegative'
      ) THEN
        ALTER TABLE caja_conteos_efectivo
        ADD CONSTRAINT chk_caja_conteos_efectivo_monto_nonnegative
        CHECK (monto_efectivo >= 0);
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_caja_conteos_efectivo_estado'
      ) THEN
        ALTER TABLE caja_conteos_efectivo
        ADD CONSTRAINT chk_caja_conteos_efectivo_estado
        CHECK (estado IN ('PENDIENTE', 'APLICADO', 'ANULADO'));
      END IF;
    END $$;
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_caja_conteos_efectivo_fecha_estado
    ON caja_conteos_efectivo (fecha_referencia DESC, estado, creado_en DESC)
  `);
};

const ensureEstadoConexionContribuyentes = async (client) => {
  await client.query(`
    ALTER TABLE contribuyentes
    ADD COLUMN IF NOT EXISTS estado_conexion VARCHAR(20)
  `);
  await client.query(`
    ALTER TABLE contribuyentes
    ALTER COLUMN estado_conexion SET DEFAULT 'CON_CONEXION'
  `);
  await client.query(`
    UPDATE contribuyentes c
    SET estado_conexion = CASE
      WHEN UPPER(COALESCE(TRIM(c.estado_conexion), '')) IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO')
        THEN UPPER(TRIM(c.estado_conexion))
      WHEN UPPER(COALESCE(TRIM(c.estado_conexion), '')) IN ('CORTADO', 'CORTE', 'SUSPENDIDO', 'SUSPENSION')
        THEN 'CORTADO'
      WHEN EXISTS (
        SELECT 1
        FROM predios p
        WHERE p.id_contribuyente = c.id_contribuyente
          AND UPPER(COALESCE(p.estado_servicio, '')) = 'CORTADO'
      ) THEN 'CORTADO'
      WHEN EXISTS (
        SELECT 1
        FROM predios p
        WHERE p.id_contribuyente = c.id_contribuyente
          AND UPPER(COALESCE(p.estado_servicio, '')) = 'SIN_CONEXION'
      ) THEN 'SIN_CONEXION'
      WHEN EXISTS (
        SELECT 1
        FROM predios p
        WHERE p.id_contribuyente = c.id_contribuyente
          AND ${sqlSnEsSi("p.activo_sn", "S")}
      ) THEN 'CON_CONEXION'
      ELSE 'SIN_CONEXION'
    END
    WHERE c.estado_conexion IS NULL
       OR UPPER(COALESCE(TRIM(c.estado_conexion), '')) NOT IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO')
  `);
  await client.query(`
    ALTER TABLE contribuyentes
    DROP CONSTRAINT IF EXISTS chk_contribuyentes_estado_conexion
  `);
  await client.query(`
    ALTER TABLE contribuyentes
    ADD CONSTRAINT chk_contribuyentes_estado_conexion
    CHECK (estado_conexion IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO'))
  `);
  await client.query(`
    UPDATE predios p
    SET
      estado_servicio = CASE
        WHEN UPPER(COALESCE(TRIM(c.estado_conexion), 'CON_CONEXION')) = 'CON_CONEXION' THEN 'ACTIVO'
        WHEN UPPER(COALESCE(TRIM(c.estado_conexion), 'CON_CONEXION')) = 'CORTADO' THEN 'CORTADO'
        ELSE 'SIN_CONEXION'
      END,
      activo_sn = CASE
        WHEN UPPER(COALESCE(TRIM(c.estado_conexion), 'CON_CONEXION')) = 'CON_CONEXION' THEN 'S'
        ELSE 'N'
      END
    FROM contribuyentes c
    WHERE c.id_contribuyente = p.id_contribuyente
      AND (
        UPPER(COALESCE(TRIM(p.estado_servicio), '')) IN ('ACTIVO', 'SIN_CONEXION', 'CORTADO')
        OR p.estado_servicio IS NULL
        OR p.activo_sn IS NULL
      )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_contribuyentes_estado_conexion
    ON contribuyentes (estado_conexion)
  `);
  await client.query(`
    ALTER TABLE contribuyentes
    ADD COLUMN IF NOT EXISTS estado_conexion_fuente VARCHAR(20)
  `);
  await client.query(`
    ALTER TABLE contribuyentes
    ALTER COLUMN estado_conexion_fuente SET DEFAULT 'INFERIDO'
  `);
  await client.query(`
    ALTER TABLE contribuyentes
    ADD COLUMN IF NOT EXISTS estado_conexion_verificado_sn CHAR(1)
  `);
  await client.query(`
    ALTER TABLE contribuyentes
    ALTER COLUMN estado_conexion_verificado_sn SET DEFAULT 'N'
  `);
  await client.query(`
    ALTER TABLE contribuyentes
    ADD COLUMN IF NOT EXISTS estado_conexion_fecha_verificacion DATE
  `);
  await client.query(`
    ALTER TABLE contribuyentes
    ADD COLUMN IF NOT EXISTS estado_conexion_motivo_ultimo TEXT
  `);
  await client.query(`
    ALTER TABLE contribuyentes
    ADD COLUMN IF NOT EXISTS razon_social_motivo_ultimo TEXT
  `);
  await client.query(`
    ALTER TABLE contribuyentes
    ADD COLUMN IF NOT EXISTS razon_social_actualizado_en TIMESTAMP NULL
  `);
  await client.query(`
    UPDATE contribuyentes
    SET estado_conexion_fuente = 'INFERIDO'
    WHERE estado_conexion_fuente IS NULL
       OR UPPER(COALESCE(TRIM(estado_conexion_fuente), '')) NOT IN ('INFERIDO', 'IMPORTACION', 'OFICINA', 'CAMPO')
  `);
  await client.query(`
    UPDATE contribuyentes
    SET estado_conexion_verificado_sn = 'N'
    WHERE estado_conexion_verificado_sn IS NULL
       OR UPPER(COALESCE(TRIM(estado_conexion_verificado_sn), '')) NOT IN ('S', 'N')
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_contribuyentes_estado_conexion_fuente'
      ) THEN
        ALTER TABLE contribuyentes
        ADD CONSTRAINT chk_contribuyentes_estado_conexion_fuente
        CHECK (estado_conexion_fuente IN ('INFERIDO', 'IMPORTACION', 'OFICINA', 'CAMPO'));
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_contribuyentes_estado_conexion_verificado'
      ) THEN
        ALTER TABLE contribuyentes
        ADD CONSTRAINT chk_contribuyentes_estado_conexion_verificado
        CHECK (estado_conexion_verificado_sn IN ('S', 'N'));
      END IF;
    END $$;
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_contribuyentes_estado_conexion_fuente
    ON contribuyentes (estado_conexion_fuente)
  `);
};

const ensureEstadoConexionEventosTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS estado_conexion_eventos (
      id_evento BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_usuario INTEGER NULL,
      id_contribuyente INTEGER NOT NULL,
      estado_anterior VARCHAR(20) NOT NULL,
      estado_nuevo VARCHAR(20) NOT NULL,
      motivo TEXT NULL
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_estado_conexion_eventos_id_contribuyente
    ON estado_conexion_eventos (id_contribuyente)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_estado_conexion_eventos_creado_en
    ON estado_conexion_eventos (creado_en DESC)
  `);
};

const ensureEstadoConexionEvidenciasTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS estado_conexion_eventos_evidencias (
      id_evidencia BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_evento BIGINT NOT NULL REFERENCES estado_conexion_eventos(id_evento) ON DELETE CASCADE,
      id_contribuyente INTEGER NOT NULL,
      archivo_nombre TEXT NOT NULL,
      archivo_mime VARCHAR(160) NULL,
      archivo_bytes BIGINT NOT NULL DEFAULT 0,
      archivo_sha256 VARCHAR(64) NOT NULL,
      archivo_path TEXT NOT NULL
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_estado_conexion_evidencias_evento
    ON estado_conexion_eventos_evidencias (id_evento)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_estado_conexion_evidencias_contribuyente
    ON estado_conexion_eventos_evidencias (id_contribuyente, creado_en DESC)
  `);
};

const ensureContribuyentesAdjuntosTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS contribuyentes_adjuntos (
      id_adjunto BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_contribuyente INTEGER NOT NULL REFERENCES contribuyentes(id_contribuyente) ON DELETE CASCADE,
      id_usuario INTEGER NULL,
      tipo_contexto VARCHAR(30) NOT NULL DEFAULT 'ALTA',
      descripcion TEXT NULL,
      archivo_nombre TEXT NOT NULL,
      archivo_mime VARCHAR(160) NULL,
      archivo_bytes BIGINT NOT NULL DEFAULT 0,
      archivo_sha256 VARCHAR(64) NOT NULL,
      archivo_path TEXT NOT NULL
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_contribuyentes_adjuntos_contribuyente
    ON contribuyentes_adjuntos (id_contribuyente, creado_en DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_contribuyentes_adjuntos_contexto
    ON contribuyentes_adjuntos (tipo_contexto, creado_en DESC)
  `);
};

const ensureCajaPermisosAdelantadoTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS caja_permisos_adelantado (
      id_permiso BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_contribuyente INTEGER NOT NULL REFERENCES contribuyentes(id_contribuyente) ON DELETE CASCADE,
      anio INTEGER NOT NULL,
      mes INTEGER NOT NULL,
      periodo_num INTEGER NOT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'APROBADO',
      origen VARCHAR(40) NOT NULL DEFAULT 'VENTANILLA_REIMPRESION',
      motivo TEXT NULL,
      id_usuario_solicita INTEGER NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_caja_permisos_adelantado_periodo
    ON caja_permisos_adelantado (id_contribuyente, anio, mes)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_caja_permisos_adelantado_estado
    ON caja_permisos_adelantado (estado, periodo_num, creado_en DESC)
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_caja_permisos_adelantado_periodo'
      ) THEN
        ALTER TABLE caja_permisos_adelantado
        ADD CONSTRAINT chk_caja_permisos_adelantado_periodo
        CHECK (anio BETWEEN 1900 AND 9999 AND mes BETWEEN 1 AND 12);
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_caja_permisos_adelantado_estado'
      ) THEN
        ALTER TABLE caja_permisos_adelantado
        ADD CONSTRAINT chk_caja_permisos_adelantado_estado
        CHECK (estado IN ('APROBADO', 'BLOQUEADO', 'ANULADO'));
      END IF;
    END $$;
  `);
};

const ensurePrediosDireccionAlterna = async (client) => {
  await client.query(`
    ALTER TABLE predios
    ADD COLUMN IF NOT EXISTS direccion_alterna TEXT NULL
  `);
  await client.query(`
    ALTER TABLE predios
    ADD COLUMN IF NOT EXISTS tarifa_agua NUMERIC(12, 2) NULL
  `);
  await client.query(`
    ALTER TABLE predios
    ADD COLUMN IF NOT EXISTS tarifa_desague NUMERIC(12, 2) NULL
  `);
  await client.query(`
    ALTER TABLE predios
    ADD COLUMN IF NOT EXISTS tarifa_limpieza NUMERIC(12, 2) NULL
  `);
  await client.query(`
    ALTER TABLE predios
    ADD COLUMN IF NOT EXISTS tarifa_admin NUMERIC(12, 2) NULL
  `);
  await client.query(`
    ALTER TABLE predios
    ADD COLUMN IF NOT EXISTS tarifa_extra NUMERIC(12, 2) NULL
  `);
  await client.query(`
    ALTER TABLE predios
    DROP CONSTRAINT IF EXISTS chk_predios_tarifas_non_negative
  `);
  await client.query(`
    ALTER TABLE predios
    ADD CONSTRAINT chk_predios_tarifas_non_negative
    CHECK (
      (tarifa_agua IS NULL OR tarifa_agua >= 0) AND
      (tarifa_desague IS NULL OR tarifa_desague >= 0) AND
      (tarifa_limpieza IS NULL OR tarifa_limpieza >= 0) AND
      (tarifa_admin IS NULL OR tarifa_admin >= 0) AND
      (tarifa_extra IS NULL OR tarifa_extra >= 0)
    )
  `);
  await client.query(`
    UPDATE predios
    SET
      agua_sn = CASE WHEN ${sqlSnEsSi("agua_sn", "S")} THEN 'S' ELSE 'N' END,
      desague_sn = CASE WHEN ${sqlSnEsSi("desague_sn", "S")} THEN 'S' ELSE 'N' END,
      limpieza_sn = CASE WHEN ${sqlSnEsSi("limpieza_sn", "S")} THEN 'S' ELSE 'N' END,
      activo_sn = CASE WHEN ${sqlSnEsSi("activo_sn", "S")} THEN 'S' ELSE 'N' END
    WHERE
      agua_sn IS NULL
      OR desague_sn IS NULL
      OR limpieza_sn IS NULL
      OR activo_sn IS NULL
      OR COALESCE(NULLIF(UPPER(TRIM(CAST(agua_sn AS text))), ''), 'S') NOT IN ('S', 'N')
      OR COALESCE(NULLIF(UPPER(TRIM(CAST(desague_sn AS text))), ''), 'S') NOT IN ('S', 'N')
      OR COALESCE(NULLIF(UPPER(TRIM(CAST(limpieza_sn AS text))), ''), 'S') NOT IN ('S', 'N')
      OR COALESCE(NULLIF(UPPER(TRIM(CAST(activo_sn AS text))), ''), 'S') NOT IN ('S', 'N')
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS predios_direcciones_alternas (
      id_direccion_alterna BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_contribuyente INTEGER NOT NULL REFERENCES contribuyentes(id_contribuyente),
      id_predio_base INTEGER NULL REFERENCES predios(id_predio),
      id_calle INTEGER NULL REFERENCES calles(id_calle),
      numero_casa TEXT NULL,
      direccion_texto TEXT NOT NULL,
      servicio_agua_sn CHAR(1) NOT NULL DEFAULT 'S',
      servicio_desague_sn CHAR(1) NOT NULL DEFAULT 'S',
      servicio_limpieza_sn CHAR(1) NOT NULL DEFAULT 'S',
      estado_conexion VARCHAR(20) NOT NULL DEFAULT 'CON_CONEXION',
      fuente VARCHAR(40) NOT NULL DEFAULT 'APP_CAMPO',
      id_solicitud BIGINT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      activo_sn CHAR(1) NOT NULL DEFAULT 'S'
    )
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_predios_dir_alt_activo_sn'
      ) THEN
        ALTER TABLE predios_direcciones_alternas
        ADD CONSTRAINT chk_predios_dir_alt_activo_sn
        CHECK (activo_sn IN ('S', 'N'));
      END IF;
    END $$;
  `);
  await client.query(`
    UPDATE predios_direcciones_alternas
    SET estado_conexion = 'CORTADO'
    WHERE UPPER(COALESCE(TRIM(estado_conexion), '')) IN ('CORTADO', 'CORTE', 'SUSPENDIDO', 'SUSPENSION')
  `);
  await client.query(`
    ALTER TABLE predios_direcciones_alternas
    DROP CONSTRAINT IF EXISTS chk_predios_dir_alt_estado_conexion
  `);
  await client.query(`
    ALTER TABLE predios_direcciones_alternas
    ADD CONSTRAINT chk_predios_dir_alt_estado_conexion
    CHECK (estado_conexion IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO'))
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_predios_dir_alt_contribuyente
    ON predios_direcciones_alternas (id_contribuyente, creado_en DESC)
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_predios_dir_alt_contrib_direccion_activa
    ON predios_direcciones_alternas (id_contribuyente, UPPER(TRIM(direccion_texto)))
    WHERE activo_sn = 'S'
  `);
};

const ensureCampoSolicitudesTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS campo_solicitudes (
      id_solicitud BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_contribuyente INTEGER NOT NULL REFERENCES contribuyentes(id_contribuyente),
      codigo_municipal VARCHAR(32) NULL,
      estado_solicitud VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      id_usuario_solicita INTEGER NULL,
      nombre_solicitante VARCHAR(160) NULL,
      fuente VARCHAR(40) NOT NULL DEFAULT 'APP_CAMPO',
      tipo_solicitud VARCHAR(40) NOT NULL DEFAULT 'ACTUALIZACION',
      estado_conexion_actual VARCHAR(20) NOT NULL,
      estado_conexion_nuevo VARCHAR(20) NOT NULL,
      nombre_verificado VARCHAR(200) NULL,
      dni_verificado VARCHAR(30) NULL,
      telefono_verificado VARCHAR(40) NULL,
      direccion_verificada TEXT NULL,
      observacion_campo TEXT NULL,
      motivo_revision TEXT NULL,
      id_usuario_revision INTEGER NULL,
      revisado_en TIMESTAMP NULL,
      idempotency_key VARCHAR(80) NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await client.query(`
    ALTER TABLE campo_solicitudes
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(80)
  `);
  await client.query(`
    ALTER TABLE campo_solicitudes
    ADD COLUMN IF NOT EXISTS tipo_solicitud VARCHAR(40)
  `);
  await client.query(`
    ALTER TABLE campo_solicitudes
    ALTER COLUMN id_contribuyente DROP NOT NULL
  `);
  await client.query(`
    UPDATE campo_solicitudes
    SET tipo_solicitud = 'ACTUALIZACION'
    WHERE tipo_solicitud IS NULL
       OR TRIM(tipo_solicitud) = ''
  `);
  await client.query(`
    ALTER TABLE campo_solicitudes
    ALTER COLUMN tipo_solicitud SET DEFAULT 'ACTUALIZACION'
  `);
  await client.query(`
    ALTER TABLE campo_solicitudes
    ALTER COLUMN tipo_solicitud SET NOT NULL
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_campo_solicitudes_estado'
      ) THEN
        ALTER TABLE campo_solicitudes
        ADD CONSTRAINT chk_campo_solicitudes_estado
        CHECK (estado_solicitud IN ('PENDIENTE', 'APROBADO', 'RECHAZADO'));
      END IF;
    END $$;
  `);
  await client.query(`
    ALTER TABLE campo_solicitudes
    DROP CONSTRAINT IF EXISTS chk_campo_solicitudes_tipo
  `);
  await client.query(`
    ALTER TABLE campo_solicitudes
    ADD CONSTRAINT chk_campo_solicitudes_tipo
    CHECK (tipo_solicitud IN ('ACTUALIZACION', 'ALTA_DIRECCION_ALTERNA', 'ALTA_PREDIO', 'ALTA_PREDIO_TEMPORAL'))
  `);
  await client.query(`
    UPDATE campo_solicitudes
    SET
      estado_conexion_actual = CASE
        WHEN UPPER(COALESCE(TRIM(estado_conexion_actual), '')) IN ('CORTE', 'SUSPENDIDO', 'SUSPENSION')
          THEN 'CORTADO'
        ELSE estado_conexion_actual
      END,
      estado_conexion_nuevo = CASE
        WHEN UPPER(COALESCE(TRIM(estado_conexion_nuevo), '')) IN ('CORTE', 'SUSPENDIDO', 'SUSPENSION')
          THEN 'CORTADO'
        ELSE estado_conexion_nuevo
      END
    WHERE
      UPPER(COALESCE(TRIM(estado_conexion_actual), '')) IN ('CORTE', 'SUSPENDIDO', 'SUSPENSION')
      OR UPPER(COALESCE(TRIM(estado_conexion_nuevo), '')) IN ('CORTE', 'SUSPENDIDO', 'SUSPENSION')
  `);
  await client.query(`
    ALTER TABLE campo_solicitudes
    DROP CONSTRAINT IF EXISTS chk_campo_solicitudes_estado_actual
  `);
  await client.query(`
    ALTER TABLE campo_solicitudes
    ADD CONSTRAINT chk_campo_solicitudes_estado_actual
    CHECK (estado_conexion_actual IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO'))
  `);
  await client.query(`
    ALTER TABLE campo_solicitudes
    DROP CONSTRAINT IF EXISTS chk_campo_solicitudes_estado_nuevo
  `);
  await client.query(`
    ALTER TABLE campo_solicitudes
    ADD CONSTRAINT chk_campo_solicitudes_estado_nuevo
    CHECK (estado_conexion_nuevo IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO'))
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_campo_solicitudes_estado
    ON campo_solicitudes (estado_solicitud, creado_en DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_campo_solicitudes_contribuyente
    ON campo_solicitudes (id_contribuyente)
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_campo_solicitudes_idempotency
    ON campo_solicitudes (id_usuario_solicita, idempotency_key)
  `);
};

const ensureComparacionesLegacyTables = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS comparaciones_legacy_corridas (
      id_corrida BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_usuario INTEGER NULL,
      archivo_nombre TEXT NOT NULL,
      archivo_sha256 VARCHAR(64) NOT NULL,
      fecha_desde DATE NULL,
      fecha_hasta DATE NULL,
      duracion_ms INTEGER NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'EN_PROCESO',
      resumen_json JSONB NULL,
      error_json JSONB NULL
    )
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_comparaciones_legacy_corridas_estado'
      ) THEN
        ALTER TABLE comparaciones_legacy_corridas
        ADD CONSTRAINT chk_comparaciones_legacy_corridas_estado
        CHECK (estado IN ('EN_PROCESO', 'COMPLETADA', 'ERROR'));
      END IF;
    END $$;
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_comparaciones_legacy_corridas_creado_en
    ON comparaciones_legacy_corridas (creado_en DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_comparaciones_legacy_corridas_estado
    ON comparaciones_legacy_corridas (estado, creado_en DESC)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS comparaciones_legacy_detalle (
      id_detalle BIGSERIAL PRIMARY KEY,
      id_corrida BIGINT NOT NULL REFERENCES comparaciones_legacy_corridas(id_corrida) ON DELETE CASCADE,
      seccion VARCHAR(30) NOT NULL,
      categoria VARCHAR(40) NOT NULL,
      clave VARCHAR(120) NULL,
      codigo_municipal VARCHAR(32) NULL,
      dni_ruc VARCHAR(32) NULL,
      campo VARCHAR(80) NULL,
      valor_antiguo TEXT NULL,
      valor_nuevo TEXT NULL,
      delta NUMERIC(14, 2) NULL,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_comparaciones_legacy_detalle_corrida
    ON comparaciones_legacy_detalle (id_corrida)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_comparaciones_legacy_detalle_seccion_categoria
    ON comparaciones_legacy_detalle (id_corrida, seccion, categoria)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_comparaciones_legacy_detalle_codigo
    ON comparaciones_legacy_detalle (id_corrida, codigo_municipal)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_comparaciones_legacy_detalle_dni
    ON comparaciones_legacy_detalle (id_corrida, dni_ruc)
  `);
};

const ensureDataIntegrityGuards = async (client) => {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_recibos_total_pagar_non_negative'
      ) THEN
        ALTER TABLE recibos
        ADD CONSTRAINT chk_recibos_total_pagar_non_negative
        CHECK (total_pagar >= 0) NOT VALID;
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_pagos_monto_pagado_positive'
      ) THEN
        ALTER TABLE pagos
        ADD CONSTRAINT chk_pagos_monto_pagado_positive
        CHECK (monto_pagado > 0) NOT VALID;
      END IF;
    END $$;
  `);
  await client.query(`
    ALTER TABLE pagos
    ADD COLUMN IF NOT EXISTS id_orden_cobro BIGINT NULL
  `);
  await client.query(`
    UPDATE pagos
    SET usuario_cajero = 'IMPORTACION_HISTORIAL'
    WHERE id_orden_cobro IS NULL
      AND COALESCE(NULLIF(TRIM(usuario_cajero), ''), '') = ''
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_pagos_origen_registro'
      ) THEN
        ALTER TABLE pagos
        ADD CONSTRAINT chk_pagos_origen_registro
        CHECK (
          id_orden_cobro IS NOT NULL
          OR COALESCE(NULLIF(TRIM(usuario_cajero), ''), '') <> ''
        ) NOT VALID;
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_pagos_id_orden_cobro'
      ) THEN
        ALTER TABLE pagos
        ADD CONSTRAINT fk_pagos_id_orden_cobro
        FOREIGN KEY (id_orden_cobro)
        REFERENCES ordenes_cobro(id_orden);
      END IF;
    END $$;
  `);
};

const ensurePagosAnuladosTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS pagos_anulados (
      id_anulacion BIGSERIAL PRIMARY KEY,
      id_pago_original BIGINT NOT NULL,
      id_recibo INTEGER NOT NULL,
      id_contribuyente INTEGER NULL,
      id_orden_cobro_original BIGINT NULL,
      monto_pagado NUMERIC(12,2) NOT NULL,
      fecha_pago_original TIMESTAMP NOT NULL,
      usuario_cajero_original VARCHAR(120) NULL,
      anulado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_usuario_anula INTEGER NULL,
      username_anula VARCHAR(120) NULL,
      motivo_anulacion VARCHAR(500) NOT NULL,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pagos_anulados_pago_original
    ON pagos_anulados (id_pago_original)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_pagos_anulados_anulado_en
    ON pagos_anulados (anulado_en DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_pagos_anulados_id_recibo
    ON pagos_anulados (id_recibo)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_pagos_anulados_id_contribuyente
    ON pagos_anulados (id_contribuyente, anulado_en DESC)
  `);
};

const ensurePerformanceIndexes = async (client) => {
  await client.query(`
    ALTER TABLE usuarios_sistema
    ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL
  `);
  await ensureCodigosImpresionTable(client);
  await ensureOrdenesCobroTable(client);
  await ensureCajaCierresTable(client);
  await ensureCajaConteosEfectivoTable(client);
  await ensureEstadoConexionContribuyentes(client);
  await ensureEstadoConexionEventosTable(client);
  await ensureEstadoConexionEvidenciasTable(client);
  await ensureContribuyentesAdjuntosTable(client);
  await ensureCajaPermisosAdelantadoTable(client);
  await ensurePrediosDireccionAlterna(client);
  await ensureCampoSolicitudesTable(client);
  await ensureComparacionesLegacyTables(client);
  await ensureDataIntegrityGuards(client);
  await ensurePagosAnuladosTable(client);
  const statements = [
    "CREATE INDEX IF NOT EXISTS idx_pagos_fecha_pago ON pagos (fecha_pago DESC)",
    "CREATE INDEX IF NOT EXISTS idx_pagos_id_recibo ON pagos (id_recibo)",
    "CREATE INDEX IF NOT EXISTS idx_pagos_id_orden_cobro ON pagos (id_orden_cobro)",
    "CREATE INDEX IF NOT EXISTS idx_recibos_id_predio_anio_mes ON recibos (id_predio, anio, mes)",
    "CREATE INDEX IF NOT EXISTS idx_recibos_anio_mes_id_predio_id_recibo ON recibos (anio, mes, id_predio, id_recibo)",
    "CREATE INDEX IF NOT EXISTS idx_recibos_anio_mes ON recibos (anio, mes)",
    "CREATE INDEX IF NOT EXISTS idx_predios_id_contribuyente ON predios (id_contribuyente)",
    "CREATE INDEX IF NOT EXISTS idx_predios_id_calle ON predios (id_calle)",
    "CREATE INDEX IF NOT EXISTS idx_contribuyentes_codigo_municipal ON contribuyentes (codigo_municipal)",
    "CREATE INDEX IF NOT EXISTS idx_contribuyentes_nombre_completo ON contribuyentes (nombre_completo)",
    "CREATE INDEX IF NOT EXISTS idx_codigos_impresion_recibos_json_gin ON codigos_impresion USING GIN (recibos_json)"
  ];
  for (const sql of statements) {
    await client.query(sql);
  }
};

const removerArtefactosReniec = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT schemaname, tablename
          FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename ILIKE 'reniec%'
        LOOP
          EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', r.schemaname, r.tablename);
        END LOOP;
      END $$;
    `);

    await client.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT table_schema, table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND column_name ILIKE 'reniec%'
        LOOP
          EXECUTE format(
            'ALTER TABLE %I.%I DROP COLUMN IF EXISTS %I CASCADE',
            r.table_schema,
            r.table_name,
            r.column_name
          );
        END LOOP;
      END $$;
    `);

    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[RENIEC] Error limpiando artefactos de base de datos:", err.message);
  } finally {
    client.release();
  }
};

// Middleware
const CORS_ALLOWED_ORIGINS = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const CORS_ALLOW_TRYCLOUDFLARE = process.env.CORS_ALLOW_TRYCLOUDFLARE === "1";
const CAMPO_PUBLIC_ONLY = process.env.CAMPO_PUBLIC_ONLY === "1";
const CAMPO_PUBLIC_HOST_PATTERN = new RegExp(
  process.env.CAMPO_PUBLIC_HOST_PATTERN || "\\.trycloudflare\\.com$",
  "i"
);
const JSON_BODY_LIMIT = String(process.env.JSON_BODY_LIMIT || "2mb");
const corsOptionsDelegate = (req, callback) => {
  const requestOrigin = String(req.header("Origin") || "").trim();
  const requestHost = String(req.header("Host") || "").trim();
  const sameOriginHttp = requestHost ? `http://${requestHost}` : "";
  const sameOriginHttps = requestHost ? `https://${requestHost}` : "";
  if (!requestOrigin) return callback(null, { origin: true, credentials: true });
  if (requestOrigin === sameOriginHttp || requestOrigin === sameOriginHttps) {
    return callback(null, { origin: true, credentials: true });
  }
  if (CORS_ALLOWED_ORIGINS.includes(requestOrigin)) {
    return callback(null, { origin: true, credentials: true });
  }
  if (CORS_ALLOW_TRYCLOUDFLARE && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(requestOrigin)) {
    return callback(null, { origin: true, credentials: true });
  }
  if (AUTH_OPTIONAL_DEV && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestOrigin)) {
    return callback(null, { origin: true, credentials: true });
  }
  return callback(new Error("Origen CORS no permitido."));
};
app.use(cors(corsOptionsDelegate));
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.get("/favicon.ico", (req, res) => res.status(204).end());

app.use((req, res, next) => {
  if (!CAMPO_PUBLIC_ONLY) return next();
  const hostOnly = String(req.headers.host || "").split(":")[0].trim().toLowerCase();
  if (!hostOnly || !CAMPO_PUBLIC_HOST_PATTERN.test(hostOnly)) return next();

  const requestPath = String(req.path || "/");
  if (requestPath === "/" || requestPath === "") {
    return res.redirect(302, "/campo-app/");
  }

  const allowed = [
    /^\/campo-app(\/|$)/,
    /^\/campo(\/|$)/,
    /^\/auth\/login$/,
    /^\/login$/,
    /^\/health$/
  ].some((pattern) => pattern.test(requestPath));

  if (!allowed) {
    return res.status(403).json({
      error: "Acceso publico restringido. Use la ruta /campo-app/."
    });
  }
  return next();
});

app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Modulo luz (BD y autenticación separadas)
app.use("/luz", luzRouter);

app.use((req, res, next) => {
  if ((req.method || "").toUpperCase() === "OPTIONS") return next();
  if (!isProtectedApiPath(req.path)) return next();
  return authenticateToken(req, res, () => authorizeByRole(req, res, next));
});

app.use((err, req, res, next) => {
  if (err && String(err.message || "").includes("CORS")) {
    return res.status(403).json({ error: "Origen no permitido por politica CORS." });
  }
  const errType = String(err?.type || "").trim().toLowerCase();
  if (err && (err.status === 413 || err.statusCode === 413 || errType === "entity.too.large")) {
    return res.status(413).json({
      error: "Payload demasiado grande. Reduce el tamaño de la foto e intenta de nuevo."
    });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON invalido." });
  }
  return next(err);
});

const CAMPO_REMOTE_STATE_FILE = path.join(__dirname, "../ops/runtime/campo_remote_state.json");
const normalizeCampoAppUrl = (value) => {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  if (/\/campo-app\/?$/i.test(raw)) {
    return `${raw.replace(/\/+$/g, "")}/`;
  }
  return `${raw.replace(/\/+$/g, "")}/campo-app/`;
};
const readCampoRemoteState = () => {
  if (!fs.existsSync(CAMPO_REMOTE_STATE_FILE)) return null;
  try {
    const raw = fs.readFileSync(CAMPO_REMOTE_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};
const isProcessRunning = (pidRaw) => {
  const pid = parsePositiveInt(pidRaw, 0);
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

app.get("/admin/campo-remoto/estado", (req, res) => {
  const state = readCampoRemoteState();
  if (!state) {
    return res.json({
      active: false,
      campo_url: null,
      tunnel_running: false,
      backend_running: null,
      backend_managed: false
    });
  }

  const tunnelRunning = isProcessRunning(state.tunnel_pid);
  const backendManaged = Boolean(state.backend_managed);
  const backendRunning = backendManaged ? isProcessRunning(state.backend_pid) : null;
  const campoUrl = normalizeCampoAppUrl(state.campo_url || state.base_url || "");
  const active = Boolean(tunnelRunning && campoUrl);

  return res.json({
    active,
    campo_url: active ? campoUrl : null,
    tunnel_running: tunnelRunning,
    backend_running: backendRunning,
    backend_managed: backendManaged,
    started_at: state.started_at || null
  });
});

const normalizarValorAuditoria = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const v = value.trim();
    return v.length > 150 ? `${v.slice(0, 147)}...` : v;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return `[array:${value.length}]`;
  if (typeof value === "object") return "[obj]";
  return String(value);
};

const resumirBodyAuditoria = (body = {}) => {
  if (!body || typeof body !== "object") return {};
  const resumen = {};
  const entries = Object.entries(body).slice(0, 12);
  for (const [key, value] of entries) {
    if (AUDIT_REDACT_KEYS.has(key)) {
      resumen[key] = "[REDACTED]";
      continue;
    }
    resumen[key] = normalizarValorAuditoria(value);
  }
  return resumen;
};

const construirDetalleAuditoria = (req) => {
  const partes = [];
  partes.push(`${req.method} ${req.originalUrl}`);

  const params = req.params && Object.keys(req.params).length > 0
    ? req.params
    : null;
  if (params) partes.push(`params=${JSON.stringify(params)}`);

  const bodyResumen = resumirBodyAuditoria(req.body);
  if (Object.keys(bodyResumen).length > 0) {
    partes.push(`body=${JSON.stringify(bodyResumen)}`);
  }

  if (req.file) {
    partes.push(`archivo=${req.file.originalname || "sin_nombre"} (${req.file.size || 0} bytes)`);
  }
  return partes.join(" | ");
};

const obtenerUsuarioAuditoria = (req) => {
  const fromToken = req.user?.username || req.user?.nombre;
  if (fromToken) return String(fromToken);
  if (req.body?.username) return String(req.body.username);
  return "SISTEMA";
};

app.use((req, res, next) => {
  const method = (req.method || "").toUpperCase();
  const shouldAuditGet = [
    "/admin/backup",
    "/exportar/padron",
    "/exportar/auditoria",
    "/exportar/usuarios-completo",
    "/exportar/finanzas-completo",
    "/caja/reporte/excel"
  ].some((p) => req.path.startsWith(p));
  const shouldAuditMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(method) || (method === "GET" && shouldAuditGet);
  const excluded = req.path.startsWith("/auditoria") || req.path.startsWith("/luz");
  if (!shouldAuditMethod || excluded) return next();

  res.on("finish", () => {
    if (req.skipAutoAudit) return;
    if (res.statusCode < 200 || res.statusCode >= 400) return;

    const usuario = obtenerUsuarioAuditoria(req);
    const accion = `${method} ${req.path}`;
    const detalle = construirDetalleAuditoria(req);
    registrarAuditoria(null, accion, detalle, usuario).catch(() => {});
  });

  return next();
});

// ==========================================
// APP DE CAMPO (solicitudes de cambio con aprobación)
// ==========================================
const normalizeNumericArray = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((v) => Number.parseFloat(v))
      .filter((n) => Number.isFinite(n));
  }
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((v) => Number.parseFloat(String(v || "").trim()))
    .filter((n) => Number.isFinite(n));
};

app.get("/campo/contribuyentes/buscar", async (req, res) => {
  try {
    const q = normalizeLimitedText(req.query?.q, 120);
    const idCalle = parsePositiveInt(req.query?.id_calle, 0);
    const hasTextFilter = q.length >= 2;
    if (!hasTextFilter && !idCalle) return res.json([]);

    const anioActual = getCurrentYear();
    const mesActual = getCurrentMonth();
    const limit = Math.min(300, Math.max(10, parsePositiveInt(req.query?.limit, 120)));
    const params = [anioActual, mesActual];
    let idxLike = 0;
    let idxStarts = 0;
    if (hasTextFilter) {
      params.push(`%${q}%`);
      idxLike = params.length;
    }
    if (hasTextFilter && !idCalle) {
      params.push(`${q}%`);
      idxStarts = params.length;
    }
    let idxCalle = 0;
    if (idCalle) {
      params.push(idCalle);
      idxCalle = params.length;
    }

    const whereParts = [];
    if (hasTextFilter) {
      whereParts.push(`(
        b.codigo_municipal ILIKE $${idxLike}
        OR b.nombre_completo ILIKE $${idxLike}
        OR b.dni_ruc ILIKE $${idxLike}
        OR b.direccion_completa ILIKE $${idxLike}
        OR b.direccion_alterna ILIKE $${idxLike}
        OR b.nombre_calle ILIKE $${idxLike}
      )`);
    }
    if (idCalle) {
      whereParts.push(`b.id_calle = $${idxCalle}`);
    }
    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const orderSql = idCalle
      ? `
        COALESCE(
          NULLIF(REGEXP_REPLACE(COALESCE(TRIM(b.numero_casa), ''), '[^0-9]', '', 'g'), ''),
          NULLIF(REGEXP_REPLACE(COALESCE(b.direccion_completa, ''), '[^0-9]', '', 'g'), ''),
          '999999'
        )::int ASC,
        b.direccion_completa ASC,
        b.nombre_completo ASC
      `
      : (
        hasTextFilter
          ? `
            CASE
              WHEN b.codigo_municipal ILIKE $${idxStarts} THEN 0
              WHEN b.nombre_completo ILIKE $${idxStarts} THEN 1
              WHEN b.dni_ruc ILIKE $${idxStarts} THEN 2
              WHEN b.direccion_completa ILIKE $${idxStarts} THEN 3
              WHEN b.direccion_alterna ILIKE $${idxStarts} THEN 4
              ELSE 5
            END,
            b.nombre_completo ASC
          `
          : "b.nombre_calle ASC NULLS LAST, b.nombre_completo ASC"
      );

    params.push(limit);
    const idxLimit = params.length;

    const rows = await pool.query(`
      WITH recibos_objetivo AS (
        SELECT r.id_recibo, r.id_predio, r.total_pagar, r.anio, r.mes
        FROM recibos r
        WHERE (r.anio, r.mes) <= ($1::int, $2::int)
      ),
      pagos_por_recibo AS (
        SELECT p.id_recibo, SUM(p.monto_pagado) AS total_pagado
        FROM pagos p
        JOIN recibos_objetivo ro ON ro.id_recibo = p.id_recibo
        GROUP BY p.id_recibo
      ),
      resumen_predio AS (
        SELECT
          ro.id_predio,
          SUM(GREATEST(ro.total_pagar - COALESCE(pp.total_pagado, 0), 0)) AS deuda_total,
          COUNT(*) FILTER (WHERE (ro.total_pagar - COALESCE(pp.total_pagado, 0)) > 0) AS meses_deuda_total
        FROM recibos_objetivo ro
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
        GROUP BY ro.id_predio
      ),
      resumen_mensual_contrib AS (
        SELECT
          p.id_contribuyente,
          ro.anio,
          ro.mes,
          SUM(ro.total_pagar)::numeric AS cargo_mes,
          SUM(COALESCE(pp.total_pagado, 0))::numeric AS abono_mes
        FROM recibos_objetivo ro
        JOIN predios p ON p.id_predio = ro.id_predio
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
        WHERE ((ro.anio * 12) + ro.mes) >= (($1::int * 12) + $2::int - 24)
        GROUP BY p.id_contribuyente, ro.anio, ro.mes
      ),
      resumen_mensual_stats AS (
        SELECT
          id_contribuyente,
          ROUND(AVG(cargo_mes)::numeric, 2) AS cargo_mensual_promedio,
          ROUND((ARRAY_AGG(cargo_mes ORDER BY anio DESC, mes DESC))[1]::numeric, 2) AS cargo_mensual_ultimo,
          COALESCE(
            ARRAY_AGG(
              DISTINCT ROUND((CASE WHEN abono_mes > 0 THEN abono_mes ELSE cargo_mes END)::numeric, 2)
              ORDER BY ROUND((CASE WHEN abono_mes > 0 THEN abono_mes ELSE cargo_mes END)::numeric, 2)
            ) FILTER (WHERE (CASE WHEN abono_mes > 0 THEN abono_mes ELSE cargo_mes END) > 0),
            ARRAY[]::numeric[]
          ) AS montos_mensuales_24m
        FROM resumen_mensual_contrib
        GROUP BY id_contribuyente
      ),
      ultima_emision_contrib AS (
        SELECT
          p.id_contribuyente,
          MAX((ro.anio * 100) + ro.mes) AS periodo_num
        FROM recibos_objetivo ro
        JOIN predios p ON p.id_predio = ro.id_predio
        GROUP BY p.id_contribuyente
      ),
      ultimo_mes_pagado_contrib AS (
        SELECT
          p.id_contribuyente,
          MAX((ro.anio * 100) + ro.mes) AS periodo_num
        FROM recibos_objetivo ro
        JOIN predios p ON p.id_predio = ro.id_predio
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
        WHERE COALESCE(pp.total_pagado, 0) >= COALESCE(ro.total_pagar, 0)
        GROUP BY p.id_contribuyente
      ),
      base AS (
        SELECT
          c.id_contribuyente,
          c.codigo_municipal,
          c.nombre_completo,
          c.dni_ruc,
          c.telefono,
          COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
          p.id_calle,
          p.numero_casa,
          COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_sn,
          COALESCE(NULLIF(TRIM(p.direccion_alterna), ''), '') AS direccion_alterna,
          COALESCE(TRIM(ca.nombre), '') AS nombre_calle,
          ${buildDireccionSql("ca", "p")} AS direccion_completa,
          COALESCE(rp.meses_deuda_total, 0) AS meses_deuda,
          COALESCE(rp.deuda_total, 0) AS deuda_total,
          COALESCE(rms.cargo_mensual_ultimo, 0) AS cargo_mensual_ultimo,
          COALESCE(rms.montos_mensuales_24m, ARRAY[]::numeric[]) AS montos_mensuales_24m,
          CASE
            WHEN ue.periodo_num IS NULL THEN NULL
            ELSE CONCAT((ue.periodo_num / 100)::int::text, '-', LPAD((ue.periodo_num % 100)::int::text, 2, '0'))
          END AS ultima_emision_periodo,
          CASE
            WHEN ump.periodo_num IS NULL THEN NULL
            ELSE CONCAT((ump.periodo_num / 100)::int::text, '-', LPAD((ump.periodo_num % 100)::int::text, 2, '0'))
          END AS ultimo_mes_pagado_periodo,
          CASE
            WHEN COALESCE(seg.visitado_sn, 'S') = 'N'
              OR COALESCE(seg.observacion_campo, '') <> ''
              THEN 'S'
            ELSE 'N'
          END AS seguimiento_pendiente_sn,
          CASE
            WHEN COALESCE(seg.visitado_sn, 'S') = 'N' AND COALESCE(seg.observacion_campo, '') <> '' THEN 'NO_VISITADO_Y_OBSERVACION'
            WHEN COALESCE(seg.visitado_sn, 'S') = 'N' THEN 'NO_VISITADO'
            WHEN COALESCE(seg.observacion_campo, '') <> '' THEN 'OBSERVACION'
            ELSE ''
          END AS seguimiento_motivo,
          seg.seguimiento_desde,
          'N' AS verificar_caja_sn
        FROM contribuyentes c
        LEFT JOIN LATERAL (
          SELECT id_predio, id_calle, numero_casa, referencia_direccion, direccion_alterna, agua_sn, desague_sn, limpieza_sn
          FROM predios
          WHERE id_contribuyente = c.id_contribuyente
          ORDER BY id_predio ASC
          LIMIT 1
        ) p ON TRUE
        LEFT JOIN calles ca ON ca.id_calle = p.id_calle
        LEFT JOIN resumen_predio rp ON rp.id_predio = p.id_predio
        LEFT JOIN resumen_mensual_stats rms ON rms.id_contribuyente = c.id_contribuyente
        LEFT JOIN ultima_emision_contrib ue ON ue.id_contribuyente = c.id_contribuyente
        LEFT JOIN ultimo_mes_pagado_contrib ump ON ump.id_contribuyente = c.id_contribuyente
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(NULLIF(UPPER(TRIM(COALESCE(s.metadata->>'visitado_sn', 'N'))), ''), 'N') AS visitado_sn,
            COALESCE(NULLIF(TRIM(s.observacion_campo), ''), '') AS observacion_campo,
            s.creado_en AS seguimiento_desde
          FROM campo_solicitudes s
          WHERE s.id_contribuyente = c.id_contribuyente
            AND s.estado_solicitud <> 'RECHAZADO'
          ORDER BY s.creado_en DESC
          LIMIT 1
        ) seg ON TRUE
      )
      SELECT
        b.id_contribuyente,
        b.codigo_municipal,
        b.nombre_completo,
        b.dni_ruc,
        b.telefono,
        b.estado_conexion,
        b.id_calle,
        b.numero_casa,
        b.agua_sn,
        b.desague_sn,
        b.limpieza_sn,
        b.nombre_calle,
        b.direccion_completa,
        b.direccion_alterna,
        b.meses_deuda,
        b.deuda_total,
        b.cargo_mensual_ultimo,
        b.montos_mensuales_24m,
        b.ultima_emision_periodo,
        b.ultimo_mes_pagado_periodo,
        b.seguimiento_pendiente_sn,
        b.seguimiento_motivo,
        b.seguimiento_desde,
        b.verificar_caja_sn
      FROM base b
      ${whereSql}
      ORDER BY ${orderSql}
      LIMIT $${idxLimit}
    `, params);

    return res.json(rows.rows);
  } catch (err) {
    console.error("Error buscando contribuyentes campo:", err);
    return res.status(500).json({ error: "Error buscando contribuyentes." });
  }
});

app.get("/campo/offline-snapshot", async (req, res) => {
  try {
    const anioActual = getCurrentYear();
    const mesActual = getCurrentMonth();
    const limit = Math.min(10000, Math.max(200, parsePositiveInt(req.query?.limit, 5000)));

    const contribuyentes = await pool.query(`
      WITH recibos_objetivo AS (
        SELECT r.id_recibo, r.id_predio, r.total_pagar, r.anio, r.mes
        FROM recibos r
        WHERE (r.anio, r.mes) <= ($1::int, $2::int)
      ),
      pagos_por_recibo AS (
        SELECT p.id_recibo, SUM(p.monto_pagado) AS total_pagado
        FROM pagos p
        JOIN recibos_objetivo ro ON ro.id_recibo = p.id_recibo
        GROUP BY p.id_recibo
      ),
      resumen_predio AS (
        SELECT
          ro.id_predio,
          SUM(GREATEST(ro.total_pagar - COALESCE(pp.total_pagado, 0), 0)) AS deuda_total,
          COUNT(*) FILTER (WHERE (ro.total_pagar - COALESCE(pp.total_pagado, 0)) > 0) AS meses_deuda_total
        FROM recibos_objetivo ro
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
        GROUP BY ro.id_predio
      ),
      resumen_mensual_contrib AS (
        SELECT
          p.id_contribuyente,
          ro.anio,
          ro.mes,
          SUM(ro.total_pagar)::numeric AS cargo_mes,
          SUM(COALESCE(pp.total_pagado, 0))::numeric AS abono_mes
        FROM recibos_objetivo ro
        JOIN predios p ON p.id_predio = ro.id_predio
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
        WHERE ((ro.anio * 12) + ro.mes) >= (($1::int * 12) + $2::int - 24)
        GROUP BY p.id_contribuyente, ro.anio, ro.mes
      ),
      resumen_mensual_stats AS (
        SELECT
          id_contribuyente,
          ROUND(AVG(cargo_mes)::numeric, 2) AS cargo_mensual_promedio,
          ROUND((ARRAY_AGG(cargo_mes ORDER BY anio DESC, mes DESC))[1]::numeric, 2) AS cargo_mensual_ultimo,
          COALESCE(
            ARRAY_AGG(
              DISTINCT ROUND((CASE WHEN abono_mes > 0 THEN abono_mes ELSE cargo_mes END)::numeric, 2)
              ORDER BY ROUND((CASE WHEN abono_mes > 0 THEN abono_mes ELSE cargo_mes END)::numeric, 2)
            ) FILTER (WHERE (CASE WHEN abono_mes > 0 THEN abono_mes ELSE cargo_mes END) > 0),
            ARRAY[]::numeric[]
          ) AS montos_mensuales_24m
        FROM resumen_mensual_contrib
        GROUP BY id_contribuyente
      ),
      ultima_emision_contrib AS (
        SELECT
          p.id_contribuyente,
          MAX((ro.anio * 100) + ro.mes) AS periodo_num
        FROM recibos_objetivo ro
        JOIN predios p ON p.id_predio = ro.id_predio
        GROUP BY p.id_contribuyente
      ),
      ultimo_mes_pagado_contrib AS (
        SELECT
          p.id_contribuyente,
          MAX((ro.anio * 100) + ro.mes) AS periodo_num
        FROM recibos_objetivo ro
        JOIN predios p ON p.id_predio = ro.id_predio
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
        WHERE COALESCE(pp.total_pagado, 0) >= COALESCE(ro.total_pagar, 0)
        GROUP BY p.id_contribuyente
      ),
      base AS (
        SELECT
          c.id_contribuyente,
          c.codigo_municipal,
          c.nombre_completo,
          c.dni_ruc,
          c.telefono,
          COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
          p.id_calle,
          p.numero_casa,
          COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_sn,
          COALESCE(NULLIF(TRIM(p.direccion_alterna), ''), '') AS direccion_alterna,
          COALESCE(TRIM(ca.nombre), '') AS nombre_calle,
          ${buildDireccionSql("ca", "p")} AS direccion_completa,
          COALESCE(rp.meses_deuda_total, 0) AS meses_deuda,
          COALESCE(rp.deuda_total, 0) AS deuda_total,
          COALESCE(rms.cargo_mensual_ultimo, 0) AS cargo_mensual_ultimo,
          COALESCE(rms.montos_mensuales_24m, ARRAY[]::numeric[]) AS montos_mensuales_24m,
          CASE
            WHEN ue.periodo_num IS NULL THEN NULL
            ELSE CONCAT((ue.periodo_num / 100)::int::text, '-', LPAD((ue.periodo_num % 100)::int::text, 2, '0'))
          END AS ultima_emision_periodo,
          CASE
            WHEN ump.periodo_num IS NULL THEN NULL
            ELSE CONCAT((ump.periodo_num / 100)::int::text, '-', LPAD((ump.periodo_num % 100)::int::text, 2, '0'))
          END AS ultimo_mes_pagado_periodo,
          CASE
            WHEN COALESCE(seg.visitado_sn, 'S') = 'N'
              OR COALESCE(seg.observacion_campo, '') <> ''
              THEN 'S'
            ELSE 'N'
          END AS seguimiento_pendiente_sn,
          CASE
            WHEN COALESCE(seg.visitado_sn, 'S') = 'N' AND COALESCE(seg.observacion_campo, '') <> '' THEN 'NO_VISITADO_Y_OBSERVACION'
            WHEN COALESCE(seg.visitado_sn, 'S') = 'N' THEN 'NO_VISITADO'
            WHEN COALESCE(seg.observacion_campo, '') <> '' THEN 'OBSERVACION'
            ELSE ''
          END AS seguimiento_motivo,
          seg.seguimiento_desde,
          'N' AS verificar_caja_sn
        FROM contribuyentes c
        LEFT JOIN LATERAL (
          SELECT id_predio, id_calle, numero_casa, referencia_direccion, direccion_alterna, agua_sn, desague_sn, limpieza_sn
          FROM predios
          WHERE id_contribuyente = c.id_contribuyente
          ORDER BY id_predio ASC
          LIMIT 1
        ) p ON TRUE
        LEFT JOIN calles ca ON ca.id_calle = p.id_calle
        LEFT JOIN resumen_predio rp ON rp.id_predio = p.id_predio
        LEFT JOIN resumen_mensual_stats rms ON rms.id_contribuyente = c.id_contribuyente
        LEFT JOIN ultima_emision_contrib ue ON ue.id_contribuyente = c.id_contribuyente
        LEFT JOIN ultimo_mes_pagado_contrib ump ON ump.id_contribuyente = c.id_contribuyente
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(NULLIF(UPPER(TRIM(COALESCE(s.metadata->>'visitado_sn', 'N'))), ''), 'N') AS visitado_sn,
            COALESCE(NULLIF(TRIM(s.observacion_campo), ''), '') AS observacion_campo,
            s.creado_en AS seguimiento_desde
          FROM campo_solicitudes s
          WHERE s.id_contribuyente = c.id_contribuyente
            AND s.estado_solicitud <> 'RECHAZADO'
          ORDER BY s.creado_en DESC
          LIMIT 1
        ) seg ON TRUE
      )
      SELECT
        b.id_contribuyente,
        b.codigo_municipal,
        b.nombre_completo,
        b.dni_ruc,
        b.telefono,
        b.estado_conexion,
        b.id_calle,
        b.numero_casa,
        b.agua_sn,
        b.desague_sn,
        b.limpieza_sn,
        b.nombre_calle,
        b.direccion_completa,
        b.direccion_alterna,
        b.meses_deuda,
        b.deuda_total,
        b.cargo_mensual_ultimo,
        b.montos_mensuales_24m,
        b.ultima_emision_periodo,
        b.ultimo_mes_pagado_periodo,
        b.seguimiento_pendiente_sn,
        b.seguimiento_motivo,
        b.seguimiento_desde,
        b.verificar_caja_sn
      FROM base b
      ORDER BY b.nombre_calle ASC NULLS LAST, b.nombre_completo ASC
      LIMIT $3
    `, [anioActual, mesActual, limit]);

    const calles = await pool.query(`
      SELECT id_calle, nombre
      FROM calles
      ORDER BY nombre ASC
    `);

    return res.json({
      synced_at: new Date().toISOString(),
      total: contribuyentes.rows.length,
      calles: calles.rows,
      contribuyentes: contribuyentes.rows
    });
  } catch (err) {
    console.error("Error generando snapshot offline campo:", err);
    return res.status(500).json({ error: "Error generando snapshot offline." });
  }
});

app.post("/campo/solicitudes", async (req, res) => {
  let idempotencyKey = null;
  try {
    const tipoSolicitud = normalizeTipoSolicitudCampo(
      req.body?.tipo_solicitud || req.body?.metadata?.tipo_solicitud,
      TIPOS_SOLICITUD_CAMPO.ACTUALIZACION
    );
    const idempotencyInput = normalizeLimitedText(
      req.body?.idempotency_key || req.body?.metadata?.idempotency_key || req.get("Idempotency-Key"),
      80
    );
    idempotencyKey = idempotencyInput
      ? idempotencyInput.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 80)
      : null;
    if (idempotencyInput && !idempotencyKey) {
      return res.status(400).json({ error: "idempotency_key invalido." });
    }
    if (idempotencyKey) {
      const duplicated = await pool.query(
        `SELECT id_solicitud, creado_en
         FROM campo_solicitudes
         WHERE id_usuario_solicita = $1
           AND idempotency_key = $2
         LIMIT 1`,
        [req.user?.id_usuario ?? null, idempotencyKey]
      );
      if (duplicated.rows.length > 0) {
        return res.status(200).json({
          mensaje: "Solicitud de campo ya registrada.",
          id_solicitud: Number(duplicated.rows[0].id_solicitud),
          creado_en: duplicated.rows[0].creado_en,
          duplicate: true
        });
      }
    }

    if (tipoSolicitud === TIPOS_SOLICITUD_CAMPO.ALTA_PREDIO || tipoSolicitud === TIPOS_SOLICITUD_CAMPO.ALTA_PREDIO_TEMPORAL) {
      const direccionVerificada = normalizeLimitedText(req.body?.direccion_verificada, 250) || null;
      const nombreVerificado = normalizeLimitedText(req.body?.nombre_verificado, 200) || null;
      const dniVerificado = normalizeLimitedText(req.body?.dni_verificado, 30) || null;
      const telefonoVerificado = normalizeLimitedText(req.body?.telefono_verificado, 40) || null;
      const motivoObs = normalizeLimitedText(req.body?.motivo_obs, 1200) || null;
      const observacionCampo = normalizeLimitedText(req.body?.observacion_campo || motivoObs, 1200) || null;
      const inspector = normalizeLimitedText(req.body?.inspector, 120) || null;
      const referenciaDireccion = normalizeLimitedText(req.body?.referencia_direccion, 250)
        || normalizeLimitedText(req.body?.metadata?.referencia_direccion, 250)
        || null;
      const verificacionEstado = normalizeVerificacionEstado(req.body?.verificacion_estado || req.body?.metadata?.verificacion_estado);
      const verificacionMotivo = normalizeVerificacionMotivo(req.body?.verificacion_motivo || req.body?.metadata?.verificacion_motivo);
      const fotoFachada = normalizeFotoBase64(req.body?.foto_fachada_base64 || req.body?.metadata?.foto_fachada_base64);
      if (fotoFachada === "__TOO_LARGE__") {
        return res.status(400).json({ error: "La foto es demasiado grande." });
      }

      const predioTemporalSN = (
        tipoSolicitud === TIPOS_SOLICITUD_CAMPO.ALTA_PREDIO_TEMPORAL
        || verificacionEstado === "NO_VERIFICADO"
      )
        ? "S"
        : normalizeSN(req.body?.predio_temporal_sn, "N");

      if (!direccionVerificada && !referenciaDireccion && !fotoFachada) {
        return res.status(400).json({ error: "Debe indicar la direccion, una referencia o adjuntar foto del predio nuevo." });
      }

      const metadataInput = req.body?.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata)
        ? req.body.metadata
        : {};
      const metadata = {
        ...metadataInput,
        formato: "ALTA_PREDIO",
        tipo_solicitud: tipoSolicitud,
        inspector: inspector || normalizeLimitedText(req.user?.nombre || req.user?.username || "", 120),
        referencia_direccion: referenciaDireccion || null,
        verificacion_estado: verificacionEstado,
        verificacion_motivo: verificacionMotivo,
        predio_temporal_sn: predioTemporalSN,
        verificar_caja_sn: "N",
        foto_fachada_base64: fotoFachada,
        idempotency_key: idempotencyKey
      };

      const estadoActual = ESTADOS_CONEXION.SIN_CONEXION;
      const estadoNuevo = ESTADOS_CONEXION.SIN_CONEXION;

      const created = await pool.query(`
        INSERT INTO campo_solicitudes (
          id_contribuyente,
          codigo_municipal,
          estado_solicitud,
          id_usuario_solicita,
          nombre_solicitante,
          fuente,
          tipo_solicitud,
          estado_conexion_actual,
          estado_conexion_nuevo,
          nombre_verificado,
          dni_verificado,
          telefono_verificado,
          direccion_verificada,
          observacion_campo,
          idempotency_key,
          metadata
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16
        )
        RETURNING id_solicitud, creado_en
      `, [
        null,
        null,
        ESTADOS_SOLICITUD_CAMPO.PENDIENTE,
        req.user?.id_usuario || null,
        normalizeLimitedText(req.user?.nombre || req.user?.username || "", 160) || null,
        FUENTE_SOLICITUD_CAMPO,
        tipoSolicitud,
        estadoActual,
        estadoNuevo,
        nombreVerificado,
        dniVerificado,
        telefonoVerificado,
        direccionVerificada,
        observacionCampo,
        idempotencyKey,
        metadata
      ]);

      await registrarAuditoria(
        null,
        "CAMPO_SOLICITUD_CREAR",
        `ID ${created.rows[0].id_solicitud} | Tipo ${tipoSolicitud} | Predio nuevo ${direccionVerificada}`,
        req.user?.nombre || req.user?.username || "SISTEMA"
      );

      return res.status(201).json({
        mensaje: "Solicitud de predio nuevo registrada.",
        id_solicitud: Number(created.rows[0].id_solicitud),
        creado_en: created.rows[0].creado_en
      });
    }

    const idContribuyente = parsePositiveInt(req.body?.id_contribuyente, 0);
    if (!idContribuyente) {
      return res.status(400).json({ error: "ID de contribuyente inválido." });
    }
    const anioActual = getCurrentYear();
    const mesActual = getCurrentMonth();

    const actual = await pool.query(`
      WITH recibos_objetivo AS (
        SELECT r.id_recibo, r.id_predio, r.total_pagar, r.anio, r.mes
        FROM recibos r
        WHERE (r.anio, r.mes) <= ($1::int, $2::int)
      ),
      pagos_por_recibo AS (
        SELECT p.id_recibo, SUM(p.monto_pagado) AS total_pagado
        FROM pagos p
        JOIN recibos_objetivo ro ON ro.id_recibo = p.id_recibo
        GROUP BY p.id_recibo
      ),
      resumen_predio AS (
        SELECT
          ro.id_predio,
          SUM(GREATEST(ro.total_pagar - COALESCE(pp.total_pagado, 0), 0)) AS deuda_total,
          COUNT(*) FILTER (WHERE (ro.total_pagar - COALESCE(pp.total_pagado, 0)) > 0) AS meses_deuda_total
        FROM recibos_objetivo ro
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
        GROUP BY ro.id_predio
      ),
      resumen_mensual_contrib AS (
        SELECT
          p.id_contribuyente,
          ro.anio,
          ro.mes,
          SUM(ro.total_pagar)::numeric AS cargo_mes,
          SUM(COALESCE(pp.total_pagado, 0))::numeric AS abono_mes
        FROM recibos_objetivo ro
        JOIN predios p ON p.id_predio = ro.id_predio
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
        WHERE ((ro.anio * 12) + ro.mes) >= (($1::int * 12) + $2::int - 24)
        GROUP BY p.id_contribuyente, ro.anio, ro.mes
      ),
      resumen_mensual_stats AS (
        SELECT
          id_contribuyente,
          ROUND(AVG(cargo_mes)::numeric, 2) AS cargo_mensual_promedio,
          ROUND((ARRAY_AGG(cargo_mes ORDER BY anio DESC, mes DESC))[1]::numeric, 2) AS cargo_mensual_ultimo,
          COALESCE(
            ARRAY_AGG(
              DISTINCT ROUND((CASE WHEN abono_mes > 0 THEN abono_mes ELSE cargo_mes END)::numeric, 2)
              ORDER BY ROUND((CASE WHEN abono_mes > 0 THEN abono_mes ELSE cargo_mes END)::numeric, 2)
            ) FILTER (WHERE (CASE WHEN abono_mes > 0 THEN abono_mes ELSE cargo_mes END) > 0),
            ARRAY[]::numeric[]
          ) AS montos_mensuales_24m
        FROM resumen_mensual_contrib
        GROUP BY id_contribuyente
      ),
      ultima_emision_contrib AS (
        SELECT
          p.id_contribuyente,
          MAX((ro.anio * 100) + ro.mes) AS periodo_num
        FROM recibos_objetivo ro
        JOIN predios p ON p.id_predio = ro.id_predio
        GROUP BY p.id_contribuyente
      ),
      ultimo_mes_pagado_contrib AS (
        SELECT
          p.id_contribuyente,
          MAX((ro.anio * 100) + ro.mes) AS periodo_num
        FROM recibos_objetivo ro
        JOIN predios p ON p.id_predio = ro.id_predio
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
        WHERE COALESCE(pp.total_pagado, 0) >= COALESCE(ro.total_pagar, 0)
        GROUP BY p.id_contribuyente
      )
      SELECT
        c.id_contribuyente,
        c.codigo_municipal,
        c.nombre_completo,
        c.dni_ruc,
        c.telefono,
        COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
        COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_sn,
        p.referencia_direccion,
        p.direccion_alterna,
        ${buildDireccionSql("ca", "p")} AS direccion_completa,
        COALESCE(rp.meses_deuda_total, 0) AS meses_deuda,
        COALESCE(rp.deuda_total, 0) AS deuda_total,
        COALESCE(rms.cargo_mensual_ultimo, 0) AS cargo_mensual_ultimo,
        COALESCE(rms.montos_mensuales_24m, ARRAY[]::numeric[]) AS montos_mensuales_24m,
        CASE
          WHEN ue.periodo_num IS NULL THEN NULL
          ELSE CONCAT((ue.periodo_num / 100)::int::text, '-', LPAD((ue.periodo_num % 100)::int::text, 2, '0'))
        END AS ultima_emision_periodo,
        CASE
          WHEN ump.periodo_num IS NULL THEN NULL
          ELSE CONCAT((ump.periodo_num / 100)::int::text, '-', LPAD((ump.periodo_num % 100)::int::text, 2, '0'))
        END AS ultimo_mes_pagado_periodo
      FROM contribuyentes c
      LEFT JOIN LATERAL (
        SELECT id_predio, id_calle, numero_casa, referencia_direccion, direccion_alterna, agua_sn, desague_sn, limpieza_sn
        FROM predios
        WHERE id_contribuyente = c.id_contribuyente
        ORDER BY id_predio ASC
        LIMIT 1
      ) p ON TRUE
      LEFT JOIN calles ca ON ca.id_calle = p.id_calle
      LEFT JOIN resumen_predio rp ON rp.id_predio = p.id_predio
      LEFT JOIN resumen_mensual_stats rms ON rms.id_contribuyente = c.id_contribuyente
      LEFT JOIN ultima_emision_contrib ue ON ue.id_contribuyente = c.id_contribuyente
      LEFT JOIN ultimo_mes_pagado_contrib ump ON ump.id_contribuyente = c.id_contribuyente
      WHERE c.id_contribuyente = $3
      LIMIT 1
    `, [anioActual, mesActual, idContribuyente]);

    if (actual.rows.length === 0) {
      return res.status(404).json({ error: "Contribuyente no encontrado." });
    }

    const row = actual.rows[0];
    const estadoActual = normalizeEstadoConexion(row.estado_conexion);
    const visitadoSN = normalizeSN(req.body?.visitado_sn, "N");
    const cortadoSNLegacy = normalizeSN(req.body?.cortado_sn, "N");
    const estadoSolicitado = normalizeEstadoConexion(
      req.body?.estado_conexion_nuevo
      || (cortadoSNLegacy === "S" ? ESTADOS_CONEXION.CORTADO : estadoActual)
    );
    const estadoNuevo = estadoSolicitado;
    const fechaCorte = normalizeDateOnly(req.body?.fecha_corte) || null;
    const fechaCorteFinal = fechaCorte;
    const inspector = normalizeLimitedText(req.body?.inspector, 120) || null;
    const motivoObs = normalizeLimitedText(req.body?.motivo_obs, 1200) || null;
    const nombreVerificado = normalizeLimitedText(req.body?.nombre_verificado, 200) || null;
    const dniVerificado = normalizeLimitedText(req.body?.dni_verificado, 30) || null;
    const telefonoVerificado = normalizeLimitedText(req.body?.telefono_verificado, 40) || null;
    const direccionVerificada = normalizeLimitedText(req.body?.direccion_verificada, 250) || null;
    const observacionCampo = normalizeLimitedText(req.body?.observacion_campo || motivoObs, 1200) || null;
    const verificacionEstado = normalizeVerificacionEstado(req.body?.verificacion_estado || req.body?.metadata?.verificacion_estado);
    const verificacionMotivo = normalizeVerificacionMotivo(req.body?.verificacion_motivo || req.body?.metadata?.verificacion_motivo);
    const predioTemporalSN = normalizeSN(req.body?.predio_temporal_sn, "N");
    const fotoFachada = normalizeFotoBase64(req.body?.foto_fachada_base64 || req.body?.metadata?.foto_fachada_base64);
    if (fotoFachada === "__TOO_LARGE__") {
      return res.status(400).json({ error: "La foto es demasiado grande." });
    }
    const verificacionPendiente = verificacionEstado === "NO_VERIFICADO";
    const seguimientoPendienteSN = (visitadoSN === "N" || Boolean(observacionCampo) || verificacionPendiente) ? "S" : "N";
    const seguimientoMotivos = [];
    if (visitadoSN === "N") seguimientoMotivos.push("NO_VISITADO");
    if (verificacionPendiente) seguimientoMotivos.push("NO_VERIFICADO");
    if (observacionCampo) seguimientoMotivos.push("OBSERVACION");
    const seguimientoMotivo = seguimientoMotivos.join("|");
    const aguaActual = normalizeSN(row.agua_sn, "S");
    const desagueActual = normalizeSN(row.desague_sn, "S");
    const limpiezaActual = normalizeSN(row.limpieza_sn, "S");
    const aguaNuevo = normalizeSN(req.body?.agua_sn, aguaActual);
    const desagueNuevo = normalizeSN(req.body?.desague_sn, desagueActual);
    const limpiezaNuevo = normalizeSN(req.body?.limpieza_sn, limpiezaActual);
    const metadataInput = req.body?.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata)
      ? req.body.metadata
      : {};
    const metadata = {
      ...metadataInput,
      formato: "REPORTE_CORTES",
      visitado_sn: visitadoSN,
      cortado_sn: (estadoNuevo === ESTADOS_CONEXION.SIN_CONEXION || estadoNuevo === ESTADOS_CONEXION.CORTADO) ? "S" : "N",
      fecha_corte: fechaCorteFinal,
      motivo_obs: motivoObs,
      inspector: inspector || normalizeLimitedText(req.user?.nombre || req.user?.username || "", 120),
      meses_deuda: Number(row.meses_deuda || 0),
      deuda_total: Number(parseFloat(row.deuda_total || 0) || 0),
      cargo_mensual_ultimo: Number(parseFloat(row.cargo_mensual_ultimo || 0) || 0),
      montos_mensuales_24m: normalizeNumericArray(row.montos_mensuales_24m),
      ultima_emision_periodo: String(row.ultima_emision_periodo || "").trim() || null,
      ultimo_mes_pagado_periodo: String(row.ultimo_mes_pagado_periodo || "").trim() || null,
      seguimiento_pendiente_sn: seguimientoPendienteSN,
      seguimiento_motivo: seguimientoMotivo,
      tipo_solicitud: tipoSolicitud,
      estado_actual: estadoActual,
      estado_nuevo: estadoNuevo,
      servicio_agua_actual: aguaActual,
      servicio_agua_nuevo: aguaNuevo,
      servicio_desague_actual: desagueActual,
      servicio_desague_nuevo: desagueNuevo,
      servicio_limpieza_actual: limpiezaActual,
      servicio_limpieza_nuevo: limpiezaNuevo,
      verificacion_estado: verificacionEstado,
      verificacion_motivo: verificacionMotivo,
      predio_temporal_sn: predioTemporalSN,
      verificar_caja_sn: "N",
      foto_fachada_base64: fotoFachada,
      idempotency_key: idempotencyKey
    };

    const equalsText = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();
    const nombreActual = normalizeLimitedText(row.nombre_completo, 200);
    const dniActual = normalizeLimitedText(row.dni_ruc, 30);
    const telefonoActual = normalizeLimitedText(row.telefono, 40);
    const direccionActual = normalizeLimitedText(row.direccion_completa || row.referencia_direccion, 250);
    const direccionAlternaActual = normalizeLimitedText(row.direccion_alterna, 250);

    if (tipoSolicitud === TIPOS_SOLICITUD_CAMPO.ALTA_DIRECCION_ALTERNA) {
      if (!direccionVerificada) {
        return res.status(400).json({
          error: "Debe indicar la nueva direccion para registrar direccion alterna."
        });
      }
      if (equalsText(direccionVerificada, direccionActual)) {
        return res.status(400).json({
          error: "La direccion alterna no puede ser igual a la direccion principal."
        });
      }
      if (direccionAlternaActual && equalsText(direccionVerificada, direccionAlternaActual)) {
        return res.status(400).json({
          error: "La direccion alterna ya se encuentra registrada."
        });
      }
    }

    const hayCambio = (
      estadoNuevo !== estadoActual ||
      visitadoSN === "S" ||
      visitadoSN === "N" ||
      Boolean(fechaCorteFinal) ||
      Boolean(inspector) ||
      Boolean(motivoObs) ||
      aguaNuevo !== aguaActual ||
      desagueNuevo !== desagueActual ||
      limpiezaNuevo !== limpiezaActual ||
      (nombreVerificado && !equalsText(nombreVerificado, nombreActual)) ||
      (dniVerificado && !equalsText(dniVerificado, dniActual)) ||
      (telefonoVerificado && !equalsText(telefonoVerificado, telefonoActual)) ||
      (tipoSolicitud === TIPOS_SOLICITUD_CAMPO.ALTA_DIRECCION_ALTERNA
        ? (direccionVerificada && !equalsText(direccionVerificada, direccionAlternaActual))
        : (direccionVerificada && !equalsText(direccionVerificada, direccionActual)))
    );
    if (!hayCambio && !observacionCampo) {
      return res.status(400).json({
        error: "No hay cambios para registrar. Envíe al menos un cambio o una observación."
      });
    }

    const created = await pool.query(`
      INSERT INTO campo_solicitudes (
        id_contribuyente,
        codigo_municipal,
        estado_solicitud,
        id_usuario_solicita,
        nombre_solicitante,
        fuente,
        tipo_solicitud,
        estado_conexion_actual,
        estado_conexion_nuevo,
        nombre_verificado,
        dni_verificado,
        telefono_verificado,
        direccion_verificada,
        observacion_campo,
        idempotency_key,
        metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16
      )
      RETURNING id_solicitud, creado_en
    `, [
      idContribuyente,
      row.codigo_municipal || null,
      ESTADOS_SOLICITUD_CAMPO.PENDIENTE,
      req.user?.id_usuario || null,
      normalizeLimitedText(req.user?.nombre || req.user?.username || "", 160) || null,
      FUENTE_SOLICITUD_CAMPO,
      tipoSolicitud,
      estadoActual,
      estadoNuevo,
      nombreVerificado,
      dniVerificado,
      telefonoVerificado,
      direccionVerificada,
      observacionCampo,
      idempotencyKey,
      metadata
    ]);

    await registrarAuditoria(
      null,
      "CAMPO_SOLICITUD_CREAR",
      `ID ${created.rows[0].id_solicitud} | Tipo ${tipoSolicitud} | Contribuyente ${row.codigo_municipal || idContribuyente} ${row.nombre_completo || ""}`,
      req.user?.nombre || req.user?.username || "SISTEMA"
    );

    return res.status(201).json({
      mensaje: "Solicitud de campo registrada.",
      id_solicitud: Number(created.rows[0].id_solicitud),
      creado_en: created.rows[0].creado_en
    });
  } catch (err) {
    if (err?.code === "23505" && idempotencyKey) {
      try {
        const duplicated = await pool.query(
          `SELECT id_solicitud, creado_en
           FROM campo_solicitudes
           WHERE id_usuario_solicita = $1
             AND idempotency_key = $2
           LIMIT 1`,
          [req.user?.id_usuario ?? null, idempotencyKey]
        );
        if (duplicated.rows.length > 0) {
          return res.status(200).json({
            mensaje: "Solicitud de campo ya registrada.",
            id_solicitud: Number(duplicated.rows[0].id_solicitud),
            creado_en: duplicated.rows[0].creado_en,
            duplicate: true
          });
        }
      } catch (dupErr) {
        console.error("Error validando duplicado de solicitud campo:", dupErr);
      }
    }
    console.error("Error creando solicitud de campo:", err);
    return res.status(500).json({ error: "Error registrando solicitud de campo." });
  }
});

app.get("/campo/solicitudes", async (req, res) => {
  try {
    const estadoRaw = String(req.query?.estado || ESTADOS_SOLICITUD_CAMPO.PENDIENTE).trim().toUpperCase();
    const estadoFiltro = (
      estadoRaw !== "TODOS" && Object.prototype.hasOwnProperty.call(ESTADOS_SOLICITUD_CAMPO, estadoRaw)
    ) ? estadoRaw : null;
    const limit = Math.min(5000, Math.max(10, parsePositiveInt(req.query?.limit, 1000)));

    const where = [];
    const params = [];
    if (estadoFiltro) {
      params.push(estadoFiltro);
      where.push(`s.estado_solicitud = $${params.length}`);
    }
    params.push(limit);

    const sql = `
      SELECT
        s.id_solicitud,
        s.creado_en,
        s.actualizado_en,
        s.estado_solicitud,
        s.id_contribuyente,
        s.codigo_municipal,
        s.id_usuario_solicita,
        s.nombre_solicitante,
        s.fuente,
        s.tipo_solicitud,
        s.estado_conexion_actual,
        s.estado_conexion_nuevo,
        s.nombre_verificado,
        s.dni_verificado,
        s.telefono_verificado,
        s.direccion_verificada,
        s.observacion_campo,
        s.motivo_revision,
        s.id_usuario_revision,
        s.revisado_en,
        s.metadata,
        c.nombre_completo AS nombre_actual_db,
        c.dni_ruc AS dni_actual_db,
        c.telefono AS telefono_actual_db,
        COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_actual_db,
        COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_actual_db,
        COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_actual_db,
        COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_actual_db,
        COALESCE(NULLIF(TRIM(p.direccion_alterna), ''), '') AS direccion_alterna_actual_db,
        COALESCE(NULLIF(TRIM(ca.nombre), ''), '') AS nombre_calle_db,
        ${buildDireccionSql("ca", "p")} AS direccion_actual_db
      FROM campo_solicitudes s
      LEFT JOIN contribuyentes c ON c.id_contribuyente = s.id_contribuyente
      LEFT JOIN LATERAL (
        SELECT id_predio, id_calle, numero_casa, referencia_direccion, direccion_alterna, agua_sn, desague_sn, limpieza_sn
        FROM predios
        WHERE id_contribuyente = c.id_contribuyente
        ORDER BY id_predio ASC
        LIMIT 1
      ) p ON TRUE
      LEFT JOIN calles ca ON ca.id_calle = p.id_calle
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY
        CASE WHEN s.estado_solicitud = 'PENDIENTE' THEN 0 ELSE 1 END,
        s.creado_en DESC
      LIMIT $${params.length}
    `;
    const data = await pool.query(sql, params);
    return res.json(data.rows);
  } catch (err) {
    console.error("Error listando solicitudes campo:", err);
    return res.status(500).json({ error: "Error listando solicitudes." });
  }
});

const exportarReporteEmpadronados = async (req, res) => {
  try {
    const estadoRaw = String(req.query?.estado || "TODOS").trim().toUpperCase();
    const organizarPor = String(req.query?.organizar_por || "CALLE").trim().toUpperCase() === "CALLE" ? "CALLE" : "NOMBRE";
    const ordenGrupo = String(req.query?.orden_grupo || "ASC").trim().toUpperCase() === "DESC" ? "DESC" : "ASC";
    const ordenItems = String(req.query?.orden_items || "ASC").trim().toUpperCase() === "DESC" ? "DESC" : "ASC";

    const sql = `
      WITH predio_base AS (
        SELECT
          c.id_contribuyente,
          c.codigo_municipal,
          c.sec_cod,
          c.sec_nombre,
          c.dni_ruc,
          c.nombre_completo,
          c.email,
          c.telefono,
          COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
          COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion_fuente)), ''), 'INFERIDO') AS estado_conexion_fuente,
          COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion_verificado_sn)), ''), 'N') AS estado_conexion_verificado_sn,
          c.estado_conexion_fecha_verificacion,
          c.estado_conexion_motivo_ultimo,
          c.razon_social_motivo_ultimo,
          c.razon_social_actualizado_en,
          p.id_predio,
          p.id_calle,
          p.numero_casa,
          p.manzana,
          p.lote,
          p.referencia_direccion,
          p.direccion_alterna,
          p.id_tarifa,
          p.tipo_tarifa,
          COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.activo_sn)), ''), 'S') AS activo_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.estado_servicio)), ''), '') AS estado_servicio,
          COALESCE(NULLIF(TRIM(ca.nombre), ''), '') AS nombre_calle,
          ${buildDireccionSql("ca", "p")} AS direccion_completa
        FROM contribuyentes c
        LEFT JOIN LATERAL (
          SELECT
            id_predio, id_calle, numero_casa, manzana, lote, referencia_direccion,
            direccion_alterna, id_tarifa, tipo_tarifa, agua_sn, desague_sn,
            limpieza_sn, activo_sn, estado_servicio
          FROM predios
          WHERE id_contribuyente = c.id_contribuyente
          ORDER BY id_predio ASC
          LIMIT 1
        ) p ON TRUE
        LEFT JOIN calles ca ON ca.id_calle = p.id_calle
      ),
      solicitudes_stats AS (
        SELECT
          s.id_contribuyente,
          COUNT(*)::int AS total_solicitudes,
          COUNT(*) FILTER (WHERE s.estado_solicitud = 'PENDIENTE')::int AS solicitudes_pendientes,
          COUNT(*) FILTER (WHERE s.estado_solicitud = 'APROBADO')::int AS solicitudes_aprobadas,
          COUNT(*) FILTER (WHERE s.estado_solicitud = 'RECHAZADO')::int AS solicitudes_rechazadas,
          MAX(s.creado_en) AS ultima_solicitud
        FROM campo_solicitudes s
        WHERE s.id_contribuyente IS NOT NULL
        GROUP BY s.id_contribuyente
      ),
      recibos_base AS (
        SELECT
          r.id_recibo,
          p.id_contribuyente,
          r.anio,
          r.mes,
          COALESCE(r.subtotal_agua, 0) AS subtotal_agua,
          COALESCE(r.subtotal_desague, 0) AS subtotal_desague,
          COALESCE(r.subtotal_limpieza, 0) AS subtotal_limpieza,
          COALESCE(r.subtotal_admin, 0) AS subtotal_admin,
          COALESCE(r.total_pagar, 0) AS total_pagar
        FROM recibos r
        JOIN predios p ON p.id_predio = r.id_predio
      ),
      pagos_por_recibo AS (
        SELECT p.id_recibo, SUM(p.monto_pagado)::numeric AS total_pagado
        FROM pagos p
        GROUP BY p.id_recibo
      ),
      recibos_calc AS (
        SELECT
          rb.*,
          COALESCE(ppr.total_pagado, 0) AS total_pagado,
          GREATEST(rb.total_pagar - COALESCE(ppr.total_pagado, 0), 0) AS saldo_pendiente
        FROM recibos_base rb
        LEFT JOIN pagos_por_recibo ppr ON ppr.id_recibo = rb.id_recibo
      ),
      fin_agg AS (
        SELECT
          rc.id_contribuyente,
          COUNT(*)::int AS total_recibos_emitidos,
          SUM(rc.total_pagar)::numeric AS facturado_total,
          SUM(rc.total_pagado)::numeric AS pagado_total,
          SUM(rc.saldo_pendiente)::numeric AS deuda_pendiente_total,
          COUNT(*) FILTER (WHERE rc.saldo_pendiente > 0)::int AS meses_con_deuda,
          MAX((rc.anio * 100) + rc.mes) AS ultimo_periodo_num,
          SUM(rc.subtotal_agua)::numeric AS cargo_agua_historico,
          SUM(rc.subtotal_desague)::numeric AS cargo_desague_historico,
          SUM(rc.subtotal_limpieza)::numeric AS cargo_limpieza_historico,
          SUM(rc.subtotal_admin)::numeric AS cargo_admin_historico
        FROM recibos_calc rc
        GROUP BY rc.id_contribuyente
      ),
      ultimo_periodo AS (
        SELECT id_contribuyente, MAX((anio * 100) + mes) AS periodo_num
        FROM recibos_base
        GROUP BY id_contribuyente
      ),
      ultimo_mes AS (
        SELECT
          rb.id_contribuyente,
          rb.anio,
          rb.mes,
          SUM(rb.subtotal_agua)::numeric AS cargo_agua_ultimo_mes,
          SUM(rb.subtotal_desague)::numeric AS cargo_desague_ultimo_mes,
          SUM(rb.subtotal_limpieza)::numeric AS cargo_limpieza_ultimo_mes,
          SUM(rb.subtotal_admin)::numeric AS cargo_admin_ultimo_mes,
          SUM(rb.total_pagar)::numeric AS total_cargo_ultimo_mes
        FROM recibos_base rb
        JOIN ultimo_periodo up
          ON up.id_contribuyente = rb.id_contribuyente
          AND up.periodo_num = ((rb.anio * 100) + rb.mes)
        GROUP BY rb.id_contribuyente, rb.anio, rb.mes
      )
      SELECT
        pb.*,
        COALESCE(ss.total_solicitudes, 0) AS total_solicitudes,
        COALESCE(ss.solicitudes_pendientes, 0) AS solicitudes_pendientes,
        COALESCE(ss.solicitudes_aprobadas, 0) AS solicitudes_aprobadas,
        COALESCE(ss.solicitudes_rechazadas, 0) AS solicitudes_rechazadas,
        ss.ultima_solicitud,
        CASE WHEN ss.id_contribuyente IS NULL THEN 'N' ELSE 'S' END AS visitado_campo_sn,
        COALESCE(fa.total_recibos_emitidos, 0) AS total_recibos_emitidos,
        COALESCE(fa.facturado_total, 0) AS facturado_total,
        COALESCE(fa.pagado_total, 0) AS pagado_total,
        COALESCE(fa.deuda_pendiente_total, 0) AS deuda_pendiente_total,
        COALESCE(fa.meses_con_deuda, 0) AS meses_con_deuda,
        fa.ultimo_periodo_num,
        COALESCE(fa.cargo_agua_historico, 0) AS cargo_agua_historico,
        COALESCE(fa.cargo_desague_historico, 0) AS cargo_desague_historico,
        COALESCE(fa.cargo_limpieza_historico, 0) AS cargo_limpieza_historico,
        COALESCE(fa.cargo_admin_historico, 0) AS cargo_admin_historico,
        COALESCE(um.cargo_agua_ultimo_mes, 0) AS cargo_agua_ultimo_mes,
        COALESCE(um.cargo_desague_ultimo_mes, 0) AS cargo_desague_ultimo_mes,
        COALESCE(um.cargo_limpieza_ultimo_mes, 0) AS cargo_limpieza_ultimo_mes,
        COALESCE(um.cargo_admin_ultimo_mes, 0) AS cargo_admin_ultimo_mes,
        COALESCE(um.total_cargo_ultimo_mes, 0) AS total_cargo_ultimo_mes,
        um.anio AS ultimo_anio,
        um.mes AS ultimo_mes
      FROM predio_base pb
      LEFT JOIN solicitudes_stats ss ON ss.id_contribuyente = pb.id_contribuyente
      LEFT JOIN fin_agg fa ON fa.id_contribuyente = pb.id_contribuyente
      LEFT JOIN ultimo_mes um ON um.id_contribuyente = pb.id_contribuyente
    `;
    const data = await pool.query(sql);

    const toDateText = (value) => {
      if (!value) return "";
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("es-PE");
    };
    const toPeriod = (anio, mes, fallbackNum) => {
      const y = Number(anio || 0);
      const m = Number(mes || 0);
      if (y > 0 && m > 0) return `${y}-${String(m).padStart(2, "0")}`;
      const n = Number(fallbackNum || 0);
      if (!n) return "";
      return `${Math.floor(n / 100)}-${String(n % 100).padStart(2, "0")}`;
    };

    let filtroVisita = "TODOS";
    if (["VISITADOS", "CON_SOLICITUD", "EMPADRONADOS"].includes(estadoRaw)) filtroVisita = "VISITADOS";
    if (["NO_VISITADOS", "SIN_SOLICITUD"].includes(estadoRaw)) filtroVisita = "NO_VISITADOS";

    const rows = (Array.isArray(data.rows) ? data.rows : [])
      .map((row) => {
        const visitado = String(row?.visitado_campo_sn || "N") === "S";
        return {
          ...row,
          visitado_campo_sn: visitado ? "S" : "N",
          grupo_campo: visitado ? "VISITADO_CAMPO" : "NO_VISITADO"
        };
      })
      .filter((row) => {
        if (filtroVisita === "VISITADOS") return row.visitado_campo_sn === "S";
        if (filtroVisita === "NO_VISITADOS") return row.visitado_campo_sn === "N";
        return true;
      });

    rows.sort((a, b) => {
      const rankA = a.visitado_campo_sn === "S" ? 0 : 1;
      const rankB = b.visitado_campo_sn === "S" ? 0 : 1;
      const groupFactor = ordenGrupo === "DESC" ? -1 : 1;
      if (rankA !== rankB) return groupFactor * (rankA - rankB);

      const itemFactor = ordenItems === "DESC" ? -1 : 1;
      if (organizarPor === "CALLE") {
        const calleA = String(a.nombre_calle || "").trim() || "Sin calle";
        const calleB = String(b.nombre_calle || "").trim() || "Sin calle";
        const byStreet = calleA.localeCompare(calleB, "es", { sensitivity: "base" });
        if (byStreet !== 0) return itemFactor * byStreet;
      }

      const nombreA = String(a.nombre_completo || "").trim();
      const nombreB = String(b.nombre_completo || "").trim();
      const byName = nombreA.localeCompare(nombreB, "es", { sensitivity: "base" });
      if (byName !== 0) return itemFactor * byName;

      const codA = String(a.codigo_municipal || "");
      const codB = String(b.codigo_municipal || "");
      return itemFactor * codA.localeCompare(codB, "es", { sensitivity: "base" });
    });

    const workbook = new ExcelJS.Workbook();
    const wsUsuarios = workbook.addWorksheet("Usuarios");
    wsUsuarios.columns = [
      { header: "grupo_campo", key: "grupo_campo", width: 20 },
      { header: "visitado_campo_sn", key: "visitado_campo_sn", width: 16 },
      { header: "total_solicitudes", key: "total_solicitudes", width: 16 },
      { header: "solicitudes_pendientes", key: "solicitudes_pendientes", width: 20 },
      { header: "solicitudes_aprobadas", key: "solicitudes_aprobadas", width: 20 },
      { header: "solicitudes_rechazadas", key: "solicitudes_rechazadas", width: 20 },
      { header: "ultima_solicitud", key: "ultima_solicitud", width: 24 },
      { header: "id_contribuyente", key: "id_contribuyente", width: 16 },
      { header: "codigo_municipal", key: "codigo_municipal", width: 16 },
      { header: "sec_cod", key: "sec_cod", width: 12 },
      { header: "sec_nombre", key: "sec_nombre", width: 28 },
      { header: "dni_ruc", key: "dni_ruc", width: 18 },
      { header: "nombre_completo", key: "nombre_completo", width: 36 },
      { header: "email", key: "email", width: 30 },
      { header: "telefono", key: "telefono", width: 16 },
      { header: "estado_conexion", key: "estado_conexion", width: 18 },
      { header: "estado_conexion_fuente", key: "estado_conexion_fuente", width: 18 },
      { header: "estado_conexion_verificado_sn", key: "estado_conexion_verificado_sn", width: 22 },
      { header: "estado_conexion_fecha_verificacion", key: "estado_conexion_fecha_verificacion", width: 24 },
      { header: "estado_conexion_motivo_ultimo", key: "estado_conexion_motivo_ultimo", width: 34 },
      { header: "razon_social_motivo_ultimo", key: "razon_social_motivo_ultimo", width: 30 },
      { header: "razon_social_actualizado_en", key: "razon_social_actualizado_en", width: 24 },
      { header: "id_predio", key: "id_predio", width: 12 },
      { header: "id_calle", key: "id_calle", width: 12 },
      { header: "nombre_calle", key: "nombre_calle", width: 24 },
      { header: "direccion_completa", key: "direccion_completa", width: 42 },
      { header: "direccion_alterna", key: "direccion_alterna", width: 36 },
      { header: "referencia_direccion", key: "referencia_direccion", width: 34 },
      { header: "numero_casa", key: "numero_casa", width: 14 },
      { header: "manzana", key: "manzana", width: 12 },
      { header: "lote", key: "lote", width: 12 },
      { header: "agua_sn", key: "agua_sn", width: 10 },
      { header: "desague_sn", key: "desague_sn", width: 12 },
      { header: "limpieza_sn", key: "limpieza_sn", width: 12 },
      { header: "activo_sn", key: "activo_sn", width: 10 },
      { header: "estado_servicio", key: "estado_servicio", width: 18 },
      { header: "id_tarifa", key: "id_tarifa", width: 12 },
      { header: "tipo_tarifa", key: "tipo_tarifa", width: 14 }
    ];

    const wsFin = workbook.addWorksheet("Financiero");
    wsFin.columns = [
      { header: "grupo_campo", key: "grupo_campo", width: 20 },
      { header: "visitado_campo_sn", key: "visitado_campo_sn", width: 16 },
      { header: "id_contribuyente", key: "id_contribuyente", width: 16 },
      { header: "codigo_municipal", key: "codigo_municipal", width: 16 },
      { header: "nombre_completo", key: "nombre_completo", width: 34 },
      { header: "nombre_calle", key: "nombre_calle", width: 24 },
      { header: "direccion_completa", key: "direccion_completa", width: 42 },
      { header: "agua_sn", key: "agua_sn", width: 10 },
      { header: "desague_sn", key: "desague_sn", width: 12 },
      { header: "limpieza_sn", key: "limpieza_sn", width: 12 },
      { header: "tipo_tarifa", key: "tipo_tarifa", width: 14 },
      { header: "total_recibos_emitidos", key: "total_recibos_emitidos", width: 18 },
      { header: "facturado_total", key: "facturado_total", width: 16 },
      { header: "pagado_total", key: "pagado_total", width: 16 },
      { header: "deuda_pendiente_total", key: "deuda_pendiente_total", width: 20 },
      { header: "meses_con_deuda", key: "meses_con_deuda", width: 16 },
      { header: "periodo_ultimo_recibo", key: "periodo_ultimo_recibo", width: 18 },
      { header: "cargo_agua_ultimo_mes", key: "cargo_agua_ultimo_mes", width: 18 },
      { header: "cargo_desague_ultimo_mes", key: "cargo_desague_ultimo_mes", width: 20 },
      { header: "cargo_limpieza_ultimo_mes", key: "cargo_limpieza_ultimo_mes", width: 20 },
      { header: "cargo_admin_ultimo_mes", key: "cargo_admin_ultimo_mes", width: 18 },
      { header: "total_cargo_ultimo_mes", key: "total_cargo_ultimo_mes", width: 20 },
      { header: "cargo_agua_historico", key: "cargo_agua_historico", width: 18 },
      { header: "cargo_desague_historico", key: "cargo_desague_historico", width: 20 },
      { header: "cargo_limpieza_historico", key: "cargo_limpieza_historico", width: 20 },
      { header: "cargo_admin_historico", key: "cargo_admin_historico", width: 18 }
    ];

    rows.forEach((row) => {
      wsUsuarios.addRow({
        ...row,
        ultima_solicitud: toDateText(row.ultima_solicitud),
        estado_conexion_fecha_verificacion: row.estado_conexion_fecha_verificacion ? String(row.estado_conexion_fecha_verificacion).slice(0, 10) : "",
        razon_social_actualizado_en: toDateText(row.razon_social_actualizado_en)
      });

      wsFin.addRow({
        ...row,
        periodo_ultimo_recibo: toPeriod(row.ultimo_anio, row.ultimo_mes, row.ultimo_periodo_num)
      });
    });

    const toExcelColumnName = (index) => {
      let n = Number(index || 0);
      let out = "";
      while (n > 0) {
        const rem = (n - 1) % 26;
        out = String.fromCharCode(65 + rem) + out;
        n = Math.floor((n - 1) / 26);
      }
      return out || "A";
    };

    [wsUsuarios, wsFin].forEach((ws) => {
      ws.views = [{ state: "frozen", ySplit: 1 }];
      const lastCol = toExcelColumnName(ws.columns.length);
      ws.autoFilter = { from: "A1", to: `${lastCol}1` };
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8EEF9" }
      };
      ws.eachRow((rowWs, rowNumber) => {
        if (rowNumber === 1) return;
        rowWs.eachCell((cell) => {
          cell.alignment = { vertical: "top", wrapText: true };
        });
      });
    });

    const fechaSafe = toISODate().replace(/-/g, "");
    res.setHeader("X-Total-Usuarios", String(rows.length));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=informe_usuarios_campo_${fechaSafe}.xlsx`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error("Error exportando informe empadronados:", err);
    return res.status(500).json({ error: "Error generando informe Excel de empadronados." });
  }
};

app.get("/campo/solicitudes/reporte-empadronados", exportarReporteEmpadronados);
app.get("/campo/solicitudes/reporte-empadronados.xlsx", exportarReporteEmpadronados);

app.get("/campo/seguimiento", async (req, res) => {
  try {
    const estadoRaw = String(req.query?.estado || "AMBOS").trim().toUpperCase();
    const allowedEstados = ["PENDIENTE", "APROBADO", "RECHAZADO", "TODOS", "AMBOS"];
    const estadoFiltro = allowedEstados.includes(estadoRaw) ? estadoRaw : "AMBOS";
    const limit = Math.min(2000, Math.max(10, parsePositiveInt(req.query?.limit, 400)));

    const where = [
      `s.tipo_solicitud IN ('ALTA_PREDIO', 'ALTA_PREDIO_TEMPORAL')`
    ];
    const params = [];

    if (estadoFiltro === "PENDIENTE" || estadoFiltro === "APROBADO" || estadoFiltro === "RECHAZADO") {
      params.push(estadoFiltro);
      where.push(`s.estado_solicitud = $${params.length}`);
    } else if (estadoFiltro === "AMBOS") {
      where.push(`s.estado_solicitud IN ('PENDIENTE', 'APROBADO')`);
    }

    params.push(limit);

    const sql = `
      SELECT
        s.id_solicitud,
        s.creado_en,
        s.estado_solicitud,
        s.nombre_solicitante,
        s.tipo_solicitud,
        s.nombre_verificado,
        s.dni_verificado,
        s.direccion_verificada,
        jsonb_build_object(
          'verificacion_estado', COALESCE(s.metadata->>'verificacion_estado', NULL),
          'verificacion_motivo', COALESCE(s.metadata->>'verificacion_motivo', NULL),
          'predio_temporal_sn', COALESCE(s.metadata->>'predio_temporal_sn', NULL),
          'referencia_direccion', COALESCE(s.metadata->>'referencia_direccion', NULL),
          'created_offline_at', COALESCE(s.metadata->>'created_offline_at', NULL)
        ) AS metadata,
        (COALESCE(NULLIF(s.metadata->>'foto_fachada_base64', ''), '') <> '') AS has_foto
      FROM campo_solicitudes s
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE WHEN s.estado_solicitud = 'PENDIENTE' THEN 0 ELSE 1 END,
        s.creado_en DESC
      LIMIT $${params.length}
    `;

    const data = await pool.query(sql, params);
    return res.json(data.rows);
  } catch (err) {
    console.error("Error listando seguimiento campo:", err);
    return res.status(500).json({ error: "Error listando seguimiento." });
  }
});

app.get("/campo/seguimiento/:id/foto", async (req, res) => {
  try {
    const idSolicitud = parsePositiveInt(req.params?.id, 0);
    if (!idSolicitud) return res.status(400).json({ error: "ID invalido." });

    const data = await pool.query(
      `SELECT metadata->>'foto_fachada_base64' AS foto
       FROM campo_solicitudes
       WHERE id_solicitud = $1
         AND tipo_solicitud IN ('ALTA_PREDIO', 'ALTA_PREDIO_TEMPORAL')
       LIMIT 1`,
      [idSolicitud]
    );
    if (data.rows.length === 0) return res.status(404).json({ error: "Solicitud no encontrada." });

    const foto = String(data.rows[0]?.foto || "").trim();
    if (!foto) return res.status(404).json({ error: "Sin foto." });

    return res.json({ foto_fachada_base64: foto });
  } catch (err) {
    console.error("Error obteniendo foto seguimiento:", err);
    return res.status(500).json({ error: "Error obteniendo foto." });
  }
});

app.post("/campo/solicitudes/:id/aprobar", async (req, res) => {
  const client = await pool.connect();
  try {
    const idSolicitud = parsePositiveInt(req.params?.id, 0);
    if (!idSolicitud) {
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    const motivoRevision = normalizeLimitedText(req.body?.motivo_revision, 500) || null;
    const aplicarCambiosSN = normalizeSN(req.body?.aplicar_cambios_sn, "N");

    await client.query("BEGIN");
    await ensureEstadoConexionEventosTable(client);
    await ensurePrediosDireccionAlterna(client);

    const solicitudData = await client.query(`
      SELECT *
      FROM campo_solicitudes
      WHERE id_solicitud = $1
      FOR UPDATE
    `, [idSolicitud]);
    if (solicitudData.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }

    const solicitud = solicitudData.rows[0];
    if (solicitud.estado_solicitud !== ESTADOS_SOLICITUD_CAMPO.PENDIENTE) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La solicitud ya fue procesada." });
    }

    const metadataSolicitud = solicitud.metadata && typeof solicitud.metadata === "object" ? solicitud.metadata : {};
    const tipoSolicitud = normalizeTipoSolicitudCampo(
      solicitud.tipo_solicitud || metadataSolicitud.tipo_solicitud,
      TIPOS_SOLICITUD_CAMPO.ACTUALIZACION
    );

    if (aplicarCambiosSN !== "S") {
      await client.query(`
        UPDATE campo_solicitudes
        SET estado_solicitud = $1,
            motivo_revision = $2,
            id_usuario_revision = $3,
            revisado_en = NOW(),
            actualizado_en = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb)
              || jsonb_build_object(
                'aplicacion_automatica_sn', 'N',
                'aplicacion_pendiente_sn', 'S',
                'aprobado_sin_aplicar_por', COALESCE($4::text, '')
              )
        WHERE id_solicitud = $5
      `, [
        ESTADOS_SOLICITUD_CAMPO.APROBADO,
        motivoRevision,
        req.user?.id_usuario || null,
        req.user?.username || req.user?.nombre || "SISTEMA",
        idSolicitud
      ]);

      await registrarAuditoria(
        client,
        "CAMPO_SOLICITUD_APROBADA",
        `Solicitud ${idSolicitud} (${tipoSolicitud}) aprobada sin aplicación automática.`,
        req.user?.nombre || req.user?.username || "SISTEMA"
      );

      await client.query("COMMIT");
      return res.json({
        mensaje: "Solicitud aprobada. No se aplicaron cambios automáticos.",
        id_solicitud: idSolicitud,
        tipo_solicitud: tipoSolicitud,
        aplicada_automaticamente: false
      });
    }

    if (tipoSolicitud === TIPOS_SOLICITUD_CAMPO.ALTA_PREDIO) {
      await client.query(`
        UPDATE campo_solicitudes
        SET estado_solicitud = $1,
            motivo_revision = $2,
            id_usuario_revision = $3,
            revisado_en = NOW(),
            actualizado_en = NOW()
        WHERE id_solicitud = $4
      `, [
        ESTADOS_SOLICITUD_CAMPO.APROBADO,
        motivoRevision,
        req.user?.id_usuario || null,
        idSolicitud
      ]);

      await registrarAuditoria(
        null,
        "CAMPO_SOLICITUD_APROBAR",
        `Solicitud ${idSolicitud} aprobada (ALTA_PREDIO).`,
        req.user?.nombre || req.user?.username || "SISTEMA"
      );

      await client.query("COMMIT");
      return res.json({ mensaje: "Solicitud aprobada. Pendiente de registro manual de predio.", id_solicitud: idSolicitud });
    }

    const contribuyenteBaseData = await client.query(`
      SELECT
        c.id_contribuyente,
        c.codigo_municipal,
        c.nombre_completo,
        c.dni_ruc,
        c.telefono,
        COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion
      FROM contribuyentes c
      WHERE c.id_contribuyente = $1
      FOR UPDATE OF c
    `, [solicitud.id_contribuyente]);
    if (contribuyenteBaseData.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contribuyente no encontrado para aplicar solicitud." });
    }

    const predioData = await client.query(`
      SELECT
        id_predio,
        id_calle,
        COALESCE(NULLIF(UPPER(TRIM(agua_sn)), ''), 'S') AS agua_sn,
        COALESCE(NULLIF(UPPER(TRIM(desague_sn)), ''), 'S') AS desague_sn,
        COALESCE(NULLIF(UPPER(TRIM(limpieza_sn)), ''), 'S') AS limpieza_sn,
        COALESCE(NULLIF(TRIM(direccion_alterna), ''), '') AS direccion_alterna
      FROM predios
      WHERE id_contribuyente = $1
      ORDER BY id_predio ASC
      LIMIT 1
      FOR UPDATE
    `, [solicitud.id_contribuyente]);
    if (predioData.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Predio no encontrado para aplicar solicitud." });
    }

    const actual = {
      ...contribuyenteBaseData.rows[0],
      id_predio: predioData.rows[0]?.id_predio || null,
      id_calle: predioData.rows[0]?.id_calle || null,
      agua_sn: predioData.rows[0]?.agua_sn || "S",
      desague_sn: predioData.rows[0]?.desague_sn || "S",
      limpieza_sn: predioData.rows[0]?.limpieza_sn || "S",
      direccion_alterna: predioData.rows[0]?.direccion_alterna || ""
    };
    const estadoActual = normalizeEstadoConexion(actual.estado_conexion);
    const estadoDestino = normalizeEstadoConexion(solicitud.estado_conexion_nuevo || estadoActual);
    const aguaActual = normalizeSN(actual.agua_sn, "S");
    const desagueActual = normalizeSN(actual.desague_sn, "S");
    const limpiezaActual = normalizeSN(actual.limpieza_sn, "S");
    const aguaDestino = normalizeSN(metadataSolicitud.servicio_agua_nuevo, aguaActual);
    const desagueDestino = normalizeSN(metadataSolicitud.servicio_desague_nuevo, desagueActual);
    const limpiezaDestino = normalizeSN(metadataSolicitud.servicio_limpieza_nuevo, limpiezaActual);
    const predioEstado = estadoConexionToPredio(estadoDestino);
    const motivoCampo = [solicitud.observacion_campo || "", motivoRevision || ""]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 1200);
    const fechaVerificacion = toISODate();

    await client.query(
      `UPDATE contribuyentes
       SET nombre_completo = $1,
           dni_ruc = $2,
           telefono = $3,
           estado_conexion = $4,
           estado_conexion_fuente = 'CAMPO',
           estado_conexion_verificado_sn = 'S',
           estado_conexion_fecha_verificacion = $5,
           estado_conexion_motivo_ultimo = $6
       WHERE id_contribuyente = $7`,
      [
        normalizeLimitedText(solicitud.nombre_verificado || actual.nombre_completo, 200),
        normalizeLimitedText(solicitud.dni_verificado || actual.dni_ruc, 30),
        normalizeLimitedText(solicitud.telefono_verificado || actual.telefono, 40),
        estadoDestino,
        fechaVerificacion,
        motivoCampo || null,
        actual.id_contribuyente
      ]
    );

    const direccionNueva = normalizeLimitedText(solicitud.direccion_verificada, 250);
    const idPredioBase = parsePositiveInt(actual.id_predio, 0);
    const idCalleBase = parsePositiveInt(actual.id_calle, 0) || null;
    let idDireccionAlterna = null;
    if (tipoSolicitud === TIPOS_SOLICITUD_CAMPO.ALTA_DIRECCION_ALTERNA) {
      if (direccionNueva) {
        const partesDireccion = extraerCalleYNumero(direccionNueva);
        const idCalleAlterna = await resolveCalleIdByNombre(client, partesDireccion?.calle, idCalleBase);
        const payloadDireccion = {
          tipo_solicitud: tipoSolicitud,
          id_solicitud: idSolicitud,
          estado_nuevo: estadoDestino
        };
        try {
          const nuevaDireccion = await client.query(
            `INSERT INTO predios_direcciones_alternas (
              id_contribuyente, id_predio_base, id_calle, numero_casa,
              direccion_texto, servicio_agua_sn, servicio_desague_sn,
              servicio_limpieza_sn, estado_conexion, fuente, id_solicitud, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'APP_CAMPO', $10, $11::jsonb)
            RETURNING id_direccion_alterna`,
            [
              actual.id_contribuyente,
              idPredioBase || null,
              idCalleAlterna,
              normalizeLimitedText(partesDireccion?.numero, 30) || null,
              direccionNueva,
              aguaDestino,
              desagueDestino,
              limpiezaDestino,
              estadoDestino,
              idSolicitud,
              JSON.stringify(payloadDireccion)
            ]
          );
          idDireccionAlterna = Number(nuevaDireccion.rows?.[0]?.id_direccion_alterna || 0) || null;
        } catch (errInsertDireccion) {
          if (errInsertDireccion?.code === "23505") {
            const existente = await client.query(
              `SELECT id_direccion_alterna
               FROM predios_direcciones_alternas
               WHERE id_contribuyente = $1
                 AND UPPER(TRIM(direccion_texto)) = UPPER(TRIM($2))
                 AND activo_sn = 'S'
               ORDER BY id_direccion_alterna ASC
               LIMIT 1`,
              [actual.id_contribuyente, direccionNueva]
            );
            idDireccionAlterna = Number(existente.rows?.[0]?.id_direccion_alterna || 0) || null;
          } else {
            throw errInsertDireccion;
          }
        }
      }
      await client.query(
        `UPDATE predios
         SET activo_sn = $1,
             estado_servicio = $2,
             direccion_alterna = COALESCE(NULLIF($3, ''), direccion_alterna),
             agua_sn = $4,
             desague_sn = $5,
             limpieza_sn = $6
         WHERE id_predio = $7`,
        [
          predioEstado.activo_sn,
          predioEstado.estado_servicio,
          direccionNueva,
          aguaDestino,
          desagueDestino,
          limpiezaDestino,
          idPredioBase
        ]
      );
    } else {
      await client.query(
        `UPDATE predios
         SET activo_sn = $1,
             estado_servicio = $2,
             referencia_direccion = COALESCE(NULLIF($3, ''), referencia_direccion),
             agua_sn = $4,
             desague_sn = $5,
             limpieza_sn = $6
         WHERE id_predio = $7`,
        [
          predioEstado.activo_sn,
          predioEstado.estado_servicio,
          direccionNueva,
          aguaDestino,
          desagueDestino,
          limpiezaDestino,
          idPredioBase
        ]
      );
    }

    if (estadoActual !== estadoDestino) {
      await client.query(
        `INSERT INTO estado_conexion_eventos (
          id_usuario, id_contribuyente, estado_anterior, estado_nuevo, motivo
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          req.user?.id_usuario || null,
          actual.id_contribuyente,
          estadoActual,
          estadoDestino,
          motivoCampo || "Cambio aprobado desde app de campo"
        ]
      );
    }

    const serviciosCambiaron =
      aguaActual !== aguaDestino ||
      desagueActual !== desagueDestino ||
      limpiezaActual !== limpiezaDestino;
    let recibosRecalculados = 0;
    if (serviciosCambiaron || estadoActual !== estadoDestino) {
      const recalc = await recalcularRecibosFuturosPorServicios(client, actual.id_contribuyente);
      recibosRecalculados = Number(recalc?.actualizados || 0);
    }

    await client.query(
      `UPDATE campo_solicitudes
       SET estado_solicitud = $1,
           motivo_revision = $2,
           id_usuario_revision = $3,
           revisado_en = NOW(),
           actualizado_en = NOW(),
           metadata = CASE
             WHEN $5::bigint IS NULL THEN metadata
             ELSE COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('id_direccion_alterna', $5::bigint)
           END
       WHERE id_solicitud = $4`,
      [
        ESTADOS_SOLICITUD_CAMPO.APROBADO,
        motivoRevision,
        req.user?.id_usuario || null,
        idSolicitud,
        idDireccionAlterna
      ]
    );

    await registrarAuditoria(
      client,
      "CAMPO_SOLICITUD_APROBADA",
      `Solicitud ${idSolicitud} (${tipoSolicitud}) aplicada a contribuyente ${actual.codigo_municipal || actual.id_contribuyente}. Estado: ${estadoActual} -> ${estadoDestino}. Recibos futuros recalculados: ${recibosRecalculados}.`,
      req.user?.nombre || req.user?.username || "SISTEMA"
    );

    await client.query("COMMIT");
    invalidateContribuyentesCache();

    return res.json({
      mensaje: "Solicitud aprobada y aplicada.",
      id_solicitud: idSolicitud,
      id_contribuyente: actual.id_contribuyente,
      tipo_solicitud: tipoSolicitud,
      estado_anterior: estadoActual,
      estado_nuevo: estadoDestino,
      recibos_recalculados: recibosRecalculados,
      id_direccion_alterna: idDireccionAlterna
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error aprobando solicitud de campo:", err);
    return res.status(500).json({ error: "Error aprobando solicitud de campo." });
  } finally {
    client.release();
  }
});

app.post("/campo/solicitudes/:id/rechazar", async (req, res) => {
  const client = await pool.connect();
  try {
    const idSolicitud = parsePositiveInt(req.params?.id, 0);
    if (!idSolicitud) {
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }
    const motivoRevision = normalizeLimitedText(req.body?.motivo_revision, 500);
    if (!motivoRevision) {
      return res.status(400).json({ error: "Debe indicar motivo de rechazo." });
    }

    await client.query("BEGIN");
    const solicitudData = await client.query(`
      SELECT id_solicitud, estado_solicitud, id_contribuyente, codigo_municipal
      FROM campo_solicitudes
      WHERE id_solicitud = $1
      FOR UPDATE
    `, [idSolicitud]);
    if (solicitudData.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Solicitud no encontrada." });
    }
    const solicitud = solicitudData.rows[0];
    if (solicitud.estado_solicitud !== ESTADOS_SOLICITUD_CAMPO.PENDIENTE) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La solicitud ya fue procesada." });
    }

    await client.query(
      `UPDATE campo_solicitudes
       SET estado_solicitud = $1,
           motivo_revision = $2,
           id_usuario_revision = $3,
           revisado_en = NOW(),
           actualizado_en = NOW()
       WHERE id_solicitud = $4`,
      [
        ESTADOS_SOLICITUD_CAMPO.RECHAZADO,
        motivoRevision,
        req.user?.id_usuario || null,
        idSolicitud
      ]
    );

    await registrarAuditoria(
      client,
      "CAMPO_SOLICITUD_RECHAZADA",
      `Solicitud ${idSolicitud} rechazada. Contribuyente ${solicitud.codigo_municipal || solicitud.id_contribuyente}. Motivo: ${motivoRevision}`,
      req.user?.nombre || req.user?.username || "SISTEMA"
    );

    await client.query("COMMIT");
    return res.json({ mensaje: "Solicitud rechazada.", id_solicitud: idSolicitud });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error rechazando solicitud de campo:", err);
    return res.status(500).json({ error: "Error rechazando solicitud de campo." });
  } finally {
    client.release();
  }
});

// ==========================================
// RUTAS DE GESTIÓN DE CALLES
// ==========================================
app.get("/calles", async (req, res) => {
  try {
    const todas = await pool.query("SELECT * FROM calles ORDER BY nombre ASC");
    res.json(todas.rows);
  } catch (err) { res.status(500).send("Error del servidor"); }
});

app.get("/sectores", async (req, res) => {
  try {
    const data = await pool.query(`
      SELECT
        MIN(NULLIF(TRIM(sec_cod), '')) AS sec_cod,
        TRIM(sec_nombre) AS sec_nombre
      FROM contribuyentes
      WHERE COALESCE(TRIM(sec_nombre), '') <> ''
      GROUP BY TRIM(sec_nombre)
      ORDER BY TRIM(sec_nombre) ASC
    `);
    res.json(data.rows);
  } catch (err) {
    res.status(500).send("Error del servidor");
  }
});

app.post("/calles", async (req, res) => {
  try {
    const { nombre, zona_barrio } = req.body;
    const nueva = await pool.query("INSERT INTO calles (nombre, zona_barrio) VALUES($1, $2) RETURNING *", [nombre, zona_barrio]);
    res.json(nueva.rows[0]);
  } catch (err) { res.status(500).send("Error al crear calle"); }
});

app.put("/calles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, zona_barrio } = req.body;
    await pool.query("UPDATE calles SET nombre = $1, zona_barrio = $2 WHERE id_calle = $3", [nombre, zona_barrio, id]);
    res.json({ mensaje: "Calle actualizada" });
  } catch (err) { res.status(500).send("Error al actualizar calle"); }
});

app.delete("/calles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM calles WHERE id_calle = $1", [id]);
    res.json({ mensaje: "Calle eliminada" });
  } catch (err) {
    res.status(400).json({ error: "No se puede eliminar: Hay usuarios registrados en esta calle." });
  }
});

// ==========================================
// RUTAS DE CONTRIBUYENTES (CONCATENACIÓN DIRECCIÓN)
// ==========================================
const REPORTES_ESTADO_CONEXION_ORDEN = new Set([
  "direccion",
  "monto",
  "deuda",
  "meses",
  "nombre",
  "codigo",
  "estado"
]);

const normalizeReporteEstadoConexionMode = (value, fallback = "actual") => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "mensual") return "mensual";
  return fallback;
};

const normalizeReporteEstadoConexionFilter = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw || raw === "TODOS" || raw === "ALL") return "TODOS";
  return normalizeEstadoConexion(raw);
};

const normalizeReporteOrdenCampo = (value, fallback = "direccion") => {
  const raw = String(value || "").trim().toLowerCase();
  return REPORTES_ESTADO_CONEXION_ORDEN.has(raw) ? raw : fallback;
};

const normalizeReporteOrdenDireccion = (value, fallback = "asc") => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "desc") return "desc";
  return fallback;
};

const getLastDayOfMonth = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

const parsePeriodoReporteConexion = (query = {}) => {
  const tipoRaw = String(query?.tipo_periodo || "").trim().toLowerCase();
  const tipo = ["dia", "mes", "anio", "rango", "todo"].includes(tipoRaw) ? tipoRaw : "mes";
  const hoy = normalizeDateOnly(toISODate()) || toISODate();

  if (tipo === "dia") {
    const fecha = normalizeDateOnly(query?.fecha) || hoy;
    const [anio, mes] = fecha.split("-").map((v) => Number(v));
    return {
      tipo,
      fecha_desde: fecha,
      fecha_hasta: fecha,
      anio_corte: anio,
      mes_corte: mes,
      periodo: fecha
    };
  }

  if (tipo === "anio") {
    const anio = parsePositiveInt(query?.anio, getCurrentYear());
    const anioSafe = anio >= 1900 && anio <= 9999 ? anio : getCurrentYear();
    const fechaDesde = `${String(anioSafe).padStart(4, "0")}-01-01`;
    const fechaHasta = `${String(anioSafe).padStart(4, "0")}-12-31`;
    return {
      tipo,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      anio_corte: anioSafe,
      mes_corte: 12,
      periodo: String(anioSafe)
    };
  }

  if (tipo === "rango") {
    let fechaDesde = normalizeDateOnly(query?.desde);
    let fechaHasta = normalizeDateOnly(query?.hasta);
    if (!fechaDesde && !fechaHasta) {
      fechaHasta = hoy;
      fechaDesde = hoy;
    } else if (!fechaDesde) {
      fechaDesde = fechaHasta;
    } else if (!fechaHasta) {
      fechaHasta = fechaDesde;
    }
    if (fechaDesde > fechaHasta) {
      const tmp = fechaDesde;
      fechaDesde = fechaHasta;
      fechaHasta = tmp;
    }
    const [anio, mes] = String(fechaHasta || hoy).split("-").map((v) => Number(v));
    return {
      tipo,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      anio_corte: anio,
      mes_corte: mes,
      periodo: `${fechaDesde}..${fechaHasta}`
    };
  }

  if (tipo === "todo") {
    const anio = getCurrentYear();
    const mes = getCurrentMonth();
    return {
      tipo,
      fecha_desde: "",
      fecha_hasta: hoy,
      anio_corte: anio,
      mes_corte: mes,
      periodo: "TODO"
    };
  }

  const periodoRaw = String(query?.periodo || "").trim();
  if (/^\d{4}-\d{2}$/.test(periodoRaw)) {
    const [anio, mes] = periodoRaw.split("-").map((v) => Number(v));
    if (Number.isInteger(anio) && anio >= 1900 && anio <= 9999 && Number.isInteger(mes) && mes >= 1 && mes <= 12) {
      const lastDay = getLastDayOfMonth(anio, mes);
      return {
        tipo: "mes",
        fecha_desde: `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-01`,
        fecha_hasta: `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
        anio_corte: anio,
        mes_corte: mes,
        periodo: `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}`
      };
    }
  }
  const anio = parsePositiveInt(query?.anio, getCurrentYear());
  const mes = parsePositiveInt(query?.mes, getCurrentMonth());
  const anioSafe = anio >= 1900 && anio <= 9999 ? anio : getCurrentYear();
  const mesSafe = mes >= 1 && mes <= 12 ? mes : getCurrentMonth();
  const lastDay = getLastDayOfMonth(anioSafe, mesSafe);
  return {
    tipo: "mes",
    fecha_desde: `${String(anioSafe).padStart(4, "0")}-${String(mesSafe).padStart(2, "0")}-01`,
    fecha_hasta: `${String(anioSafe).padStart(4, "0")}-${String(mesSafe).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    anio_corte: anioSafe,
    mes_corte: mesSafe,
    periodo: `${String(anioSafe).padStart(4, "0")}-${String(mesSafe).padStart(2, "0")}`
  };
};

const parseIdsContribuyentesFromQuery = (rawValue) => {
  if (!rawValue) return [];
  const parts = String(rawValue || "")
    .split(",")
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0);
  return Array.from(new Set(parts)).slice(0, 5000);
};

const sortReporteEstadoConexionRows = (rows = [], ordenCampo = "direccion", ordenDireccion = "asc") => {
  const direction = ordenDireccion === "desc" ? -1 : 1;
  const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
  const pickValue = (row) => {
    switch (ordenCampo) {
      case "codigo":
        return String(row?.codigo_municipal || "");
      case "nombre":
        return String(row?.nombre_completo || "");
      case "estado":
        return String(row?.estado_conexion || "");
      case "monto":
        return Number(row?.monto_mensual || row?.monto_referencia || 0);
      case "deuda":
        return Number(row?.deuda_total || 0);
      case "meses":
        return Number(row?.meses_deuda || 0);
      case "direccion":
      default:
        return String(row?.direccion_completa || "");
    }
  };
  return rows.slice().sort((a, b) => {
    const va = pickValue(a);
    const vb = pickValue(b);
    if (typeof va === "number" || typeof vb === "number") {
      const da = Number(va || 0);
      const db = Number(vb || 0);
      if (da !== db) return (da - db) * direction;
      return collator.compare(String(a?.direccion_completa || ""), String(b?.direccion_completa || "")) * direction;
    }
    const cmp = collator.compare(String(va || ""), String(vb || ""));
    if (cmp !== 0) return cmp * direction;
    return collator.compare(String(a?.direccion_completa || ""), String(b?.direccion_completa || "")) * direction;
  });
};

const obtenerReporteEstadoConexionRows = async ({
  estadoFiltro = "TODOS",
  periodo = parsePeriodoReporteConexion({ tipo_periodo: "mes" }),
  idsContribuyentes = []
} = {}) => {
  const anioCorte = Number(periodo?.anio_corte || getCurrentYear());
  const mesCorte = Number(periodo?.mes_corte || getCurrentMonth());

  const where = [];
  const params = [anioCorte, mesCorte];
  const ids = Array.from(new Set((Array.isArray(idsContribuyentes) ? idsContribuyentes : [])
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0))).slice(0, 5000);
  if (ids.length > 0) {
    params.push(ids);
    where.push(`c.id_contribuyente = ANY($${params.length}::int[])`);
  }
  if (estadoFiltro !== "TODOS") {
    params.push(estadoFiltro);
    where.push(`COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') = $${params.length}`);
  }

  const query = `
    WITH recibos_objetivo AS (
      SELECT r.id_recibo, r.id_predio, r.total_pagar
      FROM recibos r
      WHERE (r.anio, r.mes) <= ($1::int, $2::int)
    ),
    pagos_por_recibo AS (
      SELECT p.id_recibo, SUM(p.monto_pagado) AS total_pagado
      FROM pagos p
      JOIN recibos_objetivo ro ON ro.id_recibo = p.id_recibo
      GROUP BY p.id_recibo
    ),
    resumen_predio AS (
      SELECT
        ro.id_predio,
        SUM(GREATEST(ro.total_pagar - COALESCE(pp.total_pagado, 0), 0)) AS deuda_total,
        SUM(COALESCE(pp.total_pagado, 0)) AS abono_total,
        COUNT(*) FILTER (WHERE (ro.total_pagar - COALESCE(pp.total_pagado, 0)) > 0) AS meses_deuda_total
      FROM recibos_objetivo ro
      LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
      GROUP BY ro.id_predio
    ),
    resumen_contribuyente AS (
      SELECT
        p.id_contribuyente,
        SUM(COALESCE(rp.deuda_total, 0)) AS deuda_total,
        SUM(COALESCE(rp.abono_total, 0)) AS abono_total,
        SUM(COALESCE(rp.meses_deuda_total, 0)) AS meses_deuda
      FROM predios p
      LEFT JOIN resumen_predio rp ON rp.id_predio = p.id_predio
      GROUP BY p.id_contribuyente
    ),
    tarifa_contribuyente AS (
      SELECT
        p.id_contribuyente,
        SUM(
          (CASE WHEN ${sqlSnEsSi("p.activo_sn", "S")} AND ${sqlSnEsSi("p.agua_sn", "S")} THEN COALESCE(p.tarifa_agua, 0) ELSE 0 END)
          + (CASE WHEN ${sqlSnEsSi("p.activo_sn", "S")} AND ${sqlSnEsSi("p.desague_sn", "S")} THEN COALESCE(p.tarifa_desague, 0) ELSE 0 END)
          + (CASE WHEN ${sqlSnEsSi("p.activo_sn", "S")} AND ${sqlSnEsSi("p.limpieza_sn", "S")} THEN COALESCE(p.tarifa_limpieza, 0) ELSE 0 END)
          + (CASE WHEN ${sqlSnEsSi("p.activo_sn", "S")} THEN COALESCE(p.tarifa_admin, 0) + COALESCE(p.tarifa_extra, 0) ELSE 0 END)
        ) AS monto_mensual_base
      FROM predios p
      GROUP BY p.id_contribuyente
    ),
    direccion_principal AS (
      SELECT x.id_contribuyente, x.direccion_completa
      FROM (
        SELECT
          p.id_contribuyente,
          ${buildDireccionSql("ca", "p")} AS direccion_completa,
          ROW_NUMBER() OVER (PARTITION BY p.id_contribuyente ORDER BY p.id_predio ASC) AS rn
        FROM predios p
        LEFT JOIN calles ca ON ca.id_calle = p.id_calle
      ) x
      WHERE x.rn = 1
    )
    SELECT
      c.id_contribuyente,
      c.codigo_municipal,
      c.nombre_completo,
      COALESCE(NULLIF(TRIM(dp.direccion_completa), ''), '-') AS direccion_completa,
      COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
      COALESCE(tc.monto_mensual_base, 0) AS monto_mensual_base,
      COALESCE(rc.meses_deuda, 0) AS meses_deuda,
      COALESCE(rc.deuda_total, 0) AS deuda_total,
      COALESCE(rc.abono_total, 0) AS abono_total
    FROM contribuyentes c
    LEFT JOIN direccion_principal dp ON dp.id_contribuyente = c.id_contribuyente
    LEFT JOIN resumen_contribuyente rc ON rc.id_contribuyente = c.id_contribuyente
    LEFT JOIN tarifa_contribuyente tc ON tc.id_contribuyente = c.id_contribuyente
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
  `;

  const rs = await pool.query(query, params);
  return rs.rows.map((row) => {
    const montoMensual = roundMonto2(parseMonto(row.monto_mensual_base, 0));
    return {
      id_contribuyente: Number(row.id_contribuyente || 0),
      codigo_municipal: row.codigo_municipal || "",
      nombre_completo: row.nombre_completo || "",
      direccion_completa: row.direccion_completa || "-",
      estado_conexion: normalizeEstadoConexion(row.estado_conexion),
      monto_mensual: montoMensual,
      monto_periodo: 0,
      monto_referencia: montoMensual,
      recibos_emitidos_mes: 0,
      meses_deuda: Number(row.meses_deuda || 0),
      deuda_total: roundMonto2(parseMonto(row.deuda_total, 0)),
      abono_total: roundMonto2(parseMonto(row.abono_total, 0))
    };
  });
};

const obtenerReporteEstadoConexionDetalleMensualRows = async ({
  estadoFiltro = "TODOS",
  periodo = parsePeriodoReporteConexion({ tipo_periodo: "todo" }),
  idsContribuyentes = []
} = {}) => {
  const anioCorte = Number(periodo?.anio_corte || getCurrentYear());
  const mesCorte = Number(periodo?.mes_corte || getCurrentMonth());
  const fechaHasta = normalizeDateOnly(periodo?.fecha_hasta) || toISODate();

  const where = [];
  const params = [anioCorte, mesCorte, fechaHasta];
  const ids = Array.from(new Set((Array.isArray(idsContribuyentes) ? idsContribuyentes : [])
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0))).slice(0, 5000);
  if (ids.length > 0) {
    params.push(ids);
    where.push(`c.id_contribuyente = ANY($${params.length}::int[])`);
  }
  if (estadoFiltro !== "TODOS") {
    params.push(estadoFiltro);
    where.push(`COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') = $${params.length}`);
  }
  where.push("((r.anio < $1) OR (r.anio = $1 AND r.mes <= $2))");

  const query = `
    WITH pagos_por_recibo AS (
      SELECT p.id_recibo, SUM(p.monto_pagado) AS total_pagado
      FROM pagos p
      WHERE DATE(p.fecha_pago) <= $3::date
      GROUP BY p.id_recibo
    ),
    direccion_principal AS (
      SELECT x.id_contribuyente, x.direccion_completa
      FROM (
        SELECT
          p.id_contribuyente,
          ${buildDireccionSql("ca", "p")} AS direccion_completa,
          ROW_NUMBER() OVER (PARTITION BY p.id_contribuyente ORDER BY p.id_predio ASC) AS rn
        FROM predios p
        LEFT JOIN calles ca ON ca.id_calle = p.id_calle
      ) x
      WHERE x.rn = 1
    )
    SELECT
      c.id_contribuyente,
      c.codigo_municipal,
      c.nombre_completo,
      COALESCE(NULLIF(TRIM(dp.direccion_completa), ''), '-') AS direccion_completa,
      COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
      r.anio,
      r.mes,
      SUM(COALESCE(r.subtotal_agua, 0)) AS subtotal_agua,
      SUM(COALESCE(r.subtotal_desague, 0)) AS subtotal_desague,
      SUM(COALESCE(r.subtotal_limpieza, 0)) AS subtotal_limpieza,
      SUM(COALESCE(r.subtotal_admin, 0)) AS subtotal_admin,
      SUM(COALESCE(r.total_pagar, 0)) AS total_mes,
      SUM(COALESCE(pp.total_pagado, 0)) AS abono_mes,
      SUM(
        CASE
          WHEN (r.anio > $1) OR (r.anio = $1 AND r.mes > $2) THEN 0
          ELSE GREATEST(r.total_pagar - COALESCE(pp.total_pagado, 0), 0)
        END
      ) AS deuda_mes
    FROM contribuyentes c
    JOIN predios p ON p.id_contribuyente = c.id_contribuyente
    JOIN recibos r ON r.id_predio = p.id_predio
    LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = r.id_recibo
    LEFT JOIN direccion_principal dp ON dp.id_contribuyente = c.id_contribuyente
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY
      c.id_contribuyente,
      c.codigo_municipal,
      c.nombre_completo,
      dp.direccion_completa,
      COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION'),
      r.anio,
      r.mes
    ORDER BY c.nombre_completo ASC, r.anio ASC, r.mes ASC
  `;

  const rs = await pool.query(query, params);
  return rs.rows.map((row) => {
    const totalMes = roundMonto2(parseMonto(row.total_mes, 0));
    const abonoMes = roundMonto2(parseMonto(row.abono_mes, 0));
    const deudaMes = roundMonto2(parseMonto(row.deuda_mes, 0));
    let estadoRecibo = "NO_EXIGIBLE";
    if (abonoMes >= totalMes && totalMes > 0) estadoRecibo = "PAGADO";
    else if (abonoMes > 0) estadoRecibo = "PARCIAL";
    else if (deudaMes > 0) estadoRecibo = "PENDIENTE";

    return {
      id_contribuyente: Number(row.id_contribuyente || 0),
      codigo_municipal: row.codigo_municipal || "",
      nombre_completo: row.nombre_completo || "",
      direccion_completa: row.direccion_completa || "-",
      estado_conexion: normalizeEstadoConexion(row.estado_conexion),
      anio: Number(row.anio || 0),
      mes: Number(row.mes || 0),
      subtotal_agua: roundMonto2(parseMonto(row.subtotal_agua, 0)),
      subtotal_desague: roundMonto2(parseMonto(row.subtotal_desague, 0)),
      subtotal_limpieza: roundMonto2(parseMonto(row.subtotal_limpieza, 0)),
      subtotal_admin: roundMonto2(parseMonto(row.subtotal_admin, 0)),
      total_mes: totalMes,
      deuda_mes: deudaMes,
      abono_mes: abonoMes,
      estado_recibo: estadoRecibo
    };
  });
};

app.get("/contribuyentes/reporte-estado-conexion", async (req, res) => {
  try {
    const estado = normalizeReporteEstadoConexionFilter(req.query?.estado);
    const periodo = parsePeriodoReporteConexion(req.query);
    const idsContribuyentes = parseIdsContribuyentesFromQuery(req.query?.ids);
    const ordenarPor = normalizeReporteOrdenCampo(req.query?.ordenar_por, "direccion");
    const orden = normalizeReporteOrdenDireccion(req.query?.orden, "asc");
    const rows = await obtenerReporteEstadoConexionRows({ estadoFiltro: estado, periodo, idsContribuyentes });
    const rowsOrdenadas = sortReporteEstadoConexionRows(rows, ordenarPor, orden);
    return res.json({
      meta: {
        estado,
        tipo_periodo: periodo.tipo,
        periodo: periodo.periodo,
        fecha_desde: periodo.fecha_desde,
        fecha_hasta: periodo.fecha_hasta,
        ordenar_por: ordenarPor,
        orden
      },
      rows: rowsOrdenadas
    });
  } catch (err) {
    console.error("Error reporte estado conexion:", err);
    return res.status(500).json({ error: "Error generando reporte de estado de conexion." });
  }
});

app.get("/contribuyentes/reporte-estado-conexion.xlsx", async (req, res) => {
  try {
    const estado = normalizeReporteEstadoConexionFilter(req.query?.estado);
    const periodo = parsePeriodoReporteConexion(req.query);
    const idsContribuyentes = parseIdsContribuyentesFromQuery(req.query?.ids);
    const ordenarPor = normalizeReporteOrdenCampo(req.query?.ordenar_por, "direccion");
    const orden = normalizeReporteOrdenDireccion(req.query?.orden, "asc");
    const rows = await obtenerReporteEstadoConexionRows({ estadoFiltro: estado, periodo, idsContribuyentes });
    const rowsOrdenadas = sortReporteEstadoConexionRows(rows, ordenarPor, orden);

    const wb = new ExcelJS.Workbook();
    const wsResumen = wb.addWorksheet("Resumen");
    wsResumen.columns = [
      { header: "CAMPO", key: "campo", width: 28 },
      { header: "VALOR", key: "valor", width: 42 }
    ];
    wsResumen.getRow(1).font = { bold: true };
    wsResumen.addRow({ campo: "Estado objetivo", valor: estado === "TODOS" ? "Todos" : estado });
    wsResumen.addRow({ campo: "Tipo periodo", valor: periodo.tipo || "mes" });
    wsResumen.addRow({ campo: "Desde", valor: periodo.fecha_desde || "" });
    wsResumen.addRow({ campo: "Hasta", valor: periodo.fecha_hasta || "" });
    wsResumen.addRow({ campo: "Total registros", valor: Number(rowsOrdenadas.length || 0) });
    wsResumen.addRow({
      campo: "Total deuda",
      valor: Number(rowsOrdenadas.reduce((acc, item) => acc + parseMonto(item?.deuda_total, 0), 0).toFixed(2))
    });
    wsResumen.addRow({
      campo: "Total abono",
      valor: Number(rowsOrdenadas.reduce((acc, item) => acc + parseMonto(item?.abono_total, 0), 0).toFixed(2))
    });

    const ws = wb.addWorksheet(periodo.tipo === "todo" ? "Contribuyentes" : "Detalle");
    ws.columns = [
      { header: "CODIGO", key: "codigo_municipal", width: 14 },
      { header: "CONTRIBUYENTE", key: "nombre_completo", width: 42 },
      { header: "DIRECCION", key: "direccion_completa", width: 44 },
      { header: "ESTADO", key: "estado_conexion", width: 18 },
      { header: "Meses Deuda", key: "meses_deuda", width: 14 },
      { header: "Deuda Total", key: "deuda_total", width: 16 },
      { header: "Abono Total", key: "abono_total", width: 16 }
    ];
    ws.getRow(1).font = { bold: true };
    rowsOrdenadas.forEach((row) => {
      ws.addRow({
        codigo_municipal: row.codigo_municipal,
        nombre_completo: row.nombre_completo,
        direccion_completa: row.direccion_completa,
        estado_conexion: row.estado_conexion,
        meses_deuda: row.meses_deuda,
        deuda_total: row.deuda_total,
        abono_total: row.abono_total
      });
    });
    const totalMeses = rowsOrdenadas.reduce((acc, item) => acc + Number(item?.meses_deuda || 0), 0);
    const totalDeuda = roundMonto2(rowsOrdenadas.reduce((acc, item) => acc + parseMonto(item?.deuda_total, 0), 0));
    const totalAbono = roundMonto2(rowsOrdenadas.reduce((acc, item) => acc + parseMonto(item?.abono_total, 0), 0));
    const totalRow = ws.addRow({
      codigo_municipal: "",
      nombre_completo: "TOTAL",
      direccion_completa: "",
      estado_conexion: "",
      meses_deuda: totalMeses,
      deuda_total: totalDeuda,
      abono_total: totalAbono
    });
    totalRow.font = { bold: true };
    for (let i = 2; i <= ws.rowCount; i += 1) {
      ws.getCell(`F${i}`).numFmt = "#,##0.00";
      ws.getCell(`G${i}`).numFmt = "#,##0.00";
      ws.getCell(`H${i}`).numFmt = "#,##0.00";
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];

    if (periodo.tipo === "todo") {
      const monthLabels = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
      const detalleRows = await obtenerReporteEstadoConexionDetalleMensualRows({
        estadoFiltro: estado,
        periodo,
        idsContribuyentes
      });
      const wsDetalle = wb.addWorksheet("Detalle");
      wsDetalle.columns = [
        { header: "CODIGO", key: "codigo_municipal", width: 14 },
        { header: "CONTRIBUYENTE", key: "nombre_completo", width: 34 },
        { header: "DIRECCION", key: "direccion_completa", width: 36 },
        { header: "ESTADO", key: "estado_conexion", width: 16 },
        { header: "AÑO", key: "anio", width: 10 },
        { header: "MES", key: "mes_label", width: 12 },
        { header: "AGUA", key: "subtotal_agua", width: 12 },
        { header: "DESAGUE", key: "subtotal_desague", width: 12 },
        { header: "LIMPIEZA", key: "subtotal_limpieza", width: 12 },
        { header: "ADMIN", key: "subtotal_admin", width: 12 },
        { header: "TOTAL MES", key: "total_mes", width: 14 },
        { header: "DEUDA MES", key: "deuda_mes", width: 14 },
        { header: "ABONO MES", key: "abono_mes", width: 14 },
        { header: "ESTADO RECIBO", key: "estado_recibo", width: 16 }
      ];
      wsDetalle.getRow(1).font = { bold: true };

      let totalAgua = 0;
      let totalDesague = 0;
      let totalLimpieza = 0;
      let totalAdmin = 0;
      let totalMes = 0;
      let totalDeudaMes = 0;
      let totalAbonoMes = 0;

      detalleRows.forEach((row) => {
        totalAgua += parseMonto(row.subtotal_agua, 0);
        totalDesague += parseMonto(row.subtotal_desague, 0);
        totalLimpieza += parseMonto(row.subtotal_limpieza, 0);
        totalAdmin += parseMonto(row.subtotal_admin, 0);
        totalMes += parseMonto(row.total_mes, 0);
        totalDeudaMes += parseMonto(row.deuda_mes, 0);
        totalAbonoMes += parseMonto(row.abono_mes, 0);
        wsDetalle.addRow({
          codigo_municipal: row.codigo_municipal,
          nombre_completo: row.nombre_completo,
          direccion_completa: row.direccion_completa,
          estado_conexion: row.estado_conexion,
          anio: row.anio,
          mes_label: monthLabels[Number(row.mes || 0)] || String(row.mes || ""),
          subtotal_agua: row.subtotal_agua,
          subtotal_desague: row.subtotal_desague,
          subtotal_limpieza: row.subtotal_limpieza,
          subtotal_admin: row.subtotal_admin,
          total_mes: row.total_mes,
          deuda_mes: row.deuda_mes,
          abono_mes: row.abono_mes,
          estado_recibo: row.estado_recibo
        });
      });

      const totalDetalleRow = wsDetalle.addRow({
        codigo_municipal: "",
        nombre_completo: "TOTAL",
        direccion_completa: "",
        estado_conexion: "",
        anio: "",
        mes_label: "",
        subtotal_agua: roundMonto2(totalAgua),
        subtotal_desague: roundMonto2(totalDesague),
        subtotal_limpieza: roundMonto2(totalLimpieza),
        subtotal_admin: roundMonto2(totalAdmin),
        total_mes: roundMonto2(totalMes),
        deuda_mes: roundMonto2(totalDeudaMes),
        abono_mes: roundMonto2(totalAbonoMes),
        estado_recibo: ""
      });
      totalDetalleRow.font = { bold: true };
      for (let i = 2; i <= wsDetalle.rowCount; i += 1) {
        for (const col of ["G", "H", "I", "J", "K", "L", "M"]) {
          wsDetalle.getCell(`${col}${i}`).numFmt = "#,##0.00";
        }
      }
      wsDetalle.views = [{ state: "frozen", ySplit: 1 }];
    }

    const estadoTag = estado === "TODOS" ? "TODOS" : estado;
    const periodoTag = String(periodo.periodo || "")
      .replace(/[^0-9]/g, "")
      .slice(0, 16) || "periodo";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=reporte_estado_conexion_${estadoTag}_${periodoTag}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error exportando reporte estado conexion excel:", err);
    return res.status(500).json({ error: "Error exportando reporte estado de conexion en Excel." });
  }
});

app.get("/contribuyentes", async (req, res) => {
  try {
    const now = Date.now();
    if (contribuyentesCache.data && now < contribuyentesCache.expiresAt) {
      res.set("Cache-Control", "private, max-age=10");
      return res.json(contribuyentesCache.data);
    }

    const anioActual = getCurrentYear();
    const mesActual = getCurrentMonth();

    // Consulta optimizada: agregamos deuda/abono/meses por predio una sola vez
    const query = `
      WITH recibos_objetivo AS (
        SELECT r.id_recibo, r.id_predio, r.total_pagar
        FROM recibos r
        WHERE (r.anio, r.mes) <= ($1::int, $2::int)
      ),
      pagos_por_recibo AS (
        SELECT p.id_recibo, SUM(p.monto_pagado) AS total_pagado
        FROM pagos p
        JOIN recibos_objetivo ro ON ro.id_recibo = p.id_recibo
        GROUP BY p.id_recibo
      ),
      ordenes_pendientes_detalle AS (
        SELECT
          oc.id_orden,
          (elem->>'id_recibo')::int AS id_recibo,
          GREATEST(COALESCE((elem->>'monto_autorizado')::numeric, 0), 0) AS monto_autorizado
        FROM ordenes_cobro oc
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(oc.recibos_json, '[]'::jsonb)) elem
        WHERE oc.estado = 'PENDIENTE'
          AND (elem->>'id_recibo') ~ '^[0-9]+$'
      ),
      ordenes_pendientes_recibo AS (
        SELECT
          opd.id_recibo,
          SUM(opd.monto_autorizado) AS monto_pendiente
        FROM ordenes_pendientes_detalle opd
        GROUP BY opd.id_recibo
      ),
      ordenes_pendientes_predio AS (
        SELECT
          ro.id_predio,
          COUNT(DISTINCT opd.id_orden) AS ordenes_pendientes
        FROM recibos_objetivo ro
        JOIN ordenes_pendientes_detalle opd ON opd.id_recibo = ro.id_recibo
        GROUP BY ro.id_predio
      ),
      resumen_predio AS (
        SELECT
          ro.id_predio,
          SUM(GREATEST(ro.total_pagar - COALESCE(pp.total_pagado, 0), 0)) AS deuda_total,
          SUM(COALESCE(pp.total_pagado, 0)) AS abono_total,
          COUNT(*) FILTER (WHERE (ro.total_pagar - COALESCE(pp.total_pagado, 0)) > 0) AS meses_deuda_total,
          SUM(
            LEAST(
              GREATEST(ro.total_pagar - COALESCE(pp.total_pagado, 0), 0),
              COALESCE(opr.monto_pendiente, 0)
            )
          ) AS monto_pendiente_caja
        FROM recibos_objetivo ro
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
        LEFT JOIN ordenes_pendientes_recibo opr ON opr.id_recibo = ro.id_recibo
        GROUP BY ro.id_predio
      )
      SELECT c.id_contribuyente, c.codigo_municipal, c.sec_cod, c.sec_nombre, c.dni_ruc, c.nombre_completo, c.telefono,
             COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
             COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion_fuente)), ''), 'INFERIDO') AS estado_conexion_fuente,
             COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion_verificado_sn)), ''), 'N') AS estado_conexion_verificado_sn,
             c.estado_conexion_fecha_verificacion,
             c.estado_conexion_motivo_ultimo,
             p.id_predio, 
             ${buildDireccionSql("ca", "p")} as direccion_completa,
             p.id_calle, p.numero_casa, p.manzana, p.lote,
             p.tarifa_agua, p.tarifa_desague, p.tarifa_limpieza, p.tarifa_admin, p.tarifa_extra,
             
             COALESCE(rp.deuda_total, 0) as deuda_anio,
             COALESCE(rp.abono_total, 0) as abono_anio,
             COALESCE(rp.meses_deuda_total, 0) as meses_deuda,
             COALESCE(rp.monto_pendiente_caja, 0) as pendiente_caja_monto,
             COALESCE(opr.ordenes_pendientes, 0) as pendiente_caja_ordenes,
             'N' AS verificar_caja_sn,
             NULL::timestamp AS verificar_caja_desde,
             NULL::text AS verificar_caja_observacion
      FROM contribuyentes c
      LEFT JOIN predios p ON c.id_contribuyente = p.id_contribuyente
      LEFT JOIN calles ca ON p.id_calle = ca.id_calle
      LEFT JOIN resumen_predio rp ON rp.id_predio = p.id_predio
      LEFT JOIN ordenes_pendientes_predio opr ON opr.id_predio = p.id_predio
      LEFT JOIN LATERAL (
        SELECT
          s.creado_en AS seguimiento_desde
        FROM campo_solicitudes s
        WHERE s.id_contribuyente = c.id_contribuyente
          AND s.estado_solicitud <> 'RECHAZADO'
        ORDER BY s.creado_en DESC
        LIMIT 1
      ) cs ON TRUE
    `;
    const todos = await pool.query(query, [anioActual, mesActual]);
    contribuyentesCache = {
      expiresAt: Date.now() + CONTRIBUYENTES_CACHE_TTL_MS,
      data: todos.rows
    };
    res.set("Cache-Control", "private, max-age=10");
    res.json(todos.rows);
  } catch (err) { res.status(500).send("Error del servidor"); }
});

app.get("/contribuyentes/detalle/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = await pool.query(`
      SELECT c.*, p.id_calle, p.numero_casa, p.manzana, p.lote, p.referencia_direccion,
             p.tarifa_agua, p.tarifa_desague, p.tarifa_limpieza, p.tarifa_admin, p.tarifa_extra,
             COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_sn,
             COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_sn,
             COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_sn
      FROM contribuyentes c
      LEFT JOIN predios p ON c.id_contribuyente = p.id_contribuyente
      WHERE c.id_contribuyente = $1
    `, [id]);
    res.json(data.rows[0]);
  } catch (err) { res.status(500).send("Error"); }
});

// CREAR CONTRIBUYENTE (CÓDIGO NUMÉRICO AUTOGENERADO)
app.post("/contribuyentes", uploadContribuyenteAdjuntosArray("adjuntos"), async (req, res) => {
  const client = await pool.connect();
  const uploadedFiles = Array.isArray(req.files) ? req.files : [];
  try {
    const {
      dni_ruc, nombre_completo, telefono, id_calle, numero_casa, manzana, lote, sec_nombre, estado_conexion
    } = req.body;
    const estadoConexion = normalizeEstadoConexion(estado_conexion);
    const predioEstado = estadoConexionToPredio(estadoConexion);

    if (!nombre_completo || !dni_ruc || !id_calle) {
      cleanupUploadedTempFiles(uploadedFiles);
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }
    for (const file of uploadedFiles) {
      if (!isContribuyenteAdjuntoTipoPermitido(file)) {
        cleanupUploadedTempFiles(uploadedFiles);
        return res.status(400).json({
          error: `Archivo adjunto no permitido: ${String(file?.originalname || "sin_nombre")}. Formatos permitidos: PDF, imagen, Word o Excel.`
        });
      }
    }

    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [20260228]);
    const codigoMunicipal = await generateNextCodigoMunicipal(client);

    const nuevo = await client.query(
      `INSERT INTO contribuyentes (
        codigo_municipal, sec_cod, sec_nombre, dni_ruc, nombre_completo, telefono,
        estado_conexion, estado_conexion_fuente, estado_conexion_verificado_sn, estado_conexion_fecha_verificacion
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'OFICINA', 'N', NULL) RETURNING id_contribuyente`,
      [codigoMunicipal, null, sec_nombre ? String(sec_nombre).trim() : null, dni_ruc, nombre_completo, telefono, estadoConexion]
    );
    const id = nuevo.rows[0].id_contribuyente;

    await client.query(
      "INSERT INTO predios (id_contribuyente, id_calle, numero_casa, manzana, lote, id_tarifa, estado_servicio, activo_sn) VALUES ($1, $2, $3, $4, $5, 1, $6, $7)",
      [id, id_calle, numero_casa, manzana, lote, predioEstado.estado_servicio, predioEstado.activo_sn]
    );
    if (uploadedFiles.length > 0) {
      await ensureContribuyentesAdjuntosTable(client);
      for (const file of uploadedFiles) {
        const originalName = normalizeLimitedText(file?.originalname, 240) || "adjunto";
        const mime = normalizeLimitedText(file?.mimetype, 160) || null;
        const fileBytes = Number(file?.size || 0);
        const absolutePath = path.resolve(String(file?.path || "").trim());
        if (!absolutePath.startsWith(path.resolve(CONTRIBUYENTE_ADJUNTO_UPLOAD_DIR))) {
          throw new Error("Ruta de adjunto de contribuyente inválida.");
        }
        const relativePath = path.relative(__dirname, absolutePath).replace(/\\/g, "/");
        const sha = await sha256File(absolutePath);
        await client.query(`
          INSERT INTO contribuyentes_adjuntos (
            id_contribuyente, id_usuario, tipo_contexto, descripcion,
            archivo_nombre, archivo_mime, archivo_bytes, archivo_sha256, archivo_path
          )
          VALUES ($1, $2, 'ALTA', $3, $4, $5, $6, $7, $8)
        `, [
          id,
          req.user?.id_usuario || null,
          "Adjunto de alta de contribuyente.",
          originalName,
          mime,
          fileBytes,
          sha,
          relativePath
        ]);
      }
    }

    await client.query("COMMIT");
    invalidateContribuyentesCache();
    res.json({
      mensaje: "Registrado",
      codigo: codigoMunicipal,
      adjuntos_registrados: uploadedFiles.length
    });

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    cleanupUploadedTempFiles(uploadedFiles);
    if (err.message === "CODIGO_MUNICIPAL_OVERFLOW") {
      return res.status(500).json({ error: "No se pudo generar el código municipal: rango agotado." });
    }
    if (err.code === '23505') return res.status(400).json({ error: "El código municipal ya existe." });
    res.status(500).json({ error: "Error servidor" });
  } finally {
    client.release();
  }
});

app.put("/contribuyentes/:id", async (req, res) => {
  const client = await pool.connect();
  let txStarted = false;
  try {
    const { id } = req.params;
    const idContribuyente = parsePositiveInt(id, 0);
    if (!idContribuyente) {
      return res.status(400).json({ error: "ID de contribuyente invalido." });
    }
    const {
      nombre_completo, codigo_municipal, sec_cod, sec_nombre,
      dni_ruc, email, telefono, id_calle, numero_casa, manzana, lote, estado_conexion,
      motivo_cambio_razon_social, detalle_motivo_cambio_razon_social,
      tarifa_agua, tarifa_desague, tarifa_limpieza, tarifa_admin, tarifa_extra,
      agua_sn, desague_sn, limpieza_sn
    } = req.body;
    const codigoMunicipal = normalizeCodigoMunicipal(codigo_municipal);
    const codigoSistema = sec_cod ? String(sec_cod).trim() : null;
    const estadoConexion = normalizeEstadoConexion(estado_conexion);
    const predioEstado = estadoConexionToPredio(estadoConexion);

    if (!codigoMunicipal) {
      return res.status(400).json({ error: "Código municipal inválido." });
    }
    const tarifaAgua = parseOptionalTarifaMonto(tarifa_agua);
    const tarifaDesague = parseOptionalTarifaMonto(tarifa_desague);
    const tarifaLimpieza = parseOptionalTarifaMonto(tarifa_limpieza);
    const tarifaAdmin = parseOptionalTarifaMonto(tarifa_admin);
    const tarifaExtra = parseOptionalTarifaMonto(tarifa_extra);
    const aguaSN = parseOptionalServicioSN(agua_sn);
    const desagueSN = parseOptionalServicioSN(desague_sn);
    const limpiezaSN = parseOptionalServicioSN(limpieza_sn);
    if ([tarifaAgua, tarifaDesague, tarifaLimpieza, tarifaAdmin, tarifaExtra].includes("__INVALID__")) {
      return res.status(400).json({ error: "Tarifas inválidas. Deben ser números mayores o iguales a 0." });
    }
    if ([aguaSN, desagueSN, limpiezaSN].includes("__INVALID__")) {
      return res.status(400).json({ error: "Servicios inválidos. Use S/N o true/false." });
    }

    await client.query('BEGIN');
    txStarted = true;
    const actualData = await client.query(
      `SELECT nombre_completo, codigo_municipal, sec_cod
       FROM contribuyentes
       WHERE id_contribuyente = $1
       FOR UPDATE`,
      [idContribuyente]
    );
    if (actualData.rows.length === 0) {
      await client.query("ROLLBACK");
      txStarted = false;
      return res.status(404).json({ error: "Contribuyente no encontrado." });
    }

    const codigoMunicipalActual = normalizeCodigoMunicipal(actualData.rows[0].codigo_municipal);
    const codigoSistemaActual = String(actualData.rows[0].sec_cod || "").trim() || null;
    const cambioCodigoMunicipal = codigoMunicipal !== codigoMunicipalActual;
    const cambioCodigoSistema = (codigoSistema || null) !== codigoSistemaActual;

    if (cambioCodigoMunicipal) {
      const exMunicipal = await client.query(
        "SELECT 1 FROM contribuyentes WHERE codigo_municipal = $1 AND id_contribuyente <> $2 LIMIT 1",
        [codigoMunicipal, idContribuyente]
      );
      if (exMunicipal.rows.length > 0) {
        await client.query("ROLLBACK");
        txStarted = false;
        return res.status(400).json({ error: "El código municipal ya pertenece a otro contribuyente." });
      }
    }

    if (cambioCodigoSistema && codigoSistema) {
      const exSistema = await client.query(
        "SELECT 1 FROM contribuyentes WHERE sec_cod = $1 AND id_contribuyente <> $2 LIMIT 1",
        [codigoSistema, idContribuyente]
      );
      if (exSistema.rows.length > 0) {
        await client.query("ROLLBACK");
        txStarted = false;
        return res.status(400).json({ error: "El código de sistema ya pertenece a otro contribuyente." });
      }
    }

    const nombreAnterior = normalizeLimitedText(actualData.rows[0].nombre_completo, 200) || "";
    const nombreNuevo = normalizeLimitedText(nombre_completo, 200) || "";
    const cambioRazonSocial = String(nombreNuevo || "").trim().toUpperCase() !== String(nombreAnterior || "").trim().toUpperCase();
    const motivoCambioRazonSocial = normalizeMotivoCambioRazonSocial(motivo_cambio_razon_social);
    const detalleMotivoRazonSocial = normalizeLimitedText(detalle_motivo_cambio_razon_social, 300) || "";
    if (cambioRazonSocial && !motivoCambioRazonSocial) {
      await client.query("ROLLBACK");
      txStarted = false;
      return res.status(400).json({ error: "Debe indicar el motivo del cambio de razon social." });
    }
    if (cambioRazonSocial && motivoCambioRazonSocial === "OTRO" && !detalleMotivoRazonSocial) {
      await client.query("ROLLBACK");
      txStarted = false;
      return res.status(400).json({ error: "Debe detallar el motivo de cambio de razon social." });
    }
    const motivoRazonSocialTexto = cambioRazonSocial
      ? (motivoCambioRazonSocial === "OTRO" ? `OTRO: ${detalleMotivoRazonSocial}` : motivoCambioRazonSocial)
      : null;

    await client.query(
      `UPDATE contribuyentes
       SET nombre_completo = $1,
           codigo_municipal = $2,
           sec_cod = $3,
           sec_nombre = $4,
           dni_ruc = $5,
           email = $6,
           telefono = $7,
           estado_conexion = $8,
           estado_conexion_fuente = 'OFICINA',
           estado_conexion_verificado_sn = 'N',
           estado_conexion_fecha_verificacion = NULL,
           razon_social_motivo_ultimo = CASE WHEN $10::boolean THEN $11 ELSE razon_social_motivo_ultimo END,
           razon_social_actualizado_en = CASE WHEN $10::boolean THEN NOW() ELSE razon_social_actualizado_en END
       WHERE id_contribuyente = $9`,
      [nombreNuevo, codigoMunicipal, codigoSistema, sec_nombre || null, dni_ruc, email, telefono, estadoConexion, idContribuyente, cambioRazonSocial, motivoRazonSocialTexto]
    );
    await client.query(
      `UPDATE predios
       SET id_calle = $1,
           numero_casa = $2,
           manzana = $3,
           lote = $4,
           activo_sn = $5,
           estado_servicio = $6,
           tarifa_agua = $8,
           tarifa_desague = $9,
           tarifa_limpieza = $10,
           tarifa_admin = $11,
           tarifa_extra = $12,
           agua_sn = COALESCE($13, agua_sn),
           desague_sn = COALESCE($14, desague_sn),
           limpieza_sn = COALESCE($15, limpieza_sn)
       WHERE id_contribuyente = $7`,
      [
        id_calle, numero_casa, manzana, lote, predioEstado.activo_sn, predioEstado.estado_servicio,
        idContribuyente, tarifaAgua, tarifaDesague, tarifaLimpieza, tarifaAdmin, tarifaExtra,
        aguaSN, desagueSN, limpiezaSN
      ]
    );
    const recalcManual = await recalcularRecibosFuturosPorServicios(client, idContribuyente, {
      incluirPendientesHistoricos: true,
      desdePeriodoNum: 0
    });
    const recibosRecalculados = Number(recalcManual?.actualizados || 0);
    if (cambioRazonSocial) {
      const usuarioAuditoria = req.user?.username || req.user?.nombre || "SISTEMA";
      const motivoLabel = motivoCambioRazonSocialLabel(motivoCambioRazonSocial);
      const extraOtro = motivoCambioRazonSocial === "OTRO" ? ` (${detalleMotivoRazonSocial})` : "";
      await registrarAuditoria(
        client,
        "CAMBIO_RAZON_SOCIAL",
        `contribuyente=${idContribuyente}; codigo_municipal=${codigoMunicipal}; anterior=${nombreAnterior}; nuevo=${nombreNuevo}; motivo=${motivoLabel}${extraOtro}`,
        usuarioAuditoria
      );
    }
    await client.query('COMMIT');
    txStarted = false;
    invalidateContribuyentesCache();
    res.json({ mensaje: "Datos actualizados correctamente", recibos_recalculados: recibosRecalculados });
  } catch (err) {
    if (txStarted) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    if (err.code === '23505') {
      return res.status(400).json({ error: "Código municipal o código de sistema ya existen." });
    }
    res.status(500).send("Error al actualizar");
  } finally { client.release(); }
});

app.post("/contribuyentes/cortes/registrar", uploadCorteEvidenciaArray("evidencias"), async (req, res) => {
  const client = await pool.connect();
  const uploadedFiles = Array.isArray(req.files) ? req.files : [];
  try {
    const idContribuyente = Number(req.body?.id_contribuyente);
    if (!Number.isInteger(idContribuyente) || idContribuyente <= 0) {
      cleanupUploadedTempFiles(uploadedFiles);
      return res.status(400).json({ error: "ID de contribuyente inválido." });
    }
    const motivo = normalizeLimitedText(req.body?.motivo, 1200) || "";
    if (!motivo) {
      cleanupUploadedTempFiles(uploadedFiles);
      return res.status(400).json({ error: "Debe indicar el motivo del corte." });
    }
    if (uploadedFiles.length === 0) {
      return res.status(400).json({ error: "Debe adjuntar al menos una evidencia (PDF o imagen)." });
    }
    for (const file of uploadedFiles) {
      if (!isCorteEvidenciaTipoPermitido(file)) {
        cleanupUploadedTempFiles(uploadedFiles);
        return res.status(400).json({
          error: `Archivo no permitido: ${String(file?.originalname || "sin_nombre")}. Formatos: PDF, imagen o Word.`
        });
      }
    }

    await client.query("BEGIN");
    await ensureEstadoConexionEventosTable(client);
    await ensureEstadoConexionEvidenciasTable(client);

    const actual = await client.query(`
      SELECT
        id_contribuyente,
        codigo_municipal,
        nombre_completo,
        COALESCE(NULLIF(UPPER(TRIM(estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion
      FROM contribuyentes
      WHERE id_contribuyente = $1
      FOR UPDATE
    `, [idContribuyente]);

    if (actual.rows.length === 0) {
      await client.query("ROLLBACK");
      cleanupUploadedTempFiles(uploadedFiles);
      return res.status(404).json({ error: "Contribuyente no encontrado." });
    }

    const row = actual.rows[0];
    const estadoActual = normalizeEstadoConexion(row.estado_conexion);
    if (estadoActual !== ESTADOS_CONEXION.CON_CONEXION) {
      await client.query("ROLLBACK");
      cleanupUploadedTempFiles(uploadedFiles);
      return res.status(400).json({
        error: "Solo se puede registrar corte para contribuyentes con conexión activa."
      });
    }

    const estadoDestino = ESTADOS_CONEXION.CORTADO;
    const fechaVerificacion = normalizeDateOnly(req.body?.fecha_corte) || toISODate();
    const predioEstado = estadoConexionToPredio(estadoDestino);
    const fuente = FUENTES_ESTADO_CONEXION.OFICINA;

    await client.query(
      `UPDATE contribuyentes
       SET estado_conexion = $1,
           estado_conexion_fuente = $2,
           estado_conexion_verificado_sn = 'N',
           estado_conexion_fecha_verificacion = $3,
           estado_conexion_motivo_ultimo = $4
       WHERE id_contribuyente = $5`,
      [estadoDestino, fuente, fechaVerificacion, motivo, idContribuyente]
    );
    await client.query(
      "UPDATE predios SET activo_sn = $1, estado_servicio = $2 WHERE id_contribuyente = $3",
      [predioEstado.activo_sn, predioEstado.estado_servicio, idContribuyente]
    );
    const recalc = await recalcularRecibosFuturosPorServicios(client, idContribuyente);
    const recibosRecalculados = Number(recalc?.actualizados || 0);

    const evento = await client.query(`
      INSERT INTO estado_conexion_eventos (
        id_usuario, id_contribuyente, estado_anterior, estado_nuevo, motivo
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id_evento, creado_en
    `, [
      req.user?.id_usuario || null,
      idContribuyente,
      estadoActual,
      estadoDestino,
      motivo
    ]);

    const idEvento = Number(evento.rows[0].id_evento);
    const evidencias = [];
    for (const file of uploadedFiles) {
      const originalName = normalizeLimitedText(file?.originalname, 240) || "evidencia";
      const mime = normalizeLimitedText(file?.mimetype, 160) || null;
      const fileBytes = Number(file?.size || 0);
      const absolutePath = path.resolve(String(file?.path || "").trim());
      if (!absolutePath.startsWith(path.resolve(CORTE_EVIDENCIA_UPLOAD_DIR))) {
        throw new Error("Ruta de evidencia inválida.");
      }
      const relativePath = path.relative(__dirname, absolutePath).replace(/\\/g, "/");
      const sha = await sha256File(absolutePath);
      const insertEv = await client.query(`
        INSERT INTO estado_conexion_eventos_evidencias (
          id_evento, id_contribuyente, archivo_nombre, archivo_mime, archivo_bytes, archivo_sha256, archivo_path
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id_evidencia
      `, [idEvento, idContribuyente, originalName, mime, fileBytes, sha, relativePath]);
      evidencias.push({
        id_evidencia: Number(insertEv.rows[0].id_evidencia),
        archivo_nombre: originalName,
        archivo_mime: mime,
        archivo_bytes: fileBytes
      });
    }

    await registrarAuditoria(
      client,
      "ESTADO_CONEXION_CORTE",
      `${row.codigo_municipal || idContribuyente} ${row.nombre_completo || ""}: ${estadoActual} -> ${estadoDestino}. Motivo: ${motivo}. Evidencias: ${evidencias.length}.`,
      req.user?.nombre || req.user?.username || "SISTEMA"
    );

    await client.query("COMMIT");
    invalidateContribuyentesCache();
    realtimeHub.broadcast("deuda", "saldo_actualizado", {
      id_contribuyente: idContribuyente,
      origen: "corte_con_evidencia"
    });

    return res.json({
      mensaje: "Corte registrado con evidencia.",
      id_contribuyente: idContribuyente,
      estado_anterior: estadoActual,
      estado_nuevo: estadoDestino,
      fecha_evento: evento.rows[0].creado_en,
      id_evento: idEvento,
      recibos_recalculados: recibosRecalculados,
      evidencias
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    cleanupUploadedTempFiles(uploadedFiles);
    console.error("Error registrando corte con evidencia:", err);
    return res.status(500).json({ error: "Error registrando corte con evidencia." });
  } finally {
    client.release();
  }
});

app.post("/contribuyentes/:id/estado-conexion", async (req, res) => {
  const client = await pool.connect();
  try {
    const idContribuyente = Number(req.params?.id);
    if (!Number.isInteger(idContribuyente) || idContribuyente <= 0) {
      return res.status(400).json({ error: "ID de contribuyente inválido." });
    }

    const estadoDestino = normalizeEstadoConexion(req.body?.estado_conexion);
    const fuente = normalizeFuenteEstadoConexion(req.body?.fuente || "OFICINA");
    const verificadoSN = normalizeSN(req.body?.verificado_campo_sn, fuente === FUENTES_ESTADO_CONEXION.CAMPO ? "S" : "N");
    const fechaVerificacion = normalizeDateOnly(req.body?.fecha_verificacion) || (verificadoSN === "S" ? toISODate() : null);
    const motivo = String(req.body?.motivo || "").trim();
    if (!motivo) {
      return res.status(400).json({ error: "Debe indicar el motivo del cambio de estado." });
    }

    await client.query("BEGIN");
    await ensureEstadoConexionEventosTable(client);

    const actual = await client.query(`
      SELECT
        id_contribuyente,
        codigo_municipal,
        nombre_completo,
        COALESCE(NULLIF(UPPER(TRIM(estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion
      FROM contribuyentes
      WHERE id_contribuyente = $1
      FOR UPDATE
    `, [idContribuyente]);

    if (actual.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contribuyente no encontrado." });
    }

    const row = actual.rows[0];
    const estadoActual = row.estado_conexion;

    if (estadoActual === estadoDestino) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "El contribuyente ya tiene ese estado de conexión." });
    }

    if (estadoDestino === ESTADOS_CONEXION.CORTADO && estadoActual !== ESTADOS_CONEXION.CON_CONEXION) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Solo se puede cortar a contribuyentes con conexión activa." });
    }

    if (estadoDestino === ESTADOS_CONEXION.CON_CONEXION && estadoActual === ESTADOS_CONEXION.CON_CONEXION) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "El contribuyente ya está con conexión activa." });
    }

    const predioEstado = estadoConexionToPredio(estadoDestino);

    await client.query(
      `UPDATE contribuyentes
       SET estado_conexion = $1,
           estado_conexion_fuente = $2,
           estado_conexion_verificado_sn = $3,
           estado_conexion_fecha_verificacion = $4,
           estado_conexion_motivo_ultimo = $5
       WHERE id_contribuyente = $6`,
      [estadoDestino, fuente, verificadoSN, fechaVerificacion, motivo, idContribuyente]
    );
    await client.query(
      "UPDATE predios SET activo_sn = $1, estado_servicio = $2 WHERE id_contribuyente = $3",
      [predioEstado.activo_sn, predioEstado.estado_servicio, idContribuyente]
    );
    const recalc = await recalcularRecibosFuturosPorServicios(client, idContribuyente);
    const recibosRecalculados = Number(recalc?.actualizados || 0);

    const evento = await client.query(`
      INSERT INTO estado_conexion_eventos (
        id_usuario, id_contribuyente, estado_anterior, estado_nuevo, motivo
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id_evento, creado_en
    `, [
      req.user?.id_usuario || null,
      idContribuyente,
      estadoActual,
      estadoDestino,
      motivo
    ]);

    await registrarAuditoria(
      client,
      "ESTADO_CONEXION",
      `${row.codigo_municipal || idContribuyente} ${row.nombre_completo || ""}: ${estadoActual} -> ${estadoDestino}. Motivo: ${motivo}`,
      req.user?.nombre || req.user?.username || "SISTEMA"
    );

    await client.query("COMMIT");
    invalidateContribuyentesCache();

    return res.json({
      mensaje: "Estado de conexión actualizado.",
      id_contribuyente: idContribuyente,
      estado_anterior: estadoActual,
      estado_nuevo: estadoDestino,
      fecha_evento: evento.rows[0].creado_en,
      id_evento: Number(evento.rows[0].id_evento),
      recibos_recalculados: recibosRecalculados
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error actualizando estado de conexión:", err);
    return res.status(500).json({ error: "Error actualizando estado de conexión." });
  } finally {
    client.release();
  }
});

app.post("/contribuyentes/cortes/resumen", async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureEstadoConexionEventosTable(client);
    await ensureEstadoConexionEvidenciasTable(client);
    const idsRaw = Array.isArray(req.body?.ids_contribuyentes) ? req.body.ids_contribuyentes : [];
    const ids = Array.from(
      new Set(
        idsRaw
          .map((v) => Number(v))
          .filter((v) => Number.isInteger(v) && v > 0)
      )
    );
    if (ids.length === 0) {
      return res.json({ items: [] });
    }

    const data = await client.query(`
      WITH ultimos AS (
        SELECT DISTINCT ON (e.id_contribuyente)
          e.id_contribuyente,
          e.id_evento,
          e.creado_en,
          e.motivo
        FROM estado_conexion_eventos e
        WHERE e.id_contribuyente = ANY($1::int[])
          AND UPPER(COALESCE(TRIM(e.estado_nuevo), '')) = 'CORTADO'
        ORDER BY e.id_contribuyente, e.creado_en DESC, e.id_evento DESC
      )
      SELECT
        u.id_contribuyente,
        u.id_evento,
        u.creado_en,
        u.motivo,
        ev.id_evidencia,
        ev.archivo_nombre,
        ev.archivo_mime,
        ev.archivo_bytes
      FROM ultimos u
      LEFT JOIN estado_conexion_eventos_evidencias ev ON ev.id_evento = u.id_evento
      ORDER BY u.id_contribuyente ASC, ev.id_evidencia ASC
    `, [ids]);

    const byId = new Map();
    for (const row of data.rows) {
      const id = Number(row.id_contribuyente);
      if (!byId.has(id)) {
        byId.set(id, {
          id_contribuyente: id,
          id_evento: Number(row.id_evento),
          fecha_evento: row.creado_en,
          motivo: row.motivo || "",
          evidencias: []
        });
      }
      if (row.id_evidencia) {
        byId.get(id).evidencias.push({
          id_evidencia: Number(row.id_evidencia),
          archivo_nombre: row.archivo_nombre || "",
          archivo_mime: row.archivo_mime || "",
          archivo_bytes: Number(row.archivo_bytes || 0),
          descarga_url: `/contribuyentes/cortes/evidencias/${Number(row.id_evidencia)}/descargar`
        });
      }
    }

    return res.json({ items: Array.from(byId.values()) });
  } catch (err) {
    console.error("Error consultando resumen de cortes:", err);
    return res.status(500).json({ error: "Error consultando resumen de cortes." });
  } finally {
    client.release();
  }
});

app.get("/contribuyentes/cortes/evidencias/:id_evidencia/descargar", async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureEstadoConexionEvidenciasTable(client);
    const idEvidencia = Number(req.params?.id_evidencia);
    if (!Number.isInteger(idEvidencia) || idEvidencia <= 0) {
      return res.status(400).json({ error: "ID de evidencia inválido." });
    }
    const data = await client.query(`
      SELECT archivo_nombre, archivo_mime, archivo_path
      FROM estado_conexion_eventos_evidencias
      WHERE id_evidencia = $1
      LIMIT 1
    `, [idEvidencia]);
    if (data.rows.length === 0) {
      return res.status(404).json({ error: "Evidencia no encontrada." });
    }
    const row = data.rows[0];
    const absolutePath = path.resolve(__dirname, String(row.archivo_path || ""));
    const uploadRoot = path.resolve(CORTE_EVIDENCIA_UPLOAD_DIR);
    if (!absolutePath.startsWith(uploadRoot)) {
      return res.status(400).json({ error: "Ruta de evidencia inválida." });
    }
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: "Archivo de evidencia no disponible." });
    }
    return res.download(absolutePath, row.archivo_nombre || `evidencia_${idEvidencia}`);
  } catch (err) {
    console.error("Error descargando evidencia:", err);
    return res.status(500).json({ error: "Error descargando evidencia." });
  } finally {
    client.release();
  }
});

app.get("/contribuyentes/:id_contribuyente/adjuntos", async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureContribuyentesAdjuntosTable(client);
    const idContribuyente = Number(req.params?.id_contribuyente);
    if (!Number.isInteger(idContribuyente) || idContribuyente <= 0) {
      return res.status(400).json({ error: "ID de contribuyente inválido." });
    }
    const data = await client.query(`
      SELECT
        id_adjunto,
        creado_en,
        id_contribuyente,
        tipo_contexto,
        descripcion,
        archivo_nombre,
        archivo_mime,
        archivo_bytes
      FROM contribuyentes_adjuntos
      WHERE id_contribuyente = $1
      ORDER BY creado_en DESC, id_adjunto DESC
    `, [idContribuyente]);
    return res.json({
      items: data.rows.map((row) => ({
        id_adjunto: Number(row.id_adjunto || 0),
        creado_en: row.creado_en || null,
        id_contribuyente: Number(row.id_contribuyente || 0),
        tipo_contexto: row.tipo_contexto || "ALTA",
        descripcion: row.descripcion || "",
        archivo_nombre: row.archivo_nombre || "",
        archivo_mime: row.archivo_mime || "",
        archivo_bytes: Number(row.archivo_bytes || 0),
        descarga_url: `/contribuyentes/adjuntos/${Number(row.id_adjunto || 0)}/descargar`
      }))
    });
  } catch (err) {
    console.error("Error listando adjuntos de contribuyente:", err);
    return res.status(500).json({ error: "Error listando adjuntos del contribuyente." });
  } finally {
    client.release();
  }
});

app.get("/contribuyentes/adjuntos/:id_adjunto/descargar", async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureContribuyentesAdjuntosTable(client);
    const idAdjunto = Number(req.params?.id_adjunto);
    if (!Number.isInteger(idAdjunto) || idAdjunto <= 0) {
      return res.status(400).json({ error: "ID de adjunto inválido." });
    }
    const data = await client.query(`
      SELECT archivo_nombre, archivo_mime, archivo_path
      FROM contribuyentes_adjuntos
      WHERE id_adjunto = $1
      LIMIT 1
    `, [idAdjunto]);
    if (data.rows.length === 0) {
      return res.status(404).json({ error: "Adjunto no encontrado." });
    }
    const row = data.rows[0];
    const absolutePath = path.resolve(__dirname, String(row.archivo_path || ""));
    const uploadRoot = path.resolve(CONTRIBUYENTE_ADJUNTO_UPLOAD_DIR);
    if (!absolutePath.startsWith(uploadRoot)) {
      return res.status(400).json({ error: "Ruta de adjunto inválida." });
    }
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: "Archivo adjunto no disponible." });
    }
    return res.download(absolutePath, row.archivo_nombre || `adjunto_${idAdjunto}`);
  } catch (err) {
    console.error("Error descargando adjunto de contribuyente:", err);
    return res.status(500).json({ error: "Error descargando adjunto del contribuyente." });
  } finally {
    client.release();
  }
});

app.delete("/contribuyentes/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    const targetId = Number(req.params?.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: "ID inválido." });
    }

    await client.query('BEGIN');
    const existe = await client.query(
      "SELECT 1 FROM contribuyentes WHERE id_contribuyente = $1 LIMIT 1",
      [targetId]
    );
    if (existe.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contribuyente no encontrado." });
    }

    await client.query(`
      DELETE FROM pagos
      WHERE id_recibo IN (
        SELECT r.id_recibo
        FROM recibos r
        WHERE r.id_predio IN (
          SELECT p.id_predio
          FROM predios p
          WHERE p.id_contribuyente = $1
        )
      )
      OR id_orden_cobro IN (
        SELECT oc.id_orden
        FROM ordenes_cobro oc
        WHERE oc.id_contribuyente = $1
      )
    `, [targetId]);

    await client.query(`
      DELETE FROM predios_direcciones_alternas
      WHERE id_contribuyente = $1
         OR id_predio_base IN (
           SELECT p.id_predio
           FROM predios p
           WHERE p.id_contribuyente = $1
         )
    `, [targetId]);

    await client.query("DELETE FROM campo_solicitudes WHERE id_contribuyente = $1", [targetId]);
    await client.query("DELETE FROM estado_conexion_eventos WHERE id_contribuyente = $1", [targetId]);
    await client.query("DELETE FROM actas_corte WHERE id_contribuyente = $1", [targetId]);
    await client.query("DELETE FROM codigos_impresion WHERE id_contribuyente = $1", [targetId]);
    await client.query("DELETE FROM ordenes_cobro WHERE id_contribuyente = $1", [targetId]);
    await client.query(`
      DELETE FROM recibos
      WHERE id_predio IN (
        SELECT p.id_predio
        FROM predios p
        WHERE p.id_contribuyente = $1
      )
    `, [targetId]);
    await client.query("DELETE FROM predios WHERE id_contribuyente = $1", [targetId]);
    await client.query("DELETE FROM contribuyentes WHERE id_contribuyente = $1", [targetId]);
    await client.query('COMMIT');
    invalidateContribuyentesCache();
    res.json({ mensaje: "Usuario eliminado permanentemente." });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error eliminando contribuyente:", err);
    res.status(500).json({ error: err?.detail || err?.message || "Error al eliminar usuario." });
  } finally { client.release(); }
});

// ==========================================
// FACTURACIÓN Y PAGOS
// ==========================================
const parseSubtotalOrden = (value) => {
  const parsed = roundMonto2(parseMonto(value, 0));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

const sanitizeOrdenCobroItems = (itemsRaw = []) => {
  const rows = clampArray(itemsRaw, 120);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const idRecibo = parsePositiveInt(row?.id_recibo, 0);
    const monto = parsePositiveMonto(row?.monto_autorizado ?? row?.monto_pagado);
    if (!idRecibo || !monto || seen.has(idRecibo)) continue;
    seen.add(idRecibo);
    out.push({
      id_recibo: idRecibo,
      monto_autorizado: monto,
      mes: parsePositiveInt(row?.mes, 0) || null,
      anio: parsePositiveInt(row?.anio, 0) || null,
      subtotal_agua: parseSubtotalOrden(row?.subtotal_agua),
      subtotal_desague: parseSubtotalOrden(row?.subtotal_desague),
      subtotal_limpieza: parseSubtotalOrden(row?.subtotal_limpieza),
      subtotal_admin: parseSubtotalOrden(row?.subtotal_admin)
    });
  }
  return out;
};

const safeJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const buildOrdenCobroResponse = (row) => {
  const items = sanitizeOrdenCobroItems(safeJsonArray(row?.recibos_json));
  const codigoRecibo = normalizeCodigoReciboInput(row?.codigo_recibo);
  return {
    id_orden: Number(row?.id_orden || 0),
    creado_en: row?.creado_en || null,
    actualizado_en: row?.actualizado_en || null,
    estado: row?.estado || ESTADOS_ORDEN_COBRO.PENDIENTE,
    tipo_orden: normalizeTipoOrdenCobro(row?.tipo_orden, TIPOS_ORDEN_COBRO.NORMAL),
    id_contribuyente: Number(row?.id_contribuyente || 0),
    codigo_municipal: row?.codigo_municipal || null,
    total_orden: parseMonto(row?.total_orden, 0),
    cargo_reimpresion: parseMonto(row?.cargo_reimpresion, 0),
    observacion: row?.observacion || null,
    codigo_recibo: codigoRecibo > 0 ? codigoRecibo : null,
    cantidad_recibos: items.length,
    items,
    emisor: {
      id_usuario: row?.id_usuario_emite ? Number(row.id_usuario_emite) : null,
      username: row?.usuario_emite || null,
      nombre: row?.nombre_emite || null
    },
    contribuyente: {
      id_contribuyente: Number(row?.id_contribuyente || 0) || null,
      codigo_municipal: row?.codigo_municipal || null,
      nombre_completo: row?.nombre_contribuyente || null,
      dni_ruc: row?.dni_ruc || null,
      direccion: row?.direccion_contribuyente || null
    }
  };
};

app.post("/recibos", async (req, res) => {
  try {
    const { id_contribuyente, anio, mes, montos } = req.body;
    const periodo = validateReciboPeriodoNoFuturo(anio, mes);
    if (!periodo.ok) {
      return res.status(400).json({ error: periodo.error });
    }
    const predio = await pool.query(`
      SELECT
        p.id_predio,
        p.id_tarifa,
        COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.activo_sn)), ''), 'S') AS activo_sn,
        p.tarifa_agua,
        p.tarifa_desague,
        p.tarifa_limpieza,
        p.tarifa_admin,
        p.tarifa_extra,
        COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion
      FROM predios p
      JOIN contribuyentes c ON c.id_contribuyente = p.id_contribuyente
      WHERE p.id_contribuyente = $1
      LIMIT 1
    `, [id_contribuyente]);
    if (predio.rows.length === 0) return res.status(400).json({ error: "Usuario sin predio." });
    if (predio.rows[0].estado_conexion !== ESTADOS_CONEXION.CON_CONEXION) {
      return res.status(400).json({ error: "El contribuyente no tiene conexion activa para generar deuda." });
    }
    
    const base = {
      agua: parseMonto(predio.rows[0].tarifa_agua, AUTO_DEUDA_BASE.agua),
      desague: parseMonto(predio.rows[0].tarifa_desague, AUTO_DEUDA_BASE.desague),
      limpieza: parseMonto(predio.rows[0].tarifa_limpieza, AUTO_DEUDA_BASE.limpieza),
      admin: parseMonto(predio.rows[0].tarifa_admin, AUTO_DEUDA_BASE.admin) + parseMonto(predio.rows[0].tarifa_extra, 0)
    };
    const activoSN = normalizeSN(predio.rows[0].activo_sn, "S");
    const aguaHabilitado = activoSN === "S" && normalizeSN(predio.rows[0].agua_sn, "S") === "S";
    const desagueHabilitado = activoSN === "S" && normalizeSN(predio.rows[0].desague_sn, "S") === "S";
    const limpiezaHabilitado = activoSN === "S" && normalizeSN(predio.rows[0].limpieza_sn, "S") === "S";
    const subtotalAgua = aguaHabilitado ? parseMonto(montos?.agua, base.agua) : 0;
    const subtotalDesague = desagueHabilitado ? parseMonto(montos?.desague, base.desague) : 0;
    const subtotalLimpieza = limpiezaHabilitado ? parseMonto(montos?.limpieza, base.limpieza) : 0;
    const subtotalAdmin = activoSN === "S" ? parseMonto(montos?.admin, base.admin) : 0;
    if ([subtotalAgua, subtotalDesague, subtotalLimpieza, subtotalAdmin].some(v => v < 0)) {
      return res.status(400).json({ error: "Montos inválidos." });
    }
    const totalPagar = subtotalAgua + subtotalDesague + subtotalLimpieza + subtotalAdmin;
    if (totalPagar <= 0) {
      return res.status(400).json({ error: "Debe seleccionar al menos un servicio." });
    }

    const nuevoRecibo = await pool.query(
      `INSERT INTO recibos (id_predio, anio, mes, subtotal_agua, subtotal_desague, subtotal_limpieza, subtotal_admin, total_pagar, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDIENTE') RETURNING *`,
      [predio.rows[0].id_predio, periodo.anio, periodo.mes, subtotalAgua, subtotalDesague, subtotalLimpieza, subtotalAdmin, totalPagar]
    );
    invalidateContribuyentesCache();
    realtimeHub.broadcast("deuda", "recibo_generado", {
      id_contribuyente: Number(id_contribuyente || 0),
      id_recibo: Number(nuevoRecibo.rows?.[0]?.id_recibo || 0),
      origen: "recibos"
    });
    res.json(nuevoRecibo.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: "Ya existe recibo para ese mes." });
    res.status(500).send("Error");
  }
});

app.post("/recibos/generar-masivo", async (req, res) => {
  try {
    const { tipo_seleccion = "todos", ids_usuarios = [], id_calle, anio, mes, montos } = req.body;
    const periodo = validateReciboPeriodoNoFuturo(anio, mes);
    if (!periodo.ok) {
      return res.status(400).json({ error: periodo.error });
    }

    if (tipo_seleccion === "calle" && !id_calle) {
      return res.status(400).json({ error: "Seleccione una calle." });
    }
    if (tipo_seleccion === "seleccion" && (!Array.isArray(ids_usuarios) || ids_usuarios.length === 0)) {
      return res.status(400).json({ error: "Seleccione usuarios." });
    }

    const base = { agua: 7.5, desague: 3.5, limpieza: 3.5, admin: 0.5 };
    const subtotalAgua = parseMonto(montos?.agua, base.agua);
    const subtotalDesague = parseMonto(montos?.desague, base.desague);
    const subtotalLimpieza = parseMonto(montos?.limpieza, base.limpieza);
    const subtotalAdmin = parseMonto(montos?.admin, base.admin);
    if ([subtotalAgua, subtotalDesague, subtotalLimpieza, subtotalAdmin].some(v => v < 0)) {
      return res.status(400).json({ error: "Montos inválidos." });
    }
    const totalPagar = subtotalAgua + subtotalDesague + subtotalLimpieza + subtotalAdmin;
    if (totalPagar <= 0) {
      return res.status(400).json({ error: "Debe seleccionar al menos un servicio." });
    }

    let query = `
      INSERT INTO recibos (id_predio, anio, mes, subtotal_agua, subtotal_desague, subtotal_limpieza, subtotal_admin, total_pagar, estado)
      SELECT
        p.id_predio,
        $1,
        $2,
        CASE WHEN ${sqlSnEsSi("p.agua_sn", "S")} THEN COALESCE(p.tarifa_agua, $3) ELSE 0 END,
        CASE WHEN ${sqlSnEsSi("p.desague_sn", "S")} THEN COALESCE(p.tarifa_desague, $4) ELSE 0 END,
        CASE WHEN ${sqlSnEsSi("p.limpieza_sn", "S")} THEN COALESCE(p.tarifa_limpieza, $5) ELSE 0 END,
        CASE WHEN ${sqlSnEsSi("p.activo_sn", "S")} THEN (COALESCE(p.tarifa_admin, $6) + COALESCE(p.tarifa_extra, 0)) ELSE 0 END,
        (
          CASE WHEN ${sqlSnEsSi("p.agua_sn", "S")} THEN COALESCE(p.tarifa_agua, $3) ELSE 0 END +
          CASE WHEN ${sqlSnEsSi("p.desague_sn", "S")} THEN COALESCE(p.tarifa_desague, $4) ELSE 0 END +
          CASE WHEN ${sqlSnEsSi("p.limpieza_sn", "S")} THEN COALESCE(p.tarifa_limpieza, $5) ELSE 0 END +
          CASE WHEN ${sqlSnEsSi("p.activo_sn", "S")} THEN (COALESCE(p.tarifa_admin, $6) + COALESCE(p.tarifa_extra, 0)) ELSE 0 END
        ),
        'PENDIENTE'
      FROM predios p
      JOIN contribuyentes c ON c.id_contribuyente = p.id_contribuyente
    `;
    const params = [periodo.anio, periodo.mes, subtotalAgua, subtotalDesague, subtotalLimpieza, subtotalAdmin];
    const whereParts = [
      `${sqlSnEsSi("p.activo_sn", "S")}`,
      "COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') = 'CON_CONEXION'"
    ];

    if (tipo_seleccion === "calle") {
      whereParts.push(`p.id_calle = $${params.length + 1}`);
      params.push(id_calle);
    } else if (tipo_seleccion === "seleccion") {
      whereParts.push(`p.id_contribuyente = ANY($${params.length + 1})`);
      params.push(ids_usuarios);
    }

    query += ` WHERE ${whereParts.join(" AND ")}`;
    query += " ON CONFLICT DO NOTHING RETURNING id_recibo";
    const resultado = await pool.query(query, params);
    if (resultado.rowCount > 0) {
      invalidateContribuyentesCache();
      realtimeHub.broadcast("deuda", "recibo_generado", {
        id_contribuyente: null,
        total_recibos: Number(resultado.rowCount || 0),
        origen: "recibos_generar_masivo"
      });
    }
    res.json({ mensaje: `Recibos generados: ${resultado.rowCount}` });
  } catch (err) {
    res.status(500).send("Error al generar deuda masiva");
  }
});

app.get("/recibos/pendientes/:id_contribuyente", async (req, res) => {
  const client = await pool.connect();
  let txStarted = false;
  try {
    const idContribuyente = parsePositiveInt(req.params?.id_contribuyente, 0);
    if (!idContribuyente) {
      return res.status(400).json({ error: "ID de contribuyente inválido." });
    }
    const hoyIso = toISODate();
    const fechaCorte = normalizeDateOnly(req.query?.fecha_corte || req.query?.fecha || req.query?.fecha_pago) || hoyIso;
    if (fechaCorte > hoyIso) {
      return res.status(400).json({ error: "No se permite usar fecha de corte futura." });
    }
    const fechaBase = parseDateYearMonth(fechaCorte, parseDateYearMonth(hoyIso));
    const incluirAdelantados = normalizeSN(req.query?.incluir_adelantados, "N") === "S";
    const incluirFuturosExistentes = normalizeSN(req.query?.incluir_futuros_existentes, "N") === "S";
    const aplicarFiltroPermisosFuturos = normalizeSN(req.query?.solo_futuros_habilitados, "S") === "S";
    const adelantadoMeses = Math.min(24, Math.max(1, parsePositiveInt(req.query?.adelantado_meses, 12)));
    const anioActual = Number(fechaBase.anio || getCurrentYear());
    const mesActual = Number(fechaBase.mes || getCurrentMonth());
    const periodoActual = (anioActual * 100) + mesActual;

    await client.query("BEGIN");
    txStarted = true;

    let permisosFuturosSet = null;
    if (incluirAdelantados && aplicarFiltroPermisosFuturos) {
      await ensureCajaPermisosAdelantadoTable(client);
      const permisosRs = await client.query(`
        SELECT periodo_num
        FROM caja_permisos_adelantado
        WHERE id_contribuyente = $1
          AND estado = 'APROBADO'
          AND periodo_num > $2
      `, [idContribuyente, periodoActual]);
      permisosFuturosSet = new Set(
        permisosRs.rows
          .map((row) => Number(row?.periodo_num || 0))
          .filter((v) => Number.isInteger(v) && v > periodoActual)
      );
    }
    const filtrarRowsPorPermisos = (rows = []) => {
      if (!incluirAdelantados || !aplicarFiltroPermisosFuturos) return rows;
      const permisos = permisosFuturosSet || new Set();
      return rows.filter((row) => {
        const periodoNum = (Number(row?.anio || 0) * 100) + Number(row?.mes || 0);
        if (periodoNum <= periodoActual) return true;
        return permisos.has(periodoNum);
      });
    };

    // Auto-corrección preventiva: sincroniza recibos pendientes sin pagos con la tarifa/servicios vigentes.
    // Así evitamos cobros inconsistentes (por ejemplo, montos legacy desfasados) en cualquier contribuyente.
    await recalcularRecibosFuturosPorServicios(client, idContribuyente, {
      incluirPendientesHistoricos: true,
      desdePeriodoNum: 0
    });

    const whereParts = [
      "r.id_predio IN (SELECT id_predio FROM predios WHERE id_contribuyente = $1)",
      "(r.total_pagar - COALESCE(p.total_pagado, 0)) > 0"
    ];
    const params = [idContribuyente, fechaCorte];
    if (!incluirAdelantados) {
      params.push(anioActual, mesActual);
      whereParts.push("((r.anio < $3) OR (r.anio = $3 AND r.mes <= $4))");
    }
    const pendientes = await client.query(`
      SELECT r.id_recibo, r.mes, r.anio, r.subtotal_agua, r.subtotal_desague, r.subtotal_limpieza, r.subtotal_admin,
        r.total_pagar,
        COALESCE(p.total_pagado, 0) as abono_mes,
        GREATEST(r.total_pagar - COALESCE(p.total_pagado, 0), 0) as deuda_mes,
        CASE
          WHEN COALESCE(p.total_pagado, 0) >= r.total_pagar THEN 'PAGADO'
          WHEN COALESCE(p.total_pagado, 0) > 0 THEN 'PARCIAL'
          ELSE 'PENDIENTE'
        END as estado
      FROM recibos r
      LEFT JOIN (
        SELECT id_recibo, SUM(monto_pagado) as total_pagado
        FROM pagos
        WHERE DATE(fecha_pago) <= $2::date
        GROUP BY id_recibo
      ) p ON p.id_recibo = r.id_recibo
      WHERE ${whereParts.join(" AND ")}
      ORDER BY r.anio, r.mes
    `, params);
    if (!incluirAdelantados) {
      await client.query("COMMIT");
      txStarted = false;
      return res.json(pendientes.rows);
    }

    const predio = await client.query(`
      SELECT
        p.id_predio,
        COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.activo_sn)), ''), 'S') AS activo_sn,
        p.tarifa_agua,
        p.tarifa_desague,
        p.tarifa_limpieza,
        p.tarifa_admin,
        p.tarifa_extra,
        COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion
      FROM predios p
      JOIN contribuyentes c ON c.id_contribuyente = p.id_contribuyente
      WHERE p.id_contribuyente = $1
      ORDER BY p.id_predio ASC
      LIMIT 1
    `, [idContribuyente]);
    if (predio.rows.length === 0 || predio.rows[0].estado_conexion !== ESTADOS_CONEXION.CON_CONEXION) {
      const rows = filtrarRowsPorPermisos(pendientes.rows.map((row) => ({
        ...row,
        es_adelantado: (Number(row?.anio || 0) * 100 + Number(row?.mes || 0)) > periodoActual
      })));
      await client.query("COMMIT");
      txStarted = false;
      return res.json(rows);
    }

    const activoSN = normalizeSN(predio.rows[0].activo_sn, "S");
    const aguaHabilitado = activoSN === "S" && normalizeSN(predio.rows[0].agua_sn, "S") === "S";
    const desagueHabilitado = activoSN === "S" && normalizeSN(predio.rows[0].desague_sn, "S") === "S";
    const limpiezaHabilitado = activoSN === "S" && normalizeSN(predio.rows[0].limpieza_sn, "S") === "S";
    const subtotalBase = {
      agua: aguaHabilitado ? parseMonto(predio.rows[0].tarifa_agua, AUTO_DEUDA_BASE.agua) : 0,
      desague: desagueHabilitado ? parseMonto(predio.rows[0].tarifa_desague, AUTO_DEUDA_BASE.desague) : 0,
      limpieza: limpiezaHabilitado ? parseMonto(predio.rows[0].tarifa_limpieza, AUTO_DEUDA_BASE.limpieza) : 0,
      admin: activoSN === "S"
        ? parseMonto(predio.rows[0].tarifa_admin, AUTO_DEUDA_BASE.admin) + parseMonto(predio.rows[0].tarifa_extra, 0)
        : 0
    };
    const totalBase = roundMonto2(subtotalBase.agua + subtotalBase.desague + subtotalBase.limpieza + subtotalBase.admin);
    const rows = filtrarRowsPorPermisos(pendientes.rows.map((row) => ({
      ...row,
      es_adelantado: (Number(row?.anio || 0) * 100 + Number(row?.mes || 0)) > periodoActual
    })));
    if (incluirFuturosExistentes) {
      await client.query("COMMIT");
      txStarted = false;
      return res.json(rows);
    }
    if (totalBase <= 0) {
      await client.query("COMMIT");
      txStarted = false;
      return res.json(rows);
    }

    const existing = new Set(
      rows.map((row) => `${Number(row?.anio || 0)}-${Number(row?.mes || 0)}`)
    );
    // Incluir tambien el mes de la fecha de corte (no solo el siguiente),
    // para que periodos faltantes del mes actual se puedan cobrar/corregir.
    const startPeriodoDate = new Date(Date.UTC(anioActual, mesActual - 1, 1));
    const startPeriodo = {
      anio: startPeriodoDate.getUTCFullYear(),
      mes: startPeriodoDate.getUTCMonth() + 1
    };
    if (idContribuyente > 0) {
      const endPeriodoDate = new Date(Date.UTC(startPeriodo.anio, (startPeriodo.mes - 1) + Math.max(0, adelantadoMeses - 1), 1));
      const periodosExistentesRs = await client.query(`
        SELECT DISTINCT r.anio, r.mes
        FROM recibos r
        JOIN predios p ON p.id_predio = r.id_predio
        WHERE p.id_contribuyente = $1
          AND ((r.anio > $2) OR (r.anio = $2 AND r.mes >= $3))
          AND ((r.anio < $4) OR (r.anio = $4 AND r.mes <= $5))
      `, [
        idContribuyente,
        startPeriodo.anio,
        startPeriodo.mes,
        endPeriodoDate.getUTCFullYear(),
        endPeriodoDate.getUTCMonth() + 1
      ]);
      for (const row of periodosExistentesRs.rows) {
        existing.add(`${Number(row?.anio || 0)}-${Number(row?.mes || 0)}`);
      }
    }
    for (let i = 0; i < adelantadoMeses; i += 1) {
      const dt = new Date(startPeriodo.anio, (startPeriodo.mes - 1) + i, 1);
      const anio = dt.getFullYear();
      const mes = dt.getMonth() + 1;
      const key = `${anio}-${mes}`;
      if (existing.has(key)) continue;
      const periodoNum = (anio * 100) + mes;
      if (periodoNum > periodoActual && incluirAdelantados && aplicarFiltroPermisosFuturos) {
        if (!permisosFuturosSet || !permisosFuturosSet.has(periodoNum)) {
          continue;
        }
      }
      rows.push({
        id_recibo: null,
        mes,
        anio,
        subtotal_agua: subtotalBase.agua,
        subtotal_desague: subtotalBase.desague,
        subtotal_limpieza: subtotalBase.limpieza,
        subtotal_admin: subtotalBase.admin,
        total_pagar: totalBase,
        abono_mes: 0,
        deuda_mes: totalBase,
        estado: "ADELANTADO",
        es_adelantado: true
      });
    }
    rows.sort((a, b) => ((Number(a.anio || 0) * 100 + Number(a.mes || 0)) - (Number(b.anio || 0) * 100 + Number(b.mes || 0))));
    await client.query("COMMIT");
    txStarted = false;
    return res.json(rows);
  } catch (err) {
    if (txStarted) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    console.error("Error obteniendo recibos pendientes:", err.message);
    return res.status(500).send("Error");
  } finally {
    client.release();
  }
});

app.post("/caja/permisos-adelantado/solicitar", async (req, res) => {
  const client = await pool.connect();
  let txStarted = false;
  try {
    const idContribuyente = parsePositiveInt(req.body?.id_contribuyente, 0);
    if (!idContribuyente) {
      return res.status(400).json({ error: "ID de contribuyente inválido." });
    }
    const anioBase = parsePositiveInt(req.body?.anio, 0);
    const periodosRaw = Array.isArray(req.body?.periodos)
      ? req.body.periodos
      : (Array.isArray(req.body?.meses)
        ? req.body.meses.map((mes) => ({ anio: anioBase, mes }))
        : []);
    const periodos = sanitizePeriodosAdelantados(periodosRaw);
    if (periodos.length === 0) {
      return res.status(400).json({ error: "Debe indicar al menos un periodo válido (mes/año)." });
    }
    const periodoActual = getCurrentPeriodoNum();
    const periodosFuturos = periodos.filter((p) => Number(p.periodo_num || 0) > periodoActual);
    if (periodosFuturos.length === 0) {
      return res.status(400).json({ error: "Solo se pueden habilitar periodos futuros para Caja." });
    }
    const motivo = normalizeLimitedText(
      req.body?.motivo,
      500
    ) || "Habilitacion desde ventanilla para cobro adelantado en Caja.";
    const origen = normalizeLimitedText(req.body?.origen, 40).toUpperCase() || "VENTANILLA_REIMPRESION";

    await client.query("BEGIN");
    txStarted = true;
    await ensureCajaPermisosAdelantadoTable(client);
    const contribData = await client.query(`
      SELECT id_contribuyente, codigo_municipal, nombre_completo
      FROM contribuyentes
      WHERE id_contribuyente = $1
      LIMIT 1
    `, [idContribuyente]);
    if (contribData.rows.length === 0) {
      await client.query("ROLLBACK");
      txStarted = false;
      return res.status(404).json({ error: "Contribuyente no encontrado." });
    }

    const creados = [];
    for (const p of periodosFuturos) {
      const upsert = await client.query(`
        INSERT INTO caja_permisos_adelantado (
          id_contribuyente, anio, mes, periodo_num, estado, origen, motivo, id_usuario_solicita, metadata
        )
        VALUES ($1, $2, $3, $4, 'APROBADO', $5, $6, $7, $8::jsonb)
        ON CONFLICT (id_contribuyente, anio, mes)
        DO UPDATE
           SET periodo_num = EXCLUDED.periodo_num,
               estado = 'APROBADO',
               origen = EXCLUDED.origen,
               motivo = EXCLUDED.motivo,
               id_usuario_solicita = EXCLUDED.id_usuario_solicita,
               metadata = COALESCE(caja_permisos_adelantado.metadata, '{}'::jsonb) || EXCLUDED.metadata,
               actualizado_en = NOW()
        RETURNING id_permiso, anio, mes, periodo_num, estado, creado_en, actualizado_en
      `, [
        idContribuyente,
        Number(p.anio),
        Number(p.mes),
        Number(p.periodo_num),
        origen,
        motivo,
        req.user?.id_usuario || null,
        JSON.stringify({
          fuente: "ventanilla",
          operacion: "reimpresion",
          usuario: req.user?.username || req.user?.nombre || null
        })
      ]);
      if (upsert.rows.length > 0) {
        const row = upsert.rows[0];
        creados.push({
          id_permiso: Number(row.id_permiso || 0),
          anio: Number(row.anio || 0),
          mes: Number(row.mes || 0),
          periodo_num: Number(row.periodo_num || 0),
          estado: row.estado || "APROBADO",
          creado_en: row.creado_en || null,
          actualizado_en: row.actualizado_en || null
        });
      }
    }

    await registrarAuditoria(
      client,
      "CAJA_PERMISO_ADELANTADO",
      `contribuyente=${contribData.rows[0].codigo_municipal || idContribuyente}; periodos=${creados.map((p) => `${String(p.mes).padStart(2, "0")}/${p.anio}`).join(",")}; origen=${origen}`,
      req.user?.nombre || req.user?.username || "SISTEMA"
    );

    await client.query("COMMIT");
    txStarted = false;

    realtimeHub.broadcast("caja", "permiso_adelantado_habilitado", {
      id_contribuyente: idContribuyente,
      codigo_municipal: contribData.rows[0].codigo_municipal || null,
      nombre_completo: contribData.rows[0].nombre_completo || null,
      periodos: creados.map((p) => ({ anio: p.anio, mes: p.mes })),
      total_periodos: creados.length,
      origen
    });

    return res.json({
      mensaje: `Se habilitaron ${creados.length} periodo(s) futuro(s) en Caja para el contribuyente.`,
      id_contribuyente: idContribuyente,
      periodos: creados
    });
  } catch (err) {
    if (txStarted) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    console.error("Error registrando permisos adelantados de caja:", err);
    return res.status(500).json({ error: "Error registrando permisos de meses adelantados para Caja." });
  } finally {
    client.release();
  }
});

app.get("/caja/permisos-adelantado/:id_contribuyente", async (req, res) => {
  const client = await pool.connect();
  try {
    const idContribuyente = parsePositiveInt(req.params?.id_contribuyente, 0);
    if (!idContribuyente) {
      return res.status(400).json({ error: "ID de contribuyente inválido." });
    }
    await ensureCajaPermisosAdelantadoTable(client);
    const ahoraPeriodo = getCurrentPeriodoNum();
    const data = await client.query(`
      SELECT
        id_permiso,
        creado_en,
        actualizado_en,
        id_contribuyente,
        anio,
        mes,
        periodo_num,
        estado,
        origen,
        motivo
      FROM caja_permisos_adelantado
      WHERE id_contribuyente = $1
        AND estado = 'APROBADO'
        AND periodo_num > $2
      ORDER BY periodo_num ASC, id_permiso ASC
    `, [idContribuyente, ahoraPeriodo]);
    return res.json({
      items: data.rows.map((row) => ({
        id_permiso: Number(row.id_permiso || 0),
        creado_en: row.creado_en || null,
        actualizado_en: row.actualizado_en || null,
        id_contribuyente: Number(row.id_contribuyente || 0),
        anio: Number(row.anio || 0),
        mes: Number(row.mes || 0),
        periodo_num: Number(row.periodo_num || 0),
        estado: row.estado || "APROBADO",
        origen: row.origen || "",
        motivo: row.motivo || ""
      }))
    });
  } catch (err) {
    console.error("Error listando permisos adelantados de caja:", err);
    return res.status(500).json({ error: "Error listando permisos adelantados de Caja." });
  } finally {
    client.release();
  }
});

app.post("/caja/ordenes-cobro", async (req, res) => {
  const client = await pool.connect();
  try {
    const idContribuyente = parsePositiveInt(req.body?.id_contribuyente, 0);
    const codigoReciboDigitado = normalizeCodigoReciboInput(req.body?.codigo_recibo);
    const observacion = normalizeLimitedText(req.body?.observacion, 500) || null;
    const tipoOrden = normalizeTipoOrdenCobro(req.body?.tipo_orden, TIPOS_ORDEN_COBRO.NORMAL);
    const periodosAdelantados = sanitizePeriodosAdelantados(
      req.body?.periodos
      || req.body?.meses_adelantados
      || req.body?.meses
      || []
    );
    let items = sanitizeOrdenCobroItems(req.body?.items);
    if (!idContribuyente) {
      return res.status(400).json({ error: "Contribuyente invalido." });
    }
    if (tipoOrden === TIPOS_ORDEN_COBRO.NORMAL && items.length === 0) {
      return res.status(400).json({ error: "Debe incluir al menos un recibo con monto autorizado." });
    }
    if (tipoOrden === TIPOS_ORDEN_COBRO.ADELANTADO && periodosAdelantados.length === 0) {
      return res.status(400).json({ error: "Seleccione al menos un periodo para el pago adelantado." });
    }

    await client.query("BEGIN");
    await ensureOrdenesCobroTable(client);

    const contrib = await client.query(`
      SELECT
        id_contribuyente,
        codigo_municipal,
        nombre_completo,
        sec_nombre,
        dni_ruc
      FROM contribuyentes
      WHERE id_contribuyente = $1
      LIMIT 1
    `, [idContribuyente]);
    if (contrib.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contribuyente no encontrado." });
    }

    if (tipoOrden === TIPOS_ORDEN_COBRO.ADELANTADO) {
      const periodoActualNum = getCurrentPeriodoNum();
      const periodoInvalido = periodosAdelantados.find((p) => Number(p.periodo_num || 0) <= periodoActualNum);
      if (periodoInvalido) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `El periodo ${periodoInvalido.mes}/${periodoInvalido.anio} no es futuro para pago adelantado.`
        });
      }

      const predioInfo = await client.query(`
        SELECT
          p.id_predio,
          COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.activo_sn)), ''), 'S') AS activo_sn,
          p.tarifa_agua,
          p.tarifa_desague,
          p.tarifa_limpieza,
          p.tarifa_admin,
          p.tarifa_extra,
          COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion
        FROM predios p
        JOIN contribuyentes c ON c.id_contribuyente = p.id_contribuyente
        WHERE p.id_contribuyente = $1
        ORDER BY p.id_predio ASC
        LIMIT 1
      `, [idContribuyente]);
      if (predioInfo.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "El contribuyente no tiene predio para generar pago adelantado." });
      }
      if (predioInfo.rows[0].estado_conexion !== ESTADOS_CONEXION.CON_CONEXION) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "El contribuyente no tiene conexion activa para generar pago adelantado." });
      }

      const idPredio = Number(predioInfo.rows[0].id_predio || 0);
      const activoSN = normalizeSN(predioInfo.rows[0].activo_sn, "S");
      const aguaHabilitado = activoSN === "S" && normalizeSN(predioInfo.rows[0].agua_sn, "S") === "S";
      const desagueHabilitado = activoSN === "S" && normalizeSN(predioInfo.rows[0].desague_sn, "S") === "S";
      const limpiezaHabilitado = activoSN === "S" && normalizeSN(predioInfo.rows[0].limpieza_sn, "S") === "S";
      const subtotalBase = {
        agua: aguaHabilitado ? parseMonto(predioInfo.rows[0].tarifa_agua, AUTO_DEUDA_BASE.agua) : 0,
        desague: desagueHabilitado ? parseMonto(predioInfo.rows[0].tarifa_desague, AUTO_DEUDA_BASE.desague) : 0,
        limpieza: limpiezaHabilitado ? parseMonto(predioInfo.rows[0].tarifa_limpieza, AUTO_DEUDA_BASE.limpieza) : 0,
        admin: activoSN === "S"
          ? parseMonto(predioInfo.rows[0].tarifa_admin, AUTO_DEUDA_BASE.admin) + parseMonto(predioInfo.rows[0].tarifa_extra, 0)
          : 0
      };
      const totalBase = roundMonto2(subtotalBase.agua + subtotalBase.desague + subtotalBase.limpieza + subtotalBase.admin);
      if (totalBase <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "No se pudo determinar tarifa base para pago adelantado." });
      }

      const periodosNum = periodosAdelantados.map((p) => Number(p.periodo_num || 0));
      const recibosExistentes = await client.query(`
        WITH pagos_agg AS (
          SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
          FROM pagos
          GROUP BY id_recibo
        )
        SELECT
          r.id_recibo,
          r.anio,
          r.mes,
          r.total_pagar,
          r.subtotal_agua,
          r.subtotal_desague,
          r.subtotal_limpieza,
          r.subtotal_admin,
          COALESCE(pa.total_pagado, 0) AS total_pagado
        FROM recibos r
        LEFT JOIN pagos_agg pa ON pa.id_recibo = r.id_recibo
        WHERE r.id_predio = $1
          AND ((r.anio * 100) + r.mes) = ANY($2::int[])
        FOR UPDATE OF r
      `, [idPredio, periodosNum]);
      const reciboPorPeriodo = new Map(recibosExistentes.rows.map((r) => [Number(r.anio) * 100 + Number(r.mes), r]));

      for (const periodo of periodosAdelantados) {
        const key = Number(periodo.periodo_num || 0);
        if (reciboPorPeriodo.has(key)) continue;
        try {
          const insertedRecibo = await client.query(`
            INSERT INTO recibos (
              id_predio, anio, mes, subtotal_agua, subtotal_desague, subtotal_limpieza, subtotal_admin, total_pagar, estado
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDIENTE')
            RETURNING id_recibo, anio, mes, total_pagar, subtotal_agua, subtotal_desague, subtotal_limpieza, subtotal_admin
          `, [
            idPredio,
            periodo.anio,
            periodo.mes,
            subtotalBase.agua,
            subtotalBase.desague,
            subtotalBase.limpieza,
            subtotalBase.admin,
            totalBase
          ]);
          const rec = insertedRecibo.rows[0];
          if (rec) {
            reciboPorPeriodo.set(key, {
              ...rec,
              total_pagado: 0
            });
          }
        } catch (insertErr) {
          if (insertErr?.code !== "23505") throw insertErr;
          const existente = await client.query(`
            WITH pagos_agg AS (
              SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
              FROM pagos
              GROUP BY id_recibo
            )
            SELECT
              r.id_recibo,
              r.anio,
              r.mes,
              r.total_pagar,
              r.subtotal_agua,
              r.subtotal_desague,
              r.subtotal_limpieza,
              r.subtotal_admin,
              COALESCE(pa.total_pagado, 0) AS total_pagado
            FROM recibos r
            LEFT JOIN pagos_agg pa ON pa.id_recibo = r.id_recibo
            WHERE r.id_predio = $1
              AND r.anio = $2
              AND r.mes = $3
            FOR UPDATE OF r
            LIMIT 1
          `, [idPredio, periodo.anio, periodo.mes]);
          if (existente.rows[0]) {
            reciboPorPeriodo.set(key, existente.rows[0]);
          }
        }
      }

      items = periodosAdelantados.map((periodo) => {
        const key = Number(periodo.periodo_num || 0);
        const row = reciboPorPeriodo.get(key);
        if (!row) return null;
        const totalPagar = parseMonto(row.total_pagar, 0);
        const totalPagado = parseMonto(row.total_pagado, 0);
        const saldo = roundMonto2(Math.max(totalPagar - totalPagado, 0));
        if (saldo <= 0.001) return null;
        return {
          id_recibo: Number(row.id_recibo),
          mes: Number(periodo.mes),
          anio: Number(periodo.anio),
          monto_autorizado: saldo,
          subtotal_agua: parseMonto(row.subtotal_agua, 0),
          subtotal_desague: parseMonto(row.subtotal_desague, 0),
          subtotal_limpieza: parseMonto(row.subtotal_limpieza, 0),
          subtotal_admin: parseMonto(row.subtotal_admin, 0)
        };
      }).filter(Boolean);
      if (items.length === 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Los periodos adelantados seleccionados ya se encuentran cancelados." });
      }
    }

    const idsRecibos = items.map((r) => r.id_recibo);
    const codigoRecibo = codigoReciboDigitado || idsRecibos[0] || 0;
    if (!codigoRecibo) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No se pudo determinar recibo de referencia para la orden." });
    }
    const ordenPendienteSolapada = await client.query(`
      SELECT oc.id_orden
      FROM ordenes_cobro oc
      WHERE oc.estado = 'PENDIENTE'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(oc.recibos_json) elem
          WHERE (elem->>'id_recibo') ~ '^[0-9]+$'
            AND ((elem->>'id_recibo')::int = ANY($1::int[]))
        )
      LIMIT 1
    `, [idsRecibos]);
    if (ordenPendienteSolapada.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: `Ya existe una orden pendiente para al menos un recibo seleccionado (orden ${ordenPendienteSolapada.rows[0].id_orden}).`
      });
    }

    const recibosRows = await client.query(`
      WITH pagos_agg AS (
        SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
        FROM pagos
        WHERE id_recibo = ANY($2::int[])
        GROUP BY id_recibo
      )
      SELECT
        r.id_recibo,
        r.mes,
        r.anio,
        r.total_pagar,
        r.subtotal_agua,
        r.subtotal_desague,
        r.subtotal_limpieza,
        r.subtotal_admin,
        COALESCE(pa.total_pagado, 0) AS total_pagado
      FROM recibos r
      INNER JOIN predios p ON p.id_predio = r.id_predio
      LEFT JOIN pagos_agg pa ON pa.id_recibo = r.id_recibo
      WHERE p.id_contribuyente = $1
        AND r.id_recibo = ANY($2::int[])
      FOR UPDATE OF r
    `, [idContribuyente, idsRecibos]);
    if (recibosRows.rows.length !== idsRecibos.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Uno o mas recibos no pertenecen al contribuyente seleccionado." });
    }

    const recibosMap = new Map(recibosRows.rows.map((r) => [Number(r.id_recibo), r]));
    const detalleOrden = [];
    for (const item of items) {
      const row = recibosMap.get(item.id_recibo);
      if (!row) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Recibo ${item.id_recibo} no valido para el contribuyente.` });
      }
      const totalPagar = parseMonto(row.total_pagar, 0);
      const totalPagado = parseMonto(row.total_pagado, 0);
      const saldo = roundMonto2(Math.max(totalPagar - totalPagado, 0));
      if (saldo <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `El recibo ${item.id_recibo} ya no tiene saldo pendiente.` });
      }
      if (item.monto_autorizado > saldo + 0.001) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Monto autorizado excede saldo del recibo ${item.id_recibo}.`,
          saldo_disponible: saldo
        });
      }

      let agua = parseSubtotalOrden(item.subtotal_agua);
      let desague = parseSubtotalOrden(item.subtotal_desague);
      let limpieza = parseSubtotalOrden(item.subtotal_limpieza);
      let admin = parseSubtotalOrden(item.subtotal_admin);
      const baseDetalle = agua + desague + limpieza + admin;
      if (baseDetalle > 0) {
        const factor = item.monto_autorizado / baseDetalle;
        agua = roundMonto2(agua * factor);
        desague = roundMonto2(desague * factor);
        limpieza = roundMonto2(limpieza * factor);
        admin = roundMonto2(admin * factor);
        const ajuste = roundMonto2(item.monto_autorizado - (agua + desague + limpieza + admin));
        admin = roundMonto2(admin + ajuste);
      } else {
        agua = roundMonto2(item.monto_autorizado);
        desague = 0;
        limpieza = 0;
        admin = 0;
      }

      detalleOrden.push({
        id_recibo: item.id_recibo,
        mes: parsePositiveInt(item.mes, 0) || Number(row.mes),
        anio: parsePositiveInt(item.anio, 0) || Number(row.anio),
        monto_autorizado: roundMonto2(item.monto_autorizado),
        saldo_al_emitir: saldo,
        subtotal_agua: agua,
        subtotal_desague: desague,
        subtotal_limpieza: limpieza,
        subtotal_admin: admin
      });
    }

    const totalOrden = roundMonto2(detalleOrden.reduce((acc, r) => acc + parseMonto(r.monto_autorizado, 0), 0));
    if (totalOrden <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Total de orden invalido." });
    }

    const insertOrden = await client.query(`
      INSERT INTO ordenes_cobro (
        estado,
        tipo_orden,
        id_usuario_emite,
        id_contribuyente,
        codigo_municipal,
        codigo_recibo,
        total_orden,
        recibos_json,
        observacion,
        cargo_reimpresion,
        motivo_cargo_reimpresion
      )
      VALUES ('PENDIENTE', $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
      RETURNING id_orden, creado_en, actualizado_en, estado, tipo_orden, total_orden, codigo_municipal, codigo_recibo, cargo_reimpresion, recibos_json, id_usuario_emite
    `, [
      tipoOrden,
      req.user?.id_usuario || null,
      idContribuyente,
      contrib.rows[0].codigo_municipal || null,
      codigoRecibo,
      totalOrden,
      JSON.stringify(detalleOrden),
      observacion,
      0,
      null
    ]);

    const orden = insertOrden.rows[0];
    const usuarioAuditoria = req.user?.username || req.user?.nombre || "SISTEMA";
    const ip = getRequestIp(req);
    await registrarAuditoria(
      client,
      "ORDEN_COBRO_EMITIDA",
      `orden=${orden.id_orden}; tipo=${tipoOrden}; codigo_recibo=${codigoRecibo}; contribuyente=${idContribuyente}; total=${totalOrden.toFixed(2)}; cargo_reimpresion=0.00; recibos=${detalleOrden.length}; ip=${ip}`,
      usuarioAuditoria
    );

    await client.query("COMMIT");
    realtimeHub.broadcast("caja", "orden_emitida", {
      id_orden: Number(orden.id_orden || 0),
      id_contribuyente: Number(idContribuyente || 0)
    });
    res.json({
      mensaje: "Orden de cobro emitida.",
      orden: {
        ...buildOrdenCobroResponse({
          ...orden,
          id_contribuyente: idContribuyente,
          nombre_contribuyente: String(contrib.rows[0]?.nombre_completo || "").trim()
            || String(contrib.rows[0]?.sec_nombre || "").trim()
            || null,
          dni_ruc: contrib.rows[0]?.dni_ruc || null,
          observacion,
          usuario_emite: req.user?.username || null,
          nombre_emite: req.user?.nombre || null
        }),
        items: detalleOrden
      }
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error creando orden de cobro:", err.message);
    res.status(500).json({ error: "Error creando orden de cobro." });
  } finally {
    client.release();
  }
});

app.get("/caja/ordenes-cobro/pendientes", async (req, res) => {
  try {
    const idContribuyente = parsePositiveInt(req.query?.id_contribuyente, 0);
    const codigoMunicipal = normalizeLimitedText(req.query?.codigo_municipal, 32);
    const tipoOrdenFiltro = normalizeTipoOrdenCobro(req.query?.tipo_orden, "");
    const limit = Math.min(200, Math.max(10, parsePositiveInt(req.query?.limit, 50)));
    const params = [limit];
    const where = [`oc.estado = 'PENDIENTE'`];
    if (idContribuyente) {
      params.push(idContribuyente);
      where.push(`oc.id_contribuyente = $${params.length}`);
    }
    if (codigoMunicipal) {
      params.push(codigoMunicipal);
      where.push(`oc.codigo_municipal = $${params.length}`);
    }
    if (tipoOrdenFiltro === TIPOS_ORDEN_COBRO.NORMAL || tipoOrdenFiltro === TIPOS_ORDEN_COBRO.ADELANTADO) {
      params.push(tipoOrdenFiltro);
      where.push(`oc.tipo_orden = $${params.length}`);
    }

    const resultado = await pool.query(`
      SELECT
        oc.id_orden,
        oc.creado_en,
        oc.actualizado_en,
        oc.estado,
        oc.tipo_orden,
        oc.id_contribuyente,
        oc.codigo_municipal,
        oc.codigo_recibo,
        oc.total_orden,
        oc.cargo_reimpresion,
        oc.observacion,
        oc.recibos_json,
        oc.id_usuario_emite,
        COALESCE(
          NULLIF(TRIM(cdata.nombre_completo), ''),
          NULLIF(TRIM(cdata.sec_nombre), ''),
          ''
        ) AS nombre_contribuyente,
        COALESCE(cdata.dni_ruc, '') AS dni_ruc,
        ${buildDireccionSql("ca", "pr")} AS direccion_contribuyente,
        COALESCE(ue.username, '') AS usuario_emite,
        COALESCE(ue.nombre_completo, '') AS nombre_emite
      FROM ordenes_cobro oc
      LEFT JOIN usuarios_sistema ue ON ue.id_usuario = oc.id_usuario_emite
      LEFT JOIN LATERAL (
        SELECT
          c.id_contribuyente,
          c.codigo_municipal,
          c.nombre_completo,
          c.sec_nombre,
          c.dni_ruc
        FROM contribuyentes c
        WHERE (
          oc.id_contribuyente IS NOT NULL
          AND c.id_contribuyente = oc.id_contribuyente
        ) OR (
          oc.id_contribuyente IS NULL
          AND NULLIF(TRIM(COALESCE(oc.codigo_municipal, '')), '') IS NOT NULL
          AND c.codigo_municipal = oc.codigo_municipal
        )
        ORDER BY
          CASE WHEN c.id_contribuyente = oc.id_contribuyente THEN 0 ELSE 1 END ASC,
          c.id_contribuyente DESC
        LIMIT 1
      ) cdata ON TRUE
      LEFT JOIN LATERAL (
        SELECT id_predio, id_calle, numero_casa, manzana, lote, referencia_direccion
        FROM predios
        WHERE id_contribuyente = COALESCE(oc.id_contribuyente, cdata.id_contribuyente)
        ORDER BY id_predio ASC
        LIMIT 1
      ) pr ON TRUE
      LEFT JOIN calles ca ON ca.id_calle = pr.id_calle
      WHERE ${where.join(" AND ")}
      ORDER BY oc.creado_en DESC, oc.id_orden DESC
      LIMIT $1
    `, params);

    const data = resultado.rows.map((r) => buildOrdenCobroResponse(r));
    res.json(data);
  } catch (err) {
    console.error("Error listando ordenes pendientes:", err.message);
    res.status(500).json({ error: "Error listando ordenes pendientes." });
  }
});

app.get("/caja/ordenes-cobro", async (req, res) => {
  try {
    const query = new URLSearchParams(req.query || {}).toString();
    const destino = query
      ? `/caja/ordenes-cobro/pendientes?${query}`
      : "/caja/ordenes-cobro/pendientes";
    return res.redirect(307, destino);
  } catch (err) {
    console.error("Error redireccionando ordenes de cobro:", err.message);
    return res.status(500).json({ error: "Error listando ordenes pendientes." });
  }
});

app.get("/caja/ordenes-cobro/resumen-pendientes", async (req, res) => {
  try {
    const tipoOrdenFiltro = normalizeTipoOrdenCobro(req.query?.tipo_orden, "");
    const params = [];
    const where = [`estado = 'PENDIENTE'`];
    if (tipoOrdenFiltro === TIPOS_ORDEN_COBRO.NORMAL || tipoOrdenFiltro === TIPOS_ORDEN_COBRO.ADELANTADO) {
      params.push(tipoOrdenFiltro);
      where.push(`tipo_orden = $${params.length}`);
    }
    const data = await pool.query(`
      SELECT
        COUNT(*)::int AS total_ordenes,
        COALESCE(SUM(total_orden), 0) AS total_monto,
        COUNT(DISTINCT id_contribuyente)::int AS total_contribuyentes
      FROM ordenes_cobro
      WHERE ${where.join(" AND ")}
    `, params);
    const row = data.rows[0] || {};
    res.json({
      total_ordenes: Number(row.total_ordenes || 0),
      total_monto: parseMonto(row.total_monto, 0),
      total_contribuyentes: Number(row.total_contribuyentes || 0)
    });
  } catch (err) {
    console.error("Error obteniendo resumen de ordenes pendientes:", err.message);
    res.status(500).json({ error: "Error obteniendo resumen de ordenes pendientes." });
  }
});

app.get("/caja/conteo-efectivo/resumen", async (req, res) => {
  try {
    const hoy = toISODate();
    const fecha = normalizeDateOnly(req.query?.fecha) || hoy;
    if (fecha > hoy) {
      return res.status(400).json({ error: "No se permite consultar conteo de efectivo con fecha futura." });
    }
    const data = await buildConteoEfectivoResumen(fecha);
    return res.json(data);
  } catch (err) {
    console.error("Error consultando resumen de conteo de efectivo:", err.message);
    return res.status(500).json({ error: "Error consultando conteo de efectivo." });
  }
});

app.post("/caja/conteo-efectivo", async (req, res) => {
  const client = await pool.connect();
  try {
    const hoy = toISODate();
    const fecha = normalizeDateOnly(req.body?.fecha) || hoy;
    if (fecha !== hoy) {
      return res.status(400).json({ error: "Solo se permite registrar conteo de efectivo para la fecha actual." });
    }
    const montoEfectivoRaw = parseMonto(req.body?.monto_efectivo, Number.NaN);
    const montoEfectivo = Number.isFinite(montoEfectivoRaw) ? roundMonto2(montoEfectivoRaw) : Number.NaN;
    if (!Number.isFinite(montoEfectivo) || montoEfectivo < 0) {
      return res.status(400).json({ error: "Monto de conteo invalido." });
    }
    const observacion = normalizeLimitedText(req.body?.observacion, 500) || null;
    const cerrarCaja = normalizeSN(req.body?.cerrar_caja, "S") === "S";

    await client.query("BEGIN");
    await ensureCajaCierresTable(client);
    await ensureCajaConteosEfectivoTable(client);

    if (cerrarCaja) {
      const cierreActual = await consultarCierreCajaBloqueante(client, fecha);
      if (cierreActual.cerrada) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "La caja de agua ya fue cerrada para hoy. No se permiten más cobros hasta el siguiente día."
        });
      }
    }

    await client.query(
      `UPDATE caja_conteos_efectivo
       SET estado = $2,
           actualizado_en = NOW()
       WHERE fecha_referencia = $1::date
         AND estado = $3`,
      [fecha, ESTADOS_CONTEO_EFECTIVO.ANULADO, ESTADOS_CONTEO_EFECTIVO.PENDIENTE]
    );

    const inserted = await client.query(
      `INSERT INTO caja_conteos_efectivo (
        id_usuario,
        fecha_referencia,
        monto_efectivo,
        estado,
        observacion,
        id_cierre
      )
      VALUES ($1, $2::date, $3, $4, $5, NULL)
      RETURNING
        id_conteo,
        creado_en,
        actualizado_en,
        fecha_referencia,
        monto_efectivo,
        estado,
        observacion,
        id_cierre`,
      [
        req.user?.id_usuario || null,
        fecha,
        montoEfectivo,
        ESTADOS_CONTEO_EFECTIVO.PENDIENTE,
        observacion
      ]
    );
    let row = inserted.rows[0];
    let cierreRow = null;
    if (cerrarCaja) {
      const tipo = "diario";
      const umbralAlerta = Math.max(0, roundMonto2(parseMonto(req.body?.umbral_alerta, CAJA_CIERRE_ALERTA_UMBRAL)));
      const resumenSistema = await construirResumenCaja(tipo, fecha);
      const totalSistema = roundMonto2(parseMonto(resumenSistema?.total, 0));
      const desviacion = roundMonto2(montoEfectivo - totalSistema);
      const alerta = Math.abs(desviacion) > umbralAlerta + 0.001;
      const rango = await obtenerRangoCaja(tipo, fecha);
      const existente = await client.query(
        `SELECT id_cierre
         FROM caja_cierres
         WHERE tipo = 'diario' AND fecha_referencia = $1::date
         ORDER BY id_cierre DESC
         LIMIT 1
         FOR UPDATE`,
        [fecha]
      );
      const sqlCommonReturning = `
        RETURNING
          id_cierre,
          creado_en,
          tipo,
          fecha_referencia,
          desde,
          hasta_exclusivo,
          total_sistema,
          efectivo_declarado,
          desviacion,
          alerta_desviacion_sn,
          cierre_bloquea_sn,
          observacion
      `;
      if (existente.rows[0]) {
        const updated = await client.query(
          `UPDATE caja_cierres
           SET id_usuario = $2,
               desde = $3::date,
               hasta_exclusivo = $4::date,
               total_sistema = $5,
               efectivo_declarado = $6,
               desviacion = $7,
               alerta_desviacion_sn = $8,
               cierre_bloquea_sn = 'S',
               observacion = $9
           WHERE id_cierre = $1
           ${sqlCommonReturning}`,
          [
            Number(existente.rows[0].id_cierre),
            req.user?.id_usuario || null,
            rango?.desde || fecha,
            rango?.hasta || fecha,
            totalSistema,
            montoEfectivo,
            desviacion,
            alerta ? "S" : "N",
            observacion || "CIERRE_DESDE_CONTEO_EFECTIVO"
          ]
        );
        cierreRow = updated.rows[0] || null;
      } else {
        const insertedCierre = await client.query(
          `INSERT INTO caja_cierres (
            id_usuario,
            tipo,
            fecha_referencia,
            desde,
            hasta_exclusivo,
            total_sistema,
            efectivo_declarado,
            desviacion,
            alerta_desviacion_sn,
            cierre_bloquea_sn,
            observacion
          )
          VALUES ($1, $2, $3::date, $4::date, $5::date, $6, $7, $8, $9, 'S', $10)
          ${sqlCommonReturning}`,
          [
            req.user?.id_usuario || null,
            tipo,
            fecha,
            rango?.desde || fecha,
            rango?.hasta || fecha,
            totalSistema,
            montoEfectivo,
            desviacion,
            alerta ? "S" : "N",
            observacion || "CIERRE_DESDE_CONTEO_EFECTIVO"
          ]
        );
        cierreRow = insertedCierre.rows[0] || null;
      }

      if (Number(cierreRow?.id_cierre || 0) > 0) {
        const relink = await client.query(
          `UPDATE caja_conteos_efectivo
           SET id_cierre = $2,
               actualizado_en = NOW()
           WHERE id_conteo = $1
           RETURNING
             id_conteo,
             creado_en,
             actualizado_en,
             fecha_referencia,
             monto_efectivo,
             estado,
             observacion,
             id_cierre`,
          [
            Number(row.id_conteo),
            Number(cierreRow.id_cierre)
          ]
        );
        row = relink.rows[0] || row;
      }
    }

    const usuarioAuditoria = req.user?.username || req.user?.nombre || "SISTEMA";
    const ip = getRequestIp(req);
    await registrarAuditoria(
      client,
      "CAJA_CONTEO_EFECTIVO_REGISTRADO",
      `id_conteo=${row.id_conteo}; fecha=${fecha}; monto=${montoEfectivo.toFixed(2)}; cerrar_caja=${cerrarCaja ? "S" : "N"}; ip=${ip}`,
      usuarioAuditoria
    );

    await client.query("COMMIT");

    const resumen = await buildConteoEfectivoResumen(fecha);
    realtimeHub.broadcast("caja", "conteo_efectivo_registrado", {
      id_conteo: Number(row.id_conteo || 0),
      fecha_referencia: fecha,
      monto_efectivo: montoEfectivo,
      caja_cerrada: cerrarCaja
    });

    return res.json({
      mensaje: cerrarCaja
        ? "Conteo registrado y caja cerrada para hoy."
        : "Conteo de efectivo enviado.",
      conteo: {
        id_conteo: Number(row.id_conteo || 0),
        creado_en: row.creado_en || null,
        actualizado_en: row.actualizado_en || null,
        fecha_referencia: normalizeDateOnly(row.fecha_referencia) || fecha,
        monto_efectivo: parseMonto(row.monto_efectivo, 0),
        estado: row.estado || ESTADOS_CONTEO_EFECTIVO.PENDIENTE,
        observacion: row.observacion || null,
        id_cierre: row.id_cierre ? Number(row.id_cierre) : null,
        id_usuario: req.user?.id_usuario ? Number(req.user.id_usuario) : null,
        username: req.user?.username || null,
        nombre_usuario: req.user?.nombre || null
      },
      cierre: cierreRow ? {
        id_cierre: Number(cierreRow.id_cierre || 0),
        creado_en: cierreRow.creado_en || null,
        tipo: cierreRow.tipo || "diario",
        fecha_referencia: normalizeDateOnly(cierreRow.fecha_referencia) || fecha,
        total_sistema: parseMonto(cierreRow.total_sistema, 0),
        efectivo_declarado: parseMonto(cierreRow.efectivo_declarado, 0),
        desviacion: parseMonto(cierreRow.desviacion, 0),
        alerta_desviacion: cierreRow.alerta_desviacion_sn === "S",
        cierre_bloquea: cierreRow.cierre_bloquea_sn === "S",
        observacion: cierreRow.observacion || null
      } : null,
      resumen
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error registrando conteo de efectivo:", err.message);
    return res.status(500).json({ error: "Error registrando conteo de efectivo." });
  } finally {
    client.release();
  }
});

app.post("/caja/ordenes-cobro/:id/cobrar", async (req, res) => {
  const client = await pool.connect();
  try {
    const idOrden = parsePositiveInt(req.params.id, 0);
    if (!idOrden) return res.status(400).json({ error: "Orden invalida." });
    const validacionFecha = validateCobroDateWindow(
      req.body?.fecha_pago || req.body?.fecha_cobro || req.body?.fecha
    );
    if (!validacionFecha.ok) {
      return res.status(400).json({
        error: validacionFecha.error,
        fecha_minima_permitida: validacionFecha.minPermitida || null,
        fecha_maxima_permitida: validacionFecha.hoy || null
      });
    }
    const hoy = validacionFecha.hoy;
    const fechaPagoSolicitada = validacionFecha.fecha || hoy;
    const cierreHoy = await consultarCierreCajaBloqueante(client, hoy);
    if (cierreHoy.cerrada && fechaPagoSolicitada === hoy) {
      return res.status(409).json({
        error: "Caja cerrada para hoy. No se permiten más cobros en agua hasta el siguiente día."
      });
    }

    await client.query("BEGIN");
    await ensureOrdenesCobroTable(client);

    const ordenResult = await client.query(`
      SELECT *
      FROM ordenes_cobro
      WHERE id_orden = $1
      FOR UPDATE
    `, [idOrden]);
    if (ordenResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Orden no encontrada." });
    }
    const orden = ordenResult.rows[0];
    if (orden.estado !== ESTADOS_ORDEN_COBRO.PENDIENTE) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `La orden ya no esta pendiente (estado: ${orden.estado}).` });
    }

    const items = sanitizeOrdenCobroItems(safeJsonArray(orden.recibos_json));
    if (items.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La orden no contiene recibos validos." });
    }
    const codigoReciboOrden = normalizeCodigoReciboInput(orden.codigo_recibo)
      || normalizeCodigoReciboInput(items[0]?.id_recibo);
    if (!codigoReciboOrden) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La orden no tiene codigo de recibo asociado. Debe emitirse nuevamente." });
    }

    const idsRecibos = items.map((i) => i.id_recibo);
    const recibosRows = await client.query(`
      WITH pagos_hasta AS (
        SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
        FROM pagos
        WHERE id_recibo = ANY($1::int[])
          AND DATE(fecha_pago) <= $2::date
        GROUP BY id_recibo
      ),
      pagos_total AS (
        SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
        FROM pagos
        WHERE id_recibo = ANY($1::int[])
        GROUP BY id_recibo
      )
      SELECT
        r.id_recibo,
        r.mes,
        r.anio,
        r.total_pagar,
        COALESCE(ph.total_pagado, 0) AS total_pagado_hasta_fecha,
        COALESCE(pt.total_pagado, 0) AS total_pagado_actual
      FROM recibos r
      LEFT JOIN pagos_hasta ph ON ph.id_recibo = r.id_recibo
      LEFT JOIN pagos_total pt ON pt.id_recibo = r.id_recibo
      WHERE r.id_recibo = ANY($1::int[])
      FOR UPDATE OF r
    `, [idsRecibos, fechaPagoSolicitada]);
    if (recibosRows.rows.length !== idsRecibos.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Uno o mas recibos de la orden no existen." });
    }

    const recibosMap = new Map(recibosRows.rows.map((r) => [Number(r.id_recibo), {
      id_recibo: Number(r.id_recibo),
      mes: Number(r.mes),
      anio: Number(r.anio),
      total_pagar: parseMonto(r.total_pagar, 0),
      total_pagado_hasta_fecha: parseMonto(r.total_pagado_hasta_fecha, 0),
      total_pagado_actual: parseMonto(r.total_pagado_actual, 0)
    }]));

    const pagosAplicados = [];
    let totalAplicado = 0;
    for (const item of items) {
      const recibo = recibosMap.get(item.id_recibo);
      if (!recibo) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Recibo ${item.id_recibo} no disponible para cobro.` });
      }
      const monto = parsePositiveMonto(item.monto_autorizado);
      const saldoPrevio = roundMonto2(Math.max(recibo.total_pagar - recibo.total_pagado_hasta_fecha, 0));
      if (saldoPrevio <= 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: `Recibo ${item.id_recibo} ya fue cancelado.` });
      }
      if (monto > saldoPrevio + 0.001) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `Monto autorizado ya no coincide con saldo disponible para recibo ${item.id_recibo}.`,
          saldo_disponible: saldoPrevio
        });
      }

      await client.query(
        "INSERT INTO pagos (id_recibo, monto_pagado, fecha_pago, usuario_cajero, id_orden_cobro) VALUES ($1, $2, ($3::date + LOCALTIME), $4, $5)",
        [item.id_recibo, monto, fechaPagoSolicitada, req.user?.username || req.user?.nombre || null, idOrden]
      );

      const totalPagadoHastaFechaNuevo = roundMonto2(recibo.total_pagado_hasta_fecha + monto);
      const totalPagadoActualNuevo = roundMonto2(recibo.total_pagado_actual + monto);
      const nuevoEstado = totalPagadoActualNuevo >= recibo.total_pagar - 0.001 ? "PAGADO" : "PARCIAL";
      await client.query(
        "UPDATE recibos SET estado = $1 WHERE id_recibo = $2",
        [nuevoEstado, item.id_recibo]
      );

      const saldoPosterior = roundMonto2(Math.max(recibo.total_pagar - totalPagadoActualNuevo, 0));
      pagosAplicados.push({
        id_recibo: item.id_recibo,
        mes: recibo.mes,
        anio: recibo.anio,
        monto_cobrado: monto,
        total_pagar: recibo.total_pagar,
        total_pagado: totalPagadoActualNuevo,
        total_pagado_hasta_fecha: totalPagadoHastaFechaNuevo,
        saldo: saldoPosterior,
        estado: nuevoEstado,
        subtotal_agua: parseSubtotalOrden(item.subtotal_agua),
        subtotal_desague: parseSubtotalOrden(item.subtotal_desague),
        subtotal_limpieza: parseSubtotalOrden(item.subtotal_limpieza),
        subtotal_admin: parseSubtotalOrden(item.subtotal_admin)
      });
      totalAplicado = roundMonto2(totalAplicado + monto);
      recibo.total_pagado_hasta_fecha = totalPagadoHastaFechaNuevo;
      recibo.total_pagado_actual = totalPagadoActualNuevo;
    }

    await client.query(`
      UPDATE ordenes_cobro
      SET
        estado = 'COBRADA',
        id_usuario_cobra = $2,
        cargo_reimpresion = $3,
        motivo_cargo_reimpresion = $4,
        cobrado_en = NOW(),
        actualizado_en = NOW()
      WHERE id_orden = $1
    `, [
      idOrden,
      req.user?.id_usuario || null,
      0,
      null
    ]);

    const usuarioAuditoria = req.user?.username || req.user?.nombre || "SISTEMA";
    const ip = getRequestIp(req);
    const recibosDetalle = pagosAplicados
      .slice(0, 12)
      .map((p) => `${p.id_recibo}:${Number(p.monto_cobrado || 0).toFixed(2)}`)
      .join(",");
    await registrarAuditoria(
      client,
      "ORDEN_COBRO_COBRADA",
      `orden=${idOrden}; tipo=${normalizeTipoOrdenCobro(orden.tipo_orden, TIPOS_ORDEN_COBRO.NORMAL)}; codigo_recibo=${codigoReciboOrden}; contribuyente=${orden.id_contribuyente}; fecha_pago=${fechaPagoSolicitada}; total=${totalAplicado.toFixed(2)}; cargo_reimpresion=0.00; recibos=${pagosAplicados.length}; detalle_recibos=${recibosDetalle}; ip=${ip}`,
      usuarioAuditoria
    );

    await client.query("COMMIT");
    invalidateContribuyentesCache();
    const totalCobradoFinal = totalAplicado;
    realtimeHub.broadcast("caja", "orden_cobrada", {
      id_orden: Number(idOrden || 0),
      id_contribuyente: Number(orden.id_contribuyente || 0),
      total_cobrado: Number(totalCobradoFinal || 0)
    });
    realtimeHub.broadcast("deuda", "saldo_actualizado", {
      id_contribuyente: Number(orden.id_contribuyente || 0),
      id_orden: Number(idOrden || 0)
    });
    res.json({
      mensaje: "Cobro registrado correctamente.",
      orden: {
        id_orden: idOrden,
        estado: ESTADOS_ORDEN_COBRO.COBRADA,
        tipo_orden: normalizeTipoOrdenCobro(orden.tipo_orden, TIPOS_ORDEN_COBRO.NORMAL),
        id_contribuyente: Number(orden.id_contribuyente),
        codigo_municipal: orden.codigo_municipal || null,
        codigo_recibo: codigoReciboOrden,
        total_orden: parseMonto(orden.total_orden, totalAplicado),
        cargo_reimpresion: 0,
        total_cobrado: totalCobradoFinal
      },
      pagos: pagosAplicados
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error cobrando orden:", err.message);
    res.status(500).json({ error: "Error cobrando orden." });
  } finally {
    client.release();
  }
});

app.post("/caja/ordenes-cobro/:id/anular", async (req, res) => {
  const client = await pool.connect();
  try {
    const idOrden = parsePositiveInt(req.params.id, 0);
    const motivo = normalizeLimitedText(req.body?.motivo, 500);
    if (!idOrden) return res.status(400).json({ error: "Orden invalida." });
    if (!motivo || motivo.length < 5) {
      return res.status(400).json({ error: "Motivo de anulacion obligatorio (minimo 5 caracteres)." });
    }

    await client.query("BEGIN");
    await ensureOrdenesCobroTable(client);

    const orden = await client.query(`
      SELECT id_orden, id_contribuyente, estado, tipo_orden
      FROM ordenes_cobro
      WHERE id_orden = $1
      FOR UPDATE
    `, [idOrden]);
    if (orden.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Orden no encontrada." });
    }
    if (orden.rows[0].estado !== ESTADOS_ORDEN_COBRO.PENDIENTE) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Solo se pueden anular ordenes pendientes (estado actual: ${orden.rows[0].estado}).` });
    }

    await client.query(`
      UPDATE ordenes_cobro
      SET
        estado = 'ANULADA',
        motivo_anulacion = $2,
        id_usuario_anula = $3,
        anulado_en = NOW(),
        actualizado_en = NOW()
      WHERE id_orden = $1
    `, [idOrden, motivo, req.user?.id_usuario || null]);

    const usuarioAuditoria = req.user?.username || req.user?.nombre || "SISTEMA";
    const ip = getRequestIp(req);
    await registrarAuditoria(
      client,
      "ORDEN_COBRO_ANULADA",
      `orden=${idOrden}; tipo=${normalizeTipoOrdenCobro(orden.rows[0]?.tipo_orden, TIPOS_ORDEN_COBRO.NORMAL)}; contribuyente=${orden.rows[0].id_contribuyente}; motivo=${motivo}; ip=${ip}`,
      usuarioAuditoria
    );

    await client.query("COMMIT");
    realtimeHub.broadcast("caja", "orden_anulada", {
      id_orden: Number(idOrden || 0),
      id_contribuyente: Number(orden.rows?.[0]?.id_contribuyente || 0)
    });
    res.json({ mensaje: "Orden anulada.", id_orden: idOrden, estado: ESTADOS_ORDEN_COBRO.ANULADA });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error anulando orden:", err.message);
    res.status(500).json({ error: "Error anulando orden." });
  } finally {
    client.release();
  }
});

const normalizePagoInputs = (body = {}) => {
  const listFromRows = (rows) => rows
    .map((raw) => {
      if (raw === null || raw === undefined) return null;
      if (typeof raw === "number" || typeof raw === "string") {
        const idRecibo = parsePositiveInt(raw, 0);
        if (idRecibo <= 0) return null;
        return { id_recibo: idRecibo, anio: null, mes: null, monto_pagado: null };
      }
      const idRecibo = parsePositiveInt(raw.id_recibo ?? raw.idRecibo ?? raw.recibo_id ?? raw.id, 0);
      const anio = parsePositiveInt(raw.anio ?? raw.year, 0);
      const mes = parsePositiveInt(raw.mes ?? raw.month, 0);
      const periodoValido = anio > 0 && mes >= 1 && mes <= 12;
      const monto = parsePositiveMonto(
        raw.monto_pagado ?? raw.monto ?? raw.monto_autorizado ?? raw.importe ?? raw.total ?? raw.saldo
      );
      if (idRecibo <= 0 && !periodoValido) return null;
      return {
        id_recibo: idRecibo > 0 ? idRecibo : null,
        anio: periodoValido ? anio : null,
        mes: periodoValido ? mes : null,
        monto_pagado: monto > 0 ? monto : null
      };
    })
    .filter(Boolean);

  const singleId = parsePositiveInt(body.id_recibo, 0);
  if (singleId > 0) {
    const singleMonto = parsePositiveMonto(body.monto_pagado ?? body.monto);
    return [{ id_recibo: singleId, anio: null, mes: null, monto_pagado: singleMonto > 0 ? singleMonto : null }];
  }

  const arraySources = [body.pagos, body.recibos, body.items, body.detalle];
  for (const src of arraySources) {
    if (!Array.isArray(src)) continue;
    const parsed = listFromRows(src);
    if (parsed.length > 0) return parsed;
  }

  if (Array.isArray(body.ids_recibos)) {
    const montosMap = (body.montos && typeof body.montos === "object") ? body.montos : {};
    return body.ids_recibos
      .map((rawId) => parsePositiveInt(rawId, 0))
      .filter((idRecibo) => idRecibo > 0)
      .map((idRecibo) => {
        const monto = parsePositiveMonto(
          montosMap[idRecibo] ?? montosMap[String(idRecibo)] ?? body.monto_pagado ?? body.monto
        );
        return { id_recibo: idRecibo, anio: null, mes: null, monto_pagado: monto > 0 ? monto : null };
      });
  }

  return [];
};

app.post("/pagos", async (req, res) => {
  const client = await pool.connect();
  try {
    const validacionFecha = validateCobroDateWindow(
      req.body?.fecha_pago || req.body?.fecha_cobro || req.body?.fecha
    );
    if (!validacionFecha.ok) {
      return res.status(400).json({
        error: validacionFecha.error,
        fecha_minima_permitida: validacionFecha.minPermitida || null,
        fecha_maxima_permitida: validacionFecha.hoy || null
      });
    }
    const hoy = validacionFecha.hoy;
    const fechaPagoSolicitada = validacionFecha.fecha || hoy;
    const cierreHoy = await consultarCierreCajaBloqueante(client, hoy);
    if (cierreHoy.cerrada && fechaPagoSolicitada === hoy) {
      return res.status(409).json({
        error: "Caja cerrada para hoy. No se permiten más cobros en agua hasta el siguiente día."
      });
    }
    const idContribuyenteSolicitado = parsePositiveInt(req.body?.id_contribuyente, 0);
    const pagosSolicitadosRaw = normalizePagoInputs(req.body);
    if (pagosSolicitadosRaw.length === 0) {
      return res.status(400).json({ error: "Formato de pago inválido o sin recibos válidos." });
    }
    const pagosSolicitados = pagosSolicitadosRaw.map((p) => ({ ...p }));

    await client.query("BEGIN");
    const pagosSinRecibo = pagosSolicitados.filter((p) => parsePositiveInt(p?.id_recibo, 0) <= 0);
    if (pagosSinRecibo.length > 0) {
      if (idContribuyenteSolicitado <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Para cobro por periodo (mes/año) debe indicar id_contribuyente."
        });
      }

      const predioInfo = await client.query(`
        SELECT
          p.id_predio,
          COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_sn,
          COALESCE(NULLIF(UPPER(TRIM(p.activo_sn)), ''), 'S') AS activo_sn,
          p.tarifa_agua,
          p.tarifa_desague,
          p.tarifa_limpieza,
          p.tarifa_admin,
          p.tarifa_extra,
          COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion
        FROM predios p
        JOIN contribuyentes c ON c.id_contribuyente = p.id_contribuyente
        WHERE p.id_contribuyente = $1
        ORDER BY p.id_predio ASC
        LIMIT 1
      `, [idContribuyenteSolicitado]);
      if (predioInfo.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "El contribuyente no tiene predio para cobrar periodos." });
      }
      if (predioInfo.rows[0].estado_conexion !== ESTADOS_CONEXION.CON_CONEXION) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "El contribuyente no tiene conexion activa para cobrar periodos adelantados." });
      }
      const idPredio = Number(predioInfo.rows[0].id_predio || 0);
      const activoSN = normalizeSN(predioInfo.rows[0].activo_sn, "S");
      const aguaHabilitado = activoSN === "S" && normalizeSN(predioInfo.rows[0].agua_sn, "S") === "S";
      const desagueHabilitado = activoSN === "S" && normalizeSN(predioInfo.rows[0].desague_sn, "S") === "S";
      const limpiezaHabilitado = activoSN === "S" && normalizeSN(predioInfo.rows[0].limpieza_sn, "S") === "S";
      const subtotalBase = {
        agua: aguaHabilitado ? parseMonto(predioInfo.rows[0].tarifa_agua, AUTO_DEUDA_BASE.agua) : 0,
        desague: desagueHabilitado ? parseMonto(predioInfo.rows[0].tarifa_desague, AUTO_DEUDA_BASE.desague) : 0,
        limpieza: limpiezaHabilitado ? parseMonto(predioInfo.rows[0].tarifa_limpieza, AUTO_DEUDA_BASE.limpieza) : 0,
        admin: activoSN === "S"
          ? parseMonto(predioInfo.rows[0].tarifa_admin, AUTO_DEUDA_BASE.admin) + parseMonto(predioInfo.rows[0].tarifa_extra, 0)
          : 0
      };
      const totalBase = roundMonto2(subtotalBase.agua + subtotalBase.desague + subtotalBase.limpieza + subtotalBase.admin);
      if (totalBase <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "No se pudo determinar la tarifa base del contribuyente." });
      }

      const periodoActualNum = getCurrentPeriodoNum();
      const periodosMap = new Map();
      for (const pago of pagosSinRecibo) {
        const anio = parsePositiveInt(pago?.anio, 0);
        const mes = parsePositiveInt(pago?.mes, 0);
        if (!anio || mes < 1 || mes > 12) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Periodo inválido en uno de los pagos solicitados." });
        }
        const key = `${anio}-${mes}`;
        periodosMap.set(key, { anio, mes, periodo_num: (anio * 100) + mes, id_recibo: 0 });
      }

      for (const periodo of periodosMap.values()) {
        let idRecibo = 0;
        const existente = await client.query(`
          SELECT r.id_recibo
          FROM recibos r
          WHERE r.id_predio = $1
            AND r.anio = $2
            AND r.mes = $3
          FOR UPDATE OF r
          LIMIT 1
        `, [idPredio, periodo.anio, periodo.mes]);
        if (existente.rows[0]?.id_recibo) {
          idRecibo = Number(existente.rows[0].id_recibo || 0);
        } else {
          if (periodo.periodo_num < periodoActualNum) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              error: `No existe recibo para el periodo ${periodo.mes}/${periodo.anio}.`
            });
          }
          try {
            const inserted = await client.query(`
              INSERT INTO recibos (
                id_predio, anio, mes, subtotal_agua, subtotal_desague, subtotal_limpieza, subtotal_admin, total_pagar, estado
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDIENTE')
              RETURNING id_recibo
            `, [
              idPredio,
              periodo.anio,
              periodo.mes,
              subtotalBase.agua,
              subtotalBase.desague,
              subtotalBase.limpieza,
              subtotalBase.admin,
              totalBase
            ]);
            idRecibo = Number(inserted.rows?.[0]?.id_recibo || 0);
          } catch (insertErr) {
            if (insertErr?.code !== "23505") throw insertErr;
            const recuperado = await client.query(`
              SELECT r.id_recibo
              FROM recibos r
              WHERE r.id_predio = $1
                AND r.anio = $2
                AND r.mes = $3
              FOR UPDATE OF r
              LIMIT 1
            `, [idPredio, periodo.anio, periodo.mes]);
            idRecibo = Number(recuperado.rows?.[0]?.id_recibo || 0);
          }
        }
        if (!idRecibo) {
          await client.query("ROLLBACK");
          return res.status(500).json({ error: `No se pudo resolver el recibo del periodo ${periodo.mes}/${periodo.anio}.` });
        }
        periodosMap.set(`${periodo.anio}-${periodo.mes}`, { ...periodo, id_recibo: idRecibo });
      }

      for (const pago of pagosSolicitados) {
        if (parsePositiveInt(pago?.id_recibo, 0) > 0) continue;
        const anio = parsePositiveInt(pago?.anio, 0);
        const mes = parsePositiveInt(pago?.mes, 0);
        const periodo = periodosMap.get(`${anio}-${mes}`);
        if (!periodo?.id_recibo) {
          await client.query("ROLLBACK");
          return res.status(500).json({ error: `No se pudo preparar el periodo ${mes}/${anio} para cobro.` });
        }
        pago.id_recibo = Number(periodo.id_recibo);
      }
    }

    // Consolidar pagos por recibo para evitar validaciones inconsistentes cuando
    // la UI envía el mismo recibo más de una vez (por ejemplo, filas duplicadas).
    const pagosAgrupadosMap = new Map();
    for (const pago of pagosSolicitados) {
      const idRecibo = parsePositiveInt(pago?.id_recibo, 0);
      if (!idRecibo) continue;
      const montoSolicitado = parsePositiveMonto(pago?.monto_pagado);
      const prev = pagosAgrupadosMap.get(idRecibo) || {
        ...pago,
        id_recibo: idRecibo,
        monto_pagado: null,
        _monto_explicitado: false
      };
      if (montoSolicitado > 0) {
        const acumulado = parseMonto(prev.monto_pagado, 0) + montoSolicitado;
        prev.monto_pagado = roundMonto2(acumulado);
        prev._monto_explicitado = true;
      }
      pagosAgrupadosMap.set(idRecibo, prev);
    }
    const pagosSolicitadosConsolidados = Array.from(pagosAgrupadosMap.values()).map((pago) => {
      const { _monto_explicitado, ...rest } = pago;
      if (!_monto_explicitado) return { ...rest, monto_pagado: null };
      return rest;
    });
    pagosSolicitados.length = 0;
    pagosSolicitados.push(...pagosSolicitadosConsolidados);

    const idsRecibos = [...new Set(pagosSolicitados.map((p) => Number(p.id_recibo)).filter((v) => Number.isInteger(v) && v > 0))];
    if (idsRecibos.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No se encontraron recibos válidos para procesar el cobro." });
    }
    const recibosRows = await client.query(`
      WITH pagos_hasta AS (
        SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
        FROM pagos
        WHERE id_recibo = ANY($1::int[])
          AND DATE(fecha_pago) <= $2::date
        GROUP BY id_recibo
      ),
      pagos_total AS (
        SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
        FROM pagos
        WHERE id_recibo = ANY($1::int[])
        GROUP BY id_recibo
      )
      SELECT
        r.id_recibo,
        r.mes,
        r.anio,
        r.subtotal_agua,
        r.subtotal_desague,
        r.subtotal_limpieza,
        r.subtotal_admin,
        r.total_pagar,
        COALESCE(ph.total_pagado, 0) AS total_pagado_hasta_fecha,
        COALESCE(pt.total_pagado, 0) AS total_pagado_actual,
        p.id_contribuyente
      FROM recibos r
      LEFT JOIN predios p ON p.id_predio = r.id_predio
      LEFT JOIN pagos_hasta ph ON ph.id_recibo = r.id_recibo
      LEFT JOIN pagos_total pt ON pt.id_recibo = r.id_recibo
      WHERE r.id_recibo = ANY($1::int[])
      FOR UPDATE OF r
    `, [idsRecibos, fechaPagoSolicitada]);
    if (recibosRows.rows.length !== idsRecibos.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Uno o más recibos no existen." });
    }

    const recibosMap = new Map(recibosRows.rows.map((r) => [Number(r.id_recibo), {
      id_recibo: Number(r.id_recibo),
      mes: parsePositiveInt(r.mes, 0),
      anio: parsePositiveInt(r.anio, 0),
      subtotal_agua: parseMonto(r.subtotal_agua, 0),
      subtotal_desague: parseMonto(r.subtotal_desague, 0),
      subtotal_limpieza: parseMonto(r.subtotal_limpieza, 0),
      subtotal_admin: parseMonto(r.subtotal_admin, 0),
      total_pagar: parseMonto(r.total_pagar, 0),
      total_pagado_hasta_fecha: parseMonto(r.total_pagado_hasta_fecha, 0),
      total_pagado_actual: parseMonto(r.total_pagado_actual, 0),
      id_contribuyente: parsePositiveInt(r.id_contribuyente, 0)
    }]));

    const pagosAplicados = [];
    for (const pagoReq of pagosSolicitados) {
      const recibo = recibosMap.get(Number(pagoReq.id_recibo));
      if (!recibo) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: `Recibo ${pagoReq.id_recibo} no encontrado.` });
      }
      if (idContribuyenteSolicitado > 0 && Number(recibo.id_contribuyente) !== idContribuyenteSolicitado) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `El recibo ${recibo.id_recibo} no pertenece al contribuyente seleccionado.`
        });
      }

      const saldoPrevio = roundMonto2(Math.max(recibo.total_pagar - recibo.total_pagado_hasta_fecha, 0));
      const saldoDisponibleActual = roundMonto2(Math.max(recibo.total_pagar - recibo.total_pagado_actual, 0));
      const montoSolicitado = parsePositiveMonto(pagoReq.monto_pagado);
      const monto = montoSolicitado > 0 ? montoSolicitado : saldoDisponibleActual;
      if (monto <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Recibo ${recibo.id_recibo} ya no tiene saldo pendiente.` });
      }
      if (monto > saldoDisponibleActual + 0.001) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `El monto excede el saldo del recibo ${recibo.id_recibo}.`,
          saldo_disponible: saldoDisponibleActual,
          saldo_hasta_fecha: saldoPrevio
        });
      }

      await client.query(
        "INSERT INTO pagos (id_recibo, monto_pagado, fecha_pago, usuario_cajero) VALUES ($1, $2, ($3::date + LOCALTIME), $4)",
        [recibo.id_recibo, monto, fechaPagoSolicitada, req.user?.username || req.user?.nombre || null]
      );

      const totalPagadoHastaFechaNuevo = roundMonto2(recibo.total_pagado_hasta_fecha + monto);
      const totalPagadoActualNuevo = roundMonto2(recibo.total_pagado_actual + monto);
      const nuevoEstado = totalPagadoActualNuevo >= recibo.total_pagar - 0.001 ? "PAGADO" : "PARCIAL";
      await client.query(
        "UPDATE recibos SET estado = $1 WHERE id_recibo = $2",
        [nuevoEstado, recibo.id_recibo]
      );

      const saldo = roundMonto2(Math.max(recibo.total_pagar - totalPagadoActualNuevo, 0));
      pagosAplicados.push({
        id_recibo: recibo.id_recibo,
        mes: recibo.mes,
        anio: recibo.anio,
        id_contribuyente: recibo.id_contribuyente,
        monto_pagado: monto,
        estado: nuevoEstado,
        total_pagado: totalPagadoActualNuevo,
        total_pagado_hasta_fecha: totalPagadoHastaFechaNuevo,
        subtotal_agua: recibo.subtotal_agua,
        subtotal_desague: recibo.subtotal_desague,
        subtotal_limpieza: recibo.subtotal_limpieza,
        subtotal_admin: recibo.subtotal_admin,
        saldo
      });
      recibo.total_pagado_hasta_fecha = totalPagadoHastaFechaNuevo;
      recibo.total_pagado_actual = totalPagadoActualNuevo;
    }

    await client.query("COMMIT");
    invalidateContribuyentesCache();
    const totalAplicado = roundMonto2(pagosAplicados.reduce((acc, p) => acc + p.monto_pagado, 0));
    const contribuyentesUnicos = [...new Set(
      pagosAplicados
        .map((p) => parsePositiveInt(p.id_contribuyente, 0))
        .filter((v) => v > 0)
    )];
    const contribuyenteEvento = idContribuyenteSolicitado > 0
      ? idContribuyenteSolicitado
      : (contribuyentesUnicos.length === 1 ? contribuyentesUnicos[0] : null);
    realtimeHub.broadcast("deuda", "saldo_actualizado", {
      id_contribuyente: contribuyenteEvento,
      total_aplicado: Number(totalAplicado || 0),
      recibos: pagosAplicados.map((p) => Number(p.id_recibo || 0))
    });
    const usuarioAuditoria = req.user?.username || req.user?.nombre || "SISTEMA";
    const ip = getRequestIp(req);
    await registrarAuditoria(
      null,
      "PAGO_DIRECTO_MANUAL",
      `contribuyente=${idContribuyenteSolicitado || "N/A"}; fecha_pago=${fechaPagoSolicitada}; recibos=${pagosAplicados.length}; total=${totalAplicado.toFixed(2)}; ip=${ip}`,
      usuarioAuditoria
    );

    if (pagosAplicados.length === 1) {
      const p = pagosAplicados[0];
      return res.json({
        mensaje: "Pago OK",
        estado: p.estado,
        total_pagado: p.total_pagado,
        saldo: p.saldo
      });
    }

    res.json({
      mensaje: "Pagos registrados correctamente.",
      total_aplicado: totalAplicado,
      pagos: pagosAplicados
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error registrando pago:", err.message);
    res.status(500).json({ error: "Error al procesar el pago." });
  } finally {
    client.release();
  }
});

app.post("/pagos/:id/anular", async (req, res) => {
  const client = await pool.connect();
  try {
    const idPago = parsePositiveInt(req.params?.id, 0);
    const motivo = normalizeLimitedText(req.body?.motivo, 500) || "SIN_MOTIVO";
    if (!idPago) return res.status(400).json({ error: "Pago invalido." });

    await client.query("BEGIN");
    await ensurePagosAnuladosTable(client);

    const pagoRs = await client.query(`
      SELECT
        p.id_pago,
        p.id_recibo,
        p.id_orden_cobro,
        p.monto_pagado,
        p.fecha_pago,
        p.usuario_cajero,
        r.total_pagar,
        r.mes,
        r.anio,
        pr.id_contribuyente
      FROM pagos p
      JOIN recibos r ON r.id_recibo = p.id_recibo
      LEFT JOIN predios pr ON pr.id_predio = r.id_predio
      WHERE p.id_pago = $1
      FOR UPDATE OF p, r
      LIMIT 1
    `, [idPago]);

    if (pagoRs.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Pago no encontrado o ya fue anulado." });
    }

    const pago = pagoRs.rows[0];
    const validacionVentana = validatePagoCorrectionWindow(pago.fecha_pago, toISODate());
    if (!validacionVentana.ok) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: validacionVentana.error });
    }
    const idRecibo = Number(pago.id_recibo || 0);
    const idOrdenCobro = parsePositiveInt(pago.id_orden_cobro, 0) || null;
    const idContribuyente = parsePositiveInt(pago.id_contribuyente, 0) || null;
    const montoPagado = roundMonto2(parseMonto(pago.monto_pagado, 0));

    await client.query(`
      INSERT INTO pagos_anulados (
        id_pago_original,
        id_recibo,
        id_contribuyente,
        id_orden_cobro_original,
        monto_pagado,
        fecha_pago_original,
        usuario_cajero_original,
        id_usuario_anula,
        username_anula,
        motivo_anulacion,
        payload_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    `, [
      Number(pago.id_pago),
      idRecibo,
      idContribuyente,
      idOrdenCobro,
      montoPagado,
      pago.fecha_pago,
      pago.usuario_cajero || null,
      req.user?.id_usuario || null,
      req.user?.username || req.user?.nombre || null,
      motivo,
      JSON.stringify({
        origen: "CAJA_CORRECCION",
        ip: getRequestIp(req),
        fecha_servidor: toISODate()
      })
    ]);

    await client.query("DELETE FROM pagos WHERE id_pago = $1", [Number(pago.id_pago)]);

    const totalPagadoRs = await client.query(`
      SELECT COALESCE(SUM(monto_pagado), 0) AS total_pagado
      FROM pagos
      WHERE id_recibo = $1
    `, [idRecibo]);
    const totalPagadoActivo = roundMonto2(parseMonto(totalPagadoRs.rows[0]?.total_pagado, 0));
    const totalRecibo = roundMonto2(parseMonto(pago.total_pagar, 0));
    const nuevoEstado = totalPagadoActivo >= totalRecibo - 0.001
      ? "PAGADO"
      : (totalPagadoActivo > 0.001 ? "PARCIAL" : "PENDIENTE");
    await client.query("UPDATE recibos SET estado = $1 WHERE id_recibo = $2", [nuevoEstado, idRecibo]);

    if (idOrdenCobro) {
      const ordenPagosActivos = await client.query(`
        SELECT COUNT(*)::int AS cantidad
        FROM pagos
        WHERE id_orden_cobro = $1
      `, [idOrdenCobro]);
      const cantidadPagosOrden = Number(ordenPagosActivos.rows[0]?.cantidad || 0);
      if (cantidadPagosOrden === 0) {
        await client.query(`
          UPDATE ordenes_cobro
          SET
            estado = 'PENDIENTE',
            cobrado_en = NULL,
            id_usuario_cobra = NULL,
            actualizado_en = NOW()
          WHERE id_orden = $1
            AND estado = 'COBRADA'
        `, [idOrdenCobro]);
      }
    }

    const usuarioAuditoria = req.user?.username || req.user?.nombre || "SISTEMA";
    const ip = getRequestIp(req);
    await registrarAuditoria(
      client,
      "PAGO_ANULADO_LOGICO",
      `id_pago=${Number(pago.id_pago)}; recibo=${idRecibo}; contribuyente=${idContribuyente || "N/A"}; monto=${montoPagado.toFixed(2)}; fecha_pago=${normalizeDateOnly(pago.fecha_pago) || ""}; motivo=${motivo}; ip=${ip}`,
      usuarioAuditoria
    );

    await client.query("COMMIT");
    invalidateContribuyentesCache();
    invalidateReportesCajaCache();
    realtimeHub.broadcast("deuda", "saldo_actualizado", {
      id_contribuyente: idContribuyente,
      id_recibo: idRecibo,
      id_pago_anulado: Number(pago.id_pago)
    });
    realtimeHub.broadcast("caja", "pago_anulado", {
      id_pago: Number(pago.id_pago),
      id_contribuyente: idContribuyente,
      id_recibo: idRecibo
    });

    return res.json({
      mensaje: "Pago anulado correctamente. El movimiento fue archivado para administracion.",
      pago: {
        id_pago: Number(pago.id_pago),
        id_recibo: idRecibo,
        id_contribuyente: idContribuyente,
        mes: Number(pago.mes || 0),
        anio: Number(pago.anio || 0),
        monto_pagado: montoPagado,
        estado_recibo: nuevoEstado,
        total_pagado_activo: totalPagadoActivo,
        saldo: roundMonto2(Math.max(totalRecibo - totalPagadoActivo, 0))
      }
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    if (err?.code === "23505") {
      return res.status(409).json({ error: "El pago ya fue anulado previamente." });
    }
    console.error("Error anulando pago:", err.message);
    return res.status(500).json({ error: "Error anulando pago." });
  } finally {
    client.release();
  }
});

app.post("/pagos/recibo/:id_recibo/anular-ultimo", async (req, res) => {
  const client = await pool.connect();
  try {
    const idRecibo = parsePositiveInt(req.params?.id_recibo, 0);
    const motivo = normalizeLimitedText(req.body?.motivo, 500) || "SIN_MOTIVO";
    if (!idRecibo) return res.status(400).json({ error: "Recibo invalido." });

    await client.query("BEGIN");
    await ensurePagosAnuladosTable(client);

    const pagoTarget = await client.query(`
      SELECT p.id_pago
      FROM pagos p
      WHERE p.id_recibo = $1
      ORDER BY p.fecha_pago DESC, p.id_pago DESC
      LIMIT 1
      FOR UPDATE OF p
    `, [idRecibo]);

    if (pagoTarget.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No hay pagos activos para este periodo." });
    }

    const idPago = Number(pagoTarget.rows[0].id_pago || 0);
    if (!idPago) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No se pudo identificar el pago a anular." });
    }

    const pagoRs = await client.query(`
      SELECT
        p.id_pago,
        p.id_recibo,
        p.id_orden_cobro,
        p.monto_pagado,
        p.fecha_pago,
        p.usuario_cajero,
        r.total_pagar,
        r.mes,
        r.anio,
        pr.id_contribuyente
      FROM pagos p
      JOIN recibos r ON r.id_recibo = p.id_recibo
      LEFT JOIN predios pr ON pr.id_predio = r.id_predio
      WHERE p.id_pago = $1
      FOR UPDATE OF p, r
      LIMIT 1
    `, [idPago]);

    if (pagoRs.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Pago no encontrado o ya fue anulado." });
    }

    const pago = pagoRs.rows[0];
    const validacionVentana = validatePagoCorrectionWindow(pago.fecha_pago, toISODate());
    if (!validacionVentana.ok) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: validacionVentana.error });
    }
    const idReciboPago = Number(pago.id_recibo || 0);
    const idOrdenCobro = parsePositiveInt(pago.id_orden_cobro, 0) || null;
    const idContribuyente = parsePositiveInt(pago.id_contribuyente, 0) || null;
    const montoPagado = roundMonto2(parseMonto(pago.monto_pagado, 0));

    await client.query(`
      INSERT INTO pagos_anulados (
        id_pago_original,
        id_recibo,
        id_contribuyente,
        id_orden_cobro_original,
        monto_pagado,
        fecha_pago_original,
        usuario_cajero_original,
        id_usuario_anula,
        username_anula,
        motivo_anulacion,
        payload_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    `, [
      Number(pago.id_pago),
      idReciboPago,
      idContribuyente,
      idOrdenCobro,
      montoPagado,
      pago.fecha_pago,
      pago.usuario_cajero || null,
      req.user?.id_usuario || null,
      req.user?.username || req.user?.nombre || null,
      motivo,
      JSON.stringify({
        origen: "CAJA_CORRECCION",
        ip: getRequestIp(req),
        fecha_servidor: toISODate(),
        via: "anular_ultimo_por_recibo"
      })
    ]);

    await client.query("DELETE FROM pagos WHERE id_pago = $1", [Number(pago.id_pago)]);

    const totalPagadoRs = await client.query(`
      SELECT COALESCE(SUM(monto_pagado), 0) AS total_pagado
      FROM pagos
      WHERE id_recibo = $1
    `, [idReciboPago]);
    const totalPagadoActivo = roundMonto2(parseMonto(totalPagadoRs.rows[0]?.total_pagado, 0));
    const totalRecibo = roundMonto2(parseMonto(pago.total_pagar, 0));
    const nuevoEstado = totalPagadoActivo >= totalRecibo - 0.001
      ? "PAGADO"
      : (totalPagadoActivo > 0.001 ? "PARCIAL" : "PENDIENTE");
    await client.query("UPDATE recibos SET estado = $1 WHERE id_recibo = $2", [nuevoEstado, idReciboPago]);

    if (idOrdenCobro) {
      const ordenPagosActivos = await client.query(`
        SELECT COUNT(*)::int AS cantidad
        FROM pagos
        WHERE id_orden_cobro = $1
      `, [idOrdenCobro]);
      const cantidadPagosOrden = Number(ordenPagosActivos.rows[0]?.cantidad || 0);
      if (cantidadPagosOrden === 0) {
        await client.query(`
          UPDATE ordenes_cobro
          SET
            estado = 'PENDIENTE',
            cobrado_en = NULL,
            id_usuario_cobra = NULL,
            actualizado_en = NOW()
          WHERE id_orden = $1
            AND estado = 'COBRADA'
        `, [idOrdenCobro]);
      }
    }

    const usuarioAuditoria = req.user?.username || req.user?.nombre || "SISTEMA";
    const ip = getRequestIp(req);
    await registrarAuditoria(
      client,
      "PAGO_ANULADO_LOGICO",
      `id_pago=${Number(pago.id_pago)}; recibo=${idReciboPago}; contribuyente=${idContribuyente || "N/A"}; monto=${montoPagado.toFixed(2)}; fecha_pago=${normalizeDateOnly(pago.fecha_pago) || ""}; motivo=${motivo}; via=anular_ultimo_por_recibo; ip=${ip}`,
      usuarioAuditoria
    );

    await client.query("COMMIT");
    invalidateContribuyentesCache();
    invalidateReportesCajaCache();
    realtimeHub.broadcast("deuda", "saldo_actualizado", {
      id_contribuyente: idContribuyente,
      id_recibo: idReciboPago,
      id_pago_anulado: Number(pago.id_pago)
    });
    realtimeHub.broadcast("caja", "pago_anulado", {
      id_pago: Number(pago.id_pago),
      id_contribuyente: idContribuyente,
      id_recibo: idReciboPago
    });

    return res.json({
      mensaje: "Pago del periodo anulado correctamente. Ya puede registrar el monto corregido.",
      pago: {
        id_pago: Number(pago.id_pago),
        id_recibo: idReciboPago,
        id_contribuyente: idContribuyente,
        mes: Number(pago.mes || 0),
        anio: Number(pago.anio || 0),
        monto_pagado: montoPagado,
        estado_recibo: nuevoEstado,
        total_pagado_activo: totalPagadoActivo,
        saldo: roundMonto2(Math.max(totalRecibo - totalPagadoActivo, 0))
      }
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    if (err?.code === "23505") {
      return res.status(409).json({ error: "El pago ya fue anulado previamente." });
    }
    console.error("Error anulando ultimo pago por recibo:", err.message);
    return res.status(500).json({ error: "Error anulando el pago del periodo." });
  } finally {
    client.release();
  }
});

app.get("/admin/pagos-anulados", async (req, res) => {
  try {
    const hoy = toISODate();
    const fechaHasta = normalizeDateOnly(req.query?.fecha_hasta || req.query?.fecha || hoy) || hoy;
    if (fechaHasta > hoy) {
      return res.status(400).json({ error: "No se permite consultar con fecha futura." });
    }
    const fechaDesde = normalizeDateOnly(req.query?.fecha_desde) || getRetroactiveCobroMinDate(fechaHasta, 1) || fechaHasta;
    if (fechaDesde > fechaHasta) {
      return res.status(400).json({ error: "La fecha desde no puede ser mayor que la fecha hasta." });
    }
    const limite = Math.min(1000, Math.max(1, parsePositiveInt(req.query?.limit, 200)));

    const rows = await pool.query(`
      SELECT
        pa.id_anulacion,
        pa.id_pago_original,
        pa.id_recibo,
        pa.id_contribuyente,
        pa.id_orden_cobro_original,
        pa.monto_pagado,
        pa.fecha_pago_original,
        pa.usuario_cajero_original,
        pa.anulado_en,
        pa.id_usuario_anula,
        pa.username_anula,
        pa.motivo_anulacion,
        pa.payload_json,
        r.mes,
        r.anio,
        c.codigo_municipal,
        COALESCE(NULLIF(TRIM(c.nombre_completo), ''), NULLIF(TRIM(c.sec_nombre), ''), '') AS nombre_completo
      FROM pagos_anulados pa
      LEFT JOIN recibos r ON r.id_recibo = pa.id_recibo
      LEFT JOIN contribuyentes c ON c.id_contribuyente = pa.id_contribuyente
      WHERE DATE(pa.anulado_en) >= $1::date
        AND DATE(pa.anulado_en) <= $2::date
      ORDER BY pa.anulado_en DESC, pa.id_anulacion DESC
      LIMIT $3
    `, [fechaDesde, fechaHasta, limite]);

    return res.json({
      rango: {
        desde: fechaDesde,
        hasta: fechaHasta
      },
      cantidad: Number(rows.rowCount || 0),
      movimientos: rows.rows
    });
  } catch (err) {
    console.error("Error listando pagos anulados:", err.message);
    return res.status(500).json({ error: "Error consultando pagos anulados." });
  }
});

app.post("/impresiones/generar-codigo", async (req, res) => {
  const client = await pool.connect();
  try {
    const idsRaw = Array.isArray(req.body?.ids_recibos) ? req.body.ids_recibos : [];
    const idsRecibos = [...new Set(
      idsRaw
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0)
    )];

    if (idsRecibos.length === 0) {
      return res.status(400).json({ error: "Debe enviar al menos un recibo valido." });
    }

    const idContribuyente = Number(req.body?.id_contribuyente);
    const totalMonto = parseMonto(req.body?.total_monto, 0);

    await client.query("BEGIN");
    await ensureCodigosImpresionTable(client);

    const pagosPorRecibo = await client.query(`
      SELECT
        r.id_recibo,
        r.total_pagar,
        COALESCE(SUM(p.monto_pagado), 0) AS total_pagado
      FROM recibos r
      LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
      WHERE r.id_recibo = ANY($1::int[])
      GROUP BY r.id_recibo, r.total_pagar
    `, [idsRecibos]);

    if (pagosPorRecibo.rows.length !== idsRecibos.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Uno o mas recibos no existen." });
    }

    const noPagados = pagosPorRecibo.rows.filter((r) => {
      const totalPagar = parseFloat(r.total_pagar) || 0;
      const totalPagado = parseFloat(r.total_pagado) || 0;
      return totalPagado + 0.001 < totalPagar;
    });

    if (noPagados.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Solo se puede generar codigo de impresion para recibos pagados.",
        recibos_no_pagados: noPagados.map((r) => r.id_recibo)
      });
    }

    const insertCodigo = await client.query(`
      INSERT INTO codigos_impresion (id_usuario, id_contribuyente, recibos_json, total_monto)
      VALUES ($1, $2, $3::jsonb, $4)
      RETURNING id_codigo, creado_en
    `, [
      req.user?.id_usuario || null,
      Number.isInteger(idContribuyente) && idContribuyente > 0 ? idContribuyente : null,
      JSON.stringify(idsRecibos),
      totalMonto
    ]);

    await client.query("COMMIT");
    const idCodigo = Number(insertCodigo.rows[0].id_codigo);

    return res.json({
      id_codigo: idCodigo,
      codigo_impresion: String(idCodigo).padStart(6, "0"),
      creado_en: insertCodigo.rows[0].creado_en
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error generando codigo de impresion:", err);
    return res.status(500).json({ error: "Error generando codigo de impresion." });
  } finally {
    client.release();
  }
});

app.post("/actas-corte/generar", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const idContribuyente = Number(req.body?.id_contribuyente);
    if (!Number.isInteger(idContribuyente) || idContribuyente <= 0) {
      return res.status(400).json({ error: "id_contribuyente invalido." });
    }

    const anioActual = getCurrentYear();
    const mesActual = getCurrentMonth();

    await client.query("BEGIN");
    await ensureActasCorteTable(client);

    const resumen = await client.query(`
      WITH pagos_por_recibo AS (
        SELECT id_recibo, SUM(monto_pagado) AS total_pagado
        FROM pagos
        GROUP BY id_recibo
      )
      SELECT
        c.codigo_municipal,
        COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
        COUNT(*) FILTER (
          WHERE GREATEST(r.total_pagar - COALESCE(pp.total_pagado, 0), 0) > 0
        ) AS meses_deuda,
        COALESCE(SUM(GREATEST(r.total_pagar - COALESCE(pp.total_pagado, 0), 0)), 0) AS deuda_total
      FROM contribuyentes c
      LEFT JOIN predios pr ON pr.id_contribuyente = c.id_contribuyente
      LEFT JOIN recibos r
        ON r.id_predio = pr.id_predio
       AND ((r.anio < $2) OR (r.anio = $2 AND r.mes <= $3))
      LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = r.id_recibo
      WHERE c.id_contribuyente = $1
      GROUP BY c.codigo_municipal, COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION')
    `, [idContribuyente, anioActual, mesActual]);

    if (resumen.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contribuyente no encontrado." });
    }

    const fila = resumen.rows[0];
    const codigoMunicipal = fila.codigo_municipal || null;
    const estadoConexion = String(fila.estado_conexion || "CON_CONEXION").trim().toUpperCase();
    const mesesDeuda = Number(fila.meses_deuda || 0);
    const deudaTotal = parseMonto(fila.deuda_total, 0);

    if (estadoConexion !== "CON_CONEXION") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "El acta de corte solo aplica a contribuyentes con conexión activa." });
    }

    if (mesesDeuda < 4) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La notificación aplica solo a contribuyentes con 4 o más meses de deuda." });
    }

    if (deudaTotal <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "El contribuyente no tiene deuda pendiente." });
    }

    const insercion = await client.query(`
      INSERT INTO actas_corte (
        id_usuario, id_contribuyente, codigo_municipal, meses_deuda, deuda_total
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id_acta, creado_en
    `, [
      req.user?.id_usuario || null,
      idContribuyente,
      codigoMunicipal,
      mesesDeuda,
      deudaTotal
    ]);

    await client.query("COMMIT");

    const idActa = Number(insercion.rows[0].id_acta);
    return res.json({
      id_acta: idActa,
      numero_acta: `AC-${String(idActa).padStart(6, "0")}`,
      fecha_emision: insercion.rows[0].creado_en,
      codigo_municipal: codigoMunicipal,
      meses_deuda: mesesDeuda,
      deuda_total: deudaTotal
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error generando acta de corte:", err);
    return res.status(500).json({ error: "Error generando acta de corte." });
  } finally {
    client.release();
  }
});

app.post("/actas-corte/generar-lote", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const idsRaw = Array.isArray(req.body?.ids_contribuyentes) ? req.body.ids_contribuyentes : [];
    const ids = Array.from(
      new Set(
        idsRaw
          .map((v) => Number(v))
          .filter((v) => Number.isInteger(v) && v > 0)
      )
    );
    if (ids.length === 0) {
      return res.status(400).json({ error: "Debe enviar al menos un contribuyente." });
    }

    const anioActual = getCurrentYear();
    const mesActual = getCurrentMonth();
    await client.query("BEGIN");
    await ensureActasCorteTable(client);

    const resumen = await client.query(`
      WITH pagos_por_recibo AS (
        SELECT id_recibo, SUM(monto_pagado) AS total_pagado
        FROM pagos
        GROUP BY id_recibo
      )
      SELECT
        c.id_contribuyente,
        c.codigo_municipal,
        COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
        COUNT(*) FILTER (
          WHERE GREATEST(r.total_pagar - COALESCE(pp.total_pagado, 0), 0) > 0
        ) AS meses_deuda,
        COALESCE(SUM(GREATEST(r.total_pagar - COALESCE(pp.total_pagado, 0), 0)), 0) AS deuda_total
      FROM contribuyentes c
      LEFT JOIN predios pr ON pr.id_contribuyente = c.id_contribuyente
      LEFT JOIN recibos r
        ON r.id_predio = pr.id_predio
       AND ((r.anio < $2) OR (r.anio = $2 AND r.mes <= $3))
      LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = r.id_recibo
      WHERE c.id_contribuyente = ANY($1::int[])
      GROUP BY c.id_contribuyente, c.codigo_municipal, COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION')
    `, [ids, anioActual, mesActual]);

    const resumenById = new Map();
    for (const row of resumen.rows) {
      resumenById.set(Number(row.id_contribuyente), row);
    }

    const generadas = [];
    const omitidas = [];
    for (const idContribuyente of ids) {
      const row = resumenById.get(idContribuyente);
      if (!row) {
        omitidas.push({
          id_contribuyente: idContribuyente,
          motivo: "Contribuyente no encontrado."
        });
        continue;
      }
      const codigoMunicipal = row.codigo_municipal || null;
      const estadoConexion = String(row.estado_conexion || "CON_CONEXION").trim().toUpperCase();
      const mesesDeuda = Number(row.meses_deuda || 0);
      const deudaTotal = parseMonto(row.deuda_total, 0);

      if (estadoConexion !== "CON_CONEXION") {
        omitidas.push({
          id_contribuyente: idContribuyente,
          codigo_municipal: codigoMunicipal,
          meses_deuda: mesesDeuda,
          deuda_total: deudaTotal,
          motivo: "Sin conexión activa."
        });
        continue;
      }

      if (mesesDeuda < 4) {
        omitidas.push({
          id_contribuyente: idContribuyente,
          codigo_municipal: codigoMunicipal,
          meses_deuda: mesesDeuda,
          deuda_total: deudaTotal,
          motivo: "Menos de 4 meses de deuda."
        });
        continue;
      }
      if (deudaTotal <= 0) {
        omitidas.push({
          id_contribuyente: idContribuyente,
          codigo_municipal: codigoMunicipal,
          meses_deuda: mesesDeuda,
          deuda_total: deudaTotal,
          motivo: "Sin deuda pendiente."
        });
        continue;
      }

      const insercion = await client.query(`
        INSERT INTO actas_corte (
          id_usuario, id_contribuyente, codigo_municipal, meses_deuda, deuda_total
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id_acta, creado_en
      `, [
        req.user?.id_usuario || null,
        idContribuyente,
        codigoMunicipal,
        mesesDeuda,
        deudaTotal
      ]);

      const idActa = Number(insercion.rows[0].id_acta);
      generadas.push({
        id_acta: idActa,
        numero_acta: `AC-${String(idActa).padStart(6, "0")}`,
        fecha_emision: insercion.rows[0].creado_en,
        id_contribuyente: idContribuyente,
        codigo_municipal: codigoMunicipal,
        meses_deuda: mesesDeuda,
        deuda_total: deudaTotal
      });
    }

    await client.query("COMMIT");
    return res.json({
      total_solicitadas: ids.length,
      total_generadas: generadas.length,
      generadas,
      omitidas
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error generando actas de corte en lote:", err);
    return res.status(500).json({ error: "Error generando actas de corte en lote." });
  } finally {
    client.release();
  }
});

app.get("/recibos/historial/:id_contribuyente", async (req, res) => {
  try {
    const { id_contribuyente } = req.params;
    const hoyIso = toISODate();
    const fechaCorte = normalizeDateOnly(req.query?.fecha_corte || req.query?.fecha || req.query?.fecha_pago) || hoyIso;
    if (fechaCorte > hoyIso) {
      return res.status(400).json({ error: "No se permite usar fecha de corte futura." });
    }
    const fechaBase = parseDateYearMonth(fechaCorte, parseDateYearMonth(hoyIso));
    const anioActual = Number(fechaBase.anio || getCurrentYear());
    const mesActual = Number(fechaBase.mes || getCurrentMonth());
    const anioParam = req.query.anio;
    const filtrarAnio = anioParam !== 'all';
    const anio = filtrarAnio ? (Number(anioParam) || getCurrentYear()) : null;
    const incluirFuturos = normalizeSN(req.query?.incluir_futuros, "N") === "S";

    const historial = await pool.query(`
      SELECT r.id_recibo, r.mes, r.anio, r.subtotal_agua, r.subtotal_desague, r.subtotal_limpieza, r.subtotal_admin,
        r.total_pagar,
        COALESCE(p.total_pagado, 0) as abono_mes,
        p.id_ultimo_pago,
        p.fecha_ultimo_pago,
        CASE
          WHEN (r.anio > $2) OR (r.anio = $2 AND r.mes > $3) THEN 0
          ELSE GREATEST(r.total_pagar - COALESCE(p.total_pagado, 0), 0)
        END as deuda_mes,
        CASE
          WHEN COALESCE(p.total_pagado, 0) >= r.total_pagar THEN 'PAGADO'
          WHEN COALESCE(p.total_pagado, 0) > 0 THEN 'PARCIAL'
          WHEN (r.anio > $2) OR (r.anio = $2 AND r.mes > $3) THEN 'NO_EXIGIBLE'
          ELSE 'PENDIENTE'
        END as estado
      FROM recibos r
      LEFT JOIN (
        SELECT
          id_recibo,
          SUM(monto_pagado) AS total_pagado,
          MAX(fecha_pago) AS fecha_ultimo_pago,
          (ARRAY_AGG(id_pago ORDER BY fecha_pago DESC, id_pago DESC))[1] AS id_ultimo_pago
        FROM pagos
        WHERE DATE(fecha_pago) <= $4::date
        GROUP BY id_recibo
      ) p ON p.id_recibo = r.id_recibo
      WHERE r.id_predio IN (SELECT id_predio FROM predios WHERE id_contribuyente = $1)
      ${incluirFuturos ? '' : 'AND ((r.anio < $2) OR (r.anio = $2 AND r.mes <= $3))'}
      ${filtrarAnio ? 'AND r.anio = $5' : ''}
      ORDER BY r.anio ASC, r.mes ASC
    `, filtrarAnio
      ? [id_contribuyente, anioActual, mesActual, fechaCorte, anio]
      : [id_contribuyente, anioActual, mesActual, fechaCorte]);
    res.json(historial.rows);
  } catch (err) { res.status(500).send("Error historial"); }
});

app.get("/exportar/arbitrios/:id_contribuyente", async (req, res) => {
  try {
    const idContribuyente = parsePositiveInt(req.params?.id_contribuyente, 0);
    if (!idContribuyente) {
      return res.status(400).json({ error: "ID de contribuyente inválido." });
    }
    const anioActual = getCurrentYear();
    const mesActual = getCurrentMonth();
    const anioParam = String(req.query?.anio || "all").trim().toLowerCase();
    const filtrarAnio = anioParam !== "all";
    const anio = filtrarAnio ? Number(anioParam) : null;
    if (filtrarAnio && (!Number.isInteger(anio) || anio <= 1900 || anio >= 9999)) {
      return res.status(400).json({ error: "Año inválido para exportación." });
    }

    const contribuyenteRs = await pool.query(
      `SELECT codigo_municipal, nombre_completo
       FROM contribuyentes
       WHERE id_contribuyente = $1
       LIMIT 1`,
      [idContribuyente]
    );
    const contribuyente = contribuyenteRs.rows[0];
    if (!contribuyente) {
      return res.status(404).json({ error: "Contribuyente no encontrado." });
    }

    const historial = await pool.query(`
      SELECT
        r.id_recibo,
        r.mes,
        r.anio,
        r.subtotal_agua,
        r.subtotal_desague,
        r.subtotal_limpieza,
        r.subtotal_admin,
        r.total_pagar,
        COALESCE(p.total_pagado, 0) AS abono_mes,
        CASE
          WHEN (r.anio > $2) OR (r.anio = $2 AND r.mes > $3) THEN 0
          ELSE GREATEST(r.total_pagar - COALESCE(p.total_pagado, 0), 0)
        END AS deuda_mes,
        CASE
          WHEN (r.anio > $2) OR (r.anio = $2 AND r.mes > $3) THEN 'NO_EXIGIBLE'
          WHEN COALESCE(p.total_pagado, 0) >= r.total_pagar THEN 'PAGADO'
          WHEN COALESCE(p.total_pagado, 0) > 0 THEN 'PARCIAL'
          ELSE 'PENDIENTE'
        END AS estado
      FROM recibos r
      LEFT JOIN (
        SELECT id_recibo, SUM(monto_pagado) AS total_pagado
        FROM pagos
        GROUP BY id_recibo
      ) p ON p.id_recibo = r.id_recibo
      WHERE r.id_predio IN (SELECT id_predio FROM predios WHERE id_contribuyente = $1)
        AND ((r.anio < $2) OR (r.anio = $2 AND r.mes <= $3))
      ${filtrarAnio ? "AND r.anio = $4" : ""}
      ORDER BY r.anio ASC, r.mes ASC, r.id_recibo ASC
    `, filtrarAnio ? [idContribuyente, anioActual, mesActual, anio] : [idContribuyente, anioActual, mesActual]);

    const monthLabels = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const workbook = new ExcelJS.Workbook();
    const wsResumen = workbook.addWorksheet("Resumen");
    wsResumen.columns = [
      { header: "CAMPO", key: "campo", width: 30 },
      { header: "VALOR", key: "valor", width: 50 }
    ];
    wsResumen.getRow(1).font = { bold: true };
    wsResumen.addRow({ campo: "Codigo municipal", valor: contribuyente.codigo_municipal || "" });
    wsResumen.addRow({ campo: "Contribuyente", valor: contribuyente.nombre_completo || "" });
    wsResumen.addRow({ campo: "Filtro año", valor: filtrarAnio ? String(anio) : "Todos" });
    wsResumen.addRow({ campo: "Total registros", valor: Number(historial.rows.length || 0) });

    const wsDetalle = workbook.addWorksheet("Arbitrios");
    wsDetalle.columns = [
      { header: "AÑO", key: "anio", width: 10 },
      { header: "MES", key: "mes_label", width: 12 },
      { header: "AGUA", key: "subtotal_agua", width: 14 },
      { header: "DESAGUE", key: "subtotal_desague", width: 14 },
      { header: "LIMPIEZA", key: "subtotal_limpieza", width: 14 },
      { header: "ADMIN", key: "subtotal_admin", width: 14 },
      { header: "DEUDA", key: "deuda_mes", width: 14 },
      { header: "ABONO", key: "abono_mes", width: 14 },
      { header: "ESTADO", key: "estado", width: 14 }
    ];
    wsDetalle.getRow(1).font = { bold: true };

    let totalAgua = 0;
    let totalDesague = 0;
    let totalLimpieza = 0;
    let totalAdmin = 0;
    let totalDeuda = 0;
    let totalAbono = 0;

    historial.rows.forEach((r) => {
      const agua = parseMonto(r.subtotal_agua, 0);
      const desague = parseMonto(r.subtotal_desague, 0);
      const limpieza = parseMonto(r.subtotal_limpieza, 0);
      const admin = parseMonto(r.subtotal_admin, 0);
      const deuda = parseMonto(r.deuda_mes, 0);
      const abono = parseMonto(r.abono_mes, 0);
      totalAgua += agua;
      totalDesague += desague;
      totalLimpieza += limpieza;
      totalAdmin += admin;
      totalDeuda += deuda;
      totalAbono += abono;
      wsDetalle.addRow({
        anio: Number(r.anio || 0),
        mes_label: monthLabels[Number(r.mes || 0)] || String(r.mes || "-"),
        subtotal_agua: Number(agua.toFixed(2)),
        subtotal_desague: Number(desague.toFixed(2)),
        subtotal_limpieza: Number(limpieza.toFixed(2)),
        subtotal_admin: Number(admin.toFixed(2)),
        deuda_mes: Number(deuda.toFixed(2)),
        abono_mes: Number(abono.toFixed(2)),
        estado: String(r.estado || "")
      });
    });

    const totalRow = wsDetalle.addRow({
      anio: "",
      mes_label: "TOTAL",
      subtotal_agua: Number(totalAgua.toFixed(2)),
      subtotal_desague: Number(totalDesague.toFixed(2)),
      subtotal_limpieza: Number(totalLimpieza.toFixed(2)),
      subtotal_admin: Number(totalAdmin.toFixed(2)),
      deuda_mes: Number(totalDeuda.toFixed(2)),
      abono_mes: Number(totalAbono.toFixed(2)),
      estado: ""
    });
    totalRow.font = { bold: true };

    const codigoSafe = String(contribuyente.codigo_municipal || `id_${idContribuyente}`).replace(/[^\w-]/g, "");
    const filtroSafe = filtrarAnio ? String(anio) : "todos";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=arbitrios_${codigoSafe}_${filtroSafe}.xlsx`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error("Error exportando arbitrios:", err);
    return res.status(500).json({ error: "Error exportando arbitrios." });
  }
});

const TIPOS_REPORTE_CAJA = new Set(["diario", "semanal", "mensual", "anual", "rango"]);

const obtenerRangoCaja = async (tipo, fechaReferencia, rangoManual = null) => {
  if (tipo === "rango") {
    let desde = normalizeDateOnly(rangoManual?.desde || fechaReferencia) || normalizeDateOnly(fechaReferencia) || toISODate();
    let hasta = normalizeDateOnly(rangoManual?.hasta || desde) || desde;
    if (desde > hasta) {
      const tmp = desde;
      desde = hasta;
      hasta = tmp;
    }
    const hastaExclusivo = shiftIsoDateByDays(hasta, 1) || hasta;
    return { desde, hasta: hastaExclusivo };
  }
  const rango = await pool.query(`
    SELECT
      CASE
        WHEN $1 = 'diario' THEN $2::date
        WHEN $1 = 'semanal' THEN date_trunc('week', $2::date)::date
        WHEN $1 = 'mensual' THEN date_trunc('month', $2::date)::date
        ELSE date_trunc('year', $2::date)::date
      END AS desde,
      CASE
        WHEN $1 = 'diario' THEN ($2::date + INTERVAL '1 day')::date
        WHEN $1 = 'semanal' THEN (date_trunc('week', $2::date) + INTERVAL '1 week')::date
        WHEN $1 = 'mensual' THEN (date_trunc('month', $2::date) + INTERVAL '1 month')::date
        ELSE (date_trunc('year', $2::date) + INTERVAL '1 year')::date
      END AS hasta
  `, [tipo, fechaReferencia]);
  return rango.rows[0];
};

const construirSerieTemporalCaja = async (tipo, desde, hasta) => {
  let labelSql = "to_char(date_trunc('hour', p.fecha_pago), 'HH24:00')";
  let orderSql = "date_trunc('hour', p.fecha_pago)";

  if (tipo === "semanal" || tipo === "mensual" || tipo === "rango") {
    labelSql = "to_char(DATE(p.fecha_pago), 'DD/MM')";
    orderSql = "DATE(p.fecha_pago)";
  } else if (tipo === "anual") {
    labelSql = "to_char(date_trunc('month', p.fecha_pago), 'Mon')";
    orderSql = "date_trunc('month', p.fecha_pago)";
  }

  const serie = await pool.query(`
    SELECT
      ${labelSql} AS etiqueta,
      ROUND(SUM(p.monto_pagado)::numeric, 2) AS total,
      ${orderSql} AS orden
    FROM pagos p
    WHERE ${PAGO_OPERATIVO_CAJA_SQL}
      AND p.fecha_pago >= $1::date
      AND p.fecha_pago < $2::date
    GROUP BY 1, 3
    ORDER BY 3
  `, [desde, hasta]);

  return serie.rows.map((r) => ({
    etiqueta: r.etiqueta,
    total: parseFloat(r.total) || 0
  }));
};

const construirResumenCaja = async (tipo, fechaReferencia, rangoManual = null) => {
  const cacheKey = tipo === "rango"
    ? `${tipo}|${normalizeDateOnly(rangoManual?.desde) || ""}|${normalizeDateOnly(rangoManual?.hasta) || ""}`
    : `${tipo}|${fechaReferencia}`;
  const now = Date.now();
  const cached = reportesCajaCache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    return cached.data;
  }

  const rango = await obtenerRangoCaja(tipo, fechaReferencia, rangoManual);
  const desde = rango.desde;
  const hasta = rango.hasta;

  const resumenPagos = await pool.query(`
    SELECT
      COUNT(*)::int AS cantidad,
      COALESCE(SUM(p.monto_pagado), 0)::numeric AS total
    FROM pagos p
    WHERE ${PAGO_OPERATIVO_CAJA_SQL}
      AND p.fecha_pago >= $1::date
      AND p.fecha_pago < $2::date
  `, [desde, hasta]);
  const cantidadMovimientos = Number(resumenPagos.rows[0]?.cantidad || 0);
  const total = parseFloat(resumenPagos.rows[0]?.total || 0) || 0;
  const totalGeneral = roundMonto2(total);

  const topContribuyentes = await pool.query(`
    SELECT
      c.codigo_municipal,
      COALESCE(
        NULLIF(TRIM(c.nombre_completo), ''),
        NULLIF(TRIM(c.sec_nombre), ''),
        ''
      ) AS nombre_completo,
      ROUND(SUM(p.monto_pagado)::numeric, 2) AS total
    FROM pagos p
    JOIN recibos r ON p.id_recibo = r.id_recibo
    JOIN predios pr ON r.id_predio = pr.id_predio
    JOIN contribuyentes c ON pr.id_contribuyente = c.id_contribuyente
    WHERE ${PAGO_OPERATIVO_CAJA_SQL}
      AND p.fecha_pago >= $1::date
      AND p.fecha_pago < $2::date
    GROUP BY
      c.codigo_municipal,
      COALESCE(
        NULLIF(TRIM(c.nombre_completo), ''),
        NULLIF(TRIM(c.sec_nombre), ''),
        ''
      )
    ORDER BY SUM(p.monto_pagado) DESC
    LIMIT 10
  `, [desde, hasta]);

  const periodosSql = `
    SELECT
      to_char(date_trunc('month', p.fecha_pago), 'MM/YYYY') AS periodo,
      ROUND(SUM(p.monto_pagado)::numeric, 2) AS total,
      date_trunc('month', p.fecha_pago) AS orden
    FROM pagos p
    WHERE ${PAGO_OPERATIVO_CAJA_SQL}
      AND p.fecha_pago >= $1::date
      AND p.fecha_pago < $2::date
    GROUP BY 1, 3
    ORDER BY 3 ASC
  `;
  const periodosParams = [desde, hasta];
  const periodos = await pool.query(periodosSql, periodosParams);

  const serieTemporal = await construirSerieTemporalCaja(tipo, desde, hasta);

  const resumen = {
    tipo,
    fecha_referencia: fechaReferencia,
    rango: {
      desde,
      hasta_exclusivo: hasta
    },
    total: total.toFixed(2),
    total_reimpresion: "0.00",
    total_general: totalGeneral.toFixed(2),
    cantidad_movimientos: cantidadMovimientos,
    graficos: {
      recaudacion_temporal: serieTemporal,
      top_contribuyentes: topContribuyentes.rows.map((r) => ({
        codigo_municipal: r.codigo_municipal,
        nombre_completo: r.nombre_completo,
        total: parseFloat(r.total) || 0
      })),
      recaudacion_por_periodo: periodos.rows.map((r) => ({
        periodo: r.periodo,
        total: parseFloat(r.total) || 0
      }))
    }
  };

  reportesCajaCache.set(cacheKey, {
    expiresAt: Date.now() + REPORTE_CAJA_CACHE_TTL_MS,
    data: resumen
  });

  return resumen;
};

const construirReporteCaja = async (tipo, fechaReferencia, options = {}) => {
  const includeAllMovimientos = Boolean(options.includeAllMovimientos);
  const includeCodigoImpresion = Boolean(options.includeCodigoImpresion);
  const pageRaw = Number(options.page ?? 1);
  const pageSizeRaw = Number(options.pageSize ?? 200);
  const safePage = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const safePageSize = includeAllMovimientos
    ? 0
    : (Number.isFinite(pageSizeRaw) ? Math.min(500, Math.max(25, pageSizeRaw)) : 200);
  const offset = includeAllMovimientos ? 0 : (safePage - 1) * safePageSize;

  const resumen = await construirResumenCaja(tipo, fechaReferencia, options.rangoManual || null);
  const desde = resumen.rango.desde;
  const hasta = resumen.rango.hasta_exclusivo;
  const cantidadMovimientos = Number(resumen.cantidad_movimientos || 0);

  const movimientosSql = `
    WITH movimientos_base AS (
      SELECT
        p.id_pago,
        p.id_orden_cobro,
        r.id_recibo,
        oc.codigo_recibo,
        p.fecha_pago,
        to_char(p.fecha_pago, 'YYYY-MM-DD') AS fecha,
        to_char(p.fecha_pago, 'HH24:MI:SS') AS hora,
        p.monto_pagado,
        COALESCE(
          NULLIF(TRIM(c.nombre_completo), ''),
          NULLIF(TRIM(c.sec_nombre), ''),
          ''
        ) AS nombre_completo,
        pr.id_contribuyente,
        c.codigo_municipal,
        r.mes,
        r.anio,
        r.subtotal_agua,
        r.subtotal_desague,
        r.subtotal_limpieza,
        r.subtotal_admin,
        r.total_pagar,
        CASE
          WHEN ci.id_codigo IS NOT NULL THEN LPAD(ci.id_codigo::text, 6, '0')
          ELSE NULL
        END AS codigo_impresion,
        CASE
          WHEN p.id_orden_cobro IS NULL THEN 0
          ELSE ROW_NUMBER() OVER (PARTITION BY p.id_orden_cobro ORDER BY p.id_pago DESC)
        END AS orden_rank
      FROM pagos p
      JOIN recibos r ON p.id_recibo = r.id_recibo
      JOIN predios pr ON r.id_predio = pr.id_predio
      JOIN contribuyentes c ON pr.id_contribuyente = c.id_contribuyente
      LEFT JOIN ordenes_cobro oc ON oc.id_orden = p.id_orden_cobro
      LEFT JOIN LATERAL (
        SELECT id_codigo
        FROM codigos_impresion ci
        WHERE ci.recibos_json @> jsonb_build_array(r.id_recibo)
        ORDER BY ci.id_codigo DESC
        LIMIT 1
      ) ci ON TRUE
      WHERE ${PAGO_OPERATIVO_CAJA_SQL}
        AND p.fecha_pago >= $1::date
        AND p.fecha_pago < $2::date
    )
    SELECT
      id_pago,
      id_recibo,
      codigo_recibo,
      fecha_pago,
      fecha,
      hora,
      monto_pagado,
      nombre_completo,
      id_contribuyente,
      codigo_municipal,
      mes,
      anio,
      subtotal_agua,
      subtotal_desague,
      subtotal_limpieza,
      subtotal_admin,
      total_pagar,
      codigo_impresion,
      0::numeric AS cargo_reimpresion
    FROM movimientos_base
    ORDER BY fecha_pago DESC, id_pago DESC
    ${includeAllMovimientos ? "" : "LIMIT $3 OFFSET $4"}
  `;
  const movimientosParams = includeAllMovimientos
    ? [desde, hasta]
    : [desde, hasta, safePageSize, offset];
  const movimientos = await pool.query(movimientosSql, movimientosParams);
  const prorratearPagoComponentes = (row) => {
    const montoPagado = roundMonto2(parseMonto(row?.monto_pagado, 0));
    const baseAgua = roundMonto2(parseMonto(row?.subtotal_agua, 0));
    const baseDesague = roundMonto2(parseMonto(row?.subtotal_desague, 0));
    const baseLimpieza = roundMonto2(parseMonto(row?.subtotal_limpieza, 0));
    const baseGastos = roundMonto2(parseMonto(row?.subtotal_admin, 0));
    const totalBase = roundMonto2(parseMonto(row?.total_pagar, (baseAgua + baseDesague + baseLimpieza + baseGastos)));
    if (montoPagado <= 0) {
      return { agua: 0, desague: 0, limpieza: 0, gastos: 0 };
    }
    if (totalBase <= 0) {
      return { agua: montoPagado, desague: 0, limpieza: 0, gastos: 0 };
    }
    const factor = montoPagado / totalBase;
    let agua = roundMonto2(baseAgua * factor);
    let desague = roundMonto2(baseDesague * factor);
    let limpieza = roundMonto2(baseLimpieza * factor);
    let gastos = roundMonto2(baseGastos * factor);
    const ajuste = roundMonto2(montoPagado - (agua + desague + limpieza + gastos));
    gastos = roundMonto2(gastos + ajuste);
    return { agua, desague, limpieza, gastos };
  };
  const movimientosSanitizados = movimientos.rows.map((row) => {
    const montos = prorratearPagoComponentes(row);
    const codigoImpresion = includeCodigoImpresion ? (row.codigo_impresion || null) : null;
    const codigoRecibo = parsePositiveInt(row?.codigo_recibo, 0);
    const idRecibo = parsePositiveInt(row?.id_recibo, 0);
    const numeroRecibo = codigoImpresion
      || (codigoRecibo > 0 ? String(codigoRecibo).padStart(6, "0") : null)
      || (idRecibo > 0 ? String(idRecibo).padStart(6, "0") : null);
    return {
      ...row,
      codigo_impresion: codigoImpresion,
      codigo_recibo: codigoRecibo > 0 ? codigoRecibo : null,
      id_recibo: idRecibo > 0 ? idRecibo : null,
      numero_recibo: numeroRecibo || null,
      monto_agua: montos.agua,
      monto_desague: montos.desague,
      monto_limpieza: montos.limpieza,
      monto_gastos: montos.gastos
    };
  });
  const pageSizeRespuesta = includeAllMovimientos
    ? Math.max(1, cantidadMovimientos)
    : safePageSize;
  const totalPaginas = includeAllMovimientos
    ? 1
    : Math.max(1, Math.ceil(cantidadMovimientos / safePageSize));

  return {
    ...resumen,
    cantidad_movimientos: cantidadMovimientos,
    paginacion: {
      pagina: includeAllMovimientos ? 1 : safePage,
      page_size: pageSizeRespuesta,
      total_paginas: totalPaginas
    },
    movimientos: movimientosSanitizados
  };
};

const buildConteoEfectivoResumen = async (fechaReferencia = toISODate()) => {
  const fecha = normalizeDateOnly(fechaReferencia) || toISODate();
  const aggregate = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE estado = 'PENDIENTE')::int AS total_pendientes,
      COUNT(*) FILTER (WHERE estado = 'PENDIENTE' AND fecha_referencia = $1::date)::int AS total_pendientes_hoy,
      COALESCE(SUM(monto_efectivo) FILTER (WHERE estado = 'PENDIENTE' AND fecha_referencia = $1::date), 0)::numeric AS monto_pendiente_hoy
    FROM caja_conteos_efectivo
  `, [fecha]);
  const ultimoPendiente = await pool.query(`
    SELECT
      ce.id_conteo,
      ce.creado_en,
      ce.actualizado_en,
      ce.fecha_referencia,
      ce.monto_efectivo,
      ce.estado,
      ce.observacion,
      ce.id_usuario,
      COALESCE(u.username, '') AS username,
      COALESCE(u.nombre_completo, '') AS nombre_usuario
    FROM caja_conteos_efectivo ce
    LEFT JOIN usuarios_sistema u ON u.id_usuario = ce.id_usuario
    WHERE ce.estado = 'PENDIENTE'
      AND ce.fecha_referencia = $1::date
    ORDER BY ce.creado_en DESC, ce.id_conteo DESC
    LIMIT 1
  `, [fecha]);
  const ultimoConteoHoy = await pool.query(`
    SELECT
      ce.id_conteo,
      ce.creado_en,
      ce.actualizado_en,
      ce.fecha_referencia,
      ce.monto_efectivo,
      ce.estado,
      ce.observacion,
      ce.id_usuario,
      COALESCE(u.username, '') AS username,
      COALESCE(u.nombre_completo, '') AS nombre_usuario
    FROM caja_conteos_efectivo ce
    LEFT JOIN usuarios_sistema u ON u.id_usuario = ce.id_usuario
    WHERE ce.fecha_referencia = $1::date
    ORDER BY ce.creado_en DESC, ce.id_conteo DESC
    LIMIT 1
  `, [fecha]);
  const cierreCaja = await pool.query(`
    SELECT
      id_cierre,
      creado_en,
      fecha_referencia,
      total_sistema,
      efectivo_declarado,
      desviacion,
      observacion
    FROM caja_cierres
    WHERE tipo = 'diario'
      AND fecha_referencia = $1::date
      AND cierre_bloquea_sn = 'S'
    ORDER BY id_cierre DESC
    LIMIT 1
  `, [fecha]);

  const resumenRow = aggregate.rows[0] || {};
  const conteo = ultimoPendiente.rows[0] || null;
  const conteoHoy = ultimoConteoHoy.rows[0] || null;
  const cierre = cierreCaja.rows[0] || null;
  const mapConteo = (row) => (row ? {
    id_conteo: Number(row.id_conteo || 0),
    creado_en: row.creado_en || null,
    actualizado_en: row.actualizado_en || null,
    fecha_referencia: normalizeDateOnly(row.fecha_referencia) || fecha,
    monto_efectivo: parseMonto(row.monto_efectivo, 0),
    estado: row.estado || ESTADOS_CONTEO_EFECTIVO.PENDIENTE,
    observacion: row.observacion || null,
    id_usuario: row.id_usuario ? Number(row.id_usuario) : null,
    username: row.username || null,
    nombre_usuario: row.nombre_usuario || null
  } : null);
  return {
    fecha_referencia: fecha,
    total_pendientes: Number(resumenRow.total_pendientes || 0),
    total_pendientes_hoy: Number(resumenRow.total_pendientes_hoy || 0),
    monto_pendiente_hoy: parseMonto(resumenRow.monto_pendiente_hoy, 0),
    caja_cerrada_hoy: Boolean(cierre),
    cierre_hoy: cierre ? {
      id_cierre: Number(cierre.id_cierre || 0),
      creado_en: cierre.creado_en || null,
      fecha_referencia: normalizeDateOnly(cierre.fecha_referencia) || fecha,
      total_sistema: parseMonto(cierre.total_sistema, 0),
      efectivo_declarado: parseMonto(cierre.efectivo_declarado, 0),
      desviacion: parseMonto(cierre.desviacion, 0),
      observacion: cierre.observacion || null
    } : null,
    ultimo_pendiente: mapConteo(conteo),
    ultimo_hoy: mapConteo(conteoHoy)
  };
};

const consultarCierreCajaBloqueante = async (clientOrPool, fechaReferencia = toISODate()) => {
  const db = clientOrPool || pool;
  const fecha = normalizeDateOnly(fechaReferencia) || toISODate();
  const result = await db.query(`
    SELECT
      id_cierre,
      creado_en,
      fecha_referencia,
      observacion
    FROM caja_cierres
    WHERE tipo = 'diario'
      AND fecha_referencia = $1::date
      AND cierre_bloquea_sn = 'S'
    ORDER BY id_cierre DESC
    LIMIT 1
  `, [fecha]);
  const row = result.rows[0] || null;
  return {
    fecha_referencia: fecha,
    cerrada: Boolean(row),
    cierre: row ? {
      id_cierre: Number(row.id_cierre || 0),
      creado_en: row.creado_en || null,
      observacion: row.observacion || null
    } : null
  };
};

app.get("/caja/reporte", async (req, res) => {
  try {
    const tipoRaw = String(req.query.tipo || "diario").toLowerCase();
    const tipo = TIPOS_REPORTE_CAJA.has(tipoRaw) ? tipoRaw : "diario";
    const hoy = toISODate();
    let fecha = normalizeDateOnly(req.query.fecha) || hoy;
    let rangoManual = null;
    if (tipo === "rango") {
      let fechaDesde = normalizeDateOnly(req.query.fecha_desde || req.query.desde) || fecha;
      let fechaHasta = normalizeDateOnly(req.query.fecha_hasta || req.query.hasta) || fecha;
      if (fechaDesde > fechaHasta) {
        const tmp = fechaDesde;
        fechaDesde = fechaHasta;
        fechaHasta = tmp;
      }
      if (fechaDesde > hoy || fechaHasta > hoy) {
        return res.status(400).json({ error: "No se permite consultar rango de caja con fechas futuras." });
      }
      rangoManual = { desde: fechaDesde, hasta: fechaHasta };
      fecha = fechaHasta;
    } else if (fecha > hoy) {
      return res.status(400).json({ error: "No se permite consultar caja con fecha futura." });
    }
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.page_size || 200);
    const mostrarCodigoImpresion = true;
    const data = await construirReporteCaja(tipo, fecha, {
      page,
      pageSize,
      includeCodigoImpresion: mostrarCodigoImpresion,
      rangoManual
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Error reporte caja." });
  }
});

app.get("/caja/reporte/excel", authenticateToken, async (req, res) => {
  try {
    const tipoRaw = String(req.query.tipo || "diario").toLowerCase();
    const tipo = TIPOS_REPORTE_CAJA.has(tipoRaw) ? tipoRaw : "diario";
    const hoy = toISODate();
    let fecha = normalizeDateOnly(req.query.fecha) || hoy;
    let rangoManual = null;
    if (tipo === "rango") {
      let fechaDesde = normalizeDateOnly(req.query.fecha_desde || req.query.desde) || fecha;
      let fechaHasta = normalizeDateOnly(req.query.fecha_hasta || req.query.hasta) || fecha;
      if (fechaDesde > fechaHasta) {
        const tmp = fechaDesde;
        fechaDesde = fechaHasta;
        fechaHasta = tmp;
      }
      if (fechaDesde > hoy || fechaHasta > hoy) {
        return res.status(400).json({ error: "No se permite exportar rango de caja con fechas futuras." });
      }
      rangoManual = { desde: fechaDesde, hasta: fechaHasta };
      fecha = fechaHasta;
    } else if (fecha > hoy) {
      return res.status(400).json({ error: "No se permite exportar caja con fecha futura." });
    }
    const mostrarCodigoImpresion = true;
    const data = await construirReporteCaja(tipo, fecha, {
      includeAllMovimientos: true,
      includeCodigoImpresion: mostrarCodigoImpresion,
      rangoManual
    });

    const workbook = new ExcelJS.Workbook();

    const wsResumen = workbook.addWorksheet("Resumen");
    wsResumen.columns = [
      { header: "CAMPO", key: "campo", width: 28 },
      { header: "VALOR", key: "valor", width: 42 }
    ];
    wsResumen.getRow(1).font = { bold: true };
    wsResumen.addRow({ campo: "Tipo reporte", valor: data.tipo });
    wsResumen.addRow({ campo: "Fecha referencia", valor: data.fecha_referencia });
    wsResumen.addRow({ campo: "Rango desde", valor: data.rango?.desde || "" });
    wsResumen.addRow({ campo: "Rango hasta (exclusivo)", valor: data.rango?.hasta_exclusivo || "" });
    wsResumen.addRow({ campo: "Cantidad movimientos", valor: data.cantidad_movimientos || 0 });
    wsResumen.addRow({ campo: "Total caja", valor: parseFloat(data.total_general || 0) });

    const wsMov = workbook.addWorksheet("Movimientos");
    wsMov.columns = [
      { header: "ID PAGO", key: "id_pago", width: 12 },
      { header: "FECHA", key: "fecha", width: 14 },
      { header: "HORA", key: "hora", width: 12 },
      { header: "RECIBO", key: "numero_recibo", width: 14 },
      { header: "CODIGO", key: "codigo_municipal", width: 16 },
      { header: "CONTRIBUYENTE", key: "nombre_completo", width: 36 },
      { header: "PERIODO", key: "periodo", width: 12 },
      { header: "MONTO", key: "monto_pagado", width: 14 }
    ];
    wsMov.getRow(1).font = { bold: true };
    (data.movimientos || []).forEach((m) => {
      wsMov.addRow({
        id_pago: m.id_pago,
        fecha: m.fecha || "",
        hora: m.hora || "",
        numero_recibo: m.numero_recibo || m.codigo_impresion || "",
        codigo_municipal: m.codigo_municipal || "",
        nombre_completo: m.nombre_completo || "",
        periodo: `${m.mes || ""}/${m.anio || ""}`,
        monto_pagado: parseFloat(m.monto_pagado || 0)
      });
    });

    const fechaSafe = tipo === "rango"
      ? `${String(data.rango?.desde || "").replace(/[^\d-]/g, "")}_${String(data.rango?.hasta_exclusivo || "").replace(/[^\d-]/g, "")}`
      : String(fecha).replace(/[^\d-]/g, "");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=reporte_caja_${tipo}_${fechaSafe}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error exportando reporte caja excel:", err);
    res.status(500).json({ error: "Error exportando reporte en Excel." });
  }
});

app.get("/caja/diaria", async (req, res) => {
  try {
    const hoy = toISODate();
    const fecha = normalizeDateOnly(req.query.fecha) || hoy;
    if (fecha > hoy) {
      return res.status(400).json({ error: "No se permite consultar caja diaria con fecha futura." });
    }
    const data = await construirReporteCaja("diario", fecha, {
      includeAllMovimientos: true,
      includeCodigoImpresion: true
    });
    res.json({
      ...data,
      fecha_consulta: fecha
    });
  } catch (err) {
    res.status(500).send("Error caja");
  }
});

app.post("/caja/cierre", async (req, res) => {
  const client = await pool.connect();
  try {
    const tipo = "diario";
    const fecha = normalizeDateOnly(req.body?.fecha) || toISODate();
    const hoy = toISODate();
    if (fecha !== hoy) {
      return res.status(400).json({ error: "Solo se permite registrar cierre para la fecha actual." });
    }
    const efectivoDeclaradoRaw = parseMonto(req.body?.efectivo_declarado, Number.NaN);
    let efectivoDeclarado = Number.isFinite(efectivoDeclaradoRaw) ? roundMonto2(efectivoDeclaradoRaw) : Number.NaN;
    const umbralAlerta = Math.max(0, roundMonto2(parseMonto(req.body?.umbral_alerta, CAJA_CIERRE_ALERTA_UMBRAL)));
    const observacion = normalizeLimitedText(req.body?.observacion, 500) || null;

    await client.query("BEGIN");
    await ensureCajaCierresTable(client);
    await ensureCajaConteosEfectivoTable(client);

    const conteoPendiente = await client.query(
      `SELECT
         id_conteo,
         creado_en,
         monto_efectivo,
         observacion,
         id_usuario
       FROM caja_conteos_efectivo
       WHERE fecha_referencia = $1::date
         AND estado = $2
       ORDER BY creado_en DESC, id_conteo DESC
       LIMIT 1
       FOR UPDATE`,
      [fecha, ESTADOS_CONTEO_EFECTIVO.PENDIENTE]
    );
    const conteoPendienteRow = conteoPendiente.rows[0] || null;
    const conteoUltimoHoy = await client.query(
      `SELECT
         id_conteo,
         creado_en,
         monto_efectivo,
         observacion,
         id_usuario,
         estado
       FROM caja_conteos_efectivo
       WHERE fecha_referencia = $1::date
       ORDER BY creado_en DESC, id_conteo DESC
       LIMIT 1
       FOR UPDATE`,
      [fecha]
    );
    const conteoUltimoHoyRow = conteoUltimoHoy.rows[0] || null;
    if ((!Number.isFinite(efectivoDeclarado) || efectivoDeclarado < 0) && conteoPendienteRow) {
      efectivoDeclarado = roundMonto2(parseMonto(conteoPendienteRow.monto_efectivo, Number.NaN));
    }
    if ((!Number.isFinite(efectivoDeclarado) || efectivoDeclarado < 0) && conteoUltimoHoyRow) {
      efectivoDeclarado = roundMonto2(parseMonto(conteoUltimoHoyRow.monto_efectivo, Number.NaN));
    }

    const existente = await client.query(
      `SELECT id_cierre, efectivo_declarado
       FROM caja_cierres
       WHERE tipo = 'diario' AND fecha_referencia = $1::date
       ORDER BY id_cierre DESC
       LIMIT 1
       FOR UPDATE`,
      [fecha]
    );
    if ((!Number.isFinite(efectivoDeclarado) || efectivoDeclarado < 0) && existente.rows[0]) {
      efectivoDeclarado = roundMonto2(parseMonto(existente.rows[0].efectivo_declarado, Number.NaN));
    }
    if (!Number.isFinite(efectivoDeclarado) || efectivoDeclarado < 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Efectivo declarado invalido." });
    }
    const resumen = await construirResumenCaja(tipo, fecha);
    const totalSistema = roundMonto2(parseMonto(resumen?.total, 0));
    const desviacion = roundMonto2(efectivoDeclarado - totalSistema);
    const alerta = Math.abs(desviacion) > umbralAlerta + 0.001;
    const rango = await obtenerRangoCaja(tipo, fecha);

    const sqlCommonReturning = `
      RETURNING
        id_cierre,
        creado_en,
        tipo,
        fecha_referencia,
        desde,
        hasta_exclusivo,
        total_sistema,
        efectivo_declarado,
        desviacion,
        alerta_desviacion_sn,
        cierre_bloquea_sn,
        observacion
    `;
    let row = null;
    if (existente.rows[0]) {
      const updated = await client.query(
        `UPDATE caja_cierres
         SET id_usuario = $2,
             desde = $3::date,
             hasta_exclusivo = $4::date,
             total_sistema = $5,
             efectivo_declarado = $6,
             desviacion = $7,
             alerta_desviacion_sn = $8,
             cierre_bloquea_sn = 'S',
             observacion = $9
         WHERE id_cierre = $1
         ${sqlCommonReturning}`,
        [
          Number(existente.rows[0].id_cierre),
          req.user?.id_usuario || null,
          rango?.desde || fecha,
          rango?.hasta || fecha,
          totalSistema,
          efectivoDeclarado,
          desviacion,
          alerta ? "S" : "N",
          observacion
        ]
      );
      row = updated.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO caja_cierres (
          id_usuario,
          tipo,
          fecha_referencia,
          desde,
          hasta_exclusivo,
          total_sistema,
          efectivo_declarado,
          desviacion,
          alerta_desviacion_sn,
          cierre_bloquea_sn,
          observacion
        )
        VALUES ($1, $2, $3::date, $4::date, $5::date, $6, $7, $8, $9, 'S', $10)
        ${sqlCommonReturning}`,
        [
          req.user?.id_usuario || null,
          tipo,
          fecha,
          rango?.desde || fecha,
          rango?.hasta || fecha,
          totalSistema,
          efectivoDeclarado,
          desviacion,
          alerta ? "S" : "N",
          observacion
        ]
      );
      row = inserted.rows[0];
    }

    const conteosAplicados = await client.query(
      `UPDATE caja_conteos_efectivo
       SET estado = $2,
           actualizado_en = NOW(),
           id_cierre = $3
       WHERE fecha_referencia = $1::date
         AND estado = $4
       RETURNING id_conteo, monto_efectivo, creado_en, observacion, id_usuario`,
      [
        fecha,
        ESTADOS_CONTEO_EFECTIVO.APLICADO,
        Number(row.id_cierre),
        ESTADOS_CONTEO_EFECTIVO.PENDIENTE
      ]
    );

    const usuarioAuditoria = req.user?.username || req.user?.nombre || "SISTEMA";
    const ip = getRequestIp(req);
    await registrarAuditoria(
      client,
      "CAJA_CIERRE_REGISTRADO",
      `id_cierre=${row.id_cierre}; tipo=${tipo}; fecha=${fecha}; total_sistema=${totalSistema.toFixed(2)}; efectivo=${efectivoDeclarado.toFixed(2)}; desviacion=${desviacion.toFixed(2)}; alerta=${alerta ? "S" : "N"}; ip=${ip}`,
      usuarioAuditoria
    );

    await client.query("COMMIT");
    realtimeHub.broadcast("caja", "cierre_registrado", {
      id_cierre: Number(row.id_cierre || 0),
      fecha_referencia: fecha
    });

    const conteoAplicado = conteoPendienteRow
      ? {
          id_conteo: Number(conteoPendienteRow.id_conteo || 0),
          creado_en: conteoPendienteRow.creado_en || null,
          monto_efectivo: parseMonto(conteoPendienteRow.monto_efectivo, 0),
          observacion: conteoPendienteRow.observacion || null,
          id_usuario: conteoPendienteRow.id_usuario ? Number(conteoPendienteRow.id_usuario) : null
        }
      : null;
    let resumenConteo = null;
    try {
      resumenConteo = await buildConteoEfectivoResumen(fecha);
    } catch {
      resumenConteo = null;
    }

    res.json({
      mensaje: existente.rows[0] ? "Cierre de caja actualizado." : "Cierre de caja registrado.",
      cierre: {
        id_cierre: Number(row.id_cierre),
        creado_en: row.creado_en,
        tipo: row.tipo,
        fecha_referencia: normalizeDateOnly(row.fecha_referencia) || fecha,
        rango: {
          desde: row.desde,
          hasta_exclusivo: row.hasta_exclusivo
        },
        total_sistema: parseMonto(row.total_sistema, 0),
        efectivo_declarado: parseMonto(row.efectivo_declarado, 0),
        desviacion: parseMonto(row.desviacion, 0),
        umbral_alerta: umbralAlerta,
        alerta_desviacion: row.alerta_desviacion_sn === "S",
        cierre_bloquea: row.cierre_bloquea_sn === "S",
        observacion: row.observacion || null,
        conteo_aplicado: conteoAplicado,
        conteos_aplicados: Number(conteosAplicados.rows.length || 0)
      },
      conteo: resumenConteo
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error registrando cierre de caja:", err.message);
    res.status(500).json({ error: "Error registrando cierre de caja." });
  } finally {
    client.release();
  }
});

app.get("/caja/alertas-riesgo", async (req, res) => {
  try {
    const windowHours = Math.min(168, Math.max(1, parsePositiveInt(req.query?.window_hours, CAJA_RIESGO_WINDOW_HOURS)));
    const umbralAnulaciones = Math.min(50, Math.max(1, parsePositiveInt(req.query?.umbral_anulaciones, CAJA_RIESGO_ANULACIONES_UMBRAL)));

    const anulaciones = await pool.query(`
      SELECT
        oc.id_usuario_anula AS id_usuario,
        COALESCE(u.username, 'SISTEMA') AS username,
        COALESCE(u.nombre_completo, '') AS nombre,
        COUNT(*)::int AS total_anulaciones,
        MAX(oc.anulado_en) AS ultima_anulacion
      FROM ordenes_cobro oc
      LEFT JOIN usuarios_sistema u ON u.id_usuario = oc.id_usuario_anula
      WHERE oc.estado = 'ANULADA'
        AND oc.anulado_en IS NOT NULL
        AND oc.anulado_en >= NOW() - make_interval(hours => $1::int)
      GROUP BY oc.id_usuario_anula, u.username, u.nombre_completo
      HAVING COUNT(*) >= $2
      ORDER BY COUNT(*) DESC, MAX(oc.anulado_en) DESC
      LIMIT 20
    `, [windowHours, umbralAnulaciones]);

    const reemisiones = await pool.query(`
      WITH eventos AS (
        SELECT
          ((elem->>'id_recibo')::int) AS id_recibo,
          COUNT(DISTINCT oc.id_orden)::int AS total_ordenes,
          MIN(oc.creado_en) AS primera_emision,
          MAX(oc.creado_en) AS ultima_emision
        FROM ordenes_cobro oc
        CROSS JOIN LATERAL jsonb_array_elements(oc.recibos_json) elem
        WHERE oc.creado_en >= NOW() - make_interval(hours => $1::int)
          AND (elem->>'id_recibo') ~ '^[0-9]+$'
        GROUP BY ((elem->>'id_recibo')::int)
        HAVING COUNT(DISTINCT oc.id_orden) >= 2
      )
      SELECT
        e.id_recibo,
        e.total_ordenes,
        e.primera_emision,
        e.ultima_emision,
        COALESCE(c.codigo_municipal, '') AS codigo_municipal,
        COALESCE(c.nombre_completo, '') AS nombre_completo,
        COALESCE(r.mes, 0) AS mes,
        COALESCE(r.anio, 0) AS anio
      FROM eventos e
      LEFT JOIN recibos r ON r.id_recibo = e.id_recibo
      LEFT JOIN predios p ON p.id_predio = r.id_predio
      LEFT JOIN contribuyentes c ON c.id_contribuyente = p.id_contribuyente
      ORDER BY e.total_ordenes DESC, e.ultima_emision DESC
      LIMIT 30
    `, [windowHours]);

    const cobrosFueraHorario = await pool.query(`
      SELECT
        oc.id_orden,
        oc.cobrado_en,
        COALESCE(oc.codigo_municipal, '') AS codigo_municipal,
        COALESCE(oc.total_orden, 0)::numeric AS total_orden,
        COALESCE(u.username, 'SISTEMA') AS username,
        COALESCE(u.nombre_completo, '') AS nombre
      FROM ordenes_cobro oc
      LEFT JOIN usuarios_sistema u ON u.id_usuario = oc.id_usuario_cobra
      WHERE oc.estado = 'COBRADA'
        AND oc.cobrado_en IS NOT NULL
        AND oc.cobrado_en >= NOW() - make_interval(hours => $1::int)
        AND (
          CASE
            WHEN $2::time <= $3::time
              THEN (oc.cobrado_en::time < $2::time OR oc.cobrado_en::time > $3::time)
            ELSE (oc.cobrado_en::time < $2::time AND oc.cobrado_en::time > $3::time)
          END
        )
      ORDER BY oc.cobrado_en DESC
      LIMIT 50
    `, [windowHours, CAJA_HORA_INICIO, CAJA_HORA_FIN]);

    const cierresDesviacion = await pool.query(`
      SELECT
        cc.id_cierre,
        cc.fecha_referencia,
        cc.desviacion,
        cc.total_sistema,
        cc.efectivo_declarado,
        cc.creado_en
      FROM caja_cierres cc
      WHERE cc.alerta_desviacion_sn = 'S'
        AND cc.creado_en >= NOW() - make_interval(hours => $1::int)
      ORDER BY cc.creado_en DESC
      LIMIT 30
    `, [windowHours]);

    const totalAlertas =
      anulaciones.rows.length +
      reemisiones.rows.length +
      cobrosFueraHorario.rows.length +
      cierresDesviacion.rows.length;
    const severidad = totalAlertas === 0 ? "NORMAL" : (totalAlertas >= 5 ? "ALTA" : "MEDIA");

    res.json({
      window_hours: windowHours,
      parametros: {
        umbral_anulaciones: umbralAnulaciones,
        horario_caja_inicio: CAJA_HORA_INICIO,
        horario_caja_fin: CAJA_HORA_FIN
      },
      severidad,
      resumen: {
        total_alertas: totalAlertas,
        anulaciones_frecuentes: anulaciones.rows.length,
        reemisiones_recibo: reemisiones.rows.length,
        cobros_fuera_horario: cobrosFueraHorario.rows.length,
        cierres_desviacion: cierresDesviacion.rows.length
      },
      alertas: {
        anulaciones_frecuentes: anulaciones.rows.map((r) => ({
          id_usuario: r.id_usuario ? Number(r.id_usuario) : null,
          username: r.username,
          nombre: r.nombre || null,
          total_anulaciones: Number(r.total_anulaciones || 0),
          ultima_anulacion: r.ultima_anulacion
        })),
        reemisiones_recibo: reemisiones.rows.map((r) => ({
          id_recibo: Number(r.id_recibo),
          total_ordenes: Number(r.total_ordenes || 0),
          primera_emision: r.primera_emision,
          ultima_emision: r.ultima_emision,
          codigo_municipal: r.codigo_municipal || null,
          nombre_completo: r.nombre_completo || null,
          mes: Number(r.mes || 0),
          anio: Number(r.anio || 0)
        })),
        cobros_fuera_horario: cobrosFueraHorario.rows.map((r) => ({
          id_orden: Number(r.id_orden),
          cobrado_en: r.cobrado_en,
          codigo_municipal: r.codigo_municipal || null,
          total_orden: parseMonto(r.total_orden, 0),
          username: r.username || null,
          nombre: r.nombre || null
        })),
        cierres_desviacion: cierresDesviacion.rows.map((r) => ({
          id_cierre: Number(r.id_cierre),
          fecha_referencia: normalizeDateOnly(r.fecha_referencia) || null,
          creado_en: r.creado_en,
          desviacion: parseMonto(r.desviacion, 0),
          total_sistema: parseMonto(r.total_sistema, 0),
          efectivo_declarado: parseMonto(r.efectivo_declarado, 0)
        }))
      }
    });
  } catch (err) {
    console.error("Error consultando alertas de riesgo de caja:", err.message);
    res.status(500).json({ error: "Error consultando alertas de riesgo." });
  }
});

app.delete("/recibos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const recibo = await pool.query("SELECT id_recibo, estado FROM recibos WHERE id_recibo = $1", [id]);
    if (recibo.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    const pagos = await pool.query("SELECT COALESCE(SUM(monto_pagado), 0) as total_pagado FROM pagos WHERE id_recibo = $1", [id]);
    const totalPagado = parseFloat(pagos.rows[0].total_pagado) || 0;
    if (recibo.rows[0].estado !== 'PENDIENTE' || totalPagado > 0) {
      return res.status(400).json({ error: "No se puede eliminar recibos con pagos." });
    }
    await pool.query("DELETE FROM recibos WHERE id_recibo = $1", [id]);
    invalidateContribuyentesCache();
    res.json({ mensaje: "Deuda eliminada" });
  } catch (err) { res.status(500).send("Error"); }
});

// ==========================================
// DASHBOARD Y EXCEL
// ==========================================
app.get("/dashboard/resumen", async (req, res) => {
  try {
    const hoy = toISODate();
    if (dashboardCache.data && dashboardCache.day === hoy && Date.now() < dashboardCache.expiresAt) {
      res.set("Cache-Control", "private, max-age=8");
      return res.json(dashboardCache.data);
    }
    const anioActual = getCurrentYear();
    const mesActual = getCurrentMonth();
    const recaudacion = await pool.query(`
      SELECT COALESCE(SUM(p.monto_pagado), 0) AS total
      FROM pagos p
      WHERE ${PAGO_OPERATIVO_CAJA_SQL}
        AND DATE(p.fecha_pago) = $1
    `, [hoy]);
    const usuarios = await pool.query("SELECT COUNT(*) as total FROM contribuyentes");
    const morosos = await pool.query(`
      SELECT COUNT(DISTINCT r.id_predio) as total
      FROM recibos r
      LEFT JOIN (
        SELECT id_recibo, SUM(monto_pagado) as total_pagado
        FROM pagos
        GROUP BY id_recibo
      ) p ON p.id_recibo = r.id_recibo
      WHERE (r.total_pagar - COALESCE(p.total_pagado, 0)) > 0
        AND ((r.anio < $1) OR (r.anio = $1 AND r.mes <= $2))
    `, [anioActual, mesActual]);
    const payload = {
      recaudado_hoy: recaudacion.rows[0].total || 0,
      total_usuarios: usuarios.rows[0].total || 0,
      total_morosos: morosos.rows[0].total || 0
    };
    dashboardCache = {
      expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
      data: payload,
      day: hoy
    };
    res.set("Cache-Control", "private, max-age=8");
    res.json(payload);
  } catch (err) { res.status(500).send("Error dashboard"); }
});

app.get("/auditoria", authenticateToken, async (req, res) => {
  try {
    const logs = await pool.query("SELECT * FROM auditoria ORDER BY fecha DESC LIMIT 100");
    res.json(logs.rows);
  } catch (err) { res.status(500).send("Error auditoria"); }
});

app.get("/exportar/auditoria", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Auditoria");
    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "FECHA", key: "fecha", width: 22 },
      { header: "USUARIO", key: "usuario", width: 20 },
      { header: "ACCION", key: "accion", width: 35 },
      { header: "DETALLE", key: "detalle", width: 80 }
    ];
    worksheet.getRow(1).font = { bold: true };

    const logs = await pool.query(`
      SELECT id_auditoria, fecha, usuario, accion, detalle
      FROM auditoria
      ORDER BY fecha DESC
      LIMIT 5000
    `);

    logs.rows.forEach((l) => {
      worksheet.addRow({
        id: l.id_auditoria,
        fecha: l.fecha ? new Date(l.fecha).toLocaleString() : "",
        usuario: l.usuario || "",
        accion: l.accion || "",
        detalle: l.detalle || ""
      });
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=auditoria.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).send("Error exportando auditoria");
  }
});

app.get("/exportar/padron", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Padrón');
    worksheet.columns = [
      { header: 'CÓDIGO', key: 'codigo', width: 15 },
      { header: 'DNI / RUC', key: 'dni', width: 15 },
      { header: 'NOMBRE COMPLETO', key: 'nombre', width: 40 },
      { header: 'DIRECCIÓN', key: 'direccion', width: 50 },
      { header: 'DEUDA (S/.)', key: 'deuda', width: 20 },
      { header: 'MESES DEUDA', key: 'meses_deuda', width: 14 },
      { header: 'ESTADO', key: 'estado', width: 15 }
    ];
    worksheet.getRow(1).font = { bold: true };
    const usuarios = await pool.query("SELECT * FROM vista_resumen_contribuyentes ORDER BY nombre_completo ASC"); // Asegúrate de tener esta vista o usa una query
    usuarios.rows.forEach(u => {
      const row = worksheet.addRow({
        codigo: u.codigo_municipal,
        dni: u.dni_ruc,
        nombre: u.nombre_completo,
        direccion: u.direccion_completa,
        deuda: parseFloat(u.deuda_anio),
        meses_deuda: Number.parseInt(u.meses_deuda, 10) || 0,
        estado: parseInt(u.meses_deuda) >= 2 ? 'MOROSO' : 'AL DÍA'
      });
      if (parseInt(u.meses_deuda) >= 2) row.getCell('estado').font = { color: { argb: 'FFFF0000' }, bold: true };
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Padron_Agua.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).send("Error Excel"); }
});

app.get("/exportar/verificacion-campo", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const modo = String(req.query?.modo || "todos").trim().toLowerCase();
    const idCalleRaw = Number(req.query?.id_calle || 0);
    const usarFiltroCalle = Number.isInteger(idCalleRaw) && idCalleRaw > 0;
    const anioActual = getCurrentYear();
    const mesActual = getCurrentMonth();

    const params = [anioActual, mesActual];
    const where = [];
    if (usarFiltroCalle) {
      params.push(idCalleRaw);
      where.push(`p.id_calle = $${params.length}`);
    }
    if (modo === "morosos") {
      where.push("COALESCE(rp.meses_deuda_total, 0) >= 2");
    } else if (modo === "cortados") {
      where.push("COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') = 'CORTADO'");
    } else if (modo === "sin_conexion") {
      where.push("COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') = 'SIN_CONEXION'");
    } else if (modo === "con_conexion") {
      where.push("COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') = 'CON_CONEXION'");
    }

    const sql = `
      WITH recibos_objetivo AS (
        SELECT r.id_recibo, r.id_predio, r.total_pagar
        FROM recibos r
        WHERE (r.anio, r.mes) <= ($1::int, $2::int)
      ),
      pagos_por_recibo AS (
        SELECT p.id_recibo, SUM(p.monto_pagado) AS total_pagado
        FROM pagos p
        JOIN recibos_objetivo ro ON ro.id_recibo = p.id_recibo
        GROUP BY p.id_recibo
      ),
      resumen_predio AS (
        SELECT
          ro.id_predio,
          SUM(GREATEST(ro.total_pagar - COALESCE(pp.total_pagado, 0), 0)) AS deuda_total,
          COUNT(*) FILTER (WHERE (ro.total_pagar - COALESCE(pp.total_pagado, 0)) > 0) AS meses_deuda_total
        FROM recibos_objetivo ro
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
        GROUP BY ro.id_predio
      )
      SELECT
        c.id_contribuyente,
        c.codigo_municipal,
        c.nombre_completo,
        c.dni_ruc,
        c.telefono,
        COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
        COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion_fuente)), ''), 'INFERIDO') AS estado_conexion_fuente,
        COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion_verificado_sn)), ''), 'N') AS estado_conexion_verificado_sn,
        c.estado_conexion_fecha_verificacion,
        c.estado_conexion_motivo_ultimo,
        ${buildDireccionSql("ca", "p")} AS direccion_completa,
        COALESCE(rp.meses_deuda_total, 0) AS meses_deuda,
        COALESCE(rp.deuda_total, 0) AS deuda_total
      FROM contribuyentes c
      LEFT JOIN predios p ON c.id_contribuyente = p.id_contribuyente
      LEFT JOIN calles ca ON p.id_calle = ca.id_calle
      LEFT JOIN resumen_predio rp ON rp.id_predio = p.id_predio
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY c.nombre_completo ASC
    `;
    const data = await pool.query(sql, params);

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Verificacion_Campo");
    ws.columns = [
      { header: "CODIGO", key: "codigo_municipal", width: 12 },
      { header: "NOMBRE_ACTUAL", key: "nombre_actual", width: 38 },
      { header: "DNI_ACTUAL", key: "dni_actual", width: 14 },
      { header: "TELEFONO_ACTUAL", key: "telefono_actual", width: 15 },
      { header: "DIRECCION_ACTUAL", key: "direccion_actual", width: 42 },
      { header: "ESTADO_ACTUAL", key: "estado_actual", width: 16 },
      { header: "FUENTE_ESTADO", key: "fuente_estado", width: 14 },
      { header: "VERIFICADO_CAMPO_SN", key: "verificado_campo_sn", width: 18 },
      { header: "FECHA_ULTIMA_VERIF", key: "fecha_ultima_verif", width: 18 },
      { header: "MESES_DEUDA", key: "meses_deuda", width: 12 },
      { header: "DEUDA_TOTAL", key: "deuda_total", width: 14 },
      { header: "NOMBRE_VERIFICADO", key: "nombre_verificado", width: 38 },
      { header: "DNI_VERIFICADO", key: "dni_verificado", width: 14 },
      { header: "TELEFONO_VERIFICADO", key: "telefono_verificado", width: 18 },
      { header: "DIRECCION_VERIFICADA", key: "direccion_verificada", width: 42 },
      { header: "ESTADO_CONEXION_VERIFICADO", key: "estado_conexion_verificado", width: 25 },
      { header: "MOTIVO_CORTE_U_OBS", key: "motivo", width: 35 },
      { header: "FECHA_VERIFICACION_CAMPO", key: "fecha_verificacion_campo", width: 23 },
      { header: "INSPECTOR", key: "inspector", width: 24 }
    ];
    ws.getRow(1).font = { bold: true };

    data.rows.forEach((r) => {
      ws.addRow({
        codigo_municipal: r.codigo_municipal || "",
        nombre_actual: r.nombre_completo || "",
        dni_actual: r.dni_ruc || "",
        telefono_actual: r.telefono || "",
        direccion_actual: r.direccion_completa || "",
        estado_actual: r.estado_conexion || "CON_CONEXION",
        fuente_estado: r.estado_conexion_fuente || "INFERIDO",
        verificado_campo_sn: r.estado_conexion_verificado_sn || "N",
        fecha_ultima_verif: r.estado_conexion_fecha_verificacion ? String(r.estado_conexion_fecha_verificacion).slice(0, 10) : "",
        meses_deuda: Number(r.meses_deuda || 0),
        deuda_total: parseFloat(r.deuda_total || 0) || 0,
        nombre_verificado: "",
        dni_verificado: "",
        telefono_verificado: "",
        direccion_verificada: "",
        estado_conexion_verificado: "",
        motivo: "",
        fecha_verificacion_campo: "",
        inspector: ""
      });
    });

    ws.views = [{ state: "frozen", ySplit: 1 }];
    const wsAyuda = workbook.addWorksheet("Instrucciones");
    wsAyuda.columns = [{ header: "Instrucciones", key: "txt", width: 140 }];
    wsAyuda.getRow(1).font = { bold: true };
    [
      "1) Use la hoja Verificacion_Campo para imprimir o digitar resultados de visita.",
      "2) Complete CODIGO y los campos *_VERIFICADO si hubo cambio.",
      "3) En ESTADO_CONEXION_VERIFICADO use: CON_CONEXION, SIN_CONEXION o CORTADO.",
      "4) FECHA_VERIFICACION_CAMPO en formato YYYY-MM-DD o DD/MM/YYYY.",
      "5) Luego sincronice cambios desde la app de campo o por API interna."
    ].forEach((txt) => wsAyuda.addRow({ txt }));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=verificacion_campo_template.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error exportando verificacion de campo:", err);
    res.status(500).json({ error: "Error exportando plantilla de verificacion." });
  }
});

app.get("/exportar/usuarios-completo", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Hoja1");
    const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
    const headerFont = { name: "Aptos Narrow", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    const headerBorder = {
      top: { style: "thin", color: { argb: "FF4B5563" } },
      left: { style: "thin", color: { argb: "FF4B5563" } },
      bottom: { style: "thin", color: { argb: "FF4B5563" } },
      right: { style: "thin", color: { argb: "FF4B5563" } }
    };
    const rowFillBlue = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC0E6F5" } };
    const rowFillWhite = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
    worksheet.columns = [
      { header: "Con_ID", key: "Con_ID", width: 10.55 },
      { header: "Con_Cod", key: "Con_Cod", width: 10.55 },
      { header: "Con_DNI", key: "Con_DNI", width: 10.33 },
      { header: "Con_Nombre", key: "Con_Nombre", width: 45.78 },
      { header: "Ca_Cod", key: "Ca_Cod", width: 9.55 },
      { header: "Ca_Nombre", key: "Ca_Nombre", width: 25.89 },
      { header: "con_direccion", key: "con_direccion", width: 50.78 },
      { header: "Con_Nro_MZ_Lote", key: "Con_Nro_MZ_Lote", width: 38 },
      { header: "Agua_SN", key: "Agua_SN", width: 10.44 },
      { header: "Desague_SN", key: "Desague_SN", width: 13.44 },
      { header: "Limpieza_SN", key: "Limpieza_SN", width: 14.11 },
      { header: "Tipo_Tarifa", key: "Tipo_Tarifa", width: 12.22 },
      { header: "Activo_SN", key: "Activo_SN", width: 11.66 },
      { header: "Ultima_Act", key: "Ultima_Act", width: 12.44 },
      { header: "Sec_Cod", key: "Sec_Cod", width: 10.44 },
      { header: "Sec_Nombre", key: "Sec_Nombre", width: 33.44 }
    ];
    const totalColumns = worksheet.columns.length;
    for (let i = 1; i <= totalColumns; i++) {
      const column = worksheet.getColumn(i);
      column.font = { name: "Aptos Narrow", size: 11 };
      column.alignment = { horizontal: "left", vertical: "middle" };
    }

    const templateCandidates = [
      process.env.USUARIOS_EXPORT_TEMPLATE,
      "C:/Users/oskit/Documents/database_users.xlsx",
      path.join(__dirname, "database_users.xlsx")
    ].filter((p) => typeof p === "string" && p.trim().length > 0);

    const deepClone = (value) => (value ? JSON.parse(JSON.stringify(value)) : value);
    const makeCellStyle = (cell) => ({
      numFmt: cell?.numFmt || undefined,
      font: deepClone(cell?.font),
      fill: deepClone(cell?.fill),
      border: deepClone(cell?.border),
      alignment: deepClone(cell?.alignment)
    });
    const applyCellStyle = (cell, style) => {
      if (!cell || !style) return;
      if (style.numFmt) cell.numFmt = style.numFmt;
      if (style.font) cell.font = style.font;
      if (style.fill) cell.fill = style.fill;
      if (style.border) cell.border = style.border;
      if (style.alignment) cell.alignment = style.alignment;
    };

    let templateVisual = null;
    let estilosFilaData = null;
    let alturaFilaData = null;
    const templatePath = templateCandidates.find((p) => fs.existsSync(p));

    if (templatePath) {
      try {
        const tplWb = new ExcelJS.Workbook();
        await tplWb.xlsx.readFile(templatePath);
        const tplWs = tplWb.getWorksheet("Hoja1") || tplWb.worksheets[0];
        if (tplWs) {
          const headerRow = tplWs.getRow(1);
          const filaMuestra = tplWs.getRow(Math.min(2, Math.max(1, tplWs.rowCount)));
          templateVisual = {
            views: deepClone(tplWs.views),
            pageSetup: deepClone(tplWs.pageSetup),
            headerHeight: headerRow?.height || null,
            headerStyles: Array.from({ length: totalColumns }, (_, idx) => makeCellStyle(headerRow.getCell(idx + 1)))
          };
          alturaFilaData = filaMuestra?.height || null;
          estilosFilaData = Array.from({ length: totalColumns }, (_, idx) => makeCellStyle(filaMuestra.getCell(idx + 1)));
        }
      } catch (templateErr) {
        console.warn("[EXPORT_USUARIOS] No se pudo usar plantilla:", templateErr.message);
      }
    }

    if (templateVisual) {
      if (Array.isArray(templateVisual.views) && templateVisual.views.length > 0) {
        worksheet.views = templateVisual.views;
      }
      if (templateVisual.pageSetup) {
        worksheet.pageSetup = { ...worksheet.pageSetup, ...templateVisual.pageSetup };
      }
      const header = worksheet.getRow(1);
      if (templateVisual.headerHeight) header.height = templateVisual.headerHeight;
      for (let i = 1; i <= totalColumns; i++) {
        applyCellStyle(header.getCell(i), templateVisual.headerStyles[i - 1]);
      }
    } else {
      const header = worksheet.getRow(1);
      for (let i = 1; i <= totalColumns; i++) {
        const cell = header.getCell(i);
        cell.font = { name: "Aptos Narrow", size: 11, bold: true };
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
    }
    const header = worksheet.getRow(1);
    for (let i = 1; i <= totalColumns; i++) {
      const cell = header.getCell(i);
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.border = headerBorder;
      cell.alignment = { horizontal: "left", vertical: "middle" };
    }
    header.height = 20;
    worksheet.autoFilter = { from: "A1", to: "P1" };

    const usuarios = await pool.query(`
      SELECT
        c.codigo_municipal,
        c.dni_ruc,
        c.nombre_completo,
        p.id_calle AS ca_cod,
        ca.nombre AS ca_nombre,
        ${buildDireccionSql("ca", "p")} AS con_direccion,
        p.numero_casa,
        p.manzana,
        p.lote,
        p.agua_sn,
        p.desague_sn,
        p.limpieza_sn,
        p.tipo_tarifa,
        p.id_tarifa,
        p.activo_sn,
        p.ultima_act,
        c.sec_cod,
        c.sec_nombre,
        c.id_contribuyente
      FROM contribuyentes c
      LEFT JOIN predios p ON p.id_contribuyente = c.id_contribuyente
      LEFT JOIN calles ca ON ca.id_calle = p.id_calle
      ORDER BY c.codigo_municipal ASC, c.nombre_completo ASC, p.id_predio ASC
    `);

    const toText = (value) => {
      if (value === null || value === undefined) return "";
      return String(value).trim();
    };
    const formatConCod = (value) => {
      const raw = toText(value);
      if (!raw) return "";
      return /^\d+$/.test(raw) ? raw.padStart(6, "0") : raw;
    };
    const snToBit = (value) => {
      const raw = String(value || "").trim().toUpperCase();
      return raw === "S" || raw === "1" || raw === "TRUE" ? 1 : 0;
    };
    const buildNroMzLote = (numero, manzana, lote) => {
      const parts = [];
      const num = toText(numero);
      const mz = toText(manzana);
      const lt = toText(lote);
      if (num) {
        const upper = num.toUpperCase();
        if (upper.startsWith("N") || upper.startsWith("#")) parts.push(num);
        else parts.push(`Nº ${num}`);
      }
      if (mz) parts.push(`MZ ${mz}`);
      if (lt) parts.push(`LT ${lt}`);
      return parts.join(" ").trim();
    };
    const padRight = (value, size) => {
      const text = toText(value);
      if (!text || text.length >= size) return text;
      return text + " ".repeat(size - text.length);
    };
    const buildDireccionTemplate = (direccion, numero, manzana, lote) => {
      const base = toText(direccion).toUpperCase();
      const nroMzLt = buildNroMzLote(numero, manzana, lote);
      if (!base) return nroMzLt;
      if (!nroMzLt) return base;
      return `${padRight(base, 40)}${nroMzLt}`;
    };

    usuarios.rows.forEach((u) => {
      const values = [
        u.id_contribuyente ?? "",
        formatConCod(u.codigo_municipal),
        toText(u.dni_ruc),
        toText(u.nombre_completo),
        toText(u.ca_cod),
        toText(u.ca_nombre),
        buildDireccionTemplate(u.con_direccion, u.numero_casa, u.manzana, u.lote),
        buildNroMzLote(u.numero_casa, u.manzana, u.lote),
        snToBit(u.agua_sn),
        snToBit(u.desague_sn),
        snToBit(u.limpieza_sn),
        u.tipo_tarifa ?? u.id_tarifa ?? "",
        toText(u.activo_sn || "S"),
        u.ultima_act ?? "",
        toText(u.sec_cod),
        toText(u.sec_nombre)
      ];
      const row = worksheet.addRow(values);
      if (alturaFilaData) row.height = alturaFilaData;
      row.getCell(2).numFmt = "@";
      row.getCell(3).numFmt = "@";
      row.getCell(15).numFmt = "@";
      row.getCell(16).numFmt = "@";
      const fill = ((row.number - 2) % 2 === 0) ? rowFillBlue : rowFillWhite;
      for (let i = 1; i <= totalColumns; i++) {
        const cell = row.getCell(i);
        cell.fill = fill;
      }
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=database_users.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).send("Error exportando usuarios");
  }
});

app.get("/exportar/finanzas-completo", authenticateToken, requireSuperAdmin, async (req, res) => {
  const CHUNK_SIZE = 1500;
  const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
  const headerFont = { name: "Aptos Narrow", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  const styleHeaderRow = (ws, columnCount) => {
    const row = ws.getRow(1);
    for (let i = 1; i <= columnCount; i++) {
      const cell = row.getCell(i);
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.alignment = { horizontal: "left", vertical: "middle" };
    }
    row.height = 20;
    row.commit();
  };
  const formatDateTime = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().replace("T", " ").slice(0, 19);
  };

  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  let workbook = null;
  try {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=finanzas_completo.xlsx");
    workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: true,
      useSharedStrings: false
    });

    const wsPagos = workbook.addWorksheet("Pagos");
    wsPagos.columns = [
      { header: "ID PAGO", key: "id_pago", width: 12 },
      { header: "FECHA PAGO", key: "fecha_pago", width: 22 },
      { header: "MONTO PAGADO", key: "monto_pagado", width: 16 },
      { header: "ID RECIBO", key: "id_recibo", width: 12 },
      { header: "AÑO", key: "anio", width: 10 },
      { header: "MES", key: "mes", width: 10 },
      { header: "TOTAL RECIBO", key: "total_pagar", width: 16 },
      { header: "CODIGO", key: "codigo_municipal", width: 16 },
      { header: "DNI / RUC", key: "dni_ruc", width: 16 },
      { header: "NOMBRE", key: "nombre_completo", width: 34 },
      { header: "DIRECCION", key: "direccion_completa", width: 44 }
    ];
    styleHeaderRow(wsPagos, 11);
    const fetchPagosMapByRecibos = async (ids = []) => {
      if (!Array.isArray(ids) || ids.length === 0) return new Map();
      const pagosByRecibo = await pool.query(`
        SELECT p.id_recibo, SUM(p.monto_pagado) AS total_pagado
        FROM pagos p
        WHERE p.id_recibo = ANY($1::int[])
        GROUP BY p.id_recibo
      `, [ids]);
      const map = new Map();
      pagosByRecibo.rows.forEach((r) => {
        map.set(Number(r.id_recibo), toNumber(r.total_pagado));
      });
      return map;
    };

    let lastPagoId = null;
    while (true) {
      const pagos = await pool.query(`
        WITH pagos_chunk AS (
          SELECT
            p.id_pago,
            p.fecha_pago,
            p.monto_pagado,
            p.id_recibo
          FROM pagos p
          WHERE ($1::int IS NULL OR p.id_pago < $1::int)
          ORDER BY p.id_pago DESC
          LIMIT $2
        )
        SELECT
          pc.id_pago,
          pc.fecha_pago,
          pc.monto_pagado,
          r.id_recibo,
          r.anio,
          r.mes,
          r.total_pagar,
          c.codigo_municipal,
          c.dni_ruc,
          c.nombre_completo,
          ${buildDireccionSql("ca", "pr")} AS direccion_completa
        FROM pagos_chunk pc
        INNER JOIN recibos r ON r.id_recibo = pc.id_recibo
        INNER JOIN predios pr ON pr.id_predio = r.id_predio
        INNER JOIN contribuyentes c ON c.id_contribuyente = pr.id_contribuyente
        LEFT JOIN calles ca ON ca.id_calle = pr.id_calle
        ORDER BY pc.id_pago DESC
      `, [lastPagoId, CHUNK_SIZE]);

      if (pagos.rows.length === 0) break;
      for (const pago of pagos.rows) {
        wsPagos.addRow({
          ...pago,
          monto_pagado: toNumber(pago.monto_pagado),
          total_pagar: toNumber(pago.total_pagar),
          fecha_pago: formatDateTime(pago.fecha_pago)
        }).commit();
      }
      lastPagoId = pagos.rows[pagos.rows.length - 1].id_pago;
    }
    wsPagos.commit();

    const wsDeudas = workbook.addWorksheet("Deudas");
    wsDeudas.columns = [
      { header: "ID RECIBO", key: "id_recibo", width: 12 },
      { header: "AÑO", key: "anio", width: 10 },
      { header: "MES", key: "mes", width: 10 },
      { header: "TOTAL RECIBO", key: "total_pagar", width: 16 },
      { header: "TOTAL PAGADO", key: "total_pagado", width: 16 },
      { header: "DEUDA PENDIENTE", key: "deuda_pendiente", width: 18 },
      { header: "ESTADO", key: "estado", width: 12 },
      { header: "CODIGO", key: "codigo_municipal", width: 16 },
      { header: "DNI / RUC", key: "dni_ruc", width: 16 },
      { header: "NOMBRE", key: "nombre_completo", width: 34 },
      { header: "DIRECCION", key: "direccion_completa", width: 44 }
    ];
    styleHeaderRow(wsDeudas, 11);
    const wsHistorial = workbook.addWorksheet("Historial");
    wsHistorial.columns = [
      { header: "ID RECIBO", key: "id_recibo", width: 12 },
      { header: "AÑO", key: "anio", width: 10 },
      { header: "MES", key: "mes", width: 10 },
      { header: "AGUA", key: "subtotal_agua", width: 12 },
      { header: "DESAGUE", key: "subtotal_desague", width: 12 },
      { header: "LIMPIEZA", key: "subtotal_limpieza", width: 12 },
      { header: "ADMIN", key: "subtotal_admin", width: 12 },
      { header: "TOTAL RECIBO", key: "total_pagar", width: 16 },
      { header: "TOTAL PAGADO", key: "total_pagado", width: 16 },
      { header: "SALDO", key: "saldo", width: 14 },
      { header: "ESTADO", key: "estado", width: 12 },
      { header: "CODIGO", key: "codigo_municipal", width: 16 },
      { header: "DNI / RUC", key: "dni_ruc", width: 16 },
      { header: "NOMBRE", key: "nombre_completo", width: 34 },
      { header: "DIRECCION", key: "direccion_completa", width: 44 }
    ];
    styleHeaderRow(wsHistorial, 15);
    let lastReciboId = null;
    while (true) {
      const recibos = await pool.query(`
        WITH recibos_chunk AS (
          SELECT
            r.id_recibo,
            r.id_predio,
            r.anio,
            r.mes,
            r.subtotal_agua,
            r.subtotal_desague,
            r.subtotal_limpieza,
            r.subtotal_admin,
            r.total_pagar
          FROM recibos r
          WHERE ($1::int IS NULL OR r.id_recibo < $1::int)
          ORDER BY r.id_recibo DESC
          LIMIT $2
        )
        SELECT
          rc.id_recibo,
          rc.anio,
          rc.mes,
          rc.subtotal_agua,
          rc.subtotal_desague,
          rc.subtotal_limpieza,
          rc.subtotal_admin,
          rc.total_pagar,
          c.codigo_municipal,
          c.dni_ruc,
          c.nombre_completo,
          ${buildDireccionSql("ca", "pr")} AS direccion_completa
        FROM recibos_chunk rc
        INNER JOIN predios pr ON pr.id_predio = rc.id_predio
        INNER JOIN contribuyentes c ON c.id_contribuyente = pr.id_contribuyente
        LEFT JOIN calles ca ON ca.id_calle = pr.id_calle
        ORDER BY rc.id_recibo DESC
      `, [lastReciboId, CHUNK_SIZE]);

      if (recibos.rows.length === 0) break;
      const ids = recibos.rows.map((r) => Number(r.id_recibo)).filter(Number.isFinite);
      const pagosMap = await fetchPagosMapByRecibos(ids);
      for (const rowData of recibos.rows) {
        const totalPagar = toNumber(rowData.total_pagar);
        const totalPagado = pagosMap.get(Number(rowData.id_recibo)) || 0;
        const saldo = Math.max(totalPagar - totalPagado, 0);
        if (saldo > 0) {
          wsDeudas.addRow({
            id_recibo: rowData.id_recibo,
            anio: rowData.anio,
            mes: rowData.mes,
            total_pagar: totalPagar,
            total_pagado: totalPagado,
            deuda_pendiente: saldo,
            estado: "PENDIENTE",
            codigo_municipal: rowData.codigo_municipal,
            dni_ruc: rowData.dni_ruc,
            nombre_completo: rowData.nombre_completo,
            direccion_completa: rowData.direccion_completa
          }).commit();
        }
        wsHistorial.addRow({
          ...rowData,
          subtotal_agua: toNumber(rowData.subtotal_agua),
          subtotal_desague: toNumber(rowData.subtotal_desague),
          subtotal_limpieza: toNumber(rowData.subtotal_limpieza),
          subtotal_admin: toNumber(rowData.subtotal_admin),
          total_pagar: totalPagar,
          total_pagado: totalPagado,
          saldo,
          estado: saldo > 0 ? "PENDIENTE" : "PAGADO"
        }).commit();
      }
      lastReciboId = recibos.rows[recibos.rows.length - 1].id_recibo;
    }
    wsDeudas.commit();
    wsHistorial.commit();

    await workbook.commit();
  } catch (err) {
    console.error("Error exportando finanzas:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Error exportando finanzas" });
    }
    try { res.end(); } catch {}
  }
});

app.get("/exportar/finanzas-completo.txt", authenticateToken, requireSuperAdmin, async (req, res) => {
  const CHUNK_SIZE = 2000;
  const EPS_TXT = 0.001;
  const writeToResponse = async (chunk) => {
    if (res.write(chunk)) return;
    await new Promise((resolve, reject) => {
      const onDrain = () => {
        res.off("error", onError);
        resolve();
      };
      const onError = (err) => {
        res.off("drain", onDrain);
        reject(err);
      };
      res.once("drain", onDrain);
      res.once("error", onError);
    });
  };
  const formatLegacyMontoTxt = (value) => {
    const n = roundMonto2(parseMonto(value, 0));
    if (!Number.isFinite(n) || Math.abs(n) < 0.000001) return "0";
    const text = String(n);
    return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
  };
  const formatLegacyReciboToken = (idRecibo) => {
    const n = Number(idRecibo || 0);
    if (Number.isInteger(n) && n > 0) return n.toString(16).toUpperCase().padStart(16, "0");
    const fallback = String(idRecibo || "").trim();
    return fallback || "0000000000000000";
  };

  try {
    const fechaSafe = toISODate().replace(/[^0-9]/g, "");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=finanzas_completo_${fechaSafe}.txt`);

    let lastReciboId = null;
    while (true) {
      const recibos = await pool.query(`
        SELECT
          r.id_recibo,
          r.anio,
          r.mes,
          r.subtotal_agua,
          r.subtotal_desague,
          r.subtotal_limpieza,
          r.subtotal_admin,
          r.total_pagar,
          c.codigo_municipal
        FROM recibos r
        INNER JOIN predios pr ON pr.id_predio = r.id_predio
        INNER JOIN contribuyentes c ON c.id_contribuyente = pr.id_contribuyente
        WHERE ($1::int IS NULL OR r.id_recibo < $1::int)
        ORDER BY r.id_recibo DESC
        LIMIT $2
      `, [lastReciboId, CHUNK_SIZE]);

      if (recibos.rows.length === 0) break;

      const ids = recibos.rows
        .map((r) => Number(r.id_recibo))
        .filter((v) => Number.isInteger(v) && v > 0);
      const pagosMap = new Map();
      if (ids.length > 0) {
        const pagos = await pool.query(`
          SELECT p.id_recibo, SUM(p.monto_pagado) AS total_pagado
          FROM pagos p
          WHERE p.id_recibo = ANY($1::int[])
          GROUP BY p.id_recibo
        `, [ids]);
        pagos.rows.forEach((p) => {
          pagosMap.set(Number(p.id_recibo), roundMonto2(parseMonto(p.total_pagado, 0)));
        });
      }

      for (const row of recibos.rows) {
        const codigo = normalizeCodigoMunicipal(row.codigo_municipal, 6) || "000000";
        const anio = String(Number(row.anio || 0)).padStart(4, "0");
        const mes = String(Number(row.mes || 0)).padStart(2, "0");
        const agua = formatLegacyMontoTxt(row.subtotal_agua);
        const desague = formatLegacyMontoTxt(row.subtotal_desague);
        const limpieza = formatLegacyMontoTxt(row.subtotal_limpieza);
        const admin = formatLegacyMontoTxt(row.subtotal_admin);
        const total = roundMonto2(parseMonto(row.total_pagar, 0));
        const pagado = roundMonto2(parseMonto(pagosMap.get(Number(row.id_recibo)), 0));
        const estadoSN = pagado > 0 && pagado >= (total - EPS_TXT) ? "S" : "N";
        const reciboToken = formatLegacyReciboToken(row.id_recibo);
        const line = `"${codigo}","${anio}","${mes}",${agua},${desague},${limpieza},${admin},0,${formatLegacyMontoTxt(total)},${formatLegacyMontoTxt(pagado)},${reciboToken},"${estadoSN}"\n`;
        await writeToResponse(line);
      }

      lastReciboId = recibos.rows[recibos.rows.length - 1].id_recibo;
    }

    res.end();
  } catch (err) {
    console.error("Error exportando finanzas TXT:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Error exportando finanzas en TXT." });
    }
    try { res.end(); } catch {}
  }
});

// ==========================================
// LOGIN Y SEGURIDAD
// ==========================================
app.post("/auth/registro", async (req, res) => {
  try {
    const { username, password, nombre_completo } = req.body;
    await pool.query("ALTER TABLE usuarios_sistema ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL");
    const existe = await pool.query("SELECT * FROM usuarios_sistema WHERE username = $1", [username]);
    if (existe.rows.length > 0) return res.status(400).json({ error: "Usuario ya existe" });
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO usuarios_sistema (username, password, password_visible, nombre_completo, rol, estado) VALUES ($1, $2, $3, $4, 'BRIGADA', 'PENDIENTE')",
      [username, passwordHash, String(password || "").slice(0, 120), nombre_completo]
    );
    res.json({ mensaje: "Solicitud enviada." });
  } catch (err) { res.status(500).send("Error registro"); }
});

const handleLogin = async (req, res) => {
  try {
    await pool.query("ALTER TABLE usuarios_sistema ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL");
    cleanupLoginSecurityMaps();
    const usernameInput = normalizeLimitedText(req.body?.username, 120);
    const password = String(req.body?.password || "");
    if (!usernameInput || !password) {
      return res.status(400).json({ error: "Usuario y contraseña son obligatorios." });
    }

    const usernameKey = normalizeLoginUsername(usernameInput);
    const ipKey = getRequestIp(req);
    const nowMs = Date.now();

    const ipRate = getIpRateInfo(ipKey, nowMs);
    ipRate.count = Number(ipRate.count || 0) + 1;
    loginIpRateMap.set(ipKey, ipRate);
    if (ipRate.count > LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
      const retryAfterSec = Math.max(1, Math.ceil((Number(ipRate.resetAt || nowMs) - nowMs) / 1000));
      res.set("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        error: "Demasiados intentos de inicio de sesion. Espere antes de reintentar.",
        retry_after_sec: retryAfterSec
      });
    }

    const userFail = getUserFailInfo(usernameKey);
    const lockUntil = Number(userFail.lockUntil || 0);
    if (lockUntil && nowMs < lockUntil) {
      const retryAfterSec = Math.max(1, Math.ceil((lockUntil - nowMs) / 1000));
      res.set("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        error: "Usuario bloqueado temporalmente por intentos fallidos.",
        retry_after_sec: retryAfterSec
      });
    }
    if (lockUntil && nowMs >= lockUntil) {
      userFail.lockUntil = 0;
      userFail.count = 0;
      userFail.updatedAt = nowMs;
      loginUserFailMap.set(usernameKey, userFail);
    }

    const user = await pool.query("SELECT * FROM usuarios_sistema WHERE username = $1", [usernameInput]);
    if (user.rows.length === 0) {
      registerLoginFailure(usernameKey);
      return res.status(400).json({ error: "Credenciales invalidas." });
    }

    const datos = user.rows[0];
    const storedPassword = datos.password || "";
    const passwordVisible = String(password || "").slice(0, 120);
    let passwordOk = false;
    if (isBcryptHash(storedPassword)) {
      passwordOk = await bcrypt.compare(password, storedPassword);
      if (passwordOk && !String(datos.password_visible || "").trim()) {
        await pool.query(
          "UPDATE usuarios_sistema SET password_visible = $1 WHERE id_usuario = $2",
          [passwordVisible, datos.id_usuario]
        );
      }
    } else {
      passwordOk = storedPassword === password;
      if (passwordOk) {
        const newHash = await bcrypt.hash(password, 10);
        await pool.query(
          "UPDATE usuarios_sistema SET password = $1, password_visible = $2 WHERE id_usuario = $3",
          [newHash, passwordVisible, datos.id_usuario]
        );
      }
    }

    if (!passwordOk) {
      registerLoginFailure(usernameKey);
      return res.status(400).json({ error: "Credenciales invalidas." });
    }
    if (datos.estado !== "ACTIVO") {
      registerLoginFailure(usernameKey);
      return res.status(403).json({ error: "Cuenta no activa." });
    }

    clearLoginFailure(usernameKey);
    const token = issueToken(datos);
    return res.json({
      token,
      id_usuario: datos.id_usuario,
      nombre: datos.nombre_completo,
      rol: normalizeRole(datos.rol)
    });
  } catch (err) {
    return res.status(500).send("Error login");
  }
};

app.post("/auth/login", handleLogin);
app.post("/login", handleLogin);

app.post("/auth/cambiar-password", async (req, res) => {
  try {
    await pool.query("ALTER TABLE usuarios_sistema ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL");
    const usernameInput = normalizeLimitedText(req.body?.username, 120);
    const passwordActual = String(req.body?.password_actual || "");
    const passwordNuevo = String(req.body?.password_nuevo || "");
    if (!usernameInput || !passwordNuevo) {
      return res.status(400).json({ error: "Usuario y nueva contraseña son obligatorios." });
    }
    if (passwordNuevo.length < 8 || passwordNuevo.length > 120) {
      return res.status(400).json({ error: "Password invalido. Debe tener entre 8 y 120 caracteres." });
    }

    const user = await pool.query(
      "SELECT id_usuario, username, nombre_completo, rol, estado, password FROM usuarios_sistema WHERE username = $1 LIMIT 1",
      [usernameInput]
    );
    if (!user.rows[0]) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }
    const datos = user.rows[0];
    if (String(datos.estado || "").toUpperCase() !== "ACTIVO") {
      return res.status(403).json({ error: "Cuenta no activa." });
    }

    if (passwordActual) {
      const storedPassword = String(datos.password || "");
      let passwordOk = false;
      if (isBcryptHash(storedPassword)) {
        passwordOk = await bcrypt.compare(passwordActual, storedPassword);
      } else {
        passwordOk = storedPassword === passwordActual;
      }
      if (!passwordOk) {
        return res.status(400).json({ error: "Password actual incorrecta." });
      }
      if (passwordActual === passwordNuevo) {
        return res.status(400).json({ error: "La nueva password debe ser diferente a la actual." });
      }
    }

    const newHash = await bcrypt.hash(passwordNuevo, 10);
    await pool.query(
      "UPDATE usuarios_sistema SET password = $1, password_visible = $2 WHERE id_usuario = $3",
      [newHash, String(passwordNuevo).slice(0, 120), Number(datos.id_usuario)]
    );

    const ip = getRequestIp(req);
    await registrarAuditoria(
      null,
      "AUTH_PASSWORD_CAMBIO",
      `id_usuario=${Number(datos.id_usuario)}; username=${datos.username}; via=${passwordActual ? "CON_PASSWORD_ACTUAL" : "SIN_PASSWORD_ACTUAL"}; ip=${ip}`,
      datos.username || "SISTEMA"
    );

    return res.json({ mensaje: "Password actualizada correctamente." });
  } catch (err) {
    return res.status(500).json({ error: "Error cambiando password." });
  }
});


app.get("/admin/usuarios", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query("ALTER TABLE usuarios_sistema ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL");
    const usuarios = await pool.query("SELECT id_usuario, username, nombre_completo, rol, estado, COALESCE(password_visible, '') AS password_visible FROM usuarios_sistema ORDER BY estado DESC");
    const rows = usuarios.rows.map((u) => {
      const rol = normalizeRole(u.rol);
      return {
        ...u,
        rol,
        rol_label: ROLE_LABELS[rol] || rol
      };
    });
    res.json(rows);
  } catch (err) { res.status(500).send("Error"); }
});

app.put("/admin/usuarios/:id", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query("ALTER TABLE usuarios_sistema ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL");
    const { id } = req.params;
    const targetId = Number(id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const allowedEstados = new Set(["PENDIENTE", "ACTIVO", "BLOQUEADO"]);
    const updateParts = [];
    const params = [];
    let paramIndex = 1;
    let nuevoRol = null;
    let nuevoEstado = null;

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "rol")) {
      if (!isKnownRoleValue(req.body.rol)) {
        return res.status(400).json({ error: "Rol inválido" });
      }
      nuevoRol = normalizeRole(req.body.rol);
      updateParts.push(`rol = $${paramIndex++}`);
      params.push(nuevoRol);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "estado")) {
      nuevoEstado = String(req.body.estado || "").trim().toUpperCase();
      if (!allowedEstados.has(nuevoEstado)) {
        return res.status(400).json({ error: "Estado inválido" });
      }
      updateParts.push(`estado = $${paramIndex++}`);
      params.push(nuevoEstado);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "password")) {
      const nuevaPassword = String(req.body.password || "");
      if (nuevaPassword.length < 8 || nuevaPassword.length > 120) {
        return res.status(400).json({ error: "Contraseña inválida. Debe tener entre 8 y 120 caracteres." });
      }
      const nuevoPasswordHash = await bcrypt.hash(nuevaPassword, 10);
      updateParts.push(`password = $${paramIndex++}`);
      params.push(nuevoPasswordHash);
      updateParts.push(`password_visible = $${paramIndex++}`);
      params.push(String(nuevaPassword).slice(0, 120));
    }

    if (updateParts.length === 0) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }

    if (req.user?.id_usuario === targetId) {
      if (nuevoEstado && nuevoEstado !== "ACTIVO") {
        return res.status(400).json({ error: "No puedes bloquearte a ti mismo" });
      }
      if (nuevoRol && nuevoRol !== "ADMIN") {
        return res.status(400).json({ error: "No puedes quitarte el nivel 1 a ti mismo" });
      }
    }

    params.push(targetId);
    const updated = await pool.query(
      `UPDATE usuarios_sistema
       SET ${updateParts.join(", ")}
       WHERE id_usuario = $${paramIndex}
       RETURNING id_usuario, username, nombre_completo, rol, estado, COALESCE(password_visible, '') AS password_visible`,
      params
    );
    if (updated.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    const usuario = updated.rows[0];
    usuario.rol = normalizeRole(usuario.rol);
    usuario.rol_label = ROLE_LABELS[usuario.rol] || usuario.rol;
    res.json({ mensaje: "Usuario actualizado", usuario });
  } catch (err) { res.status(500).send("Error"); }
});

app.delete("/admin/usuarios/:id", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const targetId = Number(req.params?.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }
    if (req.user?.id_usuario === targetId) {
      return res.status(400).json({ error: "No puedes eliminar tu propio usuario." });
    }

    const actual = await pool.query(
      "SELECT id_usuario, username, rol FROM usuarios_sistema WHERE id_usuario = $1",
      [targetId]
    );
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const rolTarget = normalizeRole(actual.rows[0].rol);
    if (rolTarget === "ADMIN") {
      const admins = await pool.query(
        "SELECT COUNT(*)::int AS total FROM usuarios_sistema WHERE UPPER(TRIM(rol)) IN ('ADMIN', 'SUPERADMIN', 'ADMIN_PRINCIPAL', 'NIVEL_1')"
      );
      if (Number(admins.rows?.[0]?.total || 0) <= 1) {
        return res.status(400).json({ error: "No se puede eliminar el único administrador principal." });
      }
    }

    await pool.query("DELETE FROM usuarios_sistema WHERE id_usuario = $1", [targetId]);
    res.json({ mensaje: "Usuario eliminado." });
  } catch (err) {
    res.status(500).json({ error: "Error al eliminar usuario." });
  }
});

// ==========================================
// COMPARACIONES LEGACY VS ACTUAL
// ==========================================
const LEGACY_TEMPLATE_SHEETS = {
  PADRON_ANTIGUO: [
    "Con_ID", "Con_Cod", "Con_DNI", "Con_Nombre", "Ca_Cod", "Ca_Nombre", "con_direccion",
    "Con_Nro_MZ_Lote", "Agua_SN", "Desague_SN", "Limpieza_SN", "Tipo_Tarifa", "Activo_SN", "Ultima_Act",
    "Sec_Cod", "Sec_Nombre"
  ],
  PAGOS_ANTIGUO: ["FECHA PAGO", "CODIGO", "DNI / RUC", "MONTO PAGADO"],
  DEUDAS_ANTIGUO: ["CODIGO", "DNI / RUC", "AÑO", "MES", "DEUDA PENDIENTE"]
};
const LEGACY_COMPARACION_UPLOAD_FIELDS = [
  { name: "archivo_legacy", maxCount: 1 },
  { name: "archivo_usuarios", maxCount: 1 },
  { name: "archivo_finanzas", maxCount: 1 }
];
const LEGACY_SECCIONES = {
  PADRON: "PADRON",
  DEUDA: "DEUDA",
  RECAUDACION: "RECAUDACION"
};
const LEGACY_CATEGORIAS = {
  CAMBIO: "CAMBIO",
  SOLO_ANTIGUA: "SOLO_ANTIGUA",
  SOLO_NUEVA: "SOLO_NUEVA",
  AMBIGUA: "AMBIGUA",
  DIARIO: "DIARIO",
  SEMANAL: "SEMANAL",
  MENSUAL: "MENSUAL",
  ANUAL: "ANUAL"
};
const LEGACY_PADRON_COMPARE_FIELDS_FULL = [
  ["Con_DNI", "dni_ruc"],
  ["Con_Nombre", "nombre_completo"],
  ["con_direccion", "direccion_completa"],
  ["Activo_SN", "estado_conexion"],
  ["Agua_SN", "agua_sn"],
  ["Desague_SN", "desague_sn"],
  ["Limpieza_SN", "limpieza_sn"]
];
const LEGACY_PADRON_COMPARE_FIELDS_EXPORT = [
  ["Con_DNI", "dni_ruc"],
  ["Con_Nombre", "nombre_completo"],
  ["con_direccion", "direccion_completa"],
  ["Activo_SN", "estado_conexion"],
  ["Agua_SN", "agua_sn"],
  ["Desague_SN", "desague_sn"],
  ["Limpieza_SN", "limpieza_sn"]
];
const LEGACY_PADRON_COLUMNS = [
  { key: "id_contribuyente_legacy", aliases: ["CON_ID"], required: false },
  { key: "codigo_municipal", aliases: ["CODIGO_MUNICIPAL", "CON_COD", "CODIGO"], required: true },
  { key: "dni_ruc", aliases: ["DNI_RUC", "CON_DNI", "DNI / RUC", "DNI"], required: false },
  { key: "nombre_completo", aliases: ["NOMBRE_COMPLETO", "CON_NOMBRE", "NOMBRE"], required: true },
  { key: "telefono", aliases: ["TELEFONO", "CON_TELEFONO"], required: false },
  { key: "direccion_completa", aliases: ["DIRECCION_COMPLETA", "CON_DIRECCION", "DIRECCION"], required: true },
  { key: "estado_conexion", aliases: ["ESTADO_CONEXION"], required: false },
  { key: "activo_sn", aliases: ["ACTIVO_SN", "ACTIVO"], required: false },
  { key: "agua_sn", aliases: ["AGUA_SN", "AGUA"], required: false },
  { key: "desague_sn", aliases: ["DESAGUE_SN", "DESAGUE"], required: false },
  { key: "limpieza_sn", aliases: ["LIMPIEZA_SN", "LIMPIEZA"], required: false },
  { key: "tipo_tarifa", aliases: ["TIPO_TARIFA", "TIPO TARIFA"], required: false },
  { key: "sec_cod", aliases: ["SEC_COD", "SEC COD"], required: false },
  { key: "sec_nombre", aliases: ["SEC_NOMBRE", "SEC NOMBRE"], required: false }
];
const LEGACY_PAGOS_COLUMNS = [
  { key: "fecha_pago", aliases: ["FECHA_PAGO", "FECHA PAGO"], required: true },
  { key: "codigo_municipal", aliases: ["CODIGO_MUNICIPAL", "CON_COD", "CODIGO"], required: false },
  { key: "dni_ruc", aliases: ["DNI_RUC", "CON_DNI", "DNI / RUC", "DNI"], required: false },
  { key: "monto_pagado", aliases: ["MONTO_PAGADO", "MONTO PAGADO"], required: true }
];
const LEGACY_DEUDAS_COLUMNS = [
  { key: "codigo_municipal", aliases: ["CODIGO_MUNICIPAL", "CON_COD", "CODIGO"], required: false },
  { key: "dni_ruc", aliases: ["DNI_RUC", "CON_DNI", "DNI / RUC", "DNI"], required: false },
  { key: "anio", aliases: ["ANIO", "AÑO", "ANO"], required: true },
  { key: "mes", aliases: ["MES"], required: true },
  { key: "deuda_total", aliases: ["DEUDA_PENDIENTE", "DEUDA PENDIENTE", "SALDO"], required: true }
];

const roundLegacy2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const sha256Buffer = (buffer) => crypto.createHash("sha256").update(buffer || Buffer.alloc(0)).digest("hex");
const sha256File = async (filePath) => new Promise((resolve, reject) => {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("error", reject);
  stream.on("end", () => resolve(hash.digest("hex")));
});
const sha256UploadedFile = async (archivo) => {
  if (!archivo) return sha256Buffer(Buffer.alloc(0));
  if (archivo.path && fs.existsSync(archivo.path)) return sha256File(archivo.path);
  return sha256Buffer(archivo.buffer);
};
const loadWorkbookFromUploadedFile = async (archivo) => {
  const wb = new ExcelJS.Workbook();
  if (!archivo) return wb;
  if (archivo.path && fs.existsSync(archivo.path)) {
    await wb.xlsx.readFile(archivo.path);
    return wb;
  }
  await wb.xlsx.load(archivo.buffer || Buffer.alloc(0));
  return wb;
};
const collectLegacyUploadedFiles = (req) => {
  const list = [];
  if (req.file) list.push(req.file);
  const grouped = req.files && typeof req.files === "object" ? Object.values(req.files) : [];
  grouped.forEach((arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((f) => list.push(f));
  });
  return list;
};
const cleanupLegacyUploadedFiles = (files = []) => {
  files.forEach((f) => {
    const p = String(f?.path || "").trim();
    if (!p) return;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
  });
};
const normalizeLegacyText = (value) => String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
const normalizeLegacyCodigo = (value) => normalizeCodigoMunicipal(value, 6);
const normalizeLegacyDni = (value) => String(value || "").trim().replace(/[^0-9A-Za-z]/g, "").toUpperCase();
const normalizeLegacySn = (value, fallback = "N") => normalizeSN(value, fallback);

const parseLegacyDateStrict = (value, sheetName, rowNum, fieldName) => {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`Formato inválido en ${sheetName} fila ${rowNum}, campo ${fieldName}. Use YYYY-MM-DD.`);
  }
  const matchIsoDate = raw.match(/^(\d{4}-\d{2}-\d{2})(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/);
  const onlyDate = matchIsoDate ? matchIsoDate[1] : null;
  if (!onlyDate) {
    throw new Error(`Formato inválido en ${sheetName} fila ${rowNum}, campo ${fieldName}. Use YYYY-MM-DD.`);
  }
  const date = new Date(`${onlyDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== onlyDate) {
    throw new Error(`Fecha inválida en ${sheetName} fila ${rowNum}, campo ${fieldName}: ${onlyDate}`);
  }
  return onlyDate;
};

const parseLegacyMontoStrict = (value, sheetName, rowNum, fieldName) => {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Monto inválido en ${sheetName} fila ${rowNum}, campo ${fieldName}: ${raw}`);
  }
  return roundLegacy2(parsed);
};

const parseLegacyIntStrict = (value, sheetName, rowNum, fieldName, min, max) => {
  const raw = String(value || "").trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Número inválido en ${sheetName} fila ${rowNum}, campo ${fieldName}: ${raw}`);
  }
  return parsed;
};

const normalizeLegacyHeaderToken = (value) =>
  normalizeLegacyText(value).replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const getWorksheetByNameFlexible = (workbook, sheetNames = []) => {
  const direct = sheetNames.find((name) => workbook.getWorksheet(name));
  if (direct) return workbook.getWorksheet(direct);
  const targets = new Set(sheetNames.map((s) => normalizeLegacyText(s)));
  const ws = workbook.worksheets.find((w) => targets.has(normalizeLegacyText(w?.name)));
  if (!ws) throw new Error(`No se encontró la hoja requerida: ${sheetNames.join(" / ")}`);
  return ws;
};

const readLegacySheetRowsByColumns = (workbook, sheetNames, columns) => {
  const ws = getWorksheetByNameFlexible(workbook, sheetNames);
  const row1 = ws.getRow(1);
  const maxCols = Math.max(ws.columnCount || 0, row1.cellCount || 0, row1.actualCellCount || 0);
  const headerMap = new Map();
  for (let i = 1; i <= maxCols; i += 1) {
    const raw = String(row1.getCell(i)?.text || row1.getCell(i)?.value || "").trim();
    const token = normalizeLegacyHeaderToken(raw);
    if (token && !headerMap.has(token)) headerMap.set(token, i);
  }
  const resolved = columns.map((col) => {
    const aliases = Array.isArray(col.aliases) ? col.aliases : [];
    let colIdx = 0;
    for (const alias of aliases) {
      const aliasToken = normalizeLegacyHeaderToken(alias);
      const idx = headerMap.get(aliasToken);
      if (idx) {
        colIdx = idx;
        break;
      }
    }
    return { ...col, colIdx };
  });
  const missingRequired = resolved
    .filter((c) => c.required && !c.colIdx)
    .map((c) => `${c.key} [${(c.aliases || []).join(" | ")}]`);
  if (missingRequired.length > 0) {
    throw new Error(
      `Columnas requeridas no encontradas en hoja ${ws.name}: ${missingRequired.join(", ")}.`
    );
  }

  const out = [];
  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum += 1) {
    const row = ws.getRow(rowNum);
    const data = { _linea: rowNum };
    let hasData = false;
    resolved.forEach((c) => {
      const value = c.colIdx
        ? String(row.getCell(c.colIdx)?.text ?? row.getCell(c.colIdx)?.value ?? "").trim()
        : "";
      if (value) hasData = true;
      data[c.key] = value;
    });
    if (hasData) out.push(data);
  }
  return out;
};

const normalizeLegacyEstadoFromFields = (estadoRaw, activoRaw) => {
  const estadoTxt = String(estadoRaw || "").trim();
  if (estadoTxt) return normalizeEstadoConexion(estadoTxt);
  const activoTxt = String(activoRaw || "").trim().toUpperCase();
  if (["0", "N", "NO", "FALSE"].includes(activoTxt)) return ESTADOS_CONEXION.SIN_CONEXION;
  if (["1", "S", "SI", "TRUE"].includes(activoTxt)) return ESTADOS_CONEXION.CON_CONEXION;
  return ESTADOS_CONEXION.CON_CONEXION;
};

const getLegacyUploadFile = (req, fieldName) => {
  if (fieldName === "archivo_legacy" && req.file) return req.file;
  const list = req.files?.[fieldName];
  if (Array.isArray(list) && list.length > 0) return list[0];
  return null;
};

const ensureLegacyUploadFiles = (req, res, next) => {
  uploadLegacyComparacion.fields(LEGACY_COMPARACION_UPLOAD_FIELDS)(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: `El archivo excede el límite permitido (${Math.round(LEGACY_COMPARACION_MAX_FILE_BYTES / (1024 * 1024))}MB).`
      });
    }
    return res.status(400).json({ error: err.message || "No se pudo procesar el archivo." });
  });
};

const mapByKeyMulti = (rows, keyGetter) => {
  const map = new Map();
  for (const row of rows) {
    const key = keyGetter(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
};

const addToNumericMap = (map, key, amount) => {
  if (!key) return;
  const prev = Number(map.get(key) || 0);
  map.set(key, roundLegacy2(prev + Number(amount || 0)));
};

const getWeekStartIso = (isoDate) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
};

const aggregateDailyByGranularity = (dailyMap, granularity) => {
  const out = new Map();
  for (const [isoDate, amount] of dailyMap.entries()) {
    let bucket = isoDate;
    if (granularity === "SEMANAL") bucket = getWeekStartIso(isoDate);
    if (granularity === "MENSUAL") bucket = isoDate.slice(0, 7);
    if (granularity === "ANUAL") bucket = isoDate.slice(0, 4);
    addToNumericMap(out, bucket, amount);
  }
  return out;
};

const listUniqueSortedKeys = (mapA, mapB) => {
  const keys = new Set();
  for (const key of mapA.keys()) keys.add(key);
  for (const key of mapB.keys()) keys.add(key);
  return Array.from(keys).sort((a, b) => String(a).localeCompare(String(b)));
};

const buildCurrentPadronSnapshot = async (db = pool) => {
  const result = await db.query(`
    SELECT
      c.id_contribuyente,
      c.codigo_municipal,
      c.dni_ruc,
      c.nombre_completo,
      c.telefono,
      COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
      c.sec_cod,
      c.sec_nombre,
      COALESCE(p.agua_sn, 'N') AS agua_sn,
      COALESCE(p.desague_sn, 'N') AS desague_sn,
      COALESCE(p.limpieza_sn, 'N') AS limpieza_sn,
      COALESCE(p.tipo_tarifa::text, '') AS tipo_tarifa,
      ${buildDireccionSql("ca", "p")} AS direccion_completa
    FROM contribuyentes c
    LEFT JOIN LATERAL (
      SELECT p.*
      FROM predios p
      WHERE p.id_contribuyente = c.id_contribuyente
      ORDER BY p.id_predio ASC
      LIMIT 1
    ) p ON TRUE
    LEFT JOIN calles ca ON ca.id_calle = p.id_calle
    ORDER BY c.id_contribuyente ASC
  `);

  return result.rows.map((r) => ({
    id_contribuyente: Number(r.id_contribuyente),
    codigo_municipal: normalizeLegacyCodigo(r.codigo_municipal),
    dni_ruc: normalizeLegacyDni(r.dni_ruc),
    nombre_completo: normalizeLegacyText(r.nombre_completo),
    telefono: normalizeLegacyText(r.telefono),
    direccion_completa: normalizeLegacyText(r.direccion_completa),
    estado_conexion: normalizeEstadoConexion(r.estado_conexion),
    agua_sn: normalizeLegacySn(r.agua_sn, "N"),
    desague_sn: normalizeLegacySn(r.desague_sn, "N"),
    limpieza_sn: normalizeLegacySn(r.limpieza_sn, "N"),
    tipo_tarifa: normalizeLegacyText(r.tipo_tarifa),
    sec_cod: normalizeLegacyText(r.sec_cod),
    sec_nombre: normalizeLegacyText(r.sec_nombre),
    _raw: {
      codigo_municipal: String(r.codigo_municipal || "").trim(),
      dni_ruc: String(r.dni_ruc || "").trim(),
      nombre_completo: String(r.nombre_completo || "").trim(),
      telefono: String(r.telefono || "").trim(),
      direccion_completa: String(r.direccion_completa || "").trim(),
      estado_conexion: String(r.estado_conexion || "").trim(),
      agua_sn: String(r.agua_sn || "").trim(),
      desague_sn: String(r.desague_sn || "").trim(),
      limpieza_sn: String(r.limpieza_sn || "").trim(),
      tipo_tarifa: String(r.tipo_tarifa || "").trim(),
      sec_cod: String(r.sec_cod || "").trim(),
      sec_nombre: String(r.sec_nombre || "").trim()
    }
  }));
};

const buildCurrentDeudaSnapshot = async (db = pool) => {
  const anioActual = getCurrentYear();
  const mesActual = getCurrentMonth();
  const result = await db.query(`
    WITH recibos_objetivo AS (
      SELECT r.id_recibo, r.id_predio, r.total_pagar
      FROM recibos r
      WHERE (r.anio, r.mes) <= ($1::int, $2::int)
    ),
    pagos_por_recibo AS (
      SELECT p.id_recibo, SUM(p.monto_pagado) AS total_pagado
      FROM pagos p
      JOIN recibos_objetivo ro ON ro.id_recibo = p.id_recibo
      GROUP BY p.id_recibo
    ),
    deuda_predio AS (
      SELECT
        ro.id_predio,
        SUM(GREATEST(ro.total_pagar - COALESCE(pp.total_pagado, 0), 0)) AS deuda_total
      FROM recibos_objetivo ro
      LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
      GROUP BY ro.id_predio
    )
    SELECT
      c.id_contribuyente,
      c.codigo_municipal,
      c.dni_ruc,
      COALESCE(SUM(dp.deuda_total), 0)::numeric AS deuda_total
    FROM contribuyentes c
    LEFT JOIN predios p ON p.id_contribuyente = c.id_contribuyente
    LEFT JOIN deuda_predio dp ON dp.id_predio = p.id_predio
    GROUP BY c.id_contribuyente, c.codigo_municipal, c.dni_ruc
    ORDER BY c.id_contribuyente ASC
  `, [anioActual, mesActual]);

  return result.rows.map((r) => ({
    id_contribuyente: Number(r.id_contribuyente),
    codigo_municipal: normalizeLegacyCodigo(r.codigo_municipal),
    dni_ruc: normalizeLegacyDni(r.dni_ruc),
    deuda_total: roundLegacy2(r.deuda_total)
  }));
};

const buildCurrentRecaudacionDailySnapshot = async (db, fechaDesde, fechaHasta) => {
  const result = await db.query(`
    SELECT
      to_char(DATE(p.fecha_pago), 'YYYY-MM-DD') AS fecha,
      ROUND(SUM(p.monto_pagado)::numeric, 2) AS total
    FROM pagos p
    WHERE ${PAGO_OPERATIVO_CAJA_SQL}
      AND DATE(p.fecha_pago) >= $1::date
      AND DATE(p.fecha_pago) <= $2::date
    GROUP BY DATE(p.fecha_pago)
    ORDER BY DATE(p.fecha_pago)
  `, [fechaDesde, fechaHasta]);
  const map = new Map();
  result.rows.forEach((r) => map.set(String(r.fecha), roundLegacy2(r.total)));
  return map;
};

const resolveCurrentByCodigoDni = (legacyRow, currentByCodigo, currentByDni, legacyDniCounts) => {
  const codigo = legacyRow?.codigo_municipal || "";
  const dni = legacyRow?.dni_ruc || "";
  if (codigo) {
    const list = currentByCodigo.get(codigo) || [];
    if (list.length === 1) return { matched: list[0], reason: "" };
    if (list.length > 1) return { matched: null, reason: "Codigo duplicado en base actual." };
  }

  if (dni) {
    const legacyDniDup = Number(legacyDniCounts.get(dni) || 0) > 1;
    const list = currentByDni.get(dni) || [];
    if (legacyDniDup) return { matched: null, reason: "DNI/RUC duplicado en archivo legacy." };
    if (list.length === 1) return { matched: list[0], reason: "" };
    if (list.length > 1) return { matched: null, reason: "DNI/RUC ambiguo en base actual." };
  }

  return { matched: null, reason: "" };
};

const buildPadronComparison = (
  legacyPadronRows,
  currentPadronRows,
  tolerancia = LEGACY_COMPARACION_TOLERANCIA,
  options = {}
) => {
  const details = [];
  const summary = {
    total_legacy: legacyPadronRows.length,
    total_actual: currentPadronRows.length,
    coincidencias: 0,
    cambios_registros: 0,
    cambios_campos: 0,
    solo_antigua: 0,
    solo_nueva: 0,
    ambigua: 0
  };
  const currentByCodigo = mapByKeyMulti(currentPadronRows, (r) => r.codigo_municipal);
  const currentByDni = mapByKeyMulti(currentPadronRows, (r) => r.dni_ruc);
  const legacyDniCounts = new Map();
  legacyPadronRows.forEach((r) => {
    if (!r.dni_ruc) return;
    legacyDniCounts.set(r.dni_ruc, Number(legacyDniCounts.get(r.dni_ruc) || 0) + 1);
  });

  const matchedCurrentIds = new Set();
  const compareMode = String(options?.compareMode || "FULL").toUpperCase();
  const compareFields = compareMode === "EXPORT"
    ? LEGACY_PADRON_COMPARE_FIELDS_EXPORT
    : LEGACY_PADRON_COMPARE_FIELDS_FULL;

  for (const legacy of legacyPadronRows) {
    const resolved = resolveCurrentByCodigoDni(legacy, currentByCodigo, currentByDni, legacyDniCounts);
    const matched = resolved.matched;

    if (!matched) {
      if (resolved.reason) {
        summary.ambigua += 1;
        details.push({
          seccion: LEGACY_SECCIONES.PADRON,
          categoria: LEGACY_CATEGORIAS.CAMBIO,
          clave: legacy.codigo_municipal || legacy.dni_ruc || `L${legacy._linea}`,
          codigo_municipal: legacy.codigo_municipal || null,
          dni_ruc: legacy.dni_ruc || null,
          campo: "__registro__",
          valor_antiguo: legacy._raw?.nombre_completo || "",
          valor_nuevo: "",
          delta: null,
          payload_json: { motivo: resolved.reason, linea_legacy: legacy._linea }
        });
      } else {
        summary.solo_antigua += 1;
        details.push({
          seccion: LEGACY_SECCIONES.PADRON,
          categoria: LEGACY_CATEGORIAS.SOLO_ANTIGUA,
          clave: legacy.codigo_municipal || legacy.dni_ruc || `L${legacy._linea}`,
          codigo_municipal: legacy.codigo_municipal || null,
          dni_ruc: legacy.dni_ruc || null,
          campo: "MOTIVO",
          valor_antiguo: legacy._raw?.nombre_completo || "",
          valor_nuevo: "ELIMINADO",
          delta: null,
          payload_json: { linea_legacy: legacy._linea, motivo: "ELIMINADO" }
        });
      }
      continue;
    }

    matchedCurrentIds.add(matched.id_contribuyente);
    const rowDiffs = [];
    compareFields.forEach(([campo, key]) => {
      const legacyValue = String(legacy[key] || "");
      const currentValue = String(matched[key] || "");
      if (legacyValue !== currentValue) {
        rowDiffs.push({
          campo,
          key,
          oldRaw: legacy._raw?.[key] || "",
          newRaw: matched._raw?.[key] || ""
        });
      }
    });

    if (rowDiffs.length === 0) {
      summary.coincidencias += 1;
      continue;
    }

    summary.cambios_registros += 1;
    summary.cambios_campos += rowDiffs.length;
    rowDiffs.forEach((d) => {
      details.push({
        seccion: LEGACY_SECCIONES.PADRON,
        categoria: LEGACY_CATEGORIAS.CAMBIO,
        clave: legacy.codigo_municipal || matched.codigo_municipal || legacy.dni_ruc || null,
        codigo_municipal: legacy.codigo_municipal || matched.codigo_municipal || null,
        dni_ruc: legacy.dni_ruc || matched.dni_ruc || null,
        campo: d.campo,
        valor_antiguo: d.oldRaw,
        valor_nuevo: d.newRaw,
        delta: null,
        payload_json: {
          linea_legacy: legacy._linea,
          id_contribuyente: matched.id_contribuyente,
          tolerancia
        }
      });
    });
  }

  for (const current of currentPadronRows) {
    if (matchedCurrentIds.has(current.id_contribuyente)) continue;
    summary.solo_nueva += 1;
    details.push({
      seccion: LEGACY_SECCIONES.PADRON,
      categoria: LEGACY_CATEGORIAS.SOLO_NUEVA,
      clave: current.codigo_municipal || current.dni_ruc || `C${current.id_contribuyente}`,
      codigo_municipal: current.codigo_municipal || null,
      dni_ruc: current.dni_ruc || null,
      campo: "__registro__",
      valor_antiguo: "",
      valor_nuevo: current._raw?.nombre_completo || "",
      delta: null,
      payload_json: { id_contribuyente: current.id_contribuyente }
    });
  }

  return { summary, details };
};

const buildDeudaComparison = (legacyDebtRows, currentDebtRows, currentPadronRows, tolerancia = LEGACY_COMPARACION_TOLERANCIA) => {
  const details = [];
  const summary = {
    total_legacy: 0,
    total_actual: 0,
    delta_global: 0,
    registros_con_delta: 0,
    solo_antigua: 0,
    solo_nueva: 0,
    ambigua: 0
  };

  const currentByCodigo = mapByKeyMulti(currentPadronRows, (r) => r.codigo_municipal);
  const currentByDni = mapByKeyMulti(currentPadronRows, (r) => r.dni_ruc);
  const legacyDniCounts = new Map();
  legacyDebtRows.forEach((r) => {
    if (!r.dni_ruc) return;
    legacyDniCounts.set(r.dni_ruc, Number(legacyDniCounts.get(r.dni_ruc) || 0) + 1);
  });

  const currentDebtById = new Map();
  currentDebtRows.forEach((r) => {
    currentDebtById.set(r.id_contribuyente, roundLegacy2(r.deuda_total));
    summary.total_actual = roundLegacy2(summary.total_actual + roundLegacy2(r.deuda_total));
  });

  const legacyByCurrentId = new Map();
  const legacySolo = new Map();
  legacyDebtRows.forEach((legacy) => {
    const monto = roundLegacy2(legacy.deuda_total);
    summary.total_legacy = roundLegacy2(summary.total_legacy + monto);
    const resolved = resolveCurrentByCodigoDni(legacy, currentByCodigo, currentByDni, legacyDniCounts);
    if (resolved.matched) {
      addToNumericMap(legacyByCurrentId, String(resolved.matched.id_contribuyente), monto);
      return;
    }
    const key = legacy.codigo_municipal || legacy.dni_ruc || `L${legacy._linea}`;
    addToNumericMap(legacySolo, key, monto);
    if (resolved.reason) {
      summary.ambigua += 1;
      details.push({
        seccion: LEGACY_SECCIONES.DEUDA,
        categoria: LEGACY_CATEGORIAS.CAMBIO,
        clave: key,
        codigo_municipal: legacy.codigo_municipal || null,
        dni_ruc: legacy.dni_ruc || null,
        campo: "DEUDA_TOTAL",
        valor_antiguo: monto.toFixed(2),
        valor_nuevo: "",
        delta: null,
        payload_json: { motivo: resolved.reason, linea_legacy: legacy._linea }
      });
      legacySolo.delete(key);
    }
  });

  const matchedCurrentIds = new Set();
  for (const [idStr, legacyMonto] of legacyByCurrentId.entries()) {
    const id = Number(idStr);
    const currentMonto = roundLegacy2(currentDebtById.get(id) || 0);
    matchedCurrentIds.add(id);
    const delta = roundLegacy2(legacyMonto - currentMonto);
    if (Math.abs(delta) <= tolerancia) continue;
    summary.registros_con_delta += 1;
    const currentInfo = currentPadronRows.find((r) => r.id_contribuyente === id);
    details.push({
      seccion: LEGACY_SECCIONES.DEUDA,
      categoria: LEGACY_CATEGORIAS.CAMBIO,
      clave: currentInfo?.codigo_municipal || currentInfo?.dni_ruc || `ID${id}`,
      codigo_municipal: currentInfo?.codigo_municipal || null,
      dni_ruc: currentInfo?.dni_ruc || null,
      campo: "DEUDA_TOTAL",
      valor_antiguo: roundLegacy2(legacyMonto).toFixed(2),
      valor_nuevo: currentMonto.toFixed(2),
      delta,
      payload_json: { id_contribuyente: id, tolerancia }
    });
  }

  for (const [key, legacyMonto] of legacySolo.entries()) {
    if (Math.abs(legacyMonto) <= tolerancia) continue;
    summary.solo_antigua += 1;
    details.push({
      seccion: LEGACY_SECCIONES.DEUDA,
      categoria: LEGACY_CATEGORIAS.SOLO_ANTIGUA,
      clave: key,
      codigo_municipal: /^\d+$/.test(String(key)) ? key : null,
      dni_ruc: null,
      campo: "DEUDA_TOTAL",
      valor_antiguo: roundLegacy2(legacyMonto).toFixed(2),
      valor_nuevo: "",
      delta: roundLegacy2(legacyMonto),
      payload_json: {}
    });
  }

  for (const current of currentDebtRows) {
    const currentMonto = roundLegacy2(current.deuda_total);
    if (matchedCurrentIds.has(current.id_contribuyente)) continue;
    if (Math.abs(currentMonto) <= tolerancia) continue;
    summary.solo_nueva += 1;
    details.push({
      seccion: LEGACY_SECCIONES.DEUDA,
      categoria: LEGACY_CATEGORIAS.SOLO_NUEVA,
      clave: current.codigo_municipal || current.dni_ruc || `ID${current.id_contribuyente}`,
      codigo_municipal: current.codigo_municipal || null,
      dni_ruc: current.dni_ruc || null,
      campo: "DEUDA_TOTAL",
      valor_antiguo: "",
      valor_nuevo: currentMonto.toFixed(2),
      delta: roundLegacy2(0 - currentMonto),
      payload_json: { id_contribuyente: current.id_contribuyente }
    });
  }

  summary.delta_global = roundLegacy2(summary.total_legacy - summary.total_actual);
  return { summary, details };
};

const buildRecaudacionComparison = (legacyDailyMap, currentDailyMap, tolerancia = LEGACY_COMPARACION_TOLERANCIA) => {
  const details = [];
  const summary = {};
  const granularidades = ["DIARIO", "SEMANAL", "MENSUAL", "ANUAL"];

  granularidades.forEach((g) => {
    const legacyAgg = aggregateDailyByGranularity(legacyDailyMap, g);
    const currentAgg = aggregateDailyByGranularity(currentDailyMap, g);
    const keys = listUniqueSortedKeys(legacyAgg, currentAgg);
    let totalLegacy = 0;
    let totalActual = 0;
    let totalDelta = 0;
    let registrosConDelta = 0;

    keys.forEach((bucket) => {
      const legacyMonto = roundLegacy2(legacyAgg.get(bucket) || 0);
      const currentMonto = roundLegacy2(currentAgg.get(bucket) || 0);
      const delta = roundLegacy2(legacyMonto - currentMonto);
      totalLegacy = roundLegacy2(totalLegacy + legacyMonto);
      totalActual = roundLegacy2(totalActual + currentMonto);
      totalDelta = roundLegacy2(totalDelta + delta);
      if (Math.abs(delta) <= tolerancia) return;

      registrosConDelta += 1;
      details.push({
        seccion: LEGACY_SECCIONES.RECAUDACION,
        categoria: LEGACY_CATEGORIAS.CAMBIO,
        clave: bucket,
        codigo_municipal: null,
        dni_ruc: null,
        campo: `MONTO_RECAUDADO_${g}`,
        valor_antiguo: legacyMonto.toFixed(2),
        valor_nuevo: currentMonto.toFixed(2),
        delta,
        payload_json: { bucket, granularidad: g, tolerancia }
      });
    });

    summary[g.toLowerCase()] = {
      total_legacy: totalLegacy,
      total_actual: totalActual,
      delta: totalDelta,
      registros_con_delta: registrosConDelta
    };
  });

  return { summary, details };
};

const insertComparacionLegacyDetalles = async (client, idCorrida, details) => {
  if (!Array.isArray(details) || details.length === 0) return;
  for (let start = 0; start < details.length; start += LEGACY_COMPARACION_DETAIL_INSERT_CHUNK) {
    const chunk = details.slice(start, start + LEGACY_COMPARACION_DETAIL_INSERT_CHUNK);
    const params = [];
    const valuesSql = chunk.map((d, idx) => {
      const base = idx * 11;
      params.push(
        Number(idCorrida),
        d.seccion || "",
        d.categoria || "",
        d.clave || null,
        d.codigo_municipal || null,
        d.dni_ruc || null,
        d.campo || null,
        d.valor_antiguo || null,
        d.valor_nuevo || null,
        Number.isFinite(Number(d.delta)) ? Number(d.delta) : null,
        JSON.stringify(d.payload_json || {})
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}::jsonb)`;
    }).join(", ");

    await client.query(`
      INSERT INTO comparaciones_legacy_detalle (
        id_corrida, seccion, categoria, clave, codigo_municipal, dni_ruc, campo,
        valor_antiguo, valor_nuevo, delta, payload_json
      ) VALUES ${valuesSql}
    `, params);
  }
};

const flattenSummaryForExcel = (value, prefix = "", rows = []) => {
  if (value === null || value === undefined) return rows;
  if (typeof value !== "object") {
    rows.push({ clave: prefix, valor: String(value) });
    return rows;
  }
  if (Array.isArray(value)) {
    rows.push({ clave: prefix, valor: JSON.stringify(value) });
    return rows;
  }
  Object.keys(value).forEach((k) => {
    const nextPrefix = prefix ? `${prefix}.${k}` : k;
    flattenSummaryForExcel(value[k], nextPrefix, rows);
  });
  return rows;
};

app.post("/comparaciones/legacy/run", ensureLegacyUploadFiles, async (req, res) => {
  const userId = Number(req.user?.id_usuario || 0);
  const userName = req.user?.nombre || req.user?.username || "SISTEMA";
  const lockKey = `legacy:${userId || "anon"}`;
  const uploadedFiles = collectLegacyUploadedFiles(req);
  if (comparacionesLegacyLocks.has(lockKey)) {
    return res.status(409).json({ error: "Ya existe una comparación legacy en proceso para este usuario." });
  }

  comparacionesLegacyLocks.add(lockKey);
  const client = await pool.connect();
  let idCorrida = null;
  const startMs = Date.now();
  try {
    await ensureComparacionesLegacyTables(client);
    const archivoLegacy = getLegacyUploadFile(req, "archivo_legacy");
    const archivoUsuarios = getLegacyUploadFile(req, "archivo_usuarios");
    const archivoFinanzas = getLegacyUploadFile(req, "archivo_finanzas");
    if (archivoLegacy && (archivoUsuarios || archivoFinanzas)) {
      return res.status(400).json({
        error: "Use un solo modo de carga: archivo_legacy, o archivo_usuarios + archivo_finanzas."
      });
    }
    const modoExportes = !archivoLegacy && archivoUsuarios && archivoFinanzas;
    if (!archivoLegacy && !modoExportes) {
      return res.status(400).json({
        error: "Debe adjuntar archivo_legacy (.xlsx) o ambos archivos: archivo_usuarios + archivo_finanzas."
      });
    }

    const validarArchivoXlsx = (archivo, etiqueta) => {
      if (!archivo) return;
      const nombre = String(archivo.originalname || "").trim();
      if (!nombre.toLowerCase().endsWith(".xlsx")) {
        throw new Error(`Formato no válido en ${etiqueta}. Use archivo .xlsx.`);
      }
    };
    validarArchivoXlsx(archivoLegacy, "archivo_legacy");
    validarArchivoXlsx(archivoUsuarios, "archivo_usuarios");
    validarArchivoXlsx(archivoFinanzas, "archivo_finanzas");

    const nombreArchivo = archivoLegacy
      ? String(archivoLegacy.originalname || "").trim()
      : `${String(archivoUsuarios?.originalname || "usuarios.xlsx").trim()} + ${String(archivoFinanzas?.originalname || "finanzas.xlsx").trim()}`;
    const archivoSha = archivoLegacy
      ? await sha256UploadedFile(archivoLegacy)
      : crypto.createHash("sha256")
        .update(Buffer.from(String(archivoUsuarios?.originalname || ""), "utf8"))
        .update(Buffer.from(await sha256UploadedFile(archivoUsuarios), "utf8"))
        .update(Buffer.from(String(archivoFinanzas?.originalname || ""), "utf8"))
        .update(Buffer.from(await sha256UploadedFile(archivoFinanzas), "utf8"))
        .digest("hex");

    if (!nombreArchivo) {
      return res.status(400).json({ error: "No se pudo resolver el nombre del archivo." });
    }

    let fechaDesde = normalizeDateOnly(req.body?.fecha_desde);
    let fechaHasta = normalizeDateOnly(req.body?.fecha_hasta);
    if ((req.body?.fecha_desde && !fechaDesde) || (req.body?.fecha_hasta && !fechaHasta)) {
      return res.status(400).json({ error: "Rango de fechas inválido. Use YYYY-MM-DD." });
    }
    if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
      return res.status(400).json({ error: "fecha_desde no puede ser mayor que fecha_hasta." });
    }

    const corridaInit = await client.query(`
      INSERT INTO comparaciones_legacy_corridas (
        id_usuario, archivo_nombre, archivo_sha256, fecha_desde, fecha_hasta, estado
      ) VALUES ($1, $2, $3, $4, $5, 'EN_PROCESO')
      RETURNING id_corrida
    `, [userId || null, nombreArchivo || "legacy.xlsx", archivoSha, fechaDesde || null, fechaHasta || null]);
    idCorrida = Number(corridaInit.rows[0].id_corrida);

    await registrarAuditoria(
      null,
      "COMPARACION_LEGACY_INICIO",
      `id_corrida=${idCorrida}; archivo=${nombreArchivo}; modo=${modoExportes ? "EXPORTES" : "PLANTILLA"}; usuario_id=${userId || 0}; ip=${getRequestIp(req)}`,
      userName
    );

    let rawPadronRows = [];
    let rawPagosRows = [];
    let rawDeudasRows = [];
    if (modoExportes) {
      const wbUsuarios = await loadWorkbookFromUploadedFile(archivoUsuarios);
      rawPadronRows = readLegacySheetRowsByColumns(
        wbUsuarios,
        ["Hoja1", "PADRON_ANTIGUO"],
        LEGACY_PADRON_COLUMNS
      );

      const wbFinanzas = await loadWorkbookFromUploadedFile(archivoFinanzas);
      rawPagosRows = readLegacySheetRowsByColumns(
        wbFinanzas,
        ["Pagos", "PAGOS_ANTIGUO"],
        LEGACY_PAGOS_COLUMNS
      );
      rawDeudasRows = readLegacySheetRowsByColumns(
        wbFinanzas,
        ["Deudas", "DEUDAS_ANTIGUO", "Historial"],
        LEGACY_DEUDAS_COLUMNS
      );
    } else {
      const wbLegacy = await loadWorkbookFromUploadedFile(archivoLegacy);
      rawPadronRows = readLegacySheetRowsByColumns(
        wbLegacy,
        ["PADRON_ANTIGUO"],
        LEGACY_PADRON_COLUMNS
      );
      rawPagosRows = readLegacySheetRowsByColumns(
        wbLegacy,
        ["PAGOS_ANTIGUO"],
        LEGACY_PAGOS_COLUMNS
      );
      rawDeudasRows = readLegacySheetRowsByColumns(
        wbLegacy,
        ["DEUDAS_ANTIGUO"],
        LEGACY_DEUDAS_COLUMNS
      );
    }

    const legacyPadronRows = rawPadronRows.map((r) => ({
      _linea: Number(r._linea),
      codigo_municipal: normalizeLegacyCodigo(r.codigo_municipal),
      dni_ruc: normalizeLegacyDni(r.dni_ruc),
      nombre_completo: normalizeLegacyText(r.nombre_completo),
      telefono: normalizeLegacyText(r.telefono),
      direccion_completa: normalizeLegacyText(r.direccion_completa),
      estado_conexion: normalizeLegacyEstadoFromFields(r.estado_conexion, r.activo_sn),
      agua_sn: normalizeLegacySn(r.agua_sn, "N"),
      desague_sn: normalizeLegacySn(r.desague_sn, "N"),
      limpieza_sn: normalizeLegacySn(r.limpieza_sn, "N"),
      tipo_tarifa: normalizeLegacyText(r.tipo_tarifa),
      sec_cod: normalizeLegacyText(r.sec_cod),
      sec_nombre: normalizeLegacyText(r.sec_nombre),
      _raw: {
        codigo_municipal: r.codigo_municipal,
        dni_ruc: r.dni_ruc,
        nombre_completo: r.nombre_completo,
        telefono: r.telefono,
        direccion_completa: r.direccion_completa,
        estado_conexion: r.estado_conexion || r.activo_sn || "",
        agua_sn: r.agua_sn,
        desague_sn: r.desague_sn,
        limpieza_sn: r.limpieza_sn,
        tipo_tarifa: r.tipo_tarifa,
        sec_cod: r.sec_cod,
        sec_nombre: r.sec_nombre
      }
    }));

    const legacyPagosRows = rawPagosRows.map((r) => ({
      _linea: Number(r._linea),
      fecha_pago: parseLegacyDateStrict(r.fecha_pago, "PAGOS_ANTIGUO", Number(r._linea), "FECHA_PAGO"),
      codigo_municipal: normalizeLegacyCodigo(r.codigo_municipal),
      dni_ruc: normalizeLegacyDni(r.dni_ruc),
      monto_pagado: parseLegacyMontoStrict(r.monto_pagado, "PAGOS_ANTIGUO", Number(r._linea), "MONTO_PAGADO")
    }));

    const legacyDeudasRows = rawDeudasRows.map((r) => ({
      _linea: Number(r._linea),
      codigo_municipal: normalizeLegacyCodigo(r.codigo_municipal),
      dni_ruc: normalizeLegacyDni(r.dni_ruc),
      anio: parseLegacyIntStrict(r.anio, "DEUDAS_ANTIGUO", Number(r._linea), "ANIO", 1900, 2200),
      mes: parseLegacyIntStrict(r.mes, "DEUDAS_ANTIGUO", Number(r._linea), "MES", 1, 12),
      deuda_total: parseLegacyMontoStrict(r.deuda_total, "DEUDAS_ANTIGUO", Number(r._linea), "DEUDA_PENDIENTE")
    }));

    if (!fechaDesde || !fechaHasta) {
      const fechas = legacyPagosRows.map((r) => r.fecha_pago).filter(Boolean).sort((a, b) => a.localeCompare(b));
      if (fechas.length > 0) {
        fechaDesde = fechaDesde || fechas[0];
        fechaHasta = fechaHasta || fechas[fechas.length - 1];
      } else {
        const hoy = toISODate();
        fechaDesde = fechaDesde || hoy;
        fechaHasta = fechaHasta || hoy;
      }
    }

    const currentPadronRows = await buildCurrentPadronSnapshot(client);
    const currentDeudaRows = await buildCurrentDeudaSnapshot(client);
    const currentDailyRecaudacion = await buildCurrentRecaudacionDailySnapshot(client, fechaDesde, fechaHasta);

    const legacyDailyRecaudacion = new Map();
    legacyPagosRows.forEach((p) => {
      if (p.fecha_pago < fechaDesde || p.fecha_pago > fechaHasta) return;
      addToNumericMap(legacyDailyRecaudacion, p.fecha_pago, p.monto_pagado);
    });

    const hasPadronFullFields = rawPadronRows.some(
      (r) => String(r.telefono || "").trim() || String(r.estado_conexion || "").trim()
    );
    const padronComp = buildPadronComparison(
      legacyPadronRows,
      currentPadronRows,
      LEGACY_COMPARACION_TOLERANCIA,
      { compareMode: hasPadronFullFields ? "FULL" : "EXPORT" }
    );
    const deudaComp = buildDeudaComparison(legacyDeudasRows, currentDeudaRows, currentPadronRows, LEGACY_COMPARACION_TOLERANCIA);
    const recaudacionComp = buildRecaudacionComparison(legacyDailyRecaudacion, currentDailyRecaudacion, LEGACY_COMPARACION_TOLERANCIA);

    const allDetails = [
      ...padronComp.details,
      ...deudaComp.details,
      ...recaudacionComp.details
    ];

    const resumen = {
      meta: {
        origen: modoExportes ? "EXPORTES_USUARIOS_FINANZAS" : "PLANTILLA_UNICA",
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        tolerancia: LEGACY_COMPARACION_TOLERANCIA,
        total_detalles: allDetails.length,
        total_padron_legacy: legacyPadronRows.length,
        total_pagos_legacy: legacyPagosRows.length,
        total_deudas_legacy: legacyDeudasRows.length
      },
      padron: padronComp.summary,
      deuda: deudaComp.summary,
      recaudacion: recaudacionComp.summary
    };

    const duracionMs = Date.now() - startMs;
    await client.query("BEGIN");
    await insertComparacionLegacyDetalles(client, idCorrida, allDetails);
    await client.query(`
      UPDATE comparaciones_legacy_corridas
      SET
        fecha_desde = $2::date,
        fecha_hasta = $3::date,
        duracion_ms = $4,
        estado = 'COMPLETADA',
        resumen_json = $5::jsonb,
        error_json = NULL
      WHERE id_corrida = $1
    `, [idCorrida, fechaDesde, fechaHasta, duracionMs, JSON.stringify(resumen)]);
    await registrarAuditoria(
      client,
      "COMPARACION_LEGACY_COMPLETADA",
      `id_corrida=${idCorrida}; duracion_ms=${duracionMs}; detalles=${allDetails.length}; usuario_id=${userId || 0}`,
      userName
    );
    await client.query("COMMIT");

    return res.json({
      id_corrida: idCorrida,
      estado: "COMPLETADA",
      resumen
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    if (idCorrida) {
      const duracionMs = Date.now() - startMs;
      try {
        await client.query(`
          UPDATE comparaciones_legacy_corridas
          SET
            duracion_ms = $2,
            estado = 'ERROR',
            error_json = $3::jsonb
          WHERE id_corrida = $1
        `, [idCorrida, duracionMs, JSON.stringify({ mensaje: err.message || "Error no controlado" })]);
      } catch {}
      await registrarAuditoria(
        null,
        "COMPARACION_LEGACY_ERROR",
        `id_corrida=${idCorrida}; error=${String(err.message || "desconocido")}; usuario_id=${userId || 0}`,
        userName
      );
    }
    console.error("Error ejecutando comparación legacy:", err);
    const msg = String(err?.message || "Error ejecutando comparación legacy.");
    const isValidationError = [
      "Encabezado inválido",
      "No se encontró la hoja requerida",
      "Columnas requeridas no encontradas",
      "Formato inválido",
      "Formato no válido",
      "Monto inválido",
      "Fecha inválida",
      "Número inválido"
    ].some((token) => msg.includes(token));
    return res.status(isValidationError ? 400 : 500).json({ error: msg });
  } finally {
    comparacionesLegacyLocks.delete(lockKey);
    cleanupLegacyUploadedFiles(uploadedFiles);
    client.release();
  }
});

app.get("/comparaciones/legacy", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query?.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(req.query?.page_size || 20)));
    const offset = (page - 1) * pageSize;

    const totalResult = await pool.query("SELECT COUNT(*)::int AS total FROM comparaciones_legacy_corridas");
    const total = Number(totalResult.rows[0]?.total || 0);
    const rows = await pool.query(`
      SELECT
        id_corrida,
        creado_en,
        id_usuario,
        archivo_nombre,
        fecha_desde,
        fecha_hasta,
        duracion_ms,
        estado,
        resumen_json
      FROM comparaciones_legacy_corridas
      ORDER BY id_corrida DESC
      LIMIT $1 OFFSET $2
    `, [pageSize, offset]);

    res.json({
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      data: rows.rows.map((r) => ({
        ...r,
        id_corrida: Number(r.id_corrida),
        id_usuario: r.id_usuario ? Number(r.id_usuario) : null,
        duracion_ms: r.duracion_ms ? Number(r.duracion_ms) : null
      }))
    });
  } catch (err) {
    console.error("Error listando comparaciones legacy:", err);
    res.status(500).json({ error: "Error listando comparaciones legacy." });
  }
});

app.get("/comparaciones/legacy/plantilla", async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    Object.entries(LEGACY_TEMPLATE_SHEETS).forEach(([sheetName, headers]) => {
      const ws = wb.addWorksheet(sheetName);
      ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(16, h.length + 2) }));
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=plantilla_comparacion_legacy.xlsx");
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error generando plantilla legacy:", err);
    res.status(500).json({ error: "Error generando plantilla legacy." });
  }
});

app.get("/comparaciones/legacy/:id/resumen", async (req, res) => {
  try {
    const idCorrida = Number(req.params?.id);
    if (!Number.isInteger(idCorrida) || idCorrida <= 0) {
      return res.status(400).json({ error: "ID de corrida inválido." });
    }
    const data = await pool.query(`
      SELECT
        id_corrida,
        creado_en,
        id_usuario,
        archivo_nombre,
        archivo_sha256,
        fecha_desde,
        fecha_hasta,
        duracion_ms,
        estado,
        resumen_json,
        error_json
      FROM comparaciones_legacy_corridas
      WHERE id_corrida = $1
      LIMIT 1
    `, [idCorrida]);
    if (data.rows.length === 0) return res.status(404).json({ error: "Corrida no encontrada." });
    const row = data.rows[0];
    res.json({
      ...row,
      id_corrida: Number(row.id_corrida),
      id_usuario: row.id_usuario ? Number(row.id_usuario) : null,
      duracion_ms: row.duracion_ms ? Number(row.duracion_ms) : null
    });
  } catch (err) {
    console.error("Error obteniendo resumen de comparación legacy:", err);
    res.status(500).json({ error: "Error obteniendo resumen." });
  }
});

app.get("/comparaciones/legacy/:id/detalle", async (req, res) => {
  try {
    const idCorrida = Number(req.params?.id);
    if (!Number.isInteger(idCorrida) || idCorrida <= 0) {
      return res.status(400).json({ error: "ID de corrida inválido." });
    }
    const seccionList = String(req.query?.seccion || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const categoriaRaw = String(req.query?.categoria || "").trim().toUpperCase();
    const q = String(req.query?.q || "").trim();
    const page = Math.max(1, Number(req.query?.page || 1));
    const pageSize = Math.min(500, Math.max(25, Number(req.query?.page_size || 200)));
    const offset = (page - 1) * pageSize;

    const where = ["id_corrida = $1"];
    const params = [idCorrida];
    if (seccionList.length === 1) {
      params.push(seccionList[0]);
      where.push(`seccion = $${params.length}`);
    } else if (seccionList.length > 1) {
      params.push(seccionList);
      where.push(`seccion = ANY($${params.length}::text[])`);
    }
    if (categoriaRaw) {
      params.push(categoriaRaw);
      where.push(`categoria = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where.push(`(
        COALESCE(clave, '') ILIKE ${p}
        OR COALESCE(codigo_municipal, '') ILIKE ${p}
        OR COALESCE(dni_ruc, '') ILIKE ${p}
        OR COALESCE(campo, '') ILIKE ${p}
        OR COALESCE(valor_antiguo, '') ILIKE ${p}
        OR COALESCE(valor_nuevo, '') ILIKE ${p}
      )`);
    }

    const totalSql = `SELECT COUNT(*)::int AS total FROM comparaciones_legacy_detalle WHERE ${where.join(" AND ")}`;
    const totalRes = await pool.query(totalSql, params);
    const total = Number(totalRes.rows[0]?.total || 0);

    params.push(pageSize);
    params.push(offset);
    const rows = await pool.query(`
      SELECT
        id_detalle,
        id_corrida,
        seccion,
        categoria,
        clave,
        codigo_municipal,
        dni_ruc,
        campo,
        valor_antiguo,
        valor_nuevo,
        delta,
        payload_json
      FROM comparaciones_legacy_detalle
      WHERE ${where.join(" AND ")}
      ORDER BY
        COALESCE(NULLIF(codigo_municipal, ''), NULLIF(clave, ''), NULLIF(dni_ruc, ''), 'ZZZZZZ') ASC,
        COALESCE(NULLIF(dni_ruc, ''), '') ASC,
        CASE categoria
          WHEN 'CAMBIO' THEN 1
          WHEN 'SOLO_ANTIGUA' THEN 2
          WHEN 'SOLO_NUEVA' THEN 3
          ELSE 9
        END ASC,
        campo ASC,
        id_detalle ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      data: rows.rows.map((r) => ({
        ...r,
        id_detalle: Number(r.id_detalle),
        id_corrida: Number(r.id_corrida),
        delta: r.delta === null ? null : Number(r.delta)
      }))
    });
  } catch (err) {
    console.error("Error obteniendo detalle de comparación legacy:", err);
    res.status(500).json({ error: "Error obteniendo detalle." });
  }
});

app.get("/comparaciones/legacy/:id/exportar", async (req, res) => {
  try {
    const idCorrida = Number(req.params?.id);
    if (!Number.isInteger(idCorrida) || idCorrida <= 0) {
      return res.status(400).json({ error: "ID de corrida inválido." });
    }

    const corrida = await pool.query(`
      SELECT id_corrida, creado_en, archivo_nombre, fecha_desde, fecha_hasta, duracion_ms, estado, resumen_json, error_json
      FROM comparaciones_legacy_corridas
      WHERE id_corrida = $1
      LIMIT 1
    `, [idCorrida]);
    if (corrida.rows.length === 0) return res.status(404).json({ error: "Corrida no encontrada." });

    const detalles = await pool.query(`
      SELECT
        seccion, categoria, clave, codigo_municipal, dni_ruc, campo,
        valor_antiguo, valor_nuevo, delta, payload_json
      FROM comparaciones_legacy_detalle
      WHERE id_corrida = $1
      ORDER BY seccion ASC, categoria ASC, id_detalle ASC
    `, [idCorrida]);

    const wb = new ExcelJS.Workbook();
    const wsResumen = wb.addWorksheet("Resumen");
    wsResumen.columns = [
      { header: "CLAVE", key: "clave", width: 45 },
      { header: "VALOR", key: "valor", width: 60 }
    ];
    wsResumen.getRow(1).font = { bold: true };
    const rowCorrida = corrida.rows[0];
    const baseResumen = {
      id_corrida: Number(rowCorrida.id_corrida),
      creado_en: rowCorrida.creado_en,
      archivo_nombre: rowCorrida.archivo_nombre,
      fecha_desde: rowCorrida.fecha_desde,
      fecha_hasta: rowCorrida.fecha_hasta,
      duracion_ms: rowCorrida.duracion_ms,
      estado: rowCorrida.estado,
      resumen_json: rowCorrida.resumen_json || {},
      error_json: rowCorrida.error_json || {}
    };
    flattenSummaryForExcel(baseResumen).forEach((r) => wsResumen.addRow(r));

    const addDetalleSheet = (name, seccion) => {
      const ws = wb.addWorksheet(name);
      ws.columns = [
        { header: "CATEGORIA", key: "categoria", width: 16 },
        { header: "CLAVE", key: "clave", width: 22 },
        { header: "CODIGO", key: "codigo_municipal", width: 14 },
        { header: "DNI_RUC", key: "dni_ruc", width: 18 },
        { header: "CAMPO", key: "campo", width: 20 },
        { header: "VALOR_ANTIGUO", key: "valor_antiguo", width: 24 },
        { header: "VALOR_NUEVO", key: "valor_nuevo", width: 24 },
        { header: "DELTA", key: "delta", width: 14 },
        { header: "PAYLOAD_JSON", key: "payload_json", width: 60 }
      ];
      ws.getRow(1).font = { bold: true };
      detalles.rows
        .filter((r) => r.seccion === seccion)
        .forEach((r) => {
          ws.addRow({
            categoria: r.categoria,
            clave: r.clave,
            codigo_municipal: r.codigo_municipal,
            dni_ruc: r.dni_ruc,
            campo: r.campo,
            valor_antiguo: r.valor_antiguo,
            valor_nuevo: r.valor_nuevo,
            delta: r.delta === null ? "" : Number(r.delta),
            payload_json: JSON.stringify(r.payload_json || {})
          });
        });
    };

    addDetalleSheet("Padron", LEGACY_SECCIONES.PADRON);
    addDetalleSheet("Deuda", LEGACY_SECCIONES.DEUDA);
    addDetalleSheet("Recaudacion", LEGACY_SECCIONES.RECAUDACION);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=comparacion_legacy_${idCorrida}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error exportando comparación legacy:", err);
    res.status(500).json({ error: "Error exportando comparación legacy." });
  }
});

// ==========================================
// BACKUP
// ==========================================
app.get("/admin/backup", authenticateToken, requireSuperAdmin, (req, res) => {
  const DB_USER = String(process.env.DB_USER || "").trim();
  const DB_HOST = String(process.env.DB_HOST || "").trim();
  const DB_NAME = String(process.env.DB_NAME || "").trim();
  const DB_PORT = String(process.env.DB_PORT || "").trim();
  const DB_PASSWORD = String(process.env.DB_PASSWORD || "");
  const PG_DUMP_PATH = String(process.env.PG_DUMP_PATH || "").trim();
  if (!DB_USER || !DB_HOST || !DB_NAME || !DB_PORT || !DB_PASSWORD) {
    return res.status(500).json({ error: "Configuración de base de datos incompleta para backup." });
  }
  if (!PG_DUMP_PATH) {
    return res.status(500).json({ error: "PG_DUMP_PATH no configurado." });
  }

  const fecha = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `backup_agua_${fecha}.sql`;
  const dumpTemp = path.join(
    os.tmpdir(),
    `tmp_${filename}_${crypto.randomBytes(4).toString("hex")}.sql`
  );
  const cleanupTemp = () => {
    try {
      if (fs.existsSync(dumpTemp)) fs.unlinkSync(dumpTemp);
    } catch {}
  };

  const dump = spawn(PG_DUMP_PATH, [
    '-U', DB_USER,
    '-h', DB_HOST,
    '-p', DB_PORT,
    '-F', 'p',
    '-f', dumpTemp,
    DB_NAME
  ], {
    env: { ...process.env, PGPASSWORD: DB_PASSWORD }
  });
  let stderrChunk = "";
  dump.stderr.on('data', (data) => {
    stderrChunk += String(data || "");
  });
  dump.on('error', () => {
    cleanupTemp();
    if (!res.headersSent) {
      return res.status(500).json({ error: "No se pudo ejecutar pg_dump." });
    }
  });
  dump.on("close", (code) => {
    if (code !== 0) {
      console.error(`[BACKUP] pg_dump terminó con código ${code}.`, stderrChunk.trim());
      cleanupTemp();
      if (!res.headersSent) {
        return res.status(500).json({ error: "Error generando backup." });
      }
      return;
    }
    if (!fs.existsSync(dumpTemp)) {
      if (!res.headersSent) {
        return res.status(500).json({ error: "No se pudo generar archivo de backup." });
      }
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/sql');
    const reader = fs.createReadStream(dumpTemp);
    reader.on("error", () => {
      cleanupTemp();
      if (!res.headersSent) {
        return res.status(500).json({ error: "No se pudo enviar backup." });
      }
      try { res.end(); } catch {}
    });
    reader.on("close", cleanupTemp);
    res.on("close", cleanupTemp);
    reader.pipe(res);
  });
});

// ==========================================
// IMPRESIÓN MASIVA
// ==========================================
app.post("/recibos/masivos", async (req, res) => {
  try {
    const { tipo_seleccion, ids_usuarios, id_calle, anio, mes, meses } = req.body;
    const incluirPagados = normalizeSN(req.body?.incluir_pagados, "N") === "S";
    const permitirMesesFuturos = normalizeSN(req.body?.permitir_meses_futuros, "N") === "S";
    const anioSeleccionado = parsePositiveInt(anio, 0);
    if (!anioSeleccionado) {
      return res.status(400).json({ error: "Año inválido para impresión/reimpresión." });
    }
    const mesesSeleccionados = (Array.isArray(meses) ? meses : [mes])
      .map((m) => Number(m))
      .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
    if (mesesSeleccionados.length === 0) {
      return res.status(400).json({ error: "Seleccione al menos un mes valido." });
    }
    const now = new Date();
    const periodoEmitidoMaximo = now.getMonth() === 0
      ? ((now.getFullYear() - 1) * 100) + 12
      : (now.getFullYear() * 100) + now.getMonth();
    const bloquearMesesNoEmitidos = !incluirPagados || !permitirMesesFuturos;
    if (bloquearMesesNoEmitidos) {
      const tieneMesNoEmitido = mesesSeleccionados.some((mesSel) =>
        ((anioSeleccionado * 100) + Number(mesSel || 0)) > periodoEmitidoMaximo
      );
      if (tieneMesNoEmitido) {
        return res.status(400).json({
          error: incluirPagados
            ? "Para reimpresión solo se permiten meses ya emitidos. Active 'habilitar meses futuros' para pago adelantado."
            : "Para impresión mensual solo se permiten meses ya emitidos."
        });
      }
    }

    let filtro = "";
    const params = [anioSeleccionado, mesesSeleccionados];

    if (tipo_seleccion === 'calle') {
        filtro = "AND p.id_calle = $3";
        params.push(id_calle);
    } else if (tipo_seleccion === 'seleccion') {
        filtro = "AND p.id_contribuyente = ANY($3)";
        params.push(ids_usuarios);
    }

    // Incluimos deuda acumulada para completar la tabla "Deuda Anterior" del recibo.
    const query = `
      WITH pagos_por_recibo AS (
        SELECT id_recibo, SUM(monto_pagado) AS total_pagado
        FROM pagos
        GROUP BY id_recibo
      ),
      resumen_predio AS (
        SELECT
          r.id_predio,
          SUM(GREATEST(r.total_pagar - COALESCE(pp.total_pagado, 0), 0)) AS deuda_total
        FROM recibos r
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = r.id_recibo
        WHERE (r.anio < $1) OR (r.anio = $1 AND r.mes <= (
          SELECT MAX(m) FROM unnest($2::int[]) AS t(m)
        ))
        GROUP BY r.id_predio
      )
      SELECT
        r.*,
        c.nombre_completo,
        c.codigo_municipal,
        c.dni_ruc,
        ${buildDireccionSql("ca", "p")} AS direccion_completa,
        p.numero_casa,
        ca.nombre as nombre_calle,
        GREATEST(
          COALESCE(rp.deuda_total, 0) - GREATEST(r.total_pagar - COALESCE(pp.total_pagado, 0), 0),
          0
        ) AS deuda_anio
      FROM recibos r
      JOIN predios p ON r.id_predio = p.id_predio
      JOIN contribuyentes c ON p.id_contribuyente = c.id_contribuyente
      LEFT JOIN calles ca ON p.id_calle = ca.id_calle
      LEFT JOIN resumen_predio rp ON rp.id_predio = p.id_predio
      LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = r.id_recibo
      WHERE r.anio = $1
        AND r.mes = ANY($2::int[])
        ${incluirPagados ? "" : "AND GREATEST(r.total_pagar - COALESCE(pp.total_pagado, 0), 0) > 0"}
        ${filtro}
      ORDER BY r.mes ASC, ca.nombre ASC, p.numero_casa ASC, c.nombre_completo ASC
    `;
    
    const resultados = await pool.query(query, params);
    if (resultados.rows.length === 0) return res.status(404).json({ error: "No se encontraron recibos." });
    res.json(resultados.rows);
  } catch (err) {
    res.status(500).send("Error al obtener recibos masivos");
  }
});

// ==========================================
// IMPORTACIÓN MAESTRA (XML, EXCEL, CSV)
// ==========================================
app.post("/importar/padron", authenticateToken, requireSuperAdmin, uploadImportSingle("archivo"), async (req, res) => {
  const client = await pool.connect();
  const rechazos = [];
  const resumenRechazos = {
    duplicado_archivo: 0,
    duplicado_archivo_codigo_sistema: 0,
    duplicado_bd: 0,
    duplicado_bd_codigo_sistema: 0,
    datos_invalidos: 0,
    error_bd: 0
  };

  const registrarRechazo = (tipo, data = {}) => {
    if (Object.prototype.hasOwnProperty.call(resumenRechazos, tipo)) {
      resumenRechazos[tipo] += 1;
    }
    if (rechazos.length < MAX_RECHAZOS_IMPORTACION) {
      rechazos.push({
        tipo,
        linea: data.linea || null,
        codigo_municipal: data.codigo_municipal || null,
        nombre: data.nombre || null,
        motivo: data.motivo || tipo
      });
    }
  };

  try {
    if (!req.file) return res.status(400).json({ error: "Sin archivo" });
    const typeError = validateUploadFileType(req.file, {
      allowedExts: [".xml", ".xlsx", ".xls", ".csv"],
      allowedMimeTypes: [
        "application/xml",
        "text/xml",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/csv",
        "application/csv",
        "text/plain",
        "application/octet-stream"
      ]
    });
    if (typeError) return res.status(400).json({ error: typeError });

    let datos = [];
    const nombreArchivo = (req.file.originalname || "").toLowerCase();
    
    if (nombreArchivo.endsWith('.xml')) {
        console.log("Procesando XML...");
        const parser = new xml2js.Parser({ explicitArray: false });
        const xmlText = readTextFromUploadedFile(req.file);
        const resultado = await parser.parseStringPromise(xmlText);
        
        // Ajuste dinámico de raíz
        const rootKey = Object.keys(resultado)[0];
        const items = resultado[rootKey];
        let filasRaw = [];
        if (items && typeof items === 'object') {
             // A veces los datos están un nivel más abajo
             const subKeys = Object.keys(items);
             if(subKeys.length > 0) filasRaw = items[subKeys[0]];
             else filasRaw = items; // O son directos
        }
        
        const arrayFilas = Array.isArray(filasRaw) ? filasRaw : (filasRaw ? [filasRaw] : []);

        datos = arrayFilas.map((fila, idx) => ({
            codigo: fila.Con_Cod,
            dni: fila.Con_DNI || '',
            nombre: fila.Con_Nombre,
            calle_nombre: fila.Ca_Nombre,
            dir_referencia: fila.con_direccion,
            dir_numero: fila.Con_Nro_MZ_Lote,
            agua: fila.Agua_SN,
            desague: fila.Desague_SN,
            limpieza: fila.Limpieza_SN,
            activo: fila.Activo_SN,
            tarifa: fila.Tipo_Tarifa,
            sec_cod: fila.Sec_Cod,
            sec_nombre: fila.Sec_Nombre,
            ultima_act: fila.Ultima_Act,
            ca_cod: fila.Ca_Cod,
            _linea: idx + 1
        }));

    } else {
        const workbook = await loadWorkbookFromImportFile(req.file);
        const worksheet = workbook.getWorksheet(1);
        if (!worksheet) {
          return res.status(400).json({ error: "No se encontró hoja para importar." });
        }
        worksheet.eachRow((row, rowNum) => {
            if (rowNum === 1) return;
            datos.push({
                codigo: row.getCell(1).text,
                dni: row.getCell(2).text,
                nombre: row.getCell(3).text,
                calle_nombre: row.getCell(4).text,
                sec_cod: row.getCell(5).text,
                sec_nombre: row.getCell(6).text,
                dir_referencia: '', dir_numero: '', activo: 'S',
                _linea: rowNum
            });
        });
    }

    if (datos.length === 0) {
      return res.status(400).json({ error: "No se encontraron filas para importar." });
    }

    const callesCache = new Map();
    const dbCalles = await client.query("SELECT * FROM calles");
    dbCalles.rows.forEach(c => callesCache.set(normalizarNombreCalle(c.nombre), c.id_calle));

    const getCalleId = async (nombre) => {
        const k = normalizarNombreCalle(nombre || 'SIN CALLE');
        if (callesCache.has(k)) return callesCache.get(k);
        try {
          const i = await client.query("INSERT INTO calles (nombre) VALUES ($1) RETURNING id_calle", [k]);
          callesCache.set(k, i.rows[0].id_calle);
          return i.rows[0].id_calle;
        } catch (err) {
          if (err.code === '23505') {
            const ex = await client.query("SELECT id_calle FROM calles WHERE nombre = $1 LIMIT 1", [k]);
            if (ex.rows[0]?.id_calle) {
              callesCache.set(k, ex.rows[0].id_calle);
              return ex.rows[0].id_calle;
            }
          }
          throw err;
        }
    };

    const dbCodigos = await client.query("SELECT codigo_municipal, sec_cod FROM contribuyentes");
    const codigosExistentes = new Set(dbCodigos.rows.map((r) => String(r.codigo_municipal || '').trim()));
    const codigosSistemaExistentes = new Set(
      dbCodigos.rows
        .map((r) => String(r.sec_cod || "").trim())
        .filter((v) => v.length > 0)
    );
    const codigosArchivo = new Set();
    const codigosSistemaArchivo = new Set();

    let count = 0;
    for (const d of datos) {
        const codigo = String(d.codigo || '').trim().replace(/"/g, '');
        const codigoSistema = String(d.sec_cod || "").trim();
        const nombre = String(d.nombre || '').trim();
        const linea = d._linea || null;

        if (!codigo || !nombre) {
          registrarRechazo('datos_invalidos', {
            linea,
            codigo_municipal: codigo || null,
            nombre: nombre || null,
            motivo: "Codigo o nombre vacio"
          });
          continue;
        }

        if (codigosArchivo.has(codigo)) {
          registrarRechazo('duplicado_archivo', {
            linea,
            codigo_municipal: codigo,
            nombre,
            motivo: "Codigo duplicado dentro del archivo"
          });
          continue;
        }

        if (codigoSistema && codigosSistemaArchivo.has(codigoSistema)) {
          registrarRechazo('duplicado_archivo_codigo_sistema', {
            linea,
            codigo_municipal: codigo,
            nombre,
            motivo: "Código de sistema duplicado dentro del archivo"
          });
          continue;
        }

        if (codigosExistentes.has(codigo)) {
          registrarRechazo('duplicado_bd', {
            linea,
            codigo_municipal: codigo,
            nombre,
            motivo: "Codigo municipal ya existe en la base de datos"
          });
          continue;
        }

        if (codigoSistema && codigosSistemaExistentes.has(codigoSistema)) {
          registrarRechazo('duplicado_bd_codigo_sistema', {
            linea,
            codigo_municipal: codigo,
            nombre,
            motivo: "Código de sistema ya existe en la base de datos"
          });
          continue;
        }

        try {
          const idCalle = await getCalleId(d.calle_nombre);
          const activoRaw = String(d.activo || "S").trim().toUpperCase();
          const estadoConexionImportado = (activoRaw === "S" || activoRaw === "1" || activoRaw === "TRUE")
            ? ESTADOS_CONEXION.CON_CONEXION
            : ESTADOS_CONEXION.SIN_CONEXION;
          const predioEstadoImportado = estadoConexionToPredio(estadoConexionImportado);
          const nuevoContribuyente = await client.query(
            `INSERT INTO contribuyentes (
              codigo_municipal, dni_ruc, nombre_completo, sec_cod, sec_nombre,
              estado_conexion, estado_conexion_fuente, estado_conexion_verificado_sn, estado_conexion_fecha_verificacion
            ) VALUES ($1,$2,$3,$4,$5,$6,'IMPORTACION','N',NULL) RETURNING id_contribuyente`,
            [codigo, d.dni || '', nombre, codigoSistema || null, d.sec_nombre || null, estadoConexionImportado]
          );

          const idCont = nuevoContribuyente.rows[0].id_contribuyente;
          await client.query(
            `INSERT INTO predios (
              id_contribuyente, id_calle, numero_casa, referencia_direccion,
              agua_sn, desague_sn, limpieza_sn, activo_sn, tipo_tarifa,
              ultima_act, id_tarifa, estado_servicio
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11)`,
            [
              idCont,
              idCalle,
              d.dir_numero || '',
              d.dir_referencia || '',
              d.agua || 'S',
              d.desague || 'S',
              d.limpieza || 'S',
              predioEstadoImportado.activo_sn,
              d.tarifa || null,
              d.ultima_act || null,
              predioEstadoImportado.estado_servicio
            ]
          );

          count += 1;
          codigosArchivo.add(codigo);
          codigosExistentes.add(codigo);
          if (codigoSistema) {
            codigosSistemaArchivo.add(codigoSistema);
            codigosSistemaExistentes.add(codigoSistema);
          }
        } catch (errFila) {
          if (errFila.code === '23505') {
            registrarRechazo('duplicado_bd', {
              linea,
              codigo_municipal: codigo,
              nombre,
              motivo: "Conflicto de duplicado al insertar en BD"
            });
          } else {
            registrarRechazo('error_bd', {
              linea,
              codigo_municipal: codigo,
              nombre,
              motivo: errFila.message
            });
          }
        }
    }

    const totalRechazados = Object.values(resumenRechazos).reduce((acc, n) => acc + n, 0);
    if (count > 0) {
      invalidateContribuyentesCache();
    }
    res.json({
      mensaje: `Padron procesado. Importados: ${count}. Rechazados: ${totalRechazados}.`,
      total_recibidos: datos.length,
      total_importados: count,
      total_rechazados: totalRechazados,
      resumen_rechazos: resumenRechazos,
      rechazos,
      rechazos_mostrados: rechazos.length
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error import: " + err.message });
  } finally {
    cleanupUploadedTempFile(req.file);
    client.release();
  }
});

app.post("/importar/verificacion-campo", authenticateToken, requireAdmin, uploadImportSingle("archivo"), async (req, res) => {
  const client = await pool.connect();
  const rechazos = [];
  const resumenRechazos = {
    datos_invalidos: 0,
    no_encontrado: 0,
    estado_invalido: 0,
    error_bd: 0
  };
  const registrarRechazo = (tipo, data = {}) => {
    if (Object.prototype.hasOwnProperty.call(resumenRechazos, tipo)) {
      resumenRechazos[tipo] += 1;
    }
    if (rechazos.length < MAX_RECHAZOS_IMPORTACION) {
      rechazos.push({
        tipo,
        linea: data.linea || null,
        codigo_municipal: data.codigo_municipal || null,
        nombre: data.nombre || null,
        motivo: data.motivo || tipo
      });
    }
  };

  try {
    if (!req.file) return res.status(400).json({ error: "Debe adjuntar archivo de verificación." });
    const typeError = validateUploadFileType(req.file, {
      allowedExts: [".xlsx", ".xls", ".csv"],
      allowedMimeTypes: [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/csv",
        "application/csv",
        "text/plain",
        "application/octet-stream"
      ]
    });
    if (typeError) return res.status(400).json({ error: typeError });

    const workbook = await loadWorkbookFromImportFile(req.file);
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) return res.status(400).json({ error: "No se encontró hoja para importar." });

    const norm = (v) =>
      String(v || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase()
        .trim();

    const headerMap = new Map();
    worksheet.getRow(1).eachCell((cell, col) => {
      const key = norm(cell?.text || cell?.value);
      if (key) headerMap.set(key, col);
    });

    const getCellText = (row, col) => {
      if (!col) return "";
      const cell = row.getCell(col);
      const value = cell?.text ?? cell?.value ?? "";
      return String(value || "").trim();
    };

    const findValue = (row, aliases = []) => {
      for (const alias of aliases) {
        const col = headerMap.get(norm(alias));
        const value = getCellText(row, col);
        if (value) return value;
      }
      return "";
    };

    const contribuyentesDB = await client.query(`
      SELECT
        id_contribuyente,
        codigo_municipal,
        nombre_completo,
        dni_ruc,
        telefono,
        COALESCE(NULLIF(UPPER(TRIM(estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion
      FROM contribuyentes
    `);
    const byCodigo = new Map();
    contribuyentesDB.rows.forEach((r) => byCodigo.set(String(r.codigo_municipal || "").trim(), r));

    let totalFilas = 0;
    let actualizados = 0;
    let eventos = 0;

    for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
      const row = worksheet.getRow(rowNum);
      const codigo = findValue(row, ["CODIGO", "CODIGO_MUNICIPAL", "CON_COD", "CONCOD"]).replace(/"/g, "");
      const estadoTxt = findValue(row, ["ESTADO_CONEXION_VERIFICADO", "ESTADO_CONEXION", "ESTADO"]);
      const motivoTxt = findValue(row, ["MOTIVO_CORTE_U_OBS", "MOTIVO", "OBSERVACIONES", "OBSERVACION"]);
      const fechaTxt = findValue(row, ["FECHA_VERIFICACION_CAMPO", "FECHA_VERIFICACION", "FECHA"]);
      const inspectorTxt = findValue(row, ["INSPECTOR", "EMPADRONADOR"]);
      const verificadoTxt = findValue(row, ["VERIFICADO_CAMPO_SN", "VERIFICADO"]);
      const nombreVerificado = findValue(row, ["NOMBRE_VERIFICADO"]);
      const dniVerificado = findValue(row, ["DNI_VERIFICADO"]);
      const telefonoVerificado = findValue(row, ["TELEFONO_VERIFICADO"]);
      const direccionVerificada = findValue(row, ["DIRECCION_VERIFICADA"]);

      const tieneContenido = [codigo, estadoTxt, motivoTxt, fechaTxt, inspectorTxt, nombreVerificado, dniVerificado, telefonoVerificado, direccionVerificada]
        .some((v) => String(v || "").trim().length > 0);
      if (!tieneContenido) continue;
      totalFilas += 1;

      if (!codigo) {
        registrarRechazo("datos_invalidos", { linea: rowNum, motivo: "Código municipal vacío." });
        continue;
      }

      const actual = byCodigo.get(codigo);
      if (!actual) {
        registrarRechazo("no_encontrado", { linea: rowNum, codigo_municipal: codigo, motivo: "Código no existe en sistema." });
        continue;
      }

      const estadoNormalizado = estadoTxt ? tryNormalizeEstadoConexion(estadoTxt) : actual.estado_conexion;
      if (estadoTxt && !estadoNormalizado) {
        registrarRechazo("estado_invalido", { linea: rowNum, codigo_municipal: codigo, nombre: actual.nombre_completo, motivo: `Estado inválido: ${estadoTxt}` });
        continue;
      }

      const motivo = [motivoTxt, inspectorTxt ? `Inspector: ${inspectorTxt}` : ""].filter(Boolean).join(" | ");
      const fechaVerificacion = normalizeDateOnly(fechaTxt) || toISODate();
      const verificadoSN = normalizeSN(verificadoTxt, "S");

      const nuevoNombre = nombreVerificado || actual.nombre_completo || "";
      const nuevoDni = dniVerificado || actual.dni_ruc || "";
      const nuevoTelefono = telefonoVerificado || actual.telefono || "";
      const estadoChanged = estadoNormalizado !== actual.estado_conexion;
      const predioEstado = estadoConexionToPredio(estadoNormalizado);

      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE contribuyentes
           SET nombre_completo = $1,
               dni_ruc = $2,
               telefono = $3,
               estado_conexion = $4,
               estado_conexion_fuente = 'CAMPO',
               estado_conexion_verificado_sn = $5,
               estado_conexion_fecha_verificacion = $6,
               estado_conexion_motivo_ultimo = $7
           WHERE id_contribuyente = $8`,
          [nuevoNombre, nuevoDni, nuevoTelefono, estadoNormalizado, verificadoSN, fechaVerificacion, motivo || null, actual.id_contribuyente]
        );
        await client.query(
          "UPDATE predios SET activo_sn = $1, estado_servicio = $2, referencia_direccion = COALESCE(NULLIF($3, ''), referencia_direccion) WHERE id_contribuyente = $4",
          [predioEstado.activo_sn, predioEstado.estado_servicio, direccionVerificada || "", actual.id_contribuyente]
        );
        if (estadoChanged) {
          await ensureEstadoConexionEventosTable(client);
          await client.query(
            `INSERT INTO estado_conexion_eventos (
              id_usuario, id_contribuyente, estado_anterior, estado_nuevo, motivo
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
              req.user?.id_usuario || null,
              actual.id_contribuyente,
              actual.estado_conexion,
              estadoNormalizado,
              motivo || "Actualizado por verificación de campo"
            ]
          );
          eventos += 1;
        }
        await client.query("COMMIT");
        actualizados += 1;
      } catch (errFila) {
        try { await client.query("ROLLBACK"); } catch {}
        registrarRechazo("error_bd", {
          linea: rowNum,
          codigo_municipal: codigo,
          nombre: actual.nombre_completo,
          motivo: errFila.message
        });
      }
    }

    if (actualizados > 0) {
      invalidateContribuyentesCache();
      realtimeHub.broadcast("deuda", "saldo_actualizado", {
        id_contribuyente: null,
        total_actualizados: Number(actualizados || 0),
        origen: "importar_verificacion_campo"
      });
      await registrarAuditoria(
        null,
        "IMPORTAR_VERIFICACION_CAMPO",
        `Filas: ${totalFilas}. Actualizados: ${actualizados}. Eventos estado: ${eventos}. Rechazados: ${Object.values(resumenRechazos).reduce((a, b) => a + b, 0)}.`,
        req.user?.nombre || req.user?.username || "SISTEMA"
      );
    }

    const totalRechazados = Object.values(resumenRechazos).reduce((a, b) => a + b, 0);
    return res.json({
      mensaje: "Verificación de campo importada.",
      total_recibidos: totalFilas,
      total_importados: actualizados,
      total_rechazados: totalRechazados,
      total_eventos_estado: eventos,
      resumen_rechazos: resumenRechazos,
      rechazos,
      rechazos_mostrados: rechazos.length
    });
  } catch (err) {
    console.error("Error importando verificación campo:", err);
    return res.status(500).json({ error: `Error importando verificación de campo: ${err.message}` });
  } finally {
    cleanupUploadedTempFile(req.file);
    client.release();
  }
});

app.post("/importar/historial", authenticateToken, requireSuperAdmin, uploadImportSingle("archivo"), async (req, res) => {
  if (importacionHistorialEnCurso) {
    return res.status(409).json({ error: "Ya hay una importación de historial en curso." });
  }

  try {
    if (!req.file) {
      return res.status(400).json({ error: "Debe adjuntar un archivo .txt o .csv." });
    }
    const typeError = validateUploadFileType(req.file, {
      allowedExts: [".txt", ".csv"],
      allowedMimeTypes: [
        "text/plain",
        "text/csv",
        "application/csv",
        "application/octet-stream"
      ]
    });
    if (typeError) return res.status(400).json({ error: typeError });

    const nombre = (req.file.originalname || "").toLowerCase();
    if (!nombre.endsWith(".txt") && !nombre.endsWith(".csv")) {
      return res.status(400).json({ error: "Formato no válido. Use .txt o .csv." });
    }

    importacionHistorialEnCurso = true;
    const inputStream = createReadStreamFromUploadedFile(req.file);
    if (!inputStream) {
      return res.status(400).json({ error: "El archivo está vacío." });
    }

    const resultado = await importarDeudas({
      inputStream,
      commitPerBatch: true,
      maxRechazos: MAX_RECHAZOS_IMPORTACION,
      logger: {
        log: (msg) => console.log(`[IMPORTAR_HISTORIAL] ${msg}`),
        error: (msg, err) => console.error(`[IMPORTAR_HISTORIAL] ${msg}`, err),
        progress: () => {}
      }
    });

    if (Number(resultado?.total_recibos_procesados || 0) > 0 || Number(resultado?.total_pagos_registrados || 0) > 0) {
      invalidateContribuyentesCache();
      realtimeHub.broadcast("deuda", "saldo_actualizado", {
        id_contribuyente: null,
        total_recibos_procesados: Number(resultado?.total_recibos_procesados || 0),
        total_pagos_registrados: Number(resultado?.total_pagos_registrados || 0),
        origen: "importar_historial"
      });
    }

    return res.json({
      mensaje: "Historial importado correctamente.",
      ...resultado
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: `Error importando historial: ${err.message}` });
  } finally {
    importacionHistorialEnCurso = false;
    cleanupUploadedTempFile(req.file);
  }
});

const getFechaLocalPartes = (timeZone = AUTO_DEUDA_TIMEZONE, fecha = new Date()) => {
  return getFechaPartesZona(fecha, timeZone);
};

let autoCierreCajaEnCurso = false;
let ultimoDiaAutoCierreCaja = "";
const getHoraMinuto = (hhmm = "16:00") => {
  const [hTxt, mTxt] = String(hhmm || "16:00").split(":");
  const hora = Number(hTxt);
  const minuto = Number(mTxt);
  return {
    hora: Number.isFinite(hora) ? hora : 16,
    minuto: Number.isFinite(minuto) ? minuto : 0
  };
};

const registrarAutoCierreCajaDiario = async () => {
  if (autoCierreCajaEnCurso) return;

  const partesHoy = getFechaPartesZona(new Date(), APP_TIMEZONE);
  const meta = getHoraMinuto(CAJA_AUTO_CIERRE_HORA);
  const yaEsHora = (partesHoy.hora > meta.hora) || (partesHoy.hora === meta.hora && partesHoy.minuto >= meta.minuto);
  if (!yaEsHora) return;

  const fechaHoy = toISODate();
  if (ultimoDiaAutoCierreCaja === fechaHoy) return;

  autoCierreCajaEnCurso = true;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureCajaCierresTable(client);
    await ensureCajaConteosEfectivoTable(client);

    const existe = await client.query(
      `SELECT id_cierre
       FROM caja_cierres
       WHERE tipo = 'diario'
         AND fecha_referencia = $1::date
       LIMIT 1
       FOR UPDATE`,
      [fechaHoy]
    );
    if (existe.rows[0]) {
      await client.query("COMMIT");
      ultimoDiaAutoCierreCaja = fechaHoy;
      return;
    }

    const resumen = await construirResumenCaja("diario", fechaHoy);
    const totalSistema = roundMonto2(parseMonto(resumen?.total, 0));
    const rango = await obtenerRangoCaja("diario", fechaHoy);
    const insertAuto = await client.query(
      `INSERT INTO caja_cierres (
        id_usuario,
        tipo,
        fecha_referencia,
        desde,
        hasta_exclusivo,
        total_sistema,
        efectivo_declarado,
        desviacion,
        alerta_desviacion_sn,
        observacion
      )
      VALUES ($1, 'diario', $2::date, $3::date, $4::date, $5, $6, $7, 'N', $8)
      RETURNING id_cierre`,
      [
        null,
        fechaHoy,
        rango?.desde || fechaHoy,
        rango?.hasta || fechaHoy,
        totalSistema,
        totalSistema,
        0,
        `AUTO_CIERRE_${CAJA_AUTO_CIERRE_HORA}`
      ]
    );
    const idCierreAuto = Number(insertAuto.rows[0]?.id_cierre || 0);
    await client.query(
      `UPDATE caja_conteos_efectivo
       SET estado = $2,
           actualizado_en = NOW(),
           id_cierre = $3
       WHERE fecha_referencia = $1::date
         AND estado = $4`,
      [
        fechaHoy,
        ESTADOS_CONTEO_EFECTIVO.APLICADO,
        idCierreAuto || null,
        ESTADOS_CONTEO_EFECTIVO.PENDIENTE
      ]
    );
    await registrarAuditoria(
      client,
      "CAJA_CIERRE_AUTO",
      `fecha=${fechaHoy}; total_sistema=${totalSistema.toFixed(2)}; hora_programada=${CAJA_AUTO_CIERRE_HORA}`,
      "SISTEMA"
    );
    await client.query("COMMIT");
    realtimeHub.broadcast("caja", "cierre_auto", {
      fecha_referencia: fechaHoy,
      id_cierre: idCierreAuto || null
    });
    ultimoDiaAutoCierreCaja = fechaHoy;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[CAJA] Error en cierre automatico diario:", err.message);
  } finally {
    client.release();
    autoCierreCajaEnCurso = false;
  }
};

const iniciarTareaAutoCierreCaja = () => {
  registrarAutoCierreCajaDiario().catch((err) => {
    console.error("[CAJA] Error inicial cierre automatico:", err.message);
  });
  setInterval(() => {
    registrarAutoCierreCajaDiario().catch((err) => {
      console.error("[CAJA] Error ciclo cierre automatico:", err.message);
    });
  }, CAJA_AUTO_CIERRE_CHECK_MS);
};

const generarDeudaMensualAutomatica = async () => {
  if (!AUTO_DEUDA_ACTIVA || autoDeudaEnCurso) return;

  const { anio, mes, dia, hora, minuto } = getFechaLocalPartes();
  const diasDelMesActual = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const esCierreMes = dia === diasDelMesActual && hora === 23 && minuto >= 55;
  const esInicioMes = dia === 1 && hora === 0 && minuto <= 10;
  if (!esCierreMes && !esInicioMes) return;

  let anioObjetivo = anio;
  let mesObjetivo = mes;
  if (esInicioMes && !esCierreMes) {
    // Contingencia: si el servidor no corrió al cierre, en el minuto 0 del día 1
    // se intenta crear el periodo del mes que acaba de terminar.
    mesObjetivo -= 1;
    if (mesObjetivo < 1) {
      mesObjetivo = 12;
      anioObjetivo -= 1;
    }
  }

  const periodo = `${anioObjetivo}-${String(mesObjetivo).padStart(2, "0")}`;
  if (ultimoPeriodoAutoDeuda === periodo) return;

  autoDeudaEnCurso = true;
  const client = await pool.connect();
  try {
    const params = [
      anioObjetivo,
      mesObjetivo,
      AUTO_DEUDA_BASE.agua,
      AUTO_DEUDA_BASE.desague,
      AUTO_DEUDA_BASE.limpieza,
      AUTO_DEUDA_BASE.admin
    ];

    const resultado = await client.query(`
      INSERT INTO recibos (
        id_predio, anio, mes, subtotal_agua, subtotal_desague, subtotal_limpieza,
        subtotal_admin, total_pagar, estado, fecha_emision, fecha_vencimiento
      )
      SELECT
        p.id_predio,
        $1::int,
        $2::int,
        CASE WHEN ${sqlSnEsSi("p.agua_sn", "S")} THEN COALESCE(p.tarifa_agua, $3::numeric) ELSE 0 END,
        CASE WHEN ${sqlSnEsSi("p.desague_sn", "S")} THEN COALESCE(p.tarifa_desague, $4::numeric) ELSE 0 END,
        CASE WHEN ${sqlSnEsSi("p.limpieza_sn", "S")} THEN COALESCE(p.tarifa_limpieza, $5::numeric) ELSE 0 END,
        CASE WHEN ${sqlSnEsSi("p.activo_sn", "S")} THEN (COALESCE(p.tarifa_admin, $6::numeric) + COALESCE(p.tarifa_extra, 0::numeric)) ELSE 0 END,
        (
          CASE WHEN ${sqlSnEsSi("p.agua_sn", "S")} THEN COALESCE(p.tarifa_agua, $3::numeric) ELSE 0 END +
          CASE WHEN ${sqlSnEsSi("p.desague_sn", "S")} THEN COALESCE(p.tarifa_desague, $4::numeric) ELSE 0 END +
          CASE WHEN ${sqlSnEsSi("p.limpieza_sn", "S")} THEN COALESCE(p.tarifa_limpieza, $5::numeric) ELSE 0 END +
          CASE WHEN ${sqlSnEsSi("p.activo_sn", "S")} THEN (COALESCE(p.tarifa_admin, $6::numeric) + COALESCE(p.tarifa_extra, 0::numeric)) ELSE 0 END
        ) AS total_pagar,
        'PENDIENTE',
        make_date($1::int, $2::int, 1),
        (make_date($1::int, $2::int, 1) + INTERVAL '1 month')::date
      FROM predios p
      JOIN contribuyentes c ON c.id_contribuyente = p.id_contribuyente
      WHERE ${sqlSnEsSi("p.activo_sn", "S")}
        AND COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') = 'CON_CONEXION'
      ON CONFLICT DO NOTHING
      RETURNING id_recibo
    `, params);

    ultimoPeriodoAutoDeuda = periodo;
    await registrarAuditoria(
      null,
      "AUTO_DEUDA_MENSUAL",
      `Generacion automatica ${periodo}: ${resultado.rowCount} recibos creados.`
    );
    if (Number(resultado.rowCount || 0) > 0) {
      invalidateContribuyentesCache();
      realtimeHub.broadcast("deuda", "recibo_generado", {
        id_contribuyente: null,
        total_recibos: Number(resultado.rowCount || 0),
        origen: "auto_deuda_mensual",
        periodo
      });
    }
    console.log(`[AUTO_DEUDA] ${periodo}: ${resultado.rowCount} recibos generados.`);
  } catch (err) {
    console.error("[AUTO_DEUDA] Error en generación automática:", err);
  } finally {
    client.release();
    autoDeudaEnCurso = false;
  }
};

const iniciarTareaAutoDeuda = () => {
  if (!AUTO_DEUDA_ACTIVA) {
    console.log("[AUTO_DEUDA] Desactivada por configuración.");
    return;
  }

  const intervaloBase = Number.isFinite(AUTO_DEUDA_CHECK_MS) && AUTO_DEUDA_CHECK_MS > 0
    ? AUTO_DEUDA_CHECK_MS
    : 60 * 60 * 1000;
  const intervalo = Math.min(intervaloBase, 60 * 1000);
  if (intervaloBase > intervalo) {
    console.log(`[AUTO_DEUDA] Intervalo ajustado a ${intervalo}ms para ejecución precisa al cierre de mes (${AUTO_DEUDA_TIMEZONE}).`);
  }

  generarDeudaMensualAutomatica().catch((err) => {
    console.error("[AUTO_DEUDA] Error inicial:", err);
  });

  setInterval(() => {
    generarDeudaMensualAutomatica().catch((err) => {
      console.error("[AUTO_DEUDA] Error en ciclo:", err);
    });
  }, intervalo);
};

// ==========================================
// SERVIR FRONTEND EN PRODUCCIÓN
// ==========================================
const campoAppDir = path.join(__dirname, "../campo-app");
if (fs.existsSync(campoAppDir)) {
  app.use("/campo-app", express.static(campoAppDir));
  app.get("/campo-app", (req, res) => {
    res.sendFile(path.join(campoAppDir, "index.html"));
  });
}

const isApiLikePath = (pathname = "") => {
  const p = String(pathname || "");
  return p === "/health"
    || p === "/login"
    || p.startsWith("/auth/")
    || p === "/luz"
    || p.startsWith("/luz/")
    || isProtectedApiPath(p);
};

app.use((req, res, next) => {
  if (!isApiLikePath(req.path)) return next();
  return res.status(404).json({ error: "Ruta API no encontrada." });
});

app.use(express.static(path.join(__dirname, '../client/dist')));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const SERVER_PORT = Number(process.env.SERVER_PORT || 5000);
const SERVER_HOST = process.env.SERVER_HOST || "0.0.0.0";
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === "1";
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);
const HTTPS_KEY_FILE = String(process.env.HTTPS_KEY_FILE || "").trim();
const HTTPS_CERT_FILE = String(process.env.HTTPS_CERT_FILE || "").trim();
const HTTPS_CA_FILE = String(process.env.HTTPS_CA_FILE || "").trim();
let bootstrapped = false;

const onServerStarted = (label, host, port) => {
  console.log(`${label} corriendo en ${host}:${port}`);
  if (bootstrapped) return;
  bootstrapped = true;
  ensurePerformanceIndexes(pool).catch((err) => {
    console.error("[DB] Error creando índices de rendimiento:", err);
  });
  repararRecibosPendientesSnLegacy().catch((err) => {
    console.error("[MIGRACION_SN] Error iniciando corrección legacy:", err);
  });
  removerArtefactosReniec().catch((err) => {
    console.error("[RENIEC] Error en limpieza inicial:", err);
  });
  iniciarTareaAutoDeuda();
  iniciarTareaAutoCierreCaja();
};

const setupRealtimeWs = (server, serverLabel) => {
  if (!REALTIME_WS_ENABLED) return null;

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws, req) => {
    const entry = realtimeHub.register(ws, {
      ip: getRequestIp(req),
      server: serverLabel
    });
    const authTimeout = setTimeout(() => {
      if (entry.authenticated) return;
      realtimeHub.sendToClient(entry, { type: "error", code: "AUTH_TIMEOUT", message: "Autenticacion requerida." });
      try { ws.close(4401, "AUTH_TIMEOUT"); } catch {}
    }, REALTIME_AUTH_TIMEOUT_MS);

    ws.on("message", async (raw) => {
      const payload = tryParseJson(typeof raw === "string" ? raw : raw?.toString("utf8"));
      if (!payload || typeof payload !== "object") {
        realtimeHub.sendToClient(entry, { type: "error", code: "INVALID_JSON", message: "Mensaje invalido." });
        return;
      }
      if (payload.type === "ping") {
        entry.lastPingAt = Date.now();
        realtimeHub.sendToClient(entry, { type: "pong", server_ts: new Date().toISOString() });
        return;
      }
      if (payload.type !== "auth") return;

      const token = String(payload.token || "").trim();
      const resolved = await resolveRealtimeUser(token);
      if (!resolved.ok) {
        realtimeHub.sendToClient(entry, { type: "error", code: "AUTH_FAILED", message: resolved.error || "No autorizado" });
        try { ws.close(4401, "AUTH_FAILED"); } catch {}
        return;
      }
      clearTimeout(authTimeout);
      entry.authenticated = true;
      entry.user = resolved.user;
      entry.lastPingAt = Date.now();
      realtimeHub.sendToClient(entry, {
        type: "auth_ok",
        user: {
          id_usuario: Number(resolved.user?.id_usuario || 0),
          rol: String(resolved.user?.rol || "CONSULTA")
        },
        server_ts: new Date().toISOString()
      });
      console.log(`[RT] auth ok user=${entry.user?.username || "unknown"} clients=${realtimeHub.connectedClients.size}`);
    });

    ws.on("close", () => {
      clearTimeout(authTimeout);
      realtimeHub.unregister(entry);
    });
    ws.on("error", () => {
      clearTimeout(authTimeout);
      realtimeHub.unregister(entry);
    });
  });

  server.on("upgrade", (req, socket, head) => {
    try {
      const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (parsed.pathname !== "/ws") {
        try { socket.destroy(); } catch {}
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } catch {
      try { socket.destroy(); } catch {}
    }
  });

  setInterval(() => {
    const now = Date.now();
    for (const entry of realtimeHub.connectedClients) {
      if (!entry.authenticated) continue;
      if (now - entry.lastPingAt <= REALTIME_PING_TIMEOUT_MS) continue;
      try { entry.ws.close(4000, "PING_TIMEOUT"); } catch {}
      realtimeHub.unregister(entry);
    }
  }, 10000);

  console.log(`[RT] WebSocket habilitado en ${serverLabel} (/ws)`);
  return wss;
};

const httpServer = http.createServer(app);
setupRealtimeWs(httpServer, "HTTP");
httpServer.listen(SERVER_PORT, SERVER_HOST, () => {
  onServerStarted("Servidor HTTP", SERVER_HOST, SERVER_PORT);
});

if (HTTPS_ENABLED) {
  try {
    if (!HTTPS_KEY_FILE || !HTTPS_CERT_FILE) {
      throw new Error("HTTPS_KEY_FILE y HTTPS_CERT_FILE son obligatorios cuando HTTPS_ENABLED=1.");
    }
    const httpsOptions = {
      key: fs.readFileSync(HTTPS_KEY_FILE),
      cert: fs.readFileSync(HTTPS_CERT_FILE)
    };
    if (HTTPS_CA_FILE) {
      httpsOptions.ca = fs.readFileSync(HTTPS_CA_FILE);
    }
    const httpsServer = https.createServer(httpsOptions, app);
    setupRealtimeWs(httpsServer, "HTTPS");
    httpsServer.listen(HTTPS_PORT, SERVER_HOST, () => {
      onServerStarted("Servidor HTTPS", SERVER_HOST, HTTPS_PORT);
    });
  } catch (err) {
    console.error("[HTTPS] No se pudo iniciar servidor HTTPS:", err.message);
  }
}
