const test = require("node:test");
const assert = require("node:assert/strict");
const { previousPeriod, resolveAutoDebtPeriod, buildFuturePeriods } = require("../automation-utils");

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

test("la proyeccion futura inicia en el periodo actual y cruza de año", () => {
  const periods = buildFuturePeriods({ anio: 2026, mes: 7, futureMonths: 24 });

  assert.equal(periods.length, 25);
  assert.deepEqual(periods[0], { anio: 2026, mes: 7, periodoNum: 202607 });
  assert.deepEqual(periods[5], { anio: 2026, mes: 12, periodoNum: 202612 });
  assert.deepEqual(periods[6], { anio: 2027, mes: 1, periodoNum: 202701 });
  assert.deepEqual(periods[24], { anio: 2028, mes: 7, periodoNum: 202807 });
  assert.equal(periods.some((period) => period.periodoNum < 202607), false);
});

test("la proyeccion futura rechaza un periodo inicial invalido", () => {
  assert.deepEqual(buildFuturePeriods({ anio: 2026, mes: 0 }), []);
  assert.deepEqual(buildFuturePeriods({ anio: 0, mes: 7 }), []);
});
