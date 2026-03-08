import { useMemo, useState } from "react";
import { FaTint, FaBolt } from "react-icons/fa";
import AguaApp from "./AguaApp";
import LuzApp from "./luz/LuzApp";

const MODULE_STORAGE_KEY = "sistema_modulo_activo";

const readStoredModule = () => {
  const raw = String(localStorage.getItem(MODULE_STORAGE_KEY) || "").trim().toLowerCase();
  if (raw === "agua" || raw === "luz") return raw;
  return "";
};

function App() {
  const [modulo, setModulo] = useState(readStoredModule);

  const actions = useMemo(() => ({
    seleccionar: (target) => {
      const value = String(target || "").trim().toLowerCase();
      if (!["agua", "luz"].includes(value)) return;
      localStorage.setItem(MODULE_STORAGE_KEY, value);
      setModulo(value);
    },
    volver: () => {
      localStorage.removeItem(MODULE_STORAGE_KEY);
      setModulo("");
    }
  }), []);

  if (modulo === "agua") {
    return <AguaApp onBackToSelector={actions.volver} />;
  }
  if (modulo === "luz") {
    return <LuzApp onBackToSelector={actions.volver} />;
  }

  return (
    <div className="d-flex align-items-center justify-content-center min-vh-100 bg-light p-3">
      <div className="card shadow-sm" style={{ maxWidth: "880px", width: "100%" }}>
        <div className="card-body p-4 p-md-5">
          <h2 className="fw-bold mb-2">Municipalidad Distrital de Pueblo Nuevo</h2>
          <p className="text-muted mb-4">Seleccione el sistema al que desea ingresar.</p>

          <div className="row g-3">
            <div className="col-12 col-md-6">
              <button
                className="btn btn-outline-primary w-100 h-100 text-start p-4"
                onClick={() => actions.seleccionar("agua")}
              >
                <div className="d-flex align-items-center gap-3">
                  <span className="fs-2 text-primary"><FaTint /></span>
                  <div>
                    <div className="fw-bold fs-5">Sistema de Agua</div>
                    <div className="small text-muted">Contribuyentes, deuda, caja y reportes.</div>
                  </div>
                </div>
              </button>
            </div>

            <div className="col-12 col-md-6">
              <button
                className="btn btn-outline-warning w-100 h-100 text-start p-4"
                onClick={() => actions.seleccionar("luz")}
              >
                <div className="d-flex align-items-center gap-3">
                  <span className="fs-2 text-warning"><FaBolt /></span>
                  <div>
                    <div className="fw-bold fs-5">Sistema de Luz</div>
                    <div className="small text-muted">Suministros, lecturas, recibos y caja.</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
