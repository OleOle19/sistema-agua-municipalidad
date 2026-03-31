import React, { forwardRef } from "react";

const toNum = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMonto = (value) => toNum(value).toFixed(2);

const mm = (value) => `${value}mm`;

// Ajuste fino global para mover todo el texto en pruebas de calibracion.
const NUDGE_X_MM = 0;
const NUDGE_Y_MM = 0;

const BLOCKS = [
  {
    key: "CONTROL",
    x: 0,
    width: 105,
    showTopData: true
  },
  {
    key: "COPIA",
    x: 105,
    width: 52.5,
    showTopData: false
  },
  {
    key: "CAJA",
    x: 157.5,
    width: 52.5,
    showTopData: false
  }
];

// Misma caja de tabla en los 3 bloques (alineacion uniforme).
const TABLE_BOX = {
  conceptX: 2.2,
  conceptY: 39.8,
  lineGap: 5.2,
  amountX: 40.6,
  amountWidth: 9.4,
  totalY: 94.1
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

  const baseFont = {
    position: "absolute",
    fontFamily: "'Arial Narrow', Arial, sans-serif",
    color: "#1a2a4a",
    lineHeight: 1.1
  };

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        width: mm(210),
        height: mm(106),
        boxSizing: "border-box",
        overflow: "hidden",
        background: "transparent"
      }}
    >
      {BLOCKS.map((block) => {
        const blockX = block.x + NUDGE_X_MM;
        const blockY = NUDGE_Y_MM;

        return (
          <React.Fragment key={block.key}>
            {block.showTopData && (
              <>
                <div
                  style={{
                    ...baseFont,
                    left: mm(blockX + 12.2),
                    top: mm(blockY + 10.2),
                    fontSize: "2.4mm",
                    maxWidth: mm(46),
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}
                >
                  {calle ? `CALLE: ${calle}` : ""}
                </div>
                <div
                  style={{
                    ...baseFont,
                    left: mm(blockX + 64.8),
                    top: mm(blockY + 10.2),
                    fontSize: "2.4mm",
                    maxWidth: mm(36),
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}
                >
                  {ruc ? `RUC: ${ruc}` : ""}
                </div>
                <div
                  style={{
                    ...baseFont,
                    left: mm(blockX + 13.2),
                    top: mm(blockY + 21.6),
                    fontSize: "3.1mm",
                    fontWeight: 600,
                    maxWidth: mm(32),
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}
                >
                  {codigoMunicipal}
                </div>
                <div
                  style={{
                    ...baseFont,
                    left: mm(blockX + 16.5),
                    top: mm(blockY + 27.6),
                    fontSize: "2.8mm",
                    maxWidth: mm(84),
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
                    ...baseFont,
                    left: mm(blockX + TABLE_BOX.conceptX),
                    top: mm(blockY + TABLE_BOX.conceptY + (idx * TABLE_BOX.lineGap)),
                    fontSize: "2.8mm",
                    maxWidth: mm(TABLE_BOX.amountX - TABLE_BOX.conceptX - 1.2),
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}
                >
                  {row.concepto}
                </div>
                <div
                  style={{
                    ...baseFont,
                    left: mm(blockX + TABLE_BOX.amountX),
                    top: mm(blockY + TABLE_BOX.conceptY + (idx * TABLE_BOX.lineGap)),
                    width: mm(TABLE_BOX.amountWidth),
                    textAlign: "right",
                    fontSize: "2.8mm",
                    fontWeight: 600
                  }}
                >
                  {row.importe}
                </div>
              </React.Fragment>
            ))}

            <div
              style={{
                ...baseFont,
                left: mm(blockX + TABLE_BOX.amountX),
                top: mm(blockY + TABLE_BOX.totalY),
                width: mm(TABLE_BOX.amountWidth),
                textAlign: "right",
                fontSize: "3.1mm",
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
