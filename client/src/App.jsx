import { Component, Suspense, lazy, useCallback, useMemo, useState } from "react";
import { FaTint, FaBolt, FaCashRegister, FaMobileAlt } from "react-icons/fa";
import { API_BASE_URL } from "./api";
import FlashNotice from "./components/FlashNotice";
import MunicipalBackdrop from "./components/MunicipalBackdrop";
import SessionInactivityGuard from "./components/SessionInactivityGuard";
import {
  clearAllSessionTokens,
  discardLegacyPersistentTokens
} from "./utils/sessionAuth";

const AguaApp = lazy(() => import("./AguaApp"));
const LuzApp = lazy(() => import("./luz/LuzApp"));
const CajaMunicipalApp = lazy(() => import("./caja/CajaMunicipalApp"));

const MODULE_STORAGE_KEY = "sistema_modulo_activo";
discardLegacyPersistentTokens();

const getCampoAppUrl = () => `${API_BASE_URL}/campo-app/`;

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
          Ocurrió un error al cargar este módulo. Puede recargar la página para volver a intentarlo.
        </p>
        <button type="button" className="btn btn-danger" onClick={() => window.location.reload()}>
          Recargar página
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
      return <ModuleErrorScreen title={this.props.title || "Error cargando el módulo"} />;
    }
    return this.props.children;
  }
}

function App() {
  const [modulo, setModulo] = useState(readStoredModule);
  const [selectorAviso, setSelectorAviso] = useState("");
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [sessionNotice, setSessionNotice] = useState("");
  const campoAppUrl = useMemo(() => getCampoAppUrl(), []);
  const handleSessionExpired = useCallback(() => {
    setSessionEpoch((current) => current + 1);
    setSessionNotice("La sesión se cerró automáticamente por inactividad.");
  }, []);
  const actions = useMemo(() => ({
    seleccionar: (target) => {
      const value = String(target || "").trim().toLowerCase();
      if (!["agua", "luz", "caja"].includes(value)) return;
      clearAllSessionTokens();
      setSelectorAviso("");
      setSessionNotice("");
      localStorage.setItem(MODULE_STORAGE_KEY, value);
      setModulo(value);
    },
    volver: () => {
      clearAllSessionTokens();
      localStorage.removeItem(MODULE_STORAGE_KEY);
      setModulo("");
      setSelectorAviso("");
      setSessionNotice("");
    }
  }), []);

  let content;
  if (modulo === "agua") {
    content = (
      <ModuleErrorBoundary title="Error cargando el sistema de Agua">
        <Suspense fallback={<ModuleLoadingScreen title="Cargando sistema de Agua..." />}>
          <AguaApp key={`agua-${sessionEpoch}`} onBackToSelector={actions.volver} />
        </Suspense>
      </ModuleErrorBoundary>
    );
  } else if (modulo === "luz") {
    content = (
      <ModuleErrorBoundary title="Error cargando el sistema de Luz">
        <Suspense fallback={<ModuleLoadingScreen title="Cargando sistema de Luz..." />}>
          <LuzApp key={`luz-${sessionEpoch}`} onBackToSelector={actions.volver} />
        </Suspense>
      </ModuleErrorBoundary>
    );
  } else if (modulo === "caja") {
    content = (
      <ModuleErrorBoundary title="Error cargando Caja Municipal">
        <Suspense fallback={<ModuleLoadingScreen title="Cargando Caja Municipal..." />}>
          <CajaMunicipalApp key={`caja-${sessionEpoch}`} onBackToSelector={actions.volver} />
        </Suspense>
      </ModuleErrorBoundary>
    );
  } else {
    content = (
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
                      <div className="small module-entry__desc">Suministros, lecturas, recibos y auditoría.</div>
                    </div>
                  </div>
                </button>
              </div>

              <div className="col-12 col-md-6 col-xl-3">
                <button
                  className="btn btn-outline-success w-100 h-100 text-start p-4 module-entry module-entry--caja"
                  onClick={() => actions.seleccionar("caja")}
                >
                  <div className="d-flex align-items-center gap-3">
                    <span className="fs-2 text-success module-entry__icon"><FaCashRegister /></span>
                    <div className="module-entry__content">
                      <div className="fw-bold fs-5 module-entry__title">Caja Municipal</div>
                      <div className="small module-entry__desc">
                        Cobranza unificada de Agua y Luz.
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
                      <div className="small module-entry__desc">Brigada Agua y Luz. Corroboración y visitas.</div>
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

  return (
    <>
      {content}
      <SessionInactivityGuard
        onExpire={handleSessionExpired}
        idleMinutes={modulo === "caja" ? 49 : undefined}
      />
      {sessionNotice && (
        <FlashNotice
          flash={{
            type: "info",
            title: "Sesión cerrada",
            text: sessionNotice,
            ts: sessionEpoch
          }}
          onClose={() => setSessionNotice("")}
        />
      )}
    </>
  );
}

export default App;
