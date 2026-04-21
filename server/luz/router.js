const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const multer = require("multer");
const { Readable } = require("stream");
const pool = require("./db");

const router = express.Router();
const LUZ_IMPORT_MAX_FILE_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.LUZ_IMPORT_MAX_FILE_BYTES || process.env.IMPORT_MAX_FILE_BYTES || (25 * 1024 * 1024))
);
const LUZ_IMPORT_UPLOAD_DIR = path.join(__dirname, ".tmp", "imports");
const ensureLuzImportUploadDir = () => {
  try {
    fs.mkdirSync(LUZ_IMPORT_UPLOAD_DIR, { recursive: true });
  } catch {}
};
const uploadImport = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        ensureLuzImportUploadDir();
        return cb(null, LUZ_IMPORT_UPLOAD_DIR);
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
  limits: { fileSize: LUZ_IMPORT_MAX_FILE_BYTES }
});
const uploadImportSingle = (fieldName) => (req, res, next) => {
  uploadImport.single(fieldName)(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: `El archivo excede el límite permitido (${Math.round(LUZ_IMPORT_MAX_FILE_BYTES / (1024 * 1024))}MB).`
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
const loadWorkbookFromUploadedFile = async (file) => {
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

const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const SECURITY_STRICT_STARTUP = Object.prototype.hasOwnProperty.call(process.env, "SECURITY_STRICT_STARTUP")
  ? process.env.SECURITY_STRICT_STARTUP === "1"
  : NODE_ENV === "production";
const JWT_SECRET_DEFAULT = "cambia_esto_en_produccion";
const JWT_SECRET = process.env.JWT_SECRET || JWT_SECRET_DEFAULT;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";
const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.AUTO_DEUDA_TIMEZONE || "America/Lima";
const jwtWeakSecret = !JWT_SECRET || JWT_SECRET === JWT_SECRET_DEFAULT || String(JWT_SECRET).trim().length < 32;
if (SECURITY_STRICT_STARTUP && jwtWeakSecret) {
  throw new Error("[LUZ][SECURITY] JWT_SECRET inseguro. Configure una clave >= 32 caracteres.");
}

const LUZ_TARIFA_KWH_DEFAULT = Number.parseFloat(process.env.LUZ_TARIFA_KWH_DEFAULT || "1") || 1;
const LUZ_CARGO_FIJO_DEFAULT = Number.parseFloat(process.env.LUZ_CARGO_FIJO_DEFAULT || "6.5") || 6.5;
const LUZ_DIAS_VENCIMIENTO_DEFAULT = Math.max(0, Number.parseInt(process.env.LUZ_DIAS_VENCIMIENTO_DEFAULT || "6", 10) || 6);
const LUZ_DIAS_CORTE_DEFAULT = Math.max(LUZ_DIAS_VENCIMIENTO_DEFAULT, Number.parseInt(process.env.LUZ_DIAS_CORTE_DEFAULT || "10", 10) || 10);
const MAX_RECHAZOS_IMPORTACION = Math.max(50, Number.parseInt(process.env.MAX_RECHAZOS_IMPORTACION || "500", 10) || 500);
const CAMPO_TIPO_VISITA = {
  CORROBORAR_MEDIDOR: "CORROBORAR_MEDIDOR",
  VISITA_MENSUAL: "VISITA_MENSUAL"
};
const ZONA_CHARCAPE = "CHARCAPE";
const ZONA_AAHH_CHARCAPE = "AA.HH CHARCAPE";
const LUZ_CAJA_INTERNA_HABILITADA = true;

const ROLE_ORDER = {
  BRIGADA: 1,
  CONSULTA: 2,
  CAJERO: 3,
  ADMIN_SEC: 4,
  ADMIN: 5
};
const ROLE_LABELS = {
  ADMIN: "Nivel 1 - Admin principal",
  ADMIN_SEC: "Nivel 2 - Ventanilla",
  CAJERO: "Nivel 3 - Operador de caja",
  CONSULTA: "Nivel 4 - Consulta",
  BRIGADA: "Nivel 5 - Brigada"
};
const USER_STATUS_ALLOWED = new Set(["PENDIENTE", "ACTIVO", "BLOQUEADO"]);

const normalizeRole = (role) => {
  const raw = String(role || "").trim().toUpperCase();
  if (["ADMIN", "SUPERADMIN", "ADMIN_PRINCIPAL", "NIVEL_1"].includes(raw)) return "ADMIN";
  if (["ADMIN_SEC", "ADMIN_SECUNDARIO", "JEFE_CAJA", "NIVEL_2"].includes(raw)) return "ADMIN_SEC";
  if (["CAJERO", "OPERADOR_CAJA", "OPERADOR", "NIVEL_3"].includes(raw)) return "CAJERO";
  if (["BRIGADA", "BRIGADISTA", "CAMPO", "NIVEL_5"].includes(raw)) return "BRIGADA";
  if (["CONSULTA", "LECTURA", "NIVEL_4"].includes(raw)) return "CONSULTA";
  return "CONSULTA";
};

const hasMinRole = (role, requiredRole) => {
  const current = ROLE_ORDER[normalizeRole(role)] || 0;
  const needed = ROLE_ORDER[normalizeRole(requiredRole)] || 0;
  return current >= needed;
};
const isKnownRoleValue = (role) => {
  const normalized = normalizeRole(role);
  return Object.prototype.hasOwnProperty.call(ROLE_ORDER, normalized);
};
const normalizeEstadoUsuario = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (USER_STATUS_ALLOWED.has(raw)) return raw;
  return "";
};

const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const parseMonto = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parsePositiveInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizeText = (value, maxLen = 220) => {
  const txt = String(value || "").trim();
  if (!txt) return "";
  return txt.length > maxLen ? txt.slice(0, maxLen) : txt;
};
const normalizeLoginUsername = (value) => String(value || "").trim().toLowerCase().slice(0, 120);
const getRequestIp = (req) => {
  const fromHeader = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((v) => v.trim())
    .find(Boolean);
  return (fromHeader || req.ip || req.socket?.remoteAddress || "unknown").slice(0, 120);
};
const LOGIN_RATE_LIMIT_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || (10 * 60 * 1000));
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 25);
const LOGIN_LOCK_THRESHOLD = Number(process.env.LOGIN_LOCK_THRESHOLD || 5);
const LOGIN_LOCK_DURATION_MS = Number(process.env.LOGIN_LOCK_DURATION_MS || (15 * 60 * 1000));
const loginIpRateMap = new Map();
const loginUserFailMap = new Map();
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

const normalizeEstadoSuministro = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (["CORTADO", "CORTE", "SUSPENDIDO"].includes(raw)) return "CORTADO";
  if (["INACTIVO", "NO VIVE", "NO VIVEN", "SIN SERVICIO"].includes(raw)) return "INACTIVO";
  return "ACTIVO";
};

const normalizeHoraPartes = (date = new Date(), timeZone = APP_TIMEZONE) => {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = dtf.formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const anio = Number(map.year);
  const mes = Number(map.month);
  const dia = Number(map.day);
  return {
    anio,
    mes,
    dia,
    iso: `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
  };
};

const addDaysIso = (isoDate, days) => {
  const [y, m, d] = String(isoDate || "").split("-").map((x) => Number.parseInt(x, 10));
  if (!y || !m || !d) return isoDate;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  const year = dt.getUTCFullYear();
  const month = dt.getUTCMonth() + 1;
  const day = dt.getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const getPeriodoAnterior = (anio, mes) => {
  const anioNum = parsePositiveInt(anio, 0);
  const mesNum = parsePositiveInt(mes, 0);
  if (!anioNum || mesNum < 1 || mesNum > 12) return null;
  if (mesNum === 1) {
    return { anio: anioNum - 1, mes: 12 };
  }
  return { anio: anioNum, mes: mesNum - 1 };
};

const issueLuzToken = (user) => jwt.sign(
  {
    id_usuario: user.id_usuario,
    username: user.username,
    rol: normalizeRole(user.rol),
    nombre: user.nombre_completo,
    sistema: "LUZ"
  },
  JWT_SECRET,
  { expiresIn: JWT_EXPIRES_IN }
);

const resolverUsuarioLuz = async (token) => {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (String(payload?.sistema || "").toUpperCase() !== "LUZ") {
      return { ok: false, status: 403, error: "Token no corresponde al sistema de luz." };
    }
    const user = await pool.query(
      "SELECT id_usuario, username, nombre_completo, rol, estado FROM usuarios_sistema WHERE id_usuario = $1",
      [payload.id_usuario]
    );
    if (!user.rows[0]) return { ok: false, status: 401, error: "Usuario no válido" };
    const row = user.rows[0];
    if (String(row.estado || "").toUpperCase() !== "ACTIVO") {
      return { ok: false, status: 403, error: "Cuenta no activa." };
    }
    return {
      ok: true,
      user: {
        id_usuario: Number(row.id_usuario),
        username: row.username,
        nombre: row.nombre_completo,
        rol: normalizeRole(row.rol),
        estado: row.estado,
        sistema: "LUZ"
      }
    };
  } catch {
    return { ok: false, status: 401, error: "Token inválido o expirado" };
  }
};

const authenticateLuzToken = async (req, res, next) => {
  const auth = String(req.headers.authorization || "");
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const resolved = await resolverUsuarioLuz(token);
  if (!resolved.ok) {
    return res.status(resolved.status || 401).json({ error: resolved.error || "No autorizado" });
  }
  req.user = resolved.user;
  return next();
};
const resolveCajaUserFromAnySystemToken = async (token) => {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const sistema = String(payload?.sistema || "AGUA").trim().toUpperCase();
    if (sistema === "LUZ") {
      return resolverUsuarioLuz(token);
    }
    return {
      ok: true,
      user: {
        id_usuario: Number(payload?.id_usuario || 0),
        username: String(payload?.username || "").trim() || "usuario",
        nombre: String(payload?.nombre || payload?.username || "Usuario"),
        rol: normalizeRole(payload?.rol),
        estado: "ACTIVO",
        sistema: "AGUA"
      }
    };
  } catch {
    return { ok: false, status: 401, error: "Token inválido o expirado" };
  }
};
const authenticateCajaMunicipalToken = async (req, res, next) => {
  const auth = String(req.headers.authorization || "");
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const resolved = await resolveCajaUserFromAnySystemToken(token);
  if (!resolved.ok) {
    return res.status(resolved.status || 401).json({ error: resolved.error || "No autorizado" });
  }
  req.user = resolved.user;
  return next();
};

const requireRole = (minRole) => (req, res, next) => {
  if (!hasMinRole(req.user?.rol, minRole)) {
    return res.status(403).json({ error: "Acceso denegado." });
  }
  return next();
};

const registrarAuditoria = async (clientOrPool, usuario, accion, detalle) => {
  const db = clientOrPool || pool;
  try {
    await db.query(
      "INSERT INTO auditoria (usuario, accion, detalle) VALUES ($1, $2, $3)",
      [usuario || "SISTEMA", accion, detalle || null]
    );
  } catch (err) {
    console.error("[LUZ] Error guardando auditoria:", err.message);
  }
};

const ensureCampoVisitasTable = async (db) => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS campo_visitas (
      id_visita BIGSERIAL PRIMARY KEY,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      id_suministro BIGINT NOT NULL REFERENCES suministros(id_suministro),
      id_usuario_registra INTEGER NULL,
      tipo_visita VARCHAR(40) NOT NULL,
      nro_medidor_reportado VARCHAR(80) NOT NULL,
      lectura_actual NUMERIC(12, 2) NULL,
      foto_medidor_base64 TEXT NOT NULL,
      observacion TEXT NULL,
      inspector VARCHAR(120) NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_campo_visitas_tipo'
      ) THEN
        ALTER TABLE campo_visitas
        ADD CONSTRAINT chk_campo_visitas_tipo
        CHECK (tipo_visita IN ('CORROBORAR_MEDIDOR', 'VISITA_MENSUAL'));
      END IF;
    END $$;
  `);
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_campo_visitas_lectura'
      ) THEN
        ALTER TABLE campo_visitas
        ADD CONSTRAINT chk_campo_visitas_lectura
        CHECK (lectura_actual IS NULL OR lectura_actual >= 0);
      END IF;
    END $$;
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_campo_visitas_suministro_fecha
    ON campo_visitas (id_suministro, creado_en DESC, id_visita DESC)
  `);
};

const ensureCharcapeSplit = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const zones = await client.query("SELECT id_zona, nombre FROM zonas");
    const rows = Array.isArray(zones.rows) ? zones.rows : [];
    const charcapeRows = rows.filter((z) => normalizeZoneKey(z.nombre) === "CHARCAPE");
    if (!charcapeRows.length) {
      await client.query("COMMIT");
      return;
    }
    const zoneByKey = new Map(rows.map((z) => [normalizeZoneKey(z.nombre), z]));
    let zoneCharcape = zoneByKey.get("CHARCAPE");
    let zoneAahh = zoneByKey.get("AAHHCHARCAPE");
    if (!zoneAahh) {
      const inserted = await client.query(
        "INSERT INTO zonas (nombre, activo) VALUES ($1, TRUE) RETURNING id_zona, nombre",
        [ZONA_AAHH_CHARCAPE]
      );
      zoneAahh = inserted.rows[0];
    }
    if (!zoneCharcape) zoneCharcape = charcapeRows[0];
    const relatedZoneIds = rows
      .filter((z) => {
        const key = normalizeZoneKey(z.nombre);
        return key === "CHARCAPE" || key === "AAHHCHARCAPE";
      })
      .map((z) => Number(z.id_zona))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (!relatedZoneIds.includes(Number(zoneCharcape.id_zona))) relatedZoneIds.push(Number(zoneCharcape.id_zona));
    if (!relatedZoneIds.includes(Number(zoneAahh.id_zona))) relatedZoneIds.push(Number(zoneAahh.id_zona));
    if (!relatedZoneIds.length) {
      await client.query("COMMIT");
      return;
    }

    // Orden importante por solape 80-83: se aplica al final hacia AA.HH Charcape.
    await client.query(
      `
      UPDATE suministros s
      SET id_zona = $1
      WHERE s.id_zona = ANY($2::int[])
        AND NULLIF(regexp_replace(COALESCE(s.nro_medidor, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
        AND (NULLIF(regexp_replace(COALESCE(s.nro_medidor, ''), '[^0-9]', '', 'g'), '')::int BETWEEN 1 AND 83)
      `,
      [Number(zoneCharcape.id_zona), relatedZoneIds]
    );
    await client.query(
      `
      UPDATE suministros s
      SET id_zona = $1
      WHERE s.id_zona = ANY($2::int[])
        AND NULLIF(regexp_replace(COALESCE(s.nro_medidor, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
        AND (NULLIF(regexp_replace(COALESCE(s.nro_medidor, ''), '[^0-9]', '', 'g'), '')::int BETWEEN 80 AND 158)
      `,
      [Number(zoneAahh.id_zona), relatedZoneIds]
    );

    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
};

const ensureDefaults = async () => {
  await pool.query("ALTER TABLE usuarios_sistema ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL");
  await pool.query("ALTER TABLE suministros ADD COLUMN IF NOT EXISTS nro_medidor_real VARCHAR(80) NULL");
  // Reglas antiguas bloquean nuevo cálculo de lectura mensual.
  await pool.query("ALTER TABLE recibos DROP CONSTRAINT IF EXISTS chk_luz_recibos_lecturas");
  await pool.query("ALTER TABLE recibos DROP CONSTRAINT IF EXISTS chk_luz_recibos_consumo");
  await pool.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_recibos_lectura_actual_nonneg'
       ) THEN
         ALTER TABLE recibos
         ADD CONSTRAINT chk_luz_recibos_lectura_actual_nonneg CHECK (lectura_actual >= 0);
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'chk_luz_recibos_consumo_nonneg'
       ) THEN
         ALTER TABLE recibos
         ADD CONSTRAINT chk_luz_recibos_consumo_nonneg CHECK (consumo_kwh >= 0);
       END IF;
     END $$;`
  );
  await ensureCampoVisitasTable(pool);
  await pool.query(
    `INSERT INTO config_fechas (id_config, dias_vencimiento, dias_corte)
     VALUES (1, $1, $2)
     ON CONFLICT (id_config) DO NOTHING`,
    [LUZ_DIAS_VENCIMIENTO_DEFAULT, LUZ_DIAS_CORTE_DEFAULT]
  );
  await pool.query(
    `INSERT INTO tarifas_config (tarifa_kwh, cargo_fijo, activo, creado_por)
     SELECT $1, $2, TRUE, 'SISTEMA'
     WHERE NOT EXISTS (SELECT 1 FROM tarifas_config WHERE activo = TRUE)`,
    [round2(LUZ_TARIFA_KWH_DEFAULT), round2(LUZ_CARGO_FIJO_DEFAULT)]
  );
};

let defaultsPromise = null;
const ensureDefaultsOnce = async () => {
  if (!defaultsPromise) {
    defaultsPromise = ensureDefaults().catch((err) => {
      defaultsPromise = null;
      throw err;
    });
  }
  await defaultsPromise;
};
let charcapeSplitPromise = null;
const ensureCharcapeSplitOnce = async () => {
  if (!charcapeSplitPromise) {
    charcapeSplitPromise = ensureCharcapeSplit().catch((err) => {
      charcapeSplitPromise = null;
      throw err;
    });
  }
  await charcapeSplitPromise;
};

const getTarifaActiva = async (clientOrPool) => {
  const db = clientOrPool || pool;
  const rs = await db.query(
    `SELECT id_tarifa, tarifa_kwh, cargo_fijo, activo, creado_en
     FROM tarifas_config
     WHERE activo = TRUE
     ORDER BY id_tarifa DESC
     LIMIT 1`
  );
  if (rs.rows[0]) {
    return {
      id_tarifa: Number(rs.rows[0].id_tarifa),
      tarifa_kwh: parseMonto(rs.rows[0].tarifa_kwh, LUZ_TARIFA_KWH_DEFAULT),
      cargo_fijo: parseMonto(rs.rows[0].cargo_fijo, LUZ_CARGO_FIJO_DEFAULT)
    };
  }
  await ensureDefaultsOnce();
  const retry = await db.query(
    `SELECT id_tarifa, tarifa_kwh, cargo_fijo
     FROM tarifas_config
     WHERE activo = TRUE
     ORDER BY id_tarifa DESC
     LIMIT 1`
  );
  return {
    id_tarifa: Number(retry.rows[0]?.id_tarifa || 0),
    tarifa_kwh: parseMonto(retry.rows[0]?.tarifa_kwh, LUZ_TARIFA_KWH_DEFAULT),
    cargo_fijo: parseMonto(retry.rows[0]?.cargo_fijo, LUZ_CARGO_FIJO_DEFAULT)
  };
};

const getConfigFechas = async (clientOrPool) => {
  const db = clientOrPool || pool;
  const rs = await db.query(
    `SELECT id_config, dias_vencimiento, dias_corte
     FROM config_fechas
     WHERE id_config = 1`
  );
  if (rs.rows[0]) {
    return {
      dias_vencimiento: parsePositiveInt(rs.rows[0].dias_vencimiento, LUZ_DIAS_VENCIMIENTO_DEFAULT),
      dias_corte: parsePositiveInt(rs.rows[0].dias_corte, LUZ_DIAS_CORTE_DEFAULT)
    };
  }
  await ensureDefaultsOnce();
  const retry = await db.query("SELECT dias_vencimiento, dias_corte FROM config_fechas WHERE id_config = 1");
  return {
    dias_vencimiento: parsePositiveInt(retry.rows[0]?.dias_vencimiento, LUZ_DIAS_VENCIMIENTO_DEFAULT),
    dias_corte: parsePositiveInt(retry.rows[0]?.dias_corte, LUZ_DIAS_CORTE_DEFAULT)
  };
};

const normalizeZoneName = (value) => normalizeText(value, 120).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const normalizeZoneKey = (value) => normalizeZoneName(value).replace(/[^A-Z0-9]/g, "");
const parseMedidorNumericValue = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return 0;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};
const splitCharcapeZoneName = (zoneName, medidorRaw) => {
  const key = normalizeZoneKey(zoneName);
  const isCharcapeLike = key === "CHARCAPE" || key === "AAHHCHARCAPE";
  if (!isCharcapeLike) return String(zoneName || "").trim();
  const medidorNum = parseMedidorNumericValue(medidorRaw);
  if (medidorNum >= 80 && medidorNum <= 158) return ZONA_AAHH_CHARCAPE;
  if (medidorNum >= 1 && medidorNum <= 83) return ZONA_CHARCAPE;
  return key === "AAHHCHARCAPE" ? ZONA_AAHH_CHARCAPE : ZONA_CHARCAPE;
};
const rejectIfLuzCajaInternaDisabled = (res) => {
  if (LUZ_CAJA_INTERNA_HABILITADA) return false;
  res.status(410).json({
    error: "Caja interna de Luz deshabilitada. Ventanilla Luz solo emite e imprime recibos; el cobro se realiza en sistema externo de caja."
  });
  return true;
};

const resolveZoneId = async (client, payload = {}) => {
  const idZona = parsePositiveInt(payload.id_zona, 0);
  if (idZona > 0) {
    const ex = await client.query("SELECT id_zona, nombre FROM zonas WHERE id_zona = $1", [idZona]);
    if (ex.rows[0]) return { id_zona: Number(ex.rows[0].id_zona), nombre: ex.rows[0].nombre };
  }
  const zoneNameRaw = normalizeZoneName(payload.zona_nombre || payload.nombre_zona || payload.zona);
  if (!zoneNameRaw) {
    throw new Error("ZONA_REQUERIDA");
  }
  const exByName = await client.query("SELECT id_zona, nombre FROM zonas WHERE UPPER(TRIM(nombre)) = $1 LIMIT 1", [zoneNameRaw]);
  if (exByName.rows[0]) {
    return { id_zona: Number(exByName.rows[0].id_zona), nombre: exByName.rows[0].nombre };
  }
  const inserted = await client.query(
    "INSERT INTO zonas (nombre, activo) VALUES ($1, TRUE) RETURNING id_zona, nombre",
    [zoneNameRaw]
  );
  return { id_zona: Number(inserted.rows[0].id_zona), nombre: inserted.rows[0].nombre };
};

const getNextUserIdByZone = async (client, idZona) => {
  const rs = await client.query(
    `SELECT COALESCE(
       MAX(
         CASE
           WHEN regexp_replace(COALESCE(nro_medidor, ''), '[^0-9]', '', 'g') <> ''
             THEN (regexp_replace(COALESCE(nro_medidor, ''), '[^0-9]', '', 'g'))::bigint
           ELSE 0
         END
       ),
       0
     ) AS max_id
     FROM suministros
     WHERE id_zona = $1`,
    [idZona]
  );
  const maxId = Number.parseInt(String(rs.rows?.[0]?.max_id ?? "0"), 10);
  const nextId = Number.isFinite(maxId) ? maxId + 1 : 1;
  return String(nextId);
};

const getLecturaAnterior = async (client, idSuministro, anio, mes) => {
  const exacta = await getLecturaMesAnteriorExacta(client, idSuministro, anio, mes);
  if (exacta.encontrada) return exacta.lectura_anterior;

  const prev = await client.query(
    `SELECT lectura_actual
     FROM recibos
     WHERE id_suministro = $1
       AND ((anio < $2) OR (anio = $2 AND mes < $3))
     ORDER BY anio DESC, mes DESC, id_recibo DESC
     LIMIT 1`,
    [idSuministro, anio, mes]
  );
  return parseMonto(prev.rows[0]?.lectura_actual, 0);
};

const getLecturaMesAnteriorExacta = async (client, idSuministro, anio, mes) => {
  const periodoAnterior = getPeriodoAnterior(anio, mes);
  if (!periodoAnterior) {
    return {
      encontrada: false,
      lectura_anterior: null,
      anio: null,
      mes: null
    };
  }

  const prev = await client.query(
    `SELECT lectura_actual
     FROM recibos
     WHERE id_suministro = $1
       AND anio = $2
       AND mes = $3
     ORDER BY id_recibo DESC
     LIMIT 1`,
    [idSuministro, periodoAnterior.anio, periodoAnterior.mes]
  );

  const encontrada = Boolean(prev.rows[0]);
  return {
    encontrada,
    lectura_anterior: encontrada ? round2(parseMonto(prev.rows[0].lectura_actual, 0)) : null,
    anio: periodoAnterior.anio,
    mes: periodoAnterior.mes
  };
};

const computeRecibo = ({ lecturaAnterior, lecturaActual, tarifaKwh, cargoFijo }) => {
  const lecturaAnt = round2(parseMonto(lecturaAnterior, 0));
  const lecturaAct = round2(parseMonto(lecturaActual, 0));
  if (lecturaAct < 0) {
    throw new Error("LECTURA_ACTUAL_INVALIDA");
  }
  // En luz municipal la lectura anterior funciona como referencia visual;
  // el cobro del mes se calcula con la lectura actual registrada.
  const consumo = lecturaAct;
  const tarifa = round2(parseMonto(tarifaKwh, LUZ_TARIFA_KWH_DEFAULT));
  const fijo = round2(parseMonto(cargoFijo, LUZ_CARGO_FIJO_DEFAULT));
  const energia = round2(consumo * tarifa);
  const total = round2(energia + fijo);
  return {
    lectura_anterior: lecturaAnt,
    lectura_actual: lecturaAct,
    consumo_kwh: consumo,
    tarifa_kwh: tarifa,
    energia_activa: energia,
    mantenimiento: fijo,
    total_pagar: total
  };
};

const parseOrderItems = (itemsRaw = []) => {
  if (!Array.isArray(itemsRaw)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of itemsRaw.slice(0, 150)) {
    const idRecibo = parsePositiveInt(raw?.id_recibo, 0);
    if (!idRecibo || seen.has(idRecibo)) continue;
    const monto = round2(parseMonto(raw?.monto_autorizado, 0));
    seen.add(idRecibo);
    out.push({
      id_recibo: idRecibo,
      monto_autorizado: monto > 0 ? monto : 0,
      anio: parsePositiveInt(raw?.anio, 0) || null,
      mes: parsePositiveInt(raw?.mes, 0) || null,
      consumo_kwh: round2(parseMonto(raw?.consumo_kwh, 0)),
      energia_activa: round2(parseMonto(raw?.energia_activa, 0)),
      mantenimiento: round2(parseMonto(raw?.mantenimiento, 0))
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

const cellText = (cell) => {
  const value = cell?.value;
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (value.richText) return value.richText.map((t) => t?.text || "").join("").trim();
  if (value.text) return String(value.text).trim();
  if (value.formula || value.sharedFormula) return String(value.result ?? "").trim();
  if (value.hyperlink) return String(value.text || value.hyperlink || "").trim();
  if (value.result !== undefined && value.result !== null) return String(value.result).trim();
  try {
    return JSON.stringify(value).trim();
  } catch {
    return "";
  }
};

const normHeader = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^A-Z0-9]/gi, "")
  .toUpperCase()
  .trim();

const toISODate = () => normalizeHoraPartes(new Date(), APP_TIMEZONE).iso;
const getCurrentPeriodoNum = () => {
  const { anio, mes } = normalizeHoraPartes(new Date(), APP_TIMEZONE);
  return (anio * 100) + mes;
};

router.use(async (req, res, next) => {
  try {
    await ensureDefaultsOnce();
    await ensureCharcapeSplitOnce();
    return next();
  } catch (err) {
    console.error("[LUZ] Error inicializando defaults:", err.message);
    return res.status(500).json({ error: "Error inicializando configuración de luz." });
  }
});

router.get("/health", (req, res) => {
  return res.json({ ok: true, sistema: "LUZ", ts: new Date().toISOString() });
});
router.post("/auth/registro", async (req, res) => {
  try {
    await pool.query("ALTER TABLE usuarios_sistema ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL");
    const username = normalizeText(req.body?.username, 120);
    const password = String(req.body?.password || "");
    const nombre = normalizeText(req.body?.nombre_completo, 180);
    if (!username || !password || !nombre) {
      return res.status(400).json({ error: "Username, contraseña y nombre son obligatorios." });
    }

    const ex = await pool.query("SELECT 1 FROM usuarios_sistema WHERE username = $1 LIMIT 1", [username]);
    if (ex.rows[0]) return res.status(400).json({ error: "Usuario ya existe" });

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO usuarios_sistema (username, password, password_visible, nombre_completo, rol, estado) VALUES ($1, $2, $3, $4, 'CONSULTA', 'PENDIENTE')",
      [username, hash, String(password || "").slice(0, 120), nombre]
    );
    await registrarAuditoria(null, username, "AUTH_REGISTRO", "Registro de usuario en sistema de luz (estado=PENDIENTE)");
    return res.json({ mensaje: "Solicitud enviada. Espera activación del administrador." });
  } catch (err) {
    console.error("[LUZ] Error registro:", err.message);
    return res.status(500).json({ error: "Error al registrar usuario." });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    await pool.query("ALTER TABLE usuarios_sistema ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL");
    cleanupLoginSecurityMaps();
    const username = normalizeText(req.body?.username, 120);
    const password = String(req.body?.password || "");
    if (!username || !password) {
      return res.status(400).json({ error: "Usuario y contraseña son obligatorios." });
    }
    const usernameKey = normalizeLoginUsername(username);
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

    const result = await pool.query("SELECT * FROM usuarios_sistema WHERE username = $1", [username]);
    if (!result.rows[0]) {
      registerLoginFailure(usernameKey);
      return res.status(400).json({ error: "Credenciales invalidas." });
    }

    const user = result.rows[0];
    const passwordVisible = String(password || "").slice(0, 120);
    let ok = false;
    if (String(user.password || "").startsWith("$2")) {
      ok = await bcrypt.compare(password, user.password);
      if (ok && !String(user.password_visible || "").trim()) {
        await pool.query(
          "UPDATE usuarios_sistema SET password_visible = $1 WHERE id_usuario = $2",
          [passwordVisible, user.id_usuario]
        );
      }
    } else {
      ok = String(user.password || "") === password;
      if (ok) {
        const nextHash = await bcrypt.hash(password, 10);
        await pool.query(
          "UPDATE usuarios_sistema SET password = $1, password_visible = $2 WHERE id_usuario = $3",
          [nextHash, passwordVisible, user.id_usuario]
        );
      }
    }
    if (!ok) {
      registerLoginFailure(usernameKey);
      return res.status(400).json({ error: "Credenciales invalidas." });
    }

    if (String(user.estado || "").toUpperCase() !== "ACTIVO") {
      registerLoginFailure(usernameKey);
      return res.status(403).json({ error: "Cuenta no activa." });
    }
    clearLoginFailure(usernameKey);
    const token = issueLuzToken(user);
    return res.json({
      token,
      id_usuario: Number(user.id_usuario),
      nombre: user.nombre_completo,
      rol: normalizeRole(user.rol),
      sistema: "LUZ"
    });
  } catch (err) {
    console.error("[LUZ] Error login:", err.message);
    return res.status(500).json({ error: "Error login." });
  }
});

router.post("/auth/cambiar-password", async (req, res) => {
  try {
    await pool.query("ALTER TABLE usuarios_sistema ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL");
    const username = normalizeText(req.body?.username, 120);
    const passwordActual = String(req.body?.password_actual || "");
    const passwordNuevo = String(req.body?.password_nuevo || "");
    if (!username || !passwordNuevo) {
      return res.status(400).json({ error: "Usuario y nueva contraseña son obligatorios." });
    }
    if (passwordNuevo.length < 8 || passwordNuevo.length > 120) {
      return res.status(400).json({ error: "Password invalido. Debe tener entre 8 y 120 caracteres." });
    }

    const userRs = await pool.query(
      "SELECT id_usuario, username, estado, password FROM usuarios_sistema WHERE username = $1 LIMIT 1",
      [username]
    );
    const user = userRs.rows[0];
    if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
    if (String(user.estado || "").toUpperCase() !== "ACTIVO") {
      return res.status(403).json({ error: "Cuenta no activa." });
    }

    if (passwordActual) {
      let ok = false;
      if (String(user.password || "").startsWith("$2")) {
        ok = await bcrypt.compare(passwordActual, String(user.password || ""));
      } else {
        ok = String(user.password || "") === passwordActual;
      }
      if (!ok) {
        return res.status(400).json({ error: "Password actual incorrecta." });
      }
      if (passwordActual === passwordNuevo) {
        return res.status(400).json({ error: "La nueva password debe ser diferente a la actual." });
      }
    }

    const nextHash = await bcrypt.hash(passwordNuevo, 10);
    await pool.query(
      "UPDATE usuarios_sistema SET password = $1, password_visible = $2 WHERE id_usuario = $3",
      [nextHash, String(passwordNuevo).slice(0, 120), Number(user.id_usuario)]
    );
    await registrarAuditoria(
      null,
      user.username,
      "AUTH_PASSWORD_CAMBIO",
      `id_usuario=${Number(user.id_usuario)}; username=${user.username}; via=${passwordActual ? "CON_PASSWORD_ACTUAL" : "SIN_PASSWORD_ACTUAL"}; ip=${getRequestIp(req)}`
    );
    return res.json({ mensaje: "Password actualizada correctamente." });
  } catch (err) {
    console.error("[LUZ] Error cambio password:", err.message);
    return res.status(500).json({ error: "Error cambiando password." });
  }
});

router.get("/admin/usuarios", authenticateLuzToken, requireRole("ADMIN"), async (req, res) => {
  try {
    await pool.query("ALTER TABLE usuarios_sistema ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL");
    const usuarios = await pool.query(
      `SELECT id_usuario, username, nombre_completo, rol, estado, COALESCE(password_visible, '') AS password_visible
       FROM usuarios_sistema
       ORDER BY
         CASE UPPER(TRIM(rol))
           WHEN 'ADMIN' THEN 1
           WHEN 'SUPERADMIN' THEN 1
           WHEN 'ADMIN_PRINCIPAL' THEN 1
           WHEN 'NIVEL_1' THEN 1
           WHEN 'ADMIN_SEC' THEN 2
           WHEN 'ADMIN_SECUNDARIO' THEN 2
           WHEN 'JEFE_CAJA' THEN 2
           WHEN 'NIVEL_2' THEN 2
           WHEN 'CAJERO' THEN 3
           WHEN 'OPERADOR_CAJA' THEN 3
           WHEN 'OPERADOR' THEN 3
           WHEN 'NIVEL_3' THEN 3
           WHEN 'CONSULTA' THEN 4
           WHEN 'LECTURA' THEN 4
           WHEN 'NIVEL_4' THEN 4
           ELSE 5
         END ASC,
         username ASC`
    );
    return res.json(usuarios.rows.map((u) => {
      const rol = normalizeRole(u.rol);
      const estado = normalizeEstadoUsuario(u.estado) || "PENDIENTE";
      return {
        id_usuario: Number(u.id_usuario),
        username: u.username,
        nombre_completo: u.nombre_completo,
        rol,
        rol_label: ROLE_LABELS[rol] || rol,
        estado,
        password_visible: String(u.password_visible || "")
      };
    }));
  } catch (err) {
    console.error("[LUZ] Error listando usuarios admin:", err.message);
    return res.status(500).json({ error: "Error listando usuarios del sistema." });
  }
});

router.post("/admin/usuarios", authenticateLuzToken, requireRole("ADMIN"), async (req, res) => {
  try {
    await pool.query("ALTER TABLE usuarios_sistema ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL");
    const username = normalizeText(req.body?.username, 120);
    const nombreCompleto = normalizeText(req.body?.nombre_completo, 180);
    const password = String(req.body?.password || "");
    const rol = normalizeRole(req.body?.rol || "CONSULTA");
    const estado = normalizeEstadoUsuario(req.body?.estado || "ACTIVO") || "ACTIVO";

    if (!username || username.length < 3) {
      return res.status(400).json({ error: "Username inválido. Mínimo 3 caracteres." });
    }
    if (!nombreCompleto || nombreCompleto.length < 5) {
      return res.status(400).json({ error: "Nombre completo inválido. Mínimo 5 caracteres." });
    }
    if (password.length < 8 || password.length > 120) {
      return res.status(400).json({ error: "Contraseña inválida. Debe tener entre 8 y 120 caracteres." });
    }
    if (!isKnownRoleValue(rol)) {
      return res.status(400).json({ error: "Rol inválido." });
    }
    if (!USER_STATUS_ALLOWED.has(estado)) {
      return res.status(400).json({ error: "Estado inválido." });
    }

    const existe = await pool.query("SELECT 1 FROM usuarios_sistema WHERE UPPER(TRIM(username)) = UPPER(TRIM($1)) LIMIT 1", [username]);
    if (existe.rows[0]) {
      return res.status(409).json({ error: "Ya existe un usuario con ese username." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const created = await pool.query(
      `INSERT INTO usuarios_sistema (username, password, password_visible, nombre_completo, rol, estado)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id_usuario, username, nombre_completo, rol, estado, COALESCE(password_visible, '') AS password_visible`,
      [username, passwordHash, String(password || "").slice(0, 120), nombreCompleto, rol, estado]
    );
    const usuario = created.rows[0];
    const rolNormalizado = normalizeRole(usuario.rol);

    await registrarAuditoria(
      null,
      req.user?.username,
      "ADMIN_LUZ_USUARIO_CREADO",
      `id_usuario=${usuario.id_usuario}; username=${usuario.username}; rol=${rolNormalizado}; estado=${usuario.estado}`
    );
    return res.status(201).json({
      mensaje: "Usuario creado.",
      usuario: {
        id_usuario: Number(usuario.id_usuario),
        username: usuario.username,
        nombre_completo: usuario.nombre_completo,
        rol: rolNormalizado,
        rol_label: ROLE_LABELS[rolNormalizado] || rolNormalizado,
        estado: normalizeEstadoUsuario(usuario.estado) || "PENDIENTE",
        password_visible: String(usuario.password_visible || "")
      }
    });
  } catch (err) {
    console.error("[LUZ] Error creando usuario admin:", err.message);
    return res.status(500).json({ error: "Error creando usuario del sistema." });
  }
});

router.put("/admin/usuarios/:id", authenticateLuzToken, requireRole("ADMIN"), async (req, res) => {
  try {
    await pool.query("ALTER TABLE usuarios_sistema ADD COLUMN IF NOT EXISTS password_visible VARCHAR(120) NULL");
    const targetId = parsePositiveInt(req.params?.id, 0);
    if (!targetId) return res.status(400).json({ error: "ID inválido." });

    const updateParts = [];
    const params = [];
    let index = 1;
    let nuevoRol = null;
    let nuevoEstado = null;

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "rol")) {
      if (!isKnownRoleValue(req.body.rol)) {
        return res.status(400).json({ error: "Rol inválido." });
      }
      nuevoRol = normalizeRole(req.body.rol);
      updateParts.push(`rol = $${index++}`);
      params.push(nuevoRol);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "estado")) {
      nuevoEstado = normalizeEstadoUsuario(req.body.estado);
      if (!nuevoEstado) {
        return res.status(400).json({ error: "Estado inválido." });
      }
      updateParts.push(`estado = $${index++}`);
      params.push(nuevoEstado);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "password")) {
      const nuevaPassword = String(req.body.password || "");
      if (nuevaPassword.length < 8 || nuevaPassword.length > 120) {
        return res.status(400).json({ error: "Contraseña inválida. Debe tener entre 8 y 120 caracteres." });
      }
      const hash = await bcrypt.hash(nuevaPassword, 10);
      updateParts.push(`password = $${index++}`);
      params.push(hash);
      updateParts.push(`password_visible = $${index++}`);
      params.push(String(nuevaPassword).slice(0, 120));
    }

    if (updateParts.length === 0) {
      return res.status(400).json({ error: "No hay campos para actualizar." });
    }

    if (Number(req.user?.id_usuario || 0) === targetId) {
      if (nuevoEstado && nuevoEstado !== "ACTIVO") {
        return res.status(400).json({ error: "No puedes bloquearte a ti mismo." });
      }
      if (nuevoRol && nuevoRol !== "ADMIN") {
        return res.status(400).json({ error: "No puedes quitarte el nivel 1 a ti mismo." });
      }
    }

    params.push(targetId);
    const updated = await pool.query(
      `UPDATE usuarios_sistema
       SET ${updateParts.join(", ")}
       WHERE id_usuario = $${index}
       RETURNING id_usuario, username, nombre_completo, rol, estado, COALESCE(password_visible, '') AS password_visible`,
      params
    );
    if (!updated.rows[0]) return res.status(404).json({ error: "Usuario no encontrado." });

    const user = updated.rows[0];
    const rolNormalizado = normalizeRole(user.rol);
    await registrarAuditoria(
      null,
      req.user?.username,
      "ADMIN_LUZ_USUARIO_ACTUALIZADO",
      `id_usuario=${user.id_usuario}; campos=${updateParts.map((p) => p.split("=")[0].trim()).join(",")}`
    );
    return res.json({
      mensaje: "Usuario actualizado.",
      usuario: {
        id_usuario: Number(user.id_usuario),
        username: user.username,
        nombre_completo: user.nombre_completo,
        rol: rolNormalizado,
        rol_label: ROLE_LABELS[rolNormalizado] || rolNormalizado,
        estado: normalizeEstadoUsuario(user.estado) || "PENDIENTE",
        password_visible: String(user.password_visible || "")
      }
    });
  } catch (err) {
    console.error("[LUZ] Error actualizando usuario admin:", err.message);
    return res.status(500).json({ error: "Error actualizando usuario del sistema." });
  }
});

router.delete("/admin/usuarios/:id", authenticateLuzToken, requireRole("ADMIN"), async (req, res) => {
  try {
    const targetId = parsePositiveInt(req.params?.id, 0);
    if (!targetId) return res.status(400).json({ error: "ID inválido." });
    if (Number(req.user?.id_usuario || 0) === targetId) {
      return res.status(400).json({ error: "No puedes eliminar tu propio usuario." });
    }

    const actual = await pool.query(
      "SELECT id_usuario, username, rol FROM usuarios_sistema WHERE id_usuario = $1",
      [targetId]
    );
    if (!actual.rows[0]) return res.status(404).json({ error: "Usuario no encontrado." });

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
    await registrarAuditoria(
      null,
      req.user?.username,
      "ADMIN_LUZ_USUARIO_ELIMINADO",
      `id_usuario=${targetId}; username=${actual.rows[0].username}; rol=${rolTarget}`
    );
    return res.json({ mensaje: "Usuario eliminado." });
  } catch (err) {
    console.error("[LUZ] Error eliminando usuario admin:", err.message);
    return res.status(500).json({ error: "Error eliminando usuario del sistema." });
  }
});

router.get("/campo/suministros", authenticateLuzToken, requireRole("BRIGADA"), async (req, res) => {
  try {
    const q = normalizeText(req.query?.q || req.query?.buscar || "", 120).toUpperCase();
    const idZona = parsePositiveInt(req.query?.id_zona, 0);
    const limitRaw = parsePositiveInt(req.query?.limit, 180);
    const limit = Math.min(Math.max(limitRaw, 1), 500);
    const params = [];
    const where = [];

    if (idZona > 0) {
      params.push(idZona);
      where.push(`s.id_zona = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        UPPER(COALESCE(s.nro_medidor, '')) LIKE $${params.length}
        OR UPPER(COALESCE(s.nombre_usuario, '')) LIKE $${params.length}
        OR UPPER(COALESCE(z.nombre, '')) LIKE $${params.length}
      )`);
    }

    params.push(limit);
    const rows = await pool.query(
      `
      SELECT
        s.id_suministro,
        s.nro_medidor,
        s.nombre_usuario,
        z.nombre AS zona,
        cv.creado_en AS ultima_visita_en,
        cv.tipo_visita AS ultima_visita_tipo,
        cv.lectura_actual AS ultima_lectura
      FROM suministros s
      JOIN zonas z ON z.id_zona = s.id_zona
      LEFT JOIN LATERAL (
        SELECT c.creado_en, c.tipo_visita, c.lectura_actual
        FROM campo_visitas c
        WHERE c.id_suministro = s.id_suministro
        ORDER BY c.creado_en DESC, c.id_visita DESC
        LIMIT 1
      ) cv ON TRUE
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY
        CASE
          WHEN regexp_replace(COALESCE(s.nro_medidor, ''), '[^0-9]', '', 'g') <> '' THEN 0
          ELSE 1
        END ASC,
        CASE
          WHEN regexp_replace(COALESCE(s.nro_medidor, ''), '[^0-9]', '', 'g') <> ''
            THEN NULLIF(regexp_replace(COALESCE(s.nro_medidor, ''), '[^0-9]', '', 'g'), '')::numeric
          ELSE NULL
        END ASC NULLS LAST,
        UPPER(COALESCE(s.nro_medidor, '')) ASC,
        UPPER(COALESCE(s.nombre_usuario, '')) ASC
      LIMIT $${params.length}
      `,
      params
    );

    return res.json(rows.rows.map((r) => {
      const zonaSeparada = splitCharcapeZoneName(r.zona, r.nro_medidor);
      const ultimaVisitaTipo = String(r.ultima_visita_tipo || "").trim().toUpperCase();
      return {
        id_suministro: Number(r.id_suministro),
        id_contribuyente: String(r.nro_medidor || "").trim(),
        nro_medidor: String(r.nro_medidor || "").trim(),
        nombre_completo: String(r.nombre_usuario || "").trim(),
        zona: zonaSeparada || r.zona,
        ultima_visita_en: r.ultima_visita_en || null,
        ultima_visita_tipo: ultimaVisitaTipo || null,
        ultima_lectura: r.ultima_lectura === null || r.ultima_lectura === undefined
          ? null
          : round2(parseMonto(r.ultima_lectura, 0))
      };
    }));
  } catch (err) {
    console.error("[LUZ] Error listando campo/suministros:", err.message);
    return res.status(500).json({ error: "Error listando suministros para campo." });
  }
});

router.post("/campo/visitas", authenticateLuzToken, requireRole("BRIGADA"), async (req, res) => {
  const client = await pool.connect();
  try {
    const idSuministro = parsePositiveInt(req.body?.id_suministro, 0);
    const tipoVisitaRaw = String(req.body?.tipo_visita || CAMPO_TIPO_VISITA.CORROBORAR_MEDIDOR).trim().toUpperCase();
    const tipoVisita = tipoVisitaRaw === CAMPO_TIPO_VISITA.VISITA_MENSUAL
      ? CAMPO_TIPO_VISITA.VISITA_MENSUAL
      : CAMPO_TIPO_VISITA.CORROBORAR_MEDIDOR;
    const nroMedidorReportado = normalizeText(req.body?.nro_medidor_reportado || req.body?.id_contribuyente || "", 80);
    const fotoMedidor = String(req.body?.foto_medidor_base64 || "").trim();
    const observacion = normalizeText(req.body?.observacion || req.body?.observacion_campo || "", 1200) || null;
    const inspector = normalizeText(req.body?.inspector || req.user?.nombre || req.user?.username || "", 120) || null;
    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};
    const lecturaActualRaw = req.body?.lectura_actual;
    const lecturaActualParsed = round2(parseMonto(lecturaActualRaw, NaN));
    const lecturaActual = Number.isFinite(lecturaActualParsed) ? lecturaActualParsed : null;

    if (!idSuministro) return res.status(400).json({ error: "Suministro inválido." });
    if (!nroMedidorReportado) return res.status(400).json({ error: "Debe registrar el ID/medidor observado." });
    if (!fotoMedidor || !/^data:image\//i.test(fotoMedidor)) {
      return res.status(400).json({ error: "Debe adjuntar foto válida del medidor." });
    }
    if (fotoMedidor.length > 2200000) {
      return res.status(413).json({ error: "La foto es demasiado grande. Intente con menor resolución." });
    }
    if (tipoVisita === CAMPO_TIPO_VISITA.VISITA_MENSUAL && (lecturaActual === null || lecturaActual < 0)) {
      return res.status(400).json({ error: "Para visita mensual debe registrar lectura actual válida." });
    }

    await client.query("BEGIN");
    const suministro = await client.query(
      `SELECT s.id_suministro, s.nro_medidor, s.nombre_usuario, z.nombre AS zona
       FROM suministros s
       JOIN zonas z ON z.id_zona = s.id_zona
       WHERE s.id_suministro = $1
       LIMIT 1`,
      [idSuministro]
    );
    if (!suministro.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Suministro no encontrado." });
    }

    const ins = await client.query(
      `INSERT INTO campo_visitas (
         id_suministro, id_usuario_registra, tipo_visita, nro_medidor_reportado,
         lectura_actual, foto_medidor_base64, observacion, inspector, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id_visita, creado_en`,
      [
        idSuministro,
        Number(req.user?.id_usuario || 0) || null,
        tipoVisita,
        nroMedidorReportado,
        tipoVisita === CAMPO_TIPO_VISITA.VISITA_MENSUAL ? lecturaActual : null,
        fotoMedidor,
        observacion,
        inspector,
        JSON.stringify(metadata || {})
      ]
    );

    const zonaSeparada = splitCharcapeZoneName(suministro.rows[0].zona, suministro.rows[0].nro_medidor);
    await registrarAuditoria(
      client,
      req.user?.username,
      "CAMPO_LUZ_VISITA_REGISTRADA",
      `id_visita=${ins.rows[0].id_visita}; id_suministro=${idSuministro}; tipo=${tipoVisita}; medidor=${nroMedidorReportado}`
    );
    await client.query("COMMIT");

    return res.json({
      mensaje: tipoVisita === CAMPO_TIPO_VISITA.CORROBORAR_MEDIDOR
        ? "Corroboracion de medidor registrada."
        : "Visita mensual registrada.",
      visita: {
        id_visita: Number(ins.rows[0].id_visita),
        creado_en: ins.rows[0].creado_en,
        tipo_visita: tipoVisita,
        id_suministro: idSuministro,
        id_contribuyente: String(suministro.rows[0].nro_medidor || "").trim(),
        nro_medidor_reportado: nroMedidorReportado,
        lectura_actual: tipoVisita === CAMPO_TIPO_VISITA.VISITA_MENSUAL ? lecturaActual : null,
        inspector,
        observacion
      },
      suministro: {
        id_suministro: idSuministro,
        id_contribuyente: String(suministro.rows[0].nro_medidor || "").trim(),
        nombre_completo: String(suministro.rows[0].nombre_usuario || "").trim(),
        zona: zonaSeparada || suministro.rows[0].zona
      }
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[LUZ] Error registrando campo/visita:", err.message);
    return res.status(500).json({ error: "Error registrando visita de campo." });
  } finally {
    client.release();
  }
});

router.get("/zonas", authenticateLuzToken, requireRole("BRIGADA"), async (req, res) => {
  try {
    const rows = await pool.query(
      `SELECT z.id_zona, z.nombre, z.activo,
              COUNT(s.id_suministro)::int AS total_suministros
       FROM zonas z
       LEFT JOIN suministros s ON s.id_zona = z.id_zona
       GROUP BY z.id_zona, z.nombre, z.activo
       ORDER BY z.nombre ASC`
    );
    return res.json(rows.rows.map((r) => ({
      id_zona: Number(r.id_zona),
      nombre: r.nombre,
      activo: Boolean(r.activo),
      total_suministros: Number(r.total_suministros || 0)
    })));
  } catch (err) {
    console.error("[LUZ] Error zonas:", err.message);
    return res.status(500).json({ error: "Error listando zonas." });
  }
});

router.get("/auditoria", authenticateLuzToken, requireRole("ADMIN_SEC"), async (req, res) => {
  try {
    const q = normalizeText(req.query?.q || "", 160).toUpperCase();
    const accion = normalizeText(req.query?.accion || "", 120).toUpperCase();
    const limitRaw = parsePositiveInt(req.query?.limit, 250);
    const limit = Math.min(Math.max(limitRaw, 1), 1000);

    const params = [];
    const where = [];

    if (accion) {
      params.push(accion);
      where.push(`UPPER(a.accion) = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        UPPER(COALESCE(a.usuario, '')) LIKE $${params.length}
        OR UPPER(COALESCE(a.accion, '')) LIKE $${params.length}
        OR UPPER(COALESCE(a.detalle, '')) LIKE $${params.length}
      )`);
    }

    params.push(limit);
    const rows = await pool.query(
      `SELECT a.id_auditoria, a.fecha, a.usuario, a.accion, a.detalle
       FROM auditoria a
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.fecha DESC, a.id_auditoria DESC
       LIMIT $${params.length}`,
      params
    );

    return res.json(rows.rows.map((r) => ({
      id_auditoria: Number(r.id_auditoria),
      fecha: r.fecha,
      usuario: r.usuario || null,
      accion: r.accion,
      detalle: r.detalle || null
    })));
  } catch (err) {
    console.error("[LUZ] Error listando auditoria:", err.message);
    return res.status(500).json({ error: "Error listando auditoria." });
  }
});

router.get("/suministros", authenticateLuzToken, requireRole("CONSULTA"), async (req, res) => {
  try {
    const q = normalizeText(req.query?.q || req.query?.buscar || "", 120).toUpperCase();
    const idZona = parsePositiveInt(req.query?.id_zona, 0);
    const estado = normalizeText(req.query?.estado || "", 20).toUpperCase();

    const params = [];
    const where = [];

    if (idZona > 0) {
      params.push(idZona);
      where.push(`s.id_zona = $${params.length}`);
    }
    if (estado && ["ACTIVO", "CORTADO", "INACTIVO"].includes(estado)) {
      params.push(estado);
      where.push(`s.estado = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        UPPER(s.nombre_usuario) LIKE $${params.length}
        OR UPPER(s.nro_medidor) LIKE $${params.length}
        OR UPPER(COALESCE(s.nro_medidor_real, '')) LIKE $${params.length}
        OR UPPER(COALESCE(s.direccion, '')) LIKE $${params.length}
        OR UPPER(z.nombre) LIKE $${params.length}
      )`);
    }

    const sql = `
      WITH pagos_agg AS (
        SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
        FROM pagos
        GROUP BY id_recibo
      ),
      resumen AS (
        SELECT
          r.id_suministro,
          SUM(GREATEST(r.total_pagar - COALESCE(p.total_pagado, 0), 0)) AS deuda_total,
          SUM(COALESCE(p.total_pagado, 0)) AS abono_total,
          COUNT(*) FILTER (WHERE (r.total_pagar - COALESCE(p.total_pagado, 0)) > 0) AS meses_deuda
        FROM recibos r
        LEFT JOIN pagos_agg p ON p.id_recibo = r.id_recibo
        GROUP BY r.id_suministro
      )
      SELECT
        s.id_suministro,
        s.id_zona,
        z.nombre AS zona,
        s.nro_medidor,
        s.nro_medidor_real,
        s.nombre_usuario,
        s.direccion,
        s.estado,
        s.creado_en,
        s.actualizado_en,
        COALESCE(rs.deuda_total, 0) AS deuda_total,
        COALESCE(rs.abono_total, 0) AS abono_total,
        COALESCE(rs.meses_deuda, 0)::int AS meses_deuda
      FROM suministros s
      JOIN zonas z ON z.id_zona = s.id_zona
      LEFT JOIN resumen rs ON rs.id_suministro = s.id_suministro
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY
        CASE
          WHEN regexp_replace(COALESCE(s.nro_medidor, ''), '[^0-9]', '', 'g') <> '' THEN 0
          ELSE 1
        END ASC,
        CASE
          WHEN regexp_replace(COALESCE(s.nro_medidor, ''), '[^0-9]', '', 'g') <> ''
            THEN NULLIF(regexp_replace(COALESCE(s.nro_medidor, ''), '[^0-9]', '', 'g'), '')::numeric
          ELSE NULL
        END ASC NULLS LAST,
        UPPER(COALESCE(s.nro_medidor, '')) ASC,
        UPPER(z.nombre) ASC,
        UPPER(s.nombre_usuario) ASC
      LIMIT 1500
    `;

    const data = await pool.query(sql, params);
    return res.json(data.rows.map((r) => ({
      id_suministro: Number(r.id_suministro),
      id_zona: Number(r.id_zona),
      zona: splitCharcapeZoneName(r.zona, r.nro_medidor) || r.zona,
      nro_medidor: r.nro_medidor,
      nro_medidor_real: r.nro_medidor_real || "",
      nombre_usuario: r.nombre_usuario,
      direccion: r.direccion || "",
      estado: r.estado,
      deuda_total: round2(parseMonto(r.deuda_total, 0)),
      abono_total: round2(parseMonto(r.abono_total, 0)),
      meses_deuda: Number(r.meses_deuda || 0)
    })));
  } catch (err) {
    console.error("[LUZ] Error listando suministros:", err.message);
    return res.status(500).json({ error: "Error listando suministros." });
  }
});

router.post("/suministros", authenticateLuzToken, requireRole("ADMIN_SEC"), async (req, res) => {
  const client = await pool.connect();
  try {
    const nroMedidorReal = normalizeText(req.body?.nro_medidor_real || req.body?.medidor_real, 80) || null;
    const nombreUsuario = normalizeText(req.body?.nombre_usuario, 220);
    const direccion = normalizeText(req.body?.direccion, 300) || null;
    const estado = normalizeEstadoSuministro(req.body?.estado);

    if (!nombreUsuario) {
      return res.status(400).json({ error: "Nombre de usuario es obligatorio." });
    }

    await client.query("BEGIN");
    const zona = await resolveZoneId(client, req.body || {});
    const nroMedidor = await getNextUserIdByZone(client, zona.id_zona);
    const direccionFinal = direccion || nroMedidor;

    const inserted = await client.query(
      `INSERT INTO suministros (id_zona, nro_medidor, nro_medidor_real, nombre_usuario, direccion, estado)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id_suministro, id_zona, nro_medidor, nro_medidor_real, nombre_usuario, direccion, estado`,
      [zona.id_zona, nroMedidor, nroMedidorReal, nombreUsuario, direccionFinal, estado]
    );

    await registrarAuditoria(client, req.user?.username, "SUMINISTRO_CREAR", `id=${inserted.rows[0].id_suministro}; zona=${zona.nombre}; id_usuario=${nroMedidor}; medidor_real=${nroMedidorReal || "-"}`);
    await client.query("COMMIT");

    return res.json({
      mensaje: "Suministro registrado.",
      suministro: {
        ...inserted.rows[0],
        id_suministro: Number(inserted.rows[0].id_suministro),
        id_zona: Number(inserted.rows[0].id_zona),
        zona: zona.nombre
      }
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe un suministro con ese medidor en la zona indicada." });
    }
    if (err.message === "ZONA_REQUERIDA") {
      return res.status(400).json({ error: "Debe indicar zona (id o nombre)." });
    }
    console.error("[LUZ] Error creando suministro:", err.message);
    return res.status(500).json({ error: "Error creando suministro." });
  } finally {
    client.release();
  }
});

router.put("/suministros/:id", authenticateLuzToken, requireRole("ADMIN_SEC"), async (req, res) => {
  const client = await pool.connect();
  try {
    const idSuministro = parsePositiveInt(req.params?.id, 0);
    if (!idSuministro) return res.status(400).json({ error: "ID inválido." });

    const nroMedidor = normalizeText(req.body?.nro_medidor, 80);
    const nroMedidorReal = normalizeText(req.body?.nro_medidor_real || req.body?.medidor_real, 80) || null;
    const nombreUsuario = normalizeText(req.body?.nombre_usuario, 220);
    const direccion = normalizeText(req.body?.direccion, 300) || null;
    const estado = normalizeEstadoSuministro(req.body?.estado);

    if (!nroMedidor || !nombreUsuario) {
      return res.status(400).json({ error: "Nro medidor y nombre son obligatorios." });
    }

    await client.query("BEGIN");
    const zona = await resolveZoneId(client, req.body || {});

    const updated = await client.query(
      `UPDATE suministros
       SET id_zona = $1,
           nro_medidor = $2,
           nro_medidor_real = $3,
           nombre_usuario = $4,
           direccion = $5,
           estado = $6,
           actualizado_en = NOW()
       WHERE id_suministro = $7
       RETURNING id_suministro, id_zona, nro_medidor, nro_medidor_real, nombre_usuario, direccion, estado`,
      [zona.id_zona, nroMedidor, nroMedidorReal, nombreUsuario, direccion, estado, idSuministro]
    );

    if (!updated.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Suministro no encontrado." });
    }

    await registrarAuditoria(client, req.user?.username, "SUMINISTRO_EDITAR", `id=${idSuministro}; zona=${zona.nombre}; id_usuario=${nroMedidor}; medidor_real=${nroMedidorReal || "-"}`);
    await client.query("COMMIT");

    return res.json({
      mensaje: "Suministro actualizado.",
      suministro: {
        ...updated.rows[0],
        id_suministro: Number(updated.rows[0].id_suministro),
        id_zona: Number(updated.rows[0].id_zona),
        zona: zona.nombre
      }
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe un suministro con ese medidor en la zona indicada." });
    }
    if (err.message === "ZONA_REQUERIDA") {
      return res.status(400).json({ error: "Debe indicar zona (id o nombre)." });
    }
    console.error("[LUZ] Error actualizando suministro:", err.message);
    return res.status(500).json({ error: "Error actualizando suministro." });
  } finally {
    client.release();
  }
});

router.delete("/suministros/:id", authenticateLuzToken, requireRole("ADMIN"), async (req, res) => {
  const client = await pool.connect();
  try {
    const idSuministro = parsePositiveInt(req.params?.id, 0);
    if (!idSuministro) return res.status(400).json({ error: "ID inválido." });

    await client.query("BEGIN");

    const recs = await client.query("SELECT id_recibo FROM recibos WHERE id_suministro = $1", [idSuministro]);
    const idsRecibos = recs.rows.map((r) => Number(r.id_recibo)).filter((v) => Number.isInteger(v) && v > 0);
    if (idsRecibos.length > 0) {
      await client.query("DELETE FROM pagos WHERE id_recibo = ANY($1::bigint[])", [idsRecibos]);
    }
    await client.query("DELETE FROM ordenes_cobro WHERE id_suministro = $1", [idSuministro]);
    await client.query("DELETE FROM recibos WHERE id_suministro = $1", [idSuministro]);
    const deleted = await client.query("DELETE FROM suministros WHERE id_suministro = $1 RETURNING id_suministro", [idSuministro]);

    if (!deleted.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Suministro no encontrado." });
    }

    await registrarAuditoria(client, req.user?.username, "SUMINISTRO_ELIMINAR", `id=${idSuministro}`);
    await client.query("COMMIT");
    return res.json({ mensaje: "Suministro eliminado." });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[LUZ] Error eliminando suministro:", err.message);
    return res.status(500).json({ error: "Error eliminando suministro." });
  } finally {
    client.release();
  }
});

router.get("/config/tarifas", authenticateLuzToken, requireRole("CONSULTA"), async (req, res) => {
  try {
    const tarifa = await getTarifaActiva(pool);
    return res.json({
      tarifa_kwh: round2(tarifa.tarifa_kwh),
      cargo_fijo: round2(tarifa.cargo_fijo)
    });
  } catch (err) {
    console.error("[LUZ] Error obteniendo tarifas:", err.message);
    return res.status(500).json({ error: "Error obteniendo tarifas." });
  }
});

router.put("/config/tarifas", authenticateLuzToken, requireRole("ADMIN_SEC"), async (req, res) => {
  const client = await pool.connect();
  try {
    const tarifaKwh = round2(parseMonto(req.body?.tarifa_kwh, -1));
    const cargoFijo = round2(parseMonto(req.body?.cargo_fijo, -1));
    if (tarifaKwh < 0 || cargoFijo < 0) {
      return res.status(400).json({ error: "Tarifas inválidas." });
    }

    await client.query("BEGIN");
    await client.query("UPDATE tarifas_config SET activo = FALSE WHERE activo = TRUE");
    await client.query(
      `INSERT INTO tarifas_config (tarifa_kwh, cargo_fijo, activo, creado_por)
       VALUES ($1, $2, TRUE, $3)`,
      [tarifaKwh, cargoFijo, req.user?.username || "SISTEMA"]
    );
    await registrarAuditoria(client, req.user?.username, "CONFIG_TARIFAS", `tarifa_kwh=${tarifaKwh}; cargo_fijo=${cargoFijo}`);
    await client.query("COMMIT");

    return res.json({ mensaje: "Tarifas actualizadas.", tarifa_kwh: tarifaKwh, cargo_fijo: cargoFijo });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[LUZ] Error actualizando tarifas:", err.message);
    return res.status(500).json({ error: "Error actualizando tarifas." });
  } finally {
    client.release();
  }
});

router.get("/config/fechas", authenticateLuzToken, requireRole("CONSULTA"), async (req, res) => {
  try {
    const cfg = await getConfigFechas(pool);
    return res.json(cfg);
  } catch (err) {
    console.error("[LUZ] Error obteniendo configuración de fechas:", err.message);
    return res.status(500).json({ error: "Error obteniendo configuración de fechas." });
  }
});

router.put("/config/fechas", authenticateLuzToken, requireRole("ADMIN_SEC"), async (req, res) => {
  const client = await pool.connect();
  try {
    const diasVenc = Math.max(0, Math.min(90, parsePositiveInt(req.body?.dias_vencimiento, LUZ_DIAS_VENCIMIENTO_DEFAULT)));
    const diasCorte = Math.max(diasVenc, Math.min(120, parsePositiveInt(req.body?.dias_corte, LUZ_DIAS_CORTE_DEFAULT)));

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO config_fechas (id_config, dias_vencimiento, dias_corte, actualizado_en, actualizado_por)
       VALUES (1, $1, $2, NOW(), $3)
       ON CONFLICT (id_config)
       DO UPDATE SET dias_vencimiento = EXCLUDED.dias_vencimiento,
                     dias_corte = EXCLUDED.dias_corte,
                     actualizado_en = NOW(),
                     actualizado_por = EXCLUDED.actualizado_por`,
      [diasVenc, diasCorte, req.user?.username || "SISTEMA"]
    );
    await registrarAuditoria(client, req.user?.username, "CONFIG_FECHAS", `dias_vencimiento=${diasVenc}; dias_corte=${diasCorte}`);
    await client.query("COMMIT");

    return res.json({ mensaje: "Configuración de fechas actualizada.", dias_vencimiento: diasVenc, dias_corte: diasCorte });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[LUZ] Error actualizando configuración de fechas:", err.message);
    return res.status(500).json({ error: "Error actualizando configuración de fechas." });
  } finally {
    client.release();
  }
});

const insertRecibo = async (client, payload = {}, usuario = "SISTEMA") => {
  const idSuministro = parsePositiveInt(payload.id_suministro, 0);
  const anio = parsePositiveInt(payload.anio, 0);
  const mes = parsePositiveInt(payload.mes, 0);
  const observacion = normalizeText(payload.observacion, 500) || null;

  if (!idSuministro || !anio || mes < 1 || mes > 12) {
    throw new Error("DATOS_RECIBO_INVALIDOS");
  }
  if ((anio * 100) + mes > getCurrentPeriodoNum()) {
    throw new Error("PERIODO_FUTURO_NO_PERMITIDO");
  }

  const suministro = await client.query(
    `SELECT s.id_suministro, s.estado, s.nro_medidor, s.nombre_usuario, z.nombre AS zona
     FROM suministros s
     JOIN zonas z ON z.id_zona = s.id_zona
     WHERE s.id_suministro = $1
     LIMIT 1`,
    [idSuministro]
  );
  if (!suministro.rows[0]) throw new Error("SUMINISTRO_NO_ENCONTRADO");
  if (suministro.rows[0].estado === "INACTIVO") throw new Error("SUMINISTRO_INACTIVO");

  const tarifa = await getTarifaActiva(client);
  const cfgFechas = await getConfigFechas(client);

  const lecturaAnteriorInput = parseMonto(payload.lectura_anterior, NaN);
  const lecturaAnterior = Number.isFinite(lecturaAnteriorInput)
    ? round2(lecturaAnteriorInput)
    : round2(await getLecturaAnterior(client, idSuministro, anio, mes));

  const lecturaActual = round2(parseMonto(payload.lectura_actual, NaN));
  if (!Number.isFinite(lecturaActual)) {
    throw new Error("LECTURA_ACTUAL_REQUERIDA");
  }

  const calculado = computeRecibo({
    lecturaAnterior,
    lecturaActual,
    tarifaKwh: tarifa.tarifa_kwh,
    cargoFijo: tarifa.cargo_fijo
  });

  const fechaEmision = normalizeText(payload.fecha_emision, 12) || toISODate();
  const fechaVenc = normalizeText(payload.fecha_vencimiento, 12) || addDaysIso(fechaEmision, cfgFechas.dias_vencimiento);
  const fechaCorte = normalizeText(payload.fecha_corte, 12) || addDaysIso(fechaEmision, cfgFechas.dias_corte);

  const inserted = await client.query(
    `INSERT INTO recibos (
      id_suministro, anio, mes,
      lectura_anterior, lectura_actual, consumo_kwh,
      tarifa_kwh, energia_activa, mantenimiento, total_pagar,
      fecha_emision, fecha_vencimiento, fecha_corte, estado, observacion
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, 'PENDIENTE', $14
    )
    RETURNING *`,
    [
      idSuministro,
      anio,
      mes,
      calculado.lectura_anterior,
      calculado.lectura_actual,
      calculado.consumo_kwh,
      calculado.tarifa_kwh,
      calculado.energia_activa,
      calculado.mantenimiento,
      calculado.total_pagar,
      fechaEmision,
      fechaVenc,
      fechaCorte,
      observacion
    ]
  );

  await registrarAuditoria(
    client,
    usuario,
    "RECIBO_LUZ_GENERADO",
    `id_recibo=${inserted.rows[0].id_recibo}; suministro=${idSuministro}; periodo=${anio}-${String(mes).padStart(2, "0")}; total=${calculado.total_pagar.toFixed(2)}`
  );

  return {
    recibo: inserted.rows[0],
    suministro: suministro.rows[0]
  };
};
router.post("/recibos", authenticateLuzToken, requireRole("ADMIN_SEC"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const data = await insertRecibo(client, req.body || {}, req.user?.username || "SISTEMA");
    await client.query("COMMIT");

    return res.json({
      mensaje: "Recibo generado.",
      recibo: data.recibo,
      suministro: {
        id_suministro: Number(data.suministro.id_suministro),
        nombre_usuario: data.suministro.nombre_usuario,
        nro_medidor: data.suministro.nro_medidor,
        zona: data.suministro.zona
      }
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe recibo para ese suministro y periodo." });
    }
    if (err.message === "DATOS_RECIBO_INVALIDOS") return res.status(400).json({ error: "Datos de recibo inválidos." });
    if (err.message === "PERIODO_FUTURO_NO_PERMITIDO") return res.status(400).json({ error: "No se permite generar recibo en un periodo futuro." });
    if (err.message === "SUMINISTRO_NO_ENCONTRADO") return res.status(404).json({ error: "Suministro no encontrado." });
    if (err.message === "SUMINISTRO_INACTIVO") return res.status(400).json({ error: "Suministro inactivo. No se puede generar deuda." });
    if (err.message === "LECTURA_ACTUAL_REQUERIDA") return res.status(400).json({ error: "Lectura actual es obligatoria." });
    if (err.message === "LECTURA_ACTUAL_INVALIDA") return res.status(400).json({ error: "Lectura actual no puede ser negativa." });
    console.error("[LUZ] Error generando recibo:", err.message);
    return res.status(500).json({ error: "Error generando recibo." });
  } finally {
    client.release();
  }
});

router.get("/recibos/lectura-anterior/:id_suministro", authenticateLuzToken, requireRole("CONSULTA"), async (req, res) => {
  const client = await pool.connect();
  try {
    const idSuministro = parsePositiveInt(req.params?.id_suministro, 0);
    const anio = parsePositiveInt(req.query?.anio, 0);
    const mes = parsePositiveInt(req.query?.mes, 0);

    if (!idSuministro || !anio || mes < 1 || mes > 12) {
      return res.status(400).json({ error: "Parametros invalidos para consultar lectura anterior." });
    }

    const suministro = await client.query(
      "SELECT id_suministro FROM suministros WHERE id_suministro = $1 LIMIT 1",
      [idSuministro]
    );
    if (!suministro.rows[0]) {
      return res.status(404).json({ error: "Suministro no encontrado." });
    }

    const lectura = await getLecturaMesAnteriorExacta(client, idSuministro, anio, mes);
    return res.json({
      anio,
      mes,
      periodo_anterior: {
        anio: lectura.anio,
        mes: lectura.mes
      },
      encontrada: lectura.encontrada,
      lectura_anterior: lectura.encontrada ? lectura.lectura_anterior : null
    });
  } catch (err) {
    console.error("[LUZ] Error consultando lectura anterior:", err.message);
    return res.status(500).json({ error: "Error consultando lectura anterior." });
  } finally {
    client.release();
  }
});

router.get("/recibos/historial/:id_suministro", authenticateLuzToken, requireRole("CONSULTA"), async (req, res) => {
  try {
    const idSuministro = parsePositiveInt(req.params?.id_suministro, 0);
    if (!idSuministro) return res.status(400).json({ error: "ID suministro inválido." });

    const anioParam = String(req.query?.anio || "all").toLowerCase();
    const filtrarAnio = anioParam !== "all";
    const anio = parsePositiveInt(anioParam, 0);

    const params = [idSuministro];
    let anioFilterSql = "";
    if (filtrarAnio && anio > 0) {
      params.push(anio);
      anioFilterSql = ` AND r.anio = $${params.length} `;
    }

    const data = await pool.query(
      `WITH pagos_agg AS (
         SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
         FROM pagos
         GROUP BY id_recibo
       )
       SELECT
         r.id_recibo,
         r.anio,
         r.mes,
         r.lectura_anterior,
         r.lectura_actual,
         r.consumo_kwh,
         r.tarifa_kwh,
         r.energia_activa,
         r.mantenimiento,
         r.total_pagar,
         r.fecha_emision,
         r.fecha_vencimiento,
         r.fecha_corte,
         COALESCE(pa.total_pagado, 0) AS abono_mes,
         GREATEST(r.total_pagar - COALESCE(pa.total_pagado, 0), 0) AS deuda_mes,
         CASE
           WHEN COALESCE(pa.total_pagado, 0) >= r.total_pagar THEN 'PAGADO'
           WHEN COALESCE(pa.total_pagado, 0) > 0 THEN 'PARCIAL'
           ELSE 'PENDIENTE'
         END AS estado
       FROM recibos r
       LEFT JOIN pagos_agg pa ON pa.id_recibo = r.id_recibo
       WHERE r.id_suministro = $1
       ${anioFilterSql}
       ORDER BY r.anio ASC, r.mes ASC, r.id_recibo ASC`,
      params
    );

    return res.json(data.rows);
  } catch (err) {
    console.error("[LUZ] Error historial recibos:", err.message);
    return res.status(500).json({ error: "Error listando historial de recibos." });
  }
});

router.get("/recibos/pendientes/:id_suministro", authenticateLuzToken, requireRole("CONSULTA"), async (req, res) => {
  try {
    const idSuministro = parsePositiveInt(req.params?.id_suministro, 0);
    if (!idSuministro) return res.status(400).json({ error: "ID suministro inválido." });

    const data = await pool.query(
      `WITH pagos_agg AS (
         SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
         FROM pagos
         GROUP BY id_recibo
       )
       SELECT
         r.id_recibo,
         r.anio,
         r.mes,
         r.lectura_anterior,
         r.lectura_actual,
         r.consumo_kwh,
         r.energia_activa,
         r.mantenimiento,
         r.total_pagar,
         COALESCE(pa.total_pagado, 0) AS abono_mes,
         GREATEST(r.total_pagar - COALESCE(pa.total_pagado, 0), 0) AS deuda_mes
       FROM recibos r
       LEFT JOIN pagos_agg pa ON pa.id_recibo = r.id_recibo
       WHERE r.id_suministro = $1
         AND GREATEST(r.total_pagar - COALESCE(pa.total_pagado, 0), 0) > 0
       ORDER BY r.anio ASC, r.mes ASC, r.id_recibo ASC`,
      [idSuministro]
    );

    return res.json(data.rows);
  } catch (err) {
    console.error("[LUZ] Error recibos pendientes:", err.message);
    return res.status(500).json({ error: "Error listando recibos pendientes." });
  }
});

router.post("/caja/ordenes-cobro", authenticateCajaMunicipalToken, requireRole("ADMIN_SEC"), async (req, res) => {
  if (rejectIfLuzCajaInternaDisabled(res)) return;
  const client = await pool.connect();
  try {
    const idSuministro = parsePositiveInt(req.body?.id_suministro, 0);
    const observacion = normalizeText(req.body?.observacion, 500) || null;
    if (!idSuministro) return res.status(400).json({ error: "Suministro inválido." });

    let items = parseOrderItems(req.body?.items || []);

    await client.query("BEGIN");

    const suministro = await client.query(
      `SELECT s.id_suministro, s.nro_medidor, s.nombre_usuario, z.nombre AS zona
       FROM suministros s
       JOIN zonas z ON z.id_zona = s.id_zona
       WHERE s.id_suministro = $1
       LIMIT 1`,
      [idSuministro]
    );
    if (!suministro.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Suministro no encontrado." });
    }

    if (items.length === 0) {
      const pendientes = await client.query(
        `WITH pagos_agg AS (
           SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
           FROM pagos
           GROUP BY id_recibo
         )
         SELECT
           r.id_recibo,
           r.anio,
           r.mes,
           r.consumo_kwh,
           r.energia_activa,
           r.mantenimiento,
           GREATEST(r.total_pagar - COALESCE(pa.total_pagado, 0), 0) AS saldo
         FROM recibos r
         LEFT JOIN pagos_agg pa ON pa.id_recibo = r.id_recibo
         WHERE r.id_suministro = $1
           AND GREATEST(r.total_pagar - COALESCE(pa.total_pagado, 0), 0) > 0
         ORDER BY r.anio, r.mes`,
        [idSuministro]
      );
      items = pendientes.rows.map((r) => ({
        id_recibo: Number(r.id_recibo),
        monto_autorizado: round2(parseMonto(r.saldo, 0)),
        anio: Number(r.anio),
        mes: Number(r.mes),
        consumo_kwh: round2(parseMonto(r.consumo_kwh, 0)),
        energia_activa: round2(parseMonto(r.energia_activa, 0)),
        mantenimiento: round2(parseMonto(r.mantenimiento, 0))
      }));
    }

    if (items.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No hay recibos pendientes para generar orden." });
    }

    const idsRecibos = items.map((r) => Number(r.id_recibo));

    const solapada = await client.query(
      `SELECT oc.id_orden
       FROM ordenes_cobro oc
       WHERE oc.estado = 'PENDIENTE'
         AND oc.id_suministro = $1
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(oc.recibos_json) elem
           WHERE (elem->>'id_recibo') ~ '^[0-9]+$'
             AND ((elem->>'id_recibo')::bigint = ANY($2::bigint[]))
         )
       LIMIT 1`,
      [idSuministro, idsRecibos]
    );

    if (solapada.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Ya existe orden pendiente (${solapada.rows[0].id_orden}) con recibos seleccionados.` });
    }

    const recibosRows = await client.query(
      `WITH pagos_agg AS (
         SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
         FROM pagos
         WHERE id_recibo = ANY($2::bigint[])
         GROUP BY id_recibo
       )
       SELECT
         r.id_recibo,
         r.anio,
         r.mes,
         r.total_pagar,
         r.consumo_kwh,
         r.energia_activa,
         r.mantenimiento,
         COALESCE(pa.total_pagado, 0) AS total_pagado
       FROM recibos r
       LEFT JOIN pagos_agg pa ON pa.id_recibo = r.id_recibo
       WHERE r.id_suministro = $1
         AND r.id_recibo = ANY($2::bigint[])
       FOR UPDATE OF r`,
      [idSuministro, idsRecibos]
    );

    if (recibosRows.rows.length !== idsRecibos.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Uno o más recibos no pertenecen al suministro." });
    }

    const mapRecibos = new Map(recibosRows.rows.map((r) => [Number(r.id_recibo), r]));
    const detalle = [];
    for (const item of items) {
      const row = mapRecibos.get(Number(item.id_recibo));
      if (!row) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Recibo inválido: ${item.id_recibo}` });
      }
      const saldo = round2(Math.max(parseMonto(row.total_pagar, 0) - parseMonto(row.total_pagado, 0), 0));
      if (saldo <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Recibo ${item.id_recibo} sin saldo.` });
      }
      const monto = round2(item.monto_autorizado > 0 ? item.monto_autorizado : saldo);
      if (monto <= 0 || monto > saldo + 0.001) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Monto autorizado inválido para recibo ${item.id_recibo}.` });
      }
      detalle.push({
        id_recibo: Number(item.id_recibo),
        anio: Number(row.anio),
        mes: Number(row.mes),
        monto_autorizado: monto,
        saldo_al_emitir: saldo,
        consumo_kwh: round2(parseMonto(row.consumo_kwh, 0)),
        energia_activa: round2(parseMonto(row.energia_activa, 0)),
        mantenimiento: round2(parseMonto(row.mantenimiento, 0))
      });
    }

    const totalOrden = round2(detalle.reduce((acc, it) => acc + round2(it.monto_autorizado), 0));
    if (totalOrden <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Total de orden inválido." });
    }

    const insert = await client.query(
      `INSERT INTO ordenes_cobro (
        estado, id_usuario_emite, id_suministro, total_orden, recibos_json, observacion
      ) VALUES (
        'PENDIENTE', $1, $2, $3, $4::jsonb, $5
      )
      RETURNING id_orden, estado, creado_en, total_orden`,
      [req.user?.id_usuario || null, idSuministro, totalOrden, JSON.stringify(detalle), observacion]
    );

    await registrarAuditoria(client, req.user?.username, "ORDEN_LUZ_EMITIDA", `id_orden=${insert.rows[0].id_orden}; suministro=${idSuministro}; total=${totalOrden.toFixed(2)}; recibos=${detalle.length}`);
    await client.query("COMMIT");

    return res.json({
      mensaje: "Orden de cobro emitida.",
      orden: {
        id_orden: Number(insert.rows[0].id_orden),
        estado: insert.rows[0].estado,
        creado_en: insert.rows[0].creado_en,
        total_orden: round2(parseMonto(insert.rows[0].total_orden, totalOrden)),
        id_suministro: idSuministro,
        items: detalle,
        suministro: {
          nro_medidor: suministro.rows[0].nro_medidor,
          nombre_usuario: suministro.rows[0].nombre_usuario,
          zona: suministro.rows[0].zona
        }
      }
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[LUZ] Error emitiendo orden de cobro:", err.message);
    return res.status(500).json({ error: "Error emitiendo orden de cobro." });
  } finally {
    client.release();
  }
});

router.get("/caja/ordenes-cobro/pendientes", authenticateCajaMunicipalToken, requireRole("CAJERO"), async (req, res) => {
  if (rejectIfLuzCajaInternaDisabled(res)) return;
  try {
    const idSuministro = parsePositiveInt(req.query?.id_suministro, 0);
    const params = [];
    const where = ["oc.estado = 'PENDIENTE'"];

    if (idSuministro > 0) {
      params.push(idSuministro);
      where.push(`oc.id_suministro = $${params.length}`);
    }

    const rows = await pool.query(
      `SELECT
         oc.id_orden,
         oc.creado_en,
         oc.estado,
         oc.id_suministro,
         oc.total_orden,
         oc.observacion,
         oc.recibos_json,
         s.nro_medidor,
         s.nombre_usuario,
         z.nombre AS zona,
         u.username AS usuario_emite
       FROM ordenes_cobro oc
       JOIN suministros s ON s.id_suministro = oc.id_suministro
       JOIN zonas z ON z.id_zona = s.id_zona
       LEFT JOIN usuarios_sistema u ON u.id_usuario = oc.id_usuario_emite
       WHERE ${where.join(" AND ")}
       ORDER BY oc.creado_en DESC, oc.id_orden DESC
       LIMIT 300`,
      params
    );

    return res.json(rows.rows.map((r) => ({
      id_orden: Number(r.id_orden),
      creado_en: r.creado_en,
      estado: r.estado,
      id_suministro: Number(r.id_suministro),
      total_orden: round2(parseMonto(r.total_orden, 0)),
      observacion: r.observacion || null,
      items: parseOrderItems(safeJsonArray(r.recibos_json)),
      suministro: {
        nro_medidor: r.nro_medidor,
        nombre_usuario: r.nombre_usuario,
        zona: r.zona
      },
      emisor: r.usuario_emite || null
    })));
  } catch (err) {
    console.error("[LUZ] Error listando ordenes pendientes:", err.message);
    return res.status(500).json({ error: "Error listando órdenes pendientes." });
  }
});
router.post("/caja/ordenes-cobro/:id/cobrar", authenticateCajaMunicipalToken, requireRole("CAJERO"), async (req, res) => {
  if (rejectIfLuzCajaInternaDisabled(res)) return;
  const client = await pool.connect();
  try {
    const idOrden = parsePositiveInt(req.params?.id, 0);
    if (!idOrden) return res.status(400).json({ error: "ID orden inválido." });

    await client.query("BEGIN");

    const ordenResult = await client.query(
      "SELECT * FROM ordenes_cobro WHERE id_orden = $1 FOR UPDATE",
      [idOrden]
    );
    const orden = ordenResult.rows[0];
    if (!orden) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Orden no encontrada." });
    }
    if (orden.estado !== "PENDIENTE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Orden no pendiente (estado actual: ${orden.estado}).` });
    }

    const items = parseOrderItems(safeJsonArray(orden.recibos_json));
    if (items.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Orden sin recibos válidos." });
    }

    const idsRecibos = items.map((i) => Number(i.id_recibo));

    const recibosRows = await client.query(
      `WITH pagos_agg AS (
         SELECT id_recibo, COALESCE(SUM(monto_pagado), 0) AS total_pagado
         FROM pagos
         WHERE id_recibo = ANY($1::bigint[])
         GROUP BY id_recibo
       )
       SELECT r.id_recibo, r.total_pagar, r.anio, r.mes, COALESCE(pa.total_pagado, 0) AS total_pagado
       FROM recibos r
       LEFT JOIN pagos_agg pa ON pa.id_recibo = r.id_recibo
       WHERE r.id_recibo = ANY($1::bigint[])
       FOR UPDATE OF r`,
      [idsRecibos]
    );

    if (recibosRows.rows.length !== idsRecibos.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Uno o más recibos no existen." });
    }

    const mapRecibos = new Map(recibosRows.rows.map((r) => [Number(r.id_recibo), r]));

    const pagosAplicados = [];
    let totalAplicado = 0;

    for (const item of items) {
      const row = mapRecibos.get(Number(item.id_recibo));
      if (!row) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Recibo inválido ${item.id_recibo}.` });
      }
      const saldo = round2(Math.max(parseMonto(row.total_pagar, 0) - parseMonto(row.total_pagado, 0), 0));
      if (saldo <= 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: `Recibo ${item.id_recibo} ya pagado.` });
      }
      const monto = round2(item.monto_autorizado > 0 ? item.monto_autorizado : saldo);
      if (monto <= 0 || monto > saldo + 0.001) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: `Monto autorizado inválido para recibo ${item.id_recibo}.` });
      }

      await client.query(
        "INSERT INTO pagos (id_recibo, monto_pagado, usuario_cajero, id_orden_cobro) VALUES ($1, $2, $3, $4)",
        [Number(item.id_recibo), monto, req.user?.username || req.user?.nombre || null, idOrden]
      );

      const totalPagadoNuevo = round2(parseMonto(row.total_pagado, 0) + monto);
      const nuevoEstado = totalPagadoNuevo >= parseMonto(row.total_pagar, 0) - 0.001 ? "PAGADO" : "PARCIAL";
      await client.query("UPDATE recibos SET estado = $1, actualizado_en = NOW() WHERE id_recibo = $2", [nuevoEstado, Number(item.id_recibo)]);

      pagosAplicados.push({
        id_recibo: Number(item.id_recibo),
        anio: Number(row.anio),
        mes: Number(row.mes),
        monto_pagado: monto,
        estado: nuevoEstado,
        total_pagado: totalPagadoNuevo,
        saldo: round2(Math.max(parseMonto(row.total_pagar, 0) - totalPagadoNuevo, 0))
      });
      totalAplicado = round2(totalAplicado + monto);
    }

    await client.query(
      `UPDATE ordenes_cobro
       SET estado = 'COBRADA',
           id_usuario_cobra = $2,
           cobrado_en = NOW(),
           actualizado_en = NOW()
       WHERE id_orden = $1`,
      [idOrden, req.user?.id_usuario || null]
    );

    await registrarAuditoria(client, req.user?.username, "ORDEN_LUZ_COBRADA", `id_orden=${idOrden}; total=${totalAplicado.toFixed(2)}; recibos=${pagosAplicados.length}`);

    await client.query("COMMIT");
    return res.json({
      mensaje: "Cobro registrado.",
      orden: {
        id_orden: idOrden,
        estado: "COBRADA",
        total_orden: round2(parseMonto(orden.total_orden, totalAplicado)),
        total_cobrado: totalAplicado
      },
      pagos: pagosAplicados
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[LUZ] Error cobrando orden:", err.message);
    return res.status(500).json({ error: "Error cobrando orden." });
  } finally {
    client.release();
  }
});

router.post("/caja/ordenes-cobro/:id/anular", authenticateCajaMunicipalToken, requireRole("ADMIN_SEC"), async (req, res) => {
  if (rejectIfLuzCajaInternaDisabled(res)) return;
  const client = await pool.connect();
  try {
    const idOrden = parsePositiveInt(req.params?.id, 0);
    const motivo = normalizeText(req.body?.motivo, 500);
    if (!idOrden) return res.status(400).json({ error: "ID orden inválido." });
    if (!motivo || motivo.length < 5) return res.status(400).json({ error: "Motivo obligatorio (mínimo 5 caracteres)." });

    await client.query("BEGIN");

    const ord = await client.query("SELECT id_orden, estado FROM ordenes_cobro WHERE id_orden = $1 FOR UPDATE", [idOrden]);
    if (!ord.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Orden no encontrada." });
    }
    if (ord.rows[0].estado !== "PENDIENTE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Solo se anulan ordenes pendientes (estado actual: ${ord.rows[0].estado}).` });
    }

    await client.query(
      `UPDATE ordenes_cobro
       SET estado = 'ANULADA', motivo_anulacion = $2, anulado_en = NOW(), actualizado_en = NOW()
       WHERE id_orden = $1`,
      [idOrden, motivo]
    );

    await registrarAuditoria(client, req.user?.username, "ORDEN_LUZ_ANULADA", `id_orden=${idOrden}; motivo=${motivo}`);
    await client.query("COMMIT");

    return res.json({ mensaje: "Orden anulada.", id_orden: idOrden, estado: "ANULADA" });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[LUZ] Error anulando orden:", err.message);
    return res.status(500).json({ error: "Error anulando orden." });
  } finally {
    client.release();
  }
});

router.get("/caja/reporte", authenticateCajaMunicipalToken, requireRole("CAJERO"), async (req, res) => {
  if (rejectIfLuzCajaInternaDisabled(res)) return;
  try {
    const tipoRaw = normalizeText(req.query?.tipo || "diario", 20).toLowerCase();
    const tipo = ["diario", "mensual", "anual"].includes(tipoRaw) ? tipoRaw : "diario";
    const hoy = toISODate();
    const fechaRef = normalizeText(req.query?.fecha || hoy, 20) || hoy;
    if (fechaRef > hoy) {
      return res.status(400).json({ error: "No se permite consultar caja con fecha futura." });
    }

    const range = await pool.query(
      `SELECT
         CASE
           WHEN $1 = 'diario' THEN $2::date
           WHEN $1 = 'mensual' THEN date_trunc('month', $2::date)::date
           ELSE date_trunc('year', $2::date)::date
         END AS desde,
         CASE
           WHEN $1 = 'diario' THEN ($2::date + INTERVAL '1 day')::date
           WHEN $1 = 'mensual' THEN (date_trunc('month', $2::date) + INTERVAL '1 month')::date
           ELSE (date_trunc('year', $2::date) + INTERVAL '1 year')::date
         END AS hasta`,
      [tipo, fechaRef]
    );
    const desde = range.rows[0]?.desde;
    const hasta = range.rows[0]?.hasta;

    const resumen = await pool.query(
      `SELECT
         COUNT(*)::int AS cantidad,
         COALESCE(SUM(monto_pagado), 0)::numeric AS total
       FROM pagos
       WHERE fecha_pago >= $1::date
         AND fecha_pago < $2::date`,
      [desde, hasta]
    );

    const movimientos = await pool.query(
      `SELECT
         p.id_pago,
         p.fecha_pago,
         to_char(p.fecha_pago, 'YYYY-MM-DD') AS fecha,
         to_char(p.fecha_pago, 'HH24:MI:SS') AS hora,
         p.monto_pagado,
         r.id_recibo,
         r.anio,
         r.mes,
         s.nro_medidor,
         s.nombre_usuario,
         z.nombre AS zona,
         p.id_orden_cobro
       FROM pagos p
       JOIN recibos r ON r.id_recibo = p.id_recibo
       JOIN suministros s ON s.id_suministro = r.id_suministro
       JOIN zonas z ON z.id_zona = s.id_zona
       WHERE p.fecha_pago >= $1::date
         AND p.fecha_pago < $2::date
       ORDER BY p.fecha_pago DESC, p.id_pago DESC
       LIMIT 800`,
      [desde, hasta]
    );

    return res.json({
      tipo,
      fecha_referencia: fechaRef,
      rango: { desde, hasta_exclusivo: hasta },
      total: round2(parseMonto(resumen.rows[0]?.total, 0)).toFixed(2),
      cantidad_movimientos: Number(resumen.rows[0]?.cantidad || 0),
      movimientos: movimientos.rows.map((m) => ({
        id_pago: Number(m.id_pago),
        fecha_pago: m.fecha_pago,
        fecha: m.fecha,
        hora: m.hora,
        monto_pagado: round2(parseMonto(m.monto_pagado, 0)),
        id_recibo: Number(m.id_recibo),
        anio: Number(m.anio),
        mes: Number(m.mes),
        nro_medidor: m.nro_medidor,
        nombre_usuario: m.nombre_usuario,
        zona: m.zona,
        id_orden_cobro: m.id_orden_cobro ? Number(m.id_orden_cobro) : null
      }))
    });
  } catch (err) {
    console.error("[LUZ] Error reporte caja:", err.message);
    return res.status(500).json({ error: "Error generando reporte de caja." });
  }
});
router.post("/importar/padron", authenticateLuzToken, requireRole("ADMIN"), uploadImportSingle("archivo"), async (req, res) => {
  const client = await pool.connect();
  const rechazos = [];
  const resumen = {
    duplicado_archivo: 0,
    duplicado_bd: 0,
    datos_invalidos: 0,
    error_bd: 0
  };
  const pushRechazo = (tipo, data = {}) => {
    if (Object.prototype.hasOwnProperty.call(resumen, tipo)) resumen[tipo] += 1;
    if (rechazos.length < MAX_RECHAZOS_IMPORTACION) {
      rechazos.push({
        tipo,
        zona: data.zona || null,
        linea: data.linea || null,
        nro_medidor: data.nro_medidor || null,
        nombre: data.nombre || null,
        motivo: data.motivo || tipo
      });
    }
  };

  try {
    if (!req.file) return res.status(400).json({ error: "Debe adjuntar archivo." });
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

    const wb = await loadWorkbookFromUploadedFile(req.file);

    if (!wb.worksheets || wb.worksheets.length === 0) {
      return res.status(400).json({ error: "No se encontraron hojas para importar." });
    }

    await client.query("BEGIN");

    const seen = new Set();
    let totalLeidas = 0;
    let totalImportadas = 0;
    const zoneCache = new Map();
    const resolveZoneCached = async (zoneNameRaw) => {
      const zoneName = normalizeZoneName(zoneNameRaw || "SIN ZONA");
      if (zoneCache.has(zoneName)) return zoneCache.get(zoneName);
      const zone = await resolveZoneId(client, { zona_nombre: zoneName });
      zoneCache.set(zoneName, zone);
      return zone;
    };

    for (const ws of wb.worksheets) {
      const zonaSheet = normalizeZoneName(ws.name || "SIN ZONA");
      let headerRow = 0;
      let colMedidor = 0;
      let colNombre = 0;

      for (let r = 1; r <= Math.min(ws.rowCount, 25); r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= 40; c++) {
          const v = normHeader(cellText(row.getCell(c)));
          if (!colMedidor && v.includes("MEDIDOR")) {
            colMedidor = c;
            headerRow = r;
          }
          if (!colNombre && (v.includes("NOMBREDELUSUARIO") || v === "NOMBRES" || v.includes("NOMBREDEUSUARIO") || v.includes("NOMBREUSUARIO"))) {
            colNombre = c;
            headerRow = r;
          }
        }
        if (colMedidor && colNombre) break;
      }

      if (!headerRow || !colMedidor || !colNombre) {
        pushRechazo("datos_invalidos", {
          zona: zonaSheet,
          linea: null,
          motivo: `No se encontró cabecera con columnas de medidor y nombre en hoja ${ws.name}.`
        });
        continue;
      }

      for (let r = headerRow + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const medidor = normalizeText(cellText(row.getCell(colMedidor)), 80);
        const nombre = normalizeText(cellText(row.getCell(colNombre)), 220);

        const values = [];
        for (let c = 1; c <= Math.min(40, ws.columnCount || 40); c++) {
          values.push(cellText(row.getCell(c)));
        }
        const joined = normalizeZoneName(values.join(" | "));
        const tieneContenido = values.some((v) => String(v || "").trim().length > 0);
        if (!tieneContenido) continue;

        totalLeidas += 1;

        if (!medidor || !nombre) {
          pushRechazo("datos_invalidos", {
            zona: zonaSheet,
            linea: r,
            nro_medidor: medidor || null,
            nombre: nombre || null,
            motivo: "Medidor o nombre vacío."
          });
          continue;
        }

        const zonaNombre = splitCharcapeZoneName(zonaSheet, medidor) || zonaSheet;
        const zona = await resolveZoneCached(zonaNombre);

        const key = `${zona.id_zona}::${medidor}`;
        if (seen.has(key)) {
          pushRechazo("duplicado_archivo", {
            zona: zona.nombre,
            linea: r,
            nro_medidor: medidor,
            nombre,
            motivo: "Duplicado en archivo (zona + medidor)."
          });
          continue;
        }

        const estado = joined.includes("CORTADO") || joined.includes("CRT")
          ? "CORTADO"
          : (joined.includes("NO VIVEN") || joined.includes("NO VIVE") ? "INACTIVO" : "ACTIVO");

        try {
          await client.query(
            `INSERT INTO suministros (id_zona, nro_medidor, nombre_usuario, direccion, estado)
             VALUES ($1, $2, $3, $4, $5)`,
            [zona.id_zona, medidor, nombre, null, estado]
          );
          seen.add(key);
          totalImportadas += 1;
        } catch (errFila) {
          if (errFila.code === "23505") {
            pushRechazo("duplicado_bd", {
              zona: zona.nombre,
              linea: r,
              nro_medidor: medidor,
              nombre,
              motivo: "Ya existe en base de datos (zona + medidor)."
            });
          } else {
            pushRechazo("error_bd", {
              zona: zona.nombre,
              linea: r,
              nro_medidor: medidor,
              nombre,
              motivo: errFila.message
            });
          }
        }
      }
    }

    await registrarAuditoria(client, req.user?.username, "IMPORTAR_PADRON_LUZ", `leidas=${totalLeidas}; importadas=${totalImportadas}; rechazadas=${Object.values(resumen).reduce((a, b) => a + b, 0)}`);
    await client.query("COMMIT");

    const totalRechazados = Object.values(resumen).reduce((a, b) => a + b, 0);
    return res.json({
      mensaje: `Padron procesado. Importados: ${totalImportadas}. Rechazados: ${totalRechazados}.`,
      total_recibidos: totalLeidas,
      total_importados: totalImportadas,
      total_rechazados: totalRechazados,
      resumen_rechazos: resumen,
      rechazos,
      rechazos_mostrados: rechazos.length
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[LUZ] Error importando padron:", err.message);
    return res.status(500).json({ error: `Error importando padrón: ${err.message}` });
  } finally {
    cleanupUploadedTempFile(req.file);
    client.release();
  }
});

router.post("/importar/lecturas", authenticateLuzToken, requireRole("ADMIN"), uploadImportSingle("archivo"), async (req, res) => {
  const client = await pool.connect();
  const rechazos = [];
  const resumen = {
    datos_invalidos: 0,
    no_encontrado: 0,
    duplicado_periodo: 0,
    lectura_invalida: 0,
    error_bd: 0
  };
  const pushRechazo = (tipo, data = {}) => {
    if (Object.prototype.hasOwnProperty.call(resumen, tipo)) resumen[tipo] += 1;
    if (rechazos.length < MAX_RECHAZOS_IMPORTACION) {
      rechazos.push({
        tipo,
        linea: data.linea || null,
        zona: data.zona || null,
        nro_medidor: data.nro_medidor || null,
        anio: data.anio || null,
        mes: data.mes || null,
        motivo: data.motivo || tipo
      });
    }
  };

  try {
    if (!req.file) return res.status(400).json({ error: "Debe adjuntar archivo." });
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

    const wb = await loadWorkbookFromUploadedFile(req.file);

    const ws = wb.getWorksheet(1);
    if (!ws) return res.status(400).json({ error: "No se encontró hoja para importar lecturas." });

    const headers = new Map();
    ws.getRow(1).eachCell((cell, col) => {
      const key = normHeader(cellText(cell));
      if (key) headers.set(key, col);
    });

    const colZona = headers.get("ZONA") || headers.get("SECTOR") || 0;
    const colMedidor = headers.get("NROMEDIDOR") || headers.get("MEDIDOR") || 0;
    const colAnio = headers.get("ANIO") || headers.get("ANO") || 0;
    const colMes = headers.get("MES") || 0;
    const colLecturaActual = headers.get("LECTURAACTUAL") || headers.get("LECTURA") || 0;
    const colObservacion = headers.get("OBSERVACION") || headers.get("OBS") || 0;

    if (!colZona || !colMedidor || !colAnio || !colMes || !colLecturaActual) {
      return res.status(400).json({
        error: "Plantilla inválida. Columnas requeridas: zona, nro_medidor, anio, mes, lectura_actual."
      });
    }

    let totalLeidas = 0;
    let totalImportadas = 0;

    await client.query("BEGIN");

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const zona = normalizeZoneName(cellText(row.getCell(colZona)));
      const nroMedidor = normalizeText(cellText(row.getCell(colMedidor)), 80);
      const zonaLookup = splitCharcapeZoneName(zona, nroMedidor) || zona;
      const anio = parsePositiveInt(cellText(row.getCell(colAnio)), 0);
      const mes = parsePositiveInt(cellText(row.getCell(colMes)), 0);
      const lecturaActualRaw = cellText(row.getCell(colLecturaActual));
      const observacion = colObservacion ? normalizeText(cellText(row.getCell(colObservacion)), 500) : "";

      const tieneContenido = [zona, nroMedidor, anio, mes, lecturaActualRaw].some((v) => String(v || "").trim().length > 0);
      if (!tieneContenido) continue;
      totalLeidas += 1;

      if (!zona || !nroMedidor || !anio || mes < 1 || mes > 12 || lecturaActualRaw === "") {
        pushRechazo("datos_invalidos", {
          linea: r,
          zona,
          nro_medidor: nroMedidor,
          anio,
          mes,
          motivo: "Datos incompletos o inválidos."
        });
        continue;
      }

      const lecturaActual = round2(parseMonto(lecturaActualRaw, NaN));
      if (!Number.isFinite(lecturaActual)) {
        pushRechazo("datos_invalidos", {
          linea: r,
          zona,
          nro_medidor: nroMedidor,
          anio,
          mes,
          motivo: "Lectura actual no numérica."
        });
        continue;
      }

      const suministro = await client.query(
        `SELECT s.id_suministro
         FROM suministros s
         JOIN zonas z ON z.id_zona = s.id_zona
         WHERE UPPER(TRIM(z.nombre)) = $1
           AND UPPER(TRIM(s.nro_medidor)) = $2
         LIMIT 1`,
        [zonaLookup, nroMedidor.toUpperCase()]
      );

      if (!suministro.rows[0]) {
        pushRechazo("no_encontrado", {
          linea: r,
          zona,
          nro_medidor: nroMedidor,
          anio,
          mes,
          motivo: "No existe suministro para zona + medidor."
        });
        continue;
      }

      const idSuministro = Number(suministro.rows[0].id_suministro);

      try {
        await insertRecibo(client, {
          id_suministro: idSuministro,
          anio,
          mes,
          lectura_actual: lecturaActual,
          observacion
        }, req.user?.username || "SISTEMA");
        totalImportadas += 1;
      } catch (errFila) {
        if (errFila.code === "23505") {
          pushRechazo("duplicado_periodo", {
            linea: r,
            zona,
            nro_medidor: nroMedidor,
            anio,
            mes,
            motivo: "Ya existe recibo para ese periodo."
          });
        } else if (errFila.message === "LECTURA_ACTUAL_INVALIDA") {
          pushRechazo("lectura_invalida", {
            linea: r,
            zona,
            nro_medidor: nroMedidor,
            anio,
            mes,
            motivo: "Lectura actual no puede ser negativa."
          });
        } else if (errFila.message === "SUMINISTRO_INACTIVO") {
          pushRechazo("lectura_invalida", {
            linea: r,
            zona,
            nro_medidor: nroMedidor,
            anio,
            mes,
            motivo: "Suministro inactivo; no se genera recibo."
          });
        } else if (errFila.message === "PERIODO_FUTURO_NO_PERMITIDO") {
          pushRechazo("datos_invalidos", {
            linea: r,
            zona,
            nro_medidor: nroMedidor,
            anio,
            mes,
            motivo: "No se permite generar recibo en periodo futuro."
          });
        } else {
          pushRechazo("error_bd", {
            linea: r,
            zona,
            nro_medidor: nroMedidor,
            anio,
            mes,
            motivo: errFila.message
          });
        }
      }
    }

    await registrarAuditoria(client, req.user?.username, "IMPORTAR_LECTURAS_LUZ", `leidas=${totalLeidas}; importadas=${totalImportadas}; rechazadas=${Object.values(resumen).reduce((a, b) => a + b, 0)}`);
    await client.query("COMMIT");

    const totalRechazados = Object.values(resumen).reduce((a, b) => a + b, 0);
    return res.json({
      mensaje: "Lecturas importadas.",
      total_recibidos: totalLeidas,
      total_importados: totalImportadas,
      total_rechazados: totalRechazados,
      resumen_rechazos: resumen,
      rechazos,
      rechazos_mostrados: rechazos.length
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[LUZ] Error importando lecturas:", err.message);
    return res.status(500).json({ error: `Error importando lecturas: ${err.message}` });
  } finally {
    cleanupUploadedTempFile(req.file);
    client.release();
  }
});

module.exports = router;

