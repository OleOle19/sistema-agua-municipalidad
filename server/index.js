const { spawn } = require('child_process');
const path = require('path');
const express = require("express");
const app = express();
const cors = require("cors");
const pool = require("./db");
const ExcelJS = require('exceljs');
const xml2js = require('xml2js'); // <--- NUEVA LIBRERÍA OBLIGATORIA
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

const isBcryptHash = (value) => typeof value === "string" && value.startsWith("$2");

const issueToken = (user) => jwt.sign(
  {
    id_usuario: user.id_usuario,
    username: user.username,
    rol: user.rol,
    nombre: user.nombre_completo
  },
  JWT_SECRET,
  { expiresIn: JWT_EXPIRES_IN }
);

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    // Permitimos paso si no hay token (modo dev) o ajustamos según necesidad
    // return res.status(401).json({ error: "No autorizado" });
    return next(); // TEMPORAL: Permitir sin token para facilitar pruebas locales
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
};

const requireAdmin = (req, res, next) => {
  // if (req.user?.rol !== "ADMIN") return res.status(403).json({ error: "Acceso denegado" });
  return next(); // TEMPORAL: Bypass de rol para pruebas
};

const requireSuperAdmin = (req, res, next) => {
  // if (req.user?.rol !== "ADMIN") return res.status(403).json({ error: "Acceso denegado" });
  return next(); // TEMPORAL: Bypass
};

// --- AUDITORÍA ---
const registrarAuditoria = async (client, accion, detalle) => {
  const db = client || pool;
  try {
    await db.query(
      "INSERT INTO auditoria (accion, detalle) VALUES ($1, $2)",
      [accion, detalle]
    );
  } catch (err) {
    console.error("Error guardando auditoría:", err.message);
  }
};

// Middleware
app.use(cors());
app.use(express.json());

// ==========================================
// RUTAS DE GESTIÓN DE CALLES
// ==========================================
app.get("/calles", async (req, res) => {
  try {
    const todas = await pool.query("SELECT * FROM calles ORDER BY nombre ASC");
    res.json(todas.rows);
  } catch (err) { res.status(500).send("Error del servidor"); }
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
    const anioActual = getCurrentYear();
    const mesActual = new Date().getMonth() + 1;

    // Consulta optimizada: agregamos deuda/abono/meses por predio una sola vez
    const query = `
      WITH pagos_por_recibo AS (
        SELECT id_recibo, SUM(monto_pagado) AS total_pagado
        FROM pagos
        GROUP BY id_recibo
      ),
      resumen_predio AS (
        SELECT
          r.id_predio,
          SUM(GREATEST(r.total_pagar - COALESCE(pp.total_pagado, 0), 0)) AS deuda_total,
          SUM(COALESCE(pp.total_pagado, 0)) AS abono_total,
          COUNT(*) FILTER (WHERE (r.total_pagar - COALESCE(pp.total_pagado, 0)) > 0) AS meses_deuda_total
        FROM recibos r
        LEFT JOIN pagos_por_recibo pp ON pp.id_recibo = r.id_recibo
        WHERE (r.anio < $1) OR (r.anio = $1 AND r.mes <= $2)
        GROUP BY r.id_predio
      )
      SELECT c.id_contribuyente, c.codigo_municipal, c.dni_ruc, c.nombre_completo, c.telefono,
             p.id_predio, 
             ${buildDireccionSql("ca", "p")} as direccion_completa,
             p.id_calle, p.numero_casa, p.manzana, p.lote,
             
             -- Campos adicionales guardados en BD
             p.agua_sn, p.desague_sn, p.limpieza_sn, p.activo_sn,
             
             COALESCE(rp.deuda_total, 0) as deuda_anio,
             COALESCE(rp.abono_total, 0) as abono_anio,
             COALESCE(rp.meses_deuda_total, 0) as meses_deuda
      FROM contribuyentes c
      LEFT JOIN predios p ON c.id_contribuyente = p.id_contribuyente
      LEFT JOIN calles ca ON p.id_calle = ca.id_calle
      LEFT JOIN resumen_predio rp ON rp.id_predio = p.id_predio
      ORDER BY c.nombre_completo ASC
    `;
    const todos = await pool.query(query, [anioActual, mesActual]);
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
    const { dni_ruc, nombre_completo, telefono, id_calle, numero_casa, manzana, lote } = req.body;
    let { codigo_municipal } = req.body;

    if (!nombre_completo || !dni_ruc || !id_calle) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    // AUTOGENERACIÓN NUMÉRICA
    if (!codigo_municipal || codigo_municipal.trim() === "") {
       codigo_municipal = Date.now().toString().slice(-8); 
    }

    const nuevo = await pool.query(
      "INSERT INTO contribuyentes (codigo_municipal, dni_ruc, nombre_completo, telefono) VALUES ($1, $2, $3, $4) RETURNING id_contribuyente",
      [codigo_municipal, dni_ruc, nombre_completo, telefono]
    );
    const id = nuevo.rows[0].id_contribuyente;

    await pool.query(
      "INSERT INTO predios (id_contribuyente, id_calle, numero_casa, manzana, lote, id_tarifa, estado_servicio, activo_sn) VALUES ($1, $2, $3, $4, $5, 1, 'ACTIVO', 'S')",
      [id, id_calle, numero_casa, manzana, lote]
    );

    await registrarAuditoria(pool, "CREAR USUARIO", `Creó a: ${nombre_completo}`);
    res.json({ mensaje: "Registrado", codigo: codigo_municipal });

  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: "DNI o Código ya existen." });
    res.status(500).json({ error: "Error servidor" });
  }
});

app.put("/contribuyentes/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { nombre_completo, codigo_municipal, dni_ruc, email, telefono, id_calle, numero_casa, manzana, lote } = req.body;
    
    await client.query('BEGIN');
    await client.query(
      "UPDATE contribuyentes SET nombre_completo = $1, codigo_municipal = $2, dni_ruc = $3, email = $4, telefono = $5 WHERE id_contribuyente = $6",
      [nombre_completo, codigo_municipal, dni_ruc, email, telefono, id]
    );
    await client.query(
      "UPDATE predios SET id_calle = $1, numero_casa = $2, manzana = $3, lote = $4 WHERE id_contribuyente = $5",
      [id_calle, numero_casa, manzana, lote, id]
    );
    await client.query('COMMIT');
    res.json({ mensaje: "Datos actualizados correctamente" });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).send("Error al actualizar");
  } finally { client.release(); }
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
    res.json({ mensaje: "Usuario eliminado permanentemente." });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).send("Error al eliminar usuario.");
  } finally { client.release(); }
});

// ==========================================
// FACTURACIÓN Y PAGOS
// ==========================================
app.post("/recibos", async (req, res) => {
  try {
    const { id_contribuyente, anio, mes, montos } = req.body;
    const predio = await pool.query("SELECT id_predio, id_tarifa FROM predios WHERE id_contribuyente = $1 LIMIT 1", [id_contribuyente]);
    if (predio.rows.length === 0) return res.status(400).json({ error: "Usuario sin predio." });
    
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
    `;
    const params = [anio, mes, subtotalAgua, subtotalDesague, subtotalLimpieza, subtotalAdmin, totalPagar];

    if (tipo_seleccion === "calle") {
      query += ` WHERE p.id_calle = $${params.length + 1}`;
      params.push(id_calle);
    } else if (tipo_seleccion === "seleccion") {
      query += ` WHERE p.id_contribuyente = ANY($${params.length + 1})`;
      params.push(ids_usuarios);
    }

    query += " ON CONFLICT DO NOTHING RETURNING id_recibo";
    const resultado = await pool.query(query, params);
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

app.post("/pagos", async (req, res) => {
  const client = await pool.connect();
  try {
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

    await registrarAuditoria(null, 'COBRANZA', `Se registró pago del recibo ID ${id_recibo} por S/. ${monto}`);
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

app.get("/caja/diaria", async (req, res) => {
  try {
    const fecha = req.query.fecha || toISODate();
    const reporte = await pool.query(`
      SELECT p.id_pago, to_char(p.fecha_pago, 'HH24:MI:SS') as hora, p.monto_pagado,
        c.nombre_completo, c.codigo_municipal, r.mes, r.anio
      FROM pagos p
      JOIN recibos r ON p.id_recibo = r.id_recibo
      JOIN predios pr ON r.id_predio = pr.id_predio
      JOIN contribuyentes c ON pr.id_contribuyente = c.id_contribuyente
      WHERE DATE(p.fecha_pago) = $1 ORDER BY p.fecha_pago DESC
    `, [fecha]);
    const totalDia = reporte.rows.reduce((acc, row) => acc + parseFloat(row.monto_pagado), 0);
    res.json({ fecha_consulta: fecha, total: totalDia.toFixed(2), movimientos: reporte.rows });
  } catch (err) { res.status(500).send("Error caja"); }
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
    await registrarAuditoria(null, 'ELIMINAR_DEUDA', `Se eliminó recibo ID ${id}`);
    res.json({ mensaje: "Deuda eliminada" });
  } catch (err) { res.status(500).send("Error"); }
});

// ==========================================
// DASHBOARD Y EXCEL
// ==========================================
app.get("/dashboard/resumen", async (req, res) => {
  try {
    const hoy = toISODate();
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
    res.json({
      recaudado_hoy: recaudacion.rows[0].total || 0,
      total_usuarios: usuarios.rows[0].total || 0,
      total_morosos: morosos.rows[0].total || 0
    });
  } catch (err) { res.status(500).send("Error dashboard"); }
});

app.get("/auditoria", authenticateToken, async (req, res) => {
  try {
    const logs = await pool.query("SELECT * FROM auditoria ORDER BY fecha DESC LIMIT 100");
    res.json(logs.rows);
  } catch (err) { res.status(500).send("Error auditoria"); }
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
      "INSERT INTO usuarios_sistema (username, password, nombre_completo, rol, estado) VALUES ($1, $2, $3, 'CAJERO', 'PENDIENTE')",
      [username, passwordHash, nombre_completo]
    );
    res.json({ mensaje: "Solicitud enviada." });
  } catch (err) { res.status(500).send("Error registro"); }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await pool.query("SELECT * FROM usuarios_sistema WHERE username = $1", [username]);
    if (user.rows.length === 0) return res.status(400).json({ error: "Usuario no encontrado" });
    const datos = user.rows[0];
    const storedPassword = datos.password || "";
    let passwordOk = false;
    
    // Soporte para contraseñas antiguas sin encriptar (Migración)
    if (isBcryptHash(storedPassword)) {
      passwordOk = await bcrypt.compare(password, storedPassword);
    } else {
      passwordOk = storedPassword === password;
      if (passwordOk) {
        const newHash = await bcrypt.hash(password, 10);
        await pool.query("UPDATE usuarios_sistema SET password = $1 WHERE id_usuario = $2", [newHash, datos.id_usuario]);
      }
    }
    
    if (!passwordOk) return res.status(400).json({ error: "Contraseña incorrecta" });
    if (datos.estado !== 'ACTIVO') return res.status(403).json({ error: "Cuenta PENDIENTE." });
    
    const token = issueToken(datos);
    res.json({ token, id_usuario: datos.id_usuario, nombre: datos.nombre_completo, rol: datos.rol });
  } catch (err) { res.status(500).send("Error login"); }
});

// Endpoint duplicado por compatibilidad de rutas
app.post("/login", async (req, res) => {
    // Redirección lógica a la misma función de arriba
    // ... Mismo código de login ...
    try {
        const { username, password } = req.body;
        const user = await pool.query("SELECT * FROM usuarios_sistema WHERE username = $1", [username]);
        if (user.rows.length === 0) return res.status(401).json({ error: "Usuario no encontrado" });
        const datos = user.rows[0];
        let passwordOk = false;
        if (isBcryptHash(datos.password)) {
             passwordOk = await bcrypt.compare(password, datos.password);
        } else {
             passwordOk = datos.password === password;
        }
        if (!passwordOk) return res.status(401).json({ error: "Contraseña incorrecta" });
        if (datos.estado !== 'ACTIVO') return res.status(403).json({ error: "Usuario BLOQUEADO" });

        await registrarAuditoria(pool, "LOGIN", `Ingresó usuario: ${username}`);
        res.json(user.rows[0]); // Retorno sin token para app simple, o añadir token si se requiere
    } catch (err) { res.status(500).send("Error"); }
});


app.get("/admin/usuarios", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usuarios = await pool.query("SELECT id_usuario, username, nombre_completo, rol, estado FROM usuarios_sistema ORDER BY estado DESC");
    res.json(usuarios.rows);
  } catch (err) { res.status(500).send("Error"); }
});

app.put("/admin/usuarios/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    await pool.query("UPDATE usuarios_sistema SET estado = $1 WHERE id_usuario = $2", [estado, id]);
    res.json({ mensaje: "Estado actualizado" });
  } catch (err) { res.status(500).send("Error"); }
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
  try {
    if (!req.file) return res.status(400).send("Sin archivo");

    let datos = [];
    const nombreArchivo = req.file.originalname.toLowerCase();
    
    if (nombreArchivo.endsWith('.xml')) {
        // --- XML ---
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

        datos = arrayFilas.map(fila => ({
            codigo: fila.Con_Cod,
            dni: fila.Con_DNI || '',
            nombre: fila.Con_Nombre,
            calle_nombre: fila.Ca_Nombre, 
            dir_referencia: fila.con_direccion, 
            dir_numero: fila.Con_Nro_MZ_Lote,   
            // Extra data
            agua: fila.Agua_SN,
            desague: fila.Desague_SN,
            limpieza: fila.Limpieza_SN,
            activo: fila.Activo_SN,
            tarifa: fila.Tipo_Tarifa,
            sec_cod: fila.Sec_Cod,
            sec_nombre: fila.Sec_Nombre,
            ultima_act: fila.Ultima_Act,
            ca_cod: fila.Ca_Cod
        }));

    } else {
        // --- EXCEL ---
        const workbook = new ExcelJS.Workbook();
        try { await workbook.xlsx.load(req.file.buffer); } catch (e) { 
            const stream = new Readable(); stream.push(req.file.buffer); stream.push(null); await workbook.csv.read(stream); 
        }
        const worksheet = workbook.getWorksheet(1);
        worksheet.eachRow((row, rowNum) => {
            if (rowNum === 1) return;
            // Mapeo básico excel
            datos.push({
                codigo: row.getCell(1).text,
                dni: row.getCell(2).text,
                nombre: row.getCell(3).text,
                calle_nombre: row.getCell(4).text,
                dir_referencia: '', dir_numero: '', activo: 'S'
            });
        });
    }

    await client.query('BEGIN');

    const callesCache = new Map();
    const dbCalles = await client.query("SELECT * FROM calles");
    dbCalles.rows.forEach(c => callesCache.set(normalizarNombreCalle(c.nombre), c.id_calle));

    const getCalleId = async (nombre) => {
        const k = normalizarNombreCalle(nombre || 'SIN CALLE');
        if (callesCache.has(k)) return callesCache.get(k);
        const i = await client.query("INSERT INTO calles (nombre) VALUES ($1) RETURNING id_calle", [k]);
        callesCache.set(k, i.rows[0].id_calle);
        return i.rows[0].id_calle;
    };

    let count = 0;
    for (const d of datos) {
        if (!d.nombre) continue;
        const idCalle = await getCalleId(d.calle_nombre);
        
        let idCont;
        const ex = await client.query("SELECT id_contribuyente FROM contribuyentes WHERE codigo_municipal=$1", [d.codigo]);
        if (ex.rows.length > 0) {
            idCont = ex.rows[0].id_contribuyente;
            await client.query("UPDATE contribuyentes SET dni_ruc=$1, nombre_completo=$2, sec_cod=$3, sec_nombre=$4 WHERE id_contribuyente=$5", 
                [d.dni, d.nombre, d.sec_cod, d.sec_nombre, idCont]);
        } else {
            const n = await client.query("INSERT INTO contribuyentes (codigo_municipal, dni_ruc, nombre_completo, sec_cod, sec_nombre) VALUES ($1,$2,$3,$4,$5) RETURNING id_contribuyente",
                [d.codigo, d.dni, d.nombre, d.sec_cod, d.sec_nombre]);
            idCont = n.rows[0].id_contribuyente;
        }

        const pre = await client.query("SELECT id_predio FROM predios WHERE id_contribuyente=$1", [idCont]);
        if (pre.rows.length === 0) {
            await client.query(`INSERT INTO predios (id_contribuyente, id_calle, numero_casa, referencia_direccion, agua_sn, desague_sn, limpieza_sn, activo_sn, tipo_tarifa, ultima_act, id_tarifa, estado_servicio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'ACTIVO')`,
                [idCont, idCalle, d.dir_numero, d.dir_referencia, d.agua, d.desague, d.limpieza, d.activo, d.tarifa, d.ultima_act]);
        } else {
             await client.query(`UPDATE predios SET id_calle=$1, numero_casa=$2, referencia_direccion=$3, agua_sn=$4, desague_sn=$5, limpieza_sn=$6, activo_sn=$7, tipo_tarifa=$8, ultima_act=$9 WHERE id_predio=$10`,
                [idCalle, d.dir_numero, d.dir_referencia, d.agua, d.desague, d.limpieza, d.activo, d.tarifa, d.ultima_act, pre.rows[0].id_predio]);
        }
        count++;
    }

    await client.query('COMMIT');
    res.json({ mensaje: `Procesados: ${count}` });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ error: "Error import: " + err.message }); } finally { client.release(); }
});

// ==========================================
// SERVIR FRONTEND EN PRODUCCIÓN
// ==========================================
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const SERVER_PORT = process.env.SERVER_PORT || 5000;
app.listen(SERVER_PORT, () => {
  console.log(`Servidor corriendo en puerto ${SERVER_PORT}`);
});
