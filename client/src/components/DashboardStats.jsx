import { useEffect, useState } from "react";
import api from "../api";
import { FaMoneyBillWave, FaUsers, FaExclamationCircle } from "react-icons/fa";

const DashboardStats = ({ triggerUpdate, darkMode }) => { 
  const [stats, setStats] = useState({ recaudado_hoy: 0, total_usuarios: 0, total_morosos: 0 });

  const cargarStats = async () => {
    try {
      const res = await api.get("/dashboard/resumen");
      setStats(res.data);
    } catch (error) { console.error("Error stats"); }
  };

  useEffect(() => { cargarStats(); }, [triggerUpdate]);

  // En Modo Oscuro: Fondo gris oscuro con borde y texto del color (Más sutil)
  // En Modo Claro: Fondo del color con texto blanco (Clásico)
  const Card = ({ titulo, valor, color, icon }) => (
    <div 
      className={`card mb-3 shadow-sm ${darkMode ? `text-${color} border-${color}` : `text-white bg-${color}`}`} 
      style={{ flex: 1, minWidth: '200px', backgroundColor: darkMode ? "#2b3035" : "" }}
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

  return (
    <div className="d-flex gap-3 mb-3 flex-wrap">
      <Card 
        titulo="Recaudado Hoy" 
        valor={`S/. ${parseFloat(stats.recaudado_hoy).toFixed(2)}`} 
        color="success" 
        icon={<FaMoneyBillWave />} 
      />
      <Card 
        titulo="Total Usuarios" 
        valor={stats.total_usuarios} 
        color="primary" 
        icon={<FaUsers />} 
      />
      <Card 
        titulo="Morosos (2+ Meses)" 
        valor={stats.total_morosos} 
        color="danger" 
        icon={<FaExclamationCircle />} 
      />
    </div>
  );
};

export default DashboardStats;
