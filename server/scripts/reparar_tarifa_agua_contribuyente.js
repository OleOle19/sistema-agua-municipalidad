const pool = require("../db");

const EPS = 0.001;

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function parseMonto(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const raw = String(value).trim().replace(",", ".");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? round2(parsed) : fallback;
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parsePeriodo(periodo) {
  const raw = String(periodo || "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) {
    throw new Error(`Periodo invalido: ${raw}. Usa YYYY-MM.`);
  }
  const anio = Number(raw.slice(0, 4));
  const mes = Number(raw.slice(5, 7));
  if (mes < 1 || mes > 12) {
    throw new Error(`Mes invalido en periodo: ${raw}.`);
  }
  return { raw, anio, mes };
}

function parseArgs(argv) {
  const options = {
    apply: false,
    idContribuyente: 0,
    codigoMunicipal: "",
    tarifaAgua: null,
    allowMultiplePredios: false,
    periodos: []
  };

  argv.forEach((arg) => {
    if (arg === "--apply") {
      options.apply = true;
      return;
    }
    if (arg === "--allow-multiple-predios") {
      options.allowMultiplePredios = true;
      return;
    }
    if (arg.startsWith("--id-contribuyente=")) {
      options.idContribuyente = parsePositiveInt(arg.split("=")[1]);
      return;
    }
    if (arg.startsWith("--codigo-municipal=")) {
      options.codigoMunicipal = String(arg.split("=")[1] || "").trim();
      return;
    }
    if (arg.startsWith("--tarifa-agua=")) {
      options.tarifaAgua = parseMonto(arg.split("=")[1], "__INVALID__");
      return;
    }
    if (arg.startsWith("--periodos=")) {
      const raw = String(arg.split("=")[1] || "").trim();
      options.periodos = raw
        ? raw.split(",").map((item) => parsePeriodo(item))
        : [];
    }
  });

  if (!options.idContribuyente && !options.codigoMunicipal) {
    throw new Error("Debes indicar --id-contribuyente=... o --codigo-municipal=...");
  }
  if (options.tarifaAgua === "__INVALID__" || options.tarifaAgua === null || options.tarifaAgua < 0) {
    throw new Error("Debes indicar --tarifa-agua=... con un monto valido mayor o igual a 0.");
  }
  if (!Array.isArray(options.periodos) || options.periodos.length === 0) {
    throw new Error("Debes indicar --periodos=YYYY-MM[,YYYY-MM...]");
  }

  return options;
}

function buildPeriodoTuples(periodos = []) {
  const params = [];
  const tuples = periodos.map((periodo, index) => {
    params.push(periodo.anio, periodo.mes);
    const offset = index * 2;
    return `($${offset + 2}::int, $${offset + 3}::int)`;
  });
  return { tuples, params };
}

function determineEstado(totalPagado, totalRecibo) {
  if (totalRecibo <= EPS) return "PAGADO";
  if (totalPagado >= totalRecibo - EPS) return "PAGADO";
  if (totalPagado > EPS) return "PARCIAL";
  return "PENDIENTE";
}

function printUsage() {
  console.log(`
Uso:
  node server/scripts/reparar_tarifa_agua_contribuyente.js --codigo-municipal=002663 --tarifa-agua=7.50 --periodos=2026-02,2026-03
  node server/scripts/reparar_tarifa_agua_contribuyente.js --codigo-municipal=002663 --tarifa-agua=7.50 --periodos=2026-02,2026-03 --apply
`);
}

async function loadTarget(client, options) {
  const whereSql = options.idContribuyente
    ? "c.id_contribuyente = $1"
    : "TRIM(c.codigo_municipal) = $1";
  const value = options.idContribuyente || options.codigoMunicipal;
  const rs = await client.query(`
    SELECT
      c.id_contribuyente,
      TRIM(c.codigo_municipal) AS codigo_municipal,
      TRIM(c.nombre_completo) AS nombre_completo,
      COUNT(p.id_predio)::int AS total_predios,
      ARRAY_AGG(p.id_predio ORDER BY p.id_predio) AS predios,
      MIN(p.tarifa_agua) AS tarifa_agua_actual
    FROM contribuyentes c
    JOIN predios p ON p.id_contribuyente = c.id_contribuyente
    WHERE ${whereSql}
    GROUP BY c.id_contribuyente, c.codigo_municipal, c.nombre_completo
  `, [value]);
  return rs.rows[0] || null;
}

async function loadRecibos(client, idContribuyente, periodos) {
  const { tuples, params } = buildPeriodoTuples(periodos);
  return client.query(`
    WITH pagos_por_recibo AS (
      SELECT id_recibo, COALESCE(SUM(monto_pagado), 0)::numeric AS total_pagado
      FROM pagos
      GROUP BY id_recibo
    )
    SELECT
      r.id_recibo,
      r.id_predio,
      r.anio,
      r.mes,
      COALESCE(r.subtotal_agua, 0)::numeric AS subtotal_agua,
      COALESCE(r.subtotal_desague, 0)::numeric AS subtotal_desague,
      COALESCE(r.subtotal_limpieza, 0)::numeric AS subtotal_limpieza,
      COALESCE(r.subtotal_admin, 0)::numeric AS subtotal_admin,
      COALESCE(r.total_pagar, 0)::numeric AS total_pagar,
      COALESCE(r.estado, 'PENDIENTE') AS estado,
      COALESCE(pg.total_pagado, 0)::numeric AS total_pagado
    FROM recibos r
    JOIN predios p ON p.id_predio = r.id_predio
    LEFT JOIN pagos_por_recibo pg ON pg.id_recibo = r.id_recibo
    WHERE p.id_contribuyente = $1
      AND (r.anio, r.mes) IN (${tuples.join(", ")})
    ORDER BY r.anio, r.mes, r.id_predio, r.id_recibo
  `, [idContribuyente, ...params]);
}

function buildPreviewRows(rows, tarifaAgua) {
  return rows.map((row) => {
    const subtotalAguaActual = round2(row.subtotal_agua);
    const subtotalDesague = round2(row.subtotal_desague);
    const subtotalLimpieza = round2(row.subtotal_limpieza);
    const subtotalAdmin = round2(row.subtotal_admin);
    const totalPagado = round2(row.total_pagado);
    const nuevoAgua = subtotalAguaActual > 0 ? round2(tarifaAgua) : subtotalAguaActual;
    const totalNuevo = round2(nuevoAgua + subtotalDesague + subtotalLimpieza + subtotalAdmin);
    const aplicable = totalPagado <= totalNuevo + EPS;
    return {
      id_recibo: Number(row.id_recibo),
      id_predio: Number(row.id_predio),
      periodo: `${String(row.anio).padStart(4, "0")}-${String(row.mes).padStart(2, "0")}`,
      subtotal_agua_actual: subtotalAguaActual,
      subtotal_agua_nuevo: nuevoAgua,
      total_actual: round2(row.total_pagar),
      total_nuevo: totalNuevo,
      total_pagado: totalPagado,
      estado_actual: String(row.estado || "").trim().toUpperCase() || "PENDIENTE",
      estado_nuevo: determineEstado(totalPagado, totalNuevo),
      aplicable,
      motivo_no_aplicable: aplicable ? "" : "El total pagado supera el nuevo total; requiere revision manual."
    };
  });
}

async function applyChanges(client, idContribuyente, tarifaAgua, previewRows) {
  const actualizables = previewRows.filter((row) => row.aplicable);
  await client.query(
    `UPDATE predios
     SET tarifa_agua = $1
     WHERE id_contribuyente = $2`,
    [tarifaAgua, idContribuyente]
  );
  if (actualizables.length === 0) {
    return { updatedPredios: true, updatedReceipts: 0 };
  }

  const valuesSql = [];
  const params = [];
  actualizables.forEach((row, index) => {
    const base = index * 4;
    valuesSql.push(`($${base + 1}::bigint, $${base + 2}::numeric, $${base + 3}::numeric, $${base + 4}::varchar)`);
    params.push(row.id_recibo, row.subtotal_agua_nuevo, row.total_nuevo, row.estado_nuevo);
  });

  const updated = await client.query(`
    UPDATE recibos r
    SET
      subtotal_agua = v.subtotal_agua_nuevo,
      total_pagar = v.total_nuevo,
      estado = v.estado_nuevo
    FROM (
      VALUES
      ${valuesSql.join(",\n      ")}
    ) AS v (id_recibo, subtotal_agua_nuevo, total_nuevo, estado_nuevo)
    WHERE r.id_recibo = v.id_recibo
    RETURNING r.id_recibo
  `, params);

  return {
    updatedPredios: true,
    updatedReceipts: Number(updated.rowCount || 0)
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    printUsage();
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const target = await loadTarget(client, options);
    if (!target) {
      throw new Error("No se encontro el contribuyente indicado.");
    }
    if (Number(target.total_predios || 0) > 1 && !options.allowMultiplePredios) {
      throw new Error(
        `El contribuyente tiene ${target.total_predios} predios. Usa --allow-multiple-predios si quieres continuar.`
      );
    }

    const recibosRs = await loadRecibos(client, Number(target.id_contribuyente), options.periodos);
    const previewRows = buildPreviewRows(recibosRs.rows, options.tarifaAgua);
    const periodosSolicitados = new Set(options.periodos.map((item) => item.raw));
    const periodosEncontrados = new Set(previewRows.map((item) => item.periodo));
    const periodosFaltantes = Array.from(periodosSolicitados).filter((periodo) => !periodosEncontrados.has(periodo));

    console.log("Contribuyente objetivo:");
    console.log(JSON.stringify({
      id_contribuyente: Number(target.id_contribuyente),
      codigo_municipal: target.codigo_municipal,
      nombre_completo: target.nombre_completo,
      total_predios: Number(target.total_predios || 0),
      predios: Array.isArray(target.predios) ? target.predios.map((item) => Number(item)) : [],
      tarifa_agua_actual: parseMonto(target.tarifa_agua_actual, null),
      tarifa_agua_nueva: options.tarifaAgua
    }, null, 2));

    console.log("\nVista previa:");
    console.log(JSON.stringify(previewRows, null, 2));
    if (periodosFaltantes.length > 0) {
      console.log("\nPeriodos sin recibo encontrado:");
      console.log(JSON.stringify(periodosFaltantes, null, 2));
    }

    const resumen = {
      recibos_encontrados: previewRows.length,
      recibos_aplicables: previewRows.filter((item) => item.aplicable).length,
      recibos_con_revision_manual: previewRows.filter((item) => !item.aplicable).length
    };
    console.log("\nResumen:");
    console.log(JSON.stringify(resumen, null, 2));

    if (!options.apply) {
      console.log("\nModo reporte. No se realizaron cambios. Usa --apply para ejecutar.");
      return;
    }

    await client.query("BEGIN");
    const result = await applyChanges(client, Number(target.id_contribuyente), options.tarifaAgua, previewRows);
    await client.query("COMMIT");

    console.log("\nCambios aplicados.");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(`Error reparando tarifa de agua: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
