import React, { forwardRef } from "react";

const mm = (value) => `${value}mm`;

const toNum = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMonto = (value) => toNum(value).toFixed(2);

// Formato fisico del anexo: 21.0 cm x 10.6 cm sobre hoja A4.
const PAGE = {
  width: 210,
  height: 106
};

// Ajustes globales para calibracion.
const CAL = {
  nudgeX: 0,
  nudgeY: 0,
  topData: {
    yLine1: 10.2,
    yCode: 17.2,
    yName: 23.0,
    xCalle: 2.2,
    xRuc: 36.0,
    xCodigo: 2.2,
    xNombre: 2.2
  },
  blocks: [
    {
      key: "CONTROL",
      x: 0,
      showHeaderData: true,
      conceptFont: 2.9,
      amountFont: 2.9,
      totalFont: 3.2,
      table: {
        conceptX: 3.8,
        conceptMax: 86,
        amountX: 95.4,
        amountWidth: 8.8,
        topY: 35.2,
        lineGap: 6.0,
        totalY: 91.2
      }
    },
    {
      key: "COPIA",
      x: 105,
      showHeaderData: false,
      conceptFont: 2.35,
      amountFont: 2.35,
      totalFont: 2.8,
      table: {
        conceptX: 1.8,
        conceptMax: 33.5,
        amountX: 44.2,
        amountWidth: 6.2,
        topY: 35.0,
        lineGap: 5.2,
        totalY: 91.0
      }
    },
    {
      key: "CAJA",
      x: 157.5,
      showHeaderData: false,
      conceptFont: 2.35,
      amountFont: 2.35,
      totalFont: 2.8,
      table: {
        conceptX: 1.8,
        conceptMax: 33.5,
        amountX: 44.2,
        amountWidth: 6.2,
        topY: 35.0,
        lineGap: 5.2,
        totalY: 91.0
      }
    }
  ]
};

const ReciboAnexoCaja = forwardRef(({ datos }, ref) => {
  if (!datos) return <div ref={ref}></div>;

  const codigoMunicipal = String(datos?.contribuyente?.codigo_municipal || "").trim();
  const nombreCompleto = String(datos?.contribuyente?.nombre_completo || "").trim();
  const calle = String(datos?.contribuyente?.calle || "").trim();
  const ruc = String(datos?.contribuyente?.ruc || "").trim();
  const detalleRows = (Array.isArray(datos?.detalles) ? datos.detalles : [])
    .map((row) => ({
      concepto: String(row?.concepto || "").trim(),
      importe: formatMonto(row?.importe)
    }))
    .filter((row) => row.concepto || toNum(row.importe) > 0)
    .slice(0, 5);
  const total = formatMonto(datos?.total);

  const x = (value) => mm(value + CAL.nudgeX);
  const y = (value) => mm(value + CAL.nudgeY);

  const baseText = {
    position: "absolute",
    fontFamily: "'Arial Narrow', Arial, sans-serif",
    color: "#1a2a4a",
    lineHeight: 1.1,
    textAlign: "left"
  };

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        width: mm(PAGE.width),
        height: mm(PAGE.height),
        overflow: "hidden",
        background: "transparent"
      }}
    >
      {CAL.blocks.map((block) => (
        <React.Fragment key={block.key}>
          {block.showHeaderData && (
            <>
              <div
                style={{
                  ...baseText,
                  left: x(block.x + CAL.topData.xCalle),
                  top: y(CAL.topData.yLine1),
                  fontSize: "2.6mm",
                  maxWidth: mm(34),
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {calle ? `CALLE: ${calle}` : ""}
              </div>
              <div
                style={{
                  ...baseText,
                  left: x(block.x + CAL.topData.xRuc),
                  top: y(CAL.topData.yLine1),
                  fontSize: "2.6mm",
                  maxWidth: mm(31),
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {ruc ? `RUC: ${ruc}` : ""}
              </div>
              <div
                style={{
                  ...baseText,
                  left: x(block.x + CAL.topData.xCodigo),
                  top: y(CAL.topData.yCode),
                  fontSize: "3.1mm",
                  fontWeight: 700,
                  maxWidth: mm(26),
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {codigoMunicipal}
              </div>
              <div
                style={{
                  ...baseText,
                  left: x(block.x + CAL.topData.xNombre),
                  top: y(CAL.topData.yName),
                  fontSize: "2.8mm",
                  maxWidth: mm(62),
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {nombreCompleto}
              </div>
            </>
          )}

          {detalleRows.map((row, idx) => (
            <React.Fragment key={`${block.key}-${idx}`}>
              <div
                style={{
                  ...baseText,
                  left: x(block.x + block.table.conceptX),
                  top: y(block.table.topY + (idx * block.table.lineGap)),
                  fontSize: mm(block.conceptFont),
                  maxWidth: mm(block.table.conceptMax),
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
                  left: x(block.x + block.table.amountX),
                  top: y(block.table.topY + (idx * block.table.lineGap)),
                  width: mm(block.table.amountWidth),
                  textAlign: "right",
                  fontSize: mm(block.amountFont),
                  fontWeight: 700
                }}
              >
                {row.importe}
              </div>
            </React.Fragment>
          ))}

          <div
            style={{
              ...baseText,
              left: x(block.x + block.table.amountX),
              top: y(block.table.totalY),
              width: mm(block.table.amountWidth),
              textAlign: "right",
              fontSize: mm(block.totalFont),
              fontWeight: 700
            }}
          >
            {total}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
});

ReciboAnexoCaja.displayName = "ReciboAnexoCaja";

export default ReciboAnexoCaja;
