import { useState, useEffect, useMemo } from "react";
import api from "../api";
import { FaLayerGroup, FaBuilding, FaUsers, FaPrint } from "react-icons/fa";

const MONTH_OPTIONS = [
  { value: 1, label: "Ene" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Abr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Ago" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dic" }
];

const getPeriodoNum = (anio, mes) => (Number(anio || 0) * 100) + Number(mes || 0);
const formatPeriodoLabel = (anio, mes) => {
  const month = MONTH_OPTIONS.find((m) => Number(m.value) === Number(mes));
  return `${month?.label || String(mes || "-")} ${String(anio || "-")}`;
};
const normalizePeriodoEstado = (value) => String(value || "").trim().toUpperCase();
const getPeriodoEstadoMeta = (estado, darkMode = false) => {
  const normalized = normalizePeriodoEstado(estado);
  if (normalized === "PAGADO") {
    return darkMode
      ? { title: "Pagado", highlight: "#166534", text: "#dcfce7" }
      : { title: "Pagado", highlight: "#bbf7d0", text: "#166534" };
  }
  return null;
};
const canUnlockNextMonthForMensual = () => {
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = endOfMonth.getTime() - today.getTime();
  const daysRemaining = Math.floor(diffMs / 86400000);
  return daysRemaining <= 7;
};
const getUltimoPeriodoDisponible = ({
  incluirMesActual = false,
  permitirMesSiguiente = false
} = {}) => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  if (incluirMesActual) {
    return { anio: now.getFullYear(), mes: currentMonth };
  }
  if (permitirMesSiguiente) {
    if (currentMonth === 12) {
      return { anio: now.getFullYear() + 1, mes: 1 };
    }
    return { anio: now.getFullYear(), mes: currentMonth + 1 };
  }
  if (currentMonth === 1) {
    return { anio: now.getFullYear() - 1, mes: 12 };
  }
  return { anio: now.getFullYear(), mes: currentMonth - 1 };
};

const ModalImpresionMasiva = ({
  cerrarModal,
  alConfirmar,
  idsSeleccionados = [],
  modoOperacion = "mensual",
  darkMode,
  onFlash = null
}) => {
  const [calles, setCalles] = useState([]);
  const [cargando, setCargando] = useState(false);
  const soloSeleccion = modoOperacion === "reimpresion";
  const permitirMesSiguienteMensual = !soloSeleccion && canUnlockNextMonthForMensual();
  const ultimoPeriodoEmitido = getUltimoPeriodoDisponible({
    incluirMesActual: false,
    permitirMesSiguiente: permitirMesSiguienteMensual
  });
  const [modo, setModo] = useState(soloSeleccion ? "seleccion" : (idsSeleccionados.length > 0 ? "seleccion" : "calle"));
  const [seleccion, setSeleccion] = useState({
    id_calle: "",
    meses: [ultimoPeriodoEmitido.mes],
    anio: ultimoPeriodoEmitido.anio
  });
  const [permitirMesesFuturos, setPermitirMesesFuturos] = useState(false);
  const [periodosHistorial, setPeriodosHistorial] = useState([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const showFlash = (type, text) => {
    if (typeof onFlash === "function") onFlash(type, text);
  };

  const historialPeriodosMap = useMemo(() => {
    const map = new Map();
    for (const periodo of Array.isArray(periodosHistorial) ? periodosHistorial : []) {
      const anio = Number(periodo?.anio || 0);
      const mes = Number(periodo?.mes || 0);
      if (anio < 1900 || mes < 1 || mes > 12) continue;
      const key = `${anio}-${mes}`;
      if (map.has(key)) continue;
      map.set(key, {
        ...periodo,
        anio,
        mes,
        estado: normalizePeriodoEstado(periodo?.estado)
      });
    }
    return map;
  }, [periodosHistorial]);
  const maxPeriodoEmitidoNum = useMemo(() => {
    const base = getPeriodoNum(ultimoPeriodoEmitido.anio, ultimoPeriodoEmitido.mes);
    if (!soloSeleccion) return base;
    return (Array.isArray(periodosHistorial) ? periodosHistorial : []).reduce((acc, periodo) => {
      const periodoNum = getPeriodoNum(periodo?.anio, periodo?.mes);
      return Math.max(acc, periodoNum);
    }, base);
  }, [periodosHistorial, soloSeleccion, ultimoPeriodoEmitido.anio, ultimoPeriodoEmitido.mes]);
  const anioMaximoEmitido = Math.floor(maxPeriodoEmitidoNum / 100) || ultimoPeriodoEmitido.anio;
  const anioSeleccionado = Number(seleccion.anio || anioMaximoEmitido);
  const permitirMesesNoEmitidos = soloSeleccion ? true : false;
  const idContribuyenteSeleccionado = Number(Array.isArray(idsSeleccionados) ? idsSeleccionados[0] : 0);
  const esMesNoEmitido = (mes, anio = anioSeleccionado) => getPeriodoNum(anio, mes) > maxPeriodoEmitidoNum;
  const opcionesMeses = !permitirMesesNoEmitidos
    ? MONTH_OPTIONS.filter((m) => !esMesNoEmitido(m.value, anioSeleccionado))
    : MONTH_OPTIONS;
  useEffect(() => {
    api.get("/calles").then((res) => setCalles(res.data)).catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    if (soloSeleccion) {
      setModo("seleccion");
    }
  }, [soloSeleccion]);

  useEffect(() => {
    if (permitirMesesNoEmitidos) return;
    setSeleccion((prev) => {
      const anioPrev = Number(prev.anio || anioMaximoEmitido);
      const anioAjustado = anioPrev > anioMaximoEmitido ? anioMaximoEmitido : anioPrev;
      const mesesPrev = Array.isArray(prev.meses) ? prev.meses : [];
      const mesesFiltrados = mesesPrev.filter((m) => getPeriodoNum(anioAjustado, Number(m)) <= maxPeriodoEmitidoNum);
      const cambioAnio = String(prev.anio) !== String(anioAjustado);
      const cambioMeses = mesesFiltrados.length !== mesesPrev.length;
      if (!cambioAnio && !cambioMeses) return prev;
      return { ...prev, anio: anioAjustado, meses: mesesFiltrados };
    });
  }, [anioMaximoEmitido, maxPeriodoEmitidoNum, permitirMesesNoEmitidos]);

  useEffect(() => {
    let cancelado = false;
    const cargarHistorial = async () => {
      if (!soloSeleccion) return;
      const idContribuyente = idContribuyenteSeleccionado;
      if (!idContribuyente) {
        setPeriodosHistorial([]);
        return;
      }
      setCargandoHistorial(true);
      try {
        const res = await api.get(`/recibos/historial/${idContribuyente}`, {
          params: { anio: "all" }
        });
        if (cancelado) return;
        const historial = Array.isArray(res?.data) ? res.data : [];
        const periodos = historial
          .filter((row) => Number(row?.id_recibo || 0) > 0)
          .map((row) => ({
            anio: Number(row?.anio || 0),
            mes: Number(row?.mes || 0),
            estado: normalizePeriodoEstado(row?.estado),
            abono_mes: Number(row?.abono_mes || 0),
            deuda_mes: Number(row?.deuda_mes || 0)
          }))
          .filter((row) => row.anio >= 1900 && row.mes >= 1 && row.mes <= 12)
          .sort((a, b) => ((b.anio * 100 + b.mes) - (a.anio * 100 + a.mes)));
        const unicos = [];
        const seen = new Set();
        for (const p of periodos) {
          const key = `${p.anio}-${p.mes}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unicos.push(p);
        }
        setPeriodosHistorial(unicos);
        if (unicos.length > 0) {
          const ultimo = unicos[0];
          setSeleccion((prev) => ({
            ...prev,
            anio: Number(ultimo.anio),
            meses: [Number(ultimo.mes)]
          }));
        }
      } catch {
        if (cancelado) return;
        setPeriodosHistorial([]);
      } finally {
        if (!cancelado) setCargandoHistorial(false);
      }
    };
    cargarHistorial();
    return () => {
      cancelado = true;
    };
  }, [soloSeleccion, idContribuyenteSeleccionado]);

  const toggleMes = (mes) => {
    setSeleccion((prev) => {
      const actual = new Set(prev.meses || []);
      if (actual.has(mes)) {
        actual.delete(mes);
      } else {
        actual.add(mes);
      }
      return { ...prev, meses: Array.from(actual).sort((a, b) => a - b) };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (soloSeleccion && (!Array.isArray(idsSeleccionados) || idsSeleccionados.length === 0)) {
      return showFlash("warning", "Seleccione un contribuyente para reimprimir.");
    }
    if (modo === "calle" && !seleccion.id_calle) return showFlash("warning", "Seleccione una calle.");
    if (!seleccion.meses || seleccion.meses.length === 0) return showFlash("warning", "Seleccione al menos un mes.");

    const anioNum = Number(seleccion.anio || 0);
    if (!Number.isInteger(anioNum) || anioNum < 1900) return alert("Ingrese un año válido.");
    const mesesNormalizados = (seleccion.meses || [])
      .map((m) => Number(m))
      .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
    setCargando(true);
    try {
      const payload = {
        ...seleccion,
        anio: anioNum,
        meses: mesesNormalizados,
        tipo_seleccion: modo,
        ids_usuarios: idsSeleccionados,
        incluir_pagados: "S",
        solo_con_deuda: soloSeleccion ? "N" : "S",
        permitir_meses_futuros: soloSeleccion ? "S" : "N"
      };

      const res = await api.post("/recibos/masivos", payload);
      const datosImpresion = (Array.isArray(res.data) ? res.data : []).map((row) => ({
        ...row,
        cargo_reimpresion: 0
      }));

      alConfirmar(datosImpresion);
      cerrarModal();
    } catch (error) {
      const errorText = typeof error?.response?.data === "string"
        ? error.response.data
        : (error?.response?.data?.error || error?.message || "Error al buscar recibos.");
      showFlash("danger", errorText);
    } finally {
      setCargando(false);
    }
  };

  const modalStyle = darkMode ? { backgroundColor: "#2b3035", color: "#fff", border: "1px solid #495057" } : {};
  const headerClass = `modal-header ${darkMode ? "bg-dark border-secondary text-white" : "bg-dark text-white"}`;
  const inputClass = `form-control ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const selectClass = `form-select ${darkMode ? "bg-dark text-white border-secondary" : ""}`;
  const btnOutlineClass = (active) => active ? "btn-primary" : (darkMode ? "btn-outline-light" : "btn-outline-secondary");

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog">
        <div className="modal-content" style={modalStyle}>
          <div className={headerClass}>
            <h5 className="modal-title">
              <FaPrint className="me-2"/>
              {soloSeleccion ? "Reimpresión de Recibos" : "Impresión Mensual"}
            </h5>
            <button className={`btn-close ${darkMode ? "btn-close-white" : "btn-close-white"}`} onClick={cerrarModal}></button>
          </div>
          <div className="modal-body">
            <form onSubmit={handleSubmit}>
              {!soloSeleccion && (
                <div className={`d-flex justify-content-around mb-4 border-bottom pb-3 ${darkMode ? "border-secondary" : ""}`}>
                  <button type="button" className={`btn btn-sm ${btnOutlineClass(modo === "seleccion")}`} onClick={() => setModo("seleccion")} disabled={idsSeleccionados.length === 0}>
                    <FaUsers className="mb-1 d-block mx-auto"/> Selección
                  </button>
                  <button type="button" className={`btn btn-sm ${btnOutlineClass(modo === "calle")}`} onClick={() => setModo("calle")}>
                    <FaBuilding className="mb-1 d-block mx-auto"/> Por Calle
                  </button>
                  <button type="button" className={`btn btn-sm ${btnOutlineClass(modo === "todos")}`} onClick={() => setModo("todos")}>
                    <FaLayerGroup className="mb-1 d-block mx-auto"/> Todos
                  </button>
                </div>
              )}

              {soloSeleccion && (
                <div className={`alert alert-info ${darkMode ? "bg-dark text-white border-secondary" : ""}`}>
                  Reimpresión para el contribuyente seleccionado en pantalla.
                  <div className="form-check form-switch mt-2 mb-0">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="switch-meses-futuros-reimpresion"
                      checked={permitirMesesFuturos}
                      onChange={(e) => setPermitirMesesFuturos(e.target.checked)}
                      disabled={cargando}
                    />
                  <label className="form-check-label" htmlFor="switch-meses-futuros-reimpresion">
                    Habilitar meses futuros (solicita permiso para Caja)
                  </label>
                </div>
                {cargandoHistorial && (
                  <div className="small mt-2">Cargando historial de recibos emitidos...</div>
                )}
                {!cargandoHistorial && periodosHistorial.length > 0 && (
                  <div className="small mt-2">
                    Ultimo recibo emitido detectado: <strong>{formatPeriodoLabel(periodosHistorial[0].anio, periodosHistorial[0].mes)}</strong>
                  </div>
                )}
              </div>
            )}

              {modo === "calle" && (
                <div className="mb-3">
                  <label className="form-label fw-bold">Seleccionar Calle</label>
                  <select className={selectClass} value={seleccion.id_calle} onChange={(e) => setSeleccion({ ...seleccion, id_calle: e.target.value })}>
                    <option value="">-- Seleccione --</option>
                    {calles.map((c) => <option key={c.id_calle} value={c.id_calle}>{c.nombre}</option>)}
                  </select>
                </div>
              )}

              <div className="row mb-3">
                <div className="col-12 mb-2">
                  <label className="form-label fw-bold">Meses</label>
                  <div className={`border rounded p-2 ${darkMode ? "border-secondary" : ""}`} style={{ maxHeight: "160px", overflowY: "auto" }}>
                    <div className="d-flex flex-wrap gap-2">
                      {opcionesMeses.map((m) => {
                        const periodoHistorial = historialPeriodosMap.get(`${anioSeleccionado}-${m.value}`) || null;
                        const estadoMeta = getPeriodoEstadoMeta(periodoHistorial?.estado, darkMode);
                        const checked = (seleccion.meses || []).includes(m.value);
                        return (
                          <label
                            key={m.value}
                            className="m-0"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.4rem",
                              padding: "0.15rem 0.25rem",
                              borderRadius: "0.45rem",
                              backgroundColor: checked
                                ? (darkMode ? "rgba(29, 78, 216, 0.14)" : "rgba(59, 130, 246, 0.10)")
                                : "transparent",
                              color: checked
                                ? (darkMode ? "#eff6ff" : "#1e3a8a")
                                : "inherit",
                              cursor: "pointer",
                              minWidth: "70px"
                            }}
                            title={estadoMeta ? `${m.label} ${anioSeleccionado}: ${estadoMeta.title}` : `${m.label} ${anioSeleccionado}`}
                          >
                            <input
                              className="form-check-input"
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleMes(m.value)}
                            />
                            <span
                              className="form-check-label ms-1 fw-semibold"
                              style={estadoMeta ? {
                                display: "inline-block",
                                padding: "0.02rem 0.28rem",
                                borderRadius: "0.3rem",
                                backgroundColor: estadoMeta.highlight,
                                color: estadoMeta.text,
                                lineHeight: 1.2
                              } : undefined}
                            >
                              {m.label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {opcionesMeses.length === 0 && (
                      <div className="small text-muted">
                        No hay meses habilitados para ese año. Active "Habilitar meses futuros" para adelantos.
                      </div>
                    )}
                  </div>
                </div>
                <div className="col-12">
                  <label className="form-label fw-bold">Año</label>
                  <input
                    type="number"
                    className={inputClass}
                    min={ultimoPeriodoEmitido.anio - 30}
                    max={permitirMesesNoEmitidos ? ultimoPeriodoEmitido.anio + 5 : ultimoPeriodoEmitido.anio}
                    value={seleccion.anio}
                    onChange={(e) => setSeleccion({ ...seleccion, anio: e.target.value })}
                  />
                </div>
              </div>

              <div className="d-flex justify-content-end gap-2">
                <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={cargando || (soloSeleccion && cargandoHistorial)}>
                  {cargando ? "Procesando..." : (soloSeleccion ? "Reimprimir" : "Imprimir")}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalImpresionMasiva;
