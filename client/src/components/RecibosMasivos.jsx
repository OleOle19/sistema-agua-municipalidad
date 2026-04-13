import React, { forwardRef } from "react";
import Recibo from "./Recibo";

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const parseAmount = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const RecibosMasivos = forwardRef(({ datos }, ref) => {
  const listaRecibos = React.useMemo(() => {
    const listaRecibos = Array.isArray(datos) ? datos : [];
    return listaRecibos.map((item) => ({
      ...item,
      deuda_anio: parseAmount(item.deuda_anio ?? 0),
      subtotal_agua: round2(parseAmount(item.subtotal_agua)),
      subtotal_desague: round2(parseAmount(item.subtotal_desague)),
      subtotal_limpieza: round2(parseAmount(item.subtotal_limpieza)),
      subtotal_admin: round2(parseAmount(item.subtotal_admin)),
      total_pagar: round2(parseAmount(item.total_pagar)),
      cargo_reimpresion: round2(parseAmount(item.cargo_reimpresion))
    }));
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
  const totalBase = round2(
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
      cargo_reimpresion: cargoReimpresion
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
