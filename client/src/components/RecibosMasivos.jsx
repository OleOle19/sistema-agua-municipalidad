import React, { forwardRef } from "react";
import Recibo from "./Recibo"; // IMPORTAMOS EL DISEÑO MAESTRO

const RecibosMasivos = forwardRef(({ datos }, ref) => {
  const listaRecibos = datos || [];

  // Función para agrupar de 2 en 2
  const chunkArray = (myArray, chunk_size) => {
    let index = 0;
    const arrayLength = myArray.length;
    const tempArray = [];
    for (index = 0; index < arrayLength; index += chunk_size) {
        let myChunk = myArray.slice(index, index + chunk_size);
        tempArray.push(myChunk);
    }
    return tempArray;
  }

  const paresDeRecibos = chunkArray(listaRecibos, 2);

  // Estilo HOJA A4 HORIZONTAL (297mm x 210mm)
  const hojaStyle = {
    width: "297mm",  
    height: "209mm", 
    pageBreakAfter: "always",
    display: "flex", 
    backgroundColor: "white",
    overflow: "hidden"
  };

  if (listaRecibos.length === 0) return <div ref={ref}>No hay datos</div>;

  return (
    <div ref={ref}>
      {paresDeRecibos.map((par, index) => (
        <div key={index} style={hojaStyle}>
            
            {/* LADO IZQUIERDO (Recibo 1) */}
            <div style={{ width: "50%", height: "100%", borderRight: "1px dashed #ccc", display: "flex", justifyContent: "center" }}>
                 <ReciboRender item={par[0]} />
            </div>

            {/* LADO DERECHO (Recibo 2) */}
            <div style={{ width: "50%", height: "100%", display: "flex", justifyContent: "center" }}>
                {par[1] && <ReciboRender item={par[1]} />}
            </div>

        </div>
      ))}
    </div>
  );
});

// Helper para adaptar los datos planos al formato que espera <Recibo />
const ReciboRender = ({ item }) => {
    const datosEstructurados = {
        contribuyente: {
            nombre_completo: item.nombre_completo,
            codigo_municipal: item.codigo_municipal,
            dni_ruc: item.dni_ruc,
            deuda_anio: 0 // Ajustar si tienes este dato real
        },
        predio: {
            direccion_completa: item.direccion_completa
        },
        recibo: {
            id_recibo: item.id_recibo,
            mes: item.mes,
            anio: item.anio,
            total: item.total_pagar
        },
        detalles: {
            agua: item.subtotal_agua,
            desague: item.subtotal_desague,
            limpieza: item.subtotal_limpieza,
            admin: item.subtotal_admin
        }
    };
    // Pasamos ref={null} porque aquí no necesitamos capturar el recibo individual
    return <Recibo datos={datosEstructurados} ref={null} />;
};

RecibosMasivos.displayName = "RecibosMasivos";
export default RecibosMasivos;