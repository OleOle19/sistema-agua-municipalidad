import { useEffect, useState, useRef, useMemo, useDeferredValue, useCallback, memo } from "react";
import api, { API_BASE_URL } from "./api";
import { useReactToPrint } from 'react-to-print'; 
import RegistroForm from "./components/RegistroForm";
import ModalDeuda from "./components/ModalDeuda";
import ModalPago from "./components/ModalPago";
import ModalEliminar from "./components/ModalEliminar";
import ModalCierre from "./components/ModalCierre";
import ModalEditarUsuario from "./components/ModalEditarUsuario";
import DashboardStats from "./components/DashboardStats"; 
import Recibo from "./components/Recibo"; 
import ReporteCortes from "./components/ReporteCortes"; 
import ActasCorteLote from "./components/ActasCorteLote";
import ModalAuditoria from "./components/ModalAuditoria";
import LoginPage from "./components/LoginPage";
import ModalUsuarios from "./components/ModalUsuarios";
import RecibosMasivos from "./components/RecibosMasivos";
import ModalImpresionMasiva from "./components/ModalImpresionMasiva";
import ModalImportar from "./components/ModalImportar";
import ModalDeudaMasiva from "./components/ModalDeudaMasiva";
import ModalExportaciones from "./components/ModalExportaciones";
import ModalReporteCortes from "./components/ModalReporteCortes";
import ModalActaCorteSelector from "./components/ModalActaCorteSelector";
import ModalCampoSolicitudes from "./components/ModalCampoSolicitudes";
import realtime from "./realtime";

const ROLE_ORDER = {
  BRIGADA: 1,
  CONSULTA: 2,
  CAJERO: 3,
  ADMIN_SEC: 4,
  ADMIN: 5
};

const ROLE_LABELS = {
  ADMIN: "Nivel 1 - Admin principal",
  ADMIN_SEC: "Nivel 2 - Admin secundario / caja",
  CAJERO: "Nivel 3 - Operador de caja",
  CONSULTA: "Nivel 4 - Consulta",
  BRIGADA: "Nivel 5 - Brigada de campo"
};

const normalizeRole = (role) => {
  const raw = String(role || "").trim().toUpperCase();
  if (["ADMIN", "SUPERADMIN", "ADMIN_PRINCIPAL", "NIVEL_1"].includes(raw)) return "ADMIN";
  if (["ADMIN_SEC", "ADMIN_SECUNDARIO", "JEFE_CAJA", "NIVEL_2"].includes(raw)) return "ADMIN_SEC";
  if (["CAJERO", "OPERADOR_CAJA", "OPERADOR", "NIVEL_3"].includes(raw)) return "CAJERO";
  if (["BRIGADA", "BRIGADISTA", "CAMPO", "NIVEL_5"].includes(raw)) return "BRIGADA";
  if (["CONSULTA", "LECTURA", "NIVEL_4"].includes(raw)) return "CONSULTA";
  return "CONSULTA";
};

const hasMinRole = (role, requiredRole) => {
  const currentLevel = ROLE_ORDER[normalizeRole(role)] || 0;
  const requiredLevel = ROLE_ORDER[normalizeRole(requiredRole)] || 0;
  return currentLevel >= requiredLevel;
};

const ESTADOS_CONEXION = {
  CON_CONEXION: "CON_CONEXION",
  SIN_CONEXION: "SIN_CONEXION",
  CORTADO: "CORTADO"
};

const ESTADO_CONEXION_LABELS = {
  CON_CONEXION: "Con conexion",
  SIN_CONEXION: "Sin conexion",
  CORTADO: "Corte de conexion"
};

const MONTH_LABELS = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const getLocalCampoAppUrl = () => `${API_BASE_URL}/campo-app/`;
const normalizeCampoAppUrl = (value) => {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  if (/\/campo-app\/?$/i.test(raw)) return `${raw.replace(/\/+$/g, "")}/`;
  return `${raw.replace(/\/+$/g, "")}/campo-app/`;
};

const normalizeEstadoConexion = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (["CON_CONEXION", "CONEXION", "CONECTADO", "ACTIVO"].includes(raw)) return ESTADOS_CONEXION.CON_CONEXION;
  if (["SIN_CONEXION", "SIN CONEXION", "SIN_SERVICIO", "NO_CONECTADO", "INACTIVO"].includes(raw)) return ESTADOS_CONEXION.SIN_CONEXION;
  if (["CORTADO", "CORTE", "SUSPENDIDO"].includes(raw)) return ESTADOS_CONEXION.CORTADO;
  return ESTADOS_CONEXION.CON_CONEXION;
};

const badgeEstadoConexionClass = (estado) => {
  const n = normalizeEstadoConexion(estado);
  if (n === ESTADOS_CONEXION.CORTADO) return "bg-danger";
  if (n === ESTADOS_CONEXION.SIN_CONEXION) return "bg-secondary";
  return "bg-success";
};

// Iconos
import { 
  FaUserPlus, FaMoneyBillWave, FaFileInvoiceDollar, 
  FaPrint, FaTrashAlt, FaSearch, FaUserEdit, FaUserTimes, 
  FaSort, FaCut, FaShieldAlt, FaFileExcel, FaSignOutAlt, 
  FaUserShield, FaMoon, FaSun, FaDatabase, FaPlug, FaLink,
  FaCloudUploadAlt, FaClipboardCheck
} from "react-icons/fa";

// --- SE ELIMINO EL TRUCO CSS GLOBAL ---

// --- SIDEBAR (Menu Lateral) ---
const Sidebar = memo(({ 
  setMostrarRegistro, mostrarRegistro, usuarioSeleccionado, 
  setMostrarModalPago, setMostrarModalCierre, setMostrarModalAuditoria, 
  setMostrarModalUsuarios, 
  usuarioActivo, onLogout, 
  darkMode, setDarkMode, descargarPadron,
  setMostrarImportar,
  setMostrarModalMasivo,
  setMostrarModalExportaciones,
  setMostrarModalCampo,
  permisos,
  resumenPendientesCaja
}) => {
  const isSoloCobrosCajero = permisos.role === "CAJERO";
  const showReportesSection = !isSoloCobrosCajero && (permisos.canReportesCaja || permisos.canExportPadron);

  return (
  <div className={`d-flex flex-column flex-shrink-0 p-2 text-white ${darkMode ? 'bg-black' : 'bg-dark'}`} style={{ width: "240px", height: "100vh", maxHeight: "100vh", transition: '0.3s' }}>
    <a href="/" className="d-flex align-items-center mb-2 me-md-auto text-white text-decoration-none flex-shrink-0 gap-2">
      <img
        src="/logo.png"
        alt="Logo Municipalidad"
        style={{ width: "32px", height: "32px", objectFit: "contain", flexShrink: 0 }}
      />
      <span className="fs-4 fw-bold" style={{ lineHeight: 1.2 }}>Municipalidad - Pueblo Nuevo</span>
    </a>
    <hr className="my-2 flex-shrink-0"/>
    
    <ul className="nav nav-pills flex-column flex-grow-1" style={{ overflowY: "auto", overflowX: "hidden", minHeight: 0, paddingRight: "2px" }}>
      {!isSoloCobrosCajero && (
        <li className="nav-item">
          <button className={`nav-link py-2 text-white w-100 text-start d-flex align-items-center gap-2 ${!mostrarRegistro ? "active bg-primary" : ""}`} onClick={() => setMostrarRegistro(false)}>
            <FaSearch/> <span>Deuda Tributaria</span>
          </button>
        </li>
      )}
      {!isSoloCobrosCajero && permisos.canManageContribuyentes && (
        <li>
          <button className={`nav-link py-2 text-white w-100 text-start d-flex align-items-center gap-2 ${mostrarRegistro ? "active bg-primary" : ""}`} onClick={() => setMostrarRegistro(true)}>
            <FaUserPlus/> <span>Registro Nuevo</span>
          </button>
        </li>
      )}

      {permisos.canCaja && (
        <>
          <li className="nav-item mt-2 text-white-50 text-uppercase small fw-bold">Caja</li>
          <li>
            <button className="nav-link py-2 text-white w-100 text-start d-flex align-items-center gap-2" onClick={() => usuarioSeleccionado ? setMostrarModalPago(true) : alert("Seleccione usuario")}>
              <FaMoneyBillWave/> <span>Gestion Cobros (F7)</span>
              {Number(resumenPendientesCaja?.total_ordenes || 0) > 0 && (
                <span className="badge bg-danger ms-auto">{Number(resumenPendientesCaja?.total_ordenes || 0)}</span>
              )}
            </button>
            {Number(resumenPendientesCaja?.total_ordenes || 0) > 0 && (
              <div className="small text-warning mt-1 ms-4">
                Pendientes: {Number(resumenPendientesCaja?.total_ordenes || 0)} | S/. {Number(resumenPendientesCaja?.total_monto || 0).toFixed(2)}
              </div>
            )}
          </li>
        </>
      )}

      {showReportesSection && (
        <>
          <li className="nav-item mt-2 text-white-50 text-uppercase small fw-bold">Reportes</li>
          {permisos.canReportesCaja && (
            <li><button className="nav-link py-2 text-white w-100 text-start d-flex align-items-center gap-2" onClick={() => setMostrarModalCierre(true)}><FaFileInvoiceDollar/> <span>Ver Cobranzas (F9)</span></button></li>
          )}
          {permisos.canExportPadron && (
            <li>
              <button className="nav-link py-2 text-success w-100 text-start d-flex align-items-center gap-2" onClick={descargarPadron}>
                <FaFileExcel/> <span>Descargar Excel</span>
              </button>
            </li>
          )}
        </>
      )}
      
      {permisos.canAuditoria && (
        <li className="nav-item mt-2 border-top pt-2"><button className="nav-link py-2 text-white-50 w-100 text-start small d-flex align-items-center gap-2" onClick={() => setMostrarModalAuditoria(true)}><FaShieldAlt/> <span>Auditoria</span></button></li>
      )}

      {permisos.canManageUsers && (
        <li className="nav-item mt-1">
          <button className="nav-link py-2 text-warning w-100 text-start small d-flex align-items-center gap-2" onClick={() => setMostrarModalUsuarios(true)}>
            <FaUserShield/> <span>Gestion Usuarios</span>
          </button>
        </li>
      )}
      {permisos.canSuperAdmin && (
        <li className="nav-item mt-1">
          <button className="nav-link py-2 text-info w-100 text-start small d-flex align-items-center gap-2" onClick={() => setMostrarModalExportaciones(true)}>
            <FaDatabase/> <span>Respaldos y Exportaciones</span>
          </button>
        </li>
      )}
      {permisos.canSuperAdmin && (
        <li className="nav-item mt-1">
          <button className="nav-link py-2 text-success w-100 text-start small d-flex align-items-center gap-2" onClick={() => setMostrarImportar(true)}>
            <FaCloudUploadAlt/> <span>Importar Padron</span>
          </button>
        </li>
      )}
      {permisos.canGestionCampo && (
        <li className="nav-item mt-1">
          <button className="nav-link py-2 text-light w-100 text-start small d-flex align-items-center gap-2" onClick={() => setMostrarModalCampo(true)}>
            <FaClipboardCheck/> <span>Bandeja Campo</span>
          </button>
        </li>
      )}
    </ul>
    
    <div className="mt-2 pt-2 border-top flex-shrink-0">
      <button className="btn btn-sm btn-outline-secondary w-100 mb-2 d-flex align-items-center justify-content-center gap-2" onClick={() => setDarkMode(!darkMode)}>
        {darkMode ? <><FaSun className="text-warning"/> Modo Claro</> : <><FaMoon/> Modo Oscuro</>}
      </button>

      <div className="small text-white-50 mb-1 text-truncate">Usuario: <strong className="text-white">{usuarioActivo?.nombre || 'Invitado'}</strong></div>
      <div className="small text-info mb-2 text-truncate">{permisos.roleLabel}</div>
      <button className="btn btn-outline-danger btn-sm w-100 d-flex align-items-center justify-content-center gap-2" onClick={onLogout}><FaSignOutAlt /> Cerrar Sesion</button>
    </div>
  </div>
  );
});

// --- TOOLBAR ---
const Toolbar = memo(({ 
  busqueda, setBusqueda, usuarioSeleccionado, setMostrarModalDeuda, 
  setMostrarModalEliminar, setMostrarModalEditarUsuario, eliminarUsuarioCompleto, 
  handlePrintCortes, abrirModalActaCorte, generandoActaCorte, darkMode, setMostrarModalMasivo,
  selectedIds, setMostrarModalDeudaMasiva, permisos, filtroEstadoConexion, setFiltroEstadoConexion,
  aplicarCorteSeleccionado, reconectarSeleccionado
}) => {
  const usuarioConConexion = normalizeEstadoConexion(usuarioSeleccionado?.estado_conexion) === ESTADOS_CONEXION.CON_CONEXION;
  const estadoSeleccionado = normalizeEstadoConexion(usuarioSeleccionado?.estado_conexion);
  const puedeCortar = Boolean(usuarioSeleccionado) && estadoSeleccionado === ESTADOS_CONEXION.CON_CONEXION;
  const puedeReconectar = Boolean(usuarioSeleccionado) && (
    estadoSeleccionado === ESTADOS_CONEXION.SIN_CONEXION || estadoSeleccionado === ESTADOS_CONEXION.CORTADO
  );
  return (
  <div className={`${darkMode ? 'bg-secondary border-secondary text-white' : 'bg-light border-bottom'} p-2 d-flex gap-2 align-items-center sticky-top shadow-sm`} style={{ flexWrap: "nowrap", overflowX: "hidden" }} onClick={(e) => e.stopPropagation()}>
    
    <div className="input-group input-group-sm flex-shrink-0" style={{width: '220px'}}>
      <span className="input-group-text border-end-0"><FaSearch className="text-muted"/></span>
      <input type="text" className="form-control border-start-0 ps-0" placeholder="Buscar..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} autoFocus />
    </div>

    <div className="input-group input-group-sm flex-shrink-0" style={{ width: "190px" }}>
      <span className="input-group-text">Estado</span>
      <select
        className={`form-select ${darkMode ? "bg-dark text-white border-secondary" : ""}`}
        value={filtroEstadoConexion}
        onChange={(e) => setFiltroEstadoConexion(e.target.value)}
      >
        <option value="TODOS">Todos</option>
        <option value="CON_CONEXION">Con conexion</option>
        <option value="SIN_CONEXION">Sin conexion</option>
        <option value="CORTADO">Cortado</option>
      </select>
    </div>
    
    <div className="vr mx-1"></div>
    
    <div className="d-flex gap-2 flex-shrink-0">
        {permisos.canManageOps && (
        <div className="btn-group shadow-sm">
        {selectedIds && selectedIds.size > 1 ? (
            <button className="btn btn-warning btn-sm fw-bold d-flex align-items-center gap-1" onClick={() => setMostrarModalDeudaMasiva(true)}>
                <FaMoneyBillWave/> <span>Reg. Deuda ({selectedIds.size})</span>
            </button>
        ) : (
            <button className="btn btn-primary btn-sm d-flex align-items-center gap-1" disabled={!usuarioSeleccionado || !usuarioConConexion} onClick={() => setMostrarModalDeuda(true)}>
                <FaMoneyBillWave/> <span>Reg. Deuda (F3)</span>
            </button>
        )}
        {permisos.canDeleteRecibos && (
          <button className={`btn btn-sm d-flex align-items-center justify-content-center ${darkMode ? 'btn-outline-light' : 'btn-outline-danger bg-white'}`} disabled={!usuarioSeleccionado} onClick={() => setMostrarModalEliminar(true)}><FaTrashAlt/></button>
        )}
        </div>
        )}

        {permisos.canManageOps && (
        <div className="btn-group shadow-sm">
        <button className={`btn btn-sm border d-flex align-items-center justify-content-center ${darkMode ? 'btn-dark' : 'btn-light'}`} disabled={!usuarioSeleccionado} onClick={() => setMostrarModalEditarUsuario(true)}><FaUserEdit/></button>
        {permisos.canSuperAdmin && (
          <button className={`btn btn-sm border d-flex align-items-center justify-content-center ${darkMode ? 'btn-dark' : 'btn-light'}`} disabled={!usuarioSeleccionado} onClick={eliminarUsuarioCompleto}><FaUserTimes/></button>
        )}
        </div>
        )}

        {permisos.canCambiarEstadoConexion && (
          <>
            <button className="btn btn-outline-danger btn-sm shadow-sm d-flex align-items-center justify-content-center" disabled={!puedeCortar} onClick={aplicarCorteSeleccionado} title="Aplicar Corte de Conexion"><FaPlug/></button>
            <button className="btn btn-outline-success btn-sm shadow-sm d-flex align-items-center justify-content-center" disabled={!puedeReconectar} onClick={reconectarSeleccionado} title="Reconectar Servicio"><FaLink/></button>
          </>
        )}
        {permisos.canGenerarActaCorte && (
          <button className="btn btn-warning btn-sm shadow-sm d-flex align-items-center justify-content-center" disabled={generandoActaCorte} onClick={abrirModalActaCorte} title="Acta de Corte"><FaFileInvoiceDollar/></button>
        )}
        {permisos.canReporteCortes && (
          <button className="btn btn-danger btn-sm shadow-sm d-flex align-items-center justify-content-center" onClick={handlePrintCortes} title="Cortes"><FaCut/></button>
        )}
        
        {permisos.canImpresionMasiva && (
          <button className="btn btn-dark btn-sm shadow-sm d-flex align-items-center gap-1" onClick={() => setMostrarModalMasivo(true)} title="Imprimir Recibos">
              <FaPrint/> <span>Impresion</span>
          </button>
        )}
    </div>

    <div className="ms-auto small user-select-none opacity-75 text-end text-truncate flex-grow-1" style={{ minWidth: "0" }}>
      {usuarioSeleccionado ? 
        <span className="text-truncate d-block">Sel: <strong>{usuarioSeleccionado.nombre_completo}</strong></span> 
        : <span className="fst-italic">Seleccione un contribuyente...</span>
      }
    </div>
  </div>
);
});

// --- COMPONENTE PRINCIPAL ---
const parseJwtPayload = (token) => {
  const parts = token.split(".");
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

const readStoredUser = () => {
  const token = localStorage.getItem("token");
  if (!token) return null;
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    localStorage.removeItem("token");
    return null;
  }
  return {
    id_usuario: payload.id_usuario,
    username: payload.username,
    nombre: payload.nombre,
    rol: normalizeRole(payload.rol)
  };
};

const ContribuyenteRow = memo(({ c, className, onMouseDown, onClick, rowHeight }) => (
  <tr
    data-id={c.id_contribuyente}
    onMouseDown={onMouseDown}
    onClick={onClick}
    className={className}
    style={{ cursor: "pointer", height: rowHeight }}
  >
    {(() => {
      const estadoNorm = c._estadoNorm || normalizeEstadoConexion(c.estado_conexion);
      const verificadoCampo = String(c.estado_conexion_verificado_sn || "N").trim().toUpperCase() === "S";
      const estadoLabel = ESTADO_CONEXION_LABELS[estadoNorm];
      const fuente = String(c.estado_conexion_fuente || "INFERIDO").trim().toUpperCase();
      const pendienteCaja = Number(c._pendienteCajaNum ?? c.pendiente_caja_monto) || 0;
      const ordenesPendientes = Number(c._pendienteOrdenesNum ?? c.pendiente_caja_ordenes) || 0;
      const deudaVisible = Number(c._deudaVisibleNum ?? c.deuda_anio) || 0;
      const abonoVisible = Number(c._abonoVisibleNum ?? c.abono_anio) || 0;
      const marcaPendienteCaja = pendienteCaja > 0.001;
      const titlePendienteCaja = marcaPendienteCaja
        ? `Incluye S/. ${pendienteCaja.toFixed(2)} reservado en ${ordenesPendientes || 1} orden(es) pendiente(s) de caja.`
        : undefined;
      return (
        <>
    <td className="fw-bold opacity-75">{c.codigo_municipal}</td>
    <td>{c.nombre_completo}</td>
    <td>{c.direccion_completa}</td>
    <td className="text-center">
      <span
        className={`badge ${badgeEstadoConexionClass(estadoNorm)}`}
        title={`Fuente: ${fuente} | Verificado campo: ${verificadoCampo ? "SI" : "NO"}`}
      >
        {estadoLabel}{verificadoCampo ? "" : " *"}
      </span>
    </td>
    <td className="text-center fw-bold">{c.meses_deuda > 0 ? c.meses_deuda : "-"}</td>
    <td className="text-end fw-bold" title={titlePendienteCaja}>S/. {deudaVisible.toFixed(2)}{marcaPendienteCaja ? " *" : ""}</td>
    <td className="text-end fw-bold text-success" title={titlePendienteCaja}>S/. {abonoVisible.toFixed(2)}{marcaPendienteCaja ? " *" : ""}</td>
        </>
      );
    })()}
  </tr>
));

const areSetsEqual = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
};

function App() {
  const [usuarioSistema, setUsuarioSistema] = useState(readStoredUser);
  const [contribuyentes, setContribuyentes] = useState([]);
  const [usuarioSeleccionado, setUsuarioSeleccionado] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [historialYear, setHistorialYear] = useState("all");
  const [historialYears, setHistorialYears] = useState([]);
  const [isDragging, setIsDragging] = useState(false); 
  
  // ESTADOS UI
  const [mostrarRegistro, setMostrarRegistro] = useState(false);
  const [mostrarModalDeuda, setMostrarModalDeuda] = useState(false);
  const [mostrarModalPago, setMostrarModalPago] = useState(false);
  const [mostrarModalEliminar, setMostrarModalEliminar] = useState(false);
  const [mostrarModalCierre, setMostrarModalCierre] = useState(false);
  const [mostrarModalEditarUsuario, setMostrarModalEditarUsuario] = useState(false);
  const [mostrarModalAuditoria, setMostrarModalAuditoria] = useState(false);
  const [mostrarModalUsuarios, setMostrarModalUsuarios] = useState(false);
  const [mostrarModalMasivo, setMostrarModalMasivo] = useState(false);
  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [mostrarModalDeudaMasiva, setMostrarModalDeudaMasiva] = useState(false);
  const [mostrarModalExportaciones, setMostrarModalExportaciones] = useState(false);
  const [mostrarModalCampo, setMostrarModalCampo] = useState(false);
  const [generandoActaCorte, setGenerandoActaCorte] = useState(false);
  const [mostrarModalReporteCortes, setMostrarModalReporteCortes] = useState(false);
  const [mostrarModalActaCorte, setMostrarModalActaCorte] = useState(false);
  
  const [selectedIds, setSelectedIds] = useState(new Set()); 
  const [scrollSelect, setScrollSelect] = useState({
    active: false,
    anchorId: null,
    mode: "replace",
    baseIds: []
  });
  const tableScrollRef = useRef(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const suppressClearRef = useRef(false);
  const selectedIdsRef = useRef(new Set());
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const [tableScrollRow, setTableScrollRow] = useState(0);
  const pendingScrollTopRef = useRef(0);
  const scrollRafRef = useRef(0);
  const lastHoverIdRef = useRef(null);
  const historialCacheRef = useRef(new Map());
  const rowHeight = 32;
  const overscan = 24;

  const [darkMode, setDarkMode] = useState(false);
  const [refreshDashboard, setRefreshDashboard] = useState(0);
  const [realtimeStatus, setRealtimeStatus] = useState("disabled");
  const [realtimeTick, setRealtimeTick] = useState(0);
  const realtimeRefreshTimerRef = useRef(0);
  const realtimeNeedsCajaRef = useRef(false);
  const realtimeContextRef = useRef({ canCaja: false, selectedId: null, historialYear: "all" });
  const realtimeOpsRef = useRef({
    cargarContribuyentes: () => {},
    cargarResumen: () => {},
    cargarHistorial: () => {}
  });
  const [resumenPendientesCaja, setResumenPendientesCaja] = useState({
    total_ordenes: 0,
    total_monto: 0,
    total_contribuyentes: 0
  });
  const [campoAppUrl, setCampoAppUrl] = useState(getLocalCampoAppUrl);

  const [busqueda, setBusqueda] = useState("");
  const [filtroEstadoConexion, setFiltroEstadoConexion] = useState("TODOS");
  const [orden, setOrden] = useState({ columna: "nombre_completo", direccion: "asc" });
  const busquedaDeferred = useDeferredValue(busqueda);
  const rolActual = normalizeRole(usuarioSistema?.rol);
  const permisos = useMemo(() => ({
    role: rolActual,
    roleLabel: ROLE_LABELS[rolActual] || "Nivel 4 - Consulta",
    canCaja: hasMinRole(rolActual, "CAJERO"),
    canManageOps: hasMinRole(rolActual, "ADMIN_SEC"),
    canManageContribuyentes: hasMinRole(rolActual, "ADMIN_SEC"),
    canReportesCaja: hasMinRole(rolActual, "ADMIN_SEC"),
    canExportPadron: hasMinRole(rolActual, "ADMIN_SEC"),
    canAuditoria: hasMinRole(rolActual, "ADMIN_SEC"),
    canManageUsers: hasMinRole(rolActual, "ADMIN"),
    canSuperAdmin: hasMinRole(rolActual, "ADMIN"),
    canDeleteRecibos: hasMinRole(rolActual, "ADMIN"),
    canDeleteCalles: hasMinRole(rolActual, "ADMIN"),
    canCambiarEstadoConexion: hasMinRole(rolActual, "ADMIN_SEC"),
    canGenerarActaCorte: hasMinRole(rolActual, "ADMIN_SEC"),
    canImpresionMasiva: hasMinRole(rolActual, "ADMIN_SEC"),
    canReporteCortes: hasMinRole(rolActual, "ADMIN_SEC"),
    canGestionCampo: hasMinRole(rolActual, "ADMIN_SEC")
  }), [rolActual]);
  const cargarCampoAppUrl = useCallback(async () => {
    const fallbackUrl = getLocalCampoAppUrl();
    if (!hasMinRole(rolActual, "ADMIN_SEC")) {
      setCampoAppUrl(fallbackUrl);
      return;
    }
    try {
      const res = await api.get("/admin/campo-remoto/estado", { timeout: 5000 });
      const remoteUrl = normalizeCampoAppUrl(res?.data?.campo_url);
      setCampoAppUrl(remoteUrl || fallbackUrl);
    } catch {
      setCampoAppUrl(fallbackUrl);
    }
  }, [rolActual]);

  useEffect(() => {
    if (!usuarioSistema) return;
    cargarCampoAppUrl();
  }, [usuarioSistema, cargarCampoAppUrl]);

  useEffect(() => {
    if (!mostrarModalCampo) return;
    cargarCampoAppUrl();
  }, [mostrarModalCampo, cargarCampoAppUrl]);

  const masivoRef = useRef(null);
  const isPrintingMasivoRef = useRef(false);
  const [datosMasivos, setDatosMasivos] = useState(null);
  const currentYear = new Date().getFullYear();
  const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

  const formatMonto = useCallback((value) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
  }, []);

  const construirDetalleDeudaActa = (rows = [], deudaTotalFallback = 0) => {
    const pendientes = (Array.isArray(rows) ? rows : [])
      .filter((r) => Number(r?.deuda_mes || 0) > 0 && String(r?.estado || "") !== "NO_EXIGIBLE")
      .sort((a, b) => (Number(a?.anio || 0) - Number(b?.anio || 0)) || (Number(a?.mes || 0) - Number(b?.mes || 0)));

    const porAnioMap = new Map();

    pendientes.forEach((r) => {
      const anio = Number(r.anio || 0);
      const mes = Number(r.mes || 0);
      const totalPagar = Number(r.total_pagar || 0);
      const deudaMes = round2(r.deuda_mes);
      const factor = totalPagar > 0 ? Math.min(Math.max(deudaMes / totalPagar, 0), 1) : 0;

      let agua = round2(Number(r.subtotal_agua || 0) * factor);
      let desague = round2(Number(r.subtotal_desague || 0) * factor);
      let limpieza = round2(Number(r.subtotal_limpieza || 0) * factor);
      let admin = round2(Number(r.subtotal_admin || 0) * factor);
      const sumaComponentes = round2(agua + desague + limpieza + admin);
      const ajuste = round2(deudaMes - sumaComponentes);
      if (ajuste !== 0) admin = round2(admin + ajuste);

      if (!porAnioMap.has(anio)) {
        porAnioMap.set(anio, {
          anio,
          total_agua: 0,
          total_desague: 0,
          total_limpieza: 0,
          total_admin: 0,
          deuda_anual: 0,
          meses: []
        });
      }

      const group = porAnioMap.get(anio);
      group.total_agua = round2(group.total_agua + agua);
      group.total_desague = round2(group.total_desague + desague);
      group.total_limpieza = round2(group.total_limpieza + limpieza);
      group.total_admin = round2(group.total_admin + admin);
      group.deuda_anual = round2(group.deuda_anual + deudaMes);
      group.meses.push({
        mes,
        agua,
        desague,
        limpieza,
        admin,
        total_mes: deudaMes
      });
    });

    const por_anio = Array.from(porAnioMap.values()).sort((a, b) => a.anio - b.anio);
    const total = por_anio.reduce((acc, row) => {
      acc.agua = round2(acc.agua + row.total_agua);
      acc.desague = round2(acc.desague + row.total_desague);
      acc.limpieza = round2(acc.limpieza + row.total_limpieza);
      acc.admin = round2(acc.admin + row.total_admin);
      acc.deuda_total = round2(acc.deuda_total + row.deuda_anual);
      return acc;
    }, { agua: 0, desague: 0, limpieza: 0, admin: 0, deuda_total: 0 });

    if (por_anio.length === 0) {
      total.deuda_total = round2(deudaTotalFallback);
    }

    return { por_anio, total };
  };

const a5PageStyle = `
  @page {
    size: A5 portrait;
    margin: 0;
  }
  @media print {
    html, body {
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
`;

const actaPageStyle = `
  @page {
    size: A4 portrait;
    margin: 6mm;
  }
  @media print {
    html, body {
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      background: #fff !important;
    }
    #root {
      background: #fff !important;
    }
  }
`;

  const handlePrintMasivo = useReactToPrint({
    contentRef: masivoRef,
    documentTitle: 'Recibos_Masivos',
    pageStyle: a5PageStyle,
    onAfterPrint: () => {
      isPrintingMasivoRef.current = false;
      setDatosMasivos(null);
    }
  });

  useEffect(() => {
    if (!datosMasivos) return;
    if (isPrintingMasivoRef.current) return;
    isPrintingMasivoRef.current = true;
    const raf = requestAnimationFrame(() => {
      if (masivoRef.current) {
        handlePrintMasivo();
      } else {
        isPrintingMasivoRef.current = false;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [datosMasivos, handlePrintMasivo]);

  const componentRef = useRef(null);
  const isPrintingReciboRef = useRef(false);
  const cortesRef = useRef(null);
  const actaCorteRef = useRef(null);
  const [datosReciboImprimir, setDatosReciboImprimir] = useState(null);
  const [datosActaCorteImprimir, setDatosActaCorteImprimir] = useState([]);
  const [datosCortesImprimir, setDatosCortesImprimir] = useState(null);
  const isPrintingActaRef = useRef(false);
  const isPrintingCortesRef = useRef(false);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const setSelectedIdsIfChanged = useCallback((nextSelected) => {
    setSelectedIds((prev) => (areSetsEqual(prev, nextSelected) ? prev : nextSelected));
  }, []);

  const handlePrintCortes = useReactToPrint({
    contentRef: cortesRef,
    documentTitle: "Orden_Cortes",
    onAfterPrint: () => {
      isPrintingCortesRef.current = false;
      setDatosCortesImprimir(null);
    }
  });
  const handlePrintActa = useReactToPrint({
    contentRef: actaCorteRef,
    documentTitle: "Acta_Corte",
    pageStyle: actaPageStyle,
    onAfterPrint: () => {
      isPrintingActaRef.current = false;
      setDatosActaCorteImprimir([]);
    }
  });
  const handlePrintRecibo = useReactToPrint({
    contentRef: componentRef,
    documentTitle: 'Recibo_Agua',
    pageStyle: a5PageStyle,
    onAfterPrint: () => {
      isPrintingReciboRef.current = false;
      setDatosReciboImprimir(null);
    }
  });

  const abrirModalReporteCortes = () => {
    if (!permisos.canReporteCortes) {
      alert("Tu nivel no tiene permiso para reporte de cortes.");
      return;
    }
    setMostrarModalReporteCortes(true);
  };

  const abrirModalActaCorte = () => {
    if (!permisos.canGenerarActaCorte) {
      alert("Tu nivel no tiene permiso para generar actas de corte.");
      return;
    }
    setMostrarModalActaCorte(true);
  };

  const imprimirActaCorte = async (idsEntrada = []) => {
    if (!permisos.canGenerarActaCorte) {
      alert("Tu nivel no tiene permiso para generar actas de corte.");
      return;
    }

    const idsNormalizados = (Array.isArray(idsEntrada) ? idsEntrada : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);

    const idsSeleccionados = Array.from(selectedIds).filter((id) => Number.isInteger(id) && id > 0);
    const idsObjetivoRaw = idsNormalizados.length > 0
      ? idsNormalizados
      : (idsSeleccionados.length > 0
        ? idsSeleccionados
        : (usuarioSeleccionado?.id_contribuyente ? [usuarioSeleccionado.id_contribuyente] : []));
    const idsObjetivo = Array.from(new Set(idsObjetivoRaw));

    if (idsObjetivo.length === 0) return alert("Seleccione al menos un contribuyente.");

    const objetivosConDeuda = idsObjetivo.filter((id) => {
      const c = contribuyenteById.get(id);
      if (!c) return false;
      const meses = Number(c.meses_deuda || 0);
      const deuda = parseFloat(c.deuda_anio || 0) || 0;
      return meses > 0 || deuda > 0;
    });

    if (objetivosConDeuda.length === 0) {
      return alert("Los contribuyentes seleccionados no tienen deuda pendiente.");
    }

    try {
      setGenerandoActaCorte(true);
      const actasGeneradas = [];
      const errores = [];

      for (const idContribuyente of objetivosConDeuda) {
        const base = contribuyenteById.get(idContribuyente);
        if (!base) continue;

        try {
          const [resActa, resHistorial] = await Promise.all([
            api.post("/actas-corte/generar", {
              id_contribuyente: idContribuyente
            }),
            api.get(`/recibos/historial/${idContribuyente}?anio=all`)
          ]);
          const data = resActa.data || {};
          const detalle_deuda = construirDetalleDeudaActa(
            Array.isArray(resHistorial?.data) ? resHistorial.data : [],
            parseFloat(data.deuda_total ?? base.deuda_anio ?? 0) || 0
          );
          actasGeneradas.push({
            numero_acta: data.numero_acta || "",
            fecha_emision: data.fecha_emision || new Date().toISOString(),
            usuario_notificador: usuarioSistema?.nombre || "",
            detalle_deuda,
            contribuyente: {
              codigo_municipal: base.codigo_municipal,
              nombre_completo: base.nombre_completo,
              dni_ruc: base.dni_ruc,
              direccion_completa: base.direccion_completa,
              meses_deuda: Number(data.meses_deuda ?? base.meses_deuda ?? 0),
              deuda_total: parseFloat(data.deuda_total ?? base.deuda_anio ?? 0) || 0
            }
          });
        } catch (errItem) {
          errores.push(base?.codigo_municipal || String(idContribuyente));
        }
      }

      if (actasGeneradas.length === 0) {
        return alert("No se pudo generar ninguna acta para la seleccion.");
      }

      setDatosActaCorteImprimir(actasGeneradas);

      if (errores.length > 0) {
        alert(`Se generaron ${actasGeneradas.length} acta(s). Omitidos: ${errores.join(", ")}`);
      }
    } catch (error) {
      const msg = error?.response?.data?.error || "No se pudo generar el acta de corte.";
      alert(msg);
    } finally {
      setGenerandoActaCorte(false);
    }
  };

  useEffect(() => {
    if (!datosReciboImprimir) return;
    if (isPrintingReciboRef.current) return;
    isPrintingReciboRef.current = true;
    const raf = requestAnimationFrame(() => {
      if (componentRef.current) {
        handlePrintRecibo();
      } else {
        isPrintingReciboRef.current = false;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [datosReciboImprimir, handlePrintRecibo]);

  useEffect(() => {
    if (!Array.isArray(datosActaCorteImprimir) || datosActaCorteImprimir.length === 0) return;
    if (isPrintingActaRef.current) return;
    isPrintingActaRef.current = true;
    const raf = requestAnimationFrame(() => {
      if (actaCorteRef.current) {
        handlePrintActa();
      } else {
        isPrintingActaRef.current = false;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [datosActaCorteImprimir, handlePrintActa]);

  useEffect(() => {
    if (!datosCortesImprimir) return;
    if (isPrintingCortesRef.current) return;
    isPrintingCortesRef.current = true;
    const raf = requestAnimationFrame(() => {
      if (cortesRef.current) {
        handlePrintCortes();
      } else {
        isPrintingCortesRef.current = false;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [datosCortesImprimir, handlePrintCortes]);

  const cargarContribuyentes = async (retry = 0) => {
    try {
      const res = await api.get("/contribuyentes");
      setContribuyentes(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      const mensaje = String(error?.message || "");
      const esTimeout = error?.code === "ECONNABORTED" || mensaje.toLowerCase().includes("timeout");
      if (esTimeout && retry < 1) {
        setTimeout(() => cargarContribuyentes(retry + 1), 1200);
        return;
      }
      console.error("Error datos:", error.response?.status, error.response?.data || error.message);
      setContribuyentes([]);
    }
  };
  const cargarResumenPendientesCaja = async () => {
    try {
      const res = await api.get("/caja/ordenes-cobro/resumen-pendientes");
      const data = res?.data || {};
      setResumenPendientesCaja({
        total_ordenes: Number(data.total_ordenes || 0),
        total_monto: Number(data.total_monto || 0),
        total_contribuyentes: Number(data.total_contribuyentes || 0)
      });
    } catch {
      setResumenPendientesCaja({
        total_ordenes: 0,
        total_monto: 0,
        total_contribuyentes: 0
      });
    }
  };
  const cargarHistorial = async (id_contribuyente, anio = historialYear, force = false) => {
    const cacheKey = `${id_contribuyente}:${anio}`;
    if (!force && historialCacheRef.current.has(cacheKey)) {
      const cached = historialCacheRef.current.get(cacheKey);
      setHistorial(cached.rows);
      if (anio === "all") setHistorialYears(cached.years);
      return;
    }
    try {
      const res = await api.get(`/recibos/historial/${id_contribuyente}?anio=${anio}`);
      const rows = Array.isArray(res.data) ? res.data : [];
      setHistorial(rows);
      if (anio === "all") {
        const years = Array.from(new Set(rows.map((r) => Number(r.anio)).filter(Boolean))).sort((a, b) => a - b);
        setHistorialYears(years);
        historialCacheRef.current.set(cacheKey, { rows, years });
      } else {
        historialCacheRef.current.set(cacheKey, { rows, years: [] });
      }
    } catch (error) {
      console.error("Error historial");
    }
  };

  const handleHistorialYearChange = (e) => {
    const value = e.target.value;
    setHistorialYear(value);
    if (usuarioSeleccionado) cargarHistorial(usuarioSeleccionado.id_contribuyente, value);
  };

  const historialTabla = useMemo(() => {
    if (!usuarioSeleccionado) return [];

    const dataMap = new Map();
    historial.forEach((r) => {
      const anio = Number(r.anio);
      const mes = Number(r.mes);
      if (!Number.isFinite(anio) || !Number.isFinite(mes)) return;
      const key = `${anio}-${mes}`;
      const current = dataMap.get(key) || {
        anio,
        mes,
        subtotal_agua: 0,
        subtotal_desague: 0,
        subtotal_limpieza: 0,
        subtotal_admin: 0,
        deuda_mes: 0,
        abono_mes: 0
      };
      current.subtotal_agua += parseFloat(r.subtotal_agua) || 0;
      current.subtotal_desague += parseFloat(r.subtotal_desague) || 0;
      current.subtotal_limpieza += parseFloat(r.subtotal_limpieza) || 0;
      current.subtotal_admin += parseFloat(r.subtotal_admin) || 0;
      current.deuda_mes += parseFloat(r.deuda_mes) || 0;
      current.abono_mes += parseFloat(r.abono_mes) || 0;
      dataMap.set(key, current);
    });

    let yearsToShow = [];
    if (historialYear === "all") {
      yearsToShow = historialYears.length > 0 ? historialYears : [currentYear];
    } else {
      const y = Number(historialYear);
      yearsToShow = Number.isFinite(y) ? [y] : [currentYear];
    }

    if (yearsToShow.length === 0) return [];

    const rows = [];
    yearsToShow.forEach((anio) => {
      rows.push({ type: "year", anio });
      for (let mes = 1; mes <= 12; mes++) {
        const key = `${anio}-${mes}`;
        const data = dataMap.get(key) || {
          anio,
          mes,
          subtotal_agua: 0,
          subtotal_desague: 0,
          subtotal_limpieza: 0,
          subtotal_admin: 0,
          deuda_mes: 0,
          abono_mes: 0
        };
        rows.push({ type: "month", ...data });
      }
    });
    return rows;
  }, [usuarioSeleccionado, historial, historialYear, historialYears, currentYear]);

  const yearsForSelect = useMemo(() => {
    if (historialYears.length > 0) return historialYears;
    return [currentYear];
  }, [historialYears, currentYear]);

  const historialBodyRows = useMemo(() => {
    if (!usuarioSeleccionado) {
      return <tr><td colSpan="7" className="p-3">Seleccione usuario arriba</td></tr>;
    }
    if (historialTabla.length === 0) {
      return <tr><td colSpan="7" className="p-3">Sin movimientos</td></tr>;
    }
    return historialTabla.map((h, i) => {
      if (h.type === "year") {
        return (
          <tr key={`year-${h.anio}`}>
            <td colSpan="7" className={`text-start fw-bold ${darkMode ? "bg-dark text-white" : "bg-light"}`} style={{ paddingLeft: "12px" }}>
              Año {h.anio}
            </td>
          </tr>
        );
      }
      return (
        <tr key={`${h.anio}-${h.mes}-${i}`}>
          <td className="fw-bold text-start ps-3">{MONTH_LABELS[h.mes] || "-"}</td>
          <td>{formatMonto(h.subtotal_agua)}</td>
          <td>{formatMonto(h.subtotal_desague)}</td>
          <td>{formatMonto(h.subtotal_limpieza)}</td>
          <td>{formatMonto(h.subtotal_admin)}</td>
          <td className="fw-bold text-danger">{formatMonto(h.deuda_mes)}</td>
          <td className="fw-bold text-success">{formatMonto(h.abono_mes)}</td>
        </tr>
      );
    });
  }, [usuarioSeleccionado, historialTabla, darkMode, formatMonto]);

  const recargarTodo = () => {
    historialCacheRef.current.clear();
    cargarContribuyentes();
    if (permisos.canCaja) cargarResumenPendientesCaja();
    if (usuarioSeleccionado) cargarHistorial(usuarioSeleccionado.id_contribuyente, "all", true);
    setRefreshDashboard(prev => prev + 1);
    setSelectedIds(new Set());
  };

  useEffect(() => {
    realtimeContextRef.current = {
      canCaja: permisos.canCaja,
      selectedId: usuarioSeleccionado?.id_contribuyente || null,
      historialYear
    };
  }, [permisos.canCaja, usuarioSeleccionado, historialYear]);

  useEffect(() => {
    realtimeOpsRef.current = {
      cargarContribuyentes,
      cargarResumen: cargarResumenPendientesCaja,
      cargarHistorial
    };
  }, [cargarContribuyentes, cargarResumenPendientesCaja, cargarHistorial]);

  useEffect(() => {
    const unsubscribeStatus = realtime.onStatus((status) => {
      setRealtimeStatus(status);
    });

    const unsubscribeEvent = realtime.onEvent((event) => {
      if (!event || event.type !== "event") return;
      if (event.channel === "caja") {
        realtimeNeedsCajaRef.current = true;
      }
      setRealtimeTick((prev) => prev + 1);
      if (realtimeRefreshTimerRef.current) return;
      realtimeRefreshTimerRef.current = setTimeout(() => {
        realtimeRefreshTimerRef.current = 0;
        const ops = realtimeOpsRef.current;
        const context = realtimeContextRef.current;
        ops.cargarContribuyentes();
        if (context.selectedId) {
          ops.cargarHistorial(context.selectedId, context.historialYear || "all", true);
        }
        if (realtimeNeedsCajaRef.current && context.canCaja) {
          ops.cargarResumen();
        }
        realtimeNeedsCajaRef.current = false;
        setRefreshDashboard((prev) => prev + 1);
      }, 180);
    });

    return () => {
      unsubscribeStatus();
      unsubscribeEvent();
      if (realtimeRefreshTimerRef.current) {
        clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = 0;
      }
      realtimeNeedsCajaRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!usuarioSistema) {
      realtime.disconnect(true);
      setRealtimeStatus(realtime.enabled ? "fallback" : "disabled");
      return;
    }
    const token = localStorage.getItem("token") || "";
    realtime.connect(token);
  }, [usuarioSistema]);

  useEffect(() => {
    if (!usuarioSistema) return;
    cargarContribuyentes();
  }, [usuarioSistema]);
  useEffect(() => {
    if (!usuarioSistema || !permisos.canCaja) {
      setResumenPendientesCaja({
        total_ordenes: 0,
        total_monto: 0,
        total_contribuyentes: 0
      });
      return undefined;
    }
    cargarResumenPendientesCaja();
    const timer = setInterval(() => {
      cargarResumenPendientesCaja();
    }, 10000);
    return () => clearInterval(timer);
  }, [usuarioSistema, permisos.canCaja]);
  useEffect(() => {
    if (usuarioSeleccionado) {
      setHistorialYear("all");
      cargarHistorial(usuarioSeleccionado.id_contribuyente, "all");
    } else {
      setHistorial([]);
      setHistorialYears([]);
    }
  }, [usuarioSeleccionado]);
  useEffect(() => {
    if (usuarioSeleccionado) {
      const usuarioActualizado = contribuyentes.find(c => c.id_contribuyente === usuarioSeleccionado.id_contribuyente);
      if (usuarioActualizado) setUsuarioSeleccionado(usuarioActualizado);
    }
  }, [contribuyentes]);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const updateHeight = () => setTableViewportHeight(el.clientHeight || 0);
    updateHeight();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => updateHeight());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleLogout = () => {
    if (window.confirm("Cerrar sesion?")) {
      realtime.disconnect(true);
      localStorage.removeItem("token");
      setUsuarioSistema(null);
      setUsuarioSeleccionado(null);
    }
  };

  const cambiarEstadoConexionSeleccionado = async (estadoDestino) => {
    if (!usuarioSeleccionado) {
      alert("Seleccione un contribuyente.");
      return;
    }
    if (!permisos.canCambiarEstadoConexion) {
      alert("Tu nivel no tiene permiso para cambiar estado de conexion.");
      return;
    }

    const estadoActual = normalizeEstadoConexion(usuarioSeleccionado.estado_conexion);
    if (estadoActual === estadoDestino) {
      alert("El contribuyente ya tiene ese estado.");
      return;
    }
    if (estadoDestino === ESTADOS_CONEXION.CORTADO && estadoActual !== ESTADOS_CONEXION.CON_CONEXION) {
      alert("Solo se puede aplicar corte a contribuyentes con conexion activa.");
      return;
    }

    const accion = estadoDestino === ESTADOS_CONEXION.CORTADO ? "aplicar corte" : "reconectar";
    const motivoDefault = estadoDestino === ESTADOS_CONEXION.CORTADO
      ? "Corte por morosidad."
      : "Reconexion por regularizacion de pago.";
    const motivo = window.prompt(`Motivo para ${accion}:`, motivoDefault);
    if (motivo === null) return;
    const motivoFinal = String(motivo || "").trim();
    if (!motivoFinal) {
      alert("Debe ingresar un motivo.");
      return;
    }
    if (!window.confirm(`Confirma ${accion} a ${usuarioSeleccionado.nombre_completo}?`)) return;

    try {
      const res = await api.post(`/contribuyentes/${usuarioSeleccionado.id_contribuyente}/estado-conexion`, {
        estado_conexion: estadoDestino,
        motivo: motivoFinal
      });
      const fechaEvento = res?.data?.fecha_evento ? new Date(res.data.fecha_evento).toLocaleString() : null;
      alert(`${res?.data?.mensaje || "Estado actualizado."}${fechaEvento ? `\nFecha: ${fechaEvento}` : ""}`);
      recargarTodo();
    } catch (error) {
      alert(error?.response?.data?.error || "No se pudo actualizar el estado de conexion.");
    }
  };

  const aplicarCorteSeleccionado = () => cambiarEstadoConexionSeleccionado(ESTADOS_CONEXION.CORTADO);
  const reconectarSeleccionado = () => cambiarEstadoConexionSeleccionado(ESTADOS_CONEXION.CON_CONEXION);

  const eliminarUsuarioCompleto = async () => {
    if(!usuarioSeleccionado) return;
    if (!permisos.canSuperAdmin) {
      alert("Solo Nivel 1 puede eliminar contribuyentes.");
      return;
    }
    if(!window.confirm(`PELIGRO: Eliminar a ${usuarioSeleccionado.nombre_completo}?`)) return;
    try { await api.delete(`/contribuyentes/${usuarioSeleccionado.id_contribuyente}`); alert("Usuario eliminado."); setUsuarioSeleccionado(null); recargarTodo(); } catch (error) { alert("Error al eliminar."); }
  };

  const descargarPadron = async () => {
    if (!permisos.canExportPadron) {
      alert("Tu nivel no tiene permiso para exportar padron.");
      return;
    }
    try {
      const response = await api.get("/exportar/padron", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `padron_${new Date().toISOString().slice(0, 10)}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(error?.response?.data?.error || "Error al descargar padron.");
    }
  };

  const descargarBackup = async () => {
    if (!permisos.canSuperAdmin) {
      alert("Solo Nivel 1 puede generar copias de seguridad.");
      return;
    }
    if (!confirm("Generar y descargar copia de seguridad completa?")) return;
    try {
      const response = await api.get("/admin/backup", { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `backup_sistema_${new Date().toISOString().slice(0,10)}.sql`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) { alert("Error al generar la copia."); console.error(error); }
  };

  const startScrollSelect = useCallback((anchorId, mode, baseIds) => {
    setScrollSelect({
      active: true,
      anchorId,
      mode,
      baseIds: Array.from(baseIds)
    });
  }, []);

  const clearScrollSelect = useCallback(() => {
    setScrollSelect({ active: false, anchorId: null, mode: "replace", baseIds: [] });
  }, []);

  const handleFilaClick = (e, usuario) => {
    const id = usuario.id_contribuyente;
    if (e.ctrlKey || e.metaKey) {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
        setUsuarioSeleccionado(usuario); 
        startScrollSelect(id, "add", newSelected);
    } else {
        const only = new Set([id]);
        setSelectedIds(only);
        setUsuarioSeleccionado(usuario);
        startScrollSelect(id, "replace", only);
    }
  };

  const handleBackgroundClick = () => {
    if (suppressClearRef.current) {
      suppressClearRef.current = false;
      return;
    }
    setUsuarioSeleccionado(null);
    setSelectedIds(new Set());
    clearScrollSelect();
  };

  const beginDragSelection = useCallback((e, usuario) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const id = usuario.id_contribuyente;
    let baseSelected;
    let mode = "replace";

    if (e.ctrlKey || e.metaKey) {
      baseSelected = new Set(selectedIdsRef.current);
      if (baseSelected.has(id)) baseSelected.delete(id);
      else baseSelected.add(id);
      mode = "add";
    } else {
      baseSelected = new Set([id]);
    }

    setSelectedIdsIfChanged(baseSelected);
    setUsuarioSeleccionado(usuario);
    startScrollSelect(id, mode, baseSelected);
    setIsDragging(true);
  }, [setSelectedIdsIfChanged, startScrollSelect]);

  const contribuyentesIndexados = useMemo(() => {
    const rows = Array.isArray(contribuyentes) ? contribuyentes : [];
    return rows.map((c) => {
      const estadoNorm = normalizeEstadoConexion(c.estado_conexion);
      const estadoLabel = ESTADO_CONEXION_LABELS[estadoNorm] || "";
      const deudaNum = Number.parseFloat(c.deuda_anio) || 0;
      const abonoNum = Number.parseFloat(c.abono_anio) || 0;
      const pendienteCajaNum = Number.parseFloat(c.pendiente_caja_monto) || 0;
      const deudaVisibleNum = Math.max(deudaNum - pendienteCajaNum, 0);
      const abonoVisibleNum = abonoNum + pendienteCajaNum;
      return {
        ...c,
        _estadoNorm: estadoNorm,
        _nombreLc: String(c.nombre_completo || "").toLowerCase(),
        _codigoLc: String(c.codigo_municipal || "").toLowerCase(),
        _direccionLc: String(c.direccion_completa || "").toLowerCase(),
        _estadoLabelLc: estadoLabel.toLowerCase(),
        _deudaNum: deudaNum,
        _abonoNum: abonoNum,
        _deudaVisibleNum: deudaVisibleNum,
        _abonoVisibleNum: abonoVisibleNum,
        _pendienteCajaNum: pendienteCajaNum,
        _pendienteOrdenesNum: Number.parseFloat(c.pendiente_caja_ordenes) || 0,
        _mesesNum: Number.parseFloat(c.meses_deuda) || 0
      };
    });
  }, [contribuyentes]);

  const datosProcesados = useMemo(() => {
    const needle = busquedaDeferred.trim().toLowerCase();
    const filtrados = contribuyentesIndexados.filter((c) => {
      if (filtroEstadoConexion !== "TODOS" && c._estadoNorm !== filtroEstadoConexion) {
        return false;
      }
      if (!needle) return true;
      return c._nombreLc.includes(needle)
        || c._codigoLc.includes(needle)
        || c._direccionLc.includes(needle)
        || c._estadoLabelLc.includes(needle);
    });

    const numericSortMap = {
      deuda_anio: "_deudaVisibleNum",
      abono_anio: "_abonoVisibleNum",
      meses_deuda: "_mesesNum"
    };
    const textSortMap = {
      nombre_completo: "_nombreLc",
      codigo_municipal: "_codigoLc",
      direccion_completa: "_direccionLc",
      estado_conexion: "_estadoLabelLc"
    };

    return filtrados.sort((a, b) => {
      const numericField = numericSortMap[orden.columna];
      if (numericField) {
        return orden.direccion === 'asc'
          ? a[numericField] - b[numericField]
          : b[numericField] - a[numericField];
      }

      const textField = textSortMap[orden.columna];
      const valA = textField ? a[textField] : String(a?.[orden.columna] ?? "").toLowerCase();
      const valB = textField ? b[textField] : String(b?.[orden.columna] ?? "").toLowerCase();
      if (valA < valB) return orden.direccion === 'asc' ? -1 : 1;
      if (valA > valB) return orden.direccion === 'asc' ? 1 : -1;
      return 0;
    });
  }, [contribuyentesIndexados, busquedaDeferred, orden, filtroEstadoConexion]);
  const indexById = useMemo(() => {
    const map = new Map();
    datosProcesados.forEach((c, idx) => map.set(c.id_contribuyente, idx));
    return map;
  }, [datosProcesados]);
  const contribuyenteById = useMemo(() => {
    const map = new Map();
    datosProcesados.forEach((c) => map.set(c.id_contribuyente, c));
    return map;
  }, [datosProcesados]);

  const virtualRange = useMemo(() => {
    const total = datosProcesados.length;
    const viewport = tableViewportHeight || rowHeight;
    const rawStart = Math.max(0, tableScrollRow - overscan);
    const start = Math.min(rawStart, Math.max(0, total - 1));
    const visibleCount = Math.ceil(viewport / rowHeight) + overscan * 2;
    const end = Math.min(total, start + visibleCount);
    return {
      start,
      end,
      topSpacerHeight: start * rowHeight,
      bottomSpacerHeight: Math.max(0, (total - end) * rowHeight)
    };
  }, [datosProcesados.length, tableScrollRow, tableViewportHeight, rowHeight, overscan]);

  const visibleContribuyentes = useMemo(
    () => datosProcesados.slice(virtualRange.start, virtualRange.end),
    [datosProcesados, virtualRange.start, virtualRange.end]
  );

  const findRowAtPoint = (x, y) => {
    const target = document.elementFromPoint(x, y);
    const row = target?.closest?.("tr[data-id]");
    if (!row) return null;
    if (tableScrollRef.current && !tableScrollRef.current.contains(row)) return null;
    return row;
  };

  const findFallbackRow = () => {
    if (!tableScrollRef.current) return null;
    const rect = tableScrollRef.current.getBoundingClientRect();
    const probeX = rect.left + 12;
    const probeY = rect.top + Math.min(60, rect.height / 2);
    return findRowAtPoint(probeX, probeY);
  };

  const applyScrollSelectAtPoint = (x, y) => {
    let row = null;
    if (typeof x === "number" && typeof y === "number") {
      row = findRowAtPoint(x, y);
    }
    if (!row) row = findFallbackRow();
    if (!row) return;

    const hoveredId = Number(row.dataset.id);
    if (Number.isNaN(hoveredId)) return;
    if (lastHoverIdRef.current === hoveredId) return;
    lastHoverIdRef.current = hoveredId;

    const anchorIndex = indexById.get(scrollSelect.anchorId);
    const hoverIndex = indexById.get(hoveredId);
    if (anchorIndex === undefined || hoverIndex === undefined) return;

    const from = Math.min(anchorIndex, hoverIndex);
    const to = Math.max(anchorIndex, hoverIndex);
    const rangeIds = datosProcesados.slice(from, to + 1).map(c => c.id_contribuyente);
    const nextSelected = scrollSelect.mode === "add"
      ? new Set([...scrollSelect.baseIds, ...rangeIds])
      : new Set(rangeIds);

    setSelectedIdsIfChanged(nextSelected);
    const hoveredUsuario = datosProcesados[hoverIndex];
    if (hoveredUsuario && hoveredUsuario.id_contribuyente !== usuarioSeleccionado?.id_contribuyente) {
      setUsuarioSeleccionado(hoveredUsuario);
    }
  };

  const scheduleScrollTopUpdate = useCallback((nextTop) => {
    pendingScrollTopRef.current = nextTop;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      const nextRow = Math.max(0, Math.floor((pendingScrollTopRef.current || 0) / rowHeight));
      setTableScrollRow((prev) => (prev === nextRow ? prev : nextRow));
      scrollRafRef.current = 0;
    });
  }, [rowHeight]);

  const handleTableWheel = (e) => {
    pointerRef.current = { x: e.clientX, y: e.clientY, inside: true };
    if (!scrollSelect.active || !isDragging) return;
    requestAnimationFrame(() => applyScrollSelectAtPoint(e.clientX, e.clientY));
  };

  const handleTableScroll = (e) => {
    scheduleScrollTopUpdate(e.currentTarget.scrollTop);
    if (!scrollSelect.active || !isDragging) return;
    const { x, y } = pointerRef.current;
    requestAnimationFrame(() => applyScrollSelectAtPoint(x, y));
  };

  const handleTableMouseMove = (e) => {
    pointerRef.current = { x: e.clientX, y: e.clientY, inside: true };
    if (!scrollSelect.active || !isDragging) return;
    requestAnimationFrame(() => applyScrollSelectAtPoint(e.clientX, e.clientY));
  };

  const handleTableMouseLeave = () => {
    pointerRef.current.inside = false;
  };

  const handleRowMouseDown = useCallback((e) => {
    const id = Number(e.currentTarget.dataset.id);
    if (Number.isNaN(id)) return;
    const usuario = contribuyenteById.get(id);
    if (!usuario) return;
    beginDragSelection(e, usuario);
  }, [beginDragSelection, contribuyenteById]);

  const handleRowClick = useCallback((e) => {
    e.stopPropagation();
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  useEffect(() => {
    const handleUp = () => {
      if (!isDragging) return;
      setIsDragging(false);
      clearScrollSelect();
      suppressClearRef.current = true;
      setTimeout(() => {
        suppressClearRef.current = false;
      }, 0);
    };
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("blur", handleUp);
    return () => {
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("blur", handleUp);
    };
  }, [isDragging]);
  const handleSort = (columna) => { setOrden(prev => ({ columna, direccion: prev.columna === columna && prev.direccion === 'asc' ? 'desc' : 'asc' })); };
  
  const getRowClass = (c) => { 
      const meses = Number(c._mesesNum ?? c.meses_deuda ?? 0); 
      const estadoConexion = c._estadoNorm || normalizeEstadoConexion(c.estado_conexion);
      if (selectedIds.has(c.id_contribuyente)) return "table-active border border-primary border-2";
      if (usuarioSeleccionado?.id_contribuyente === c.id_contribuyente) return "table-primary border-primary"; 
      if (estadoConexion === ESTADOS_CONEXION.CORTADO) return "table-secondary";
      if (meses >= 3) return "table-danger"; 
      if (meses === 2) return "table-warning"; 
      return ""; 
  };
  
  const ThOrdenable = ({ label, campo }) => {
    const isActive = orden.columna === campo;
    // CAMBIO: Paleta de colores mejorada para contraste en Dark Mode
    const bgColor = darkMode ? (isActive ? "#495057" : "#343a40") : (isActive ? "#cff4fc" : "#e2e3e5"); 
    const textColor = darkMode ? "#fff" : "#000";
    const borderColor = darkMode ? "#495057" : "#dee2e6";

    return (
      <th 
        style={{
          cursor: 'pointer', 
          userSelect: 'none', 
          position: 'sticky', 
          top: '0', 
          zIndex: 5, 
          backgroundColor: bgColor,
          color: textColor,
          boxShadow: `inset 0 -1px 0 ${borderColor}` // Borde interno del color correcto
        }} 
        onClick={() => handleSort(campo)}
      > 
        <div className="d-flex justify-content-between align-items-center">
          {label} {isActive && <FaSort size={12}/>}
        </div> 
      </th> 
    );
  };

  const bgMain = darkMode ? 'bg-dark text-white' : 'bg-light text-dark';
  // CAMBIO: Color de tarjeta mas oscuro para contraste (#2b3035) y borde sutil
  const bgCard = darkMode ? 'text-white' : 'bg-white border text-dark';
  const cardStyle = darkMode ? { backgroundColor: "#2b3035", borderTop: "1px solid #495057", borderRight: "1px solid #495057", borderBottom: "1px solid #495057", borderLeft: "1px solid #495057" } : {};
  const tableClass = darkMode ? 'table table-dark table-hover mb-0 table-sm small' : 'table table-hover table-bordered mb-0 table-sm small';
  const realtimeBadge = useMemo(() => {
    if (realtimeStatus === "connected") return { label: "Tiempo real: Conectado", className: "bg-success" };
    if (realtimeStatus === "connecting" || realtimeStatus === "reconnecting") return { label: "Tiempo real: Reconectando", className: "bg-warning text-dark" };
    if (realtimeStatus === "disabled") return { label: "Tiempo real: Desactivado", className: "bg-secondary" };
    return { label: "Sin tiempo real (modo respaldo)", className: "bg-dark" };
  }, [realtimeStatus]);

  if (!usuarioSistema) {
    return (
      <LoginPage
        onLoginSuccess={(datos) => {
          const { token, ...user } = datos || {};
          const baseUser = user?.id_usuario ? user : datos;
          setUsuarioSistema(baseUser ? { ...baseUser, rol: normalizeRole(baseUser.rol) } : baseUser);
        }}
      />
    );
  }
  if (rolActual === "BRIGADA") {
    return (
      <div className="d-flex align-items-center justify-content-center vh-100 bg-light p-3">
        <div className="card shadow-sm" style={{ maxWidth: "540px", width: "100%" }}>
          <div className="card-body">
            <h5 className="card-title mb-2">Usuario de brigada detectado</h5>
            <p className="text-muted mb-3">
              Este panel es para administracion. Para brigada use la app de campo.
            </p>
            <div className="d-flex gap-2">
              <a className="btn btn-primary" href={campoAppUrl}>
                Ir a App Campo
              </a>
              <button className="btn btn-outline-secondary" onClick={handleLogout}>
                Cerrar sesion
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`d-flex ${bgMain}`} style={{ height: "100vh", overflow: "hidden" }}>
      
      <Sidebar 
        setMostrarRegistro={setMostrarRegistro} mostrarRegistro={mostrarRegistro} usuarioSeleccionado={usuarioSeleccionado}
        setMostrarModalPago={setMostrarModalPago} setMostrarModalCierre={setMostrarModalCierre}
        setMostrarModalAuditoria={setMostrarModalAuditoria} setMostrarModalUsuarios={setMostrarModalUsuarios}
        usuarioActivo={usuarioSistema} onLogout={handleLogout}
        darkMode={darkMode} setDarkMode={setDarkMode}
        descargarPadron={descargarPadron}
        setMostrarModalMasivo={setMostrarModalMasivo}
        setMostrarImportar={setMostrarImportar}
        setMostrarModalExportaciones={setMostrarModalExportaciones}
        setMostrarModalCampo={setMostrarModalCampo}
        permisos={permisos}
        resumenPendientesCaja={resumenPendientesCaja}
      />
      
      <div className={`flex-grow-1 d-flex flex-column ${bgMain}`} style={{ overflow: "hidden" }}>
        <header className="bg-primary text-white p-3 shadow-sm flex-shrink-0 d-flex justify-content-between align-items-center">
          <h5 className="m-0">Area de Administracion Tributaria - Agua</h5>
          <span className={`badge ${realtimeBadge.className}`}>{realtimeBadge.label}</span>
        </header>

        {/* CAMBIO: Se pasa darkMode a RegistroForm */}
        {mostrarRegistro && permisos.canManageContribuyentes ? (
          <div className="p-4 overflow-auto"><RegistroForm onGuardar={() => { recargarTodo(); setMostrarRegistro(false); }} darkMode={darkMode} canDeleteCalles={permisos.canDeleteCalles} /></div>
        ) : (
          <div className="d-flex flex-column flex-grow-1" style={{ overflow: "hidden" }} onClick={handleBackgroundClick}>
            
            <div className="mx-3 mt-3 flex-shrink-0">
              <Toolbar 
                busqueda={busqueda} setBusqueda={setBusqueda} 
                usuarioSeleccionado={usuarioSeleccionado} 
                setMostrarModalDeuda={setMostrarModalDeuda} 
                setMostrarModalEliminar={setMostrarModalEliminar} 
                setMostrarModalEditarUsuario={setMostrarModalEditarUsuario} 
                eliminarUsuarioCompleto={eliminarUsuarioCompleto} 
                handlePrintCortes={abrirModalReporteCortes} 
                abrirModalActaCorte={abrirModalActaCorte}
                generandoActaCorte={generandoActaCorte}
                darkMode={darkMode} 
                setMostrarModalMasivo={setMostrarModalMasivo}
                selectedIds={selectedIds}
                setMostrarModalDeudaMasiva={setMostrarModalDeudaMasiva}
                permisos={permisos}
                filtroEstadoConexion={filtroEstadoConexion}
                setFiltroEstadoConexion={setFiltroEstadoConexion}
                aplicarCorteSeleccionado={aplicarCorteSeleccionado}
                reconectarSeleccionado={reconectarSeleccionado}
              />
            </div>
            
            <div className="mx-3 my-3 flex-shrink-0"><DashboardStats triggerUpdate={refreshDashboard} darkMode={darkMode} /></div>
            
            {/* TABLA PRINCIPAL */}
            <div className={`flex-grow-1 mx-3 mb-3 shadow-sm d-flex flex-column ${bgCard}`} style={{ flexBasis: "45%", overflow: "hidden", ...cardStyle }}>
              <div className="bg-dark text-white p-2 small fw-bold flex-shrink-0 d-flex justify-content-between align-items-center">
                <span>RELACION DE CONTRIBUYENTES</span>
                <div className="d-flex align-items-center gap-3">
                  <span className="text-warning fw-normal">* no verificado en campo</span>
                  <span className="text-info fw-normal">* deuda/abono incluye orden pendiente de caja</span>
                </div>
              </div>
              <div
                className="flex-grow-1 table-responsive"
                style={{ overflowY: "auto", userSelect: "none" }}
                onWheel={handleTableWheel}
                onScroll={handleTableScroll}
                onMouseMove={handleTableMouseMove}
                onMouseLeave={handleTableMouseLeave}
                ref={tableScrollRef}
              >
                <table className={tableClass}>
                  <thead>
                    <tr> 
                      <ThOrdenable label="Codigo" campo="codigo_municipal" />
                      <ThOrdenable label="Nombre" campo="nombre_completo" />
                      <ThOrdenable label="Direccion" campo="direccion_completa" />
                      <ThOrdenable label="Estado Conexion" campo="estado_conexion" />
                      <ThOrdenable label="Meses Deuda" campo="meses_deuda" />
                      <ThOrdenable label="Deuda Total" campo="deuda_anio" />
                      <ThOrdenable label="Abono Total" campo="abono_anio" />
                    </tr>
                  </thead>
                  <tbody>
                    {datosProcesados.length === 0 ? (
                      <tr><td colSpan="7" className="text-center p-3 opacity-50">No se encontraron resultados</td></tr>
                    ) : (
                      <>
                        {virtualRange.topSpacerHeight > 0 && (
                          <tr>
                            <td colSpan="7" style={{ height: virtualRange.topSpacerHeight, padding: 0, border: "none" }}></td>
                          </tr>
                        )}
                        {visibleContribuyentes.map((c) => (
                          <ContribuyenteRow
                            key={c.id_contribuyente}
                            c={c}
                            className={getRowClass(c)}
                            onMouseDown={handleRowMouseDown}
                            onClick={handleRowClick}
                            rowHeight={rowHeight}
                          />
                        ))}
                        {virtualRange.bottomSpacerHeight > 0 && (
                          <tr>
                            <td colSpan="7" style={{ height: virtualRange.bottomSpacerHeight, padding: 0, border: "none" }}></td>
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* TABLA HISTORIAL */}
            <div className={`flex-grow-1 mx-3 mb-3 shadow-sm d-flex flex-column ${bgCard}`} style={{ flexBasis: "50%", borderTop: "4px solid #0d6efd", overflow: "hidden", ...cardStyle }} onClick={(e) => e.stopPropagation()}>
              <div className="bg-secondary text-white p-2 small fw-bold flex-shrink-0 d-flex justify-content-between align-items-center">
                  <span>ARBITRIOS MUNICIPALES - DETALLE {historialYear === "all" ? "TODOS" : historialYear}</span>
                  <div className="d-flex align-items-center gap-2">
                    <select
                      className={`form-select form-select-sm ${darkMode ? "bg-dark text-white border-secondary" : ""}`}
                      style={{ width: "110px" }}
                      value={historialYear}
                      onChange={handleHistorialYearChange}
                      disabled={!usuarioSeleccionado}
                    >
                      <option value="all">Todos</option>
                      {yearsForSelect.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                    <span>{usuarioSeleccionado?.nombre_completo}</span>
                  </div>
              </div>
              <div className="flex-grow-1 table-responsive" style={{ overflowY: "auto" }}>
                <table className={tableClass}>
                  <thead className="text-center sticky-top" style={{ top: "0", zIndex: 5 }}>
                    {/* CAMBIO: Encabezados con la nueva paleta oscura (#343a40) y borde correcto */}
                    <tr>
                        {["Mes", "Agua", "Desague", "Limpieza", "Admin"].map(title => (
                            <th key={title} style={{backgroundColor: darkMode ? "#343a40" : "#e2e3e5", color: darkMode ? "#fff" : "#000", boxShadow: `inset 0 -1px 0 ${darkMode ? "#495057" : "#dee2e6"}`}}>{title}</th>
                        ))}
                        <th className={`text-danger`} style={{backgroundColor: darkMode ? "#343a40" : "#e2e3e5", boxShadow: `inset 0 -1px 0 ${darkMode ? "#495057" : "#dee2e6"}`}}>Deuda</th>
                        <th className={`text-success`} style={{backgroundColor: darkMode ? "#343a40" : "#e2e3e5", boxShadow: `inset 0 -1px 0 ${darkMode ? "#495057" : "#dee2e6"}`}}>Abono</th>
                    </tr>
                  </thead>
                  <tbody className="text-center">
                    {historialBodyRows}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CAMBIO: Se pasa el prop darkMode a TODOS los modales */}
      {mostrarModalDeuda && usuarioSeleccionado && (<ModalDeuda usuario={usuarioSeleccionado} cerrarModal={() => setMostrarModalDeuda(false)} alGuardar={recargarTodo} darkMode={darkMode} />)}
      {mostrarModalPago && usuarioSeleccionado && (
        <ModalPago
          usuario={{...usuarioSeleccionado, recibos: historial}} // Pasamos el historial actual como recibos
          usuarioSistema={usuarioSistema}
          cerrarModal={() => setMostrarModalPago(false)}
          alGuardar={recargarTodo}
          darkMode={darkMode}
          realtimeConnected={realtimeStatus === "connected"}
          realtimeTick={realtimeTick}
          onImprimirRecibo={(datos) => setDatosReciboImprimir(datos)}
        />
      )}
      {mostrarModalEliminar && usuarioSeleccionado && (<ModalEliminar usuario={usuarioSeleccionado} cerrarModal={() => setMostrarModalEliminar(false)} alGuardar={recargarTodo} darkMode={darkMode} />)}
      {mostrarModalCierre && (<ModalCierre cerrarModal={() => setMostrarModalCierre(false)} darkMode={darkMode} />)}
      {mostrarModalEditarUsuario && usuarioSeleccionado && (<ModalEditarUsuario usuario={usuarioSeleccionado} cerrarModal={() => setMostrarModalEditarUsuario(false)} alGuardar={recargarTodo} darkMode={darkMode} />)}
      {mostrarModalAuditoria && (<ModalAuditoria cerrarModal={() => setMostrarModalAuditoria(false)} darkMode={darkMode} />)}
      {mostrarModalUsuarios && (<ModalUsuarios cerrarModal={() => setMostrarModalUsuarios(false)} usuarioActivo={usuarioSistema} darkMode={darkMode} />)}
      {mostrarModalCampo && (
        <ModalCampoSolicitudes
          cerrarModal={() => setMostrarModalCampo(false)}
          darkMode={darkMode}
          onAplicado={recargarTodo}
          campoAppUrl={campoAppUrl}
        />
      )}
      {mostrarModalReporteCortes && (
        <ModalReporteCortes
          cerrarModal={() => setMostrarModalReporteCortes(false)}
          contribuyentes={contribuyentes}
          selectedIds={Array.from(selectedIds)}
          onImprimir={(payload) => {
            setDatosCortesImprimir(payload);
            setMostrarModalReporteCortes(false);
          }}
          darkMode={darkMode}
        />
      )}
      {mostrarModalActaCorte && (
        <ModalActaCorteSelector
          cerrarModal={() => setMostrarModalActaCorte(false)}
          contribuyentes={contribuyentes}
          selectedIds={Array.from(selectedIds)}
          loading={generandoActaCorte}
          onConfirmar={(ids) => {
            setMostrarModalActaCorte(false);
            imprimirActaCorte(ids);
          }}
          darkMode={darkMode}
        />
      )}
      {mostrarModalExportaciones && (
        <ModalExportaciones
          cerrarModal={() => setMostrarModalExportaciones(false)}
          darkMode={darkMode}
          onBackup={descargarBackup}
        />
      )}
      
      {/* Modales Masivos */}
      {mostrarModalMasivo && (<ModalImpresionMasiva cerrarModal={() => setMostrarModalMasivo(false)} alConfirmar={(datos) => {setDatosMasivos(datos);}} idsSeleccionados={Array.from(selectedIds)} darkMode={darkMode} />)}
      {mostrarImportar && (<ModalImportar cerrarModal={() => setMostrarImportar(false)} alTerminar={recargarTodo} darkMode={darkMode} />)}
      {mostrarModalDeudaMasiva && (
        <ModalDeudaMasiva 
            cerrarModal={() => setMostrarModalDeudaMasiva(false)} 
            alGuardar={recargarTodo} 
            idsSeleccionados={Array.from(selectedIds)} 
            darkMode={darkMode}
        />
      )}

      {/* OCULTOS PARA IMPRESION */}
      <div style={{ position: "fixed", left: "-10000px", top: "0", width: "148mm", height: "auto" }}>
          <Recibo ref={componentRef} datos={datosReciboImprimir} />
      </div>

      <div style={{ position: "absolute", width: "0px", height: "0px", overflow: "hidden" }}>
          <ReporteCortes ref={cortesRef} contribuyentes={contribuyentes} datos={datosCortesImprimir} />
      </div>

      <div style={{ position: "fixed", left: "-10000px", top: "0", width: "210mm", minHeight: "297mm", background: "#fff" }}>
          <ActasCorteLote ref={actaCorteRef} actas={datosActaCorteImprimir} />
      </div>

      <div style={{ position: "fixed", left: "-10000px", top: "0", width: "148mm", height: "auto" }}>
          <RecibosMasivos ref={masivoRef} datos={datosMasivos} />
      </div>
    </div>
  );
}

export default App;
