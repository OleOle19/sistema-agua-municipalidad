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
const normalizeRuc = (value) => {
  const raw = String(value || "").replace(/[^\d]/g, "");
  return /^\d{11}$/.test(raw) ? raw : "";
};

const ModalPago = ({
  usuario,
  usuarioSistema,
  cerrarModal,
  alGuardar,
  onImprimirAnexo,
  darkMode,
  realtimeConnected = false,
  realtimeTick = 0
}) => {
  const rol = normalizeRole(usuarioSistema?.rol);
  const isCaja = rol === "CAJERO";
  const canEmitir = hasMinRole(rol, "ADMIN_SEC");
  const [cargando, setCargando] = useState(false);
  const [seleccion, setSeleccion] = useState({});
  const [ordenes, setOrdenes] = useState([]);
  const [ordenId, setOrdenId] = useState(0);
  const [cargandoOrdenes, setCargandoOrdenes] = useState(false);
  const [avisoOrden, setAvisoOrden] = useState("");
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
    setSeleccion((prev) => {
      const next = {};
      recibosPendientes.forEach((r) => {
        const id = Number(r.id_recibo);
        if (!Number.isInteger(id) || id <= 0) return;

        const saldoBase = round2(toNum(r.deuda_mes ?? r.total_pagar));
        const pendiente = round2(toNum(pendientePorRecibo.get(id)));
        const saldo = round2(Math.max(saldoBase - pendiente, 0));
        const bloqueadoPorOrden = pendiente > 0.001;
        const prevRow = prev[id];
        const hasPrevMonto = typeof prevRow?.monto !== "undefined";
        const montoPrevioRaw = String(prevRow?.monto ?? "");
        const montoPrevioNum = round2(toNum(montoPrevioRaw));
        const montoAjustado = hasPrevMonto
          ? (montoPrevioRaw === ""
            ? ""
            : Math.min(Math.max(montoPrevioNum, 0), saldo).toFixed(2))
          : saldo.toFixed(2);

        next[id] = {
          checked: bloqueadoPorOrden || saldo <= 0 ? false : Boolean(prevRow?.checked),
          monto: montoAjustado
        };
      });

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      const sameShape = prevKeys.length === nextKeys.length;
      const sameValues = sameShape && nextKeys.every((k) => {
        const a = prev[k];
        const b = next[k];
        return Boolean(a?.checked) === Boolean(b?.checked) && String(a?.monto ?? "") === String(b?.monto ?? "");
      });

      return sameValues ? prev : next;
    });
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
      setOrdenId((prev) => {
        const prevId = Number(prev || 0);
        if (prevId > 0 && rows.some((r) => Number(r?.id_orden) === prevId)) return prevId;
        return Number(rows[0]?.id_orden || 0);
      });
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

  const ordenSeleccionada = useMemo(
    () => ordenes.find((o) => Number(o.id_orden) === Number(ordenId)) || null,
    [ordenes, ordenId]
  );

  const totalOrdenCaja = round2(toNum(ordenSeleccionada?.total_orden));
  const codigoReciboOrden = Number(ordenSeleccionada?.codigo_recibo || 0);
  const totalCobroCaja = totalOrdenCaja;

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

  const itemsSeleccionadosParaOrden = useMemo(() => (
    recibosPendientes
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
      .filter((i) => i.monto_autorizado > 0)
  ), [recibosPendientes, seleccion]);

  const emitirOrden = async () => {
    if (!canEmitir) return alert("No tiene permisos para emitir ordenes.");
    const items = itemsSeleccionadosParaOrden;

    if (items.length === 0) return alert("Seleccione al menos un recibo con monto valido.");
    if (!window.confirm(`Emitir orden por S/. ${totalOrden.toFixed(2)}?`)) return;

    setCargando(true);
    try {
      const res = await api.post("/caja/ordenes-cobro", {
        id_contribuyente: usuario.id_contribuyente,
        items,
        cargo_reimpresion: 0
      });
      const id = Number(res?.data?.orden?.id_orden || 0);
      const codigoReferencia = Number(res?.data?.orden?.codigo_recibo || 0);
      if (codigoReferencia > 0) {
        alert(`Orden emitida correctamente${id ? `: #${id}` : ""}.\nReferencia recibo: #${codigoReferencia}`);
      } else {
        alert(`Orden emitida correctamente${id ? `: #${id}` : ""}.`);
      }
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
      await api.post(`/caja/ordenes-cobro/${ordenSeleccionada.id_orden}/cobrar`, {
        cargo_reimpresion: 0
      });
      alert("Cobro registrado correctamente.");
      alGuardar?.();
      cerrarModal?.();
    } catch (err) {
      alert(err?.response?.data?.error || "No se pudo cobrar la orden.");
    } finally {
      setCargando(false);
    }
  };

  const buildDatosAnexoCaja = (orden) => {
    const items = Array.isArray(orden?.items) ? orden.items : [];
    const resumenServicios = items.reduce((acc, it) => ({
      agua: round2(acc.agua + toNum(it?.subtotal_agua)),
      desague: round2(acc.desague + toNum(it?.subtotal_desague)),
      limpieza: round2(acc.limpieza + toNum(it?.subtotal_limpieza)),
      admin: round2(acc.admin + toNum(it?.subtotal_admin))
    }), {
      agua: 0,
      desague: 0,
      limpieza: 0,
      admin: 0
    });
    const detalles = [
      { concepto: "SERVICIO DE AGUA", importe: resumenServicios.agua },
      { concepto: "SERVICIO DE DESAGUE", importe: resumenServicios.desague },
      { concepto: "LIMPIEZA PUBLICA", importe: resumenServicios.limpieza },
      { concepto: "SERVICIO ADMIN", importe: resumenServicios.admin }
    ].filter((row) => row.importe > 0);
    const totalOrden = round2(toNum(orden?.total_orden));
    if (detalles.length === 0 && totalOrden > 0) {
      detalles.push({ concepto: "SERVICIOS", importe: totalOrden });
    } else if (detalles.length > 0) {
      const totalDetalle = round2(detalles.reduce((acc, row) => acc + toNum(row.importe), 0));
      const diferencia = round2(totalOrden - totalDetalle);
      if (Math.abs(diferencia) >= 0.01) {
        const lastIdx = detalles.length - 1;
        detalles[lastIdx] = {
          ...detalles[lastIdx],
          importe: round2(toNum(detalles[lastIdx].importe) + diferencia)
        };
      }
    }
    const ruc = normalizeRuc(usuario?.ruc) || normalizeRuc(usuario?.dni_ruc);
    return {
      entidad: "MUNICIPALIDAD DISTRITAL DE PUEBLO NUEVO",
      entidad_detalle: "ARCO 301  RUC. 20192401004",
      contribuyente: {
        codigo_municipal: usuario?.codigo_municipal || "",
        nombre_completo: usuario?.nombre_completo || "",
        calle: usuario?.nombre_calle || usuario?.direccion_completa || "",
        ruc
      },
      total: totalOrden,
      detalles
    };
  };

  const imprimirAnexoCaja = () => {
    if (!isCaja) return;
    if (!ordenSeleccionada) return alert("Seleccione una orden pendiente.");
    if (typeof onImprimirAnexo !== "function") {
      return alert("No se pudo iniciar la impresion del anexo.");
    }
    onImprimirAnexo(buildDatosAnexoCaja(ordenSeleccionada));
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
                        <div className="small text-muted">
                          Recibo referencia: {Number(o.codigo_recibo || 0) > 0 ? `#${Number(o.codigo_recibo)}` : "-"}
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
                    <div className="small mt-2">
                      Recibo referencia: {codigoReciboOrden > 0 ? `#${codigoReciboOrden}` : "-"}
                    </div>
                    <div className="small fw-bold text-end mt-2">
                      Total a cobrar: S/. {totalCobroCaja.toFixed(2)}
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
                <div className="alert alert-info text-center fw-bold">
                  Total orden: S/. {totalOrden.toFixed(2)}
                </div>
              </>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={cerrarModal} disabled={cargando}>Cerrar</button>
            {isCaja ? (
              <>
                <button
                  className="btn btn-outline-primary fw-bold"
                  onClick={imprimirAnexoCaja}
                  disabled={cargando || !ordenSeleccionada}
                >
                  IMPRIMIR ANEXO A4
                </button>
                <button
                  className="btn btn-primary fw-bold"
                  onClick={cobrarOrden}
                  disabled={cargando || !ordenSeleccionada}
                >
                  {cargando ? "Procesando..." : "COBRAR ORDEN"}
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary fw-bold"
                onClick={emitirOrden}
                disabled={cargando}
              >
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
