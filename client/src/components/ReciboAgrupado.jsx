import React from "react";

const ReciboAgrupado = React.forwardRef(({ datos }, ref) => {
  if (!datos) return null;

  const { usuario, recibos, totalTotal, fecha, codigo_operacion } = datos;
  const currentYear = new Date().getFullYear();
  const formatMonto = (value) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
  };

  return (
    <div ref={ref} className="p-4" style={{ fontFamily: "Courier New, monospace", width: "100%", maxWidth: "800px", margin: "0 auto", fontSize: "14px" }}>
      {/* CABECERA */}
      <div className="text-center mb-3">
        <h4 className="fw-bold mb-0">MUNICIPALIDAD DISTRITAL DE PUEBLO NUEVO</h4>
        <p className="mb-0 small">RUC: 20175962819</p>
        <p className="mb-0 small">Jr. Santa Rosa N° 123 - Pueblo Nuevo</p>
        <hr style={{ borderTop: "2px dashed #000" }} />
        <h5 className="fw-bold mt-2">RECIBO DE PAGO AGRUPADO</h5>
        <p className="mb-0">N° Operación: {codigo_operacion}</p>
        <p className="mb-0">Fecha: {fecha}</p>
      </div>

      {/* DATOS DEL CLIENTE */}
      <div className="mb-3">
        <div className="row">
          <div className="col-12"><strong>Contribuyente:</strong> {usuario.nombre_completo}</div>
          <div className="col-12"><strong>Código:</strong> {usuario.codigo_municipal}</div>
          <div className="col-12"><strong>Dirección:</strong> {usuario.direccion_completa}</div>
        </div>
      </div>

      {/* DETALLE DE MESES PAGADOS */}
      <table className="table table-sm table-borderless mb-2">
        <thead style={{ borderBottom: "1px solid #000" }}>
          <tr>
            <th className="text-start">PERIODO</th>
            <th className="text-start">CONCEPTO</th>
            <th className="text-end">SUBTOTAL</th>
          </tr>
        </thead>
        <tbody>
          {recibos.map((r, i) => (
            <tr key={i}>
              <td>{r.mes}/{r.anio ?? currentYear}</td>
              <td>Servicio de Agua Potable y Alcantarillado</td>
              <td className="text-end">S/. {formatMonto(r.total_pagar ?? r.deuda_mes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      
      <hr style={{ borderTop: "1px solid #000" }} />

      {/* TOTALES */}
      <div className="d-flex justify-content-between align-items-center fs-5 fw-bold">
        <span>TOTAL PAGADO:</span>
        <span>S/. {formatMonto(totalTotal)}</span>
      </div>

      {/* PIE DE PÁGINA */}
      <div className="mt-5 text-center small">
        <p className="mb-4">______________________________________<br/>Firma y Sello de Caja</p>
        <p>¡Gracias por su puntualidad!<br/>El agua es vida, cuídala.</p>
      </div>
    </div>
  );
});

export default ReciboAgrupado;
