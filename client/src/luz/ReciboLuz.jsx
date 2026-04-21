import React, { forwardRef } from "react";

const MONTH_NAMES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const parseNum = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMonto = (value) => {
  const parsed = parseNum(value);
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

const resolveReciboNumero = (recibo = {}) => {
  const candidates = [recibo.id_recibo, recibo.numero_recibo, recibo.codigo_impresion, recibo.codigo_recibo];
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "-";
};

const formatUserUbicacion = (suministro = {}) => {
  return String(suministro.direccion || suministro.zona || "-").trim() || "-";
};

const ReciboLuzCard = ({ datos }) => {
  if (!datos) return null;

  const suministro = datos.suministro || {};
  const recibo = datos.recibo || {};
  const reciboNumero = resolveReciboNumero(recibo);
  const medidor = String(suministro.nro_medidor_real || suministro.nro_medidor || "-").trim() || "-";
  const lecturaAnterior = formatMonto(recibo.lectura_anterior);
  const lecturaActual = formatMonto(recibo.lectura_actual);
  const consumo = formatMonto(recibo.consumo_kwh);
  const energiaActiva = formatMonto(recibo.energia_activa);
  const mantenimiento = formatMonto(recibo.mantenimiento);
  const total = formatMonto(recibo.total_pagar);

  return (
    <div style={{ border: "1.2px solid #111", width: "100%", minHeight: "65.5mm", fontFamily: "\"Times New Roman\", serif", color: "#111", background: "#fff" }}>
      <div style={{ padding: "2.2mm 2mm 1.4mm", borderBottom: "1px solid #111" }}>
        <div style={{ fontSize: "4.2mm", fontWeight: 700, lineHeight: 1.05, letterSpacing: "0.2px", textTransform: "uppercase" }}>
          Municipalidad Distrital de Pueblo Nuevo  RUC Nro 20192401004
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "58% 42%", borderBottom: "1px solid #111", minHeight: "20.5mm" }}>
        <div style={{ padding: "1.5mm 2mm 1.3mm", fontSize: "3.85mm", lineHeight: 1.17 }}>
          <div style={{ display: "grid", gridTemplateColumns: "33mm 1fr", marginBottom: "0.8mm" }}>
            <span style={{ textTransform: "uppercase" }}>Recibo Nro:</span>
            <strong>{reciboNumero}</strong>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "33mm 1fr", marginBottom: "0.8mm" }}>
            <span>Usuario:</span>
            <strong style={{ textTransform: "uppercase" }}>{String(suministro.nombre_usuario || "-").trim() || "-"}</strong>
          </div>
          <div style={{ textTransform: "uppercase", marginBottom: "1.15mm" }}>{formatUserUbicacion(suministro)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "41mm 1fr", alignItems: "baseline" }}>
            <span>Periodo Facturacion:</span>
            <strong style={{ textAlign: "left" }}>{formatPeriodo(recibo.anio, recibo.mes)}</strong>
          </div>
        </div>

        <div style={{ borderLeft: "1px solid #111", padding: "1.5mm 1.6mm 1.2mm" }}>
          <div style={{ display: "grid", gridTemplateColumns: "17mm 1fr", gap: "1.6mm", alignItems: "center" }}>
            <div style={{ width: "16mm", height: "16mm", border: "1px solid #222", borderRadius: "50%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", margin: "0 auto" }}>
              <img src="/logo.png" alt="Logo Municipalidad" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            <div style={{ border: "1px solid #222", textAlign: "center", fontSize: "3.45mm", fontWeight: 700, lineHeight: 1.12, padding: "1.6mm 1.1mm", textTransform: "uppercase" }}>
              Administracion del servicio de energia electrica de la Municipalidad Distrital de Pueblo Nuevo
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "58% 42%", background: "#dbeff2", borderBottom: "1px solid #111", fontWeight: 700, textTransform: "uppercase", fontSize: "4mm", lineHeight: 1, minHeight: "6.5mm" }}>
        <div style={{ padding: "1.25mm 2mm", borderRight: "1px solid #111" }}>Datos del suministro y consumo</div>
        <div style={{ padding: "1.25mm 1.8mm" }}>Importes facturados</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "58% 42%", minHeight: "32mm" }}>
        <div style={{ borderRight: "1px solid #111", padding: "1.8mm 2mm 1.5mm" }}>
          <div style={{ display: "grid", gridTemplateColumns: "39mm 1fr", fontSize: "4mm", marginBottom: "1.15mm" }}>
            <strong style={{ textTransform: "uppercase" }}>Nro medidor</strong>
            <strong>{medidor}</strong>
          </div>

          <div style={{ marginLeft: "18.5mm", marginTop: "2mm", fontSize: "4.4mm", lineHeight: 1.25 }}>
            <div style={{ display: "grid", gridTemplateColumns: "39mm 1fr", marginBottom: "1.15mm" }}>
              <span>Lectura anterior</span>
              <strong>{lecturaAnterior} KW</strong>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "39mm 1fr", marginBottom: "1.15mm" }}>
              <span>Lectura actual</span>
              <strong>{lecturaActual} KW</strong>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "39mm 1fr", marginBottom: "1.15mm" }}>
              <span>Total de Kw consum.</span>
              <strong>{consumo} KW</strong>
            </div>
          </div>

          <div style={{ marginTop: "11.6mm", fontSize: "4.1mm", lineHeight: 1.28 }}>
            <div style={{ display: "grid", gridTemplateColumns: "37mm 1fr", marginBottom: "0.6mm" }}>
              <strong>Fecha de emision:</strong>
              <strong>{formatFecha(recibo.fecha_emision)}</strong>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "37mm 1fr", marginBottom: "0.6mm" }}>
              <strong>Fecha de vencimiento:</strong>
              <strong>{formatFecha(recibo.fecha_vencimiento)}</strong>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "37mm 1fr" }}>
              <strong>Fecha de corte</strong>
              <strong>{formatFecha(recibo.fecha_corte)}</strong>
            </div>
          </div>
        </div>

        <div style={{ padding: "1.8mm 1.8mm 1.5mm", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: "4.45mm", lineHeight: 1.3 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 16mm", marginBottom: "1.05mm", alignItems: "baseline" }}>
              <span style={{ textTransform: "uppercase" }}>Energia activa</span>
              <strong style={{ textAlign: "right" }}>{energiaActiva}</strong>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 16mm", alignItems: "baseline" }}>
              <span style={{ textTransform: "uppercase" }}>Mantenimiento y otros</span>
              <strong style={{ textAlign: "right" }}>{mantenimiento}</strong>
            </div>
          </div>

          <div style={{ marginTop: "auto", paddingTop: "2.5mm", fontSize: "4.7mm", lineHeight: 1.15 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "baseline" }}>
              <strong style={{ textTransform: "uppercase" }}>Total a pagar S/,</strong>
              <strong style={{ fontSize: "8mm" }}>****{total}</strong>
            </div>
            <div style={{ textAlign: "right", fontWeight: 700, marginTop: "0.9mm" }}>M.D.P.N.</div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ReciboLuz = forwardRef(({ datos }, ref) => {
  if (!datos) return <div ref={ref}></div>;

  return (
    <div ref={ref} style={{ width: "210mm", minHeight: "297mm", padding: "4mm", fontFamily: "\"Times New Roman\", serif", color: "#111", background: "#fff" }}>
      <ReciboLuzCard datos={datos} />
    </div>
  );
});

ReciboLuz.displayName = "ReciboLuz";

export { ReciboLuzCard };
export default ReciboLuz;
