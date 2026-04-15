import React, { forwardRef } from "react";
import ActaCorte from "./ActaCorte";

const GAP_MM = 2.8;
const ACTA_SLOT_MM = 141;
const ACTAS_PER_PAGE = 2;

const ActasCorteLote = forwardRef(({ actas = [] }, ref) => {
  const lista = Array.isArray(actas) ? actas : [];
  if (lista.length === 0) return <div ref={ref}></div>;

  return (
    <div ref={ref} style={{ background: "#fff" }}>
      {lista.map((acta, idx) => {
        const isLast = idx === lista.length - 1;
        const forcePageBreak = !isLast && ((idx + 1) % ACTAS_PER_PAGE === 0);
        return (
        <div
          key={`${acta?.numero_acta || "acta"}-${idx}`}
          style={{
            breakInside: "avoid",
            pageBreakInside: "avoid",
            borderTop: idx > 0 ? "1px dashed #9ca3af" : "none",
            paddingTop: idx > 0 ? `${GAP_MM}mm` : 0,
            marginBottom: `${GAP_MM}mm`,
            minHeight: `${ACTA_SLOT_MM}mm`,
            pageBreakAfter: forcePageBreak ? "always" : "auto"
          }}
        >
          <ActaCorte datos={acta} compact />
        </div>
        );
      })}
    </div>
  );
});

ActasCorteLote.displayName = "ActasCorteLote";

export default ActasCorteLote;
