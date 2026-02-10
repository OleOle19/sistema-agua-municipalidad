import { useState } from "react";
import axios from "axios";

const ModalPago = ({ usuario, cerrarModal, alGuardar, darkMode, onImprimirAgrupado }) => {
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
  const getServiciosSeleccion = (id) =>
    serviciosSeleccionados[id] ?? { agua: true, desague: true, limpieza: true, admin: true };
  const getTotalServicios = (recibo, seleccion) => {
    const base = getServiciosBase(recibo);
    const baseSum = base.agua + base.desague + base.limpieza + base.admin;
    if (baseSum <= 0) return getMontoRecibo(recibo);
    return (seleccion.agua ? base.agua : 0)
      + (seleccion.desague ? base.desague : 0)
      + (seleccion.limpieza ? base.limpieza : 0)
      + (seleccion.admin ? base.admin : 0);
  };
  const getMaxMontoRecibo = (id, recibo) => {
    const seleccion = serviciosSeleccionados[id];
    if (!seleccion) return getMontoRecibo(recibo);
    return getTotalServicios(recibo, seleccion);
  };

  const getAnioRecibo = (recibo) => recibo?.anio ?? currentYear;
  const getMontoManualValue = (id, recibo) => {
    const raw = montosManual[id];
    const parsed = parseFloat(
      typeof raw === "string" ? raw.replace(",", ".") : raw
    );
    if (Number.isFinite(parsed)) {
      return Math.min(Math.max(parsed, 0), getMaxMontoRecibo(id, recibo));
    }
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

  // Filtramos solo los pendientes para mostrar
  const recibosPendientes = usuario.recibos
    ? usuario.recibos.filter(r => r.estado === 'PENDIENTE' || r.estado === 'PARCIAL')
    : [];

  const handleCheckbox = (recibo) => {
    const id_recibo = recibo.id_recibo;
    const nuevoSet = new Set(selectedRecibos);
    if (nuevoSet.has(id_recibo)) nuevoSet.delete(id_recibo);
    else {
      nuevoSet.add(id_recibo);
      setServiciosSeleccionados((prev) => {
        if (prev[id_recibo]) return prev;
        return { ...prev, [id_recibo]: { agua: true, desague: true, limpieza: true, admin: true } };
      });
      setMontosManual((prev) => {
        if (prev[id_recibo] !== undefined) return prev;
        const totalServicios = getTotalServicios(recibo, { agua: true, desague: true, limpieza: true, admin: true });
        return { ...prev, [id_recibo]: totalServicios.toFixed(2) };
      });
    }
    setSelectedRecibos(nuevoSet);
  };

  const handleServicioToggle = (id_recibo, recibo, key) => {
    setServiciosSeleccionados((prev) => {
      const current = prev[id_recibo] ?? { agua: true, desague: true, limpieza: true, admin: true };
      const next = { ...current, [key]: !current[key] };
      const totalServicios = getTotalServicios(recibo, next);
      setMontosManual((prevMontos) => ({ ...prevMontos, [id_recibo]: totalServicios.toFixed(2) }));
      return { ...prev, [id_recibo]: next };
    });
  };

  const handleMontoChange = (id_recibo, value, recibo) => {
    if (value === "") {
      setMontosManual((prev) => ({ ...prev, [id_recibo]: value }));
      return;
    }
    const normalized = normalizeDecimal(value);
    if (!isValidDecimalInput(normalized)) return;

    const parsed = parseFloat(normalized);
    if (!Number.isFinite(parsed)) {
      setMontosManual((prev) => ({ ...prev, [id_recibo]: normalized }));
      return;
    }

    const max = getMaxMontoRecibo(id_recibo, recibo);
    if (parsed > max) {
      setMontosManual((prev) => ({ ...prev, [id_recibo]: max.toFixed(2) }));
      return;
    }
    setMontosManual((prev) => ({ ...prev, [id_recibo]: normalized }));
  };
  const handleMontoBlur = (id_recibo, value, recibo) => {
    if (value === "") return;
    const normalized = normalizeDecimal(value);
    const parsed = parseFloat(normalized);
    if (!Number.isFinite(parsed)) {
      setMontosManual((prev) => ({ ...prev, [id_recibo]: "" }));
      return;
    }
    const max = getMaxMontoRecibo(id_recibo, recibo);
    const clamped = Math.min(Math.max(parsed, 0), max);
    setMontosManual((prev) => ({ ...prev, [id_recibo]: clamped.toFixed(2) }));
  };

  const handlePagar = async () => {
    if (selectedRecibos.size === 0) return alert("Seleccione al menos un recibo.");
    if (!confirm(`¿Confirmar pago de ${selectedRecibos.size} recibos?`)) return;

    setCargando(true);
    let totalPagado = 0;
    let recibosPagadosDetalle = [];

    try {
      // 1. Procesar Pagos uno por uno (Backend)
      for (const id_recibo of selectedRecibos) {
        // Buscamos el detalle completo del recibo para el ticket
        const reciboData = recibosPendientes.find(r => r.id_recibo === id_recibo);
        if (!reciboData) continue;
        const monto = getMontoManualValue(id_recibo, reciboData);
        if (monto <= 0) {
          alert("El monto a pagar debe ser mayor a 0.");
          setCargando(false);
          return;
        }
        
        await axios.post("http://localhost:5000/pagos", {
          id_recibo: id_recibo,
          monto_pagado: monto
        });

        totalPagado += monto;
        recibosPagadosDetalle.push({
          ...reciboData,
          total_pagar: monto,
          anio: getAnioRecibo(reciboData)
        });
      }

      // 2. Preparar Datos para Impresión Agrupada
      const datosImpresion = {
          usuario: usuario,
          recibos: recibosPagadosDetalle,
          totalTotal: totalPagado,
          fecha: new Date().toLocaleString(),
          codigo_operacion: Date.now().toString().slice(-6) // Generamos un num op simple
      };

      // 3. Mandar a Imprimir (Llama a la función en App.jsx)
      onImprimirAgrupado(datosImpresion);

      // 4. Finalizar
      alGuardar(); // Recargar datos de la tabla principal
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
              {recibosPendientes.length === 0 && <p className="text-muted text-center p-3">No hay deudas pendientes.</p>}
              {recibosPendientes.map(r => {
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
                          <div className="small fw-bold text-primary mb-1">Servicios a Cobrar</div>
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
                              <label className="form-check-label">Desagüe</label>
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
                              <label className="form-check-label">Limpieza Pública</label>
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
                Total a Pagar: S/. {Array.from(selectedRecibos).reduce((sum, id) => sum + getMontoManualValue(id, recibosPendientes.find(r => r.id_recibo === id)), 0).toFixed(2)}
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={cerrarModal}>Cancelar</button>
            <button className="btn btn-success fw-bold" onClick={handlePagar} disabled={cargando}>
                {cargando ? "Procesando..." : "PAGAR E IMPRIMIR AGRUPADO"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalPago;

