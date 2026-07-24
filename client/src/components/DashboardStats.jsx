import { memo, useEffect, useState } from "react";
import api from "../api";
import { FaMoneyBillWave, FaUsers, FaExclamationCircle } from "react-icons/fa";

const StatCard = ({ titulo, valor, color, icon }) => (
  <div
    className={`card shadow-sm text-white bg-${color} dashboard-stat-card`}
    style={{ flex: 1, minWidth: "200px" }}
  >
    <div className="card-body d-flex align-items-center justify-content-between">
      <div>
        <div className="card-title text-uppercase small fw-semibold dashboard-stat-card__label">{titulo}</div>
        <div className="card-text h3 mb-0 fw-bold">{valor}</div>
      </div>
      <div className="dashboard-stat-card__icon display-6" aria-hidden="true">{icon}</div>
    </div>
  </div>
);

const DashboardStats = ({ triggerUpdate, totalsOverride = null }) => {
  const [stats, setStats] = useState({ recaudado_hoy: 0, total_usuarios: 0, total_morosos: 0 });
  const totalUsuarios = Number(totalsOverride?.total_usuarios);
  const hasTotalMorosos = totalsOverride?.total_morosos !== null
    && totalsOverride?.total_morosos !== undefined;
  const totalMorosos = hasTotalMorosos ? Number(totalsOverride.total_morosos) : null;
  const totalUsuariosLabel = Number.isFinite(totalUsuarios) ? totalUsuarios : stats.total_usuarios;
  const totalMorososLabel = totalMorosos === null
    ? "…"
    : (Number.isFinite(totalMorosos) ? totalMorosos : stats.total_morosos);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await api.get("/dashboard/recaudado-hoy");
        if (!cancelled) {
          setStats((current) => ({
            ...current,
            recaudado_hoy: Number(res?.data?.recaudado_hoy || 0)
          }));
        }
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
      />
      <StatCard
        titulo="Total Usuarios"
        valor={totalUsuariosLabel}
        color="primary"
        icon={<FaUsers />}
      />
      <StatCard
        titulo="Morosos (2+ Meses)"
        valor={totalMorososLabel}
        color="danger"
        icon={<FaExclamationCircle />}
      />
    </div>
  );
};

export default memo(DashboardStats);
