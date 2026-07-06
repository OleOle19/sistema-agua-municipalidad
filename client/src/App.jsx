import { Component, Suspense, lazy, useEffect, useMemo, useState } from "react";
import { FaTint, FaBolt, FaCashRegister, FaMobileAlt } from "react-icons/fa";
import { API_BASE_URL } from "./api";
import MunicipalBackdrop from "./components/MunicipalBackdrop";

const AguaApp = lazy(() => import("./AguaApp"));
const LuzApp = lazy(() => import("./luz/LuzApp"));
const CajaMunicipalApp = lazy(() => import("./caja/CajaMunicipalApp"));

const MODULE_STORAGE_KEY = "sistema_modulo_activo";
const AGUA_TOKEN_KEY = "token_agua";
const LUZ_TOKEN_KEY = "token_luz";
const LEGACY_TOKEN_KEY = "token";

const clearAllModuleSessions = () => {
  [
    AGUA_TOKEN_KEY,
    LUZ_TOKEN_KEY,
    LEGACY_TOKEN_KEY
  ].forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage cleanup failures so module switching still works.
    }
  });
};

const getCampoAppUrl = () => `${API_BASE_URL}/campo-app/`;

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

const ModuleLoadingScreen = ({ title }) => (
  <div className="d-flex align-items-center justify-content-center min-vh-100 bg-light p-3">
    <div className="card shadow-sm" style={{ maxWidth: "480px", width: "100%" }}>
      <div className="card-body p-4 text-center">
        <div className="spinner-border text-primary mb-3" role="status" aria-hidden="true"></div>
        <div className="fw-semibold">{title}</div>
      </div>
    </div>
  </div>
);

const ModuleErrorScreen = ({ title }) => (
  <div className="d-flex align-items-center justify-content-center min-vh-100 bg-light p-3">
    <div className="card shadow-sm border-danger" style={{ maxWidth: "520px", width: "100%" }}>
      <div className="card-body p-4 text-center">
        <div className="fw-bold text-danger mb-2">{title}</div>
        <p className="text-muted mb-3">
          Ocurrio un error al cargar este modulo. Puede recargar la pagina para volver a intentarlo.
        </p>
        <button type="button" className="btn btn-danger" onClick={() => window.location.reload()}>
          Recargar pagina
        </button>
      </div>
    </div>
  </div>
);

class ModuleErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[APP][MODULE_ERROR]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <ModuleErrorScreen title={this.props.title || "Error cargando el modulo"} />;
    }
    return this.props.children;
  }
}

function App() {
  const [modulo, setModulo] = useState(readStoredModule);
  const [selectorAviso, setSelectorAviso] = useState("");
  const campoAppUrl = useMemo(() => getCampoAppUrl(), []);
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
      clearAllModuleSessions();
      setSelectorAviso("");
      localStorage.setItem(MODULE_STORAGE_KEY, value);
      setModulo(value);
    },
    volver: () => {
      clearAllModuleSessions();
      localStorage.removeItem(MODULE_STORAGE_KEY);
      setModulo("");
      setSelectorAviso("");
    }
  }), [cajaPermitida]);

  useEffect(() => {
    if (modulo !== "caja" || cajaPermitida) return;
    const timeoutId = window.setTimeout(() => {
      localStorage.removeItem(MODULE_STORAGE_KEY);
      setSelectorAviso("Acceso denegado a Caja Municipal para este perfil.");
      setModulo("");
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [cajaPermitida, modulo]);

  if (modulo === "agua") {
    return (
      <ModuleErrorBoundary title="Error cargando el sistema de Agua">
        <Suspense fallback={<ModuleLoadingScreen title="Cargando sistema de Agua..." />}>
          <AguaApp onBackToSelector={actions.volver} />
        </Suspense>
      </ModuleErrorBoundary>
    );
  }

  if (modulo === "luz") {
    return (
      <ModuleErrorBoundary title="Error cargando el sistema de Luz">
        <Suspense fallback={<ModuleLoadingScreen title="Cargando sistema de Luz..." />}>
          <LuzApp onBackToSelector={actions.volver} />
        </Suspense>
      </ModuleErrorBoundary>
    );
  }

  if (modulo === "caja") {
    return (
      <ModuleErrorBoundary title="Error cargando Caja Municipal">
        <Suspense fallback={<ModuleLoadingScreen title="Cargando Caja Municipal..." />}>
          <CajaMunicipalApp onBackToSelector={actions.volver} />
        </Suspense>
      </ModuleErrorBoundary>
    );
  }

  return (
    <div className="landing-shell">
      <div className="landing-content">
        <MunicipalBackdrop className="landing-stage" contentClassName="landing-stage__content" variant="hero">
          <div className="landing-poster__hero">
            <div className="landing-eyebrow">Panel municipal integrado</div>
            <h2 className="landing-title fw-bold mb-0">Municipalidad Distrital de Pueblo Nuevo</h2>
          </div>

          <div className="landing-panel">
            {selectorAviso && (
              <div className="alert alert-warning py-2 mb-4">{selectorAviso}</div>
            )}

            <div className="row g-3 module-selector-grid">
              <div className="col-12 col-md-6 col-xl-3">
                <button
                  className="btn btn-outline-primary w-100 h-100 text-start p-4 module-entry module-entry--agua"
                  onClick={() => actions.seleccionar("agua")}
                >
                  <div className="d-flex align-items-center gap-3">
                    <span className="fs-2 text-primary module-entry__icon"><FaTint /></span>
                    <div className="module-entry__content">
                      <div className="fw-bold fs-5 module-entry__title">Sistema de Agua</div>
                      <div className="small module-entry__desc">Contribuyentes, deuda, caja y reportes.</div>
                    </div>
                  </div>
                </button>
              </div>

              <div className="col-12 col-md-6 col-xl-3">
                <button
                  className="btn btn-outline-warning w-100 h-100 text-start p-4 module-entry module-entry--luz"
                  onClick={() => actions.seleccionar("luz")}
                >
                  <div className="d-flex align-items-center gap-3">
                    <span className="fs-2 text-warning module-entry__icon"><FaBolt /></span>
                    <div className="module-entry__content">
                      <div className="fw-bold fs-5 module-entry__title">Sistema de Luz</div>
                      <div className="small module-entry__desc">Suministros, lecturas, recibos y auditoria.</div>
                    </div>
                  </div>
                </button>
              </div>

              <div className="col-12 col-md-6 col-xl-3">
                <button
                  className="btn btn-outline-success w-100 h-100 text-start p-4 module-entry module-entry--caja"
                  onClick={() => actions.seleccionar("caja")}
                  disabled={!cajaPermitida}
                >
                  <div className="d-flex align-items-center gap-3">
                    <span className="fs-2 text-success module-entry__icon"><FaCashRegister /></span>
                    <div className="module-entry__content">
                      <div className="fw-bold fs-5 module-entry__title">Caja Municipal</div>
                      <div className="small module-entry__desc">
                        {cajaPermitida
                          ? "Cobranza unificada de Agua y Luz."
                          : "Disponible solo para cuentas ADMIN o CAJERO."}
                      </div>
                    </div>
                  </div>
                </button>
              </div>

              <div className="col-12 col-md-6 col-xl-3">
                <a
                  className="btn btn-outline-info w-100 h-100 text-start p-4 module-entry module-entry--campo d-flex align-items-center"
                  href={campoAppUrl}
                >
                  <div className="d-flex align-items-center gap-3">
                    <span className="fs-2 text-info module-entry__icon"><FaMobileAlt /></span>
                    <div className="module-entry__content">
                      <div className="fw-bold fs-5 module-entry__title">App Campo</div>
                      <div className="small module-entry__desc">Brigada Agua y Luz. Corroboracion y visitas.</div>
                    </div>
                  </div>
                </a>
                </div>
              </div>
            </div>
        </MunicipalBackdrop>
      </div>
    </div>
  );
}

export default App;
