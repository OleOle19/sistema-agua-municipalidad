import React, { forwardRef } from "react";
import { ReciboLuzCard } from "./ReciboLuz";

const RECIBOS_POR_HOJA = 3;

const RecibosLuzLote = forwardRef(({ items = [] }, ref) => {
  if (!Array.isArray(items) || items.length === 0) {
    return <div ref={ref}></div>;
  }

  return (
    <div ref={ref} style={{ width: "297mm", minHeight: "210mm", padding: "4mm", background: "#fff" }}>
      {items.map((datos, idx) => {
        const isEndOfPage = ((idx + 1) % RECIBOS_POR_HOJA) === 0;
        const isLast = idx === (items.length - 1);
        return (
          <div
            key={`luz-lote-${idx}-${datos?.recibo?.id_recibo || "sin-id"}`}
            style={{
              height: "66mm",
              marginBottom: isEndOfPage || isLast ? "0" : "2mm",
              breakInside: "avoid",
              pageBreakInside: "avoid",
              pageBreakAfter: isEndOfPage && !isLast ? "always" : "auto"
            }}
          >
            <ReciboLuzCard datos={datos} />
          </div>
        );
      })}
    </div>
  );
});

RecibosLuzLote.displayName = "RecibosLuzLote";

export default RecibosLuzLote;
