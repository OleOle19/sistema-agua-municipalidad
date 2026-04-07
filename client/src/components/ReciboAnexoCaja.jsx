import React, { forwardRef } from "react";

const mm = (value) => `${value}mm`;

const toNum = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMonto = (value) => toNum(value).toFixed(2);
const splitCompactConcept = (value) => {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return ["", ""];

  const idxDe = text.indexOf(" DE ");
  if (idxDe > 0) {
    const line1 = text.slice(0, idxDe).trim();
    const line2 = text.slice(idxDe + 1).trim(); // mantiene "DE ..."
    return [line1 || line2, line2];
  }

  const parts = text.split(" ");
  if (parts.length <= 1) return [text, ""];
  return [parts[0], parts.slice(1).join(" ")];
};

// Formato fisico del anexo:
// - Ancho A4 completo (21.0 cm)
// - Largo aproximado del recibo: 9.8 cm
const PAGE = {
  width: 210,
  height: 98
};

// Calibracion solicitada:
// - Margen izquierdo/derecho: 0.9 cm (9 mm)
// - Primer texto alrededor de 1.6 cm desde el borde superior
const LAYOUT = {
  sideMarginX: 9,
  firstLineTopY: 16,
  baseWidth: 210,
  baseHeight: 106
};

// Textos editables del anexo.
// Si quieres cambiar etiquetas impresas, edita este objeto.
const ANEXO_TEXTOS = {
  prefijoCalle: "CALLE:",
  prefijoRuc: "RUC:"
};

const CAL = {
  // Coordenadas de los datos de cabecera (solo bloque CONTROL).
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
      // Bloque izquierdo principal.
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
        totalY: 91.2,
        yOffsetMm: 5,
        conceptOffsetMm: 0,
        amountOffsetMm: -4
      }
    },
    {
      // Bloque central (copia).
      key: "COPIA",
      x: 105,
      compact: true,
      showHeaderData: false,
      conceptFont: 2.35,
      amountFont: 2.35,
      totalFont: 2.8,
      table: {
        conceptX: 1.8,
        conceptMax: 26.5,
        amountX: 30.2,
        amountWidth: 6.2,
        topY: 35.0,
        lineGap: 8.0,
        totalY: 91.0,
        yOffsetMm: 5,
        conceptOffsetMm: 15,
        amountOffsetMm: 10
      }
    },
    {
      // Bloque derecho (caja).
      key: "CAJA",
      x: 157.5,
      compact: true,
      showHeaderData: false,
      conceptFont: 2.35,
      amountFont: 2.35,
      totalFont: 2.8,
      table: {
        conceptX: 1.8,
        conceptMax: 26.5,
        amountX: 30.2,
        amountWidth: 6.2,
        topY: 35.0,
        lineGap: 8.0,
        totalY: 91.0,
        yOffsetMm: 5,
        conceptOffsetMm: 18,
        amountOffsetMm: 18
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

  // Escalado/calibracion a medidas fisicas solicitadas.
  const scaleX = (LAYOUT.baseWidth - (LAYOUT.sideMarginX * 2)) / LAYOUT.baseWidth;
  const scaleY = PAGE.height / LAYOUT.baseHeight;
  const offsetY = LAYOUT.firstLineTopY - (CAL.topData.yLine1 * scaleY);
  const fontScale = Math.min(scaleX, scaleY);

  const x = (value) => mm((value * scaleX) + LAYOUT.sideMarginX);
  const y = (value) => mm((value * scaleY) + offsetY);
  const xWithOffset = (value, offsetMm = 0) => mm((value * scaleX) + LAYOUT.sideMarginX + offsetMm);
  const yWithOffset = (value, offsetMm = 0) => mm((value * scaleY) + offsetY + offsetMm);
  const w = (value) => mm(value * scaleX);
  const h = (value) => mm(value * scaleY);
  const fs = (value) => mm(value * fontScale);

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
                  fontSize: fs(2.6),
                  maxWidth: w(34),
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {calle ? `${ANEXO_TEXTOS.prefijoCalle} ${calle}` : ""}
              </div>
              <div
                style={{
                  ...baseText,
                  left: x(block.x + CAL.topData.xRuc),
                  top: y(CAL.topData.yLine1),
                  fontSize: fs(2.6),
                  maxWidth: w(31),
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {ruc ? `${ANEXO_TEXTOS.prefijoRuc} ${ruc}` : ""}
              </div>
              <div
                style={{
                  ...baseText,
                  left: x(block.x + CAL.topData.xCodigo),
                  top: y(CAL.topData.yCode),
                  fontSize: fs(3.1),
                  fontWeight: 700,
                  maxWidth: w(26),
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
                  fontSize: fs(2.8),
                  maxWidth: w(62),
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {nombreCompleto}
              </div>
            </>
          )}

          {detalleRows.map((row, idx) => {
            const [line1, line2] = block.compact ? splitCompactConcept(row.concepto) : [row.concepto, ""];
            return (
              <React.Fragment key={`${block.key}-${idx}`}>
                <div
                  style={{
                    ...baseText,
                    left: xWithOffset(block.x + block.table.conceptX, block.table.conceptOffsetMm || 0),
                    top: yWithOffset(block.table.topY + (idx * block.table.lineGap), block.table.yOffsetMm || 0),
                    fontSize: fs(block.conceptFont),
                    maxWidth: w(block.table.conceptMax),
                    whiteSpace: block.compact ? "normal" : "nowrap",
                    lineHeight: block.compact ? 1.0 : 1.1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    minHeight: block.compact ? h(block.conceptFont * 2.3) : "auto"
                  }}
                >
                  {block.compact ? (
                    <>
                      <span style={{ display: "block" }}>{line1}</span>
                      <span style={{ display: "block" }}>{line2}</span>
                    </>
                  ) : (
                    row.concepto
                  )}
                </div>
                <div
                  style={{
                    ...baseText,
                    left: xWithOffset(block.x + block.table.amountX, block.table.amountOffsetMm || 0),
                    top: yWithOffset(block.table.topY + (idx * block.table.lineGap), block.table.yOffsetMm || 0),
                    width: w(block.table.amountWidth),
                    textAlign: "right",
                    fontSize: fs(block.amountFont),
                    fontWeight: 700
                  }}
                >
                  {row.importe}
                </div>
              </React.Fragment>
            );
          })}

          <div
            style={{
              ...baseText,
              left: xWithOffset(block.x + block.table.amountX, block.table.amountOffsetMm || 0),
              top: yWithOffset(block.table.totalY, block.table.yOffsetMm || 0),
              width: w(block.table.amountWidth),
              textAlign: "right",
              fontSize: fs(block.totalFont),
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
