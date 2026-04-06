import { useEffect, useMemo, useState } from "react";
import { FaTint, FaBolt, FaCashRegister } from "react-icons/fa";
import AguaApp from "./AguaApp";
import LuzApp from "./luz/LuzApp";
import CajaMunicipalApp from "./caja/CajaMunicipalApp";

const MODULE_STORAGE_KEY = "sistema_modulo_activo";
const AGUA_TOKEN_KEY = "token_agua";

const normalizeRole = (role) => {
  const raw = String(role || "").trim().toUpperCase();
  if (["ADMIN", "SUPERADMIN", "ADMIN_PRINCIPAL", "NIVEL_1"].includes(raw)) return "ADMIN";
  if (["CAJERO", "OPERADOR_CAJA", "OPERADOR", "NIVEL_3"].includes(raw)) return "CAJERO";
  if (["ADMIN_SEC", "ADMIN_SECUNDARIO", "JEFE_CAJA", "NIVEL_2"].includes(raw)) return "ADMIN_SEC";
  if (["BRIGADA", "BRIGADISTA", "CAMPO", "NIVEL_5"].includes(raw)) return "BRIGADA";
  return "CONSULTA";
};

const canEnterCajaModuleByRole = (role) => {
  const normalized = normalizeRole(role);
  return normalized === "ADMIN" || normalized === "CAJERO";
};

const parseJwtPayload = (token) => {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    if (pad) base64 += "=".repeat(4 - pad);
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
};

const readStoredRole = () => {
  const token = localStorage.getItem(AGUA_TOKEN_KEY) || localStorage.getItem("token");
  if (!token) return "";
  const payload = parseJwtPayload(token);
  if (!payload) return "";
  if (payload.exp && Date.now() / 1000 > payload.exp) return "";
  return normalizeRole(payload.rol);
};

const readStoredModule = () => {
  const raw = String(localStorage.getItem(MODULE_STORAGE_KEY) || "").trim().toLowerCase();
  if (raw === "agua" || raw === "luz" || raw === "caja") return raw;
  return "";
};

function App() {
  const [modulo, setModulo] = useState(readStoredModule);
  const [selectorAviso, setSelectorAviso] = useState("");
  const rolActual = readStoredRole();
  const cajaPermitida = !rolActual || canEnterCajaModuleByRole(rolActual);

  const actions = useMemo(() => ({
    seleccionar: (target) => {
      const value = String(target || "").trim().toLowerCase();
      if (!["agua", "luz", "caja"].includes(value)) return;
      if (value === "caja" && !cajaPermitida) {
        setSelectorAviso("El modulo Caja Municipal solo permite cuentas de Administrador o Cajero.");
        return;
      }
      setSelectorAviso("");
      localStorage.setItem(MODULE_STORAGE_KEY, value);
      setModulo(value);
    },
    volver: () => {
      localStorage.removeItem(MODULE_STORAGE_KEY);
      setModulo("");
      setSelectorAviso("");
    }
  }), [cajaPermitida]);

  useEffect(() => {
    if (modulo !== "caja" || cajaPermitida) return;
    localStorage.removeItem(MODULE_STORAGE_KEY);
    setSelectorAviso("Acceso denegado a Caja Municipal para este perfil.");
    setModulo("");
  }, [cajaPermitida, modulo]);

  if (modulo === "agua") {
    return <AguaApp onBackToSelector={actions.volver} />;
  }
  if (modulo === "luz") {
    return <LuzApp onBackToSelector={actions.volver} />;
  }
  if (modulo === "caja") {
    return <CajaMunicipalApp onBackToSelector={actions.volver} />;
  }

  return (
    <div className="d-flex align-items-center justify-content-center min-vh-100 bg-light p-3">
      <div className="card shadow-sm" style={{ maxWidth: "880px", width: "100%" }}>
        <div className="card-body p-4 p-md-5">
          <h2 className="fw-bold mb-2">Municipalidad Distrital de Pueblo Nuevo</h2>
          <p className="text-muted mb-4">Seleccione el sistema al que desea ingresar.</p>
          {selectorAviso && (
            <div className="alert alert-warning py-2">{selectorAviso}</div>
          )}

          <div className="row g-3">
            <div className="col-12 col-md-4">
              <button
                className="btn btn-outline-primary w-100 h-100 text-start p-4 module-entry module-entry--agua"
                onClick={() => actions.seleccionar("agua")}
              >
                <div className="d-flex align-items-center gap-3">
                  <span className="fs-2 text-primary module-entry__icon"><FaTint /></span>
                  <div>
                    <div className="fw-bold fs-5">Sistema de Agua</div>
                    <div className="small text-muted">Contribuyentes, deuda, caja y reportes.</div>
                  </div>
                </div>
              </button>
            </div>

            <div className="col-12 col-md-4">
              <button
                className="btn btn-outline-warning w-100 h-100 text-start p-4 module-entry module-entry--luz"
                onClick={() => actions.seleccionar("luz")}
              >
                <div className="d-flex align-items-center gap-3">
                  <span className="fs-2 text-warning module-entry__icon"><FaBolt /></span>
                  <div>
                    <div className="fw-bold fs-5">Sistema de Luz</div>
                    <div className="small text-muted">Suministros, lecturas, recibos y auditoria.</div>
                  </div>
                </div>
              </button>
            </div>

            <div className="col-12 col-md-4">
              <button
                className="btn btn-outline-success w-100 h-100 text-start p-4 module-entry module-entry--caja"
                onClick={() => actions.seleccionar("caja")}
                disabled={!cajaPermitida}
              >
                <div className="d-flex align-items-center gap-3">
                  <span className="fs-2 text-success module-entry__icon"><FaCashRegister /></span>
                  <div>
                    <div className="fw-bold fs-5">Caja Municipal</div>
                    <div className="small text-muted">
                      {cajaPermitida
                        ? "Cobranza unificada de Agua y Luz."
                        : "Disponible solo para cuentas ADMIN o CAJERO."}
                    </div>
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
