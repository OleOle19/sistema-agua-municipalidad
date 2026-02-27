import React, { forwardRef } from "react";
import ActaCorte from "./ActaCorte";

const PAGE_HEIGHT_MM = 285;
const GAP_MM = 1.5;
const MAX_ACTAS_PER_PAGE = 4;

const estimateActaHeightMm = (acta) => {
  const detalle = acta?.detalle_deuda || {};
  const porAnio = Array.isArray(detalle.por_anio) ? detalle.por_anio : [];
  const meses = porAnio.reduce((acc, g) => {
    const lista = Array.isArray(g?.meses) ? g.meses : [];
    return acc + lista.length;
  }, 0);
  const rowsTabla = porAnio.length === 0
    ? 3 // header + 1 fila + total
    : (1 + porAnio.length + meses + 1); // header + filas anio + filas mes + total

  const baseMm = 34;
  const rowMm = 2.8;
  const direccionLen = String(acta?.contribuyente?.direccion_completa || "").length;
  const extraDireccion = direccionLen > 45 ? 2 : 0;
  return baseMm + (rowsTabla * rowMm) + extraDireccion;
};

const buildPages = (list) => {
  const pages = [];
  let current = [];
  let usedMm = 0;

  for (const acta of list) {
    const h = estimateActaHeightMm(acta);
    const gap = current.length > 0 ? GAP_MM : 0;
    const projected = usedMm + gap + h;
    const overByCount = current.length >= MAX_ACTAS_PER_PAGE;
    const overByHeight = current.length > 0 && projected > PAGE_HEIGHT_MM;

    if (overByCount || overByHeight) {
      pages.push(current);
      current = [acta];
      usedMm = h;
      continue;
    }

    current.push(acta);
    usedMm = projected;
  }

  if (current.length > 0) {
    pages.push(current);
  }
  return pages;
};

const ActasCorteLote = forwardRef(({ actas = [] }, ref) => {
  const lista = Array.isArray(actas) ? actas : [];
  if (lista.length === 0) return <div ref={ref}></div>;
  const hojas = buildPages(lista);

  return (
    <div ref={ref} style={{ background: "#fff" }}>
      {hojas.map((grupo, hojaIdx) => (
        <div
          key={`hoja-${hojaIdx}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1.5mm",
            boxSizing: "border-box",
            background: "#fff",
            pageBreakAfter: hojaIdx < hojas.length - 1 ? "always" : "auto"
          }}
        >
          {grupo.map((acta, idx) => (
            <div
              key={`${acta?.numero_acta || "acta"}-${idx}`}
              style={{
                breakInside: "avoid",
                pageBreakInside: "avoid",
                borderTop: idx > 0 ? "1px dashed #9ca3af" : "none",
                paddingTop: idx > 0 ? "1.5mm" : 0
              }}
            >
              <ActaCorte datos={acta} compact />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

ActasCorteLote.displayName = "ActasCorteLote";

export default ActasCorteLote;
