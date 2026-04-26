import React, { forwardRef } from "react";
import { ReciboLuzCard } from "./ReciboLuz";

const RECIBOS_POR_HOJA = 3;

const RecibosLuzLote = forwardRef(({ items = [] }, ref) => {
  if (!Array.isArray(items) || items.length === 0) {
    return <div ref={ref}></div>;
  }

  const pages = [];
  for (let idx = 0; idx < items.length; idx += RECIBOS_POR_HOJA) {
    pages.push(items.slice(idx, idx + RECIBOS_POR_HOJA));
  }

  return (
    <div ref={ref} style={{ width: "210mm", background: "#fff" }}>
      {pages.map((pageItems, pageIdx) => {
        const isLastPage = pageIdx === pages.length - 1;
        return (
          <div
            key={`luz-lote-page-${pageIdx + 1}`}
            style={{
              width: "210mm",
              minHeight: "297mm",
              padding: "3mm",
              boxSizing: "border-box",
              pageBreakAfter: isLastPage ? "auto" : "always"
            }}
          >
            {pageItems.map((datos, idx) => (
              <div
                key={`luz-lote-${pageIdx}-${idx}-${datos?.recibo?.id_recibo || "sin-id"}`}
                style={{
                  marginBottom: idx === pageItems.length - 1 ? 0 : "1.5mm",
                  breakInside: "avoid",
                  pageBreakInside: "avoid"
                }}
              >
                <ReciboLuzCard datos={datos} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
});

RecibosLuzLote.displayName = "RecibosLuzLote";

export default RecibosLuzLote;
