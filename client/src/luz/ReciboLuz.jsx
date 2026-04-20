import React, { forwardRef } from "react";

const MONTH_NAMES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const formatMonto = (value) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return "0.00";
  return parsed.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const formatFecha = (value) => {
  const text = String(value || "").trim();
  if (!text) return "-";
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) return text;
  const d = String(dt.getDate()).padStart(2, "0");
  const mo = String(dt.getMonth() + 1).padStart(2, "0");
  const y = dt.getFullYear();
  return `${d}/${mo}/${y}`;
};

const formatPeriodo = (anio, mes) => {
  const anioNum = Number.parseInt(String(anio || ""), 10);
  const mesNum = Number.parseInt(String(mes || ""), 10);
  if (!anioNum || mesNum < 1 || mesNum > 12) return "-";
  return `${MONTH_NAMES[mesNum]}-${anioNum}`;
};

const ReciboLuzCard = ({ datos }) => {
  if (!datos) return null;

  const suministro = datos.suministro || {};
  const recibo = datos.recibo || {};
  const reciboId = Number(recibo.id_recibo || 0);

  return (
    <div style={{ border: "1.2px solid #111", padding: "2mm 2.4mm", minHeight: "65.5mm", width: "100%", fontFamily: "Arial, sans-serif", color: "#111", background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "3mm", marginBottom: "1.5mm" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", lineHeight: 1.15 }}>
            Municipalidad Distrital de Pueblo Nuevo - RUC 20192401004
          </div>
          <div style={{ fontSize: "8.5px", lineHeight: 1.2, marginTop: "1mm" }}>
            Administracion del servicio de energia electrica
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "2mm" }}>
          <div style={{ width: "11mm", height: "11mm", border: "1px solid #222", borderRadius: "50%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
            <img src="/logo.png" alt="Logo Municipalidad" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <div style={{ border: "1.2px solid #222", padding: "1.2mm 1.8mm", fontSize: "8px", fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap" }}>
            Recibo Nro: {reciboId > 0 ? String(reciboId) : "-"}
          </div>
        </div>
      </div>

      <div style={{ border: "1px solid #222" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr 0.85fr", borderBottom: "1px solid #222" }}>
          <div style={{ borderRight: "1px solid #222", padding: "1.4mm 1.8mm", fontSize: "8.3px", lineHeight: 1.3 }}>
            <div><strong>Usuario:</strong> {suministro.nombre_usuario || "-"}</div>
            <div><strong>ID:</strong> {suministro.nro_medidor || "-"}</div>
            <div><strong>Zona:</strong> {suministro.zona || "-"}</div>
            <div><strong>Periodo:</strong> {formatPeriodo(recibo.anio, recibo.mes)}</div>
          </div>
          <div style={{ borderRight: "1px solid #222", padding: "1.4mm 1.8mm", fontSize: "8.3px", lineHeight: 1.32 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "6px" }}>
              <span>Lectura anterior</span>
              <strong>{formatMonto(recibo.lectura_anterior)} KW</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "6px" }}>
              <span>Lectura actual</span>
              <strong>{formatMonto(recibo.lectura_actual)} KW</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "6px" }}>
              <span>Consumo mes</span>
              <strong>{formatMonto(recibo.consumo_kwh)} KW</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "6px", marginTop: "0.8mm" }}>
              <span>Energia activa</span>
              <span>{formatMonto(recibo.energia_activa)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "6px" }}>
              <span>Mantenimiento</span>
              <span>{formatMonto(recibo.mantenimiento)}</span>
            </div>
          </div>
          <div style={{ padding: "1.4mm 1.8mm", fontSize: "8.3px", lineHeight: 1.3 }}>
            <div><strong>Emision:</strong> {formatFecha(recibo.fecha_emision)}</div>
            <div><strong>Vence:</strong> {formatFecha(recibo.fecha_vencimiento)}</div>
            <div><strong>Corte:</strong> {formatFecha(recibo.fecha_corte)}</div>
            <div style={{ marginTop: "1.5mm", borderTop: "1px dashed #333", paddingTop: "1.1mm", textAlign: "right" }}>
              <div style={{ fontSize: "8px", fontWeight: 700 }}>TOTAL A PAGAR S/.</div>
              <div style={{ fontSize: "17px", fontWeight: 700, lineHeight: 1 }}>{formatMonto(recibo.total_pagar)}</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.8mm 1.8mm", fontSize: "7.6px" }}>
          <span>Comprobante de energia electrica municipal</span>
          <strong>M.D.P.N.</strong>
        </div>
      </div>
    </div>
  );
};

const ReciboLuz = forwardRef(({ datos }, ref) => {
  if (!datos) return <div ref={ref}></div>;

  return (
    <div ref={ref} style={{ width: "297mm", minHeight: "210mm", padding: "4mm", fontFamily: "Arial, sans-serif", color: "#111", background: "#fff" }}>
      <ReciboLuzCard datos={datos} />
    </div>
  );
});

ReciboLuz.displayName = "ReciboLuz";

export { ReciboLuzCard };
export default ReciboLuz;
