import { useState } from "react";
import { FaDatabase, FaFileExcel, FaMoneyBillWave, FaUsers } from "react-icons/fa";
import api from "../api";

const ModalExportaciones = ({ cerrarModal, darkMode, onBackup }) => {
  const [exportando, setExportando] = useState("");

  const descargarExcel = async (key, endpoint, nombreBase) => {
    try {
      setExportando(key);
      const res = await api.get(endpoint, {
        responseType: "blob",
        timeout: 0
      });
      const fecha = new Date().toISOString().slice(0, 10);
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nombreBase}_${fecha}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert("No se pudo exportar el archivo.");
    } finally {
      setExportando("");
    }
  };

  const descargarBackup = async () => {
    if (!onBackup) return;
    try {
      setExportando("backup");
      await onBackup();
    } finally {
      setExportando("");
    }
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-primary text-white"}`;
  const closeBtnClass = `btn-close ${darkMode ? "btn-close-white" : "btn-close-white"}`;
  const bodyCardClass = darkMode ? "border-secondary bg-dark text-white" : "";

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className="modal-title"><FaDatabase className="me-2" /> Respaldos y Exportaciones</h5>
            <button type="button" className={closeBtnClass} onClick={cerrarModal}></button>
          </div>

          <div className="modal-body">
            <p className="small mb-3">
              Selecciona el tipo de respaldo o exportacion que deseas generar.
            </p>

            <div className={`border rounded p-3 mb-3 ${bodyCardClass}`}>
              <div className="fw-bold mb-1 d-flex align-items-center gap-2">
                <FaDatabase /> Copia de seguridad SQL
              </div>
              <div className="small opacity-75 mb-2">
                Genera un respaldo completo de la base de datos en archivo .sql.
              </div>
              <button
                type="button"
                className="btn btn-info btn-sm text-white"
                disabled={exportando !== ""}
                onClick={descargarBackup}
              >
                <FaDatabase className="me-2" />
                {exportando === "backup" ? "Generando..." : "Descargar Backup SQL"}
              </button>
            </div>

            <div className={`border rounded p-3 mb-3 ${bodyCardClass}`}>
              <div className="fw-bold mb-1 d-flex align-items-center gap-2">
                <FaUsers /> Usuarios completos
              </div>
              <div className="small opacity-75 mb-2">
                Exporta padron completo con codigos, DNI/RUC, calle, direccion y datos del predio.
              </div>
              <button
                type="button"
                className="btn btn-success btn-sm"
                disabled={exportando !== ""}
                onClick={() => descargarExcel("usuarios", "/exportar/usuarios-completo", "usuarios_completo")}
              >
                <FaFileExcel className="me-2" />
                {exportando === "usuarios" ? "Exportando..." : "Exportar Usuarios"}
              </button>
            </div>

            <div className={`border rounded p-3 ${bodyCardClass}`}>
              <div className="fw-bold mb-1 d-flex align-items-center gap-2">
                <FaMoneyBillWave /> Pagos, deudas e historial
              </div>
              <div className="small opacity-75 mb-2">
                Exporta un Excel con hojas separadas para pagos, deudas pendientes e historial completo.
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={exportando !== ""}
                onClick={() => descargarExcel("finanzas", "/exportar/finanzas-completo", "finanzas_completo")}
              >
                <FaFileExcel className="me-2" />
                {exportando === "finanzas" ? "Exportando..." : "Exportar Finanzas"}
              </button>
            </div>

            <div className={`border rounded p-3 mt-3 ${bodyCardClass}`}>
              <div className="fw-bold mb-1 d-flex align-items-center gap-2">
                <FaFileExcel /> Plantilla Verificacion Campo
              </div>
              <div className="small opacity-75 mb-2">
                Genera una plantilla para imprimir o completar en oficina con datos de verificación domiciliaria.
              </div>
              <div className="d-flex gap-2">
                <button
                  type="button"
                  className="btn btn-warning btn-sm"
                  disabled={exportando !== ""}
                  onClick={() => descargarExcel("campo_todos", "/exportar/verificacion-campo?modo=todos", "verificacion_campo_todos")}
                >
                  <FaFileExcel className="me-2" />
                  {exportando === "campo_todos" ? "Exportando..." : "Todos"}
                </button>
                <button
                  type="button"
                  className="btn btn-warning btn-sm"
                  disabled={exportando !== ""}
                  onClick={() => descargarExcel("campo_morosos", "/exportar/verificacion-campo?modo=morosos", "verificacion_campo_morosos")}
                >
                  <FaFileExcel className="me-2" />
                  {exportando === "campo_morosos" ? "Exportando..." : "Solo Morosos"}
                </button>
              </div>
            </div>
          </div>

          <div className={`modal-footer ${darkMode ? "border-secondary" : ""}`}>
            <button type="button" className={`btn ${darkMode ? "btn-secondary" : "btn-dark"}`} onClick={cerrarModal}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalExportaciones;
