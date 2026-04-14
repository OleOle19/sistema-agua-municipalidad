import { useState, useEffect } from "react";
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
const getUltimoPeriodoEmitido = () => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
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
  darkMode
}) => {
  const [calles, setCalles] = useState([]);
  const [cargando, setCargando] = useState(false);
  const soloSeleccion = modoOperacion === "reimpresion";
  const ultimoPeriodoEmitido = getUltimoPeriodoEmitido();
  const maxPeriodoEmitidoNum = getPeriodoNum(ultimoPeriodoEmitido.anio, ultimoPeriodoEmitido.mes);
  const [modo, setModo] = useState(soloSeleccion ? "seleccion" : (idsSeleccionados.length > 0 ? "seleccion" : "calle"));
  const [seleccion, setSeleccion] = useState({
    id_calle: "",
    meses: [ultimoPeriodoEmitido.mes],
    anio: ultimoPeriodoEmitido.anio
  });
  const [permitirMesesFuturos, setPermitirMesesFuturos] = useState(false);

  const anioSeleccionado = Number(seleccion.anio || ultimoPeriodoEmitido.anio);
  const permitirMesesNoEmitidos = soloSeleccion && permitirMesesFuturos;
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
      const anioPrev = Number(prev.anio || ultimoPeriodoEmitido.anio);
      const anioAjustado = anioPrev > ultimoPeriodoEmitido.anio ? ultimoPeriodoEmitido.anio : anioPrev;
      const mesesPrev = Array.isArray(prev.meses) ? prev.meses : [];
      const mesesFiltrados = mesesPrev.filter((m) => getPeriodoNum(anioAjustado, Number(m)) <= maxPeriodoEmitidoNum);
      const cambioAnio = String(prev.anio) !== String(anioAjustado);
      const cambioMeses = mesesFiltrados.length !== mesesPrev.length;
      if (!cambioAnio && !cambioMeses) return prev;
      return { ...prev, anio: anioAjustado, meses: mesesFiltrados };
    });
  }, [maxPeriodoEmitidoNum, permitirMesesNoEmitidos, ultimoPeriodoEmitido.anio]);

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
      return alert("Seleccione un contribuyente para reimprimir.");
    }
    if (modo === "calle" && !seleccion.id_calle) return alert("Seleccione una calle");
    if (!seleccion.meses || seleccion.meses.length === 0) return alert("Seleccione al menos un mes");

    const anioNum = Number(seleccion.anio || 0);
    if (!Number.isInteger(anioNum) || anioNum < 1900) return alert("Ingrese un año válido.");
    const mesesNormalizados = (seleccion.meses || [])
      .map((m) => Number(m))
      .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
    const mesesNoEmitidosSeleccionados = mesesNormalizados.filter((m) => esMesNoEmitido(m, anioNum));
    if (mesesNoEmitidosSeleccionados.length > 0 && !permitirMesesNoEmitidos) {
      return alert("Solo se permiten meses ya emitidos. Active \"Habilitar meses futuros\" para adelantos.");
    }

    setCargando(true);
    try {
      const payload = {
        ...seleccion,
        anio: anioNum,
        meses: mesesNormalizados,
        tipo_seleccion: modo,
        ids_usuarios: idsSeleccionados,
        incluir_pagados: "S",
        permitir_meses_futuros: (soloSeleccion && permitirMesesFuturos) ? "S" : "N"
      };

      let mensajePermiso = "";
      const debeSolicitarPermisoCaja = soloSeleccion
        && permitirMesesNoEmitidos
        && mesesNoEmitidosSeleccionados.length > 0
        && Array.isArray(idsSeleccionados)
        && idsSeleccionados.length === 1;

      if (debeSolicitarPermisoCaja) {
        try {
          const permisoRes = await api.post("/caja/permisos-adelantado/solicitar", {
            id_contribuyente: Number(idsSeleccionados[0]),
            anio: anioNum,
            meses: mesesNoEmitidosSeleccionados,
            origen: "VENTANILLA_REIMPRESION",
            motivo: "Habilitacion de meses futuros desde reimpresion en ventanilla."
          });
          mensajePermiso = String(permisoRes?.data?.mensaje || "").trim();
        } catch (permisoErr) {
          const statusPermiso = Number(permisoErr?.response?.status || 0);
          const errorPermiso = String(permisoErr?.response?.data?.error || "").trim();
          const permisoNoRequerido = statusPermiso === 400
            && /periodos?\s+futuros?/i.test(errorPermiso)
            && /caja/i.test(errorPermiso);
          if (!permisoNoRequerido) {
            throw permisoErr;
          }
        }
      }

      let datosImpresion = [];
      try {
        const res = await api.post("/recibos/masivos", payload);
        datosImpresion = (Array.isArray(res.data) ? res.data : []).map((row) => ({
          ...row,
          cargo_reimpresion: 0
        }));
      } catch (error) {
        if (debeSolicitarPermisoCaja && Number(error?.response?.status || 0) === 404) {
          alert(`${mensajePermiso || "Solicitud enviada a Caja."}\nNo se encontraron recibos para imprimir en los meses seleccionados.`);
          cerrarModal();
          return;
        }
        throw error;
      }

      alConfirmar(datosImpresion);
      if (mensajePermiso) {
        alert(`${mensajePermiso}\nCaja ya puede cobrar esos meses para el contribuyente seleccionado.`);
      }
      cerrarModal();
    } catch (error) {
      alert(error.response?.data?.error || "Error al buscar recibos.");
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
                      {opcionesMeses.map((m) => (
                        <label key={m.value} className="form-check form-check-inline m-0">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={(seleccion.meses || []).includes(m.value)}
                            onChange={() => toggleMes(m.value)}
                          />
                          <span className="form-check-label ms-1">{m.label}</span>
                        </label>
                      ))}
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
                <button type="submit" className="btn btn-primary" disabled={cargando}>
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


