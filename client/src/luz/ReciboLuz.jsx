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

const ReciboLuz = forwardRef(({ datos }, ref) => {
  if (!datos) return <div ref={ref}></div>;

  const suministro = datos.suministro || {};
  const recibo = datos.recibo || {};
  const reciboId = Number(recibo.id_recibo || 0);

  return (
    <div ref={ref} style={{ width: "210mm", padding: "8mm", fontFamily: "Arial, sans-serif", color: "#111", background: "#fff" }}>
      <div style={{ border: "1.5px solid #222", padding: "6px 7px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "6px" }}>
          <div style={{ flex: 1, fontSize: "13px", lineHeight: 1.35 }}>
            <div style={{ fontWeight: 700, textTransform: "uppercase" }}>
              Municipalidad Distrital de Pueblo Nuevo  RUC Nro 20192401004
            </div>
            <div style={{ marginTop: "6px" }}><strong>Recibo Nro:</strong> {reciboId > 0 ? String(reciboId) : "-"}</div>
            <div><strong>Usuario:</strong> {suministro.nombre_usuario || "-"}</div>
            <div>{suministro.zona || "-"}</div>
            <div>
              <strong>Periodo Facturacion:</strong> <strong>{formatPeriodo(recibo.anio, recibo.mes)}</strong>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "62px", height: "62px", border: "1.5px solid #222", borderRadius: "50%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
              <img src="/logo.png" alt="Logo Municipalidad" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            <div style={{ width: "300px", border: "2px solid #222", textAlign: "center", fontSize: "12px", fontWeight: 700, lineHeight: 1.2, padding: "6px 8px", textTransform: "uppercase" }}>
              Administracion del servicio de energia electrica de la Municipalidad Distrital de Pueblo Nuevo
            </div>
          </div>
        </div>

        <div style={{ border: "1.5px solid #222" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.35fr 0.95fr" }}>
            <div style={{ borderRight: "1.5px solid #222" }}>
              <div style={{ borderBottom: "1.5px solid #222", background: "#d8ecf0", fontSize: "12px", fontWeight: 700, padding: "3px 6px", textTransform: "uppercase" }}>
                Datos del suministro y consumo
              </div>
              <div style={{ minHeight: "190px", padding: "8px 8px 10px", fontSize: "13px", lineHeight: 1.5 }}>
                <div style={{ marginBottom: "6px" }}><strong>Nro Medidor</strong>  <strong>{suministro.nro_medidor || "-"}</strong></div>
                <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", rowGap: "2px" }}>
                  <div>Lectura anterior</div>
                  <div style={{ textAlign: "right", fontWeight: 700 }}>{formatMonto(recibo.lectura_anterior)} KW</div>
                  <div>Lectura actual</div>
                  <div style={{ textAlign: "right", fontWeight: 700 }}>{formatMonto(recibo.lectura_actual)} KW</div>
                  <div>Total de Kw consum.</div>
                  <div style={{ textAlign: "right", fontWeight: 700 }}>{formatMonto(recibo.consumo_kwh)} KW</div>
                </div>
              </div>
            </div>
            <div>
              <div style={{ borderBottom: "1.5px solid #222", background: "#d8ecf0", fontSize: "12px", fontWeight: 700, padding: "3px 6px", textTransform: "uppercase" }}>
                Importes facturados
              </div>
              <div style={{ minHeight: "190px", padding: "8px 8px 10px", fontSize: "13px", lineHeight: 1.65 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px" }}>
                  <div style={{ textTransform: "uppercase" }}>Energia activa</div>
                  <div style={{ textAlign: "right" }}>{formatMonto(recibo.energia_activa)}</div>
                  <div style={{ textTransform: "uppercase" }}>Mantenimiento y otros</div>
                  <div style={{ textAlign: "right" }}>{formatMonto(recibo.mantenimiento)}</div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ borderTop: "1.5px solid #222", display: "grid", gridTemplateColumns: "1.35fr 0.95fr" }}>
            <div style={{ borderRight: "1.5px solid #222", padding: "8px", fontSize: "12px", lineHeight: 1.65 }}>
              <div><strong>Fecha de emision:</strong> {formatFecha(recibo.fecha_emision)}</div>
              <div><strong>Fecha de vencimiento:</strong> {formatFecha(recibo.fecha_vencimiento)}</div>
              <div><strong>Fecha de corte:</strong> {formatFecha(recibo.fecha_corte)}</div>
            </div>
            <div style={{ padding: "8px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "10px" }}>
              <div style={{ fontSize: "20px", fontWeight: 700 }}>TOTAL A PAGAR S/.</div>
              <div style={{ fontSize: "38px", fontWeight: 700 }}>{formatMonto(recibo.total_pagar)}</div>
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: "18px", fontWeight: 700, marginTop: "2px" }}>M.D.P.N.</div>
      </div>
    </div>
  );
});

ReciboLuz.displayName = "ReciboLuz";

export default ReciboLuz;

