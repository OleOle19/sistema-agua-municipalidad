import React, { forwardRef } from "react";

const mm = (value) => `${value}mm`;

const toNum = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMonto = (value) => toNum(value).toFixed(2);

// Formato fisico del anexo: 21.0 cm x 10.6 cm.
const PAGE = {
  width: 210,
  height: 106
};

// Ajuste global para pruebas de calibracion (mm).
const CAL = {
  nudgeX: 0,
  nudgeY: 0,
  blocks: [
    { key: "CONTROL", x: 0, width: 70, showHeaderData: true },
    { key: "COPIA", x: 70, width: 70, showHeaderData: false },
    { key: "CAJA", x: 140, width: 70, showHeaderData: false }
  ],
  table: {
    conceptX: 3.8,
    amountX: 58.0,
    amountWidth: 9.0,
    topY: 35.2,
    lineGap: 6.0,
    totalY: 91.2
  },
  topData: {
    yLine1: 10.2,
    yCode: 17.2,
    yName: 23.0,
    xCalle: 2.2,
    xRuc: 36.0,
    xCodigo: 2.2,
    xNombre: 2.2
  }
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
      {CAL.blocks.map((block) => {
        const blockX = block.x;

        return (
          <React.Fragment key={block.key}>
            {block.showHeaderData && (
              <>
                <div
                  style={{
                    ...baseText,
                    left: x(blockX + CAL.topData.xCalle),
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
                    left: x(blockX + CAL.topData.xRuc),
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
                    left: x(blockX + CAL.topData.xCodigo),
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
                    left: x(blockX + CAL.topData.xNombre),
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
                    left: x(blockX + CAL.table.conceptX),
                    top: y(CAL.table.topY + (idx * CAL.table.lineGap)),
                    fontSize: "2.9mm",
                    maxWidth: mm(CAL.table.amountX - CAL.table.conceptX - 1),
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
                    left: x(blockX + CAL.table.amountX),
                    top: y(CAL.table.topY + (idx * CAL.table.lineGap)),
                    width: mm(CAL.table.amountWidth),
                    textAlign: "right",
                    fontSize: "2.9mm",
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
                left: x(blockX + CAL.table.amountX),
                top: y(CAL.table.totalY),
                width: mm(CAL.table.amountWidth),
                textAlign: "right",
                fontSize: "3.2mm",
                fontWeight: 700
              }}
            >
              {total}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
});

ReciboAnexoCaja.displayName = "ReciboAnexoCaja";

export default ReciboAnexoCaja;
