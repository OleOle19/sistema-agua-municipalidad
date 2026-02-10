import React, { forwardRef } from "react";

const Recibo = forwardRef(({ datos }, ref) => {
  if (!datos) return <div ref={ref}></div>;

  const { contribuyente, predio, recibo, detalles } = datos;

  const formatMonto = (value) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
  };

  const getMesNombre = (value) => {
    const meses = [
      "Enero",
      "Febrero",
      "Marzo",
      "Abril",
      "Mayo",
      "Junio",
      "Julio",
      "Agosto",
      "Septiembre",
      "Octubre",
      "Noviembre",
      "Diciembre"
    ];
    const num = parseInt(value, 10);
    if (Number.isFinite(num) && num >= 1 && num <= 12) return meses[num - 1];
    return value ?? "";
  };

  const mesLabel = recibo.mes_nombre ?? getMesNombre(recibo.mes);
  const anioLabel = recibo.anio ?? "";
  const reciboNumero = recibo.id_recibo ? recibo.id_recibo.toString().padStart(6, "0") : "";
  const fechaEmision = new Date().toLocaleDateString();
  const ultimoDiaPago = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toLocaleDateString();
  const fechaCorte = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 5).toLocaleDateString();

  const styles = {
    container: {
      width: "14cm",
      height: "20cm",
      backgroundColor: "transparent",
      fontFamily: "'Arial Narrow', Arial, sans-serif",
      fontSize: "10px",
      color: "#000",
      margin: "0 auto",
      position: "relative"
    },
    sectionTop: {
      display: "flex",
      height: "14cm"
    },
    sectionBottom: {
      display: "flex",
      height: "6cm"
    },
    leftSpacer: {
      width: "25px",
      flexShrink: 0
    },
    content: {
      flex: 1,
      padding: "5px 10px",
      display: "flex",
      flexDirection: "column"
    },
    headerSpacer: {
      height: "50px"
    },
    rowThree: {
      display: "flex",
      marginBottom: "6px",
      alignItems: "center"
    },
    colLeft: {
      flex: 1
    },
    colCenter: {
      flex: 1,
      textAlign: "center"
    },
    colRight: {
      flex: 1,
      textAlign: "right"
    },
    value: {
      fontWeight: "bold"
    },
    gridTop: {
      display: "grid",
      gridTemplateColumns: "80px 1fr",
      alignItems: "center",
      minHeight: "14px"
    },
    gridBottom: {
      display: "grid",
      gridTemplateColumns: "60px 1fr",
      alignItems: "center",
      minHeight: "14px"
    },
    spacerSm: {
      height: "6px"
    },
    noteSpacer: {
      height: "12px"
    },
    noteText: {
      fontSize: "9px",
      fontStyle: "italic",
      textAlign: "center"
    },
    itemRow: {
      display: "flex",
      alignItems: "center",
      minHeight: "14px"
    },
    itemAmount: {
      width: "60px",
      textAlign: "right",
      fontWeight: "bold"
    },
    totalAmount: {
      width: "70px",
      textAlign: "right",
      fontWeight: "bold",
      fontSize: "12px"
    },
    datesRow: {
      display: "flex",
      justifyContent: "space-between",
      marginTop: "6px"
    },
    dateBox: {
      width: "50%"
    },
    dateLabelSpacer: {
      height: "10px"
    },
    debtRow: {
      display: "flex",
      gap: "10px",
      marginTop: "6px",
      fontSize: "9px"
    },
    debtCol: {
      flex: 1
    },
    debtTitle: {
      fontWeight: "bold",
      marginBottom: "2px",
      paddingBottom: "2px",
      borderBottom: "1px solid #000",
      textAlign: "center",
      width: "50%",
      marginLeft: "auto",
      marginRight: "auto"
    },
    debtTable: {
      padding: "2px 0",
      width: "50%",
      margin: "0 auto"
    },
    debtHeader: {
      display: "flex",
      fontWeight: "bold",
      borderBottom: "1px solid #000",
      paddingBottom: "2px",
      marginBottom: "2px"
    },
    debtRowLine: {
      display: "flex",
      justifyContent: "space-between",
      padding: "1px 0"
    },
    debtTotal: {
      display: "flex",
      justifyContent: "space-between",
      borderTop: "1px solid #000",
      marginTop: "2px",
      paddingTop: "2px",
      fontWeight: "bold"
    },
    debtColLeft: {
      width: "60%",
      textAlign: "left"
    },
    debtColRight: {
      width: "40%",
      textAlign: "right"
    },
    cajaTotal: {
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "center",
      marginTop: "auto",
      paddingTop: "4px"
    },
    cajaTotalLabelSpacer: {
      width: "90px"
    },
    cajaTotalAmount: {
      fontWeight: "bold",
      fontSize: "18px"
    }
  };

  return (
    <div ref={ref} style={styles.container}>
      {/* PARTE SUPERIOR - USUARIO (SOLO DATOS) */}
      <div style={styles.sectionTop}>
        <div style={styles.leftSpacer} />
        <div style={styles.content}>
          <div style={styles.headerSpacer} />

          <div style={styles.rowThree}>
            <div style={styles.colLeft}><span style={styles.value}>{mesLabel}</span></div>
            <div style={styles.colCenter}><span style={styles.value}>{anioLabel}</span></div>
            <div style={styles.colRight}><span style={styles.value}>{reciboNumero}</span></div>
          </div>

          <div style={styles.gridTop}>
            <span />
            <span style={styles.value}>{contribuyente.codigo_municipal}</span>
          </div>
          <div style={styles.gridTop}>
            <span />
            <span style={styles.value}>{contribuyente.nombre_completo}</span>
          </div>
          <div style={styles.gridTop}>
            <span />
            <span style={styles.value}>{predio.direccion_completa}</span>
          </div>
          <div style={styles.gridTop}>
            <span />
            <span style={styles.value}>PUEBLO NUEVO</span>
          </div>

          <div style={styles.spacerSm} />

          <div>
            <div style={styles.itemRow}>
              <span style={{ flex: 1 }} />
              <span style={styles.itemAmount} />
            </div>
            <div style={styles.itemRow}>
              <span style={{ flex: 1 }} />
              <span style={styles.itemAmount}>{formatMonto(detalles.agua)}</span>
            </div>
            <div style={styles.itemRow}>
              <span style={{ flex: 1 }} />
              <span style={styles.itemAmount}>{formatMonto(detalles.desague)}</span>
            </div>
            <div style={styles.itemRow}>
              <span style={{ flex: 1 }} />
              <span style={styles.itemAmount}>{formatMonto(detalles.limpieza)}</span>
            </div>
            <div style={styles.itemRow}>
              <span style={{ flex: 1 }} />
              <span style={styles.itemAmount}>{formatMonto(detalles.admin)}</span>
            </div>
            <div style={styles.itemRow}>
              <span style={{ flex: 1 }} />
              <span style={styles.totalAmount}>{formatMonto(recibo.total)}</span>
            </div>
          </div>

          <div style={styles.noteText}>
            "El pago de este recibo no cancela deudas anteriores."
          </div>

          <div style={styles.datesRow}>
            <div style={styles.dateBox}>
              <div style={styles.dateLabelSpacer} />
              <div style={styles.value}>{fechaEmision}</div>
            </div>
            <div style={{ ...styles.dateBox, textAlign: "right" }}>
              <div style={styles.dateLabelSpacer} />
              <div style={styles.value}>{ultimoDiaPago}</div>
            </div>
          </div>

          <div style={styles.debtRow}>
            <div style={styles.debtCol}>
              <div style={styles.debtTitle}>Deuda Anterior</div>
              <div style={styles.debtTable}>
                <div style={styles.debtHeader}>
                  <span style={styles.debtColLeft}>Año</span>
                  <span style={styles.debtColRight}>Deuda S/.</span>
                </div>
                <div style={styles.debtRowLine}>
                  <span style={styles.debtColLeft}>{anioLabel}</span>
                  <span style={styles.debtColRight}>{formatMonto(contribuyente.deuda_anio || 0)}</span>
                </div>
                <div style={styles.debtTotal}>
                  <span style={styles.debtColLeft}>Total</span>
                  <span style={styles.debtColRight}>{formatMonto(contribuyente.deuda_anio || 0)}</span>
                </div>
              </div>
            </div>
            <div style={styles.debtCol}>
              <div style={styles.debtTitle}>Mes</div>
              <div style={styles.debtTable}>
                <div style={styles.debtHeader}>
                  <span style={styles.debtColLeft}>Mes</span>
                  <span style={styles.debtColRight}>Deuda S/.</span>
                </div>
                <div style={styles.debtRowLine}>
                  <span style={styles.debtColLeft}>&nbsp;</span>
                  <span style={styles.debtColRight}>&nbsp;</span>
                </div>
                <div style={styles.debtTotal}>
                  <span style={styles.debtColLeft}>Total</span>
                  <span style={styles.debtColRight}>&nbsp;</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PARTE INFERIOR - CAJA (SOLO DATOS) */}
      <div style={styles.sectionBottom}>
        <div style={styles.leftSpacer} />
        <div style={styles.content}>
          <div style={styles.rowThree}>
            <div style={styles.colLeft}><span style={styles.value}>{mesLabel}</span></div>
            <div style={styles.colCenter}><span style={styles.value}>{anioLabel}</span></div>
            <div style={styles.colRight}><span style={styles.value}>{reciboNumero}</span></div>
          </div>

          <div style={styles.gridBottom}>
            <span />
            <span style={styles.value}>{contribuyente.nombre_completo}</span>
          </div>
          <div style={styles.gridBottom}>
            <span />
            <span style={styles.value}>{fechaEmision}</span>
          </div>
          <div style={styles.gridBottom}>
            <span />
            <span style={styles.value}>{fechaCorte}</span>
          </div>

          <div style={styles.cajaTotal}>
            <span style={styles.cajaTotalLabelSpacer} />
            <span style={styles.cajaTotalAmount}>{formatMonto(recibo.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

Recibo.displayName = "Recibo";
export default Recibo;
