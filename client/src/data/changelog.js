const CHANGELOG_ENTRIES = [
  {
    date: "21 de julio de 2026",
    title: "Jerarquía administrativa",
    changes: [
      "Se agregó el nivel de administrador secundario.",
      "El administrador secundario no tiene acceso a Caja.",
      "El administrador secundario consulta usuarios y reportes de cobranzas.",
      "Ventanilla conserva sus funciones y acceso a Caja.",
      "El administrador principal puede consultar y cambiar contraseñas.",
      "Las consultas y cambios de contraseña quedan auditados.",
      "Cada rol inicia sesión solo en los módulos que le corresponden.",
      "Las acciones se ejecutan sin ventanas de confirmación."
    ]
  },
  {
    date: "20 de julio de 2026",
    title: "Interfaz, reportes y auditoría",
    changes: [
      "Caja opera sin ventanas de confirmación.",
      "Reportes muestran primero gráficos y movimientos.",
      "Alertas y medios de pago ocupan menos espacio.",
      "Auditoría permite filtrar por usuario y compensaciones.",
      "Interfaz adaptable y sin modo oscuro.",
      "Se agregó el botón Novedades."
    ]
  },
  {
    date: "15 de julio de 2026",
    title: "Adelantos y seguridad",
    changes: [
      "Adelantos habilitados para el año siguiente.",
      "Proyección corregida hasta diciembre.",
      "Meses futuros corregidos para contribuyentes nuevos.",
      "Seguridad y auditoría reforzadas."
    ]
  },
  {
    date: "13 de julio de 2026",
    title: "Caja y multimedia",
    changes: [
      "Cobros ajustados al saldo real.",
      "Caja configurada solo para efectivo.",
      "Fondos de inicio admiten videos en bucle."
    ]
  },
  {
    date: "6 de julio de 2026",
    title: "Pantalla de inicio",
    changes: [
      "Fondo configurable desde administración.",
      "Efecto de agua para fondos de imagen."
    ]
  },
  {
    date: "26 de junio de 2026",
    title: "Recibos e historial",
    changes: [
      "Pagos históricos protegidos al activar servicios.",
      "Recibos duplicados corregidos.",
      "Recargos limitados a periodos válidos."
    ]
  }
];

export default CHANGELOG_ENTRIES;
