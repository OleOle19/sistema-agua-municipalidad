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
import ModalAuditoria from "./components/ModalAuditoria";
import LoginPage from "./components/LoginPage";
import ModalUsuarios from "./components/ModalUsuarios";
import ModalIncidencias from "./components/ModalIncidencias";
import RecibosMasivos from "./components/RecibosMasivos";
import ModalImpresionMasiva from "./components/ModalImpresionMasiva";
import ModalImportar from "./components/ModalImportar";
import ModalDeudaMasiva from "./components/ModalDeudaMasiva";
import ReciboAgrupado from "./components/ReciboAgrupado";

// Iconos
import { 
  FaUserPlus, FaMoneyBillWave, FaFileInvoiceDollar, 
  FaPrint, FaTrashAlt, FaSearch, FaUserEdit, FaUserTimes, 
  FaSort, FaCut, FaShieldAlt, FaFileExcel, FaSignOutAlt, 
  FaUserShield, FaMoon, FaSun, FaTools, FaWhatsapp, FaDatabase,
  FaCloudUploadAlt
} from "react-icons/fa";

// --- SE ELIMINÓ EL TRUCO CSS GLOBAL ---

// --- SIDEBAR (Menú Lateral) ---
const Sidebar = ({ 
  setMostrarRegistro, mostrarRegistro, usuarioSeleccionado, 
  setMostrarModalPago, setMostrarModalCierre, setMostrarModalAuditoria, 
  setMostrarModalUsuarios, setMostrarModalIncidencias, 
  usuarioActivo, onLogout, 
  darkMode, setDarkMode, descargarBackup, 
  setMostrarImportar,
  setMostrarModalMasivo
}) => (
  <div className={`d-flex flex-column flex-shrink-0 p-3 text-white ${darkMode ? 'bg-black' : 'bg-dark'}`} style={{ width: "240px", height: "100vh", maxHeight: "100vh", transition: '0.3s' }}>
    <a href="/" className="d-flex align-items-center mb-3 mb-md-0 me-md-auto text-white text-decoration-none flex-shrink-0 gap-2">
      <span className="fs-5 fw-bold">Municipalidad - Pueblo Nuevo</span>
    </a>
    <hr className="flex-shrink-0"/>
    
    <ul className="nav nav-pills flex-column mb-auto" style={{ overflowY: "auto", overflowX: "hidden" }}>
      <li className="nav-item">
        <button className={`nav-link text-white w-100 text-start d-flex align-items-center gap-2 ${!mostrarRegistro ? "active bg-primary" : ""}`} onClick={() => setMostrarRegistro(false)}>
          <FaSearch/> <span>Deuda Tributaria</span>
        </button>
      </li>
      <li>
        <button className={`nav-link text-white w-100 text-start d-flex align-items-center gap-2 ${mostrarRegistro ? "active bg-primary" : ""}`} onClick={() => setMostrarRegistro(true)}>
          <FaUserPlus/> <span>Registro Nuevo</span>
        </button>
      </li>

      <li className="nav-item mt-3 text-white-50 text-uppercase small fw-bold">Operaciones</li>
      <li>
        <button className="nav-link text-white w-100 text-start d-flex align-items-center gap-2" onClick={() => setMostrarModalIncidencias(true)}>
          <FaTools/> <span>Incidencias / Reclamos</span>
        </button>
      </li>

      <li className="nav-item mt-3 text-white-50 text-uppercase small fw-bold">Caja</li>
      <li>
        <button className="nav-link text-white w-100 text-start d-flex align-items-center gap-2" onClick={() => usuarioSeleccionado ? setMostrarModalPago(true) : alert("Seleccione usuario")}>
          <FaMoneyBillWave/> <span>Efectuar Pago (F7)</span>
        </button>
      </li>

      <li className="nav-item mt-3 text-white-50 text-uppercase small fw-bold">Reportes</li>
      <li><button className="nav-link text-white w-100 text-start d-flex align-items-center gap-2" onClick={() => setMostrarModalCierre(true)}><FaFileInvoiceDollar/> <span>Ver Cobranzas (F9)</span></button></li>
      <li><a href={`${API_BASE_URL}/exportar/padron`} target="_blank" rel="noopener noreferrer" className="nav-link text-success w-100 text-start d-flex align-items-center gap-2"><FaFileExcel/> <span>Descargar Excel</span></a></li>
      
      <li className="nav-item mt-3 border-top pt-2"><button className="nav-link text-white-50 w-100 text-start small d-flex align-items-center gap-2" onClick={() => setMostrarModalAuditoria(true)}><FaShieldAlt/> <span>Auditoría</span></button></li>

      {(() => {
        const esAdmin = usuarioActivo?.rol === 'ADMIN' || usuarioActivo?.rol === 'ADMIN_SEC';
        const esSuperAdmin = usuarioActivo?.rol === 'ADMIN';
        if (!esAdmin) return null;
        return (
          <>
            <li className="nav-item mt-1">
              <button className="nav-link text-warning w-100 text-start small d-flex align-items-center gap-2" onClick={() => setMostrarModalUsuarios(true)}>
                <FaUserShield/> <span>Gestión Usuarios</span>
              </button>
            </li>
            {esSuperAdmin && (
              <li className="nav-item mt-1">
                <button className="nav-link text-info w-100 text-start small d-flex align-items-center gap-2" onClick={descargarBackup}>
                  <FaDatabase/> <span>Copia Seguridad</span>
                </button>
              </li>
            )}
            {esSuperAdmin && (
              <li className="nav-item mt-1">
                <button className="nav-link text-success w-100 text-start small d-flex align-items-center gap-2" onClick={() => setMostrarImportar(true)}>
                  <FaCloudUploadAlt/> <span>Importar Padrón</span>
                </button>
              </li>
            )}
          </>
        );
      })()}
    </ul>
    
    <div className="mt-2 pt-2 border-top flex-shrink-0">
      <button className="btn btn-sm btn-outline-secondary w-100 mb-2 d-flex align-items-center justify-content-center gap-2" onClick={() => setDarkMode(!darkMode)}>
        {darkMode ? <><FaSun className="text-warning"/> Modo Claro</> : <><FaMoon/> Modo Oscuro</>}
      </button>

      <div className="small text-white-50 mb-2 text-truncate">Usuario: <strong className="text-white">{usuarioActivo?.nombre || 'Invitado'}</strong></div>
      <button className="btn btn-outline-danger btn-sm w-100 d-flex align-items-center justify-content-center gap-2" onClick={onLogout}><FaSignOutAlt /> Cerrar Sesión</button>
    </div>
  </div>
);

// --- TOOLBAR ---
const Toolbar = ({ 
  busqueda, setBusqueda, usuarioSeleccionado, setMostrarModalDeuda, 
  setMostrarModalEliminar, setMostrarModalEditarUsuario, eliminarUsuarioCompleto, 
  handlePrintCortes, enviarWhatsapp, darkMode, setMostrarModalMasivo,
  selectedIds, setMostrarModalDeudaMasiva
}) => (
  <div className={`${darkMode ? 'bg-secondary border-secondary text-white' : 'bg-light border-bottom'} p-2 d-flex gap-2 align-items-center sticky-top shadow-sm`} style={{ flexWrap: "nowrap", overflowX: "hidden" }} onClick={(e) => e.stopPropagation()}>
    
    <div className="input-group input-group-sm flex-shrink-0" style={{width: '220px'}}>
      <span className="input-group-text border-end-0"><FaSearch className="text-muted"/></span>
      <input type="text" className="form-control border-start-0 ps-0" placeholder="Buscar..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} autoFocus />
    </div>
    
    <div className="vr mx-1"></div>
    
    <div className="d-flex gap-2 flex-shrink-0">
        <div className="btn-group shadow-sm">
        {selectedIds && selectedIds.size > 1 ? (
            <button className="btn btn-warning btn-sm fw-bold d-flex align-items-center gap-1" onClick={() => setMostrarModalDeudaMasiva(true)}>
                <FaMoneyBillWave/> <span>Reg. Deuda ({selectedIds.size})</span>
            </button>
        ) : (
            <button className="btn btn-primary btn-sm d-flex align-items-center gap-1" disabled={!usuarioSeleccionado} onClick={() => setMostrarModalDeuda(true)}>
                <FaMoneyBillWave/> <span>Reg. Deuda (F3)</span>
            </button>
        )}
        <button className={`btn btn-sm d-flex align-items-center justify-content-center ${darkMode ? 'btn-outline-light' : 'btn-outline-danger bg-white'}`} disabled={!usuarioSeleccionado} onClick={() => setMostrarModalEliminar(true)}><FaTrashAlt/></button>
        </div>

        <div className="btn-group shadow-sm">
        <button className={`btn btn-sm border d-flex align-items-center justify-content-center ${darkMode ? 'btn-dark' : 'btn-light'}`} disabled={!usuarioSeleccionado} onClick={() => setMostrarModalEditarUsuario(true)}><FaUserEdit/></button>
        <button className={`btn btn-sm border d-flex align-items-center justify-content-center ${darkMode ? 'btn-dark' : 'btn-light'}`} disabled={!usuarioSeleccionado} onClick={eliminarUsuarioCompleto}><FaUserTimes/></button>
        </div>

        <button className="btn btn-success btn-sm shadow-sm d-flex align-items-center justify-content-center" disabled={!usuarioSeleccionado} onClick={enviarWhatsapp} title="WhatsApp"><FaWhatsapp/></button>
        <button className="btn btn-danger btn-sm shadow-sm d-flex align-items-center justify-content-center" onClick={handlePrintCortes} title="Cortes"><FaCut/></button>
        
        <button className="btn btn-dark btn-sm shadow-sm d-flex align-items-center gap-1" onClick={() => setMostrarModalMasivo(true)} title="Imprimir Recibos">
            <FaPrint/> <span>Impresión</span>
        </button>
    </div>

    <div className="ms-auto small user-select-none opacity-75 text-end text-truncate flex-grow-1" style={{ minWidth: "0" }}>
      {usuarioSeleccionado ? 
        <span className="text-truncate d-block">Sel: <strong>{usuarioSeleccionado.nombre_completo}</strong></span> 
        : <span className="fst-italic">Seleccione un contribuyente...</span>
      }
    </div>
  </div>
);

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
    rol: payload.rol
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
    <td className="fw-bold opacity-75">{c.codigo_municipal}</td>
    <td>{c.nombre_completo}</td>
    <td>{c.direccion_completa}</td>
    <td className="text-center fw-bold">{c.meses_deuda > 0 ? c.meses_deuda : "-"}</td>
    <td className="text-end fw-bold">S/. {c.deuda_anio}</td>
    <td className="text-end fw-bold text-success">S/. {c.abono_anio}</td>
  </tr>
));

function App() {
  const [usuarioSistema, setUsuarioSistema] = useState(readStoredUser);
  const [contribuyentes, setContribuyentes] = useState([]);
  const [usuarioSeleccionado, setUsuarioSeleccionado] = useState(null);
  const [historial, setHistorial] = useState([]);
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
  const [mostrarModalIncidencias, setMostrarModalIncidencias] = useState(false);
  const [mostrarModalMasivo, setMostrarModalMasivo] = useState(false);
  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [mostrarModalDeudaMasiva, setMostrarModalDeudaMasiva] = useState(false);
  
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
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const scrollTopRef = useRef(0);
  const scrollRafRef = useRef(0);
  const lastHoverIdRef = useRef(null);
  const rowHeight = 32;
  const overscan = 6;

  const [darkMode, setDarkMode] = useState(false);
  const [refreshDashboard, setRefreshDashboard] = useState(0);

  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState({ columna: "nombre_completo", direccion: "asc" });
  const busquedaDeferred = useDeferredValue(busqueda);

  const masivoRef = useRef(null);
  const [datosMasivos, setDatosMasivos] = useState(null);
  const currentYear = new Date().getFullYear();

  const reciboAgrupadoRef = useRef(null);
const [datosReciboAgrupado, setDatosReciboAgrupado] = useState(null);

const handlePrintAgrupado = useReactToPrint({ 
    contentRef: reciboAgrupadoRef, 
    documentTitle: 'Recibo_Agrupado',
    onAfterPrint: () => setDatosReciboAgrupado(null) 
});

// Efecto para imprimir en cuanto lleguen los datos
useEffect(() => {
    if (!datosReciboAgrupado) return;
    const raf = requestAnimationFrame(() => {
        if (reciboAgrupadoRef.current) handlePrintAgrupado();
    });
    return () => cancelAnimationFrame(raf);
}, [datosReciboAgrupado, handlePrintAgrupado]);

  const handlePrintMasivo = useReactToPrint({ 
    contentRef: masivoRef, 
    documentTitle: 'Recibos_Masivos',
    onAfterPrint: () => setDatosMasivos(null)
  });

  useEffect(() => {
    if (!datosMasivos) return;
    const raf = requestAnimationFrame(() => {
      if (masivoRef.current) handlePrintMasivo();
    });
    return () => cancelAnimationFrame(raf);
  }, [datosMasivos, handlePrintMasivo]);

  const componentRef = useRef(null);
  const cortesRef = useRef(null);
  const [datosReciboImprimir, setDatosReciboImprimir] = useState(null);

  const handlePrintCortes = useReactToPrint({ contentRef: cortesRef, documentTitle: 'Orden_Cortes' });
  const handlePrintRecibo = useReactToPrint({ contentRef: componentRef, documentTitle: 'Recibo_Agua', onAfterPrint: () => setDatosReciboImprimir(null) });

  const imprimirCortes = () => {
    if (cortesRef.current) { handlePrintCortes(); return; }
    requestAnimationFrame(() => { if (cortesRef.current) handlePrintCortes(); });
  };

  useEffect(() => {
    if (!datosReciboImprimir) return;
    const raf = requestAnimationFrame(() => { if (componentRef.current) handlePrintRecibo(); });
    return () => cancelAnimationFrame(raf);
  }, [datosReciboImprimir, handlePrintRecibo]);

  const cargarContribuyentes = async () => {
    try {
      const res = await api.get("/contribuyentes");
      setContribuyentes(res.data);
    } catch (error) {
      console.error("Error datos:", error.response?.status, error.response?.data || error.message);
    }
  };
  const cargarHistorial = async (id_contribuyente) => { try { const res = await api.get(`/recibos/historial/${id_contribuyente}?anio=${currentYear}`); setHistorial(res.data); } catch (error) { console.error("Error historial"); } };

  const recargarTodo = () => {
    cargarContribuyentes();
    if (usuarioSeleccionado) cargarHistorial(usuarioSeleccionado.id_contribuyente);
    setRefreshDashboard(prev => prev + 1);
    setSelectedIds(new Set());
  };

  useEffect(() => {
    if (!usuarioSistema) return;
    cargarContribuyentes();
  }, [usuarioSistema]);
  useEffect(() => { if (usuarioSeleccionado) cargarHistorial(usuarioSeleccionado.id_contribuyente); else setHistorial([]); }, [usuarioSeleccionado, contribuyentes]);
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
    if (window.confirm("¿Cerrar sesión?")) {
      localStorage.removeItem("token");
      setUsuarioSistema(null);
      setUsuarioSeleccionado(null);
    }
  };

  const eliminarUsuarioCompleto = async () => {
    if(!usuarioSeleccionado) return;
    if(!window.confirm(`¿PELIGRO: Eliminar a ${usuarioSeleccionado.nombre_completo}?`)) return;
    try { await api.delete(`/contribuyentes/${usuarioSeleccionado.id_contribuyente}`); alert("Usuario eliminado."); setUsuarioSeleccionado(null); recargarTodo(); } catch (error) { alert("Error al eliminar."); }
  };

  const enviarWhatsapp = () => {
    if (!usuarioSeleccionado) return;
    if (!usuarioSeleccionado.telefono) return alert("Este usuario no tiene teléfono registrado.");
    const numero = usuarioSeleccionado.telefono.replace(/\D/g, '');
    const deuda = usuarioSeleccionado.deuda_anio;
    const meses = usuarioSeleccionado.meses_deuda;
    const nombre = usuarioSeleccionado.nombre_completo.split(' ')[0];
    let mensaje = parseFloat(deuda) > 0 
      ? `Hola *${nombre}*, le saludamos de la *Muninipalidad de Pueblo Nuevo*. Le recordamos que su servicio de agua tiene una deuda de *${meses} meses* (S/. ${deuda}). Evite cortes acercándose a cancelar. ¡Gracias! 💧`
      : `Hola *${nombre}*, le saludamos de la *Muninipalidad de Pueblo Nuevo*. Gracias por estar al día en sus pagos de agua potable. ¡Saludos! 💧`;
    window.open(`https://wa.me/51${numero}?text=${encodeURIComponent(mensaje)}`, '_blank');
  };

  const descargarBackup = async () => {
    if (!confirm("¿Generar y descargar copia de seguridad completa?")) return;
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

  const startScrollSelect = (anchorId, mode, baseIds) => {
    setScrollSelect({
      active: true,
      anchorId,
      mode,
      baseIds: Array.from(baseIds)
    });
  };

  const clearScrollSelect = () => {
    setScrollSelect({ active: false, anchorId: null, mode: "replace", baseIds: [] });
  };

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

  const beginDragSelection = (e, usuario) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const id = usuario.id_contribuyente;
    let baseSelected;
    let mode = "replace";

    if (e.ctrlKey || e.metaKey) {
      baseSelected = new Set(selectedIds);
      if (baseSelected.has(id)) baseSelected.delete(id);
      else baseSelected.add(id);
      mode = "add";
    } else {
      baseSelected = new Set([id]);
    }

    setSelectedIds(baseSelected);
    setUsuarioSeleccionado(usuario);
    startScrollSelect(id, mode, baseSelected);
    setIsDragging(true);

    requestAnimationFrame(() => applyScrollSelectAtPoint(e.clientX, e.clientY));
  };

  const datosProcesados = useMemo(() => {
    const needle = busquedaDeferred.trim().toLowerCase();
    const filtrados = contribuyentes.filter((c) => {
      if (!needle) return true;
      const nombre = (c.nombre_completo || "").toLowerCase();
      const codigo = (c.codigo_municipal || "").toLowerCase();
      const direccion = (c.direccion_completa || "").toLowerCase();
      return nombre.includes(needle) || codigo.includes(needle) || direccion.includes(needle);
    });
    return filtrados.sort((a, b) => {
      const valA = a[orden.columna] ? a[orden.columna].toString().toLowerCase() : "";
      const valB = b[orden.columna] ? b[orden.columna].toString().toLowerCase() : "";
      if (['deuda_anio', 'abono_anio', 'meses_deuda'].includes(orden.columna)) {
        return orden.direccion === 'asc'
          ? parseFloat(a[orden.columna] || 0) - parseFloat(b[orden.columna] || 0)
          : parseFloat(b[orden.columna] || 0) - parseFloat(a[orden.columna] || 0);
      }
      if (valA < valB) return orden.direccion === 'asc' ? -1 : 1;
      if (valA > valB) return orden.direccion === 'asc' ? 1 : -1;
      return 0;
    });
  }, [contribuyentes, busquedaDeferred, orden]);
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
    const rawStart = Math.max(0, Math.floor(tableScrollTop / rowHeight) - overscan);
    const start = Math.min(rawStart, Math.max(0, total - 1));
    const visibleCount = Math.ceil(viewport / rowHeight) + overscan * 2;
    const end = Math.min(total, start + visibleCount);
    return {
      start,
      end,
      topSpacerHeight: start * rowHeight,
      bottomSpacerHeight: Math.max(0, (total - end) * rowHeight)
    };
  }, [datosProcesados.length, tableScrollTop, tableViewportHeight, rowHeight, overscan]);

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

    setSelectedIds(nextSelected);
    const hoveredUsuario = datosProcesados[hoverIndex];
    if (hoveredUsuario) setUsuarioSeleccionado(hoveredUsuario);
  };

  const scheduleScrollTopUpdate = useCallback((nextTop) => {
    scrollTopRef.current = nextTop;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      setTableScrollTop(scrollTopRef.current);
      scrollRafRef.current = 0;
    });
  }, []);

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
      const meses = parseInt(c.meses_deuda || 0); 
      if (selectedIds.has(c.id_contribuyente)) return "table-active border border-primary border-2";
      if (usuarioSeleccionado?.id_contribuyente === c.id_contribuyente) return "table-primary border-primary"; 
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
  // CAMBIO: Color de tarjeta más oscuro para contraste (#2b3035) y borde sutil
  const bgCard = darkMode ? 'text-white' : 'bg-white border text-dark';
  const cardStyle = darkMode ? { backgroundColor: "#2b3035", borderTop: "1px solid #495057", borderRight: "1px solid #495057", borderBottom: "1px solid #495057", borderLeft: "1px solid #495057" } : {};
  const tableClass = darkMode ? 'table table-dark table-hover mb-0 table-sm small' : 'table table-hover table-bordered mb-0 table-sm small';

  if (!usuarioSistema) {
    return (
      <LoginPage
        onLoginSuccess={(datos) => {
          const { token, ...user } = datos || {};
          setUsuarioSistema(user?.id_usuario ? user : datos);
        }}
      />
    );
  }

  return (
    <div className={`d-flex ${bgMain}`} style={{ height: "100vh", overflow: "hidden" }}>
      
      <Sidebar 
        setMostrarRegistro={setMostrarRegistro} mostrarRegistro={mostrarRegistro} usuarioSeleccionado={usuarioSeleccionado}
        setMostrarModalPago={setMostrarModalPago} setMostrarModalCierre={setMostrarModalCierre}
        setMostrarModalAuditoria={setMostrarModalAuditoria} setMostrarModalUsuarios={setMostrarModalUsuarios}
        setMostrarModalIncidencias={setMostrarModalIncidencias}
        usuarioActivo={usuarioSistema} onLogout={handleLogout}
        darkMode={darkMode} setDarkMode={setDarkMode}
        descargarBackup={descargarBackup}
        setMostrarModalMasivo={setMostrarModalMasivo}
        setMostrarImportar={setMostrarImportar}
      />
      
      <div className={`flex-grow-1 d-flex flex-column ${bgMain}`} style={{ overflow: "hidden" }}>
        <header className="bg-primary text-white p-3 shadow-sm flex-shrink-0 d-flex justify-content-between align-items-center">
          <h5 className="m-0">Área de Administración Tributaria - Agua</h5>
        </header>

        {/* CAMBIO: Se pasa darkMode a RegistroForm */}
        {mostrarRegistro ? (
          <div className="p-4 overflow-auto"><RegistroForm onGuardar={() => { recargarTodo(); setMostrarRegistro(false); }} darkMode={darkMode} /></div>
        ) : (
          <div className="d-flex flex-column flex-grow-1" style={{ overflow: "hidden" }} onClick={handleBackgroundClick}>
            
            <Toolbar 
              busqueda={busqueda} setBusqueda={setBusqueda} 
              usuarioSeleccionado={usuarioSeleccionado} 
              setMostrarModalDeuda={setMostrarModalDeuda} 
              setMostrarModalEliminar={setMostrarModalEliminar} 
              setMostrarModalEditarUsuario={setMostrarModalEditarUsuario} 
              eliminarUsuarioCompleto={eliminarUsuarioCompleto} 
              handlePrintCortes={imprimirCortes} 
              enviarWhatsapp={enviarWhatsapp} 
              darkMode={darkMode} 
              setMostrarModalMasivo={setMostrarModalMasivo}
              selectedIds={selectedIds}
              setMostrarModalDeudaMasiva={setMostrarModalDeudaMasiva}
            />
            
            <div className="mx-3 mt-3 flex-shrink-0"><DashboardStats triggerUpdate={refreshDashboard} /></div>
            
            {/* TABLA PRINCIPAL */}
            <div className={`flex-grow-1 mx-3 mb-3 shadow-sm d-flex flex-column ${bgCard}`} style={{ flexBasis: "45%", overflow: "hidden", ...cardStyle }}>
              <div className="bg-dark text-white p-2 small fw-bold flex-shrink-0">RELACION DE CONTRIBUYENTES</div>
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
                      <ThOrdenable label="Código" campo="codigo_municipal" />
                      <ThOrdenable label="Nombre" campo="nombre_completo" />
                      <ThOrdenable label="Dirección" campo="direccion_completa" />
                      <ThOrdenable label="Meses Deuda" campo="meses_deuda" />
                      <ThOrdenable label="Deuda Año" campo="deuda_anio" />
                      <ThOrdenable label="Abono Año" campo="abono_anio" />
                    </tr>
                  </thead>
                  <tbody>
                    {datosProcesados.length === 0 ? (
                      <tr><td colSpan="6" className="text-center p-3 opacity-50">No se encontraron resultados</td></tr>
                    ) : (
                      <>
                        {virtualRange.topSpacerHeight > 0 && (
                          <tr>
                            <td colSpan="6" style={{ height: virtualRange.topSpacerHeight, padding: 0, border: "none" }}></td>
                          </tr>
                        )}
                        {datosProcesados.slice(virtualRange.start, virtualRange.end).map((c) => (
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
                            <td colSpan="6" style={{ height: virtualRange.bottomSpacerHeight, padding: 0, border: "none" }}></td>
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
              <div className="bg-secondary text-white p-2 small fw-bold flex-shrink-0 d-flex justify-content-between">
                  <span>ARBITRIOS MUNICIPALES - DETALLE {currentYear}</span>
                  <span>{usuarioSeleccionado?.nombre_completo}</span>
              </div>
              <div className="flex-grow-1 table-responsive" style={{ overflowY: "auto" }}>
                <table className={tableClass}>
                  <thead className="text-center sticky-top" style={{ top: "0", zIndex: 5 }}>
                    {/* CAMBIO: Encabezados con la nueva paleta oscura (#343a40) y borde correcto */}
                    <tr>
                        {["Mes", "Agua", "Desagüe", "Limpieza", "Admin"].map(title => (
                            <th key={title} style={{backgroundColor: darkMode ? "#343a40" : "#e2e3e5", color: darkMode ? "#fff" : "#000", boxShadow: `inset 0 -1px 0 ${darkMode ? "#495057" : "#dee2e6"}`}}>{title}</th>
                        ))}
                        <th className={`text-danger`} style={{backgroundColor: darkMode ? "#343a40" : "#e2e3e5", boxShadow: `inset 0 -1px 0 ${darkMode ? "#495057" : "#dee2e6"}`}}>Deuda</th>
                        <th className={`text-success`} style={{backgroundColor: darkMode ? "#343a40" : "#e2e3e5", boxShadow: `inset 0 -1px 0 ${darkMode ? "#495057" : "#dee2e6"}`}}>Abono</th>
                    </tr>
                  </thead>
                  <tbody className="text-center">
                    {!usuarioSeleccionado ? <tr><td colSpan="7" className="p-3">Seleccione usuario arriba</td></tr> : 
                     historial.length === 0 ? <tr><td colSpan="7" className="p-3">Sin movimientos</td></tr> :
                     historial.map((h, i) => (
                      <tr key={i}>
                        <td className="fw-bold text-start ps-3">{h.mes ? ["","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][h.mes] : "-"}</td><td>{h.subtotal_agua}</td><td>{h.subtotal_desague}</td><td>{h.subtotal_limpieza}</td><td>{h.subtotal_admin}</td><td className="fw-bold text-danger">{h.deuda_mes}</td><td className="fw-bold text-success">{h.abono_mes}</td>
                      </tr>
                    ))}
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
     cerrarModal={() => setMostrarModalPago(false)} 
     alGuardar={recargarTodo} 
     darkMode={darkMode}
     onImprimirAgrupado={(datos) => setDatosReciboAgrupado(datos)} // <--- CONEXIÓN CLAVE
  />
)}
      {mostrarModalEliminar && usuarioSeleccionado && (<ModalEliminar usuario={usuarioSeleccionado} cerrarModal={() => setMostrarModalEliminar(false)} alGuardar={recargarTodo} darkMode={darkMode} />)}
      {mostrarModalCierre && (<ModalCierre cerrarModal={() => setMostrarModalCierre(false)} darkMode={darkMode} />)}
      {mostrarModalEditarUsuario && usuarioSeleccionado && (<ModalEditarUsuario usuario={usuarioSeleccionado} cerrarModal={() => setMostrarModalEditarUsuario(false)} alGuardar={recargarTodo} darkMode={darkMode} />)}
      {mostrarModalAuditoria && (<ModalAuditoria cerrarModal={() => setMostrarModalAuditoria(false)} darkMode={darkMode} />)}
      {mostrarModalUsuarios && (<ModalUsuarios cerrarModal={() => setMostrarModalUsuarios(false)} usuarioActivo={usuarioSistema} darkMode={darkMode} />)}
      {mostrarModalIncidencias && (<ModalIncidencias cerrarModal={() => setMostrarModalIncidencias(false)} usuarioSeleccionado={usuarioSeleccionado} darkMode={darkMode} />)}
      
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

      {/* OCULTOS PARA IMPRESIÓN */}
      <div style={{ position: "fixed", left: "-10000px", top: "0", width: "148mm", height: "auto" }}>
          <Recibo ref={componentRef} datos={datosReciboImprimir} />
      </div>

      <div style={{ position: "absolute", width: "0px", height: "0px", overflow: "hidden" }}>
          <ReporteCortes ref={cortesRef} contribuyentes={contribuyentes} />
      </div>

      <div style={{ position: "fixed", left: "-10000px", top: "0", width: "297mm", height: "auto" }}>
          <RecibosMasivos ref={masivoRef} datos={datosMasivos} />
      </div>
      <div style={{ position: "fixed", left: "-10000px", top: "0", width: "100%", height: "auto" }}>
    <ReciboAgrupado ref={reciboAgrupadoRef} datos={datosReciboAgrupado} />
</div>
    </div>
  );
}

export default App;
