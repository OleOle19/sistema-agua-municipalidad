import { useState } from "react";
import axios from "axios";

const DEFAULT_SERVICIOS = { agua: true, desague: true, limpieza: true, admin: true };

const ModalPago = ({
  usuario,
  cerrarModal,
  alGuardar,
  darkMode,
  onImprimirRecibo
}) => {
  const [selectedRecibos, setSelectedRecibos] = useState(new Set());
  const [cargando, setCargando] = useState(false);
  const [montosManual, setMontosManual] = useState({});
  const [serviciosSeleccionados, setServiciosSeleccionados] = useState({});
  const currentYear = new Date().getFullYear();

  const formatMonto = (value) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
  };
  const parseNumber = (value) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const getAnioRecibo = (recibo) => recibo?.anio ?? currentYear;
  const getPeriodo = (recibo) => (Number(getAnioRecibo(recibo)) * 100) + Number(recibo?.mes ?? 0);
  const getMesCorto = (mes) => {
    const meses = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return meses[Number(mes)] || String(mes ?? "");
  };

  const getMontoRecibo = (recibo) => {
    const raw = recibo?.deuda_mes ?? recibo?.total_pagar ?? recibo?.monto_pagado ?? 0;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getServiciosBase = (recibo) => ({
    agua: parseNumber(recibo?.subtotal_agua ?? 0),
    desague: parseNumber(recibo?.subtotal_desague ?? 0),
    limpieza: parseNumber(recibo?.subtotal_limpieza ?? 0),
    admin: parseNumber(recibo?.subtotal_admin ?? 0)
  });
  const getServiciosSeleccion = (id) => serviciosSeleccionados[id] ?? DEFAULT_SERVICIOS;

  const getTotalServicios = (recibo, seleccion) => {
    const base = getServiciosBase(recibo);
    const baseSum = base.agua + base.desague + base.limpieza + base.admin;
    const max = getMontoRecibo(recibo);
    if (baseSum <= 0) return max;
    const total = (seleccion.agua ? base.agua : 0)
      + (seleccion.desague ? base.desague : 0)
      + (seleccion.limpieza ? base.limpieza : 0)
      + (seleccion.admin ? base.admin : 0);
    return Math.min(total, max);
  };

  const getMaxMontoRecibo = (id, recibo) => {
    const seleccion = serviciosSeleccionados[id];
    if (!seleccion) return getMontoRecibo(recibo);
    return getTotalServicios(recibo, seleccion);
  };

  const getMontoManualValue = (id, recibo) => {
    const raw = montosManual[id];
    const parsed = parseFloat(typeof raw === "string" ? raw.replace(",", ".") : raw);
    if (Number.isFinite(parsed)) return Math.min(Math.max(parsed, 0), getMaxMontoRecibo(id, recibo));
    return getMaxMontoRecibo(id, recibo);
  };

  const getMontoInputValue = (id, recibo) => {
    if (montosManual[id] !== undefined) return montosManual[id];
    return getMaxMontoRecibo(id, recibo).toFixed(2);
  };

  const setMontoTotal = (id, recibo) => {
    setMontosManual((prev) => ({ ...prev, [id]: getMaxMontoRecibo(id, recibo).toFixed(2) }));
  };

  const normalizeDecimal = (value) => value.replace(",", ".");
  const isValidDecimalInput = (value) => /^\d*(\.\d{0,2})?$/.test(value);

  const getDetalleImpresion = (idRecibo, recibo, montoPagado) => {
    const base = getServiciosBase(recibo);
    const seleccion = getServiciosSeleccion(idRecibo);
    const detalleSeleccionado = {
      agua: seleccion.agua ? base.agua : 0,
      desague: seleccion.desague ? base.desague : 0,
      limpieza: seleccion.limpieza ? base.limpieza : 0,
      admin: seleccion.admin ? base.admin : 0
    };
    const totalDetalle = detalleSeleccionado.agua
      + detalleSeleccionado.desague
      + detalleSeleccionado.limpieza
      + detalleSeleccionado.admin;

    if (totalDetalle <= 0) return { agua: round2(montoPagado), desague: 0, limpieza: 0, admin: 0 };

    const factor = montoPagado / totalDetalle;
    const detalleEscalado = {
      agua: round2(detalleSeleccionado.agua * factor),
      desague: round2(detalleSeleccionado.desague * factor),
      limpieza: round2(detalleSeleccionado.limpieza * factor),
      admin: round2(detalleSeleccionado.admin * factor)
    };
    const totalEscalado = detalleEscalado.agua
      + detalleEscalado.desague
      + detalleEscalado.limpieza
      + detalleEscalado.admin;
    const diff = round2(montoPagado - totalEscalado);
    if (Math.abs(diff) > 0) detalleEscalado.admin = round2(detalleEscalado.admin + diff);

    return detalleEscalado;
  };

  const buildDeudaAnteriorMap = (pagosAplicados) => {
    const recibosBase = Array.isArray(usuario.recibos) ? usuario.recibos : [];
    const saldoPostPago = new Map();

    recibosBase.forEach((r) => {
      if (!r?.id_recibo) return;
      const saldoOriginal = getMontoRecibo(r);
      const pagoAplicado = pagosAplicados.get(r.id_recibo) || 0;
      saldoPostPago.set(r.id_recibo, Math.max(round2(saldoOriginal - pagoAplicado), 0));
    });

    const deudaAnteriorByRecibo = new Map();
    recibosBase.forEach((target) => {
      if (!target?.id_recibo) return;
      const periodoTarget = getPeriodo(target);
      let deudaAnterior = 0;
      recibosBase.forEach((r) => {
        if (!r?.id_recibo || r.id_recibo === target.id_recibo) return;
        if (getPeriodo(r) < periodoTarget) {
          deudaAnterior += saldoPostPago.get(r.id_recibo) ?? getMontoRecibo(r);
        }
      });
      deudaAnteriorByRecibo.set(target.id_recibo, round2(deudaAnterior));
    });

    return deudaAnteriorByRecibo;
  };

  const buildReciboUnicoDesdeMultiples = (recibosParaImpresion) => {
    const ordenados = [...recibosParaImpresion].sort((a, b) => getPeriodo(a) - getPeriodo(b));
    const primero = ordenados[0];
    const ultimo = ordenados[ordenados.length - 1];

    const totalAgua = ordenados.reduce((sum, r) => sum + (parseFloat(r.subtotal_agua) || 0), 0);
    const totalDesague = ordenados.reduce((sum, r) => sum + (parseFloat(r.subtotal_desague) || 0), 0);
    const totalLimpieza = ordenados.reduce((sum, r) => sum + (parseFloat(r.subtotal_limpieza) || 0), 0);
    const totalAdmin = ordenados.reduce((sum, r) => sum + (parseFloat(r.subtotal_admin) || 0), 0);
    const totalPagar = ordenados.reduce((sum, r) => sum + (parseFloat(r.total_pagar) || 0), 0);
    const deudaMesesLabel = ordenados.map((r) => getMesCorto(r.mes)).join(",");

    return {
      contribuyente: {
        nombre_completo: usuario.nombre_completo,
        codigo_municipal: usuario.codigo_municipal,
        dni_ruc: usuario.dni_ruc,
        // En pago multiple mostramos la suma pagada en la tabla central.
        deuda_anio: round2(totalPagar),
        deuda_meses_label: deudaMesesLabel
      },
      predio: {
        direccion_completa: usuario.direccion_completa
      },
      recibo: {
        id_recibo: ultimo?.id_recibo,
        mes: ultimo?.mes,
        anio: primero?.anio ?? ultimo?.anio,
        mes_nombre: "Pago Multiple",
        total: round2(totalPagar)
      },
      detalles: {
        agua: round2(totalAgua),
        desague: round2(totalDesague),
        limpieza: round2(totalLimpieza),
        admin: round2(totalAdmin)
      }
    };
  };

  const recibosPendientes = usuario.recibos
    ? usuario.recibos.filter((r) => r.estado === "PENDIENTE" || r.estado === "PARCIAL")
    : [];

  const handleCheckbox = (recibo) => {
    const idRecibo = recibo.id_recibo;
    const nuevoSet = new Set(selectedRecibos);
    if (nuevoSet.has(idRecibo)) {
      nuevoSet.delete(idRecibo);
    } else {
      nuevoSet.add(idRecibo);
      setServiciosSeleccionados((prev) => {
        if (prev[idRecibo]) return prev;
        return { ...prev, [idRecibo]: { ...DEFAULT_SERVICIOS } };
      });
      setMontosManual((prev) => {
        if (prev[idRecibo] !== undefined) return prev;
        const totalServicios = getTotalServicios(recibo, DEFAULT_SERVICIOS);
        return { ...prev, [idRecibo]: totalServicios.toFixed(2) };
      });
    }
    setSelectedRecibos(nuevoSet);
  };

  const handleServicioToggle = (idRecibo, recibo, key) => {
    setServiciosSeleccionados((prev) => {
      const current = prev[idRecibo] ?? { ...DEFAULT_SERVICIOS };
      const next = { ...current, [key]: !current[key] };
      const totalServicios = getTotalServicios(recibo, next);
      setMontosManual((prevMontos) => ({ ...prevMontos, [idRecibo]: totalServicios.toFixed(2) }));
      return { ...prev, [idRecibo]: next };
    });
  };

  const handleMontoChange = (idRecibo, value, recibo) => {
    if (value === "") {
      setMontosManual((prev) => ({ ...prev, [idRecibo]: value }));
      return;
    }

    const normalized = normalizeDecimal(value);
    if (!isValidDecimalInput(normalized)) return;

    const parsed = parseFloat(normalized);
    if (!Number.isFinite(parsed)) {
      setMontosManual((prev) => ({ ...prev, [idRecibo]: normalized }));
      return;
    }

    const max = getMaxMontoRecibo(idRecibo, recibo);
    if (parsed > max) {
      setMontosManual((prev) => ({ ...prev, [idRecibo]: max.toFixed(2) }));
      return;
    }
    setMontosManual((prev) => ({ ...prev, [idRecibo]: normalized }));
  };

  const handleMontoBlur = (idRecibo, value, recibo) => {
    if (value === "") return;
    const normalized = normalizeDecimal(value);
    const parsed = parseFloat(normalized);
    if (!Number.isFinite(parsed)) {
      setMontosManual((prev) => ({ ...prev, [idRecibo]: "" }));
      return;
    }
    const max = getMaxMontoRecibo(idRecibo, recibo);
    const clamped = Math.min(Math.max(parsed, 0), max);
    setMontosManual((prev) => ({ ...prev, [idRecibo]: clamped.toFixed(2) }));
  };

  const procesarPago = async ({ imprimir }) => {
    if (selectedRecibos.size === 0) return alert("Seleccione al menos un recibo.");
    if (!window.confirm(`Confirmar pago de ${selectedRecibos.size} recibos?`)) return;

    setCargando(true);

    try {
      const pagosAplicados = new Map();
      const recibosPagadosDetalle = [];

      const recibosSeleccionados = Array.from(selectedRecibos)
        .map((idRecibo) => recibosPendientes.find((r) => r.id_recibo === idRecibo))
        .filter(Boolean)
        .sort((a, b) => getPeriodo(a) - getPeriodo(b));

      for (const reciboData of recibosSeleccionados) {
        const idRecibo = reciboData.id_recibo;
        const monto = getMontoManualValue(idRecibo, reciboData);
        if (monto <= 0) {
          alert("El monto a pagar debe ser mayor a 0.");
          setCargando(false);
          return;
        }

        await axios.post("http://localhost:5000/pagos", {
          id_recibo: idRecibo,
          monto_pagado: monto
        });

        pagosAplicados.set(idRecibo, round2((pagosAplicados.get(idRecibo) || 0) + monto));
        const detalleImpresion = getDetalleImpresion(idRecibo, reciboData, monto);

        recibosPagadosDetalle.push({
          id_recibo: reciboData.id_recibo,
          mes: reciboData.mes,
          anio: getAnioRecibo(reciboData),
          nombre_completo: usuario.nombre_completo,
          codigo_municipal: usuario.codigo_municipal,
          dni_ruc: usuario.dni_ruc,
          direccion_completa: usuario.direccion_completa,
          subtotal_agua: detalleImpresion.agua,
          subtotal_desague: detalleImpresion.desague,
          subtotal_limpieza: detalleImpresion.limpieza,
          subtotal_admin: detalleImpresion.admin,
          total_pagar: monto
        });
      }

      if (imprimir) {
        const deudaAnteriorMap = buildDeudaAnteriorMap(pagosAplicados);
        const recibosParaImpresion = recibosPagadosDetalle.map((r) => ({
          ...r,
          deuda_anio: deudaAnteriorMap.get(r.id_recibo) ?? 0
        }));

        if (recibosParaImpresion.length === 1) {
          const r = recibosParaImpresion[0];
          onImprimirRecibo?.({
            contribuyente: {
              nombre_completo: r.nombre_completo,
              codigo_municipal: r.codigo_municipal,
              dni_ruc: r.dni_ruc,
              deuda_anio: r.deuda_anio
            },
            predio: {
              direccion_completa: r.direccion_completa
            },
            recibo: {
              id_recibo: r.id_recibo,
              mes: r.mes,
              anio: r.anio,
              total: r.total_pagar
            },
            detalles: {
              agua: r.subtotal_agua,
              desague: r.subtotal_desague,
              limpieza: r.subtotal_limpieza,
              admin: r.subtotal_admin
            }
          });
        } else if (recibosParaImpresion.length > 1) {
          const reciboUnico = buildReciboUnicoDesdeMultiples(recibosParaImpresion);
          onImprimirRecibo?.(reciboUnico);
        }
      }

      alGuardar();
      cerrarModal();
    } catch (error) {
      console.error(error);
      alert("Error al procesar el pago.");
    } finally {
      setCargando(false);
    }
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff" } : {};
  const listClass = darkMode ? "list-group-item bg-dark text-white border-secondary" : "list-group-item";

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className="modal-header">
            <h5 className="modal-title">Registrar Pago - {usuario.nombre_completo}</h5>
            <button type="button" className="btn-close btn-close-white" onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            <h6>Seleccione los meses a cancelar:</h6>
            <div className="list-group mb-3" style={{ maxHeight: "300px", overflowY: "auto" }}>
              {recibosPendientes.length === 0 && (
                <p className="text-muted text-center p-3">No hay deudas pendientes.</p>
              )}

              {recibosPendientes.map((r) => {
                const serviciosBase = getServiciosBase(r);
                const serviciosSel = getServiciosSeleccion(r.id_recibo);
                const totalServicios = getTotalServicios(r, serviciosSel);
                return (
                  <div
                    key={r.id_recibo}
                    className={`${listClass} d-flex justify-content-between align-items-start`}
                    style={{ cursor: "pointer" }}
                    onClick={() => handleCheckbox(r)}
                  >
                    <div className="flex-grow-1">
                      <div>
                        <input
                          type="checkbox"
                          className="form-check-input me-2"
                          checked={selectedRecibos.has(r.id_recibo)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => handleCheckbox(r)}
                        />
                        <span>{r.mes}/{getAnioRecibo(r)}</span>
                      </div>

                      {selectedRecibos.has(r.id_recibo) && (
                        <div className="mt-2 ms-4" onClick={(e) => e.stopPropagation()}>
                          <div className="small fw-bold text-primary mb-1">Servicios a cobrar</div>
                          <div className="d-flex flex-column gap-1 small">
                            <div className="form-check d-flex align-items-center gap-2">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={serviciosSel.agua}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => handleServicioToggle(r.id_recibo, r, "agua")}
                              />
                              <label className="form-check-label">Agua Potable</label>
                              <span className="ms-auto text-muted">S/. {formatMonto(serviciosBase.agua)}</span>
                            </div>
                            <div className="form-check d-flex align-items-center gap-2">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={serviciosSel.desague}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => handleServicioToggle(r.id_recibo, r, "desague")}
                              />
                              <label className="form-check-label">Desague</label>
                              <span className="ms-auto text-muted">S/. {formatMonto(serviciosBase.desague)}</span>
                            </div>
                            <div className="form-check d-flex align-items-center gap-2">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={serviciosSel.limpieza}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => handleServicioToggle(r.id_recibo, r, "limpieza")}
                              />
                              <label className="form-check-label">Limpieza Publica</label>
                              <span className="ms-auto text-muted">S/. {formatMonto(serviciosBase.limpieza)}</span>
                            </div>
                            <div className="form-check d-flex align-items-center gap-2">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={serviciosSel.admin}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => handleServicioToggle(r.id_recibo, r, "admin")}
                              />
                              <label className="form-check-label">Gastos Administrativos</label>
                              <span className="ms-auto text-muted">S/. {formatMonto(serviciosBase.admin)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="d-flex flex-column align-items-end gap-2">
                      <small className="text-muted">Saldo: S/. {getMontoRecibo(r).toFixed(2)}</small>
                      <div className="input-group input-group-sm" style={{ width: "180px" }}>
                        <span className="input-group-text">S/.</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          pattern="\\d*(\\.\\d{0,2})?"
                          className="form-control text-end"
                          value={getMontoInputValue(r.id_recibo, r)}
                          onChange={(e) => handleMontoChange(r.id_recibo, e.target.value, r)}
                          onBlur={(e) => handleMontoBlur(r.id_recibo, e.target.value, r)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={!selectedRecibos.has(r.id_recibo)}
                        />
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMontoTotal(r.id_recibo, r);
                          }}
                          disabled={!selectedRecibos.has(r.id_recibo)}
                        >
                          Total
                        </button>
                      </div>
                      {selectedRecibos.has(r.id_recibo) && (
                        <div className="small fw-bold">Total servicios: S/. {formatMonto(totalServicios)}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="alert alert-success text-center fw-bold">
              Total a Pagar: S/. {Array.from(selectedRecibos)
                .reduce((sum, id) => sum + getMontoManualValue(id, recibosPendientes.find((r) => r.id_recibo === id)), 0)
                .toFixed(2)}
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={cerrarModal} disabled={cargando}>Cancelar</button>
            <button
              className="btn btn-primary fw-bold"
              onClick={() => procesarPago({ imprimir: false })}
              disabled={cargando}
            >
              {cargando ? "Procesando..." : "PAGAR"}
            </button>
            <button
              className="btn btn-success fw-bold"
              onClick={() => procesarPago({ imprimir: true })}
              disabled={cargando}
            >
              {cargando ? "Procesando..." : "PAGAR E IMPRIMIR"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalPago;
