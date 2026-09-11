# Inventario funcional y permisos

Fecha de verificación: 11 de septiembre de 2026.

## 1. Propósito

Este inventario define qué debe explicar el manual de usuario, quién puede hacer
cada tarea y qué operaciones necesitan advertencias especiales. Fue contrastado
con la navegación y las reglas de permisos vigentes del sistema.

No modifica permisos ni comportamiento. Si el código cambia, este inventario
debe revisarse antes de actualizar las instrucciones o las capturas.

## 2. Perfiles oficiales

Los nombres que se usarán en el manual son los que aparecen actualmente en Agua
y Caja Municipal.

| Nivel | Rol del sistema | Nombre para el usuario | Responsabilidad principal |
|---|---|---|---|
| 1 | `ADMIN` | Admin principal | Control total, correcciones sensibles y configuración |
| 2 | `ADMIN_AUX` | Admin secundario | Administración de Agua y consulta ampliada |
| 3 | `ADMIN_SEC` | Ventanilla | Atención, registro y operación ordinaria |
| 4 | `CAJERO` | Operador de caja | Cobros y cierre de Caja Municipal |
| 5 | `CONSULTA` | Consulta | Lectura de información sin cambios |
| 6 | `BRIGADA` | Brigada de campo | Registro de verificaciones desde App Campo |

### Acceso por módulo

| Perfil | Agua | Luz | Caja Municipal | App Campo |
|---|:---:|:---:|:---:|:---:|
| Admin principal | Sí | Sí | Sí | Sí |
| Admin secundario | Sí | No | No | No |
| Ventanilla | Sí | Sí | Sí | No |
| Operador de caja | No | No | Sí | No |
| Consulta | Sí | Sí | No | No |
| Brigada de campo | No | No | No | Sí |

El acceso al módulo prevalece sobre cualquier botón interno. Por ejemplo, que
una función de reportes admita un rol no significa que ese rol pueda entrar por
una ruta que no le corresponde.

## 3. Clasificación de las tareas

| Marca | Tipo | Tratamiento en el manual |
|---|---|---|
| I | Informativa | Se puede consultar sin alterar información |
| O | Operativa | Registra trabajo ordinario y deja trazabilidad |
| S | Sensible | Cambia datos, saldos, accesos o estados; requiere comprobación |
| C | Crítica | Elimina, importa, compensa, revierte o afecta muchos registros |

Las tareas S y C deberán incluir una sección “Antes de confirmar”. Las tareas C
solo se mostrarán en capítulos para Administración.

## 4. Matriz de funciones de Agua

Leyenda: **Sí** puede ejecutar; **Ver** solo consulta; **—** no está disponible.

| Función | Admin principal | Admin secundario | Ventanilla | Consulta | Tipo |
|---|:---:|:---:|:---:|:---:|:---:|
| Buscar, filtrar y ordenar contribuyentes | Sí | Sí | Sí | Sí | I |
| Ver el detalle anual de arbitrios | Sí | Sí | Sí | Sí | I |
| Exportar el detalle individual a Excel | Sí | Sí | Sí | Sí | I |
| Registrar contribuyente y predio | Sí | Sí | Sí | — | O |
| Editar datos, dirección, servicios y tarifa | Sí | Sí | Sí | — | S |
| Eliminar contribuyente completo | Sí | Sí | — | — | C |
| Crear o editar calles | Sí | Sí | Sí | — | S |
| Eliminar calles | Sí | Sí | — | — | C |
| Registrar deuda individual | Sí | Sí | Sí | — | S |
| Registrar deuda masiva por selección, calle o padrón | Sí | Sí | Sí | — | C |
| Eliminar una deuda pendiente | Sí | Sí | — | — | C |
| Ver cobranzas | Sí | Sí | Sí | — | I |
| Descargar padrón en Excel | Sí | Sí | Sí | — | I |
| Impresión mensual | Sí | Sí | — | — | C |
| Reimpresión de recibos | Sí | Sí | Sí | — | S |
| Registrar corte con evidencia | Sí | Sí | Sí | — | S |
| Reconectar un servicio | Sí | Sí | Sí | — | S |
| Generar actas de corte | Sí | Sí | Sí | — | S |
| Reportes por estado de conexión | Sí | Sí | Sí | — | I |
| Consultar auditoría | Sí | Sí | Sí | — | I |
| Deshacer desde auditoría una operación de Agua | Sí | Sí | — | — | C |
| Deshacer desde auditoría una operación de Caja | Sí | — | — | — | C |
| Consultar usuarios del sistema | Sí | Ver | — | — | I |
| Cambiar rol, estado o contraseña de un usuario | Sí | — | — | — | C |
| Eliminar un usuario del sistema | Sí | — | — | — | C |
| Respaldos y exportaciones avanzadas | Sí | Sí | — | — | C |
| Cambiar el fondo de inicio | Sí | Sí | — | — | S |
| Importar padrón o historial | Sí | Sí | — | — | C |
| Revisar y procesar la Bandeja Campo | Sí | Sí | — | — | S |

El Operador de caja y la Brigada no aparecen en esta tabla porque sus accesos
oficiales son Caja Municipal y App Campo, respectivamente.

## 5. Matriz de funciones de Caja Municipal

| Función | Admin principal | Ventanilla | Operador de caja | Tipo |
|---|:---:|:---:|:---:|:---:|
| Entrar a Caja Agua y Caja Luz | Sí | Sí | Sí | O |
| Buscar y seleccionar un contribuyente | Sí | Sí | Sí | I |
| Cobrar uno o varios períodos | Sí | Sí | Sí | S |
| Registrar cobro con fecha de hoy | Sí | Sí | Sí | S |
| Registrar cobro en una fecha anterior | Sin límite anterior | — | Hasta 3 días | C |
| Editar el monto de un pago de Agua | Sí | — | Hasta 3 días | C |
| Anular uno o varios pagos de Agua | Sí | — | Hasta 3 días | C |
| Reingresar un pago anulado de Agua | Sí | — | Hasta 3 días | C |
| Registrar una compensación de deuda de Agua | Sí | — | — | C |
| Activar contingencia para emitir un período faltante | Sí | Sí | Sí | C |
| Ver el reporte diario | Sí | Sí | Sí | I |
| Realizar conteo y cierre de Agua | Sí | Sí | Sí | C |

Notas operativas verificadas:

- La misma casilla izquierda selecciona un período pendiente para cobrar o uno
  pagado para anular.
- La corrección por parte de Caja está limitada a la fecha actual y los tres
  días anteriores. Ventanilla cobra, pero no corrige pagos.
- El Admin principal puede registrar compensaciones. Estas reducen deuda y
  quedan en auditoría, pero no forman parte del ingreso de Caja.
- La interfaz vigente ofrece “Efectivo” como medio de pago habilitado. El manual
  no presentará otros medios hasta que estén activados en producción.
- La anulación y el reingreso descritos en esta primera edición corresponden a
  Caja Agua. Caja Luz tendrá instrucciones específicas según sus controles
  vigentes.

## 6. Inventario de pantallas y tareas

| ID | Área | Tarea que debe aprender el usuario | Resultado esperado | Tipo |
|---|---|---|---|:---:|
| GEN-01 | Inicio | Elegir el módulo correspondiente al trabajo | Se abre el acceso de Agua, Luz, Caja o Campo | I |
| GEN-02 | Acceso | Iniciar sesión y cambiar contraseña | Sesión iniciada o contraseña actualizada | S |
| GEN-03 | Acceso | Solicitar una cuenta nueva | Solicitud Brigada en estado Pendiente | S |
| ADM-01 | Usuarios | Activar la solicitud y asignar el rol correcto | Usuario Activo con acceso limitado por su rol | C |
| AGU-01 | Deuda tributaria | Buscar por datos del contribuyente y filtrar conexión | Relación reducida al criterio indicado | I |
| AGU-02 | Deuda tributaria | Seleccionar uno o varios contribuyentes | Fila o grupo preparado para una acción | O |
| AGU-03 | Arbitrios | Abrir el detalle anual y exportarlo | Historial correcto del contribuyente | I |
| REG-01 | Registro | Crear contribuyente, predio y dirección | Nuevo registro con código municipal | S |
| REG-02 | Calles | Crear o corregir una calle | Calle disponible en formularios | S |
| REG-03 | Servicios | Definir servicios activos y tarifas | Predio con tarifa coherente; monto cero desactiva servicio | S |
| REG-04 | Edición | Corregir identidad, dirección o titularidad | Ficha actualizada con motivo trazable | S |
| DEU-01 | Deuda | Generar una deuda individual | Recibo del período creado con servicios activos | S |
| DEU-02 | Deuda | Generar deuda masiva | Recibos creados para selección, calle o padrón | C |
| DEU-03 | Deuda | Eliminar una deuda pendiente | Recibo pendiente eliminado con auditoría | C |
| CAJ-01 | Caja | Buscar y revisar saldo antes del cobro | Contribuyente y deuda correctos seleccionados | I |
| CAJ-02 | Caja Agua | Cobrar uno o varios períodos | Pago registrado y saldo actualizado | S |
| CAJ-03 | Caja Agua | Editar, anular o reingresar un pago | Corrección trazable y etiquetas actualizadas | C |
| CAJ-04 | Caja Agua | Usar contingencia o compensación | Operación excepcional registrada con motivo | C |
| CAJ-05 | Caja Luz | Cobrar períodos pendientes | Pago de Luz registrado | S |
| CAJ-06 | Caja | Ver reporte, contar y cerrar | Declaración comparada y caja cerrada | C |
| REP-01 | Reportes | Consultar cobranzas por fecha y usuario | Reporte filtrado y exportable | I |
| REP-02 | Impresión | Imprimir o reimprimir recibos | Documento correcto sin duplicar cobro | S |
| CON-01 | Conexiones | Registrar corte y evidencia | Estado Cortado y evidencia guardada | S |
| CON-02 | Conexiones | Reconectar servicio | Estado Con conexión restaurado | S |
| CON-03 | Conexiones | Generar actas y reportes | Documento o archivo con el grupo correcto | S |
| AUD-01 | Auditoría | Filtrar, revisar detalle y exportar | Trazabilidad localizada | I |
| AUD-02 | Auditoría | Deshacer una operación compatible | Reversión registrada con motivo | C |
| SYS-01 | Datos | Descargar padrón, finanzas o respaldo | Archivo descargado y custodiado | C |
| SYS-02 | Datos | Importar padrón o historial | Vista previa revisada y datos aplicados | C |
| SYS-03 | Campo | Aprobar, aplicar o rechazar solicitudes | Solicitud resuelta con trazabilidad | S |
| SYS-04 | Presentación | Cambiar o restaurar el fondo de inicio | Nuevo fondo publicado | S |

## 7. Flujos que requieren especial cuidado

### Alta de un usuario del sistema

1. La persona usa “Solicitar acceso” e indica nombre, usuario y contraseña.
2. El sistema crea la cuenta como **Brigada de campo** y **Pendiente**; todavía no
   debe asumirse que tiene acceso administrativo.
3. El Admin principal abre “Gestión Usuarios”, asigna el rol solicitado y cambia
   el estado a **Activo**.
4. Antes de guardar, verifica que el rol corresponda a las funciones laborales.

El Admin secundario puede consultar esta pantalla, pero solo el Admin principal
puede cambiar roles, estados, contraseñas o eliminar cuentas.

### Cambio de tarifa y servicios

- El usuario debe comprobar el predio y los servicios antes de guardar.
- Una tarifa de servicio igual a cero desactiva automáticamente ese servicio;
  un importe mayor que cero lo activa.
- Un cambio programado exige revisar su período de inicio.
- Las deudas o pagos ya existentes pueden conservar reglas históricas. El manual
  no debe prometer que una edición reescribirá operaciones pagadas.

### Cobro, anulación y reingreso

- Se comprueban nombre, código, período, saldo, fecha y total antes de cobrar.
- Un período pagado se selecciona con la misma casilla para anularlo, siempre que
  el rol y la fecha permitan la corrección.
- Para corregir la fecha, primero se anula y luego se registra nuevamente.
- Tras anular, el período queda como reingreso pendiente hasta registrar el pago
  de nuevo; después debe mostrarse como Reintegrado.

### Importaciones y deuda masiva

- Siempre se revisan alcance, período, archivo y vista previa.
- No se usa información de producción para ensayar el procedimiento.
- El manual técnico incluirá el respaldo previo, la recuperación y las
  comprobaciones de base de datos; el manual de usuario solo cubrirá el flujo
  visible y las decisiones operativas.

## 8. Vocabulario oficial del manual

| Término | Definición para el usuario |
|---|---|
| Contribuyente | Persona o entidad responsable del predio registrado |
| Predio | Inmueble al que pertenecen dirección, conexión, servicios y tarifa |
| Período | Mes y año al que corresponde una deuda o pago |
| Deuda | Importe pendiente de un período emitido |
| Abono | Importe pagado y aplicado al período |
| Adelantado | Período futuro emitido antes de ser exigible |
| Anulación | Corrección que retira un pago y restablece el saldo correspondiente |
| Reingreso | Registro nuevamente realizado después de una anulación |
| Reintegrado | Estado visible después de completar correctamente el reingreso |
| Compensación | Cancelación administrativa de deuda que no ingresa al reporte de Caja |
| Contingencia | Emisión excepcional de un período faltante desde Caja |
| Corte | Suspensión registrada del servicio con motivo y evidencia |
| Auditoría | Historial de acciones relevantes realizadas por los usuarios |
| Cierre | Declaración y comparación final de los movimientos de Caja del día |

## 9. Decisiones documentales tomadas

1. El manual utilizará “año”, “período”, “contraseña”, “desagüe” y demás textos
   con ortografía española, aunque una pantalla antigua pudiera mostrar una
   variante sin tilde.
2. No se documentará el menú antiguo de Caja dentro de Agua, porque está
   deshabilitado. Los cobros se explicarán desde Caja Municipal.
3. Los botones que solo muestran iconos se identificarán por su nombre y su
   posición, no únicamente por color.
4. Las instrucciones se separarán por rol y ocultarán capítulos no pertinentes
   en la futura vista del manual.
5. El módulo Luz no reutilizará esta tabla de niveles hasta armonizar o documentar
   expresamente sus nombres históricos.

## 10. Trazabilidad técnica de este inventario

Las reglas se verificaron principalmente en:

- `client/src/AguaApp.jsx`
- `client/src/caja/CajaMunicipalApp.jsx`
- `client/src/caja/cobroAguaRules.js`
- `client/src/components/LoginPage.jsx`
- `client/src/components/ModalUsuarios.jsx`
- `server/role-policy.js`
- `server/index.js`

Esta lista es para mantenimiento del documento; no se mostrará en el manual
operativo publicado.
