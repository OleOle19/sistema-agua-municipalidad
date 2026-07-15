const test = require("node:test");
const assert = require("node:assert/strict");
const { previousPeriod, resolveAutoDebtPeriod } = require("../automation-utils");

test("previousPeriod cruza de enero al diciembre anterior", () => {
  assert.deepEqual(previousPeriod(2026, 1), { anio: 2025, mes: 12 });
});

test("auto deuda genera el periodo actual durante el cierre", () => {
  assert.deepEqual(
    resolveAutoDebtPeriod({ anio: 2026, mes: 7, dia: 31, hora: 23, minuto: 57, diasDelMes: 31 }),
    { anio: 2026, mes: 7, modo: "CIERRE_MES" }
  );
});

test("auto deuda recupera el ultimo periodo cerrado en cualquier otro momento", () => {
  assert.deepEqual(
    resolveAutoDebtPeriod({ anio: 2026, mes: 7, dia: 15, hora: 10, minuto: 30, diasDelMes: 31 }),
    { anio: 2026, mes: 6, modo: "RECUPERACION" }
  );
});
