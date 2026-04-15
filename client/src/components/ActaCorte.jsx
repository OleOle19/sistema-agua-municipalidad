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
      padding: isCompact ? "5.2mm 6.2mm" : "12mm 14mm",
      boxSizing: "border-box",
      background: "#fff",
      color: "#111",
      fontFamily: "\"Times New Roman\", Times, serif",
      fontSize: isCompact ? "12.8px" : "13px",
      lineHeight: isCompact ? 1.28 : 1.25,
      breakInside: "avoid",
      pageBreakInside: "avoid"
    },
    top: {
      display: "grid",
      gridTemplateColumns: isCompact ? "38px 1fr auto" : "72px 1fr auto",
      alignItems: "start",
      columnGap: isCompact ? "8px" : "10px",
      marginBottom: isCompact ? "7px" : "14px"
    },
    logo: {
      width: isCompact ? "34px" : "64px",
      height: isCompact ? "34px" : "64px",
      objectFit: "contain"
    },
    entidad: {
      textAlign: "center",
      fontWeight: 700,
      fontSize: isCompact ? "12.2px" : "14px",
      marginBottom: isCompact ? "1px" : "2px",
      textTransform: "uppercase"
    },
    title: {
      textAlign: "center",
      fontWeight: 700,
      fontSize: isCompact ? "18px" : "20px",
      letterSpacing: "0.4px",
      marginTop: 0,
      marginBottom: "0",
      textTransform: "uppercase"
    },
    fecha: {
      fontSize: isCompact ? "12.2px" : "14px",
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
      fontSize: isCompact ? "12.6px" : "14px",
      textTransform: "uppercase"
    },
    value: {
      fontWeight: 700,
      fontSize: isCompact ? "12.6px" : "14px",
      textTransform: "uppercase"
    },
    valueNormal: {
      fontWeight: 400,
      fontSize: isCompact ? "12.2px" : "14px",
      textTransform: "uppercase"
    },
    paragraph: {
      marginTop: isCompact ? "5px" : "8px",
      marginBottom: isCompact ? "7px" : "12px",
      fontSize: isCompact ? "12.3px" : "15px",
      textAlign: "justify",
      lineHeight: isCompact ? 1.3 : 1.35
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      tableLayout: "fixed",
      fontSize: isCompact ? "11.4px" : "13px",
      marginTop: isCompact ? "4px" : "6px"
    },
    th: {
      border: "1px solid #444",
      padding: isCompact ? "2px 3px" : "3px 4px",
      textAlign: "center",
      fontWeight: 700
    },
    td: {
      borderLeft: "1px solid #444",
      borderRight: "1px solid #444",
      borderBottom: "1px dotted #888",
      padding: isCompact ? "2px 3px" : "2px 4px",
      textAlign: "center"
    },
    tdRight: {
      borderLeft: "1px solid #444",
      borderRight: "1px solid #444",
      borderBottom: "1px dotted #888",
      padding: isCompact ? "2px 3px" : "2px 4px",
      textAlign: "right"
    },
    tdStrong: {
      borderLeft: "1px solid #444",
      borderRight: "1px solid #444",
      borderBottom: "1px dotted #888",
      padding: isCompact ? "2px 3px" : "2px 4px",
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
      padding: isCompact ? "3px 3px" : "5px 4px",
      textAlign: "center",
      fontWeight: 700,
      fontSize: isCompact ? "12.2px" : "15px"
    },
    totalCell: {
      border: "1px solid #444",
      padding: isCompact ? "3px 3px" : "5px 4px",
      textAlign: "center",
      fontWeight: 700,
      fontSize: isCompact ? "12.2px" : "15px"
    },
    totalCellRight: {
      border: "1px solid #444",
      padding: isCompact ? "3px 3px" : "5px 4px",
      textAlign: "right",
      fontWeight: 700,
      fontSize: isCompact ? "12.2px" : "15px"
    },
    closingText: {
      marginTop: isCompact ? "7px" : "12px",
      fontSize: isCompact ? "12.2px" : "14px",
      lineHeight: isCompact ? 1.28 : 1.35
    },
    firmaRow: {
      marginTop: isCompact ? "8px" : "16px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-end"
    },
    selloSpace: {
      width: "50mm",
      height: isCompact ? "14mm" : "50mm"
    },
    administracion: {
      textAlign: "right",
      fontSize: isCompact ? "12.2px" : "14px",
      paddingRight: isCompact ? "20px" : "50px"
    }
  };

  return (
    <div ref={ref} style={styles.page}>
      <div style={styles.top}>
        <div>
          <img src="/logo.png" alt="Logo Municipalidad" style={styles.logo} />
        </div>
        <div>
          <div style={styles.entidad}>MUNICIPALIDAD DISTRITAL DE PUEBLO NUEVO</div>
          <h2 style={styles.title}>NOTIFICACION ADMINISTRATIVA</h2>
        </div>
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
        Sr. a través de la presente le saludamos cordialmente y a la vez le comunicamos que la administración de agua
        potable y alcantarillado, le hace llegar su estado de cuenta por concepto de arbitrios municipales
        (Agua, desagüe y limpieza pública), siendo los años anteriores.
      </p>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={{ ...styles.th, width: "9%" }}>Año</th>
            <th style={{ ...styles.th, width: "8%" }}>Mes</th>
            <th style={{ ...styles.th, width: "15%" }}>Agua Potable</th>
            <th style={{ ...styles.th, width: "14%" }}>Desagüe</th>
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
        Sr. usuario, acercarse a la oficina de la administración para la cancelación respectiva; se realizará el corte respectivo.
      </div>

      <div style={styles.firmaRow}>
        <div style={styles.selloSpace}></div>
        <div style={styles.administracion}>LA ADMINISTRACIÓN MUNICIPAL</div>
      </div>
    </div>
  );
});

ActaCorte.displayName = "ActaCorte";

export default ActaCorte;



