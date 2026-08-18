const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compareRows,
  normalizeMode
} = require("../financial-summary-service");

test("normaliza el modo del resumen financiero con fallback seguro", () => {
  assert.equal(normalizeMode("ON"), "on");
  assert.equal(normalizeMode("compare"), "compare");
  assert.equal(normalizeMode("valor_desconocido"), "off");
});

test("la comparación acepta representaciones numéricas equivalentes", () => {
  const result = compareRows([
    {
      id_contribuyente: 10,
      deuda_anio: "15.00",
      abono_anio: "7.50",
      meses_deuda: "2",
      pendiente_caja_monto: "3.50",
      pendiente_caja_ordenes: "1",
      predios_morosos_actuales: "1"
    }
  ], [
    {
      id_contribuyente: 10,
      deuda_anio: 15,
      abono_anio: 7.5,
      meses_deuda: 2,
      pendiente_caja_monto: 3.5,
      pendiente_caja_ordenes: 1,
      predios_morosos_actuales: 1
    }
  ]);
  assert.equal(result.total_diferencias, 0);
});

test("la comparación identifica diferencias financieras", () => {
  const result = compareRows([
    { id_contribuyente: 20, deuda_anio: 8, meses_deuda: 1 }
  ], [
    { id_contribuyente: 20, deuda_anio: 10, meses_deuda: 2 }
  ]);
  assert.equal(result.total_diferencias, 1);
  assert.deepEqual(result.diferencias[0].campos, ["deuda_anio", "meses_deuda"]);
});
