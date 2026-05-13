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
    apply: false
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.backup) {
    throw new Error("Debe indicar --backup <ruta.sql>");
  }
  const backupPath = path.resolve(args.backup);
  const fechaDesde = toIsoDate(args.fechaDesde);
  const fechaHasta = toIsoDate(args.fechaHasta);
  const usuariosSet = new Set((args.usuarios || []).map((v) => String(v || "").trim()).filter(Boolean));
  const backupRows = parseBackupPagos(backupPath).filter((row) => {
    const fecha = String(row.fecha_pago || "").slice(0, 10);
    if (fechaDesde && fecha < fechaDesde) return false;
    if (fechaHasta && fecha > fechaHasta) return false;
    if (usuariosSet.size > 0 && !usuariosSet.has(String(row.usuario_cajero || ""))) return false;
    return true;
  });

  const client = await pool.connect();
  try {
    const ids = backupRows.map((row) => row.id_pago).filter((id) => id > 0);
    const recibos = Array.from(new Set(backupRows.map((row) => row.id_recibo).filter((id) => id > 0)));
    const existentesRs = ids.length > 0
      ? await client.query("SELECT id_pago FROM pagos WHERE id_pago = ANY($1::bigint[])", [ids])
      : { rows: [] };
    const anuladosRs = ids.length > 0
      ? await client.query("SELECT id_pago_original FROM pagos_anulados WHERE id_pago_original = ANY($1::bigint[])", [ids])
      : { rows: [] };
    const recibosExistentesRs = recibos.length > 0
      ? await client.query("SELECT id_recibo FROM recibos WHERE id_recibo = ANY($1::int[])", [recibos])
      : { rows: [] };

    const existingIds = new Set(existentesRs.rows.map((r) => Number(r.id_pago)));
    const anuladosIds = new Set(anuladosRs.rows.map((r) => Number(r.id_pago_original)));
    const recibosExistentes = new Set(recibosExistentesRs.rows.map((r) => Number(r.id_recibo)));

    const restoreRows = backupRows.filter((row) =>
      row.id_pago > 0
      && row.id_recibo > 0
      && !existingIds.has(row.id_pago)
      && !anuladosIds.has(row.id_pago)
      && recibosExistentes.has(row.id_recibo)
    );

    console.log("RESUMEN FILTRADO:");
    console.log(JSON.stringify(summarize(backupRows), null, 2));
    console.log("RESUMEN A RESTAURAR:");
    console.log(JSON.stringify(summarize(restoreRows), null, 2));

    if (!args.apply) {
      console.log("Modo simulacion. Agregue --apply para restaurar.");
      return;
    }

    if (restoreRows.length === 0) {
      console.log("No hay pagos por restaurar.");
      return;
    }

    await client.query("BEGIN");
    const chunkSize = 500;
    for (let offset = 0; offset < restoreRows.length; offset += chunkSize) {
      const chunk = restoreRows.slice(offset, offset + chunkSize);
      const values = [];
      const params = [];
      chunk.forEach((row, idx) => {
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
        ON CONFLICT (id_pago) DO NOTHING
      `, params);
    }

    if (recibos.length > 0) {
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
    await client.query("COMMIT");
    console.log(`Restaurados ${restoreRows.length} pagos desde backup.`);
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
