import { memo, useEffect, useState } from "react";
import api from "../api";
import { FaMoneyBillWave, FaUsers, FaExclamationCircle } from "react-icons/fa";

const StatCard = ({ titulo, valor, color, icon, darkMode }) => (
  <div
    className={`card shadow-sm ${darkMode ? `text-${color} border-${color}` : `text-white bg-${color}`}`}
    style={{ flex: 1, minWidth: "200px", backgroundColor: darkMode ? "#2b3035" : "" }}
  >
    <div className="card-body d-flex align-items-center justify-content-between">
      <div>
        <h6 className={`card-title text-uppercase small ${darkMode ? "opacity-100" : "opacity-75"}`}>{titulo}</h6>
        <h3 className="card-text fw-bold">{valor}</h3>
      </div>
      <div className="opacity-50 display-6">{icon}</div>
    </div>
  </div>
);

const DashboardStats = ({ triggerUpdate, darkMode, totalsOverride = null }) => {
  const [stats, setStats] = useState({ recaudado_hoy: 0, total_usuarios: 0, total_morosos: 0 });
  const totalUsuarios = Number(totalsOverride?.total_usuarios);
  const totalMorosos = Number(totalsOverride?.total_morosos);
  const totalUsuariosLabel = Number.isFinite(totalUsuarios) ? totalUsuarios : stats.total_usuarios;
  const totalMorososLabel = Number.isFinite(totalMorosos) ? totalMorosos : stats.total_morosos;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await api.get("/dashboard/resumen");
        if (!cancelled) setStats(res.data);
      } catch {
        console.error("Error stats");
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [triggerUpdate]);

  return (
    <div className="d-flex gap-3 flex-wrap">
      <StatCard
        titulo="Recaudado Hoy"
        valor={`S/. ${parseFloat(stats.recaudado_hoy).toFixed(2)}`}
        color="success"
        icon={<FaMoneyBillWave />}
        darkMode={darkMode}
      />
      <StatCard
        titulo="Total Usuarios"
        valor={totalUsuariosLabel}
        color="primary"
        icon={<FaUsers />}
        darkMode={darkMode}
      />
      <StatCard
        titulo="Morosos (2+ Meses)"
        valor={totalMorososLabel}
        color="danger"
        icon={<FaExclamationCircle />}
        darkMode={darkMode}
      />
    </div>
  );
};

export default memo(DashboardStats);
