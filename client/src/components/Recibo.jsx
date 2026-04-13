import React, { forwardRef } from "react";

const mm = (value) => `${value}mm`;

const toNum = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMonto = (value) => toNum(value).toFixed(2);

const RECIBO_SIZE_MM = {
  width: 145,
  height: 203
};

// Textos editables del recibo.
// Si quieres cambiar textos impresos, edita este objeto.
const RECIBO_TEXTOS = {
  distrito: "PUEBLO NUEVO",
  tipoServicio: "Servicio: Domestico",
  notaPago: "El pago de este recibo no cancela deudas anteriores.",
  tituloDeudaAnterior: "Deuda Anterior",
  tituloDeudaMes: "Mes",
  labelDeuda: "Deuda S/."
};

// Ajustes finos globales en mm para prueba/error con la impresora.
// nudgeX/nudgeY mueven TODO el recibo.
const CAL = {
  nudgeX: 6,
  nudgeY: 0,
  // Coordenadas del bloque superior.
  top: {
    // IMPORTANTE: estos nombres deben mantenerse exactos (xMes, xAnio, xNumero).
    // Si escribes xMesS u otro nombre, no se reflejara ningun cambio.
    xMes: 54.2,
    xAnio: 90.2,
    xNumero: 119.2,
    yCabecera: 27.8,
    xCodigo: 37.2,
    yCodigo: 31.4,
    xNombre: 37.2,
    yNombre: 34.8,
    xDireccion: 37.2,
    yDireccion: 38.2,
    xDistrito: 37.2,
    yDistrito: 41.6,
    xTipoServicio: 46.5,
    yTipoServicio: 59.7,
    xConcepto: 47.0,
    xImporte: 121.0,
    yDetalleInicio: 65.5,
    detalleGap: 4.2,
    xTotal: 121.0,
    yTotal: 81.8,
    xNota: 16.8,
    yNota: 82.7,
    xFechaTop: 104.0,
    yFechaEmisionTop: 91.0,
    yFechaCorteTop: 96.0,
    fechaWidth: 18.0,
    debt: {
      y: 105.8,
      boxW: 36.0,
      xAnterior: 19.8,
      xMes: 70.8
    }
  },
  // Coordenadas del bloque inferior (talon).
  bottom: {
    xMes: 23.0,
    xAnio: 64.0,
    xNumero: 108.0,
    yCabecera: 145.5,
    xNombre: 40.0,
    yNombre: 158.0,
    xEmision: 40.0,
    yEmision: 162.3,
    xCorte: 40.0,
    yCorte: 166.8,
    xTotal: 106.5,
    yTotal: 166.5
  }
};

const Recibo = forwardRef(({ datos }, ref) => {
  if (!datos) return <div ref={ref}></div>;

  const contribuyente = datos?.contribuyente || {};
  const predio = datos?.predio || {};
  const recibo = datos?.recibo || {};
  const detalles = datos?.detalles || {};

  const getMesNombre = (value) => {
    const meses = [
      "Enero",
      "Febrero",
      "Marzo",
      "Abril",
      "Mayo",
      "Junio",
      "Julio",
      "Agosto",
      "Septiembre",
      "Octubre",
      "Noviembre",
      "Diciembre"
    ];
    const num = Number.parseInt(value, 10);
    if (Number.isFinite(num) && num >= 1 && num <= 12) return meses[num - 1];
    return value ?? "";
  };

  const mesLabel = recibo.mes_nombre ?? getMesNombre(recibo.mes);
  const anioLabel = String(recibo.anio ?? "");
  const codigoImpresion = String(recibo.codigo_impresion || "").trim();
  const reciboNumero = codigoImpresion || (
    Number.isInteger(Number(recibo.id_recibo))
      ? String(recibo.id_recibo).padStart(6, "0")
      : ""
  );

  const cargoReimpresion = toNum(recibo.cargo_reimpresion);
  // Conceptos editables del detalle del recibo.
  const filasServicios = [
    { concepto: "SERVICIO DE AGUA", monto: toNum(detalles.agua) },
    { concepto: "SERVICIO DE DESAGUE", monto: toNum(detalles.desague) },
    { concepto: "LIMPIEZA PUBLICA", monto: toNum(detalles.limpieza) },
    { concepto: "GASTOS ADMINISTRATIVOS", monto: toNum(detalles.admin) }
  ].filter((row) => row.monto > 0);
  if (cargoReimpresion > 0) {
    filasServicios.push({ concepto: "REIMPRESION", monto: cargoReimpresion });
  }

  const totalDetalle = filasServicios.reduce((acc, row) => acc + toNum(row.monto), 0);
  const totalCalculado = totalDetalle > 0 ? totalDetalle : toNum(recibo.total);
  const totalRecibo = Number.isFinite(totalCalculado) ? totalCalculado : 0;

  const deudaMesesLabel = contribuyente.deuda_meses_label ? ` (${contribuyente.deuda_meses_label})` : "";
  const deudaAnioLabel = `${anioLabel}${deudaMesesLabel}`.trim();

  const formatDate = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("es-PE");
  };

  const now = new Date();
  const fallbackEmision = now.toLocaleDateString("es-PE");
  const fallbackCorte = new Date(now.getFullYear(), now.getMonth() + 1, 5).toLocaleDateString("es-PE");
  const fechaEmision = formatDate(recibo.fecha_emision || recibo.creado_en) || fallbackEmision;
  const fechaCorte = formatDate(recibo.fecha_corte) || fallbackCorte;

  // Helpers para aplicar calibracion global a cada coordenada.
  const x = (value) => mm(value + CAL.nudgeX);
  const y = (value) => mm(value + CAL.nudgeY);

  const baseText = {
    position: "absolute",
    fontFamily: "'Arial Narrow', Arial, sans-serif",
    color: "#000",
    lineHeight: 1.1
  };

  const servicioRows = filasServicios.length > 0
    ? filasServicios
    : [{ concepto: "SERVICIOS", monto: totalRecibo }];

  const deudaAnualMonto = formatMonto(contribuyente.deuda_anio || 0);

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        width: mm(RECIBO_SIZE_MM.width),
        height: mm(RECIBO_SIZE_MM.height),
        margin: "0",
        overflow: "hidden",
        background: "transparent",
        textTransform: "uppercase"
      }}
    >
      <div style={{ ...baseText, left: x(CAL.top.xMes), top: y(CAL.top.yCabecera), fontSize: "3.0mm", fontWeight: 700 }}>
        {mesLabel}
      </div>
      <div style={{ ...baseText, left: x(CAL.top.xAnio), top: y(CAL.top.yCabecera), fontSize: "3.0mm", fontWeight: 700 }}>
        {anioLabel}
      </div>
      <div style={{ ...baseText, left: x(CAL.top.xNumero), top: y(CAL.top.yCabecera), fontSize: "3.0mm", fontWeight: 700 }}>
        {reciboNumero}
      </div>

      <div style={{ ...baseText, left: x(CAL.top.xCodigo), top: y(CAL.top.yCodigo), fontSize: "3.0mm", fontWeight: 700 }}>
        {contribuyente.codigo_municipal || ""}
      </div>
      <div style={{ ...baseText, left: x(CAL.top.xNombre), top: y(CAL.top.yNombre), fontSize: "2.9mm", maxWidth: mm(78), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {contribuyente.nombre_completo || ""}
      </div>
      <div style={{ ...baseText, left: x(CAL.top.xDireccion), top: y(CAL.top.yDireccion), fontSize: "2.9mm", maxWidth: mm(78), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {predio.direccion_completa || ""}
      </div>
      <div style={{ ...baseText, left: x(CAL.top.xDistrito), top: y(CAL.top.yDistrito), fontSize: "2.9mm", maxWidth: mm(40), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {RECIBO_TEXTOS.distrito}
      </div>
      <div style={{ ...baseText, left: x(CAL.top.xTipoServicio), top: y(CAL.top.yTipoServicio), fontSize: "3.0mm", maxWidth: mm(45), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {RECIBO_TEXTOS.tipoServicio}
      </div>

      {servicioRows.slice(0, 6).map((row, idx) => (
        <React.Fragment key={`${row.concepto}-${idx}`}>
          <div
            style={{
              ...baseText,
              left: x(CAL.top.xConcepto),
              top: y(CAL.top.yDetalleInicio + (idx * CAL.top.detalleGap)),
              fontSize: "3.0mm",
              maxWidth: mm(80),
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            {row.concepto}
          </div>
          <div
            style={{
              ...baseText,
              left: x(CAL.top.xImporte),
              top: y(CAL.top.yDetalleInicio + (idx * CAL.top.detalleGap)),
              width: mm(14),
              textAlign: "right",
              fontSize: "3.0mm",
              fontWeight: 700
            }}
          >
            {formatMonto(row.monto)}
          </div>
        </React.Fragment>
      ))}

      <div
        style={{
          ...baseText,
          left: x(CAL.top.xTotal),
          top: y(CAL.top.yTotal),
          width: mm(14),
          textAlign: "right",
          fontSize: "3.3mm",
          fontWeight: 700
        }}
      >
        {formatMonto(totalRecibo)}
      </div>

      <div style={{ ...baseText, left: x(CAL.top.xNota), top: y(CAL.top.yNota), fontSize: "3.0mm", maxWidth: mm(95) }}>
        {RECIBO_TEXTOS.notaPago}
      </div>

      <div style={{ ...baseText, left: x(CAL.top.xFechaTop), top: y(CAL.top.yFechaEmisionTop), width: mm(CAL.top.fechaWidth), textAlign: "right", fontSize: "3.0mm", fontWeight: 700 }}>
        {fechaEmision}
      </div>
      <div style={{ ...baseText, left: x(CAL.top.xFechaTop), top: y(CAL.top.yFechaCorteTop), width: mm(CAL.top.fechaWidth), textAlign: "right", fontSize: "3.0mm", fontWeight: 700 }}>
        {fechaCorte}
      </div>

      <div
        style={{
          ...baseText,
          left: x(CAL.top.debt.xAnterior),
          top: y(CAL.top.debt.y),
          width: mm(CAL.top.debt.boxW),
          fontSize: "3.0mm"
        }}
      >
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: "3.6mm" }}>{RECIBO_TEXTOS.tituloDeudaAnterior}</div>
        <div style={{ borderTop: "0.35mm solid #000", marginTop: mm(0.5) }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", marginTop: mm(0.6), textAlign: "center", fontWeight: 700 }}>
          <span>Año</span>
          <span>{RECIBO_TEXTOS.labelDeuda}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", marginTop: mm(0.5), textAlign: "center", fontWeight: 700 }}>
          <span>{deudaAnioLabel}</span>
          <span>{deudaAnualMonto}</span>
        </div>
        <div style={{ borderTop: "0.35mm solid #000", marginTop: mm(0.6) }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", marginTop: mm(0.6), textAlign: "center", fontWeight: 700 }}>
          <span>Total</span>
          <span>{deudaAnualMonto}</span>
        </div>
      </div>

      <div
        style={{
          ...baseText,
          left: x(CAL.top.debt.xMes),
          top: y(CAL.top.debt.y),
          width: mm(CAL.top.debt.boxW),
          fontSize: "3.0mm"
        }}
      >
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: "3.6mm" }}>{RECIBO_TEXTOS.tituloDeudaMes}</div>
        <div style={{ borderTop: "0.35mm solid #000", marginTop: mm(0.5) }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", marginTop: mm(0.6), textAlign: "center", fontWeight: 700 }}>
          <span>{RECIBO_TEXTOS.tituloDeudaMes}</span>
          <span>{RECIBO_TEXTOS.labelDeuda}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", marginTop: mm(0.5), textAlign: "center", fontWeight: 700 }}>
          <span>&nbsp;</span>
          <span>&nbsp;</span>
        </div>
        <div style={{ borderTop: "0.35mm solid #000", marginTop: mm(0.6) }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", marginTop: mm(0.6), textAlign: "center", fontWeight: 700 }}>
          <span>Total</span>
          <span>&nbsp;</span>
        </div>
      </div>

      <div style={{ ...baseText, left: x(CAL.bottom.xMes), top: y(CAL.bottom.yCabecera), fontSize: "3.0mm", fontWeight: 700 }}>
        {mesLabel}
      </div>
      <div style={{ ...baseText, left: x(CAL.bottom.xAnio), top: y(CAL.bottom.yCabecera), fontSize: "3.0mm", fontWeight: 700 }}>
        {anioLabel}
      </div>
      <div style={{ ...baseText, left: x(CAL.bottom.xNumero), top: y(CAL.bottom.yCabecera), fontSize: "3.0mm", fontWeight: 700 }}>
        {reciboNumero}
      </div>

      <div style={{ ...baseText, left: x(CAL.bottom.xNombre), top: y(CAL.bottom.yNombre), fontSize: "2.9mm", maxWidth: mm(55), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {contribuyente.nombre_completo || ""}
      </div>
      <div style={{ ...baseText, left: x(CAL.bottom.xEmision), top: y(CAL.bottom.yEmision), fontSize: "2.9mm", fontWeight: 700 }}>
        {fechaEmision}
      </div>
      <div style={{ ...baseText, left: x(CAL.bottom.xCorte), top: y(CAL.bottom.yCorte), fontSize: "2.9mm", fontWeight: 700 }}>
        {fechaCorte}
      </div>

      <div style={{ ...baseText, left: x(CAL.bottom.xTotal), top: y(CAL.bottom.yTotal), width: mm(14), textAlign: "right", fontSize: "4.0mm", fontWeight: 700 }}>
        {formatMonto(totalRecibo)}
      </div>
    </div>
  );
});

Recibo.displayName = "Recibo";
export default Recibo;

