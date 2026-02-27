import { forwardRef, useMemo } from "react";
import { compareByDireccionAsc, getStreetDisplayName, getStreetGroupKey } from "../utils/cortesAddress";

const esDeudorParaCorte = (c) => {
  const meses = Number(c?.meses_deuda || 0);
  const deuda = parseFloat(c?.deuda_anio || 0) || 0;
  const estadoConexion = String(c?.estado_conexion || "CON_CONEXION").trim().toUpperCase();
  return (meses >= 2 || deuda > 0) && estadoConexion === "CON_CONEXION";
};

const ReporteCortes = forwardRef(({ contribuyentes = [], datos = null }, ref) => {
  const alcance = datos?.criterio?.alcance || "deudores";
  const soloDeudores = alcance !== "todos";

  const lista = useMemo(() => {
    const rows = datos?.lista && Array.isArray(datos.lista)
      ? datos.lista
      : (Array.isArray(contribuyentes) ? contribuyentes : []).filter(esDeudorParaCorte);
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

  const criterio = datos?.criterio?.descripcion || (soloDeudores ? "Todos los morosos" : "Todos los usuarios");
  const fechaGeneracion = datos?.generado_en
    ? new Date(datos.generado_en)
    : new Date();
  const totalDeuda = lista.reduce((acc, curr) => acc + (parseFloat(curr.deuda_anio || 0) || 0), 0);
  const deudoresEnLista = lista.filter(esDeudorParaCorte).length;

  return (
    <div ref={ref} className="p-4 text-dark" style={{ width: "100%", fontFamily: "Arial, sans-serif", backgroundColor: "white" }}>
      <div className="text-center mb-3">
        <h3 className="fw-bold">
          {soloDeudores ? "REPORTE BRIGADA - ORDEN DE CORTES" : "FICHA BRIGADA - VERIFICACION DE USUARIOS"}
        </h3>
        <p className="text-muted mb-1">Municipalidad Distrital de Pueblo Nuevo</p>
        <p className="small mb-0">Fecha: {fechaGeneracion.toLocaleDateString()} {fechaGeneracion.toLocaleTimeString()}</p>
        <p className="small mb-0"><strong>Criterio:</strong> {criterio}</p>
        <p className="small"><strong>Orden:</strong> Calle y numero ascendente</p>
      </div>

      <div className={`alert ${soloDeudores ? "alert-danger border-danger" : "alert-primary border-primary"} mb-3 p-2 text-center`}>
        <strong>{soloDeudores ? "PENDIENTES DE CORTE" : "USUARIOS EN VERIFICACION"}:</strong> {lista.length}
        {!soloDeudores && (
          <>
            {" | "}
            <strong>DEUDORES EN LISTA:</strong> {deudoresEnLista}
          </>
        )}
        {" | "}
        <strong>TOTAL DEUDA:</strong> S/. {totalDeuda.toFixed(2)}
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
            <th>Visitado</th>
            <th>Cortado</th>
            <th>Fecha Corte</th>
            <th>Motivo / Obs</th>
            <th>Inspector</th>
          </tr>
        </thead>
        <tbody>
          {lista.length === 0 ? (
            <tr><td colSpan="12" className="text-center p-3">{soloDeudores ? "No hay morosos." : "No hay usuarios para este criterio."}</td></tr>
          ) : (
            (() => {
              let correlativo = 0;
              return listaPorCalle.map((entry) => {
                if (entry.type === "street") {
                  return (
                    <tr key={entry.key}>
                      <td colSpan="12" className="fw-bold bg-light text-uppercase">
                        Calle: {entry.street}
                      </td>
                    </tr>
                  );
                }
                correlativo += 1;
                const m = entry.row;
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
                    <td className="text-center">[ ]</td>
                    <td className="text-center">[ ]</td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                );
              });
            })()
          )}
        </tbody>
      </table>

      <div className="row mt-4 pt-4 text-center">
        <div className="col-4"><div className="border-top border-dark w-75 mx-auto pt-2">Responsable de Rentas</div></div>
        <div className="col-4"><div className="border-top border-dark w-75 mx-auto pt-2">Supervisor de Brigada</div></div>
        <div className="col-4"><div className="border-top border-dark w-75 mx-auto pt-2">Inspector / Notificador</div></div>
      </div>
    </div>
  );
});

ReporteCortes.displayName = "ReporteCortes";

export default ReporteCortes;
