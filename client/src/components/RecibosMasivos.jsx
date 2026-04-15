import React, { forwardRef } from "react";
import Recibo from "./Recibo";

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const parseAmount = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const MONTH_LABELS = ["", "ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const buildPeriodoLabel = (mes, anio) => {
  const mesNum = Number(mes || 0);
  const anioNum = Number(anio || 0);
  const mesTxt = MONTH_LABELS[mesNum] || String(mes || "-");
  return `${mesTxt}/${Number.isFinite(anioNum) && anioNum > 0 ? anioNum : "-"}`;
};
const buildReciboGroupKey = (item = {}) => {
  const predio = Number(item?.id_predio || 0);
  if (predio > 0) return `predio:${predio}`;
  const contribuyente = Number(item?.id_contribuyente || 0);
  if (contribuyente > 0) return `contrib:${contribuyente}`;
  const codigo = String(item?.codigo_municipal || "").trim().toUpperCase();
  if (codigo) return `codigo:${codigo}`;
  return `fallback:${String(item?.dni_ruc || "").trim().toUpperCase()}|${String(item?.nombre_completo || "").trim().toUpperCase()}`;
};
const normalizeRow = (item = {}) => ({
  ...item,
  deuda_anio: parseAmount(item.deuda_anio ?? 0),
  subtotal_agua: round2(parseAmount(item.subtotal_agua)),
  subtotal_desague: round2(parseAmount(item.subtotal_desague)),
  subtotal_limpieza: round2(parseAmount(item.subtotal_limpieza)),
  subtotal_admin: round2(parseAmount(item.subtotal_admin)),
  total_pagar: round2(parseAmount(item.total_pagar)),
  cargo_reimpresion: round2(parseAmount(item.cargo_reimpresion))
});

const RecibosMasivos = forwardRef(({ datos }, ref) => {
  const listaRecibos = React.useMemo(() => {
    const source = Array.isArray(datos) ? datos : [];
    const normalized = source.map((item) => normalizeRow(item));
    const grouped = new Map();

    normalized.forEach((item) => {
      const key = buildReciboGroupKey(item);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    });

    const merged = [];
    grouped.forEach((rows) => {
      const sortedRows = [...rows].sort((a, b) =>
        (Number(a?.anio || 0) - Number(b?.anio || 0))
        || (Number(a?.mes || 0) - Number(b?.mes || 0))
      );
      if (sortedRows.length <= 1) {
        merged.push(...sortedRows);
        return;
      }

      const last = sortedRows[sortedRows.length - 1] || {};
      const first = sortedRows[0] || {};
      const anioUnico = sortedRows.every((r) => Number(r?.anio || 0) === Number(first?.anio || 0));
      const periodos = sortedRows.map((r) => ({
        anio: Number(r?.anio || 0),
        mes: Number(r?.mes || 0),
        monto: round2(parseAmount(r?.total_pagar)),
        label: buildPeriodoLabel(r?.mes, r?.anio)
      }));
      const resumenServicios = sortedRows.reduce((acc, r) => ({
        agua: round2(acc.agua + parseAmount(r?.subtotal_agua)),
        desague: round2(acc.desague + parseAmount(r?.subtotal_desague)),
        limpieza: round2(acc.limpieza + parseAmount(r?.subtotal_limpieza)),
        admin: round2(acc.admin + parseAmount(r?.subtotal_admin))
      }), { agua: 0, desague: 0, limpieza: 0, admin: 0 });
      const totalPeriodos = round2(periodos.reduce((acc, p) => acc + parseAmount(p?.monto), 0));

      merged.push({
        ...last,
        id_recibo: 0,
        numero_recibo: "",
        codigo_impresion: "",
        codigo_recibo: "",
        mes: first?.mes || "",
        anio: anioUnico ? (first?.anio || "") : "VARIOS",
        mes_nombre: "VARIOS",
        total_pagar: totalPeriodos,
        subtotal_agua: resumenServicios.agua,
        subtotal_desague: resumenServicios.desague,
        subtotal_limpieza: resumenServicios.limpieza,
        subtotal_admin: resumenServicios.admin,
        deuda_meses_label: periodos.map((p) => p.label).join(", "),
        detalles_por_periodo: periodos,
        es_agrupado_meses: true
      });
    });

    return merged;
  }, [datos]);

  // One receipt per physical A5 sheet.
  const hojaStyle = {
    width: "145mm",
    height: "203mm",
    pageBreakAfter: "always",
    marginLeft: "auto",
    marginRight: "0",
    backgroundColor: "white",
    overflow: "hidden"
  };

  if (listaRecibos.length === 0) return <div ref={ref}>No hay datos</div>;

  return (
    <div ref={ref}>
      {listaRecibos.map((item, index) => (
        <div
          key={`${item?.id_recibo || "recibo"}-${item?.anio || ""}-${item?.mes || ""}-${index}`}
          style={{ ...hojaStyle, pageBreakAfter: index === listaRecibos.length - 1 ? "auto" : "always" }}
        >
          <ReciboRender item={item} />
        </div>
      ))}
    </div>
  );
});

const ReciboRender = ({ item }) => {
  const cargoReimpresion = round2(parseAmount(item.cargo_reimpresion));
  const periodos = Array.isArray(item?.detalles_por_periodo)
    ? item.detalles_por_periodo
        .map((p) => ({
          ...p,
          monto: round2(parseAmount(p?.monto)),
          label: String(p?.label || buildPeriodoLabel(p?.mes, p?.anio))
        }))
        .filter((p) => p.monto > 0)
    : [];
  const totalBase = periodos.length > 0
    ? round2(periodos.reduce((acc, p) => acc + parseAmount(p.monto), 0))
    : round2(
      parseAmount(item.subtotal_agua)
      + parseAmount(item.subtotal_desague)
      + parseAmount(item.subtotal_limpieza)
      + parseAmount(item.subtotal_admin)
    );
  const totalConCargo = round2(totalBase + cargoReimpresion);
  const datosEstructurados = {
    contribuyente: {
      nombre_completo: item.nombre_completo,
      codigo_municipal: item.codigo_municipal,
      dni_ruc: item.dni_ruc,
      deuda_anio: item.deuda_anio ?? 0,
      deuda_meses_label: item.deuda_meses_label
    },
    predio: {
      direccion_completa: item.direccion_completa
    },
    recibo: {
      id_recibo: item.id_recibo,
      numero_recibo: item.numero_recibo,
      codigo_impresion: item.codigo_impresion,
      codigo_recibo: item.codigo_recibo,
      mes: item.mes,
      anio: item.anio,
      mes_nombre: item.mes_nombre,
      total: totalConCargo,
      cargo_reimpresion: cargoReimpresion,
      es_agrupado_meses: Boolean(item?.es_agrupado_meses)
    },
    detalles: {
      agua: item.subtotal_agua,
      desague: item.subtotal_desague,
      limpieza: item.subtotal_limpieza,
      admin: item.subtotal_admin,
      periodos
    }
  };

  return <Recibo datos={datosEstructurados} ref={null} />;
};

RecibosMasivos.displayName = "RecibosMasivos";
export default RecibosMasivos;
