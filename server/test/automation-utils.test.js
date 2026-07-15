const test = require("node:test");
const assert = require("node:assert/strict");
const {
  previousPeriod,
  resolveAutoDebtPeriod,
  buildRemainingYearPeriods,
  buildForwardPeriods
} = require("../automation-utils");

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

test("la proyeccion inicia en el periodo actual y termina en diciembre", () => {
  const periods = buildRemainingYearPeriods({ anio: 2026, mes: 7 });

  assert.equal(periods.length, 6);
  assert.deepEqual(periods[0], { anio: 2026, mes: 7, periodoNum: 202607 });
  assert.deepEqual(periods[5], { anio: 2026, mes: 12, periodoNum: 202612 });
  assert.equal(periods.some((period) => period.periodoNum < 202607), false);
  assert.equal(periods.some((period) => period.anio !== 2026), false);
});

test("la proyeccion anual rechaza un periodo inicial invalido", () => {
  assert.deepEqual(buildRemainingYearPeriods({ anio: 2026, mes: 0 }), []);
  assert.deepEqual(buildRemainingYearPeriods({ anio: 0, mes: 7 }), []);
});

test("los adelantos de noviembre pueden cubrir hasta diciembre del año siguiente", () => {
  const periods = buildForwardPeriods({ anio: 2026, mes: 11, totalMonths: 14 });

  assert.equal(periods.length, 14);
  assert.deepEqual(periods[0], { anio: 2026, mes: 11, periodoNum: 202611 });
  assert.deepEqual(periods[1], { anio: 2026, mes: 12, periodoNum: 202612 });
  assert.deepEqual(periods[2], { anio: 2027, mes: 1, periodoNum: 202701 });
  assert.deepEqual(periods[13], { anio: 2027, mes: 12, periodoNum: 202712 });
});

test("los adelantos de diciembre cruzan de año sin repetir periodos", () => {
  const periods = buildForwardPeriods({ anio: 2026, mes: 12, totalMonths: 13 });

  assert.equal(periods.length, 13);
  assert.deepEqual(periods[0], { anio: 2026, mes: 12, periodoNum: 202612 });
  assert.deepEqual(periods[1], { anio: 2027, mes: 1, periodoNum: 202701 });
  assert.deepEqual(periods[12], { anio: 2027, mes: 12, periodoNum: 202712 });
  assert.equal(new Set(periods.map((period) => period.periodoNum)).size, periods.length);
});
