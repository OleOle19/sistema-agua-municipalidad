import { useState } from "react";
import axios from "axios";
import { FaFileUpload, FaFileExcel, FaFileCode } from "react-icons/fa";

const ModalImportar = ({ cerrarModal, alTerminar, darkMode }) => {
  const [archivo, setArchivo] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState("");

  const handleSubir = async (e) => {
    e.preventDefault();
    if (!archivo) return alert("Selecciona un archivo");
    const formData = new FormData();
    formData.append("archivo", archivo);
    setCargando(true);
    setMensaje("Procesando base de datos... esto puede tardar unos segundos.");
    
    try {
      const res = await axios.post("http://localhost:5000/importar/padron", formData, { headers: { "Content-Type": "multipart/form-data" } });
      setMensaje(res.data.mensaje);
      setTimeout(() => { alTerminar(); cerrarModal(); }, 2000);
    } catch (error) { 
        console.error(error);
        setMensaje("Error al importar: " + (error.response?.data?.error || error.message)); 
    } 
    finally { setCargando(false); }
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-success text-white"}`;
  const inputClass = `form-control ${darkMode ? "bg-dark text-white border-secondary" : ""}`;

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className="modal-title">Importación de Base de Datos</h5>
            <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : "btn-close-white"}`} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            <div className={`alert small ${darkMode ? "alert-dark border-secondary" : "alert-info"}`}>
                <strong>Formatos Soportados:</strong>
                <ul className="mb-0 ps-3 mt-1">
                    <li><FaFileCode className="me-1"/> <strong>XML (Recomendado):</strong> Formato nativo de la Municipalidad.</li>
                    <li><FaFileExcel className="me-1"/> <strong>Excel (.xlsx):</strong> Formato estándar.</li>
                </ul>
            </div>
            
            <form onSubmit={handleSubir}>
                <div className="mb-3">
                    <label className="form-label fw-bold">Seleccionar Archivo</label>
                    {/* Aceptamos XML y Excel */}
                    <input type="file" className={inputClass} accept=".xml,.xlsx,.xls,.csv" onChange={e => setArchivo(e.target.files[0])} required />
                </div>
                
                {mensaje && (
                    <div className={`alert ${mensaje.includes("Error") ? "alert-danger" : "alert-success"} text-center small`}>
                        {mensaje}
                    </div>
                )}
                
                <div className="d-flex justify-content-end gap-2">
                    <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cancelar</button>
                    <button type="submit" className="btn btn-success fw-bold" disabled={cargando}>
                        {cargando ? "Importando..." : <><FaFileUpload className="me-2"/> Iniciar Carga</>}
                    </button>
                </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalImportar;