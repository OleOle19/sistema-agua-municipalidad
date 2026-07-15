"use strict";

const previousPeriod = (anio, mes) => {
  if (mes > 1) return { anio, mes: mes - 1 };
  return { anio: anio - 1, mes: 12 };
};

const resolveAutoDebtPeriod = ({ anio, mes, dia, hora, minuto, diasDelMes }) => {
  const currentYear = Number(anio);
  const currentMonth = Number(mes);
  const isClosingWindow = Number(dia) === Number(diasDelMes)
    && Number(hora) === 23
    && Number(minuto) >= 55;
  if (isClosingWindow) {
    return { anio: currentYear, mes: currentMonth, modo: "CIERRE_MES" };
  }
  return { ...previousPeriod(currentYear, currentMonth), modo: "RECUPERACION" };
};

module.exports = { previousPeriod, resolveAutoDebtPeriod };
