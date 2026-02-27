const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const express = require("express");
const app = express();
const cors = require("cors");
const pool = require("./db");
const { importarDeudas } = require("./importar_deudas");
const ExcelJS = require('exceljs');
const xml2js = require('xml2js');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() }); 
require("dotenv").config();
const { Readable } = require('stream');
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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

const toISODate = (date = new Date()) => date.toISOString().split('T')[0];
const getCurrentYear = () => new Date().getFullYear();
const parseMonto = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const MAX_RECHAZOS_IMPORTACION = Number(process.env.MAX_RECHAZOS_IMPORTACION || 500);
const AUTO_DEUDA_TIMEZONE = process.env.AUTO_DEUDA_TIMEZONE || "America/Lima";
const AUTO_DEUDA_CHECK_MS = Number(process.env.AUTO_DEUDA_CHECK_MS || (60 * 60 * 1000));
const AUTO_DEUDA_ACTIVA = process.env.AUTO_DEUDA_ACTIVA !== "0";
const AUTO_DEUDA_BASE = {
  agua: parseMonto(process.env.AUTO_DEUDA_AGUA, 7.5),
  desague: parseMonto(process.env.AUTO_DEUDA_DESAGUE, 3.5),
  limpieza: parseMonto(process.env.AUTO_DEUDA_LIMPIEZA, 3.5),
  admin: parseMonto(process.env.AUTO_DEUDA_ADMIN, 0.5)
};
const AUDIT_REDACT_KEYS = new Set(["password", "token", "archivo"]);
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
const ESTADOS_ORDEN_COBRO = {
  PENDIENTE: "PENDIENTE",
  COBRADA: "COBRADA",
  ANULADA: "ANULADA"
};
const FUENTE_SOLICITUD_CAMPO = "APP_CAMPO";
const LOGIN_RATE_LIMIT_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || (10 * 60 * 1000));
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 25);
const LOGIN_LOCK_THRESHOLD = Number(process.env.LOGIN_LOCK_THRESHOLD || 5);
const LOGIN_LOCK_DURATION_MS = Number(process.env.LOGIN_LOCK_DURATION_MS || (15 * 60 * 1000));
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

const normalizeSN = (value, fallback = "N") => {
  const raw = String(value || "").trim().toUpperCase();
  if (["S", "1", "SI", "TRUE", "Y", "YES"].includes(raw)) return "S";
  if (["N", "0", "NO", "FALSE"].includes(raw)) return "N";
  return fallback;
};

const normalizeDateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  const asDate = new Date(text);
  if (!Number.isNaN(asDate.getTime())) return asDate.toISOString().slice(0, 10);
  const m = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  let yyyy = Number(m[3]);
  if (yyyy < 100) yyyy += 2000;
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
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
const roundMonto2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const parsePositiveMonto = (value) => {
  const parsed = roundMonto2(parseMonto(value, 0));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
};
const clampArray = (rows, max = 200) => {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, Math.max(1, Math.min(1000, max)));
};

const normalizeCodigoMunicipal = (value, padTo = 6) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const onlyDigits = raw.replace(/\D/g, "");
  if (onlyDigits) return onlyDigits.slice(0, 8).padStart(padTo, "0");
  return raw.toUpperCase().slice(0, 32);
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
const JWT_SECRET = process.env.JWT_SECRET || "cambia_esto_en_produccion";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";
const AUTH_OPTIONAL_DEV = process.env.AUTH_OPTIONAL_DEV === "1";

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
  ADMIN_SEC: "Nivel 2 - Admin secundario / caja",
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

const issueToken = (user) => jwt.sign(
  {
    id_usuario: user.id_usuario,
    username: user.username,
    rol: normalizeRole(user.rol),
    nombre: user.nombre_completo
  },
  JWT_SECRET,
  { expiresIn: JWT_EXPIRES_IN }
);

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
        estado: "ACTIVO"
      };
      return next();
    }
    return res.status(401).json({ error: "No autorizado" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await pool.query(
      "SELECT id_usuario, username, nombre_completo, rol, estado FROM usuarios_sistema WHERE id_usuario = $1",
      [payload.id_usuario]
    );
    if (user.rows.length === 0) {
      return res.status(401).json({ error: "Usuario no válido" });
    }
    const dbUser = user.rows[0];
    if (dbUser.estado !== "ACTIVO") {
      return res.status(403).json({ error: "Usuario no activo" });
    }
    req.user = {
      id_usuario: dbUser.id_usuario,
      username: dbUser.username,
      nombre: dbUser.nombre_completo,
      rol: normalizeRole(dbUser.rol),
      estado: dbUser.estado
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
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
  "/importar"
];

const ACCESS_RULES = [
  { methods: ["GET"], pattern: /^\/campo\/contribuyentes\/buscar$/, minRole: "BRIGADA" },
  { methods: ["GET"], pattern: /^\/campo\/offline-snapshot$/, minRole: "BRIGADA" },
  { methods: ["POST"], pattern: /^\/campo\/solicitudes$/, minRole: "BRIGADA" },
  { methods: ["GET"], pattern: /^\/campo\/solicitudes$/, minRole: "ADMIN_SEC" },
  { methods: ["POST"], pattern: /^\/campo\/solicitudes\/\d+\/aprobar$/, minRole: "ADMIN_SEC" },
  { methods: ["POST"], pattern: /^\/campo\/solicitudes\/\d+\/rechazar$/, minRole: "ADMIN_SEC" },

  { methods: ["GET"], pattern: /^\/admin\/usuarios$/, minRole: "ADMIN" },
  { methods: ["PUT"], pattern: /^\/admin\/usuarios\/\d+$/, minRole: "ADMIN" },
  { methods: ["DELETE"], pattern: /^\/admin\/usuarios\/\d+$/, minRole: "ADMIN" },
  { methods: ["GET"], pattern: /^\/admin\/backup$/, minRole: "ADMIN" },

  { methods: ["POST"], pattern: /^\/importar\/padron$/, minRole: "ADMIN" },
  { methods: ["POST"], pattern: /^\/importar\/historial$/, minRole: "ADMIN" },
  { methods: ["POST"], pattern: /^\/importar\/verificacion-campo$/, minRole: "ADMIN_SEC" },

  { methods: ["GET"], pattern: /^\/exportar\/usuarios-completo$/, minRole: "ADMIN" },
  { methods: ["GET"], pattern: /^\/exportar\/finanzas-completo$/, minRole: "ADMIN" },

  { methods: ["GET"], pattern: /^\/auditoria$/, minRole: "ADMIN_SEC" },
  { methods: ["GET"], pattern: /^\/exportar\/auditoria$/, minRole: "ADMIN_SEC" },
  { methods: ["GET"], pattern: /^\/exportar\/padron$/, minRole: "ADMIN_SEC" },
  { methods: ["GET"], pattern: /^\/exportar\/verificacion-campo$/, minRole: "ADMIN_SEC" },

  { methods: ["POST", "PUT"], pattern: /^\/calles(\/|$)/, minRole: "ADMIN_SEC" },
  { methods: ["DELETE"], pattern: /^\/calles(\/|$)/, minRole: "ADMIN" },
  { methods: ["POST", "PUT"], pattern: /^\/contribuyentes(\/|$)/, minRole: "ADMIN_SEC" },
  { methods: ["DELETE"], pattern: /^\/contribuyentes\/\d+$/, minRole: "ADMIN" },
  { methods: ["POST"], pattern: /^\/recibos$/, minRole: "ADMIN_SEC" },
  { methods: ["POST"], pattern: /^\/recibos\/generar-masivo$/, minRole: "ADMIN_SEC" },
  { methods: ["DELETE"], pattern: /^\/recibos\/\d+$/, minRole: "ADMIN" },
  { methods: ["POST"], pattern: /^\/actas-corte\/generar$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/caja\/ordenes-cobro$/, minRole: "ADMIN_SEC" },
  { methods: ["GET"], pattern: /^\/caja\/ordenes-cobro\/pendientes$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/caja\/ordenes-cobro\/\d+\/cobrar$/, minRole: "CAJERO" },
  { methods: ["POST"], pattern: /^\/caja\/ordenes-cobro\/\d+\/anular$/, minRole: "ADMIN_SEC" },
  { methods: ["GET"], pattern: /^\/caja\/reporte\/excel$/, minRole: "ADMIN_SEC" },

  { methods: ["POST"], pattern: /^\/pagos$/, minRole: "CAJERO" },
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
      total_orden NUMERIC(12, 2) NOT NULL DEFAULT 0,
      recibos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      observacion TEXT NULL,
      motivo_anulacion TEXT NULL,
      cobrado_en TIMESTAMP NULL,
      anulado_en TIMESTAMP NULL
    )
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
    CREATE INDEX IF NOT EXISTS idx_ordenes_cobro_estado_creado
    ON ordenes_cobro (estado, creado_en DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ordenes_cobro_contribuyente_estado
    ON ordenes_cobro (id_contribuyente, estado, creado_en DESC)
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
          AND UPPER(COALESCE(p.activo_sn, 'S')) = 'S'
      ) THEN 'CON_CONEXION'
      ELSE 'SIN_CONEXION'
    END
    WHERE c.estado_conexion IS NULL
       OR UPPER(COALESCE(TRIM(c.estado_conexion), '')) NOT IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO')
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_contribuyentes_estado_conexion'
      ) THEN
        ALTER TABLE contribuyentes
        ADD CONSTRAINT chk_contribuyentes_estado_conexion
        CHECK (estado_conexion IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO'));
      END IF;
    END $$;
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
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_campo_solicitudes_estado_actual'
      ) THEN
        ALTER TABLE campo_solicitudes
        ADD CONSTRAINT chk_campo_solicitudes_estado_actual
        CHECK (estado_conexion_actual IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO'));
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_campo_solicitudes_estado_nuevo'
      ) THEN
        ALTER TABLE campo_solicitudes
        ADD CONSTRAINT chk_campo_solicitudes_estado_nuevo
        CHECK (estado_conexion_nuevo IN ('CON_CONEXION', 'SIN_CONEXION', 'CORTADO'));
      END IF;
    END $$;
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
};

const ensurePerformanceIndexes = async (client) => {
  await ensureCodigosImpresionTable(client);
  await ensureOrdenesCobroTable(client);
  await ensureEstadoConexionContribuyentes(client);
  await ensureEstadoConexionEventosTable(client);
  await ensureCampoSolicitudesTable(client);
  await ensureDataIntegrityGuards(client);
  const statements = [
    "CREATE INDEX IF NOT EXISTS idx_pagos_fecha_pago ON pagos (fecha_pago DESC)",
    "CREATE INDEX IF NOT EXISTS idx_pagos_id_recibo ON pagos (id_recibo)",
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
app.use(express.json());

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

app.use((req, res, next) => {
  if ((req.method || "").toUpperCase() === "OPTIONS") return next();
  if (!isProtectedApiPath(req.path)) return next();
  return authenticateToken(req, res, () => authorizeByRole(req, res, next));
});

app.use((err, req, res, next) => {
  if (err && String(err.message || "").includes("CORS")) {
    return res.status(403).json({ error: "Origen no permitido por politica CORS." });
  }
  return next(err);
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
  const excluded = req.path.startsWith("/auditoria");
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
app.get("/campo/contribuyentes/buscar", async (req, res) => {
  try {
    const q = normalizeLimitedText(req.query?.q, 120);
    const idCalle = parsePositiveInt(req.query?.id_calle, 0);
    const hasTextFilter = q.length >= 2;
    if (!hasTextFilter && !idCalle) return res.json([]);

    const anioActual = getCurrentYear();
    const mesActual = new Date().getMonth() + 1;
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
              ELSE 4
            END,
            b.nombre_completo ASC
          `
          : "b.nombre_calle ASC NULLS LAST, b.nombre_completo ASC"
      );

    params.push(limit);
    const idxLimit = params.length;

    const rows = await pool.query(`
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
          COALESCE(TRIM(ca.nombre), '') AS nombre_calle,
          ${buildDireccionSql("ca", "p")} AS direccion_completa,
          COALESCE(rp.meses_deuda_total, 0) AS meses_deuda,
          COALESCE(rp.deuda_total, 0) AS deuda_total
        FROM contribuyentes c
        LEFT JOIN LATERAL (
          SELECT id_predio, id_calle, numero_casa, referencia_direccion, agua_sn, desague_sn, limpieza_sn
          FROM predios
          WHERE id_contribuyente = c.id_contribuyente
          ORDER BY id_predio ASC
          LIMIT 1
        ) p ON TRUE
        LEFT JOIN calles ca ON ca.id_calle = p.id_calle
        LEFT JOIN resumen_predio rp ON rp.id_predio = p.id_predio
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
        b.meses_deuda,
        b.deuda_total
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
    const mesActual = new Date().getMonth() + 1;
    const limit = Math.min(10000, Math.max(200, parsePositiveInt(req.query?.limit, 5000)));

    const contribuyentes = await pool.query(`
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
          COALESCE(TRIM(ca.nombre), '') AS nombre_calle,
          ${buildDireccionSql("ca", "p")} AS direccion_completa,
          COALESCE(rp.meses_deuda_total, 0) AS meses_deuda,
          COALESCE(rp.deuda_total, 0) AS deuda_total
        FROM contribuyentes c
        LEFT JOIN LATERAL (
          SELECT id_predio, id_calle, numero_casa, referencia_direccion, agua_sn, desague_sn, limpieza_sn
          FROM predios
          WHERE id_contribuyente = c.id_contribuyente
          ORDER BY id_predio ASC
          LIMIT 1
        ) p ON TRUE
        LEFT JOIN calles ca ON ca.id_calle = p.id_calle
        LEFT JOIN resumen_predio rp ON rp.id_predio = p.id_predio
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
        b.meses_deuda,
        b.deuda_total
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
    const idContribuyente = parsePositiveInt(req.body?.id_contribuyente, 0);
    if (!idContribuyente) {
      return res.status(400).json({ error: "ID de contribuyente inválido." });
    }
    const anioActual = getCurrentYear();
    const mesActual = new Date().getMonth() + 1;

    const actual = await pool.query(`
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
        COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_sn,
        p.referencia_direccion,
        ${buildDireccionSql("ca", "p")} AS direccion_completa,
        COALESCE(rp.meses_deuda_total, 0) AS meses_deuda,
        COALESCE(rp.deuda_total, 0) AS deuda_total
      FROM contribuyentes c
      LEFT JOIN LATERAL (
        SELECT id_predio, id_calle, numero_casa, referencia_direccion, agua_sn, desague_sn, limpieza_sn
        FROM predios
        WHERE id_contribuyente = c.id_contribuyente
        ORDER BY id_predio ASC
        LIMIT 1
      ) p ON TRUE
      LEFT JOIN calles ca ON ca.id_calle = p.id_calle
      LEFT JOIN resumen_predio rp ON rp.id_predio = p.id_predio
      WHERE c.id_contribuyente = $3
      LIMIT 1
    `, [anioActual, mesActual, idContribuyente]);

    if (actual.rows.length === 0) {
      return res.status(404).json({ error: "Contribuyente no encontrado." });
    }

    const row = actual.rows[0];
    const estadoActual = normalizeEstadoConexion(row.estado_conexion);
    const visitadoSN = normalizeSN(req.body?.visitado_sn, "N");
    const cortadoSN = normalizeSN(req.body?.cortado_sn, "N");
    const estadoSolicitado = normalizeEstadoConexion(req.body?.estado_conexion_nuevo || estadoActual);
    const estadoNuevo = cortadoSN === "S" ? ESTADOS_CONEXION.CORTADO : estadoSolicitado;
    const fechaCorte = normalizeDateOnly(req.body?.fecha_corte) || null;
    const fechaCorteFinal = cortadoSN === "S" ? (fechaCorte || toISODate()) : fechaCorte;
    const inspector = normalizeLimitedText(req.body?.inspector, 120) || null;
    const motivoObs = normalizeLimitedText(req.body?.motivo_obs, 1200) || null;
    const nombreVerificado = normalizeLimitedText(req.body?.nombre_verificado, 200) || null;
    const dniVerificado = normalizeLimitedText(req.body?.dni_verificado, 30) || null;
    const telefonoVerificado = normalizeLimitedText(req.body?.telefono_verificado, 40) || null;
    const direccionVerificada = normalizeLimitedText(req.body?.direccion_verificada, 250) || null;
    const observacionCampo = normalizeLimitedText(req.body?.observacion_campo || motivoObs, 1200) || null;
    const aguaActual = normalizeSN(row.agua_sn, "S");
    const desagueActual = normalizeSN(row.desague_sn, "S");
    const limpiezaActual = normalizeSN(row.limpieza_sn, "S");
    const aguaNuevo = normalizeSN(req.body?.agua_sn, aguaActual);
    const desagueNuevo = normalizeSN(req.body?.desague_sn, desagueActual);
    const limpiezaNuevo = normalizeSN(req.body?.limpieza_sn, limpiezaActual);
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

    const metadataInput = req.body?.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata)
      ? req.body.metadata
      : {};
    const metadata = {
      ...metadataInput,
      formato: "REPORTE_CORTES",
      visitado_sn: visitadoSN,
      cortado_sn: cortadoSN,
      fecha_corte: fechaCorteFinal,
      motivo_obs: motivoObs,
      inspector: inspector || normalizeLimitedText(req.user?.nombre || req.user?.username || "", 120),
      meses_deuda: Number(row.meses_deuda || 0),
      deuda_total: Number(parseFloat(row.deuda_total || 0) || 0),
      estado_actual: estadoActual,
      estado_nuevo: estadoNuevo,
      servicio_agua_actual: aguaActual,
      servicio_agua_nuevo: aguaNuevo,
      servicio_desague_actual: desagueActual,
      servicio_desague_nuevo: desagueNuevo,
      servicio_limpieza_actual: limpiezaActual,
      servicio_limpieza_nuevo: limpiezaNuevo,
      idempotency_key: idempotencyKey
    };

    const equalsText = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();
    const nombreActual = normalizeLimitedText(row.nombre_completo, 200);
    const dniActual = normalizeLimitedText(row.dni_ruc, 30);
    const telefonoActual = normalizeLimitedText(row.telefono, 40);
    const direccionActual = normalizeLimitedText(row.direccion_completa || row.referencia_direccion, 250);

    const hayCambio = (
      estadoNuevo !== estadoActual ||
      visitadoSN === "S" ||
      cortadoSN === "S" ||
      Boolean(fechaCorteFinal) ||
      Boolean(inspector) ||
      Boolean(motivoObs) ||
      aguaNuevo !== aguaActual ||
      desagueNuevo !== desagueActual ||
      limpiezaNuevo !== limpiezaActual ||
      (nombreVerificado && !equalsText(nombreVerificado, nombreActual)) ||
      (dniVerificado && !equalsText(dniVerificado, dniActual)) ||
      (telefonoVerificado && !equalsText(telefonoVerificado, telefonoActual)) ||
      (direccionVerificada && !equalsText(direccionVerificada, direccionActual))
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
        $9, $10, $11, $12, $13, $14, $15
      )
      RETURNING id_solicitud, creado_en
    `, [
      idContribuyente,
      row.codigo_municipal || null,
      ESTADOS_SOLICITUD_CAMPO.PENDIENTE,
      req.user?.id_usuario || null,
      normalizeLimitedText(req.user?.nombre || req.user?.username || "", 160) || null,
      FUENTE_SOLICITUD_CAMPO,
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
      `ID ${created.rows[0].id_solicitud} | Contribuyente ${row.codigo_municipal || idContribuyente} ${row.nombre_completo || ""}`,
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
    const estadoFiltro = Object.prototype.hasOwnProperty.call(ESTADOS_SOLICITUD_CAMPO, estadoRaw) ? estadoRaw : null;
    const limit = Math.min(500, Math.max(10, parsePositiveInt(req.query?.limit, 200)));

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
        ${buildDireccionSql("ca", "p")} AS direccion_actual_db
      FROM campo_solicitudes s
      LEFT JOIN contribuyentes c ON c.id_contribuyente = s.id_contribuyente
      LEFT JOIN LATERAL (
        SELECT id_predio, id_calle, numero_casa, referencia_direccion, agua_sn, desague_sn, limpieza_sn
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

app.post("/campo/solicitudes/:id/aprobar", async (req, res) => {
  const client = await pool.connect();
  try {
    const idSolicitud = parsePositiveInt(req.params?.id, 0);
    if (!idSolicitud) {
      return res.status(400).json({ error: "ID de solicitud inválido." });
    }

    const motivoRevision = normalizeLimitedText(req.body?.motivo_revision, 500) || null;

    await client.query("BEGIN");
    await ensureEstadoConexionEventosTable(client);

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

    const contribuyenteData = await client.query(`
      SELECT
        c.id_contribuyente,
        c.codigo_municipal,
        c.nombre_completo,
        c.dni_ruc,
        c.telefono,
        COALESCE(NULLIF(UPPER(TRIM(c.estado_conexion)), ''), 'CON_CONEXION') AS estado_conexion,
        COALESCE(NULLIF(UPPER(TRIM(p.agua_sn)), ''), 'S') AS agua_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.desague_sn)), ''), 'S') AS desague_sn,
        COALESCE(NULLIF(UPPER(TRIM(p.limpieza_sn)), ''), 'S') AS limpieza_sn
      FROM contribuyentes c
      LEFT JOIN LATERAL (
        SELECT agua_sn, desague_sn, limpieza_sn
        FROM predios
        WHERE id_contribuyente = c.id_contribuyente
        ORDER BY id_predio ASC
        LIMIT 1
      ) p ON TRUE
      WHERE c.id_contribuyente = $1
      FOR UPDATE
    `, [solicitud.id_contribuyente]);
    if (contribuyenteData.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contribuyente no encontrado para aplicar solicitud." });
    }

    const actual = contribuyenteData.rows[0];
    const estadoActual = normalizeEstadoConexion(actual.estado_conexion);
    const estadoDestino = normalizeEstadoConexion(solicitud.estado_conexion_nuevo || estadoActual);
    const metadataSolicitud = solicitud.metadata && typeof solicitud.metadata === "object" ? solicitud.metadata : {};
    const aguaDestino = normalizeSN(metadataSolicitud.servicio_agua_nuevo, normalizeSN(actual.agua_sn, "S"));
    const desagueDestino = normalizeSN(metadataSolicitud.servicio_desague_nuevo, normalizeSN(actual.desague_sn, "S"));
    const limpiezaDestino = normalizeSN(metadataSolicitud.servicio_limpieza_nuevo, normalizeSN(actual.limpieza_sn, "S"));
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

    await client.query(
      `UPDATE predios
       SET activo_sn = $1,
           estado_servicio = $2,
           referencia_direccion = COALESCE(NULLIF($3, ''), referencia_direccion),
           agua_sn = $4,
           desague_sn = $5,
           limpieza_sn = $6
       WHERE id_contribuyente = $7`,
      [
        predioEstado.activo_sn,
        predioEstado.estado_servicio,
        normalizeLimitedText(solicitud.direccion_verificada, 250),
        aguaDestino,
        desagueDestino,
        limpiezaDestino,
        actual.id_contribuyente
      ]
    );

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

    await client.query(
      `UPDATE campo_solicitudes
       SET estado_solicitud = $1,
           motivo_revision = $2,
           id_usuario_revision = $3,
           revisado_en = NOW(),
           actualizado_en = NOW()
       WHERE id_solicitud = $4`,
      [
        ESTADOS_SOLICITUD_CAMPO.APROBADO,
        motivoRevision,
        req.user?.id_usuario || null,
        idSolicitud
      ]
    );

    await registrarAuditoria(
      client,
      "CAMPO_SOLICITUD_APROBADA",
      `Solicitud ${idSolicitud} aplicada a contribuyente ${actual.codigo_municipal || actual.id_contribuyente}. Estado: ${estadoActual} -> ${estadoDestino}`,
      req.user?.nombre || req.user?.username || "SISTEMA"
    );

    await client.query("COMMIT");
    invalidateContribuyentesCache();

    return res.json({
      mensaje: "Solicitud aprobada y aplicada.",
      id_solicitud: idSolicitud,
      id_contribuyente: actual.id_contribuyente,
      estado_anterior: estadoActual,
      estado_nuevo: estadoDestino
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
app.get("/contribuyentes", async (req, res) => {
  try {
    const now = Date.now();
    if (contribuyentesCache.data && now < contribuyentesCache.expiresAt) {
      res.set("Cache-Control", "private, max-age=10");
      return res.json(contribuyentesCache.data);
    }

    const anioActual = getCurrentYear();
    const mesActual = new Date().getMonth() + 1;

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
      resumen_predio AS (
        SELECT
          ro.id_predio,
          SUM(GREATEST(ro.total_pagar - COALESCE(pp.total_pagado, 0), 0)) AS deuda_total,
          SUM(COALESCE(pp.total_pagado, 0)) AS abono_total,
          COUNT(*) FILTER (WHERE (ro.total_pagar - COALESCE(pp.total_pagado, 0)) > 0) AS meses_deuda_total
        FROM recibos_objetivo ro
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = ro.id_recibo
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
             
             COALESCE(rp.deuda_total, 0) as deuda_anio,
             COALESCE(rp.abono_total, 0) as abono_anio,
             COALESCE(rp.meses_deuda_total, 0) as meses_deuda
      FROM contribuyentes c
      LEFT JOIN predios p ON c.id_contribuyente = p.id_contribuyente
      LEFT JOIN calles ca ON p.id_calle = ca.id_calle
      LEFT JOIN resumen_predio rp ON rp.id_predio = p.id_predio
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
      SELECT c.*, p.id_calle, p.numero_casa, p.manzana, p.lote, p.referencia_direccion 
      FROM contribuyentes c
      LEFT JOIN predios p ON c.id_contribuyente = p.id_contribuyente
      WHERE c.id_contribuyente = $1
    `, [id]);
    res.json(data.rows[0]);
  } catch (err) { res.status(500).send("Error"); }
});

// CREAR CONTRIBUYENTE (CÓDIGO NUMÉRICO AUTOGENERADO)
app.post("/contribuyentes", async (req, res) => {
  try {
    const {
      dni_ruc, nombre_completo, telefono, id_calle, numero_casa, manzana, lote, sec_nombre, estado_conexion
    } = req.body;
    const estadoConexion = normalizeEstadoConexion(estado_conexion);
    const predioEstado = estadoConexionToPredio(estadoConexion);

    if (!nombre_completo || !dni_ruc || !id_calle) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    let codigoMunicipal = null;
    for (let intento = 0; intento < 10; intento++) {
      const candidato = String(Date.now() + intento).slice(-8);
      const exMunicipal = await pool.query(
        "SELECT 1 FROM contribuyentes WHERE codigo_municipal = $1 LIMIT 1",
        [candidato]
      );
      if (exMunicipal.rows.length === 0) {
        codigoMunicipal = candidato;
        break;
      }
    }
    if (!codigoMunicipal) {
      return res.status(500).json({ error: "No se pudo generar el código municipal." });
    }

    const nuevo = await pool.query(
      `INSERT INTO contribuyentes (
        codigo_municipal, sec_cod, sec_nombre, dni_ruc, nombre_completo, telefono,
        estado_conexion, estado_conexion_fuente, estado_conexion_verificado_sn, estado_conexion_fecha_verificacion
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'OFICINA', 'N', NULL) RETURNING id_contribuyente`,
      [codigoMunicipal, null, sec_nombre ? String(sec_nombre).trim() : null, dni_ruc, nombre_completo, telefono, estadoConexion]
    );
    const id = nuevo.rows[0].id_contribuyente;

    await pool.query(
      "INSERT INTO predios (id_contribuyente, id_calle, numero_casa, manzana, lote, id_tarifa, estado_servicio, activo_sn) VALUES ($1, $2, $3, $4, $5, 1, $6, $7)",
      [id, id_calle, numero_casa, manzana, lote, predioEstado.estado_servicio, predioEstado.activo_sn]
    );

    invalidateContribuyentesCache();
    res.json({ mensaje: "Registrado", codigo: codigoMunicipal });

  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: "El código municipal ya existe." });
    res.status(500).json({ error: "Error servidor" });
  }
});

app.put("/contribuyentes/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      nombre_completo, codigo_municipal, sec_cod, sec_nombre,
      dni_ruc, email, telefono, id_calle, numero_casa, manzana, lote, estado_conexion
    } = req.body;
    const codigoMunicipal = normalizeCodigoMunicipal(codigo_municipal);
    const codigoSistema = sec_cod ? String(sec_cod).trim() : null;
    const estadoConexion = normalizeEstadoConexion(estado_conexion);
    const predioEstado = estadoConexionToPredio(estadoConexion);

    if (!codigoMunicipal) {
      return res.status(400).json({ error: "Código municipal inválido." });
    }

    const exMunicipal = await client.query(
      "SELECT 1 FROM contribuyentes WHERE codigo_municipal = $1 AND id_contribuyente <> $2 LIMIT 1",
      [codigoMunicipal, id]
    );
    if (exMunicipal.rows.length > 0) {
      return res.status(400).json({ error: "El código municipal ya pertenece a otro contribuyente." });
    }

    if (codigoSistema) {
      const exSistema = await client.query(
        "SELECT 1 FROM contribuyentes WHERE sec_cod = $1 AND id_contribuyente <> $2 LIMIT 1",
        [codigoSistema, id]
      );
      if (exSistema.rows.length > 0) {
        return res.status(400).json({ error: "El código de sistema ya pertenece a otro contribuyente." });
      }
    }
    
    await client.query('BEGIN');
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
           estado_conexion_fecha_verificacion = NULL
       WHERE id_contribuyente = $9`,
      [nombre_completo, codigoMunicipal, codigoSistema, sec_nombre || null, dni_ruc, email, telefono, estadoConexion, id]
    );
    await client.query(
      "UPDATE predios SET id_calle = $1, numero_casa = $2, manzana = $3, lote = $4, activo_sn = $5, estado_servicio = $6 WHERE id_contribuyente = $7",
      [id_calle, numero_casa, manzana, lote, predioEstado.activo_sn, predioEstado.estado_servicio, id]
    );
    await client.query('COMMIT');
    invalidateContribuyentesCache();
    res.json({ mensaje: "Datos actualizados correctamente" });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(400).json({ error: "Código municipal o código de sistema ya existen." });
    }
    res.status(500).send("Error al actualizar");
  } finally { client.release(); }
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
      id_evento: Number(evento.rows[0].id_evento)
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error actualizando estado de conexión:", err);
    return res.status(500).json({ error: "Error actualizando estado de conexión." });
  } finally {
    client.release();
  }
});

app.delete("/contribuyentes/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    await client.query(`DELETE FROM pagos WHERE id_recibo IN (SELECT id_recibo FROM recibos WHERE id_predio IN (SELECT id_predio FROM predios WHERE id_contribuyente = $1))`, [id]);
    await client.query(`DELETE FROM recibos WHERE id_predio IN (SELECT id_predio FROM predios WHERE id_contribuyente = $1)`, [id]);
    await client.query("DELETE FROM predios WHERE id_contribuyente = $1", [id]);
    await client.query("DELETE FROM contribuyentes WHERE id_contribuyente = $1", [id]);
    await client.query('COMMIT');
    invalidateContribuyentesCache();
    res.json({ mensaje: "Usuario eliminado permanentemente." });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).send("Error al eliminar usuario.");
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

app.post("/recibos", async (req, res) => {
  try {
    const { id_contribuyente, anio, mes, montos } = req.body;
    const predio = await pool.query(`
      SELECT
        p.id_predio,
        p.id_tarifa,
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
    
    // Aquí podrías consultar la tabla 'tarifas' si la usas, por defecto usamos valores fijos o del body
    // Para simplificar uso valores fijos pero puedes ajustarlos
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

    const nuevoRecibo = await pool.query(
      `INSERT INTO recibos (id_predio, anio, mes, subtotal_agua, subtotal_desague, subtotal_limpieza, subtotal_admin, total_pagar, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDIENTE') RETURNING *`,
      [predio.rows[0].id_predio, anio, mes, subtotalAgua, subtotalDesague, subtotalLimpieza, subtotalAdmin, totalPagar]
    );
    invalidateContribuyentesCache();
    res.json(nuevoRecibo.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: "Ya existe recibo para ese mes." });
    res.status(500).send("Error");
  }
});

app.post("/recibos/generar-masivo", async (req, res) => {
  try {
    const { tipo_seleccion = "todos", ids_usuarios = [], id_calle, anio, mes, montos } = req.body;
    if (!anio || !mes) return res.status(400).json({ error: "Año y mes son requeridos." });

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
      SELECT p.id_predio, $1, $2, $3, $4, $5, $6, $7, 'PENDIENTE'
      FROM predios p
      JOIN contribuyentes c ON c.id_contribuyente = p.id_contribuyente
    `;
    const params = [anio, mes, subtotalAgua, subtotalDesague, subtotalLimpieza, subtotalAdmin, totalPagar];
    const whereParts = [
      "UPPER(COALESCE(p.activo_sn, 'S')) = 'S'",
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
    }
    res.json({ mensaje: `Recibos generados: ${resultado.rowCount}` });
  } catch (err) {
    res.status(500).send("Error al generar deuda masiva");
  }
});

app.get("/recibos/pendientes/:id_contribuyente", async (req, res) => {
  try {
    const { id_contribuyente } = req.params;
    const anioActual = getCurrentYear();
    const mesActual = new Date().getMonth() + 1;
    const pendientes = await pool.query(`
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
        GROUP BY id_recibo
      ) p ON p.id_recibo = r.id_recibo
      WHERE r.id_predio IN (SELECT id_predio FROM predios WHERE id_contribuyente = $1)
      AND (r.total_pagar - COALESCE(p.total_pagado, 0)) > 0
      AND ((r.anio < $2) OR (r.anio = $2 AND r.mes <= $3))
      ORDER BY r.anio, r.mes
    `, [id_contribuyente, anioActual, mesActual]);
    res.json(pendientes.rows);
  } catch (err) { res.status(500).send("Error"); }
});

app.post("/caja/ordenes-cobro", async (req, res) => {
  const client = await pool.connect();
  try {
    const idContribuyente = parsePositiveInt(req.body?.id_contribuyente, 0);
    const observacion = normalizeLimitedText(req.body?.observacion, 500) || null;
    const items = sanitizeOrdenCobroItems(req.body?.items);
    if (!idContribuyente) {
      return res.status(400).json({ error: "Contribuyente invalido." });
    }
    if (items.length === 0) {
      return res.status(400).json({ error: "Debe incluir al menos un recibo con monto autorizado." });
    }

    await client.query("BEGIN");
    await ensureOrdenesCobroTable(client);

    const contrib = await client.query(`
      SELECT id_contribuyente, codigo_municipal
      FROM contribuyentes
      WHERE id_contribuyente = $1
      LIMIT 1
    `, [idContribuyente]);
    if (contrib.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contribuyente no encontrado." });
    }

    const idsRecibos = items.map((r) => r.id_recibo);
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
        id_usuario_emite,
        id_contribuyente,
        codigo_municipal,
        total_orden,
        recibos_json,
        observacion
      )
      VALUES ('PENDIENTE', $1, $2, $3, $4, $5::jsonb, $6)
      RETURNING id_orden, creado_en, estado, total_orden, codigo_municipal
    `, [
      req.user?.id_usuario || null,
      idContribuyente,
      contrib.rows[0].codigo_municipal || null,
      totalOrden,
      JSON.stringify(detalleOrden),
      observacion
    ]);

    const orden = insertOrden.rows[0];
    const usuarioAuditoria = req.user?.username || req.user?.nombre || "SISTEMA";
    const ip = getRequestIp(req);
    await registrarAuditoria(
      client,
      "ORDEN_COBRO_EMITIDA",
      `orden=${orden.id_orden}; contribuyente=${idContribuyente}; total=${totalOrden.toFixed(2)}; recibos=${detalleOrden.length}; ip=${ip}`,
      usuarioAuditoria
    );

    await client.query("COMMIT");
    res.json({
      mensaje: "Orden de cobro emitida.",
      orden: {
        id_orden: Number(orden.id_orden),
        creado_en: orden.creado_en,
        estado: orden.estado,
        total_orden: parseMonto(orden.total_orden, 0),
        id_contribuyente: idContribuyente,
        codigo_municipal: orden.codigo_municipal || null,
        observacion,
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

    const resultado = await pool.query(`
      SELECT
        oc.id_orden,
        oc.creado_en,
        oc.actualizado_en,
        oc.estado,
        oc.id_contribuyente,
        oc.codigo_municipal,
        oc.total_orden,
        oc.observacion,
        oc.recibos_json,
        oc.id_usuario_emite,
        COALESCE(ue.username, '') AS usuario_emite,
        COALESCE(ue.nombre_completo, '') AS nombre_emite
      FROM ordenes_cobro oc
      LEFT JOIN usuarios_sistema ue ON ue.id_usuario = oc.id_usuario_emite
      WHERE ${where.join(" AND ")}
      ORDER BY oc.creado_en DESC, oc.id_orden DESC
      LIMIT $1
    `, params);

    const data = resultado.rows.map((r) => {
      const items = sanitizeOrdenCobroItems(safeJsonArray(r.recibos_json));
      return {
        id_orden: Number(r.id_orden),
        creado_en: r.creado_en,
        actualizado_en: r.actualizado_en,
        estado: r.estado,
        id_contribuyente: Number(r.id_contribuyente),
        codigo_municipal: r.codigo_municipal || null,
        total_orden: parseMonto(r.total_orden, 0),
        observacion: r.observacion || null,
        cantidad_recibos: items.length,
        items,
        emisor: {
          id_usuario: r.id_usuario_emite ? Number(r.id_usuario_emite) : null,
          username: r.usuario_emite || null,
          nombre: r.nombre_emite || null
        }
      };
    });
    res.json(data);
  } catch (err) {
    console.error("Error listando ordenes pendientes:", err.message);
    res.status(500).json({ error: "Error listando ordenes pendientes." });
  }
});

app.post("/caja/ordenes-cobro/:id/cobrar", async (req, res) => {
  const client = await pool.connect();
  try {
    const idOrden = parsePositiveInt(req.params.id, 0);
    if (!idOrden) return res.status(400).json({ error: "Orden invalida." });

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

    const idsRecibos = items.map((i) => i.id_recibo);
    const recibosRows = await client.query(`
      WITH pagos_agg AS (
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
        COALESCE(pa.total_pagado, 0) AS total_pagado
      FROM recibos r
      LEFT JOIN pagos_agg pa ON pa.id_recibo = r.id_recibo
      WHERE r.id_recibo = ANY($1::int[])
      FOR UPDATE OF r
    `, [idsRecibos]);
    if (recibosRows.rows.length !== idsRecibos.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Uno o mas recibos de la orden no existen." });
    }

    const recibosMap = new Map(recibosRows.rows.map((r) => [Number(r.id_recibo), {
      id_recibo: Number(r.id_recibo),
      mes: Number(r.mes),
      anio: Number(r.anio),
      total_pagar: parseMonto(r.total_pagar, 0),
      total_pagado: parseMonto(r.total_pagado, 0)
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
      const saldoPrevio = roundMonto2(Math.max(recibo.total_pagar - recibo.total_pagado, 0));
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
        "INSERT INTO pagos (id_recibo, monto_pagado, usuario_cajero) VALUES ($1, $2, $3)",
        [item.id_recibo, monto, req.user?.username || req.user?.nombre || null]
      );

      const totalPagadoNuevo = roundMonto2(recibo.total_pagado + monto);
      const nuevoEstado = totalPagadoNuevo >= recibo.total_pagar - 0.001 ? "PAGADO" : "PARCIAL";
      await client.query(
        "UPDATE recibos SET estado = $1 WHERE id_recibo = $2",
        [nuevoEstado, item.id_recibo]
      );

      const saldoPosterior = roundMonto2(Math.max(recibo.total_pagar - totalPagadoNuevo, 0));
      pagosAplicados.push({
        id_recibo: item.id_recibo,
        mes: recibo.mes,
        anio: recibo.anio,
        monto_cobrado: monto,
        total_pagar: recibo.total_pagar,
        total_pagado: totalPagadoNuevo,
        saldo: saldoPosterior,
        estado: nuevoEstado,
        subtotal_agua: parseSubtotalOrden(item.subtotal_agua),
        subtotal_desague: parseSubtotalOrden(item.subtotal_desague),
        subtotal_limpieza: parseSubtotalOrden(item.subtotal_limpieza),
        subtotal_admin: parseSubtotalOrden(item.subtotal_admin)
      });
      totalAplicado = roundMonto2(totalAplicado + monto);
      recibo.total_pagado = totalPagadoNuevo;
    }

    await client.query(`
      UPDATE ordenes_cobro
      SET
        estado = 'COBRADA',
        id_usuario_cobra = $2,
        cobrado_en = NOW(),
        actualizado_en = NOW()
      WHERE id_orden = $1
    `, [idOrden, req.user?.id_usuario || null]);

    const usuarioAuditoria = req.user?.username || req.user?.nombre || "SISTEMA";
    const ip = getRequestIp(req);
    await registrarAuditoria(
      client,
      "ORDEN_COBRO_COBRADA",
      `orden=${idOrden}; contribuyente=${orden.id_contribuyente}; total=${totalAplicado.toFixed(2)}; recibos=${pagosAplicados.length}; ip=${ip}`,
      usuarioAuditoria
    );

    await client.query("COMMIT");
    invalidateContribuyentesCache();
    res.json({
      mensaje: "Cobro registrado correctamente.",
      orden: {
        id_orden: idOrden,
        estado: ESTADOS_ORDEN_COBRO.COBRADA,
        id_contribuyente: Number(orden.id_contribuyente),
        codigo_municipal: orden.codigo_municipal || null,
        total_orden: parseMonto(orden.total_orden, totalAplicado),
        total_cobrado: totalAplicado
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
      SELECT id_orden, id_contribuyente, estado
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
      `orden=${idOrden}; contribuyente=${orden.rows[0].id_contribuyente}; motivo=${motivo}; ip=${ip}`,
      usuarioAuditoria
    );

    await client.query("COMMIT");
    res.json({ mensaje: "Orden anulada.", id_orden: idOrden, estado: ESTADOS_ORDEN_COBRO.ANULADA });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error anulando orden:", err.message);
    res.status(500).json({ error: "Error anulando orden." });
  } finally {
    client.release();
  }
});

app.post("/pagos", async (req, res) => {
  const client = await pool.connect();
  try {
    if (normalizeRole(req.user?.rol) === "CAJERO") {
      return res.status(403).json({
        error: "Caja no puede registrar pagos directos. Debe cobrar desde una orden de cobro pendiente."
      });
    }
    const { id_recibo, monto_pagado } = req.body;
    const monto = parseFloat(monto_pagado);
    if (!id_recibo || !Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({ error: "Monto inválido." });
    }

    await client.query("BEGIN");

    const recibo = await client.query(
      "SELECT total_pagar FROM recibos WHERE id_recibo = $1 FOR UPDATE",
      [id_recibo]
    );
    if (recibo.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Recibo no encontrado." });
    }

    const totalPagar = parseFloat(recibo.rows[0].total_pagar) || 0;
    const pagosPrev = await client.query(
      "SELECT COALESCE(SUM(monto_pagado), 0) as total_pagado FROM pagos WHERE id_recibo = $1",
      [id_recibo]
    );
    const totalPagadoPrev = parseFloat(pagosPrev.rows[0].total_pagado) || 0;
    const totalPagadoNuevo = totalPagadoPrev + monto;

    if (totalPagadoNuevo > totalPagar + 0.001) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "El monto excede el total del recibo." });
    }

    await client.query(
      "INSERT INTO pagos (id_recibo, monto_pagado) VALUES ($1, $2)",
      [id_recibo, monto]
    );

    const nuevoEstado = totalPagadoNuevo >= totalPagar ? "PAGADO" : "PARCIAL";
    await client.query("UPDATE recibos SET estado = $1 WHERE id_recibo = $2", [nuevoEstado, id_recibo]);

    await client.query("COMMIT");
    invalidateContribuyentesCache();

    res.json({
      mensaje: "Pago OK",
      estado: nuevoEstado,
      total_pagado: totalPagadoNuevo,
      saldo: Math.max(totalPagar - totalPagadoNuevo, 0)
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    res.status(500).send("Error");
  } finally {
    client.release();
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
    const mesActual = new Date().getMonth() + 1;

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
      GROUP BY c.codigo_municipal
    `, [idContribuyente, anioActual, mesActual]);

    if (resumen.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contribuyente no encontrado." });
    }

    const fila = resumen.rows[0];
    const codigoMunicipal = fila.codigo_municipal || null;
    const mesesDeuda = Number(fila.meses_deuda || 0);
    const deudaTotal = parseMonto(fila.deuda_total, 0);

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

app.get("/recibos/historial/:id_contribuyente", async (req, res) => {
  try {
    const { id_contribuyente } = req.params;
    const anioActual = getCurrentYear();
    const mesActual = new Date().getMonth() + 1;
    const anioParam = req.query.anio;
    const filtrarAnio = anioParam !== 'all';
    const anio = filtrarAnio ? (Number(anioParam) || getCurrentYear()) : null;

    const historial = await pool.query(`
      SELECT r.id_recibo, r.mes, r.anio, r.subtotal_agua, r.subtotal_desague, r.subtotal_limpieza, r.subtotal_admin,
        r.total_pagar,
        COALESCE(p.total_pagado, 0) as abono_mes,
        CASE
          WHEN (r.anio > $2) OR (r.anio = $2 AND r.mes > $3) THEN 0
          ELSE GREATEST(r.total_pagar - COALESCE(p.total_pagado, 0), 0)
        END as deuda_mes,
        CASE
          WHEN (r.anio > $2) OR (r.anio = $2 AND r.mes > $3) THEN 'NO_EXIGIBLE'
          WHEN COALESCE(p.total_pagado, 0) >= r.total_pagar THEN 'PAGADO'
          WHEN COALESCE(p.total_pagado, 0) > 0 THEN 'PARCIAL'
          ELSE 'PENDIENTE'
        END as estado
      FROM recibos r
      LEFT JOIN (
        SELECT id_recibo, SUM(monto_pagado) as total_pagado
        FROM pagos
        GROUP BY id_recibo
      ) p ON p.id_recibo = r.id_recibo
      WHERE r.id_predio IN (SELECT id_predio FROM predios WHERE id_contribuyente = $1)
      ${filtrarAnio ? 'AND r.anio = $4' : ''}
      ORDER BY r.anio ASC, r.mes ASC
    `, filtrarAnio ? [id_contribuyente, anioActual, mesActual, anio] : [id_contribuyente, anioActual, mesActual]);
    res.json(historial.rows);
  } catch (err) { res.status(500).send("Error historial"); }
});

const TIPOS_REPORTE_CAJA = new Set(["diario", "semanal", "mensual", "anual"]);

const obtenerRangoCaja = async (tipo, fechaReferencia) => {
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

  if (tipo === "semanal" || tipo === "mensual") {
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
    WHERE p.fecha_pago >= $1::date
      AND p.fecha_pago < $2::date
    GROUP BY 1, 3
    ORDER BY 3
  `, [desde, hasta]);

  return serie.rows.map((r) => ({
    etiqueta: r.etiqueta,
    total: parseFloat(r.total) || 0
  }));
};

const construirResumenCaja = async (tipo, fechaReferencia) => {
  const cacheKey = `${tipo}|${fechaReferencia}`;
  const now = Date.now();
  const cached = reportesCajaCache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    return cached.data;
  }

  const rango = await obtenerRangoCaja(tipo, fechaReferencia);
  const desde = rango.desde;
  const hasta = rango.hasta;

  const resumenPagos = await pool.query(`
    SELECT
      COUNT(*)::int AS cantidad,
      COALESCE(SUM(p.monto_pagado), 0)::numeric AS total
    FROM pagos p
    WHERE p.fecha_pago >= $1::date
      AND p.fecha_pago < $2::date
  `, [desde, hasta]);
  const cantidadMovimientos = Number(resumenPagos.rows[0]?.cantidad || 0);
  const total = parseFloat(resumenPagos.rows[0]?.total || 0) || 0;

  const topContribuyentes = await pool.query(`
    SELECT
      c.codigo_municipal,
      c.nombre_completo,
      ROUND(SUM(p.monto_pagado)::numeric, 2) AS total
    FROM pagos p
    JOIN recibos r ON p.id_recibo = r.id_recibo
    JOIN predios pr ON r.id_predio = pr.id_predio
    JOIN contribuyentes c ON pr.id_contribuyente = c.id_contribuyente
    WHERE p.fecha_pago >= $1::date
      AND p.fecha_pago < $2::date
    GROUP BY c.codigo_municipal, c.nombre_completo
    ORDER BY SUM(p.monto_pagado) DESC
    LIMIT 10
  `, [desde, hasta]);

  const periodos = await pool.query(`
    SELECT
      CONCAT(LPAD(r.mes::text, 2, '0'), '/', r.anio::text) AS periodo,
      ROUND(SUM(p.monto_pagado)::numeric, 2) AS total
    FROM pagos p
    JOIN recibos r ON p.id_recibo = r.id_recibo
    WHERE p.fecha_pago >= $1::date
      AND p.fecha_pago < $2::date
    GROUP BY r.anio, r.mes
    ORDER BY r.anio ASC, r.mes ASC
  `, [desde, hasta]);

  const serieTemporal = await construirSerieTemporalCaja(tipo, desde, hasta);

  const resumen = {
    tipo,
    fecha_referencia: fechaReferencia,
    rango: {
      desde,
      hasta_exclusivo: hasta
    },
    total: total.toFixed(2),
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
  const pageRaw = Number(options.page ?? 1);
  const pageSizeRaw = Number(options.pageSize ?? 200);
  const safePage = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const safePageSize = includeAllMovimientos
    ? 0
    : (Number.isFinite(pageSizeRaw) ? Math.min(500, Math.max(25, pageSizeRaw)) : 200);
  const offset = includeAllMovimientos ? 0 : (safePage - 1) * safePageSize;

  const resumen = await construirResumenCaja(tipo, fechaReferencia);
  const desde = resumen.rango.desde;
  const hasta = resumen.rango.hasta_exclusivo;
  const cantidadMovimientos = Number(resumen.cantidad_movimientos || 0);

  const movimientosSql = `
    SELECT
      p.id_pago,
      p.fecha_pago,
      to_char(p.fecha_pago, 'YYYY-MM-DD') AS fecha,
      to_char(p.fecha_pago, 'HH24:MI:SS') AS hora,
      p.monto_pagado,
      c.nombre_completo,
      c.codigo_municipal,
      r.mes,
      r.anio,
      CASE
        WHEN ci.id_codigo IS NOT NULL THEN LPAD(ci.id_codigo::text, 6, '0')
        ELSE NULL
      END AS codigo_impresion
    FROM pagos p
    JOIN recibos r ON p.id_recibo = r.id_recibo
    JOIN predios pr ON r.id_predio = pr.id_predio
    JOIN contribuyentes c ON pr.id_contribuyente = c.id_contribuyente
    LEFT JOIN LATERAL (
      SELECT id_codigo
      FROM codigos_impresion ci
      WHERE ci.recibos_json @> jsonb_build_array(r.id_recibo)
      ORDER BY ci.id_codigo DESC
      LIMIT 1
    ) ci ON TRUE
    WHERE p.fecha_pago >= $1::date
      AND p.fecha_pago < $2::date
    ORDER BY p.fecha_pago DESC, p.id_pago DESC
    ${includeAllMovimientos ? "" : "LIMIT $3 OFFSET $4"}
  `;
  const movimientosParams = includeAllMovimientos
    ? [desde, hasta]
    : [desde, hasta, safePageSize, offset];
  const movimientos = await pool.query(movimientosSql, movimientosParams);
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
    movimientos: movimientos.rows
  };
};

app.get("/caja/reporte", async (req, res) => {
  try {
    const tipoRaw = String(req.query.tipo || "diario").toLowerCase();
    const tipo = TIPOS_REPORTE_CAJA.has(tipoRaw) ? tipoRaw : "diario";
    const fecha = String(req.query.fecha || toISODate());
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.page_size || 200);
    const data = await construirReporteCaja(tipo, fecha, { page, pageSize });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Error reporte caja." });
  }
});

app.get("/caja/reporte/excel", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const tipoRaw = String(req.query.tipo || "diario").toLowerCase();
    const tipo = TIPOS_REPORTE_CAJA.has(tipoRaw) ? tipoRaw : "diario";
    const fecha = String(req.query.fecha || toISODate());
    const data = await construirReporteCaja(tipo, fecha, { includeAllMovimientos: true });

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
    wsResumen.addRow({ campo: "Total recaudado", valor: parseFloat(data.total || 0) });

    const wsMov = workbook.addWorksheet("Movimientos");
    wsMov.columns = [
      { header: "ID PAGO", key: "id_pago", width: 12 },
      { header: "FECHA", key: "fecha", width: 14 },
      { header: "HORA", key: "hora", width: 12 },
      { header: "COD. IMP.", key: "codigo_impresion", width: 14 },
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
        codigo_impresion: m.codigo_impresion || "",
        codigo_municipal: m.codigo_municipal || "",
        nombre_completo: m.nombre_completo || "",
        periodo: `${m.mes || ""}/${m.anio || ""}`,
        monto_pagado: parseFloat(m.monto_pagado || 0)
      });
    });

    const wsTemporal = workbook.addWorksheet("Grafico_Temporal");
    wsTemporal.columns = [
      { header: "ETIQUETA", key: "etiqueta", width: 22 },
      { header: "TOTAL", key: "total", width: 14 }
    ];
    wsTemporal.getRow(1).font = { bold: true };
    (data.graficos?.recaudacion_temporal || []).forEach((r) => {
      wsTemporal.addRow({ etiqueta: r.etiqueta || "", total: parseFloat(r.total || 0) });
    });

    const wsTop = workbook.addWorksheet("Top_Contribuyentes");
    wsTop.columns = [
      { header: "CODIGO", key: "codigo_municipal", width: 16 },
      { header: "CONTRIBUYENTE", key: "nombre_completo", width: 38 },
      { header: "TOTAL", key: "total", width: 14 }
    ];
    wsTop.getRow(1).font = { bold: true };
    (data.graficos?.top_contribuyentes || []).forEach((r) => {
      wsTop.addRow({
        codigo_municipal: r.codigo_municipal || "",
        nombre_completo: r.nombre_completo || "",
        total: parseFloat(r.total || 0)
      });
    });

    const wsPeriodo = workbook.addWorksheet("Periodo_Tributario");
    wsPeriodo.columns = [
      { header: "PERIODO", key: "periodo", width: 16 },
      { header: "TOTAL", key: "total", width: 14 }
    ];
    wsPeriodo.getRow(1).font = { bold: true };
    (data.graficos?.recaudacion_por_periodo || []).forEach((r) => {
      wsPeriodo.addRow({
        periodo: r.periodo || "",
        total: parseFloat(r.total || 0)
      });
    });

    const fechaSafe = String(fecha).replace(/[^\d-]/g, "");
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
    const fecha = String(req.query.fecha || toISODate());
    const data = await construirReporteCaja("diario", fecha, { includeAllMovimientos: true });
    res.json({
      ...data,
      fecha_consulta: fecha
    });
  } catch (err) {
    res.status(500).send("Error caja");
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
    const mesActual = new Date().getMonth() + 1;
    const recaudacion = await pool.query("SELECT SUM(monto_pagado) as total FROM pagos WHERE DATE(fecha_pago) = $1", [hoy]);
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
      { header: 'TELÉFONO', key: 'telefono', width: 15 },
      { header: 'DEUDA (S/.)', key: 'deuda', width: 20 },
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
        telefono: u.telefono,
        deuda: parseFloat(u.deuda_anio),
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
    const mesActual = new Date().getMonth() + 1;

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
      "5) Luego importe este archivo desde 'Importar > Verificacion Campo'."
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

// ==========================================
// LOGIN Y SEGURIDAD
// ==========================================
app.post("/auth/registro", async (req, res) => {
  try {
    const { username, password, nombre_completo } = req.body;
    const existe = await pool.query("SELECT * FROM usuarios_sistema WHERE username = $1", [username]);
    if (existe.rows.length > 0) return res.status(400).json({ error: "Usuario ya existe" });
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO usuarios_sistema (username, password, nombre_completo, rol, estado) VALUES ($1, $2, $3, 'BRIGADA', 'PENDIENTE')",
      [username, passwordHash, nombre_completo]
    );
    res.json({ mensaje: "Solicitud enviada." });
  } catch (err) { res.status(500).send("Error registro"); }
});

const handleLogin = async (req, res) => {
  try {
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
    let passwordOk = false;
    if (isBcryptHash(storedPassword)) {
      passwordOk = await bcrypt.compare(password, storedPassword);
    } else {
      passwordOk = storedPassword === password;
      if (passwordOk) {
        const newHash = await bcrypt.hash(password, 10);
        await pool.query("UPDATE usuarios_sistema SET password = $1 WHERE id_usuario = $2", [newHash, datos.id_usuario]);
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


app.get("/admin/usuarios", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const usuarios = await pool.query("SELECT id_usuario, username, nombre_completo, rol, estado FROM usuarios_sistema ORDER BY estado DESC");
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
       RETURNING id_usuario, username, nombre_completo, rol, estado`,
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
// BACKUP
// ==========================================
app.get("/admin/backup", authenticateToken, requireSuperAdmin, (req, res) => {
  const DB_USER = process.env.DB_USER || "postgres";
  const DB_HOST = process.env.DB_HOST || "localhost";
  const DB_NAME = process.env.DB_NAME || "db_agua_pueblonuevo";
  const DB_PORT = process.env.DB_PORT || "5432";
  const DB_PASSWORD = process.env.DB_PASSWORD || "123456";

  const fecha = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `backup_agua_${fecha}.sql`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/sql');

  const PG_DUMP_PATH = 'C:/Program Files/PostgreSQL/16/bin/pg_dump.exe'; // AJUSTA ESTA RUTA A TU VERSIÓN

  const dump = spawn(PG_DUMP_PATH, [
    '-U', DB_USER,
    '-h', DB_HOST,
    '-p', DB_PORT,
    '-F', 'p',
    DB_NAME
  ], {
    env: { ...process.env, PGPASSWORD: DB_PASSWORD }
  });

  dump.stdout.pipe(res);
  dump.stderr.on('data', (data) => console.error(`pg_dump: ${data}`));
  dump.on('error', (err) => res.status(500).send("Error pg_dump no encontrado."));
});

// ==========================================
// IMPRESIÓN MASIVA
// ==========================================
app.post("/recibos/masivos", async (req, res) => {
  try {
    const { tipo_seleccion, ids_usuarios, id_calle, anio, mes, meses } = req.body;
    const mesesSeleccionados = (Array.isArray(meses) ? meses : [mes])
      .map((m) => Number(m))
      .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
    if (mesesSeleccionados.length === 0) {
      return res.status(400).json({ error: "Seleccione al menos un mes valido." });
    }

    let filtro = "";
    const params = [anio, mesesSeleccionados]; 

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
      WHERE r.anio = $1 AND r.mes = ANY($2::int[]) ${filtro}
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
app.post("/importar/padron", authenticateToken, requireSuperAdmin, upload.single('archivo'), async (req, res) => {
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

    let datos = [];
    const nombreArchivo = (req.file.originalname || "").toLowerCase();
    
    if (nombreArchivo.endsWith('.xml')) {
        console.log("Procesando XML...");
        const parser = new xml2js.Parser({ explicitArray: false });
        const resultado = await parser.parseStringPromise(req.file.buffer.toString());
        
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
        const workbook = new ExcelJS.Workbook();
        try { await workbook.xlsx.load(req.file.buffer); } catch (e) { 
            const stream = new Readable(); stream.push(req.file.buffer); stream.push(null); await workbook.csv.read(stream); 
        }
        const worksheet = workbook.getWorksheet(1);
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
  } finally { client.release(); }
});

app.post("/importar/verificacion-campo", authenticateToken, requireAdmin, upload.single('archivo'), async (req, res) => {
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
    const nombreArchivo = String(req.file.originalname || "").toLowerCase();
    const permitido = nombreArchivo.endsWith(".xlsx") || nombreArchivo.endsWith(".xls") || nombreArchivo.endsWith(".csv");
    if (!permitido) {
      return res.status(400).json({ error: "Formato no válido. Use .xlsx, .xls o .csv." });
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(req.file.buffer);
    } catch {
      const stream = new Readable();
      stream.push(req.file.buffer);
      stream.push(null);
      await workbook.csv.read(stream);
    }
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
    client.release();
  }
});

app.post("/importar/historial", authenticateToken, requireSuperAdmin, upload.single('archivo'), async (req, res) => {
  if (importacionHistorialEnCurso) {
    return res.status(409).json({ error: "Ya hay una importación de historial en curso." });
  }

  try {
    if (!req.file) {
      return res.status(400).json({ error: "Debe adjuntar un archivo .txt o .csv." });
    }

    const nombre = (req.file.originalname || "").toLowerCase();
    if (!nombre.endsWith(".txt") && !nombre.endsWith(".csv")) {
      return res.status(400).json({ error: "Formato no válido. Use .txt o .csv." });
    }

    importacionHistorialEnCurso = true;
    const contenido = req.file.buffer?.toString("utf8") || "";
    if (!contenido.trim()) {
      return res.status(400).json({ error: "El archivo está vacío." });
    }

    const resultado = await importarDeudas({
      inputText: contenido,
      commitPerBatch: true,
      maxRechazos: MAX_RECHAZOS_IMPORTACION,
      logger: {
        log: (msg) => console.log(`[IMPORTAR_HISTORIAL] ${msg}`),
        error: (msg, err) => console.error(`[IMPORTAR_HISTORIAL] ${msg}`, err),
        progress: () => {}
      }
    });

    if (Number(resultado?.recibos_insertados || 0) > 0 || Number(resultado?.pagos_insertados || 0) > 0) {
      invalidateContribuyentesCache();
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
  }
});

const getFechaLocalPartes = (timeZone = AUTO_DEUDA_TIMEZONE, fecha = new Date()) => {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = dtf.formatToParts(fecha);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    anio: Number(map.year),
    mes: Number(map.month),
    dia: Number(map.day)
  };
};

const generarDeudaMensualAutomatica = async () => {
  if (!AUTO_DEUDA_ACTIVA || autoDeudaEnCurso) return;

  const { anio, mes, dia } = getFechaLocalPartes();
  if (dia !== 1) return;

  const periodo = `${anio}-${String(mes).padStart(2, "0")}`;
  if (ultimoPeriodoAutoDeuda === periodo) return;

  autoDeudaEnCurso = true;
  const client = await pool.connect();
  try {
    const params = [
      anio,
      mes,
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
        CASE WHEN UPPER(COALESCE(p.agua_sn, 'S')) = 'S' THEN $3::numeric ELSE 0 END,
        CASE WHEN UPPER(COALESCE(p.desague_sn, 'S')) = 'S' THEN $4::numeric ELSE 0 END,
        CASE WHEN UPPER(COALESCE(p.limpieza_sn, 'S')) = 'S' THEN $5::numeric ELSE 0 END,
        CASE WHEN UPPER(COALESCE(p.activo_sn, 'S')) = 'S' THEN $6::numeric ELSE 0 END,
        (
          CASE WHEN UPPER(COALESCE(p.agua_sn, 'S')) = 'S' THEN $3::numeric ELSE 0 END +
          CASE WHEN UPPER(COALESCE(p.desague_sn, 'S')) = 'S' THEN $4::numeric ELSE 0 END +
          CASE WHEN UPPER(COALESCE(p.limpieza_sn, 'S')) = 'S' THEN $5::numeric ELSE 0 END +
          CASE WHEN UPPER(COALESCE(p.activo_sn, 'S')) = 'S' THEN $6::numeric ELSE 0 END
        ) AS total_pagar,
        'PENDIENTE',
        make_date($1::int, $2::int, 1),
        (make_date($1::int, $2::int, 1) + INTERVAL '1 month')::date
      FROM predios p
      JOIN contribuyentes c ON c.id_contribuyente = p.id_contribuyente
      WHERE UPPER(COALESCE(p.activo_sn, 'S')) = 'S'
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

  const intervalo = Number.isFinite(AUTO_DEUDA_CHECK_MS) && AUTO_DEUDA_CHECK_MS > 0
    ? AUTO_DEUDA_CHECK_MS
    : 60 * 60 * 1000;

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
  removerArtefactosReniec().catch((err) => {
    console.error("[RENIEC] Error en limpieza inicial:", err);
  });
  iniciarTareaAutoDeuda();
};

app.listen(SERVER_PORT, SERVER_HOST, () => {
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
    https.createServer(httpsOptions, app).listen(HTTPS_PORT, SERVER_HOST, () => {
      onServerStarted("Servidor HTTPS", SERVER_HOST, HTTPS_PORT);
    });
  } catch (err) {
    console.error("[HTTPS] No se pudo iniciar servidor HTTPS:", err.message);
  }
}
