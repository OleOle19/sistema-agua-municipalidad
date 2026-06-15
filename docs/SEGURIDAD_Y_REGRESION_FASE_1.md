# Seguridad y Regresion - Fase 1

## Objetivo

Esta fase prioriza reducir riesgo sin cambiar rutas publicas ni el contrato principal de autenticacion.

## Cambios aplicados

- Se deja de escribir `password_visible` en Agua y Luz.
- Se deja de devolver `password_visible` en endpoints admin de usuarios.
- El login conserva compatibilidad con passwords legacy en texto plano guardados en `password`, pero al iniciar sesion los migra a hash bcrypt.
- Se limpian nombres de archivo peligrosos en uploads antes de escribir a disco.
- Se valida tipo de archivo en mas flujos de importacion, incluyendo historial Excel.

## Matriz operativa de roles

Basada en `server/index.js` y su `ACCESS_RULES`.

- `ADMIN`
  - Usuarios admin, backup, pagos anulados, comparaciones legacy, importacion de padron e historial, exportaciones completas, borrado de contribuyentes/recibos/calles, auditoria con deshacer.
- `ADMIN_SEC`
  - Aprobacion y reporte de solicitudes de campo, adjuntos del sistema, importacion de verificacion de campo, auditoria lectura/exportacion, exportaciones operativas, alta/edicion de contribuyentes y calles, generacion de recibos, ordenes de cobro, anulacion de ordenes.
- `CAJERO`
  - Registro, edicion y anulacion de pagos, reimpresion/codigos, reporte de caja, caja diaria, cierres, conteo de efectivo, alertas y actas de corte.
- `CONSULTA`
  - Dashboard, lectura de contribuyentes, historial y recibos pendientes, arbitrios.
- `BRIGADA`
  - Busqueda y snapshot de campo, registro de solicitudes, lectura basica de calles.

## Checklist de regresion minima

Ejecutar antes de pasar a la siguiente fase.

1. Login valido e invalido en Agua.
2. Login valido e invalido en Luz.
3. Cambio de password propio en Agua y Luz.
4. Listado admin de usuarios en Agua y Luz.
5. Edicion admin de rol, estado y password en Agua y Luz.
6. Registro de pago, edicion de pago y anulacion de pago.
7. Impresion mensual, reimpresion y recibos masivos.
8. Reporte de caja diario, mensual y por rango.
9. Importacion de padron, historial y verificacion de campo con archivos validos e invalidos.
10. Exportaciones y backup.

## Criterios de aceptacion de esta fase

- No se muestran contraseñas visibles en ninguna pantalla admin.
- Los usuarios existentes pueden seguir ingresando aunque vengan de password legacy.
- Los uploads invalidos fallan con mensaje claro y limpian temporales.
- Caja, pagos y reimpresion siguen operativos.
