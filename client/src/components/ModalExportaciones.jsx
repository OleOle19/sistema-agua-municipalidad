import { useState } from "react";
import { FaBalanceScale, FaDatabase, FaFileAlt, FaFileExcel, FaMoneyBillWave, FaUsers } from "react-icons/fa";
import api from "../api";
import ModalComparacionesLegacy from "./ModalComparacionesLegacy";

const ModalExportaciones = ({ cerrarModal, darkMode, onBackup }) => {
  const [exportando, setExportando] = useState("");
  const [mostrarComparaciones, setMostrarComparaciones] = useState(false);

  const descargarArchivo = async ({
    key,
    endpoint,
    nombreBase,
    extension,
    mimeType
  }) => {
    try {
      setExportando(key);
      const res = await api.get(endpoint, {
        responseType: "blob",
        timeout: 0
      });
      const fecha = new Date().toISOString().slice(0, 10);
      const blob = new Blob([res.data], {
        type: mimeType
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nombreBase}_${fecha}.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
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
                onClick={() => descargarArchivo({
                  key: "usuarios",
                  endpoint: "/exportar/usuarios-completo",
                  nombreBase: "usuarios_completo",
                  extension: "xlsx",
                  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                })}
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
                Exporta finanzas en Excel (3 hojas) o en TXT estilo legacy para comparacion externa.
              </div>
              <div className="d-flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={exportando !== ""}
                  onClick={() => descargarArchivo({
                    key: "finanzas",
                    endpoint: "/exportar/finanzas-completo",
                    nombreBase: "finanzas_completo",
                    extension: "xlsx",
                    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  })}
                >
                  <FaFileExcel className="me-2" />
                  {exportando === "finanzas" ? "Exportando..." : "Exportar Finanzas"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  disabled={exportando !== ""}
                  onClick={() => descargarArchivo({
                    key: "finanzas_txt",
                    endpoint: "/exportar/finanzas-completo.txt",
                    nombreBase: "finanzas_completo_legacy",
                    extension: "txt",
                    mimeType: "text/plain;charset=utf-8"
                  })}
                >
                  <FaFileAlt className="me-2" />
                  {exportando === "finanzas_txt" ? "Exportando..." : "Exportar TXT"}
                </button>
              </div>
            </div>

            <div className={`border rounded p-3 mt-3 ${bodyCardClass}`}>
              <div className="fw-bold mb-1 d-flex align-items-center gap-2">
                <FaBalanceScale /> Comparacion Base Antigua vs Actual
              </div>
              <div className="small opacity-75 mb-2">
                Sube la base legacy (plantilla fija), compara padron/deuda/recaudacion y guarda historial auditable.
              </div>
              <button
                type="button"
                className="btn btn-warning btn-sm"
                disabled={exportando !== ""}
                onClick={() => setMostrarComparaciones(true)}
              >
                <FaBalanceScale className="me-2" />
                Abrir Comparador
              </button>
            </div>
          </div>

          <div className={`modal-footer ${darkMode ? "border-secondary" : ""}`}>
            <button type="button" className={`btn ${darkMode ? "btn-secondary" : "btn-dark"}`} onClick={cerrarModal}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
      {mostrarComparaciones && (
        <ModalComparacionesLegacy
          cerrarModal={() => setMostrarComparaciones(false)}
          darkMode={darkMode}
        />
      )}
    </div>
  );
};

export default ModalExportaciones;
