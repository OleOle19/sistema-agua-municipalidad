# Matriz y reglas para capturas del manual

Fecha de preparación: 11 de septiembre de 2026.

## 1. Objetivo

Esta matriz define las capturas que se producirán durante los bloques de Caja y
Administración. Evita imágenes duplicadas, datos personales expuestos y pasos
que no corresponden al rol del lector.

La captura no reemplaza la explicación: cada imagen tendrá un título, una frase
de contexto, pasos breves y un resultado esperado.

## 2. Reglas de seguridad y consistencia

- Usar cuentas de prueba para Admin principal, Admin secundario, Ventanilla,
  Operador de caja, Consulta y Brigada.
- Usar un contribuyente ficticio, por ejemplo **CONTRIBUYENTE DEMOSTRACIÓN**, con
  código reservado de prueba. No reutilizar datos de ciudadanos.
- No mostrar contraseñas, tokens, archivos `.env`, rutas privadas, direcciones IP,
  copias de seguridad ni nombres reales de operadores.
- Para capturar correcciones de pago, crear y revertir operaciones exclusivas del
  escenario de prueba.
- Usar navegador al 100 %, ventana de referencia de 1440 × 900 y tema claro.
- Capturar suficiente contexto para reconocer la pantalla, pero recortar barras
  del navegador, pestañas y contenido ajeno al sistema.
- Mantener el puntero fuera del texto importante y cerrar notificaciones que no
  formen parte del procedimiento.
- Marcar campos o botones con números discretos; no tapar importes ni estados.
- Añadir texto alternativo que describa la acción, no la decoración.

## 3. Convención de archivos

Formato:

`<area>-<numero>-<accion>-<rol>.webp`

Ejemplos:

- `caja-03-seleccionar-periodos-cajero.webp`
- `admin-06-asignar-rol-admin-principal.webp`
- `agua-04-editar-tarifa-ventanilla.webp`

Las imágenes finales se guardarán en una carpeta pública exclusiva del manual.
El original sin anotaciones se conservará fuera de la compilación solo mientras
dure la revisión.

## 4. Escenarios de prueba necesarios

| Escenario | Preparación mínima | Uso documental |
|---|---|---|
| U-01 Cuenta solicitada | Usuario ficticio en estado Pendiente | Alta, activación y asignación de rol |
| P-01 Predio estándar | Agua, desagüe, limpieza y administración activos | Registro y deuda habitual |
| P-02 Predio sin servicio | Un servicio con tarifa cero | Activación automática por tarifa |
| P-03 Tarifa personalizada | Importes claramente distintos a la tarifa base | Comprobación de deuda y cobro |
| D-01 Deuda pendiente | Tres meses consecutivos con saldo | Selección y cobro múltiple |
| D-02 Pago corregible | Pago de hoy hecho por Caja | Editar, anular y reingresar |
| D-03 Período adelantado | Mes futuro emitido | Etiquetas y límites de cobro |
| C-01 Servicio cortable | Predio con deuda y estado Con conexión | Corte, evidencia y acta |
| C-02 Servicio cortado | Predio de prueba en estado Cortado | Reconexión y reportes |
| F-01 Solicitud de campo | Cambio simple y foto ficticia | Aprobar, aplicar o rechazar |
| I-01 Archivo de prueba | Padrón reducido y validado | Vista previa de importación |

## 5. Capturas generales y de acceso

| ID | Archivo sugerido | Rol/estado | Qué debe mostrar |
|---|---|---|---|
| GEN-01 | `general-01-selector-modulos.webp` | Sin sesión | Selector municipal y los cuatro módulos |
| GEN-02 | `general-02-iniciar-sesion.webp` | Sin sesión | Usuario, contraseña e ingreso |
| GEN-03 | `general-03-solicitar-acceso.webp` | Sin sesión | Formulario de solicitud sin contraseña escrita |
| GEN-04 | `general-04-cambiar-contrasena.webp` | Sin sesión | Campos del cambio, todos vacíos |
| GEN-05 | `general-05-novedades.webp` | Sesión de prueba | Botón y panel de cambios del sistema |

## 6. Capturas de Caja Municipal

| ID | Archivo sugerido | Rol/estado | Qué debe mostrar |
|---|---|---|---|
| CAJ-01 | `caja-01-panel-agua-cajero.webp` | Caja | Resumen, pestañas, búsqueda, reporte y cierre |
| CAJ-02 | `caja-02-buscar-contribuyente-cajero.webp` | Caja + D-01 | Resultado seleccionado y saldos |
| CAJ-03 | `caja-03-periodos-cobro-cajero.webp` | Caja + D-01 | Vista anual y casillas disponibles |
| CAJ-04 | `caja-04-cobro-multiple-cajero.webp` | Caja + D-01 | Varios períodos, total y fecha |
| CAJ-05 | `caja-05-confirmar-cobro-cajero.webp` | Caja + D-01 | Método, confirmación y observación |
| CAJ-06 | `caja-06-seleccionar-anulacion-cajero.webp` | Caja + D-02 | Misma casilla en períodos pagados y botón Anular |
| CAJ-07 | `caja-07-reingreso-pendiente-cajero.webp` | Caja + D-02 | Etiqueta Reingreso pendiente |
| CAJ-08 | `caja-08-pago-reintegrado-cajero.webp` | Caja + D-02 | Etiqueta Reintegrado después del nuevo pago |
| CAJ-09 | `caja-09-editar-monto-cajero.webp` | Caja + D-02 | Acción Editar monto y comprobación solicitada |
| CAJ-10 | `caja-10-limite-fecha-cajero.webp` | Caja | Selector limitado a tres días anteriores |
| CAJ-11 | `caja-11-compensacion-admin.webp` | Admin + P-03 | Modalidad, advertencia y motivo |
| CAJ-12 | `caja-12-contingencia-ventanilla.webp` | Ventanilla | Interruptor y período sin recibo |
| CAJ-13 | `caja-13-reporte-diario.webp` | Caja | Filtros, movimientos y exportación |
| CAJ-14 | `caja-14-conteo-cierre.webp` | Caja | Sistema, declarado, diferencia y observación |
| CAJ-15 | `caja-15-panel-luz-cajero.webp` | Caja | Búsqueda y cobro desde Caja Luz |

## 7. Capturas de Agua y Administración

| ID | Archivo sugerido | Rol/estado | Qué debe mostrar |
|---|---|---|---|
| AGU-01 | `agua-01-panel-principal-ventanilla.webp` | Ventanilla | Menú, barra de herramientas y relación |
| AGU-02 | `agua-02-buscar-filtrar-ventanilla.webp` | Ventanilla | Búsqueda y filtro de conexión |
| AGU-03 | `agua-03-seleccion-multiple-ventanilla.webp` | Ventanilla | Varias filas seleccionadas y acción masiva |
| AGU-04 | `agua-04-detalle-arbitrios-consulta.webp` | Consulta | Años, períodos, estados y exportación |
| REG-01 | `registro-01-datos-contribuyente.webp` | Ventanilla | Identidad, sector y dirección ficticios |
| REG-02 | `registro-02-gestionar-calles.webp` | Ventanilla | Alta y edición de una calle de prueba |
| REG-03 | `registro-03-servicios-tarifa.webp` | Ventanilla + P-02 | Servicio desactivado por tarifa cero |
| REG-04 | `registro-04-programar-tarifa.webp` | Ventanilla | Interruptor, período e importes programados |
| DEU-01 | `deuda-01-registro-individual.webp` | Ventanilla + P-02 | Servicios reconocidos y total |
| DEU-02 | `deuda-02-registro-masivo.webp` | Ventanilla | Modos selección, calle y todos |
| CON-01 | `conexion-01-registrar-corte.webp` | Ventanilla + C-01 | Contribuyente, motivo y evidencias |
| CON-02 | `conexion-02-generar-acta.webp` | Ventanilla + C-01 | Selección previa a imprimir actas |
| CON-03 | `conexion-03-reportes-estado.webp` | Ventanilla | Período, alcance y formatos de salida |
| ADM-01 | `admin-01-menu-avanzado.webp` | Admin principal | Opciones exclusivas de administración |
| ADM-02 | `admin-02-usuarios-pendientes.webp` | Admin principal + U-01 | Cuenta pendiente sin revelar credenciales |
| ADM-03 | `admin-03-asignar-rol.webp` | Admin principal + U-01 | Nuevo rol, estado y Guardar |
| ADM-04 | `admin-04-auditoria-filtros.webp` | Admin secundario | Filtros, eventos y detalle |
| ADM-05 | `admin-05-respaldos-exportaciones.webp` | Admin secundario | Tipos de archivo y acciones, sin abrirlos |
| ADM-06 | `admin-06-importacion-vista-previa.webp` | Admin secundario + I-01 | Validación, aceptados, omitidos y rechazados |
| ADM-07 | `admin-07-bandeja-campo.webp` | Admin secundario + F-01 | Filtros, cambio propuesto y decisión |
| ADM-08 | `admin-08-fondo-inicio.webp` | Admin secundario | Vista previa, guardar y restaurar |

## 8. Capturas que no se deben producir

- Una contraseña visible en Gestión Usuarios.
- El contenido de `.env` o secretos de sesión.
- Una descarga SQL abierta o una lista de copias de seguridad con rutas reales.
- Datos personales reales usados solo para que la pantalla se vea “completa”.
- Una operación crítica ejecutada sobre producción para obtener la imagen.
- Capturas donde el rol no tenga permiso real para la acción mostrada.

## 9. Control de calidad por imagen

Antes de aprobar una captura se debe comprobar:

- [ ] Corresponde al ID y al rol de la matriz.
- [ ] No contiene información real o sensible.
- [ ] La interfaz está en su estado final, sin cargas incompletas.
- [ ] El texto principal puede leerse al tamaño normal del manual.
- [ ] La anotación no oculta controles, estados ni importes.
- [ ] Incluye título y texto alternativo.
- [ ] El paso anterior prepara exactamente el estado mostrado.
- [ ] El resultado descrito puede verificarse en la pantalla siguiente.

## 10. Resultado esperado para los siguientes bloques

La estructura del manual podrá usar estos mismos identificadores para enlazar
texto, imagen y prueba. Si una pantalla cambia antes de publicarse, solo se
repite la captura afectada y se conserva la trazabilidad del procedimiento.

## 11. Capturas publicadas en el bloque de Caja

La primera edición utiliza siete capturas representativas. Las restantes de la
matriz quedan reservadas para ampliar el manual si una prueba con usuarios
demuestra que hacen falta más detalles.

| Tema | Archivo publicado |
|---|---|
| Panel y búsqueda de Agua | `caja-01-panel-busqueda.png` |
| Vista anual de períodos | `caja-02-periodos-agua.png` |
| Selección de varios períodos | `caja-03-seleccion-cobro-agua.png` |
| Selección de un pago para anular | `caja-04-anulacion-pago-agua.png` |
| Compensación administrativa | `caja-05-compensacion-admin.png` |
| Conteo y cierre | `caja-06-conteo-cierre.png` |
| Panel de Caja Luz | `caja-07-panel-luz.png` |

Todas fueron tomadas desde la interfaz real en una sesión temporal de solo
lectura. Antes de guardar cada imagen se reemplazaron nombre, código, dirección,
usuario e importes. No se confirmó ningún cobro, anulación, compensación o cierre
para producirlas.
