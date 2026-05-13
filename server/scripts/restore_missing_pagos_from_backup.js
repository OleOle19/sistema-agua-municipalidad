require("../load-env");

const fs = require("fs");
const path = require("path");
const pool = require("../db");

const parseArgs = (argv = []) => {
  const out = {
    backup: null,
    fechaDesde: null,
    fechaHasta: null,
    usuarios: [],
    apply: false,
    overwriteExisting: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "").trim();
    const next = argv[i + 1];
    if (arg === "--backup" && next) {
      out.backup = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--backup=")) {
      out.backup = arg.slice("--backup=".length);
      continue;
    }
    if (arg === "--fecha-desde" && next) {
      out.fechaDesde = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--fecha-desde=")) {
      out.fechaDesde = arg.slice("--fecha-desde=".length);
      continue;
    }
    if (arg === "--fecha-hasta" && next) {
      out.fechaHasta = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--fecha-hasta=")) {
      out.fechaHasta = arg.slice("--fecha-hasta=".length);
      continue;
    }
    if (arg === "--usuarios" && next) {
      out.usuarios = String(next).split(",").map((v) => v.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    if (arg.startsWith("--usuarios=")) {
      out.usuarios = arg.slice("--usuarios=".length).split(",").map((v) => v.trim()).filter(Boolean);
      continue;
    }
    if (arg === "--apply") {
      out.apply = true;
      continue;
    }
    if (arg === "--overwrite-existing") {
      out.overwriteExisting = true;
    }
  }
  return out;
};

const toIsoDate = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};

const parseBackupPagos = (backupPath) => {
  const text = fs.readFileSync(backupPath, "utf8");
  const start = text.indexOf("COPY public.pagos ");
  if (start < 0) throw new Error("No se encontro COPY public.pagos en el backup.");
  const lines = text.slice(start).split(/\r?\n/);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "\\.") break;
    if (!line.trim()) continue;
    const parts = line.split("\t");
    rows.push({
      id_pago: Number(parts[0] || 0),
      id_recibo: Number(parts[1] || 0),
      fecha_pago: parts[2] || null,
      monto_pagado: Number(parts[3] || 0),
      metodo_pago: parts[4] === "\\N" ? null : parts[4],
      usuario_cajero: parts[5] === "\\N" ? null : parts[5],
      id_orden_cobro: parts[6] === "\\N" ? null : Number(parts[6] || 0)
    });
  }
  return rows;
};

const parseBackupRecibos = (backupPath) => {
  const text = fs.readFileSync(backupPath, "utf8");
  const start = text.indexOf("COPY public.recibos ");
  if (start < 0) throw new Error("No se encontro COPY public.recibos en el backup.");
  const lines = text.slice(start).split(/\r?\n/);
  const rows = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "\\.") break;
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const idRecibo = Number(parts[0] || 0);
    if (!(idRecibo > 0)) continue;
    rows.set(idRecibo, {
      id_predio: Number(parts[1] || 0),
      anio: Number(parts[2] || 0),
      mes: Number(parts[3] || 0),
      fecha_emision: parts[4] === "\\N" ? null : parts[4],
      fecha_vencimiento: parts[5] === "\\N" ? null : parts[5],
      subtotal_agua: Number(parts[6] || 0),
      subtotal_desague: Number(parts[7] || 0),
      subtotal_limpieza: Number(parts[8] || 0),
      subtotal_admin: Number(parts[9] || 0),
      lectura_anterior: Number(parts[10] || 0),
      lectura_actual: Number(parts[11] || 0),
      total_pagar: Number(parts[12] || 0),
      estado: parts[13] === "\\N" ? null : parts[13]
    });
  }
  return rows;
};

const parseBackupContribuyentes = (backupPath) => {
  const text = fs.readFileSync(backupPath, "utf8");
  const start = text.indexOf("COPY public.contribuyentes ");
  if (start < 0) throw new Error("No se encontro COPY public.contribuyentes en el backup.");
  const lines = text.slice(start).split(/\r?\n/);
  const rows = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "\\.") break;
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const idContribuyente = Number(parts[0] || 0);
    if (!(idContribuyente > 0)) continue;
    rows.set(idContribuyente, {
      id_contribuyente: idContribuyente,
      codigo_municipal: parts[1] === "\\N" ? null : parts[1],
      dni_ruc: parts[2] === "\\N" ? null : parts[2],
      nombre_completo: parts[3] === "\\N" ? null : parts[3],
      telefono: parts[4] === "\\N" ? null : parts[4],
      email: parts[5] === "\\N" ? null : parts[5],
      fecha_registro: parts[6] === "\\N" ? null : parts[6],
      sec_cod: parts[7] === "\\N" ? null : parts[7],
      sec_nombre: parts[8] === "\\N" ? null : parts[8],
      estado_conexion: parts[9] === "\\N" ? null : parts[9],
      estado_conexion_fuente: parts[10] === "\\N" ? null : parts[10],
      estado_conexion_verificado_sn: parts[11] === "\\N" ? null : parts[11],
      estado_conexion_fecha_verificacion: parts[12] === "\\N" ? null : parts[12],
      estado_conexion_motivo_ultimo: parts[13] === "\\N" ? null : parts[13],
      razon_social_motivo_ultimo: parts[14] === "\\N" ? null : parts[14],
      razon_social_actualizado_en: parts[15] === "\\N" ? null : parts[15]
    });
  }
  return rows;
};

const parseBackupPredios = (backupPath) => {
  const text = fs.readFileSync(backupPath, "utf8");
  const start = text.indexOf("COPY public.predios ");
  if (start < 0) throw new Error("No se encontro COPY public.predios en el backup.");
  const lines = text.slice(start).split(/\r?\n/);
  const rows = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "\\.") break;
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const idPredio = Number(parts[0] || 0);
    if (!(idPredio > 0)) continue;
    rows.set(idPredio, {
      id_predio: idPredio,
      id_contribuyente: Number(parts[1] || 0),
      id_calle: parts[2] === "\\N" ? null : Number(parts[2] || 0),
      numero_casa: parts[3] === "\\N" ? null : parts[3],
      manzana: parts[4] === "\\N" ? null : parts[4],
      lote: parts[5] === "\\N" ? null : parts[5],
      referencia: parts[6] === "\\N" ? null : parts[6],
      id_tarifa: parts[7] === "\\N" ? null : Number(parts[7] || 0),
      estado_servicio: parts[8] === "\\N" ? null : parts[8],
      referencia_direccion: parts[9] === "\\N" ? null : parts[9],
      agua_sn: parts[10] === "\\N" ? null : parts[10],
      desague_sn: parts[11] === "\\N" ? null : parts[11],
      limpieza_sn: parts[12] === "\\N" ? null : parts[12],
      activo_sn: parts[13] === "\\N" ? null : parts[13],
      tipo_tarifa: parts[14] === "\\N" ? null : parts[14],
      ultima_act: parts[15] === "\\N" ? null : parts[15],
      direccion_alterna: parts[16] === "\\N" ? null : parts[16],
      tarifa_agua: parts[17] === "\\N" ? null : Number(parts[17] || 0),
      tarifa_desague: parts[18] === "\\N" ? null : Number(parts[18] || 0),
      tarifa_limpieza: parts[19] === "\\N" ? null : Number(parts[19] || 0),
      tarifa_admin: parts[20] === "\\N" ? null : Number(parts[20] || 0),
      tarifa_extra: parts[21] === "\\N" ? null : Number(parts[21] || 0)
    });
  }
  return rows;
};

const summarize = (rows = []) => {
  const byFecha = {};
  const byUsuario = {};
  let total = 0;
  for (const row of rows) {
    const monto = Number(row.monto_pagado || 0) || 0;
    total += monto;
    const fecha = String(row.fecha_pago || "").slice(0, 10) || "(null)";
    const usuario = row.usuario_cajero || "(null)";
    byFecha[fecha] = (Number(byFecha[fecha] || 0) + monto);
    byUsuario[usuario] = (Number(byUsuario[usuario] || 0) + monto);
  }
  Object.keys(byFecha).forEach((key) => { byFecha[key] = Number(byFecha[key] || 0).toFixed(2); });
  Object.keys(byUsuario).forEach((key) => { byUsuario[key] = Number(byUsuario[key] || 0).toFixed(2); });
  return {
    filas: rows.length,
    total: total.toFixed(2),
    por_fecha: byFecha,
    por_usuario: byUsuario
  };
};

const buildReceiptEntriesFromBackup = (backupRows = [], backupRecibosMap = new Map()) => {
  const receiptEntries = [];
  const seen = new Set();
  for (const row of backupRows) {
    const oldIdRecibo = Number(row.id_recibo || 0);
    if (!(oldIdRecibo > 0) || seen.has(oldIdRecibo)) continue;
    seen.add(oldIdRecibo);
    const backupRecibo = backupRecibosMap.get(oldIdRecibo);
    if (!backupRecibo) continue;
    if (!(backupRecibo.id_predio > 0) || !(backupRecibo.anio > 0) || !(backupRecibo.mes > 0)) continue;
    receiptEntries.push({
      id_recibo_backup: oldIdRecibo,
      id_predio: backupRecibo.id_predio,
      anio: backupRecibo.anio,
      mes: backupRecibo.mes,
      fecha_emision: backupRecibo.fecha_emision,
      fecha_vencimiento: backupRecibo.fecha_vencimiento,
      subtotal_agua: Number(backupRecibo.subtotal_agua || 0),
      subtotal_desague: Number(backupRecibo.subtotal_desague || 0),
      subtotal_limpieza: Number(backupRecibo.subtotal_limpieza || 0),
      subtotal_admin: Number(backupRecibo.subtotal_admin || 0),
      lectura_anterior: Number(backupRecibo.lectura_anterior || 0),
      lectura_actual: Number(backupRecibo.lectura_actual || 0),
      total_pagar: Number(backupRecibo.total_pagar || 0),
      estado: backupRecibo.estado || "PENDIENTE"
    });
  }
  return receiptEntries;
};

const resolveRecibosFromEntries = async (client, receiptEntries = []) => {
  if (receiptEntries.length === 0) {
    return new Map();
  }

  const chunkSize = 1000;
  const resolved = new Map();
  for (let offset = 0; offset < receiptEntries.length; offset += chunkSize) {
    const chunk = receiptEntries.slice(offset, offset + chunkSize);
    const values = [];
    const params = [];
    chunk.forEach((entry, idx) => {
      const base = idx * 4;
      values.push(`($${base + 1}::int, $${base + 2}::int, $${base + 3}::int, $${base + 4}::int)`);
      params.push(entry.id_recibo_backup, entry.id_predio, entry.anio, entry.mes);
    });
    const rs = await client.query(`
      SELECT
        v.id_recibo_backup,
        r.id_recibo AS id_recibo_actual
      FROM (VALUES ${values.join(", ")}) AS v(id_recibo_backup, id_predio, anio, mes)
      LEFT JOIN recibos r
        ON r.id_predio = v.id_predio
       AND r.anio = v.anio
       AND r.mes = v.mes
    `, params);
    rs.rows.forEach((row) => {
      const oldIdRecibo = Number(row.id_recibo_backup || 0);
      const currentIdRecibo = Number(row.id_recibo_actual || 0);
      if (oldIdRecibo > 0 && currentIdRecibo > 0) {
        resolved.set(oldIdRecibo, currentIdRecibo);
      }
    });
  }
  return resolved;
};

const ensureRecibosFromEntries = async (client, receiptEntries = [], resolvedMap = new Map()) => {
  const missingEntries = receiptEntries.filter((entry) => !resolvedMap.has(entry.id_recibo_backup));
  if (missingEntries.length === 0) {
    return { creados: 0 };
  }

  const chunkSize = 500;
  let creados = 0;
  for (let offset = 0; offset < missingEntries.length; offset += chunkSize) {
    const chunk = missingEntries.slice(offset, offset + chunkSize);
    const values = [];
    const params = [];
    chunk.forEach((entry, idx) => {
      const base = idx * 13;
      values.push(`($${base + 1}::int, $${base + 2}::int, $${base + 3}::int, $${base + 4}::date, $${base + 5}::date, $${base + 6}::numeric, $${base + 7}::numeric, $${base + 8}::numeric, $${base + 9}::numeric, $${base + 10}::numeric, $${base + 11}::numeric, $${base + 12}::numeric, $${base + 13}::varchar)`);
      params.push(
        entry.id_predio,
        entry.anio,
        entry.mes,
        entry.fecha_emision,
        entry.fecha_vencimiento,
        entry.subtotal_agua,
        entry.subtotal_desague,
        entry.subtotal_limpieza,
        entry.subtotal_admin,
        entry.lectura_anterior,
        entry.lectura_actual,
        entry.total_pagar,
        entry.estado || "PENDIENTE"
      );
    });
    const rs = await client.query(`
      WITH input AS (
        SELECT *
        FROM (VALUES ${values.join(", ")}) AS v(
          id_predio, anio, mes, fecha_emision, fecha_vencimiento,
          subtotal_agua, subtotal_desague, subtotal_limpieza, subtotal_admin,
          lectura_anterior, lectura_actual, total_pagar, estado
        )
      )
      INSERT INTO recibos (
        id_predio, anio, mes, fecha_emision, fecha_vencimiento,
        subtotal_agua, subtotal_desague, subtotal_limpieza, subtotal_admin,
        lectura_anterior, lectura_actual, total_pagar, estado
      )
      SELECT
        i.id_predio,
        i.anio,
        i.mes,
        i.fecha_emision,
        i.fecha_vencimiento,
        i.subtotal_agua,
        i.subtotal_desague,
        i.subtotal_limpieza,
        i.subtotal_admin,
        i.lectura_anterior,
        i.lectura_actual,
        i.total_pagar,
        COALESCE(NULLIF(TRIM(i.estado), ''), 'PENDIENTE')
      FROM input i
      JOIN predios pr ON pr.id_predio = i.id_predio
      LEFT JOIN recibos r
        ON r.id_predio = i.id_predio
       AND r.anio = i.anio
       AND r.mes = i.mes
      WHERE r.id_recibo IS NULL
      RETURNING id_recibo
    `, params);
    creados += Number(rs.rowCount || 0);
  }

  return { creados };
};

const ensureContribuyentesFromBackup = async (client, receiptEntries = [], backupPrediosMap = new Map(), backupContribuyentesMap = new Map()) => {
  const neededIds = new Set();
  for (const entry of receiptEntries) {
    const predio = backupPrediosMap.get(Number(entry.id_predio || 0));
    const idContribuyente = Number(predio?.id_contribuyente || 0);
    if (idContribuyente > 0) {
      neededIds.add(idContribuyente);
    }
  }
  const ids = Array.from(neededIds);
  if (ids.length === 0) {
    return { creados: 0 };
  }

  const existentesRs = await client.query("SELECT id_contribuyente FROM contribuyentes WHERE id_contribuyente = ANY($1::int[])", [ids]);
  const existing = new Set(existentesRs.rows.map((row) => Number(row.id_contribuyente || 0)));
  const missing = ids
    .filter((id) => !existing.has(id))
    .map((id) => backupContribuyentesMap.get(id))
    .filter(Boolean);
  if (missing.length === 0) {
    return { creados: 0 };
  }

  const chunkSize = 250;
  let creados = 0;
  for (let offset = 0; offset < missing.length; offset += chunkSize) {
    const chunk = missing.slice(offset, offset + chunkSize);
    const values = [];
    const params = [];
    chunk.forEach((entry, idx) => {
      const base = idx * 16;
      values.push(`($${base + 1}::int, $${base + 2}::varchar, $${base + 3}::varchar, $${base + 4}::varchar, $${base + 5}::varchar, $${base + 6}::varchar, $${base + 7}::timestamp, $${base + 8}::varchar, $${base + 9}::varchar, $${base + 10}::varchar, $${base + 11}::varchar, $${base + 12}::varchar, $${base + 13}::date, $${base + 14}::text, $${base + 15}::text, $${base + 16}::timestamp)`);
      params.push(
        entry.id_contribuyente,
        entry.codigo_municipal,
        entry.dni_ruc,
        entry.nombre_completo,
        entry.telefono,
        entry.email,
        entry.fecha_registro,
        entry.sec_cod,
        entry.sec_nombre,
        entry.estado_conexion || "CON_CONEXION",
        entry.estado_conexion_fuente || "IMPORTACION",
        entry.estado_conexion_verificado_sn || "N",
        entry.estado_conexion_fecha_verificacion,
        entry.estado_conexion_motivo_ultimo,
        entry.razon_social_motivo_ultimo,
        entry.razon_social_actualizado_en
      );
    });
    const rs = await client.query(`
      INSERT INTO contribuyentes (
        id_contribuyente, codigo_municipal, dni_ruc, nombre_completo, telefono, email,
        fecha_registro, sec_cod, sec_nombre, estado_conexion, estado_conexion_fuente,
        estado_conexion_verificado_sn, estado_conexion_fecha_verificacion,
        estado_conexion_motivo_ultimo, razon_social_motivo_ultimo, razon_social_actualizado_en
      )
      VALUES ${values.join(", ")}
      ON CONFLICT (id_contribuyente) DO NOTHING
    `, params);
    creados += Number(rs.rowCount || 0);
  }
  return { creados };
};

const ensurePrediosFromBackup = async (client, receiptEntries = [], backupPrediosMap = new Map()) => {
  const neededIds = new Set(receiptEntries.map((entry) => Number(entry.id_predio || 0)).filter((id) => id > 0));
  const ids = Array.from(neededIds);
  if (ids.length === 0) {
    return { creados: 0 };
  }

  const existentesRs = await client.query("SELECT id_predio FROM predios WHERE id_predio = ANY($1::int[])", [ids]);
  const existing = new Set(existentesRs.rows.map((row) => Number(row.id_predio || 0)));
  const missing = ids
    .filter((id) => !existing.has(id))
    .map((id) => backupPrediosMap.get(id))
    .filter(Boolean);
  if (missing.length === 0) {
    return { creados: 0 };
  }

  const chunkSize = 250;
  let creados = 0;
  for (let offset = 0; offset < missing.length; offset += chunkSize) {
    const chunk = missing.slice(offset, offset + chunkSize);
    const values = [];
    const params = [];
    chunk.forEach((entry, idx) => {
      const base = idx * 22;
      values.push(`($${base + 1}::int, $${base + 2}::int, $${base + 3}::int, $${base + 4}::varchar, $${base + 5}::varchar, $${base + 6}::varchar, $${base + 7}::text, $${base + 8}::int, $${base + 9}::varchar, $${base + 10}::text, $${base + 11}::char, $${base + 12}::char, $${base + 13}::char, $${base + 14}::char, $${base + 15}::varchar, $${base + 16}::timestamp, $${base + 17}::text, $${base + 18}::numeric, $${base + 19}::numeric, $${base + 20}::numeric, $${base + 21}::numeric, $${base + 22}::numeric)`);
      params.push(
        entry.id_predio,
        entry.id_contribuyente,
        entry.id_calle,
        entry.numero_casa,
        entry.manzana,
        entry.lote,
        entry.referencia,
        entry.id_tarifa,
        entry.estado_servicio || "ACTIVO",
        entry.referencia_direccion,
        entry.agua_sn || "S",
        entry.desague_sn || "S",
        entry.limpieza_sn || "S",
        entry.activo_sn || "S",
        entry.tipo_tarifa,
        entry.ultima_act,
        entry.direccion_alterna,
        entry.tarifa_agua,
        entry.tarifa_desague,
        entry.tarifa_limpieza,
        entry.tarifa_admin,
        entry.tarifa_extra
      );
    });
    const rs = await client.query(`
      INSERT INTO predios (
        id_predio, id_contribuyente, id_calle, numero_casa, manzana, lote, referencia,
        id_tarifa, estado_servicio, referencia_direccion, agua_sn, desague_sn, limpieza_sn,
        activo_sn, tipo_tarifa, ultima_act, direccion_alterna, tarifa_agua, tarifa_desague,
        tarifa_limpieza, tarifa_admin, tarifa_extra
      )
      SELECT
        v.id_predio, v.id_contribuyente, v.id_calle, v.numero_casa, v.manzana, v.lote, v.referencia,
        v.id_tarifa, COALESCE(NULLIF(TRIM(v.estado_servicio), ''), 'ACTIVO'), v.referencia_direccion,
        COALESCE(NULLIF(TRIM(v.agua_sn), ''), 'S'), COALESCE(NULLIF(TRIM(v.desague_sn), ''), 'S'),
        COALESCE(NULLIF(TRIM(v.limpieza_sn), ''), 'S'), COALESCE(NULLIF(TRIM(v.activo_sn), ''), 'S'),
        v.tipo_tarifa, v.ultima_act, v.direccion_alterna, v.tarifa_agua, v.tarifa_desague,
        v.tarifa_limpieza, v.tarifa_admin, v.tarifa_extra
      FROM (VALUES ${values.join(", ")}) AS v(
        id_predio, id_contribuyente, id_calle, numero_casa, manzana, lote, referencia,
        id_tarifa, estado_servicio, referencia_direccion, agua_sn, desague_sn, limpieza_sn,
        activo_sn, tipo_tarifa, ultima_act, direccion_alterna, tarifa_agua, tarifa_desague,
        tarifa_limpieza, tarifa_admin, tarifa_extra
      )
      JOIN contribuyentes c ON c.id_contribuyente = v.id_contribuyente
      ON CONFLICT (id_predio) DO NOTHING
    `, params);
    creados += Number(rs.rowCount || 0);
  }
  return { creados };
};

const recalculateRecibosEstado = async (client, recibos = []) => {
  if (!Array.isArray(recibos) || recibos.length === 0) return;
  await client.query(`
    WITH pagos_totales AS (
      SELECT
        r.id_recibo,
        COALESCE(SUM(p.monto_pagado), 0)::numeric AS total_pagado
      FROM recibos r
      LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
      WHERE r.id_recibo = ANY($1::int[])
      GROUP BY r.id_recibo
    )
    UPDATE recibos r
    SET estado = CASE
      WHEN COALESCE(r.total_pagar, 0) <= 0.001 THEN 'PAGADO'
      WHEN COALESCE(pt.total_pagado, 0) >= COALESCE(r.total_pagar, 0) - 0.001 THEN 'PAGADO'
      WHEN COALESCE(pt.total_pagado, 0) > 0.001 THEN 'PARCIAL'
      ELSE 'PENDIENTE'
    END
    FROM pagos_totales pt
    WHERE r.id_recibo = pt.id_recibo
  `, [recibos]);
};

const insertPagosChunk = async (client, rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const values = [];
  const params = [];
  rows.forEach((row, idx) => {
    const base = idx * 7;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
    params.push(
      row.id_pago,
      row.id_recibo,
      row.fecha_pago,
      row.monto_pagado,
      row.metodo_pago,
      row.usuario_cajero,
      row.id_orden_cobro
    );
  });
  await client.query(`
    INSERT INTO pagos (
      id_pago, id_recibo, fecha_pago, monto_pagado, metodo_pago, usuario_cajero, id_orden_cobro
    )
    VALUES ${values.join(", ")}
    ON CONFLICT (id_pago) DO UPDATE
    SET id_recibo = EXCLUDED.id_recibo,
        fecha_pago = EXCLUDED.fecha_pago,
        monto_pagado = EXCLUDED.monto_pagado,
        metodo_pago = EXCLUDED.metodo_pago,
        usuario_cajero = EXCLUDED.usuario_cajero,
        id_orden_cobro = EXCLUDED.id_orden_cobro
  `, params);
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.backup) {
    throw new Error("Debe indicar --backup <ruta.sql>");
  }
  const backupPath = path.resolve(args.backup);
  const fechaDesde = toIsoDate(args.fechaDesde);
  const fechaHasta = toIsoDate(args.fechaHasta);
  const overwriteExisting = args.overwriteExisting === true;
  const usuariosSet = new Set((args.usuarios || []).map((v) => String(v || "").trim()).filter(Boolean));
  const backupRowsRaw = parseBackupPagos(backupPath).filter((row) => {
    const fecha = String(row.fecha_pago || "").slice(0, 10);
    if (fechaDesde && fecha < fechaDesde) return false;
    if (fechaHasta && fecha > fechaHasta) return false;
    if (usuariosSet.size > 0 && !usuariosSet.has(String(row.usuario_cajero || ""))) return false;
    return true;
  });
  const backupRecibosMap = parseBackupRecibos(backupPath);
  const backupContribuyentesMap = parseBackupContribuyentes(backupPath);
  const backupPrediosMap = parseBackupPredios(backupPath);

  const client = await pool.connect();
  try {
    const receiptEntries = buildReceiptEntriesFromBackup(backupRowsRaw, backupRecibosMap);
    let receiptResolution = await resolveRecibosFromEntries(client, receiptEntries);
    let backupRows = backupRowsRaw.map((row) => ({
      ...row,
      id_recibo_backup: row.id_recibo,
      id_recibo: Number(receiptResolution.get(Number(row.id_recibo || 0)) || 0)
    }));
    let unresolvedRows = backupRows.filter((row) => !(Number(row.id_recibo || 0) > 0));
    let recibos = Array.from(new Set(backupRows.map((row) => row.id_recibo).filter((id) => id > 0)));
    let recibosCreados = 0;
    let contribuyentesCreados = 0;
    let prediosCreados = 0;
    let ids = backupRows.map((row) => row.id_pago).filter((id) => id > 0);
    const existentesRs = ids.length > 0
      ? await client.query("SELECT id_pago FROM pagos WHERE id_pago = ANY($1::bigint[])", [ids])
      : { rows: [] };
    const anuladosRs = ids.length > 0
      ? await client.query("SELECT id_pago_original FROM pagos_anulados WHERE id_pago_original = ANY($1::bigint[])", [ids])
      : { rows: [] };

    const existingIds = new Set(existentesRs.rows.map((r) => Number(r.id_pago)));
    const anuladosIds = new Set(anuladosRs.rows.map((r) => Number(r.id_pago_original)));

    let restoreRows = backupRows.filter((row) => {
      if (!(row.id_pago > 0) || !(row.id_recibo > 0)) {
        return false;
      }
      if (overwriteExisting) {
        return true;
      }
      return !existingIds.has(row.id_pago) && !anuladosIds.has(row.id_pago);
    });

    console.log("RESUMEN FILTRADO:");
    console.log(JSON.stringify(summarize(backupRowsRaw), null, 2));
    console.log(overwriteExisting ? "RESUMEN A SOBRESCRIBIR:" : "RESUMEN A RESTAURAR:");
    console.log(JSON.stringify(summarize(restoreRows), null, 2));
    if (unresolvedRows.length > 0) {
      console.log("RESUMEN SIN RECIBO ACTUAL EQUIVALENTE:");
      console.log(JSON.stringify(summarize(unresolvedRows), null, 2));
    }

    if (!args.apply) {
      console.log(overwriteExisting
        ? "Modo simulacion. Agregue --apply para sobrescribir pagos desde el backup."
        : "Modo simulacion. Agregue --apply para restaurar.");
      return;
    }

    if (restoreRows.length === 0) {
      console.log(overwriteExisting ? "No hay pagos validos por sobrescribir." : "No hay pagos por restaurar.");
      return;
    }

    await client.query("BEGIN");
    const chunkSize = 500;
    if (overwriteExisting && unresolvedRows.length > 0) {
      const contribResult = await ensureContribuyentesFromBackup(client, receiptEntries, backupPrediosMap, backupContribuyentesMap);
      contribuyentesCreados = Number(contribResult.creados || 0);
      const predioResult = await ensurePrediosFromBackup(client, receiptEntries, backupPrediosMap);
      prediosCreados = Number(predioResult.creados || 0);
      const ensureResult = await ensureRecibosFromEntries(client, receiptEntries, receiptResolution);
      recibosCreados = Number(ensureResult.creados || 0);
      if (contribuyentesCreados > 0 || prediosCreados > 0 || recibosCreados > 0) {
        receiptResolution = await resolveRecibosFromEntries(client, receiptEntries);
        backupRows = backupRowsRaw.map((row) => ({
          ...row,
          id_recibo_backup: row.id_recibo,
          id_recibo: Number(receiptResolution.get(Number(row.id_recibo || 0)) || 0)
        }));
        unresolvedRows = backupRows.filter((row) => !(Number(row.id_recibo || 0) > 0));
        recibos = Array.from(new Set(backupRows.map((row) => row.id_recibo).filter((id) => id > 0)));
      }
    }

    ids = backupRows.map((row) => row.id_pago).filter((id) => id > 0);
    restoreRows = backupRows.filter((row) => {
      if (!(row.id_pago > 0) || !(row.id_recibo > 0)) {
        return false;
      }
      if (overwriteExisting) {
        return true;
      }
      return !existingIds.has(row.id_pago) && !anuladosIds.has(row.id_pago);
    });

    if (overwriteExisting) {
      const currentPagosRs = recibos.length > 0
        ? await client.query("SELECT id_pago, id_recibo FROM pagos WHERE id_recibo = ANY($1::int[])", [recibos])
        : { rows: [] };
      const currentPagoIds = currentPagosRs.rows
        .map((row) => Number(row.id_pago || 0))
        .filter((id) => id > 0);

      if (currentPagoIds.length > 0) {
        await client.query(`
          DELETE FROM pagos_correcciones
          WHERE id_pago_afectado = ANY($1::bigint[])
             OR id_pago_original = ANY($1::bigint[])
             OR id_recibo = ANY($2::int[])
        `, [currentPagoIds, recibos]);
        await client.query(`
          DELETE FROM pagos_anulados
          WHERE id_pago_original = ANY($1::bigint[])
             OR id_pago_reintegrado = ANY($1::bigint[])
             OR id_recibo = ANY($2::int[])
        `, [currentPagoIds, recibos]);
      } else {
        await client.query("DELETE FROM pagos_correcciones WHERE id_recibo = ANY($1::int[])", [recibos]);
        await client.query("DELETE FROM pagos_anulados WHERE id_recibo = ANY($1::int[])", [recibos]);
      }

      await client.query("DELETE FROM pagos WHERE id_recibo = ANY($1::int[])", [recibos]);
    }

    for (let offset = 0; offset < restoreRows.length; offset += chunkSize) {
      const chunk = restoreRows.slice(offset, offset + chunkSize);
      await insertPagosChunk(client, chunk);
    }

    if (recibos.length > 0) {
      await recalculateRecibosEstado(client, recibos);
    }

    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('pagos', 'id_pago'),
        GREATEST(
          COALESCE((SELECT MAX(id_pago) FROM pagos), 1),
          COALESCE((SELECT last_value FROM pagos_id_pago_seq), 1)
        ),
        true
      )
    `);
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('contribuyentes', 'id_contribuyente'),
        GREATEST(
          COALESCE((SELECT MAX(id_contribuyente) FROM contribuyentes), 1),
          COALESCE((SELECT last_value FROM contribuyentes_id_contribuyente_seq), 1)
        ),
        true
      )
    `);
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('predios', 'id_predio'),
        GREATEST(
          COALESCE((SELECT MAX(id_predio) FROM predios), 1),
          COALESCE((SELECT last_value FROM predios_id_predio_seq), 1)
        ),
        true
      )
    `);
    await client.query("COMMIT");
    if (contribuyentesCreados > 0) {
      console.log(`Contribuyentes recreados desde backup: ${contribuyentesCreados}.`);
    }
    if (prediosCreados > 0) {
      console.log(`Predios recreados desde backup: ${prediosCreados}.`);
    }
    if (recibosCreados > 0) {
      console.log(`Recibos recreados desde backup: ${recibosCreados}.`);
    }
    if (unresolvedRows.length > 0) {
      console.log(`Pagos omitidos por no tener recibo actual ni recreable: ${unresolvedRows.length}.`);
    }
    console.log(overwriteExisting
      ? `Sobrescritos ${restoreRows.length} pagos desde backup.`
      : `Restaurados ${restoreRows.length} pagos desde backup.`);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("ERROR:", error);
  process.exit(1);
});
