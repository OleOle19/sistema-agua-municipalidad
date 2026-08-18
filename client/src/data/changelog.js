const CHANGELOG_ENTRIES = [
  {
    date: "18 de agosto de 2026",
    title: "Caja y reportes más ágiles",
    changes: [
      "Los avisos de cobro muestran contribuyente, periodo y monto total.",
      "Caja ya no abre ni ofrece formatos de impresión al cobrar.",
      "Los gráficos permiten recorrer todos los resultados sin ocupar más espacio.",
      "Se eliminó el cierre automático de Caja y los cobros posteriores a las 4:30 p. m. generan una alerta.",
      "Las notificaciones tienen un diseño más claro y la sesión de Caja admite 49 minutos de inactividad.",
      "Los cambios de tarifa actualizan deudas sin abonos y meses futuros; los recibos con pagos conservan sus importes.",
      "El detalle de arbitrios abre más rápido y ya no mezcla información al cambiar de contribuyente.",
      "La relación y el tablero consultan resúmenes financieros verificados para cargar con mayor rapidez.",
      "Los filtros por tipo de Auditoría funcionan correctamente y el detalle puede cerrarse con una X."
    ]
  },
  {
    date: "7 de agosto de 2026",
    title: "Cierre automático de sesión",
    changes: [
      "La sesión se cierra después de 30 minutos sin actividad.",
      "El sistema avisa antes del cierre para permitir continuar trabajando.",
      "Cerrar la pestaña, el navegador o apagar la PC elimina la sesión."
    ]
  },
  {
    date: "24 de julio de 2026",
    title: "Carga más rápida en la red municipal",
    changes: [
      "Los archivos y consultas grandes ahora se transfieren comprimidos.",
      "La barra principal conserva su tamaño al seleccionar contribuyentes.",
      "La relación de contribuyentes aparece antes mientras los saldos se actualizan.",
      "Las credenciales antiguas disponibles se migran al consultarlas.",
      "El detalle de Auditoría muestra solo la información operativa necesaria.",
      "Los arbitrios pendientes respetan la distribución configurada entre servicios, administración y extras.",
      "El formulario de edición permanece estable mientras actualiza sus datos."
    ]
  },
  {
    date: "22 de julio de 2026",
    title: "Rendimiento y accesibilidad",
    changes: [
      "Las tablas y pantallas cargan con menos elementos ocultos.",
      "Mejoró la legibilidad de tarjetas, importes y botones.",
      "Se reforzaron la navegación por teclado y la estructura de las pantallas.",
      "El logotipo de interfaz ahora carga más rápido.",
      "Se reforzó la protección web y se evitó la indexación del sistema interno."
    ]
  },
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
