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
import ReciboAnexoCaja from "./components/ReciboAnexoCaja";
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
import ModalCorteConexion from "./components/ModalCorteConexion";
import { buildReporteEstadoConexionPdf } from "./utils/simplePdf";

const ROLE_ORDER = {
  BRIGADA: 1,
  CONSULTA: 2,
  CAJERO: 3,
  ADMIN_SEC: 4,
  ADMIN: 5
};

const ROLE_LABELS = {
  ADMIN: "Nivel 1 - Admin principal",
  ADMIN_SEC: "Nivel 2 - Ventanilla",
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
  CORTADO: "Cortado"
};

const MONTH_LABELS = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const SHOW_LEGACY_CAJA_MENU = false;
const HISTORIAL_CACHE_VERSION = "futuros-v3";
const HISTORIAL_ROW_COLORS = {
  idle: "transparent",
  deuda: "#f7cfd4",
  pagado: "#cfeedd"
};
const HISTORIAL_ROW_STYLES = {
  idle: { backgroundColor: "transparent", "--bs-table-bg": "transparent" },
  deuda: { backgroundColor: HISTORIAL_ROW_COLORS.deuda, "--bs-table-bg": HISTORIAL_ROW_COLORS.deuda },
  pagado: { backgroundColor: HISTORIAL_ROW_COLORS.pagado, "--bs-table-bg": HISTORIAL_ROW_COLORS.pagado }
};
const getLocalCampoAppUrl = () => `${API_BASE_URL}/campo-app/`;
const normalizeCampoAppUrl = (value) => {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  if (/\/campo-app\/?$/i.test(raw)) return `${raw.replace(/\/+$/g, "")}/`;
  return `${raw.replace(/\/+$/g, "")}/campo-app/`;
};
const normalizeSearchText = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

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

const getHistorialRowTone = ({ deuda, abono } = {}) => {
  const deudaNum = Number.parseFloat(deuda) || 0;
  const abonoNum = Number.parseFloat(abono) || 0;
  if (deudaNum > 0) return "deuda";
  if (abonoNum > 0) return "pagado";
  return "idle";
};

// Iconos
import { 
  FaUserPlus, FaMoneyBillWave, FaFileInvoiceDollar, 
  FaPrint, FaTrashAlt, FaSearch, FaUserEdit, FaUserTimes, 
  FaSort, FaCut, FaShieldAlt, FaFileExcel, FaSignOutAlt, 
  FaUserShield, FaDatabase, FaPlug, FaLink, FaSyncAlt,
  FaCloudUploadAlt, FaClipboardCheck
} from "react-icons/fa";

// --- SE ELIMINO EL TRUCO CSS GLOBAL ---

// --- SIDEBAR (Menu Lateral) ---
const Sidebar = memo(({ 
  setMostrarRegistro, mostrarRegistro, usuarioSeleccionado, 
  setMostrarModalPago, setMostrarModalCierre, setMostrarModalAuditoria, 
  setMostrarModalUsuarios, 
  usuarioActivo, onLogout, 
  darkMode, descargarPadron,
  setMostrarImportar,
  setMostrarModalExportaciones,
  setMostrarModalCampo,
  abrirModalImpresionMensual,
  abrirModalReimpresion,
  permisos,
  resumenPendientesCaja,
  resumenConteoEfectivo,
  onRegistrarConteoEfectivo,
  showLegacyCajaMenu
}) => {
  const isSoloCobrosCajero = permisos.role === "CAJERO";
  const showReportesSection = !isSoloCobrosCajero && (
    permisos.canReportesCaja
    || permisos.canExportPadron
    || permisos.canImpresionMensual
    || permisos.canReimpresionRecibo
  );
  const showConteoYCierreMenu = false;

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

      {showLegacyCajaMenu && permisos.canCaja && (
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
          {showConteoYCierreMenu && permisos.canConteoEfectivo && (
            <li>
              <button className="nav-link py-2 text-white w-100 text-start d-flex align-items-center gap-2" onClick={onRegistrarConteoEfectivo}>
                <FaMoneyBillWave/> <span>Conteo y cierre</span>
                {Number(resumenConteoEfectivo?.total_pendientes_hoy || 0) > 0 && (
                  <span className="badge bg-warning text-dark ms-auto">{Number(resumenConteoEfectivo?.total_pendientes_hoy || 0)}</span>
                )}
              </button>
              {Number(resumenConteoEfectivo?.total_pendientes_hoy || 0) > 0 && (
                <div className="small text-info mt-1 ms-4">
                  Declarado hoy: S/. {Number(resumenConteoEfectivo?.monto_pendiente_hoy || 0).toFixed(2)}
                </div>
              )}
            </li>
          )}
        </>
      )}

      {showReportesSection && (
        <>
          <li className="nav-item mt-2 text-white-50 text-uppercase small fw-bold">Reportes</li>
          {permisos.canReportesCaja && (
            <li>
              <button className="nav-link py-2 text-white w-100 text-start d-flex align-items-center gap-2" onClick={() => setMostrarModalCierre(true)}>
                <FaFileInvoiceDollar/> <span>Ver Cobranzas (F9)</span>
              </button>
            </li>
          )}
          {permisos.canExportPadron && (
            <li>
              <button className="nav-link py-2 text-success w-100 text-start d-flex align-items-center gap-2" onClick={descargarPadron}>
                <FaFileExcel/> <span>Descargar Excel</span>
              </button>
            </li>
          )}
          {permisos.canImpresionMensual && (
            <li>
              <button className="nav-link py-2 text-white w-100 text-start d-flex align-items-center gap-2" onClick={abrirModalImpresionMensual}>
                <FaPrint/> <span>Impresion Mensual</span>
              </button>
            </li>
          )}
          {permisos.canReimpresionRecibo && (
            <li>
              <button className="nav-link py-2 text-warning w-100 text-start d-flex align-items-center gap-2" onClick={abrirModalReimpresion}>
                <FaPrint/> <span>Reimpresion Recibo</span>
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
  abrirModalActaCorte, generandoActaCorte, darkMode,
  selectedIds, setMostrarModalDeudaMasiva, permisos, filtroEstadoConexion, setFiltroEstadoConexion,
  abrirModalCorteConexion, registrandoCorteConexion, reconectarSeleccionado, abrirReporteEstadoConexion
}) => {
  const usuarioConConexion = normalizeEstadoConexion(usuarioSeleccionado?.estado_conexion) === ESTADOS_CONEXION.CON_CONEXION;
  const estadoSeleccionado = normalizeEstadoConexion(usuarioSeleccionado?.estado_conexion);
  const puedeReconectar = Boolean(usuarioSeleccionado)
    && (estadoSeleccionado === ESTADOS_CONEXION.SIN_CONEXION || estadoSeleccionado === ESTADOS_CONEXION.CORTADO);
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
            <button className="btn btn-outline-danger btn-sm shadow-sm d-flex align-items-center justify-content-center" disabled={registrandoCorteConexion} onClick={abrirModalCorteConexion} title="Registrar Corte con Evidencia"><FaPlug/></button>
            <button className="btn btn-outline-success btn-sm shadow-sm d-flex align-items-center justify-content-center" disabled={!puedeReconectar} onClick={reconectarSeleccionado} title="Reconectar Servicio"><FaLink/></button>
          </>
        )}
        {permisos.canGenerarActaCorte && (
          <button className="btn btn-warning btn-sm shadow-sm d-flex align-items-center justify-content-center" disabled={generandoActaCorte} onClick={abrirModalActaCorte} title="Acta de Corte"><FaFileInvoiceDollar/></button>
        )}
        {permisos.canReporteCortes && (
          <div className="btn-group shadow-sm">
            <button className="btn btn-danger btn-sm d-flex align-items-center justify-content-center" onClick={() => abrirReporteEstadoConexion(ESTADOS_CONEXION.CORTADO)} title="Reporte Cortados"><FaCut/></button>
            <button className="btn btn-success btn-sm d-flex align-items-center justify-content-center" onClick={() => abrirReporteEstadoConexion(ESTADOS_CONEXION.CON_CONEXION)} title="Reporte Con Conexion"><FaPlug/></button>
            <button className="btn btn-secondary btn-sm d-flex align-items-center justify-content-center" onClick={() => abrirReporteEstadoConexion(ESTADOS_CONEXION.SIN_CONEXION)} title="Reporte Sin Conexion"><FaLink/></button>
          </div>
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

const AGUA_TOKEN_KEY = "token_agua";
const LEGACY_TOKEN_KEY = "token";

const readStoredUser = () => {
  const token = localStorage.getItem(AGUA_TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
  if (!token) return null;
  if (!localStorage.getItem(AGUA_TOKEN_KEY) && token) {
    localStorage.setItem(AGUA_TOKEN_KEY, token);
  }
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    localStorage.removeItem(AGUA_TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    return null;
  }
  return {
    id_usuario: payload.id_usuario,
    username: payload.username,
    nombre: payload.nombre,
    rol: normalizeRole(payload.rol)
  };
};

const ContribuyenteRow = memo(({ c, className, onMouseDown, onClick, onDoubleClick, rowHeight }) => (
  <tr
    data-id={c.id_contribuyente}
    onMouseDown={onMouseDown}
    onClick={onClick}
    onDoubleClick={onDoubleClick}
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

const ModalArbitriosDetalle = ({
  cerrarModal,
  darkMode,
  usuarioSeleccionado,
  historialYear,
  yearsForSelect,
  onYearChange,
  historialBodyRows,
  onExportarExcel,
  exportandoExcel
}) => (
  <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
    <div className="modal-dialog modal-xl modal-dialog-scrollable">
      <div className="modal-content">
        <div className={`modal-header ${darkMode ? "bg-dark text-white" : "bg-primary text-white"}`}>
          <h5 className="modal-title">Arbitrios municipales - detalle</h5>
          <button type="button" className={`btn-close ${darkMode ? "btn-close-white" : ""}`} onClick={cerrarModal}></button>
        </div>
        <div className="modal-body">
          <div className="d-flex justify-content-between align-items-center mb-3 no-print">
            <div className="fw-semibold">{usuarioSeleccionado?.nombre_completo || "-"}</div>
            <div className="d-flex gap-2 align-items-center">
              <select
                className={`form-select form-select-sm ${darkMode ? "bg-dark text-white border-secondary" : ""}`}
                style={{ width: "110px" }}
                value={historialYear}
                onChange={onYearChange}
              >
                <option value="all">Año</option>
                {yearsForSelect.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button type="button" className="btn btn-outline-success btn-sm" onClick={onExportarExcel} disabled={exportandoExcel}>
                <FaPrint className="me-1" />
                {exportandoExcel ? "Exportando..." : "Exportar Excel"}
              </button>
            </div>
          </div>
          <div>
            <div className="text-center mb-2">
              <div className="fw-bold">REPORTE DE ARBITRIOS MUNICIPALES</div>
              <div className="small">
                {historialYear === "all" ? "Todos los años" : `Año ${historialYear}`} - {usuarioSeleccionado?.nombre_completo || "-"}
              </div>
            </div>
            <div className="d-flex flex-wrap justify-content-center gap-2 small mb-3">
              <span className="badge border text-body-secondary" style={HISTORIAL_ROW_STYLES.deuda}>Mes con deuda</span>
              <span className="badge border text-body-secondary" style={HISTORIAL_ROW_STYLES.pagado}>Mes pagado</span>
            </div>
            <div className="table-responsive border rounded">
              <table className={`table table-sm table-bordered mb-0 ${darkMode ? "table-dark" : ""}`}>
                <thead className="text-center">
                  <tr>
                    {["Mes", "Agua", "Desague", "Limpieza", "Admin", "Extra"].map((title) => (
                      <th key={title}>{title}</th>
                    ))}
                    <th className="text-danger">Deuda</th>
                    <th className="text-success">Abono</th>
                  </tr>
                </thead>
                <tbody className="text-center">
                  {historialBodyRows}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const areSetsEqual = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
};

function AguaApp({ onBackToSelector = null }) {
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
  const [modalImpresionModo, setModalImpresionModo] = useState("mensual");
  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [mostrarModalDeudaMasiva, setMostrarModalDeudaMasiva] = useState(false);
  const [mostrarModalExportaciones, setMostrarModalExportaciones] = useState(false);
  const [mostrarModalCampo, setMostrarModalCampo] = useState(false);
  const [mostrarModalArbitrios, setMostrarModalArbitrios] = useState(false);
  const [exportandoArbitriosExcel, setExportandoArbitriosExcel] = useState(false);
  const [generandoActaCorte, setGenerandoActaCorte] = useState(false);
  const [mostrarModalReporteCortes, setMostrarModalReporteCortes] = useState(false);
  const [mostrarModalActaCorte, setMostrarModalActaCorte] = useState(false);
  const [mostrarModalCorteConexion, setMostrarModalCorteConexion] = useState(false);
  const [registrandoCorteConexion, setRegistrandoCorteConexion] = useState(false);
  const [reporteEstadoConexion, setReporteEstadoConexion] = useState(ESTADOS_CONEXION.CORTADO);
  const freezeContribuyenteRefresh =
    mostrarModalEditarUsuario
    || mostrarModalDeuda
    || mostrarModalEliminar
    || mostrarModalArbitrios
    || mostrarModalCorteConexion
    || mostrarModalReporteCortes
    || mostrarModalActaCorte
    || generandoActaCorte
    || registrandoCorteConexion;
  
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

  const darkMode = false;
  const [refreshDashboard, setRefreshDashboard] = useState(0);
  const [resumenPendientesCaja, setResumenPendientesCaja] = useState({
    total_ordenes: 0,
    total_monto: 0,
    total_contribuyentes: 0
  });
  const [resumenConteoEfectivo, setResumenConteoEfectivo] = useState({
    fecha_referencia: "",
    total_pendientes: 0,
    total_pendientes_hoy: 0,
    monto_pendiente_hoy: 0,
    ultimo_pendiente: null
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
    canConteoEfectivo: rolActual === "ADMIN" || rolActual === "CAJERO",
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
    canImpresionMensual: hasMinRole(rolActual, "ADMIN"),
    canReimpresionRecibo: hasMinRole(rolActual, "ADMIN_SEC"),
    canReporteCortes: hasMinRole(rolActual, "ADMIN_SEC"),
    canGestionCampo: hasMinRole(rolActual, "ADMIN")
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
      let admin = round2((Number(r.subtotal_admin || 0) + Number(r.subtotal_extra || 0)) * factor);
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

const reciboMasivoPageStyle = `
  @page {
    /* Recibos masivos en horizontal. */
    size: 203mm 145mm;
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

const reciboIndividualPageStyle = `
  @page {
    /* Recibo principal en horizontal. */
    size: 203mm 145mm;
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
    margin: 4mm;
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

const anexoCajaPageStyle = `
  @page {
    /* Anexo en vertical. */
    size: A4 portrait;
    margin: 0;
  }
  @media print {
    html, body {
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      background: #fff !important;
    }
  }
`;

  const handlePrintMasivo = useReactToPrint({
    contentRef: masivoRef,
    documentTitle: 'Recibos_Masivos',
    pageStyle: reciboMasivoPageStyle,
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
  const anexoCajaRef = useRef(null);
  const isPrintingReciboRef = useRef(false);
  const isPrintingAnexoCajaRef = useRef(false);
  const cortesRef = useRef(null);
  const actaCorteRef = useRef(null);
  const [datosReciboImprimir, setDatosReciboImprimir] = useState(null);
  const [datosAnexoCajaImprimir, setDatosAnexoCajaImprimir] = useState(null);
  const [datosActaCorteImprimir, setDatosActaCorteImprimir] = useState([]);
  const [datosCortesImprimir, setDatosCortesImprimir] = useState(null);
  const [cortesDocumentTitle, setCortesDocumentTitle] = useState("Reporte_Estado_Conexion");
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
    documentTitle: cortesDocumentTitle,
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
    pageStyle: reciboIndividualPageStyle,
    onAfterPrint: () => {
      isPrintingReciboRef.current = false;
      setDatosReciboImprimir(null);
    }
  });
  const handlePrintAnexoCaja = useReactToPrint({
    contentRef: anexoCajaRef,
    documentTitle: "Anexo_Recibo_Agua",
    pageStyle: anexoCajaPageStyle,
    onAfterPrint: () => {
      isPrintingAnexoCajaRef.current = false;
      setDatosAnexoCajaImprimir(null);
    }
  });

  const abrirModalReporteCortes = (estadoObjetivo = ESTADOS_CONEXION.CORTADO) => {
    if (!permisos.canReporteCortes) {
      alert("Tu nivel no tiene permiso para reporte de cortes.");
      return;
    }
    setReporteEstadoConexion(estadoObjetivo);
    setMostrarModalReporteCortes(true);
  };

  const abrirModalImpresionMensual = () => {
    if (!permisos.canImpresionMensual) {
      alert("Solo el administrador puede usar la impresión mensual.");
      return;
    }
    setModalImpresionModo("mensual");
    setMostrarModalMasivo(true);
  };

  const abrirModalReimpresion = () => {
    if (!permisos.canReimpresionRecibo) {
      alert("Tu nivel no tiene permiso para reimpresión.");
      return;
    }
    if (!usuarioSeleccionado?.id_contribuyente) {
      alert("Seleccione un contribuyente para reimprimir recibos.");
      return;
    }
    setModalImpresionModo("reimpresion");
    setMostrarModalMasivo(true);
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
      const estado = normalizeEstadoConexion(c.estado_conexion);
      return meses >= 4 && estado === ESTADOS_CONEXION.CON_CONEXION;
    });

    if (objetivosConDeuda.length === 0) {
      return alert("Los contribuyentes seleccionados deben tener conexión activa y 4 o más meses de deuda.");
    }

    try {
      setGenerandoActaCorte(true);
      let generadas = [];
      let omitidas = [];
      try {
        const respuestaLote = await api.post("/actas-corte/generar-lote", {
          ids_contribuyentes: objetivosConDeuda
        });
        generadas = Array.isArray(respuestaLote?.data?.generadas) ? respuestaLote.data.generadas : [];
        omitidas = Array.isArray(respuestaLote?.data?.omitidas) ? respuestaLote.data.omitidas : [];
      } catch (errorLote) {
        const status = Number(errorLote?.response?.status || 0);
        const msg = String(errorLote?.response?.data?.error || "");
        const routeMissing = status === 404 || /ruta api no encontrada/i.test(msg);
        if (!routeMissing) throw errorLote;

        const resultados = await Promise.all(
          objetivosConDeuda.map(async (idContribuyente) => {
            try {
              const resActa = await api.post("/actas-corte/generar", {
                id_contribuyente: idContribuyente
              });
              return { ok: true, item: { ...(resActa?.data || {}), id_contribuyente: idContribuyente } };
            } catch (errItem) {
              return {
                ok: false,
                omitida: {
                  id_contribuyente: idContribuyente,
                  codigo_municipal: contribuyenteById.get(idContribuyente)?.codigo_municipal || "",
                  motivo: errItem?.response?.data?.error || "No se pudo generar acta."
                }
              };
            }
          })
        );
        generadas = resultados.filter((r) => r.ok).map((r) => r.item);
        omitidas = resultados.filter((r) => !r.ok).map((r) => r.omitida);
      }

      if (generadas.length === 0) {
        return alert("No se pudo generar ninguna acta para la seleccion.");
      }

      const obtenerHistorialConRetry = async (idContribuyente, intentos = 2) => {
        for (let intento = 1; intento <= intentos; intento += 1) {
          try {
            const res = await api.get(`/recibos/historial/${Number(idContribuyente)}?anio=all`);
            return res;
          } catch {
            if (intento >= intentos) return null;
            await new Promise((resolve) => setTimeout(resolve, 180));
          }
        }
        return null;
      };

      // Siempre cargamos detalle real para evitar actas "resumidas" sin desglose.
      const historiales = [];
      const concurrencia = 8;
      for (let i = 0; i < generadas.length; i += concurrencia) {
        const bloque = generadas.slice(i, i + concurrencia);
        const respuestas = await Promise.all(
          bloque.map((item) => obtenerHistorialConRetry(item.id_contribuyente, 2))
        );
        historiales.push(...respuestas);
      }

      const actasGeneradas = generadas.map((item, idx) => {
        const idContribuyente = Number(item.id_contribuyente);
        const base = contribuyenteById.get(idContribuyente) || {};
        const historialRows = Array.isArray(historiales[idx]?.data)
          ? historiales[idx].data
          : [];
        const deudaFallback = parseFloat(item.deuda_total ?? base.deuda_anio ?? 0) || 0;
        return {
          numero_acta: item.numero_acta || "",
          fecha_emision: item.fecha_emision || new Date().toISOString(),
          usuario_notificador: usuarioSistema?.nombre || "",
          detalle_deuda: construirDetalleDeudaActa(historialRows, deudaFallback),
          contribuyente: {
            codigo_municipal: base.codigo_municipal || item.codigo_municipal || "",
            nombre_completo: base.nombre_completo || "",
            dni_ruc: base.dni_ruc || "",
            direccion_completa: base.direccion_completa || "",
            meses_deuda: Number(item.meses_deuda ?? base.meses_deuda ?? 0),
            deuda_total: deudaFallback
          }
        };
      });

      if (actasGeneradas.length === 0) {
        return alert("No se pudo generar ninguna acta para la seleccion.");
      }

      setDatosActaCorteImprimir(actasGeneradas);
      if (omitidas.length > 0) {
        const codigos = omitidas
          .map((x) => String(x.codigo_municipal || x.id_contribuyente || "").trim())
          .filter(Boolean)
          .slice(0, 30);
        alert(`Se generaron ${actasGeneradas.length} acta(s). Omitidos: ${codigos.join(", ")}${omitidas.length > 30 ? "..." : ""}`);
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
    if (!datosAnexoCajaImprimir) return;
    if (isPrintingAnexoCajaRef.current) return;
    isPrintingAnexoCajaRef.current = true;
    const raf = requestAnimationFrame(() => {
      if (anexoCajaRef.current) {
        handlePrintAnexoCaja();
      } else {
        isPrintingAnexoCajaRef.current = false;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [datosAnexoCajaImprimir, handlePrintAnexoCaja]);

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
  const cargarResumenPendientesCaja = useCallback(async () => {
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
  }, []);
  const cargarResumenConteoEfectivo = useCallback(async () => {
    try {
      const res = await api.get("/caja/conteo-efectivo/resumen");
      const data = res?.data || {};
      setResumenConteoEfectivo({
        fecha_referencia: data.fecha_referencia || "",
        total_pendientes: Number(data.total_pendientes || 0),
        total_pendientes_hoy: Number(data.total_pendientes_hoy || 0),
        monto_pendiente_hoy: Number(data.monto_pendiente_hoy || 0),
        ultimo_pendiente: data.ultimo_pendiente || null
      });
    } catch {
      setResumenConteoEfectivo({
        fecha_referencia: "",
        total_pendientes: 0,
        total_pendientes_hoy: 0,
        monto_pendiente_hoy: 0,
        ultimo_pendiente: null
      });
    }
  }, []);
  const cargarHistorial = async (id_contribuyente, anio = historialYear, force = false) => {
    const cacheKey = `${HISTORIAL_CACHE_VERSION}:${id_contribuyente}:${anio}`;
    if (!force && historialCacheRef.current.has(cacheKey)) {
      const cached = historialCacheRef.current.get(cacheKey);
      setHistorial(cached.rows);
      if (anio === "all") setHistorialYears(cached.years);
      return;
    }
    try {
      const res = await api.get(`/recibos/historial/${id_contribuyente}`, {
        params: {
          anio,
          incluir_futuros: "S"
        }
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      setHistorial(rows);
      if (anio === "all") {
        const years = Array.from(new Set(rows.map((r) => Number(r.anio)).filter(Boolean))).sort((a, b) => b - a);
        setHistorialYears(years);
        historialCacheRef.current.set(cacheKey, { rows, years });
      } else {
        historialCacheRef.current.set(cacheKey, { rows, years: [] });
      }
    } catch {
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
        subtotal_extra: 0,
        deuda_mes: 0,
        abono_mes: 0,
        has_future_charge: false
      };
      const estadoRow = String(r.estado || "").trim().toUpperCase();
      current.subtotal_agua += parseFloat(r.subtotal_agua) || 0;
      current.subtotal_desague += parseFloat(r.subtotal_desague) || 0;
      current.subtotal_limpieza += parseFloat(r.subtotal_limpieza) || 0;
      current.subtotal_admin += parseFloat(r.subtotal_admin) || 0;
      current.subtotal_extra += parseFloat(r.subtotal_extra) || 0;
      current.deuda_mes += parseFloat(r.deuda_mes) || 0;
      current.abono_mes += parseFloat(r.abono_mes) || 0;
      current.has_future_charge = current.has_future_charge
        || Boolean(r.es_proyectado)
        || estadoRow === "PROYECTADO"
        || estadoRow === "NO_EXIGIBLE"
        || estadoRow === "ADELANTADO";
      dataMap.set(key, current);
    });

    let yearsToShow = [];
    if (historialYear === "all") {
      yearsToShow = historialYears.length > 0 ? [...historialYears].sort((a, b) => b - a) : [currentYear];
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
          subtotal_extra: 0,
          deuda_mes: 0,
          abono_mes: 0,
          has_future_charge: false
        };
        rows.push({ type: "month", ...data });
      }
    });
    return rows;
  }, [usuarioSeleccionado, historial, historialYear, historialYears, currentYear]);

  const yearsForSelect = useMemo(() => {
    if (historialYears.length > 0) return [...historialYears].sort((a, b) => b - a);
    return [currentYear];
  }, [historialYears, currentYear]);

  const historialBodyRows = useMemo(() => {
    if (!usuarioSeleccionado) {
      return <tr><td colSpan="8" className="p-3">Seleccione usuario arriba</td></tr>;
    }
    if (historialTabla.length === 0) {
      return <tr><td colSpan="8" className="p-3">Sin movimientos</td></tr>;
    }
    return historialTabla.map((h, i) => {
      if (h.type === "year") {
        return (
          <tr key={`year-${h.anio}`}>
            <td colSpan="8" className={`text-start fw-bold ${darkMode ? "bg-dark text-white" : "bg-light"}`} style={{ paddingLeft: "12px" }}>
              Año {h.anio}
            </td>
          </tr>
        );
      }
      const rowTone = getHistorialRowTone({
        deuda: h.deuda_mes,
        abono: h.abono_mes
      });
      const rowStyle = darkMode && rowTone !== "idle"
        ? undefined
        : HISTORIAL_ROW_STYLES[rowTone];
      const deudaVisual = Number(h.deuda_mes || 0);
      const deudaClassName = "fw-bold text-danger";
      return (
        <tr
          key={`${h.anio}-${h.mes}-${i}`}
          className={darkMode && rowTone !== "idle"
            ? {
              deuda: "table-danger",
              pagado: "table-success"
            }[rowTone]
            : undefined}
          style={rowStyle}
        >
          <td className="fw-bold text-start ps-3">{MONTH_LABELS[h.mes] || "-"}</td>
          <td>{formatMonto(h.subtotal_agua)}</td>
          <td>{formatMonto(h.subtotal_desague)}</td>
          <td>{formatMonto(h.subtotal_limpieza)}</td>
          <td>{formatMonto(h.subtotal_admin)}</td>
          <td>{formatMonto(h.subtotal_extra)}</td>
          <td className={deudaClassName}>{formatMonto(deudaVisual)}</td>
          <td className="fw-bold text-success">{formatMonto(h.abono_mes)}</td>
        </tr>
      );
    });
  }, [usuarioSeleccionado, historialTabla, darkMode, formatMonto]);

  const recargarTodo = () => {
    historialCacheRef.current.clear();
    cargarContribuyentes();
    if (SHOW_LEGACY_CAJA_MENU && permisos.canCaja) cargarResumenPendientesCaja();
    if (permisos.canCaja) cargarResumenConteoEfectivo();
    if (usuarioSeleccionado) cargarHistorial(usuarioSeleccionado.id_contribuyente, "all", true);
    setRefreshDashboard(prev => prev + 1);
    setSelectedIds(new Set());
  };

  const registrarConteoEfectivoCaja = async () => {
    if (!permisos.canConteoEfectivo) return;
    const montoSugerido = Number(resumenConteoEfectivo?.ultimo_pendiente?.monto_efectivo || 0);
    const montoDefault = montoSugerido > 0 ? montoSugerido.toFixed(2) : "";
    const montoRaw = window.prompt("Ingrese el conteo de efectivo (S/.):", montoDefault);
    if (montoRaw === null) return;
    const monto = Number.parseFloat(String(montoRaw).replace(",", "."));
    if (!Number.isFinite(monto) || monto < 0) {
      alert("Ingrese un monto valido de efectivo.");
      return;
    }
    const observacionRaw = window.prompt("Observacion opcional del conteo:", "") || "";
    try {
      const res = await api.post("/caja/conteo-efectivo", {
        monto_efectivo: monto,
        observacion: observacionRaw,
        cerrar_caja: true
      });
      alert(res?.data?.mensaje || "Conteo de efectivo enviado.");
      await cargarResumenConteoEfectivo();
    } catch (error) {
      alert(error?.response?.data?.error || "No se pudo enviar el conteo de efectivo.");
    }
  };

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
      setResumenConteoEfectivo({
        fecha_referencia: "",
        total_pendientes: 0,
        total_pendientes_hoy: 0,
        monto_pendiente_hoy: 0,
        ultimo_pendiente: null
      });
      return undefined;
    }
    if (SHOW_LEGACY_CAJA_MENU) cargarResumenPendientesCaja();
    cargarResumenConteoEfectivo();
    return undefined;
  }, [usuarioSistema, permisos.canCaja, cargarResumenPendientesCaja, cargarResumenConteoEfectivo]);
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
    if (freezeContribuyenteRefresh) return;
    if (usuarioSeleccionado) {
      const usuarioActualizado = contribuyentes.find(c => c.id_contribuyente === usuarioSeleccionado.id_contribuyente);
      if (usuarioActualizado) setUsuarioSeleccionado(usuarioActualizado);
    }
  }, [contribuyentes, freezeContribuyenteRefresh, usuarioSeleccionado]);

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
      localStorage.removeItem(AGUA_TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      setUsuarioSistema(null);
      setUsuarioSeleccionado(null);
    }
  };

  const abrirModalCorteConexion = () => {
    if (!permisos.canCambiarEstadoConexion) {
      alert("Tu nivel no tiene permiso para cambiar estado de conexion.");
      return;
    }
    setMostrarModalCorteConexion(true);
  };

  const registrarCorteConEvidencia = async ({ id_contribuyente, motivo, evidencias }) => {
    if (!permisos.canCambiarEstadoConexion) return;
    const idContribuyente = Number(id_contribuyente);
    if (!Number.isInteger(idContribuyente) || idContribuyente <= 0) {
      alert("Seleccione un contribuyente válido.");
      return;
    }
    try {
      setRegistrandoCorteConexion(true);
      const formData = new FormData();
      formData.append("id_contribuyente", String(idContribuyente));
      formData.append("motivo", String(motivo || "").trim());
      (Array.isArray(evidencias) ? evidencias : []).forEach((file) => {
        formData.append("evidencias", file);
      });

      const res = await api.post("/contribuyentes/cortes/registrar", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      const fechaEvento = res?.data?.fecha_evento ? new Date(res.data.fecha_evento).toLocaleString() : null;
      const recalc = Number(res?.data?.recibos_recalculados || 0);
      const totalEvidencias = Number(res?.data?.evidencias?.length || 0);
      alert(`${res?.data?.mensaje || "Corte registrado."}${fechaEvento ? `\nFecha: ${fechaEvento}` : ""}\nEvidencias: ${totalEvidencias}\nRecibos futuros recalculados: ${recalc}`);
      setMostrarModalCorteConexion(false);
      recargarTodo();
    } catch (error) {
      alert(error?.response?.data?.error || "No se pudo registrar el corte.");
    } finally {
      setRegistrandoCorteConexion(false);
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
    if (estadoDestino === ESTADOS_CONEXION.CON_CONEXION && estadoActual === ESTADOS_CONEXION.CON_CONEXION) {
      alert("El contribuyente ya tiene conexion activa.");
      return;
    }

    const accion = estadoDestino === ESTADOS_CONEXION.CON_CONEXION ? "reconectar" : "actualizar estado";
    const motivoDefault = estadoDestino === ESTADOS_CONEXION.CON_CONEXION
      ? "Reconexion por regularizacion de pago."
      : "Actualizacion de estado desde oficina.";
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
      const recalc = Number(res?.data?.recibos_recalculados || 0);
      alert(`${res?.data?.mensaje || "Estado actualizado."}${fechaEvento ? `\nFecha: ${fechaEvento}` : ""}\nRecibos futuros recalculados: ${recalc}`);
      recargarTodo();
    } catch (error) {
      alert(error?.response?.data?.error || "No se pudo actualizar el estado de conexion.");
    }
  };

  const reconectarSeleccionado = () => cambiarEstadoConexionSeleccionado(ESTADOS_CONEXION.CON_CONEXION);

  const eliminarUsuarioCompleto = async () => {
    if(!usuarioSeleccionado) return;
    if (!permisos.canSuperAdmin) {
      alert("Solo Nivel 1 puede eliminar contribuyentes.");
      return;
    }
    if(!window.confirm(`PELIGRO: Eliminar a ${usuarioSeleccionado.nombre_completo}?`)) return;
    try {
      await api.delete(`/contribuyentes/${usuarioSeleccionado.id_contribuyente}`);
      alert("Usuario eliminado.");
      setUsuarioSeleccionado(null);
      recargarTodo();
    } catch (error) {
      alert(error?.response?.data?.error || "Error al eliminar.");
    }
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
      const nombreSearch = normalizeSearchText(c.nombre_completo || "");
      const codigoSearch = normalizeSearchText(c.codigo_municipal || "");
      const direccionSearch = normalizeSearchText(c.direccion_completa || "");
      const estadoSearch = normalizeSearchText(estadoLabel);
      return {
        ...c,
        _estadoNorm: estadoNorm,
        _nombreLc: nombreSearch,
        _codigoLc: codigoSearch,
        _direccionLc: direccionSearch,
        _estadoLabelLc: estadoSearch,
        _searchBlob: `${nombreSearch} ${codigoSearch} ${direccionSearch} ${estadoSearch}`.trim(),
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
    const needle = normalizeSearchText(busquedaDeferred);
    const terms = needle ? needle.split(" ").filter(Boolean) : [];
    const filtrados = contribuyentesIndexados.filter((c) => {
      if (filtroEstadoConexion !== "TODOS" && c._estadoNorm !== filtroEstadoConexion) {
        return false;
      }
      if (terms.length === 0) return true;
      const blob = c._searchBlob || "";
      return terms.every((term) => blob.includes(term));
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

  const handleRowDoubleClick = useCallback((e) => {
    e.stopPropagation();
    const id = Number(e.currentTarget.dataset.id);
    if (Number.isNaN(id)) return;
    const usuario = contribuyenteById.get(id);
    if (!usuario) return;
    setUsuarioSeleccionado(usuario);
    setHistorialYear("all");
    cargarHistorial(usuario.id_contribuyente, "all", true);
    setMostrarModalArbitrios(true);
  }, [contribuyenteById, cargarHistorial]);

  const exportarArbitriosExcel = useCallback(async () => {
    const idContribuyente = Number(usuarioSeleccionado?.id_contribuyente || 0);
    if (!idContribuyente) return;
    try {
      setExportandoArbitriosExcel(true);
      const res = await api.get(`/exportar/arbitrios/${idContribuyente}`, {
        params: {
          anio: historialYear,
          incluir_futuros: "S"
        },
        responseType: "blob",
        timeout: 0
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const codigo = String(usuarioSeleccionado?.codigo_municipal || `id_${idContribuyente}`).trim();
      const filtro = historialYear === "all" ? "todos" : historialYear;
      link.setAttribute("download", `arbitrios_${codigo}_${filtro}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(error?.response?.data?.error || "No se pudo exportar arbitrios.");
    } finally {
      setExportandoArbitriosExcel(false);
    }
  }, [historialYear, usuarioSeleccionado]);

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
  }, [isDragging, clearScrollSelect]);
  const handleSort = (columna) => { setOrden(prev => ({ columna, direccion: prev.columna === columna && prev.direccion === 'asc' ? 'desc' : 'asc' })); };
  
  const getRowClass = (c) => { 
      const meses = Number(c._mesesNum ?? c.meses_deuda ?? 0); 
      const estadoConexion = c._estadoNorm || normalizeEstadoConexion(c.estado_conexion);
      if (selectedIds.has(c.id_contribuyente)) return "table-active border border-primary border-2";
      if (usuarioSeleccionado?.id_contribuyente === c.id_contribuyente) return "table-primary border-primary"; 
      if (estadoConexion === ESTADOS_CONEXION.CORTADO) return "table-danger";
      if (estadoConexion === ESTADOS_CONEXION.SIN_CONEXION) return "table-secondary";
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
  const realtimeBadge = useMemo(() => ({ label: "Actualizacion: Manual", className: "bg-secondary" }), []);

  if (!usuarioSistema) {
    return (
      <LoginPage
        tokenStorageKey={AGUA_TOKEN_KEY}
        titulo="Sistema Agua Potable"
        subtitulo="Municipalidad Distrital de Pueblo Nuevo"
        onBackToSelector={onBackToSelector}
        onLoginSuccess={(datos) => {
          const { ...user } = datos || {};
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
        darkMode={darkMode}
        descargarPadron={descargarPadron}
        setMostrarImportar={setMostrarImportar}
        setMostrarModalExportaciones={setMostrarModalExportaciones}
        setMostrarModalCampo={setMostrarModalCampo}
        abrirModalImpresionMensual={abrirModalImpresionMensual}
        abrirModalReimpresion={abrirModalReimpresion}
        permisos={permisos}
        resumenPendientesCaja={resumenPendientesCaja}
        resumenConteoEfectivo={resumenConteoEfectivo}
        onRegistrarConteoEfectivo={registrarConteoEfectivoCaja}
        showLegacyCajaMenu={SHOW_LEGACY_CAJA_MENU}
      />
      
      <div className={`flex-grow-1 d-flex flex-column ${bgMain}`} style={{ overflow: "hidden" }}>
        <header className="bg-primary text-white p-3 shadow-sm flex-shrink-0 d-flex justify-content-between align-items-center">
          <h5 className="m-0">Area de Administracion Tributaria - Agua</h5>
          <div className="d-flex align-items-center gap-2">
            <span className={`badge ${realtimeBadge.className}`}>{realtimeBadge.label}</span>
            <button
              className="btn btn-sm btn-outline-light d-flex align-items-center gap-2"
              onClick={recargarTodo}
              title="Recargar manualmente"
            >
              <FaSyncAlt /> Recargar
            </button>
            {typeof onBackToSelector === "function" && (
              <button className="btn btn-sm btn-outline-light" onClick={onBackToSelector}>
                Cambiar modulo
              </button>
            )}
          </div>
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
                abrirModalActaCorte={abrirModalActaCorte}
                generandoActaCorte={generandoActaCorte}
                darkMode={darkMode} 
                selectedIds={selectedIds}
                setMostrarModalDeudaMasiva={setMostrarModalDeudaMasiva}
                permisos={permisos}
                filtroEstadoConexion={filtroEstadoConexion}
                setFiltroEstadoConexion={setFiltroEstadoConexion}
                abrirModalCorteConexion={abrirModalCorteConexion}
                registrandoCorteConexion={registrandoCorteConexion}
                reconectarSeleccionado={reconectarSeleccionado}
                abrirReporteEstadoConexion={abrirModalReporteCortes}
              />
            </div>
            
            <div className="mx-3 my-3 flex-shrink-0"><DashboardStats triggerUpdate={refreshDashboard} darkMode={darkMode} /></div>
            
            {/* TABLA PRINCIPAL */}
            <div className={`flex-grow-1 mx-3 mb-3 shadow-sm d-flex flex-column ${bgCard}`} style={{ flexBasis: "45%", overflow: "hidden", ...cardStyle }}>
              <div className="bg-dark text-white p-2 small fw-bold flex-shrink-0 d-flex justify-content-between align-items-center">
                <span>RELACION DE CONTRIBUYENTES</span>
                <div className="d-flex align-items-center gap-3">
                  <span className="text-warning fw-normal">* no verificado en campo</span>
                  <span className="text-info fw-normal">* deuda/abono actualizado con cobros directos de caja</span>
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
                            onDoubleClick={handleRowDoubleClick}
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

          </div>
        )}
      </div>

      {/* CAMBIO: Se pasa el prop darkMode a TODOS los modales */}
      {mostrarModalDeuda && usuarioSeleccionado && (<ModalDeuda usuario={usuarioSeleccionado} cerrarModal={() => setMostrarModalDeuda(false)} alGuardar={recargarTodo} darkMode={darkMode} />)}
      {SHOW_LEGACY_CAJA_MENU && mostrarModalPago && usuarioSeleccionado && (
        <ModalPago
          usuario={{...usuarioSeleccionado, recibos: historial}} // Pasamos el historial actual como recibos
          usuarioSistema={usuarioSistema}
          cerrarModal={() => setMostrarModalPago(false)}
          alGuardar={recargarTodo}
          darkMode={darkMode}
          onImprimirAnexo={(datos) => setDatosAnexoCajaImprimir(datos)}
        />
      )}
      {mostrarModalArbitrios && usuarioSeleccionado && (
        <ModalArbitriosDetalle
          cerrarModal={() => setMostrarModalArbitrios(false)}
          darkMode={darkMode}
          usuarioSeleccionado={usuarioSeleccionado}
          historialYear={historialYear}
          yearsForSelect={yearsForSelect}
          onYearChange={handleHistorialYearChange}
          historialBodyRows={historialBodyRows}
          onExportarExcel={exportarArbitriosExcel}
          exportandoExcel={exportandoArbitriosExcel}
        />
      )}
      {mostrarModalEliminar && usuarioSeleccionado && (<ModalEliminar usuario={usuarioSeleccionado} cerrarModal={() => setMostrarModalEliminar(false)} alGuardar={recargarTodo} darkMode={darkMode} />)}
      {mostrarModalCierre && (
        <ModalCierre
          cerrarModal={() => setMostrarModalCierre(false)}
          darkMode={darkMode}
          origen="ventanilla"
          usuarioSistema={usuarioSistema}
        />
      )}
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
      {mostrarModalCorteConexion && (
        <ModalCorteConexion
          cerrarModal={() => setMostrarModalCorteConexion(false)}
          contribuyentes={contribuyentes}
          loading={registrandoCorteConexion}
          onConfirmar={registrarCorteConEvidencia}
          darkMode={darkMode}
        />
      )}
      {mostrarModalReporteCortes && (
        <ModalReporteCortes
          cerrarModal={() => setMostrarModalReporteCortes(false)}
          contribuyentes={contribuyentes}
          selectedIds={Array.from(selectedIds)}
          onImprimir={(payload) => {
            const formato = String(payload?.formato || "print").toLowerCase();
            if (formato === "pdf") {
              try {
                const estadoTxt = String(payload?.criterio?.estado_objetivo || "ESTADO").toUpperCase();
                const fechaTag = new Date().toISOString().slice(0, 10);
                const fileName = `REPORTE_${estadoTxt}_PDF_${fechaTag}.pdf`;
                const blob = buildReporteEstadoConexionPdf(payload);
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.setAttribute("download", fileName);
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
              } catch (error) {
                console.error("Error al exportar PDF:", error);
                alert("No se pudo exportar el PDF.");
              } finally {
                setMostrarModalReporteCortes(false);
              }
              return;
            }
            const sufijo = "IMPRESION";
            const estadoTxt = String(payload?.criterio?.estado_objetivo || "ESTADO").toUpperCase();
            setCortesDocumentTitle(`REPORTE_${estadoTxt}_${sufijo}`);
            setDatosCortesImprimir(payload);
            setMostrarModalReporteCortes(false);
          }}
          estadoObjetivo={reporteEstadoConexion}
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
      {mostrarModalMasivo && (
        <ModalImpresionMasiva
          cerrarModal={() => setMostrarModalMasivo(false)}
          alConfirmar={(datos) => { setDatosMasivos(datos); }}
          idsSeleccionados={
            modalImpresionModo === "reimpresion"
              ? (usuarioSeleccionado?.id_contribuyente ? [Number(usuarioSeleccionado.id_contribuyente)] : [])
              : Array.from(selectedIds)
          }
          modoOperacion={modalImpresionModo}
          darkMode={darkMode}
        />
      )}
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
      <div style={{ position: "fixed", left: "-10000px", top: "0", width: "210mm", height: "auto", display: "flex", justifyContent: "flex-end", background: "#fff" }}>
          <Recibo ref={componentRef} datos={datosReciboImprimir} />
      </div>

      <div style={{ position: "fixed", left: "-10000px", top: "0", width: "210mm", height: "106mm", background: "#fff" }}>
          <ReciboAnexoCaja ref={anexoCajaRef} datos={datosAnexoCajaImprimir} />
      </div>

      <div style={{ position: "absolute", width: "0px", height: "0px", overflow: "hidden" }}>
          <ReporteCortes ref={cortesRef} contribuyentes={contribuyentes} datos={datosCortesImprimir} />
      </div>

      <div style={{ position: "fixed", left: "-10000px", top: "0", width: "210mm", minHeight: "297mm", background: "#fff" }}>
          <ActasCorteLote ref={actaCorteRef} actas={datosActaCorteImprimir} />
      </div>

      <div style={{ position: "fixed", left: "-10000px", top: "0", width: "210mm", height: "auto", display: "flex", justifyContent: "flex-end" }}>
          <RecibosMasivos ref={masivoRef} datos={datosMasivos} />
      </div>
    </div>
  );
}

export default AguaApp;
