import React, { forwardRef } from "react";

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const money = (value) => toNumber(value).toFixed(2);

const formatFechaCorta = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const ActaCorte = forwardRef(({ datos, compact = false }, ref) => {
  if (!datos) return <div ref={ref}></div>;

  const acta = datos || {};
  const c = acta.contribuyente || {};
  const detalle = acta.detalle_deuda || {};
  const porAnio = Array.isArray(detalle.por_anio) ? detalle.por_anio : [];
  const totalDetalle = detalle.total || {};

  const totalAgua = toNumber(totalDetalle.agua);
  const totalDesague = toNumber(totalDetalle.desague);
  const totalLimpieza = toNumber(totalDetalle.limpieza);
  const totalAdmin = toNumber(totalDetalle.admin);
  const totalGeneral = porAnio.length > 0
    ? toNumber(totalDetalle.deuda_total)
    : toNumber(c.deuda_total);
  const isCompact = Boolean(compact);

  const styles = {
    page: {
      width: "100%",
      minHeight: "auto",
      height: "auto",
      margin: 0,
      padding: isCompact ? "3.5mm 4.5mm" : "12mm 14mm",
      boxSizing: "border-box",
      background: "#fff",
      color: "#111",
      fontFamily: "\"Times New Roman\", Times, serif",
      fontSize: isCompact ? "10px" : "13px",
      lineHeight: isCompact ? 1.12 : 1.25,
      breakInside: "avoid",
      pageBreakInside: "avoid"
    },
    top: {
      display: "grid",
      gridTemplateColumns: "1fr auto",
      alignItems: "start",
      marginBottom: isCompact ? "6px" : "14px"
    },
    title: {
      textAlign: "center",
      fontWeight: 700,
      fontSize: isCompact ? "14px" : "20px",
      letterSpacing: "0.4px",
      marginTop: "2px",
      marginBottom: "0",
      textTransform: "uppercase"
    },
    fecha: {
      fontSize: isCompact ? "10px" : "14px",
      fontWeight: 400,
      whiteSpace: "nowrap",
      marginTop: "3px"
    },
    datosFila: {
      display: "grid",
      gridTemplateColumns: isCompact ? "96px 1fr" : "150px 1fr",
      columnGap: "8px",
      alignItems: "baseline"
    },
    label: {
      fontWeight: 700,
      fontSize: isCompact ? "10px" : "14px",
      textTransform: "uppercase"
    },
    value: {
      fontWeight: 700,
      fontSize: isCompact ? "10px" : "14px",
      textTransform: "uppercase"
    },
    valueNormal: {
      fontWeight: 400,
      fontSize: isCompact ? "10px" : "14px",
      textTransform: "uppercase"
    },
    paragraph: {
      marginTop: isCompact ? "4px" : "8px",
      marginBottom: isCompact ? "6px" : "12px",
      fontSize: isCompact ? "10px" : "15px",
      textAlign: "justify",
      lineHeight: isCompact ? 1.1 : 1.35
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      tableLayout: "fixed",
      fontSize: isCompact ? "9px" : "13px",
      marginTop: isCompact ? "3px" : "6px"
    },
    th: {
      border: "1px solid #444",
      padding: isCompact ? "1px 3px" : "3px 4px",
      textAlign: "center",
      fontWeight: 700
    },
    td: {
      borderLeft: "1px solid #444",
      borderRight: "1px solid #444",
      borderBottom: "1px dotted #888",
      padding: isCompact ? "1px 3px" : "2px 4px",
      textAlign: "center"
    },
    tdRight: {
      borderLeft: "1px solid #444",
      borderRight: "1px solid #444",
      borderBottom: "1px dotted #888",
      padding: isCompact ? "1px 3px" : "2px 4px",
      textAlign: "right"
    },
    tdStrong: {
      borderLeft: "1px solid #444",
      borderRight: "1px solid #444",
      borderBottom: "1px dotted #888",
      padding: isCompact ? "1px 3px" : "2px 4px",
      textAlign: "center",
      fontWeight: 700
    },
    yearRow: {
      borderTop: "1px solid #444"
    },
    totalRow: {
      border: "1px solid #444",
      fontWeight: 700
    },
    totalLabel: {
      border: "1px solid #444",
      padding: isCompact ? "2px 3px" : "5px 4px",
      textAlign: "center",
      fontWeight: 700,
      fontSize: isCompact ? "10px" : "15px"
    },
    totalCell: {
      border: "1px solid #444",
      padding: isCompact ? "2px 3px" : "5px 4px",
      textAlign: "center",
      fontWeight: 700,
      fontSize: isCompact ? "10px" : "15px"
    },
    totalCellRight: {
      border: "1px solid #444",
      padding: isCompact ? "2px 3px" : "5px 4px",
      textAlign: "right",
      fontWeight: 700,
      fontSize: isCompact ? "10px" : "15px"
    },
    closingText: {
      marginTop: isCompact ? "6px" : "12px",
      fontSize: isCompact ? "10px" : "14px",
      lineHeight: isCompact ? 1.1 : 1.35
    },
    administracion: {
      marginTop: isCompact ? "8px" : "18px",
      textAlign: "right",
      fontSize: isCompact ? "10px" : "14px",
      paddingRight: isCompact ? "16px" : "50px"
    }
  };

  return (
    <div ref={ref} style={styles.page}>
      <div style={styles.top}>
        <h2 style={styles.title}>NOTIFICACION ADMINISTRATIVA</h2>
        <div style={styles.fecha}>{formatFechaCorta(acta.fecha_emision)}</div>
      </div>

      <div style={styles.datosFila}>
        <div style={styles.label}>SR(A):</div>
        <div style={styles.value}>{c.nombre_completo || "-"}</div>
      </div>
      <div style={styles.datosFila}>
        <div style={styles.label}>DIRECCION:</div>
        <div style={styles.valueNormal}>{c.direccion_completa || "-"}</div>
      </div>

      <p style={styles.paragraph}>
        Sr. a traves de la presente le saludamos cordialmente y a la vez le comunicamos que la administracion de agua
        potable y alcantarillado, le hace llegar su estado de cuenta por concepto de arbitrios municipales
        (Agua, desague y limpieza publica), siendo los años anteriores.
      </p>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={{ ...styles.th, width: "9%" }}>Año</th>
            <th style={{ ...styles.th, width: "8%" }}>Mes</th>
            <th style={{ ...styles.th, width: "15%" }}>Agua Potable</th>
            <th style={{ ...styles.th, width: "14%" }}>Desague</th>
            <th style={{ ...styles.th, width: "14%" }}>Limpieza</th>
            <th style={{ ...styles.th, width: "14%" }}>Gasto Admin.</th>
            <th style={{ ...styles.th, width: "16%" }}>Deuda Anual</th>
          </tr>
        </thead>
        <tbody>
          {porAnio.length === 0 ? (
            <tr>
              <td style={styles.td}>-</td>
              <td style={styles.td}>-</td>
              <td style={styles.td}>-</td>
              <td style={styles.td}>-</td>
              <td style={styles.td}>-</td>
              <td style={styles.td}>-</td>
              <td style={styles.tdRight}>S/. {money(totalGeneral)}</td>
            </tr>
          ) : porAnio.map((grupo) => (
            <React.Fragment key={`year-${grupo.anio}`}>
              <tr style={styles.yearRow}>
                <td style={styles.tdStrong}>{grupo.anio}</td>
                <td style={styles.td}></td>
                <td style={styles.tdRight}>{money(grupo.total_agua)}</td>
                <td style={styles.tdRight}>{money(grupo.total_desague)}</td>
                <td style={styles.tdRight}>{money(grupo.total_limpieza)}</td>
                <td style={styles.tdRight}>{money(grupo.total_admin)}</td>
                <td style={styles.tdRight}>S/. {money(grupo.deuda_anual)}</td>
              </tr>
              {(Array.isArray(grupo.meses) ? grupo.meses : []).map((mesRow, idx) => (
                <tr key={`year-${grupo.anio}-mes-${mesRow.mes}-${idx}`}>
                  <td style={styles.td}></td>
                  <td style={styles.td}>{mesRow.mes}</td>
                  <td style={styles.tdRight}>{money(mesRow.agua)}</td>
                  <td style={styles.tdRight}>{money(mesRow.desague)}</td>
                  <td style={styles.tdRight}>{money(mesRow.limpieza)}</td>
                  <td style={styles.tdRight}>{money(mesRow.admin)}</td>
                  <td style={styles.tdRight}>{money(mesRow.total_mes)}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
          <tr>
            <td style={styles.totalLabel} colSpan={2}>Deuda Total</td>
            <td style={styles.totalCell}>{money(totalAgua)}</td>
            <td style={styles.totalCell}>{money(totalDesague)}</td>
            <td style={styles.totalCell}>{money(totalLimpieza)}</td>
            <td style={styles.totalCell}>{money(totalAdmin)}</td>
            <td style={styles.totalCellRight}>S/. {money(totalGeneral)}</td>
          </tr>
        </tbody>
      </table>

      <div style={styles.closingText}>
        Sr. usuario acercarse a la oficina de la administracion para la cancelacion respectiva, se realizara el corte respectivo.
      </div>

      <div style={styles.administracion}>LA ADMINISTRACION</div>
    </div>
  );
});

ActaCorte.displayName = "ActaCorte";

export default ActaCorte;
