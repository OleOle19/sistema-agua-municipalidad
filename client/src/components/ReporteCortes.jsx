import { forwardRef } from "react";

const ReporteCortes = forwardRef(({ contribuyentes }, ref) => {
  // Filtramos datos
  const morosos = contribuyentes ? contribuyentes.filter(c => parseInt(c.meses_deuda || 0) >= 2) : [];
  const totalDeuda = morosos.reduce((acc, curr) => acc + parseFloat(curr.deuda_anio || 0), 0);

  return (
    <div ref={ref} className="p-5 text-dark" style={{ width: "100%", fontFamily: "Arial, sans-serif", backgroundColor: "white" }}>
      
      <div className="text-center mb-4">
        <h3 className="fw-bold">ORDEN DE CORTE DE SERVICIO</h3>
        <p className="text-muted">Municipalidad Distrital de Pueblo Nuevo</p>
        <p className="small">Fecha: {new Date().toLocaleDateString()}</p>
      </div>

      <div className="alert alert-danger mb-4 p-2 text-center border-danger">
        <strong>PENDIENTES DE CORTE:</strong> {morosos.length} | <strong>TOTAL:</strong> S/. {totalDeuda.toFixed(2)}
      </div>

      <table className="table table-bordered border-dark table-sm" style={{ fontSize: "12px" }}>
        <thead className="bg-light text-center">
          <tr>
            <th>#</th><th>Cód. Mun.</th><th>Apellidos y Nombres</th><th>Dirección</th><th>Meses</th><th>Deuda</th>
          </tr>
        </thead>
        <tbody>
          {morosos.length === 0 ? (
            <tr><td colSpan="6" className="text-center p-3">No hay morosos.</td></tr>
          ) : (
            morosos.map((m, index) => (
              <tr key={m.id_contribuyente}>
                <td className="text-center">{index + 1}</td>
                <td className="text-center fw-bold">{m.codigo_municipal}</td>
                <td>{m.nombre_completo}</td>
                <td>{m.direccion_completa}</td>
                <td className="text-center fw-bold text-danger">{m.meses_deuda}</td>
                <td className="text-end fw-bold">S/. {m.deuda_anio}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="row mt-5 pt-5 text-center">
        <div className="col-6"><div className="border-top border-dark w-75 mx-auto pt-2">Responsable de Rentas</div></div>
        <div className="col-6"><div className="border-top border-dark w-75 mx-auto pt-2">Técnico Ejecutor</div></div>
      </div>
    </div>
  );
});

ReporteCortes.displayName = "ReporteCortes";

export default ReporteCortes;