import React, { forwardRef } from "react";
import ActaCorte from "./ActaCorte";

const GAP_MM = 1.5;

const ActasCorteLote = forwardRef(({ actas = [] }, ref) => {
  const lista = Array.isArray(actas) ? actas : [];
  if (lista.length === 0) return <div ref={ref}></div>;

  return (
    <div ref={ref} style={{ background: "#fff" }}>
      {lista.map((acta, idx) => (
        <div
          key={`${acta?.numero_acta || "acta"}-${idx}`}
          style={{
            breakInside: "avoid",
            pageBreakInside: "avoid",
            borderTop: idx > 0 ? "1px dashed #9ca3af" : "none",
            paddingTop: idx > 0 ? `${GAP_MM}mm` : 0,
            marginBottom: `${GAP_MM}mm`
          }}
        >
          <ActaCorte datos={acta} compact />
        </div>
      ))}
    </div>
  );
});

ActasCorteLote.displayName = "ActasCorteLote";

export default ActasCorteLote;
