import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api";

const ROLE_ORDER = { BRIGADA: 1, CONSULTA: 2, CAJERO: 3, ADMIN_SEC: 4, ADMIN: 5 };

const normalizeRole = (role) => {
  const raw = String(role || "").trim().toUpperCase();
  if (["ADMIN", "SUPERADMIN", "ADMIN_PRINCIPAL", "NIVEL_1"].includes(raw)) return "ADMIN";
  if (["ADMIN_SEC", "ADMIN_SECUNDARIO", "JEFE_CAJA", "NIVEL_2"].includes(raw)) return "ADMIN_SEC";
  if (["CAJERO", "OPERADOR_CAJA", "OPERADOR", "NIVEL_3"].includes(raw)) return "CAJERO";
  if (["BRIGADA", "BRIGADISTA", "CAMPO", "NIVEL_5"].includes(raw)) return "BRIGADA";
  return "CONSULTA";
};

const hasMinRole = (role, requiredRole) => {
  const currentLevel = ROLE_ORDER[normalizeRole(role)] || 0;
  const requiredLevel = ROLE_ORDER[normalizeRole(requiredRole)] || 0;
  return currentLevel >= requiredLevel;
};

const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (v) => Math.round((toNum(v) + Number.EPSILON) * 100) / 100;
const CARGO_REIMPRESION = 0.5;

const ModalPago = ({ usuario, usuarioSistema, cerrarModal, alGuardar, darkMode, realtimeConnected = false, realtimeTick = 0 }) => {
  const rol = normalizeRole(usuarioSistema?.rol);
  const isCaja = rol === "CAJERO";
  const canEmitir = hasMinRole(rol, "ADMIN_SEC");
  const canCobrarReimpresion = hasMinRole(rol, "ADMIN_SEC");
  const [cargando, setCargando] = useState(false);
  const [seleccion, setSeleccion] = useState({});
  const [ordenes, setOrdenes] = useState([]);
  const [ordenId, setOrdenId] = useState(0);
  const [cargandoOrdenes, setCargandoOrdenes] = useState(false);
  const [avisoOrden, setAvisoOrden] = useState("");
  const [aplicarRecargoReimpresion, setAplicarRecargoReimpresion] = useState(false);
  const maxOrdenConocidaRef = useRef(0);

  const recibosPendientes = useMemo(
    () => (Array.isArray(usuario?.recibos) ? usuario.recibos : [])
      .filter((r) => r && (r.estado === "PENDIENTE" || r.estado === "PARCIAL")),
    [usuario?.recibos]
  );

  const pendientePorRecibo = useMemo(() => {
    const map = new Map();
    (Array.isArray(ordenes) ? ordenes : []).forEach((orden) => {
      (Array.isArray(orden?.items) ? orden.items : []).forEach((it) => {
        const id = Number(it?.id_recibo);
        if (!Number.isInteger(id) || id <= 0) return;
        const monto = round2(toNum(it?.monto_autorizado));
        if (monto <= 0) return;
        map.set(id, round2((map.get(id) || 0) + monto));
      });
    });
    return map;
  }, [ordenes]);

  useEffect(() => {
    if (isCaja) return;
    const base = {};
    recibosPendientes.forEach((r) => {
      const saldoBase = round2(toNum(r.deuda_mes ?? r.total_pagar));
      const pendiente = round2(toNum(pendientePorRecibo.get(Number(r.id_recibo))));
      const saldo = round2(Math.max(saldoBase - pendiente, 0));
      base[r.id_recibo] = { checked: false, monto: saldo.toFixed(2) };
    });
    setSeleccion(base);
  }, [isCaja, recibosPendientes, pendientePorRecibo]);

  const cargarOrdenes = useCallback(async () => {
    if (!usuario?.id_contribuyente) return;
    setCargandoOrdenes(true);
    try {
      const res = await api.get("/caja/ordenes-cobro/pendientes", {
        params: { id_contribuyente: usuario.id_contribuyente, limit: 100 }
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      const maxActual = rows.reduce((acc, r) => Math.max(acc, Number(r?.id_orden || 0)), 0);
      if (isCaja && maxOrdenConocidaRef.current > 0 && maxActual > maxOrdenConocidaRef.current) {
        setAvisoOrden(`Nueva orden de cobro detectada (#${maxActual}).`);
      }
      maxOrdenConocidaRef.current = Math.max(maxOrdenConocidaRef.current, maxActual);
      setOrdenes(rows);
      setOrdenId(rows[0]?.id_orden || 0);
    } catch (err) {
      alert(err?.response?.data?.error || "No se pudo cargar ordenes pendientes.");
    } finally {
      setCargandoOrdenes(false);
    }
  }, [isCaja, usuario?.id_contribuyente]);

  useEffect(() => {
    cargarOrdenes().catch(() => {});
  }, [cargarOrdenes]);

  useEffect(() => {
    if (!usuario?.id_contribuyente) return undefined;
    const fallbackMs = realtimeConnected ? 30000 : 10000;
    const timer = setInterval(() => {
      cargarOrdenes().catch(() => {});
    }, fallbackMs);
    return () => clearInterval(timer);
  }, [usuario?.id_contribuyente, realtimeConnected, cargarOrdenes]);

  useEffect(() => {
    if (!realtimeTick || !usuario?.id_contribuyente) return;
    cargarOrdenes().catch(() => {});
  }, [realtimeTick, usuario?.id_contribuyente, cargarOrdenes]);

  useEffect(() => {
    if (!isCaja) return;
    setAplicarRecargoReimpresion(false);
  }, [isCaja, ordenId, usuario?.id_contribuyente]);

  const ordenSeleccionada = useMemo(
    () => ordenes.find((o) => Number(o.id_orden) === Number(ordenId)) || null,
    [ordenes, ordenId]
  );
  const totalOrdenCaja = round2(toNum(ordenSeleccionada?.total_orden));
  const recargoReimpresion = canCobrarReimpresion && aplicarRecargoReimpresion ? CARGO_REIMPRESION : 0;
  const totalCobroCaja = round2(totalOrdenCaja + recargoReimpresion);

  const toggleRecibo = (id, disabled = false) => {
    if (disabled) return;
    setSeleccion((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), checked: !prev[id]?.checked }
    }));
  };

  const setMonto = (id, value, maxSaldo) => {
    const cleaned = String(value || "").replace(",", ".");
    if (cleaned && !/^\d*(\.\d{0,2})?$/.test(cleaned)) return;
    const parsed = toNum(cleaned);
    const clamped = cleaned === "" ? "" : Math.min(Math.max(parsed, 0), round2(maxSaldo)).toFixed(2);
    setSeleccion((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), monto: clamped }
    }));
  };

  const totalOrden = useMemo(() => {
    return round2(recibosPendientes.reduce((acc, r) => {
      const s = seleccion[r.id_recibo];
      if (!s?.checked) return acc;
      return acc + toNum(s.monto);
    }, 0));
  }, [recibosPendientes, seleccion]);

  const buildDetalle = (r, monto) => {
    const agua = toNum(r.subtotal_agua);
    const desague = toNum(r.subtotal_desague);
    const limpieza = toNum(r.subtotal_limpieza);
    const admin = toNum(r.subtotal_admin);
    const base = agua + desague + limpieza + admin;
    if (base <= 0) return { agua: monto, desague: 0, limpieza: 0, admin: 0 };
    const factor = monto / base;
    let dAgua = round2(agua * factor);
    let dDes = round2(desague * factor);
    let dLimp = round2(limpieza * factor);
    let dAdm = round2(admin * factor);
    dAdm = round2(dAdm + (monto - (dAgua + dDes + dLimp + dAdm)));
    return { agua: dAgua, desague: dDes, limpieza: dLimp, admin: dAdm };
  };

  const emitirOrden = async () => {
    if (!canEmitir) return alert("No tiene permisos para emitir ordenes.");
    const items = recibosPendientes
      .filter((r) => seleccion[r.id_recibo]?.checked)
      .map((r) => {
        const monto = round2(toNum(seleccion[r.id_recibo]?.monto));
        const d = buildDetalle(r, monto);
        return {
          id_recibo: r.id_recibo,
          mes: r.mes,
          anio: r.anio,
          monto_autorizado: monto,
          subtotal_agua: d.agua,
          subtotal_desague: d.desague,
          subtotal_limpieza: d.limpieza,
          subtotal_admin: d.admin
        };
      })
      .filter((i) => i.monto_autorizado > 0);

    if (items.length === 0) return alert("Seleccione al menos un recibo con monto valido.");
    if (!window.confirm(`Emitir orden por S/. ${totalOrden.toFixed(2)}?`)) return;

    setCargando(true);
    try {
      const res = await api.post("/caja/ordenes-cobro", {
        id_contribuyente: usuario.id_contribuyente,
        items
      });
      const id = res?.data?.orden?.id_orden;
      alert(`Orden emitida correctamente${id ? `: #${id}` : ""}.`);
      alGuardar?.();
      cerrarModal?.();
    } catch (err) {
      alert(err?.response?.data?.error || "No se pudo emitir la orden.");
    } finally {
      setCargando(false);
    }
  };

  const cobrarOrden = async () => {
    if (!isCaja) return;
    if (!ordenSeleccionada) return alert("Seleccione una orden pendiente.");
    if (!window.confirm(`Cobrar orden #${ordenSeleccionada.id_orden} por S/. ${totalCobroCaja.toFixed(2)}?`)) return;

    setCargando(true);
    try {
      const res = await api.post(`/caja/ordenes-cobro/${ordenSeleccionada.id_orden}/cobrar`, {
        cargo_reimpresion: recargoReimpresion
      });
      const cargoAplicado = toNum(res?.data?.orden?.cargo_reimpresion);
      if (cargoAplicado > 0) {
        alert(`Cobro registrado correctamente.\nIncluye reimpresion: S/. ${cargoAplicado.toFixed(2)}`);
      } else {
        alert("Cobro registrado correctamente.");
      }
      alGuardar?.();
      cerrarModal?.();
    } catch (err) {
      alert(err?.response?.data?.error || "No se pudo cobrar la orden.");
    } finally {
      setCargando(false);
    }
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff" } : {};
  const listClass = darkMode ? "list-group-item bg-dark text-white border-secondary" : "list-group-item";

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content" style={modalStyle}>
          <div className="modal-header">
            <h5 className="modal-title">
              {isCaja ? "Caja - Cobrar Orden Pendiente" : "Ventanilla - Emitir Orden de Cobro"} - {usuario?.nombre_completo}
            </h5>
            <button type="button" className="btn-close btn-close-white" onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            {isCaja ? (
              <>
                {avisoOrden && (
                  <div className="alert alert-warning py-2 d-flex justify-content-between align-items-center">
                    <span>{avisoOrden}</span>
                    <button type="button" className="btn btn-sm btn-outline-dark" onClick={() => setAvisoOrden("")}>
                      OK
                    </button>
                  </div>
                )}
                {cargandoOrdenes && <p className="text-muted">Cargando ordenes...</p>}
                {!cargandoOrdenes && ordenes.length === 0 && (
                  <p className="text-muted text-center p-3">No hay ordenes pendientes para este contribuyente.</p>
                )}
                {!cargandoOrdenes && ordenes.length > 0 && (
                  <div className="list-group mb-3" style={{ maxHeight: "260px", overflowY: "auto" }}>
                    {ordenes.map((o) => (
                      <button
                        type="button"
                        key={o.id_orden}
                        className={`${listClass} text-start ${Number(ordenId) === Number(o.id_orden) ? "border border-primary border-2" : ""}`}
                        onClick={() => setOrdenId(o.id_orden)}
                      >
                        <div className="d-flex justify-content-between">
                          <strong>Orden #{o.id_orden}</strong>
                          <span className="fw-bold">S/. {toNum(o.total_orden).toFixed(2)}</span>
                        </div>
                        <div className="small text-muted">
                          Recibos: {o.cantidad_recibos} | Emitida: {new Date(o.creado_en).toLocaleString()}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {ordenSeleccionada && (
                  <div className="border rounded p-2">
                    <div className="small fw-bold mb-2">Detalle de orden #{ordenSeleccionada.id_orden}</div>
                    <table className="table table-sm mb-0">
                      <thead><tr><th>Periodo</th><th className="text-end">Monto</th></tr></thead>
                      <tbody>
                        {(ordenSeleccionada.items || []).map((it) => (
                          <tr key={`${ordenSeleccionada.id_orden}-${it.id_recibo}`}>
                            <td>{it.mes}/{it.anio}</td>
                            <td className="text-end fw-bold">S/. {toNum(it.monto_autorizado).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {canCobrarReimpresion && (
                      <div className="form-check mt-2">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="chk-recargo-reimpresion"
                          checked={aplicarRecargoReimpresion}
                          onChange={(e) => setAplicarRecargoReimpresion(Boolean(e.target.checked))}
                          disabled={cargando}
                        />
                        <label className="form-check-label" htmlFor="chk-recargo-reimpresion">
                          Cobrar nueva impresion: S/. {CARGO_REIMPRESION.toFixed(2)}
                        </label>
                      </div>
                    )}
                    <div className="small fw-bold text-end mt-2">
                      Total a cobrar: S/. {totalCobroCaja.toFixed(2)}
                      {aplicarRecargoReimpresion ? " (incluye reimpresion)" : ""}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {ordenes.length > 0 && (
                  <div className="alert alert-warning py-2 small">
                    Existen {ordenes.length} orden(es) pendiente(s) para este contribuyente. Los recibos en orden pendiente se muestran bloqueados.
                  </div>
                )}
                <div className="list-group mb-3" style={{ maxHeight: "320px", overflowY: "auto" }}>
                  {recibosPendientes.length === 0 && <p className="text-muted text-center p-3">No hay deudas pendientes.</p>}
                  {recibosPendientes.map((r) => {
                    const saldoBase = round2(toNum(r.deuda_mes ?? r.total_pagar));
                    const pendiente = round2(toNum(pendientePorRecibo.get(Number(r.id_recibo))));
                    const saldo = round2(Math.max(saldoBase - pendiente, 0));
                    const bloqueadoPorOrden = pendiente > 0.001;
                    const row = seleccion[r.id_recibo] || { checked: false, monto: saldo.toFixed(2) };
                    return (
                      <div key={r.id_recibo} className={`${listClass} d-flex justify-content-between align-items-center`}>
                        <div>
                          <input
                            type="checkbox"
                            className="form-check-input me-2"
                            checked={!!row.checked}
                            onChange={() => toggleRecibo(r.id_recibo, bloqueadoPorOrden)}
                            disabled={bloqueadoPorOrden}
                          />
                          <span>{r.mes}/{r.anio}</span>
                          <small className="ms-2 text-muted">Saldo: S/. {saldo.toFixed(2)}</small>
                          {bloqueadoPorOrden && (
                            <small className="ms-2 text-warning fw-bold">* En orden pendiente: S/. {pendiente.toFixed(2)}</small>
                          )}
                        </div>
                        <div className="input-group input-group-sm" style={{ width: "150px" }}>
                          <span className="input-group-text">S/.</span>
                          <input
                            type="text"
                            className="form-control text-end"
                            value={row.monto ?? ""}
                            onChange={(e) => setMonto(r.id_recibo, e.target.value, saldo)}
                            disabled={!row.checked || bloqueadoPorOrden}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="alert alert-info text-center fw-bold">Total orden: S/. {totalOrden.toFixed(2)}</div>
              </>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={cerrarModal} disabled={cargando}>Cerrar</button>
            {isCaja ? (
              <button className="btn btn-primary fw-bold" onClick={cobrarOrden} disabled={cargando || !ordenSeleccionada}>
                {cargando ? "Procesando..." : "COBRAR ORDEN"}
              </button>
            ) : (
              <button className="btn btn-primary fw-bold" onClick={emitirOrden} disabled={cargando}>
                {cargando ? "Procesando..." : "EMITIR ORDEN"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalPago;
