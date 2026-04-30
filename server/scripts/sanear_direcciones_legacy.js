const pool = require("../db");
const {
  normalizeSpaces,
  parseLegacyNumeroMzLt,
  normalizeLegacyReference
} = require("../addressLegacy");

const hasText = (value) => normalizeSpaces(value).length > 0;

const sanitizeScalarValue = (value) => {
  const raw = normalizeSpaces(value);
  if (!raw) return "";
  const parsed = parseLegacyNumeroMzLt(raw);
  const collapsed = parsed.numero || parsed.manzana || parsed.lote;
  if (collapsed) return collapsed;
  if (/^(NRO|MZ|LT)\s*:?\s*$/i.test(raw)) return "";
  if (/^(NRO|MZ|LT)\s*:?\s*0+$/i.test(raw)) return "";
  if (/^0+$/.test(raw)) return "";
  return raw;
};

async function main() {
  const client = await pool.connect();
  try {
    const rs = await client.query(`
      SELECT p.id_predio, p.numero_casa, p.manzana, p.lote, p.referencia_direccion, ca.nombre AS calle_nombre
      FROM predios p
      LEFT JOIN calles ca ON ca.id_calle = p.id_calle
      ORDER BY p.id_predio ASC
    `);

    let revisados = 0;
    let actualizados = 0;

    await client.query("BEGIN");
    for (const row of rs.rows) {
      revisados += 1;
      const numeroActual = sanitizeScalarValue(row.numero_casa);
      const manzanaActual = sanitizeScalarValue(row.manzana);
      const loteActual = sanitizeScalarValue(row.lote);
      const referenciaActual = normalizeSpaces(row.referencia_direccion);
      const calleNombre = normalizeSpaces(row.calle_nombre);

      const parsedNumero = parseLegacyNumeroMzLt(numeroActual);
      const parsedReferencia = parseLegacyNumeroMzLt(referenciaActual);

      const nuevoNumero = parsedNumero.numero || parsedReferencia.numero || numeroActual;
      const nuevaManzana = manzanaActual || parsedNumero.manzana || parsedReferencia.manzana;
      const nuevoLote = loteActual || parsedNumero.lote || parsedReferencia.lote;
      const nuevaReferencia = normalizeLegacyReference(calleNombre, referenciaActual);

      const nextNumero = hasText(nuevoNumero) ? nuevoNumero : null;
      const nextManzana = hasText(nuevaManzana) ? nuevaManzana : null;
      const nextLote = hasText(nuevoLote) ? nuevoLote : null;
      const nextReferencia = hasText(nuevaReferencia) ? nuevaReferencia : null;

      const prevNumero = hasText(row.numero_casa) ? normalizeSpaces(row.numero_casa) : null;
      const prevManzana = hasText(row.manzana) ? normalizeSpaces(row.manzana) : null;
      const prevLote = hasText(row.lote) ? normalizeSpaces(row.lote) : null;
      const prevReferencia = hasText(row.referencia_direccion) ? normalizeSpaces(row.referencia_direccion) : null;

      if (
        prevNumero === nextNumero
        && prevManzana === nextManzana
        && prevLote === nextLote
        && prevReferencia === nextReferencia
      ) {
        continue;
      }

      await client.query(
        `UPDATE predios
         SET numero_casa = $1,
             manzana = $2,
             lote = $3,
             referencia_direccion = $4
         WHERE id_predio = $5`,
        [nextNumero, nextManzana, nextLote, nextReferencia, row.id_predio]
      );
      actualizados += 1;
    }
    await client.query("COMMIT");

    console.log(JSON.stringify({ revisados, actualizados }, null, 2));
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
