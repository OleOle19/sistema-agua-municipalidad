import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { useReactToPrint } from 'react-to-print';
import { FaPrint, FaCalendarAlt, FaMoneyBillWave } from "react-icons/fa";

const ModalCierre = ({ cerrarModal, darkMode }) => {
  const [movimientos, setMovimientos] = useState([]);
  const [total, setTotal] = useState(0);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  
  const componentRef = useRef();
  
  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `Cierre_Caja_${fecha}`,
  });

  const cargarCaja = async () => {
    try {
      const res = await axios.get(`http://localhost:5000/caja/diaria?fecha=${fecha}`);
      setMovimientos(res.data.movimientos);
      setTotal(res.data.total);
    } catch (error) { console.error(error); }
  };

  useEffect(() => { cargarCaja(); }, [fecha]);

  // ESTILOS
  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff" } : { backgroundColor: "#fff" };
  const borderClass = darkMode ? "border-secondary" : "border-dark";

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content" style={modalStyle}>
          <div className="modal-header">
            <h5 className="modal-title"><FaMoneyBillWave className="me-2"/> Reporte de Cobranza Diaria</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
          </div>
          
          <div className="modal-body">
            <div className="d-flex justify-content-between mb-3 align-items-center no-print">
               <div className="d-flex align-items-center gap-2">
                   <label>Fecha de Consulta:</label>
                   <input type="date" className="form-control" value={fecha} onChange={(e) => setFecha(e.target.value)} />
               </div>
               <div className="fs-4 fw-bold text-success">
                   Total: S/. {total}
               </div>
            </div>

            {/* ÁREA DE IMPRESIÓN (DISEÑO TIPO REPORTE FORMAL) */}
            <div ref={componentRef} className="p-4" style={{ backgroundColor: "#fff", color: "#000" }}>
                {/* CABECERA DEL REPORTE */}
                <div className="row mb-4 border-bottom border-2 border-dark pb-2">
                    <div className="col-2 text-center d-flex align-items-center justify-content-center">
                        {/* Espacio para Logo */}
                        <img src="/logo.png" alt="Logo" style={{ width: "60px", height: "60px", objectFit: "contain" }} />
                    </div>
                    <div className="col-8 text-center">
                        <h4 className="fw-bold m-0">MUNICIPALIDAD DISTRITAL DE PUEBLO NUEVO</h4>
                        <h5 className="m-0">REPORTE DETALLADO DE INGRESOS DE CAJA</h5>
                        <p className="small m-0">Área de Administración Tributaria - Agua Potable</p>
                    </div>
                    <div className="col-2 text-end small">
                        <div><strong>Fecha:</strong> {fecha}</div>
                        <div><strong>Hora Imp.:</strong> {new Date().toLocaleTimeString()}</div>
                    </div>
                </div>

                <table className="table table-sm table-striped border border-dark" style={{ fontSize: "12px" }}>
                  <thead className="table-dark text-white">
                    <tr>
                      <th className="text-center">#</th>
                      <th className="text-center">HORA</th>
                      <th>CÓDIGO</th>
                      <th>CONTRIBUYENTE</th>
                      <th className="text-center">PERIODO</th>
                      <th className="text-end">MONTO (S/.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimientos.length === 0 ? (
                        <tr><td colSpan="6" className="text-center p-3">No hay movimientos registrados en esta fecha.</td></tr>
                    ) : (
                        movimientos.map((m, i) => (
                            <tr key={m.id_pago}>
                              <td className="text-center">{i + 1}</td>
                              <td className="text-center">{m.hora}</td>
                              <td className="fw-bold">{m.codigo_municipal}</td>
                              <td>{m.nombre_completo}</td>
                              <td className="text-center">{m.mes}/{m.anio}</td>
                              <td className="text-end fw-bold">{parseFloat(m.monto_pagado).toFixed(2)}</td>
                            </tr>
                        ))
                    )}
                  </tbody>
                  <tfoot>
                      <tr className="table-light border-top border-dark fw-bold" style={{ fontSize: "14px" }}>
                          <td colSpan="5" className="text-end pe-3">TOTAL RECAUDADO DEL DÍA:</td>
                          <td className="text-end">S/. {total}</td>
                      </tr>
                  </tfoot>
                </table>

                <div className="row mt-5">
                    <div className="col-4 text-center">
                        <p className="border-top border-dark pt-2">Responsable de Caja</p>
                    </div>
                    <div className="col-4"></div>
                    <div className="col-4 text-center">
                        <p className="border-top border-dark pt-2">Visto Bueno (Jefe Área)</p>
                    </div>
                </div>
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn btn-primary" onClick={handlePrint}><FaPrint/> Imprimir Reporte</button>
            <button className="btn btn-secondary" onClick={cerrarModal}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalCierre;
