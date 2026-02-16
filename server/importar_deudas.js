const fs = require('fs');
const path = require('path');
const readline = require('readline');
const pool = require('./db');

const INPUT_FILE = path.join(__dirname, 'CATORCE.txt');
const BATCH_SIZE = 2000; // Guardaremos de 2000 en 2000
const EPS = 0.001;

async function importarDeudas() {
  const client = await pool.connect();
  console.log("INICIANDO MIGRACION DE HISTORIAL (2007-2026)...");

  try {
    // 1. Cargar mapa de usuarios
    console.log("... Cargando contribuyentes...");
    const mapaPredios = new Map();
    const resPredios = await client.query(`
      SELECT p.id_predio, c.codigo_municipal
      FROM predios p
      JOIN contribuyentes c ON p.id_contribuyente = c.id_contribuyente
    `);

    resPredios.rows.forEach(r => mapaPredios.set(r.codigo_municipal, r.id_predio));
    console.log(`OK: ${mapaPredios.size} usuarios encontrados.`);

    // 2. Leer archivo
    const fileStream = fs.createReadStream(INPUT_FILE);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let reciboChunks = []; // ($1, $2...) para recibos
    let reciboParams = []; // datos de recibos
    let reciboCount = 0;

    let pagoChunks = []; // ($1, $2...) para pagos (join por predio/anio/mes)
    let pagoParams = [];
    let pagoCount = 0;

    let totalProcesados = 0;
    let totalPagos = 0;

    const flushBatch = async () => {
      if (reciboCount === 0 && pagoCount === 0) return;

      if (reciboCount > 0) {
        const valuesRecibos = reciboChunks.join(', ');
        const valuesSql = `
          (VALUES ${valuesRecibos})
          AS v (id_predio, anio, mes, subtotal_agua, subtotal_desague, subtotal_limpieza, subtotal_admin, total_pagar, estado)
        `;

        const insertRecibos = `
          INSERT INTO recibos (
            id_predio, anio, mes, subtotal_agua, subtotal_desague, subtotal_limpieza,
            subtotal_admin, total_pagar, estado, fecha_emision, fecha_vencimiento
          )
          SELECT v.id_predio::int, v.anio::int, v.mes::int, v.subtotal_agua::numeric, v.subtotal_desague::numeric, v.subtotal_limpieza::numeric,
                 v.subtotal_admin::numeric, v.total_pagar::numeric, v.estado,
                 make_date(v.anio::int, v.mes::int, 1),
                 (make_date(v.anio::int, v.mes::int, 1) + INTERVAL '1 month')::date
          FROM ${valuesSql}
          ON CONFLICT DO NOTHING
        `;

        const updateRecibos = `
          UPDATE recibos r
          SET subtotal_agua = v.subtotal_agua::numeric,
              subtotal_desague = v.subtotal_desague::numeric,
              subtotal_limpieza = v.subtotal_limpieza::numeric,
              subtotal_admin = v.subtotal_admin::numeric,
              total_pagar = v.total_pagar::numeric,
              estado = v.estado,
              fecha_emision = make_date(v.anio::int, v.mes::int, 1),
              fecha_vencimiento = (make_date(v.anio::int, v.mes::int, 1) + INTERVAL '1 month')::date
          FROM ${valuesSql}
          WHERE r.id_predio = v.id_predio::int AND r.anio = v.anio::int AND r.mes = v.mes::int
        `;

        await client.query(insertRecibos, reciboParams);
        await client.query(updateRecibos, reciboParams);
        totalProcesados += reciboCount;
      }

      if (pagoCount > 0) {
        const valuesPagos = pagoChunks.join(', ');
        const insertPagos = `
          INSERT INTO pagos (id_recibo, monto_pagado, fecha_pago)
          SELECT r.id_recibo, v.monto_pagado::numeric, make_date(v.anio::int, v.mes::int, 1)
          FROM (VALUES ${valuesPagos}) AS v (id_predio, anio, mes, monto_pagado)
          JOIN recibos r ON r.id_predio = v.id_predio::int AND r.anio = v.anio::int AND r.mes = v.mes::int
          WHERE v.monto_pagado::numeric > 0
            AND NOT EXISTS (SELECT 1 FROM pagos p WHERE p.id_recibo = r.id_recibo)
        `;
        await client.query(insertPagos, pagoParams);
        totalPagos += pagoCount;
      }

      reciboChunks = [];
      reciboParams = [];
      reciboCount = 0;
      pagoChunks = [];
      pagoParams = [];
      pagoCount = 0;
    };

    await client.query('BEGIN');

    for await (const line of rl) {
      if (!line.trim()) continue;

      // Limpiar comillas: "002781" -> 002781
      const parts = line.split(',').map(p => p.replace(/"/g, '').trim());
      if (parts.length < 12) continue;

      const codigoUser = parts[0];
      const idPredio = mapaPredios.get(codigoUser);

      // Solo procesamos si el usuario existe en la BD
      if (!idPredio) continue;

      const anio = parseInt(parts[1], 10);
      const mes = parseInt(parts[2], 10);
      if (!Number.isFinite(anio) || !Number.isFinite(mes)) continue;
      const subtotalAgua = parseFloat(parts[3]) || 0;
      const subtotalDesague = parseFloat(parts[4]) || 0;
      const subtotalLimpieza = parseFloat(parts[5]) || 0;
      const subtotalAdmin = parseFloat(parts[6]) || 0;
      const total = parseFloat(parts[8]) || 0;
      const abono = parseFloat(parts[9]) || 0;

      // Si no hay total ni abono, ignoramos
      if (total === 0 && abono === 0) continue;

      let estado = 'PENDIENTE';
      if (abono >= total - EPS) estado = 'PAGADO';
      else if (abono > 0) estado = 'PARCIAL';

      // Array plano de datos para esta fila (9 datos)
      reciboParams.push(
        idPredio, anio, mes,
        subtotalAgua, subtotalDesague, subtotalLimpieza, subtotalAdmin,
        total, estado
      );

      // Generar placeholders dinamicos ($1...$9), ($10...$18), etc.
      const offset = reciboCount * 9;
      reciboChunks.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`);
      reciboCount++;

      if (abono > 0) {
        const pagoOffset = pagoCount * 4;
        pagoChunks.push(`($${pagoOffset + 1}, $${pagoOffset + 2}, $${pagoOffset + 3}, $${pagoOffset + 4})`);
        pagoParams.push(idPredio, anio, mes, abono);
        pagoCount++;
      }

      // Si llegamos a 2000, guardamos el paquete
      if (reciboCount >= BATCH_SIZE) {
        await flushBatch();
        process.stdout.write('.');
      }
    }

    // Guardar lo que sobro al final
    await flushBatch();

    await client.query('COMMIT');
    console.log("\n==========================================");
    console.log("MIGRACION COMPLETADA CON EXITO");
    console.log(`Total Recibos Procesados: ${totalProcesados}`);
    console.log(`Total Pagos Registrados: ${totalPagos}`);
    console.log("==========================================");

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("\nERROR:", err);
  } finally {
    client.release();
    process.exit();
  }
}

importarDeudas();
