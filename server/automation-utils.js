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

const buildRemainingYearPeriods = ({ anio, mes } = {}) => {
  const startYear = Number(anio);
  const startMonth = Number(mes);
  if (!Number.isInteger(startYear) || startYear < 1900 || !Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    return [];
  }

  return Array.from({ length: 13 - startMonth }, (_, offset) => {
    const periodMonth = startMonth + offset;
    return {
      anio: startYear,
      mes: periodMonth,
      periodoNum: (startYear * 100) + periodMonth
    };
  });
};

const buildForwardPeriods = ({ anio, mes, totalMonths = 1 } = {}) => {
  const startYear = Number(anio);
  const startMonth = Number(mes);
  const requestedMonths = Number(totalMonths);
  if (
    !Number.isInteger(startYear)
    || startYear < 1900
    || !Number.isInteger(startMonth)
    || startMonth < 1
    || startMonth > 12
    || !Number.isFinite(requestedMonths)
  ) {
    return [];
  }

  const months = Math.max(1, Math.min(24, Math.trunc(requestedMonths)));
  return Array.from({ length: months }, (_, offset) => {
    const absoluteMonth = (startYear * 12) + (startMonth - 1) + offset;
    const periodYear = Math.floor(absoluteMonth / 12);
    const periodMonth = (absoluteMonth % 12) + 1;
    return {
      anio: periodYear,
      mes: periodMonth,
      periodoNum: (periodYear * 100) + periodMonth
    };
  });
};

module.exports = { previousPeriod, resolveAutoDebtPeriod, buildRemainingYearPeriods, buildForwardPeriods };
