import { forwardRef, useMemo } from "react";
import { compareByDireccionAsc, getStreetDisplayName, getStreetGroupKey } from "../utils/cortesAddress";

const ReporteCortes = forwardRef(({ contribuyentes = [], datos = null }, ref) => {
  const lista = useMemo(() => {
    const rows = datos?.lista && Array.isArray(datos.lista)
      ? datos.lista
      : (Array.isArray(contribuyentes) ? contribuyentes : []);
    return rows.slice().sort(compareByDireccionAsc);
  }, [datos, contribuyentes]);

  const listaPorCalle = useMemo(() => {
    const grupos = [];
    let calleActualKey = "";
    lista.forEach((row) => {
      const streetKey = getStreetGroupKey(row);
      const streetLabelRaw = getStreetDisplayName(row);
      const streetLabel = streetLabelRaw === "~" ? "sin calle" : streetLabelRaw;
      if (streetKey !== calleActualKey) {
        grupos.push({ type: "street", key: `street-${streetKey}-${grupos.length}`, street: streetLabel });
        calleActualKey = streetKey;
      }
      grupos.push({ type: "row", key: `row-${row.id_contribuyente}-${grupos.length}`, row });
    });
    return grupos;
  }, [lista]);

  const criterio = datos?.criterio?.descripcion || "Seleccion manual";
  const estadoLabel = String(datos?.criterio?.estado_label || "Contribuyentes");
  const estadoObjetivo = String(datos?.criterio?.estado_objetivo || "").toUpperCase();
  const fechaGeneracion = datos?.generado_en ? new Date(datos.generado_en) : new Date();
  const totalDeuda = lista.reduce((acc, curr) => acc + (parseFloat(curr.deuda_anio || 0) || 0), 0);
  const mostrarDetalleCorte = estadoObjetivo === "CORTADO";
  const mostrarEvidencia = mostrarDetalleCorte && Boolean(datos?.mostrar_evidencia);
  const formato = String(datos?.formato || "print").toLowerCase();

  return (
    <div ref={ref} className="p-4 text-dark" style={{ width: "100%", fontFamily: "Arial, sans-serif", backgroundColor: "white" }}>
      <div className="text-center mb-3">
        <h3 className="fw-bold">REPORTE DE ESTADO DE CONEXION</h3>
        <p className="text-muted mb-1">Municipalidad Distrital de Pueblo Nuevo</p>
        <p className="small mb-0">Fecha: {fechaGeneracion.toLocaleDateString()} {fechaGeneracion.toLocaleTimeString()}</p>
        <p className="small mb-0"><strong>Criterio:</strong> {criterio}</p>
        <p className="small mb-0"><strong>Estado:</strong> {estadoLabel}</p>
        <p className="small"><strong>Orden:</strong> Calle y numero ascendente</p>
      </div>

      <div className="alert alert-danger border-danger mb-3 p-2 text-center">
        <strong>REGISTROS:</strong> {lista.length}
        {" | "}
        <strong>TOTAL DEUDA:</strong> S/. {totalDeuda.toFixed(2)}
        {mostrarEvidencia && (
          <>
            {" | "}
            <strong>Modo:</strong> Exportación PDF
          </>
        )}
      </div>

      <table className="table table-bordered border-dark table-sm mb-4" style={{ fontSize: "11px" }}>
        <thead className="bg-light text-center">
          <tr>
            <th>#</th>
            <th>Cod. Mun.</th>
            <th>Contribuyente</th>
            <th>DNI</th>
            <th>Direccion</th>
            <th>Meses</th>
            <th>Deuda</th>
            {mostrarDetalleCorte && <th>Fecha Corte</th>}
            {mostrarDetalleCorte && <th>Motivo</th>}
            {mostrarEvidencia && <th>Evidencia</th>}
          </tr>
        </thead>
        <tbody>
          {lista.length === 0 ? (
            <tr><td colSpan={7 + (mostrarDetalleCorte ? 2 : 0) + (mostrarEvidencia ? 1 : 0)} className="text-center p-3">No hay datos para este criterio.</td></tr>
          ) : (
            (() => {
              let correlativo = 0;
              return listaPorCalle.map((entry) => {
                if (entry.type === "street") {
                  return (
                    <tr key={entry.key}>
                      <td colSpan={7 + (mostrarDetalleCorte ? 2 : 0) + (mostrarEvidencia ? 1 : 0)} className="fw-bold bg-light text-uppercase">
                        Calle: {entry.street}
                      </td>
                    </tr>
                  );
                }
                correlativo += 1;
                const m = entry.row || {};
                const fechaCorte = m.corte_fecha ? new Date(m.corte_fecha) : null;
                const fechaLabel = fechaCorte && !Number.isNaN(fechaCorte.getTime())
                  ? fechaCorte.toLocaleDateString("es-PE")
                  : "";
                return (
                  <tr key={entry.key}>
                    <td className="text-center">{correlativo}</td>
                    <td className="text-center fw-bold">{m.codigo_municipal}</td>
                    <td>{m.nombre_completo}</td>
                    <td className="text-center">{m.dni_ruc || "-"}</td>
                    <td>{m.direccion_completa}</td>
                    <td className={`text-center ${Number(m.meses_deuda || 0) > 0 ? "fw-bold text-danger" : ""}`}>{m.meses_deuda}</td>
                    <td className={`text-end ${parseFloat(m.deuda_anio || 0) > 0 ? "fw-bold" : "text-muted"}`}>
                      S/. {parseFloat(m.deuda_anio || 0).toFixed(2)}
                    </td>
                    {mostrarDetalleCorte && <td className="text-center">{fechaLabel}</td>}
                    {mostrarDetalleCorte && <td>{m.corte_motivo || m.estado_conexion_motivo_ultimo || ""}</td>}
                    {mostrarEvidencia && (
                      <td>{m.evidencia_resumen || "Sin evidencia adjunta"}</td>
                    )}
                  </tr>
                );
              });
            })()
          )}
        </tbody>
      </table>

      {formato === "print" && (
        <div className="small text-muted">
          Este formato de impresión no incluye el detalle de evidencias adjuntas.
        </div>
      )}
    </div>
  );
});

ReporteCortes.displayName = "ReporteCortes";

export default ReporteCortes;
