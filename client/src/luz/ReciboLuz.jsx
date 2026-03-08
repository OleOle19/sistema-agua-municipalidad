import React, { forwardRef } from "react";

const formatMonto = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
};

const ReciboLuz = forwardRef(({ datos }, ref) => {
  if (!datos) return <div ref={ref}></div>;

  const suministro = datos.suministro || {};
  const recibo = datos.recibo || {};

  return (
    <div ref={ref} style={{ width: "148mm", padding: "10mm", fontFamily: "Arial, sans-serif", color: "#111", background: "#fff" }}>
      <div style={{ border: "1px solid #222", padding: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #222", paddingBottom: "6px", marginBottom: "6px" }}>
          <div>
            <div style={{ fontWeight: "700", fontSize: "13px" }}>MUNICIPALIDAD DISTRITAL DE PUEBLO NUEVO</div>
            <div style={{ fontSize: "11px" }}>Administracion del servicio de energia electrica</div>
          </div>
          <div style={{ textAlign: "right", fontSize: "11px" }}>
            <div><strong>Recibo N°:</strong> {String(recibo.id_recibo || "").padStart(6, "0")}</div>
            <div><strong>Periodo:</strong> {String(recibo.mes || "").padStart(2, "0")}/{recibo.anio || ""}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px", marginBottom: "6px" }}>
          <div><strong>Usuario:</strong> {suministro.nombre_usuario || "-"}</div>
          <div><strong>Zona:</strong> {suministro.zona || "-"}</div>
          <div><strong>N° Medidor:</strong> {suministro.nro_medidor || "-"}</div>
          <div><strong>Direccion:</strong> {suministro.direccion || "-"}</div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", marginBottom: "8px" }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #222", padding: "4px", textAlign: "left" }}>Concepto</th>
              <th style={{ border: "1px solid #222", padding: "4px", textAlign: "right" }}>Valor</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={{ border: "1px solid #222", padding: "4px" }}>Lectura anterior</td><td style={{ border: "1px solid #222", padding: "4px", textAlign: "right" }}>{formatMonto(recibo.lectura_anterior)} KW</td></tr>
            <tr><td style={{ border: "1px solid #222", padding: "4px" }}>Lectura actual</td><td style={{ border: "1px solid #222", padding: "4px", textAlign: "right" }}>{formatMonto(recibo.lectura_actual)} KW</td></tr>
            <tr><td style={{ border: "1px solid #222", padding: "4px" }}>Total de KW consumidos</td><td style={{ border: "1px solid #222", padding: "4px", textAlign: "right" }}>{formatMonto(recibo.consumo_kwh)} KW</td></tr>
            <tr><td style={{ border: "1px solid #222", padding: "4px" }}>Energia activa</td><td style={{ border: "1px solid #222", padding: "4px", textAlign: "right" }}>S/. {formatMonto(recibo.energia_activa)}</td></tr>
            <tr><td style={{ border: "1px solid #222", padding: "4px" }}>Mantenimiento y otros</td><td style={{ border: "1px solid #222", padding: "4px", textAlign: "right" }}>S/. {formatMonto(recibo.mantenimiento)}</td></tr>
            <tr><td style={{ border: "1px solid #222", padding: "4px", fontWeight: "700" }}>TOTAL A PAGAR</td><td style={{ border: "1px solid #222", padding: "4px", textAlign: "right", fontWeight: "700" }}>S/. {formatMonto(recibo.total_pagar)}</td></tr>
          </tbody>
        </table>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "11px" }}>
          <div><strong>Emision:</strong> {recibo.fecha_emision || "-"}</div>
          <div><strong>Vencimiento:</strong> {recibo.fecha_vencimiento || "-"}</div>
          <div><strong>Corte:</strong> {recibo.fecha_corte || "-"}</div>
        </div>
      </div>
    </div>
  );
});

ReciboLuz.displayName = "ReciboLuz";

export default ReciboLuz;
