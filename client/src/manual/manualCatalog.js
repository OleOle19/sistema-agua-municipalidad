export const MANUAL_ROLES = [
  { value: "TODOS", label: "Todos los perfiles" },
  { value: "ADMIN", label: "Admin principal" },
  { value: "ADMIN_AUX", label: "Admin secundario" },
  { value: "ADMIN_SEC", label: "Ventanilla" },
  { value: "CAJERO", label: "Operador de caja" },
  { value: "CONSULTA", label: "Consulta" }
];

export const MANUAL_SECTIONS = [
  { id: "inicio", label: "Primeros pasos" },
  { id: "caja", label: "Caja Municipal" },
  { id: "agua", label: "Sistema de Agua" },
  { id: "administracion", label: "Administración" },
  { id: "soporte", label: "Ayuda y seguridad" }
];

const allOfficeRoles = ["ADMIN", "ADMIN_AUX", "ADMIN_SEC", "CAJERO", "CONSULTA"];
const aguaReaders = ["ADMIN", "ADMIN_AUX", "ADMIN_SEC", "CONSULTA"];
const aguaOperators = ["ADMIN", "ADMIN_AUX", "ADMIN_SEC"];
const cajaRoles = ["ADMIN", "ADMIN_SEC", "CAJERO"];
const adminRoles = ["ADMIN", "ADMIN_AUX"];

export const MANUAL_ARTICLES = [
  {
    id: "como-usar-manual",
    section: "inicio",
    title: "Cómo usar este manual",
    summary: "Encuentre una tarea por nombre o filtre las instrucciones según su perfil.",
    roles: allOfficeRoles,
    keywords: ["inicio", "buscar", "navegar", "imprimir"],
    stage: "ready",
    content: [
      "Seleccione su perfil para ocultar tareas que no le corresponden.",
      "Escriba una acción en el buscador, por ejemplo: cobrar, tarifa, calle o usuario.",
      "Abra el tema desde el índice y siga los pasos en el orden indicado.",
      "Use Imprimir tema si necesita una copia de la instrucción que está consultando."
    ]
  },
  {
    id: "roles-y-accesos",
    section: "inicio",
    title: "Roles y accesos al sistema",
    summary: "Identifique qué módulo y funciones corresponden a cada nivel de usuario.",
    roles: allOfficeRoles,
    keywords: ["rol", "nivel", "permiso", "módulo", "acceso"],
    stage: "ready",
    content: [
      "Admin principal: controla todos los módulos y las correcciones sensibles.",
      "Admin secundario: administra Agua y consulta funciones avanzadas, pero no opera Caja.",
      "Ventanilla: atiende registros de Agua y puede realizar cobros ordinarios.",
      "Operador de caja: trabaja exclusivamente en Caja Municipal.",
      "Consulta: revisa información de Agua y Luz sin modificarla."
    ]
  },
  {
    id: "iniciar-sesion",
    section: "inicio",
    title: "Ingresar y cambiar contraseña",
    summary: "Acceda al módulo correcto y mantenga segura su cuenta.",
    roles: allOfficeRoles,
    keywords: ["login", "sesión", "contraseña", "módulo"],
    stage: "planned",
    phase: 4
  },
  {
    id: "caja-panel",
    section: "caja",
    title: "Conocer el panel de Caja",
    summary: "Ubique Caja Agua, Caja Luz, búsqueda, reportes y cierre.",
    roles: cajaRoles,
    keywords: ["panel", "resumen", "recaudado", "movimientos"],
    stage: "ready",
    guide: {
      before: [
        "Ingrese desde el módulo Caja Municipal con una cuenta autorizada.",
        "Confirme que en la cabecera aparezcan su nombre y el rol correcto."
      ],
      steps: [
        { title: "Elija el servicio", text: "Use Caja Agua o Caja Luz según el recibo que presenta el contribuyente." },
        { title: "Revise los indicadores", text: "Recaudado hoy y Movimientos hoy corresponden a la pestaña activa. Deuda en búsqueda cambia al seleccionar una persona." },
        { title: "Busque antes de cobrar", text: "La lista inicia vacía. Escriba un dato suficientemente específico y presione Buscar." },
        { title: "Seleccione la fila correcta", text: "Compruebe código, nombre, dirección y saldo. La fila elegida queda resaltada." }
      ],
      figures: [
        {
          src: "/manual/caja/caja-01-panel-busqueda.png",
          alt: "Panel de Caja Agua con un contribuyente de demostración seleccionado.",
          caption: "Panel de Caja Agua después de buscar y seleccionar un contribuyente."
        }
      ],
      notes: [
        { tone: "info", title: "Actualización", text: "Use el botón de recarga si otra ventanilla acaba de registrar una operación que todavía no aparece." }
      ],
      result: "El contribuyente correcto queda seleccionado y el botón Cobrar se habilita."
    }
  },
  {
    id: "caja-cobrar-agua",
    section: "caja",
    title: "Cobrar períodos de Agua",
    summary: "Busque al contribuyente, seleccione períodos y confirme el total.",
    roles: cajaRoles,
    keywords: ["cobro", "agua", "período", "deuda", "efectivo"],
    stage: "ready",
    guide: {
      before: [
        "Compruebe nombre, código municipal, dirección y deuda total.",
        "Confirme la fecha del cobro: Ventanilla usa hoy; Caja puede usar hoy o hasta tres días atrás; Admin principal puede usar fechas anteriores.",
        "Tenga el efectivo contado antes de confirmar."
      ],
      steps: [
        { title: "Abra Cobrar", text: "Con la fila seleccionada, presione Cobrar y espere a que termine la actualización de períodos." },
        { title: "Revise el año", text: "Use las flechas para cambiar de año. No asuma que la primera vista contiene toda la deuda." },
        { title: "Seleccione los períodos", text: "Marque una o varias casillas izquierdas. Solo los períodos pendientes y habilitados se suman al cobro." },
        { title: "Revise cada importe", text: "Monto a cobrar inicia con el saldo disponible. No escriba un importe mayor que el saldo." },
        { title: "Complete el pago", text: "Compruebe método, confirmación y observación. Actualmente el medio habilitado es Efectivo." },
        { title: "Confirme el total", text: "Compare Total seleccionado con el dinero recibido y recién entonces presione Cobrar." },
        { title: "Verifique el resultado", text: "Espere la notificación Pago registrado y confirme que la deuda del contribuyente se actualizó." }
      ],
      figures: [
        {
          src: "/manual/caja/caja-02-periodos-agua.png",
          alt: "Ventana de cobro de Agua con períodos pendientes y medios de pago.",
          caption: "Vista anual antes de seleccionar los períodos."
        },
        {
          src: "/manual/caja/caja-03-seleccion-cobro-agua.png",
          alt: "Dos períodos pendientes seleccionados para cobrarse juntos.",
          caption: "Las mismas casillas permiten cobrar uno o varios períodos."
        }
      ],
      notes: [
        { tone: "warning", title: "Evite duplicados", text: "Si la pantalla continúa procesando, no vuelva a presionar Cobrar. Espere el aviso final y recargue antes de repetir." }
      ],
      result: "Los períodos cobrados muestran saldo cero o su saldo restante, y el movimiento aparece en el reporte de la fecha seleccionada."
    }
  },
  {
    id: "caja-corregir-pago",
    section: "caja",
    title: "Anular, editar o reingresar un pago",
    summary: "Corrija pagos de Agua respetando el rol y el límite de fecha.",
    roles: ["ADMIN", "CAJERO"],
    keywords: ["anular", "reintegrado", "reingreso", "editar monto", "corregir"],
    stage: "ready",
    risk: "critical",
    guide: {
      before: [
        "Admin principal puede corregir pagos de cualquier fecha pasada.",
        "Operador de caja solo puede corregir pagos de hoy o de los tres días anteriores.",
        "Ventanilla no puede editar ni anular pagos.",
        "Prepare un motivo claro; la corrección quedará registrada en Auditoría."
      ],
      steps: [
        { title: "Localice el período pagado", text: "Abra Cobrar y cambie de año si es necesario. El período debe mostrar PAGADO." },
        { title: "Edite solo el importe", text: "Use Editar monto cuando la fecha y el período sean correctos, pero el importe registrado no lo sea." },
        { title: "Anule cuando deba retirar el pago", text: "Marque la casilla izquierda del período pagado. Puede marcar varios y luego presionar Anular." },
        { title: "Explique la corrección", text: "Ingrese un motivo comprensible para otra persona que revise la auditoría." },
        { title: "Reingrese el pago si corresponde", text: "El período quedará como REINGRESO PENDIENTE. Selecciónelo nuevamente, revise monto y fecha, y registre el cobro correcto." },
        { title: "Compruebe la etiqueta final", text: "Después del nuevo pago debe aparecer REINTEGRADO. Si permanece como eliminado, recargue y no repita la operación." }
      ],
      figures: [
        {
          src: "/manual/caja/caja-04-anulacion-pago-agua.png",
          alt: "Período pagado seleccionado con casilla roja y botón Anular habilitado.",
          caption: "La casilla izquierda cambia de función: en una fila PAGADO selecciona la anulación."
        }
      ],
      notes: [
        { tone: "danger", title: "Nunca corrija por aproximación", text: "Si desconoce el período, la fecha o el importe original, revise el reporte y Auditoría antes de modificarlo." },
        { tone: "info", title: "Cambio de fecha", text: "Para corregir la fecha no use Editar monto: anule el pago y regístrelo nuevamente con la fecha correcta." }
      ],
      result: "La corrección conserva trazabilidad y el saldo, el reporte y la etiqueta del período quedan coherentes."
    }
  },
  {
    id: "caja-cobrar-luz",
    section: "caja",
    title: "Cobrar períodos de Luz",
    summary: "Seleccione el suministro y registre el pago desde Caja Luz.",
    roles: cajaRoles,
    keywords: ["cobro", "luz", "suministro", "recibo"],
    stage: "ready",
    guide: {
      before: [
        "Confirme que el recibo corresponde a Luz y no a Agua.",
        "Tenga a mano zona, ID de usuario, nombre o dirección del suministro."
      ],
      steps: [
        { title: "Abra Caja Luz", text: "Seleccione la pestaña Caja Luz en la parte superior." },
        { title: "Busque el suministro", text: "Escriba zona, ID de usuario, nombre o dirección y presione Buscar." },
        { title: "Compruebe la identidad", text: "Revise zona, ID, nombre, dirección, meses de deuda y total antes de elegir la fila." },
        { title: "Abra el cobro", text: "Seleccione la fila y presione Cobrar." },
        { title: "Seleccione períodos", text: "Marque únicamente los recibos entregados o confirmados por el contribuyente." },
        { title: "Confirme", text: "Revise el total, registre el pago y espere la notificación de éxito." }
      ],
      figures: [
        {
          src: "/manual/caja/caja-07-panel-luz.png",
          alt: "Pestaña Caja Luz con el formulario de búsqueda vacío.",
          caption: "Caja Luz inicia sin resultados para evitar seleccionar un suministro por error."
        }
      ],
      notes: [
        { tone: "warning", title: "Correcciones", text: "La anulación y el reingreso explicados en el tema anterior corresponden a Caja Agua. No aplique ese procedimiento a Luz si la pantalla no ofrece la acción." }
      ],
      result: "El pago de Luz queda registrado y aparece en el reporte de Caja Luz."
    }
  },
  {
    id: "caja-contingencia-compensacion",
    section: "caja",
    title: "Contingencia y compensaciones",
    summary: "Use correctamente las modalidades excepcionales de Caja Agua.",
    roles: cajaRoles,
    keywords: ["contingencia", "compensación", "período faltante"],
    stage: "ready",
    risk: "critical",
    guide: {
      before: [
        "Use estas opciones únicamente cuando el flujo ordinario no resuelva el caso.",
        "Confirme el motivo y conserve el documento o autorización que respalda la excepción."
      ],
      steps: [
        { title: "Contingencia", text: "Actívela cuando Caja deba emitir un período faltante porque el contribuyente no trae un recibo ya generado. Revise año, mes y tarifa antes de cobrar." },
        { title: "Compensación", text: "Solo el Admin principal puede elegir esta modalidad. Seleccione los períodos y escriba un motivo específico." },
        { title: "Revise el efecto", text: "La compensación reduce la deuda y queda en Auditoría, pero no se suma al ingreso del reporte de Caja." },
        { title: "Confirme una sola vez", text: "Espere el resultado y verifique el detalle del contribuyente antes de continuar." }
      ],
      figures: [
        {
          src: "/manual/caja/caja-05-compensacion-admin.png",
          alt: "Modalidad Compensación seleccionada con su advertencia y campo de motivo.",
          caption: "La compensación está separada del cobro porque no representa ingreso de dinero."
        }
      ],
      notes: [
        { tone: "danger", title: "No sustituye un cobro", text: "No use Compensación para corregir un pago ni para cuadrar una diferencia de efectivo." }
      ],
      result: "La operación excepcional queda respaldada por un motivo y puede localizarse en Auditoría."
    }
  },
  {
    id: "caja-reporte-cierre",
    section: "caja",
    title: "Reporte, conteo y cierre diario",
    summary: "Compare el monto del sistema con el efectivo declarado y cierre el día.",
    roles: cajaRoles,
    keywords: ["reporte", "conteo", "cierre", "diferencia"],
    stage: "ready",
    risk: "critical",
    guide: {
      before: [
        "Finalice todos los cobros de Agua previstos para el día.",
        "Cuente el efectivo físicamente sin usar primero el total mostrado por el sistema.",
        "Separe y revise cualquier comprobante pendiente."
      ],
      steps: [
        { title: "Revise el reporte", text: "Abra Ver reporte y confirme fecha, movimientos y anulaciones del turno." },
        { title: "Abra Conteo y cierre", text: "El sistema muestra cuánto debería existir según los cobros registrados." },
        { title: "Declare el monto real", text: "Escriba el efectivo contado. La columna Diferencia compara su declaración con el sistema." },
        { title: "Investigue diferencias", text: "Si no es cero, no ajuste la cifra para hacerla coincidir. Revise cobros, anulaciones y dinero físico, y deje una observación." },
        { title: "Registre el cierre", text: "Confirme solo cuando la declaración y la observación sean correctas." },
        { title: "Verifique el estado", text: "El botón indicará que la caja está cerrada. No continúe cobrando con esa cuenta sin coordinación administrativa." }
      ],
      figures: [
        {
          src: "/manual/caja/caja-06-conteo-cierre.png",
          alt: "Ventana de conteo con monto del sistema, declarado y diferencia cero.",
          caption: "Ejemplo de cierre cuadrado: el monto declarado coincide y la diferencia es cero."
        }
      ],
      notes: [
        { tone: "warning", title: "Una diferencia también se registra", text: "Si después de revisar la diferencia permanece, describa el motivo conocido y comuníquelo al responsable. No oculte la diferencia cambiando el conteo real." }
      ],
      result: "El cierre queda registrado para la fecha y puede comprobarse posteriormente en los reportes."
    }
  },
  {
    id: "agua-buscar-contribuyente",
    section: "agua",
    title: "Buscar y consultar contribuyentes",
    summary: "Use la relación, filtros y detalle anual de arbitrios.",
    roles: aguaReaders,
    keywords: ["buscar", "contribuyente", "deuda", "detalle", "excel"],
    stage: "planned",
    phase: 4
  },
  {
    id: "agua-registrar-contribuyente",
    section: "agua",
    title: "Registrar un contribuyente y su predio",
    summary: "Complete identidad, sector, conexión y dirección sin duplicar registros.",
    roles: aguaOperators,
    keywords: ["nuevo", "registro", "predio", "dirección", "dni", "ruc"],
    stage: "planned",
    phase: 4
  },
  {
    id: "agua-calles",
    section: "agua",
    title: "Gestionar calles",
    summary: "Cree o corrija calles para mantener direcciones uniformes.",
    roles: aguaOperators,
    keywords: ["calle", "avenida", "jirón", "zona", "barrio"],
    stage: "planned",
    phase: 4
  },
  {
    id: "agua-editar-tarifa",
    section: "agua",
    title: "Editar servicios y tarifas",
    summary: "Active servicios, use tarifa personalizada o programe un cambio.",
    roles: aguaOperators,
    keywords: ["tarifa", "agua", "desagüe", "limpieza", "servicio", "cero"],
    stage: "planned",
    phase: 4,
    risk: "sensitive"
  },
  {
    id: "agua-registrar-deuda",
    section: "agua",
    title: "Registrar deuda individual o masiva",
    summary: "Genere períodos usando los servicios activos del predio.",
    roles: aguaOperators,
    keywords: ["deuda", "recibo", "individual", "masiva", "período"],
    stage: "planned",
    phase: 4,
    risk: "critical"
  },
  {
    id: "agua-reportes-impresion",
    section: "agua",
    title: "Reportes, impresión y reimpresión",
    summary: "Obtenga cobranzas, padrón, recibos y reportes de conexión.",
    roles: ["ADMIN", "ADMIN_AUX", "ADMIN_SEC"],
    keywords: ["reporte", "excel", "imprimir", "recibo", "padrón"],
    stage: "planned",
    phase: 4
  },
  {
    id: "agua-cortes-reconexion",
    section: "agua",
    title: "Cortes, actas y reconexión",
    summary: "Registre evidencia y cambie el estado de conexión de forma trazable.",
    roles: aguaOperators,
    keywords: ["corte", "reconectar", "acta", "evidencia", "conexión"],
    stage: "planned",
    phase: 4,
    risk: "sensitive"
  },
  {
    id: "admin-usuarios",
    section: "administracion",
    title: "Gestionar usuarios y solicitudes de acceso",
    summary: "Active cuentas y asigne el rol que corresponde a cada trabajador.",
    roles: adminRoles,
    keywords: ["usuario", "cuenta", "rol", "activar", "contraseña"],
    stage: "planned",
    phase: 4,
    risk: "critical"
  },
  {
    id: "admin-auditoria",
    section: "administracion",
    title: "Consultar la auditoría",
    summary: "Localice acciones por fecha, usuario, categoría o texto.",
    roles: ["ADMIN", "ADMIN_AUX", "ADMIN_SEC"],
    keywords: ["auditoría", "evento", "usuario", "exportar", "deshacer"],
    stage: "planned",
    phase: 4
  },
  {
    id: "admin-datos",
    section: "administracion",
    title: "Respaldos, exportaciones e importación",
    summary: "Proteja la información antes de operaciones que afectan muchos registros.",
    roles: adminRoles,
    keywords: ["backup", "respaldo", "exportar", "importar", "padrón", "historial"],
    stage: "planned",
    phase: 4,
    risk: "critical"
  },
  {
    id: "admin-campo",
    section: "administracion",
    title: "Revisar la Bandeja Campo",
    summary: "Apruebe, aplique o rechace solicitudes enviadas por la brigada.",
    roles: adminRoles,
    keywords: ["campo", "brigada", "solicitud", "aprobar", "rechazar", "foto"],
    stage: "planned",
    phase: 4,
    risk: "sensitive"
  },
  {
    id: "admin-fondo",
    section: "administracion",
    title: "Cambiar el fondo de inicio",
    summary: "Publique una imagen o video y restaure el fondo anterior cuando sea necesario.",
    roles: adminRoles,
    keywords: ["fondo", "inicio", "imagen", "video", "restaurar"],
    stage: "planned",
    phase: 4
  },
  {
    id: "soporte-alertas",
    section: "soporte",
    title: "Entender avisos y estados",
    summary: "Diferencie confirmaciones, advertencias, errores y operaciones en proceso.",
    roles: allOfficeRoles,
    keywords: ["aviso", "notificación", "error", "advertencia", "estado"],
    stage: "planned",
    phase: 4
  },
  {
    id: "soporte-sesion",
    section: "soporte",
    title: "Sesión, recarga y problemas frecuentes",
    summary: "Recupere el trabajo ante una sesión vencida o un problema de conexión.",
    roles: allOfficeRoles,
    keywords: ["sesión", "recargar", "conexión", "problema", "soporte"],
    stage: "planned",
    phase: 4
  }
];

export const getManualSection = (sectionId) => (
  MANUAL_SECTIONS.find((section) => section.id === sectionId)
);

export const getManualRoleLabel = (roleId) => (
  MANUAL_ROLES.find((role) => role.value === roleId)?.label || roleId
);
