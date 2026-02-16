import React, { forwardRef } from "react";
import Recibo from "./Recibo";

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const parseAmount = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const getMesCorto = (mes) => {
  const meses = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return meses[Number(mes)] || String(mes ?? "");
};

const RecibosMasivos = forwardRef(({ datos }, ref) => {
  const listaRecibos = datos || [];

  const listaConsolidada = React.useMemo(() => {
    const grupos = new Map();

    listaRecibos.forEach((item) => {
      const key = item.id_predio ?? `${item.codigo_municipal}-${item.direccion_completa}`;
      const actual = grupos.get(key);
      if (!actual) {
        grupos.set(key, {
          ...item,
          subtotal_agua: parseAmount(item.subtotal_agua),
          subtotal_desague: parseAmount(item.subtotal_desague),
          subtotal_limpieza: parseAmount(item.subtotal_limpieza),
          subtotal_admin: parseAmount(item.subtotal_admin),
          total_pagar: parseAmount(item.total_pagar),
          meses: new Set([Number(item.mes)])
        });
        return;
      }

      actual.subtotal_agua += parseAmount(item.subtotal_agua);
      actual.subtotal_desague += parseAmount(item.subtotal_desague);
      actual.subtotal_limpieza += parseAmount(item.subtotal_limpieza);
      actual.subtotal_admin += parseAmount(item.subtotal_admin);
      actual.total_pagar += parseAmount(item.total_pagar);
      actual.meses.add(Number(item.mes));
      // Conservamos el ultimo recibo para la numeracion.
      actual.id_recibo = item.id_recibo;
    });

    return Array.from(grupos.values()).map((item) => {
      const mesesOrdenados = Array.from(item.meses).filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
      const esMultiple = mesesOrdenados.length > 1;
      const mesesLabel = mesesOrdenados.map((m) => getMesCorto(m)).join(",");
      const ultimoMes = mesesOrdenados[mesesOrdenados.length - 1] ?? item.mes;
      return {
        ...item,
        mes: ultimoMes,
        mes_nombre: esMultiple ? "Pago Multiple" : undefined,
        deuda_meses_label: esMultiple ? mesesLabel : undefined,
        deuda_anio: esMultiple ? round2(item.total_pagar) : parseAmount(item.deuda_anio ?? 0),
        subtotal_agua: round2(item.subtotal_agua),
        subtotal_desague: round2(item.subtotal_desague),
        subtotal_limpieza: round2(item.subtotal_limpieza),
        subtotal_admin: round2(item.subtotal_admin),
        total_pagar: round2(item.total_pagar)
      };
    });
  }, [listaRecibos]);

  // One receipt per physical A5 sheet.
  const hojaStyle = {
    width: "148mm",
    height: "209mm",
    pageBreakAfter: "always",
    display: "flex",
    justifyContent: "center",
    backgroundColor: "white",
    overflow: "hidden"
  };

  if (listaConsolidada.length === 0) return <div ref={ref}>No hay datos</div>;

  return (
    <div ref={ref}>
      {listaConsolidada.map((item, index) => (
        <div
          key={index}
          style={{ ...hojaStyle, pageBreakAfter: index === listaConsolidada.length - 1 ? "auto" : "always" }}
        >
          <ReciboRender item={item} />
        </div>
      ))}
    </div>
  );
});

const ReciboRender = ({ item }) => {
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
      mes: item.mes,
      anio: item.anio,
      mes_nombre: item.mes_nombre,
      total: item.total_pagar
    },
    detalles: {
      agua: item.subtotal_agua,
      desague: item.subtotal_desague,
      limpieza: item.subtotal_limpieza,
      admin: item.subtotal_admin
    }
  };

  return <Recibo datos={datosEstructurados} ref={null} />;
};

RecibosMasivos.displayName = "RecibosMasivos";
export default RecibosMasivos;
