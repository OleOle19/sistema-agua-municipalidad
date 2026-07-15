# Estado de hallazgos prioritarios

Actualizado: 2026-07-15. Este seguimiento excluye expresamente la conciliacion de sobrepagos y las inconsistencias financieras historicas.

| Hallazgo | Estado | Evidencia / pendiente |
| --- | --- | --- |
| Cambio publico de contraseña sin clave actual | Resuelto | Agua y Luz exigen `password_actual`; la interfaz tambien la solicita y envia. |
| Contraseñas visibles en Luz | Resuelto | Bootstrap sin clave predeterminada, sin escritura en texto plano y columna `password_visible` eliminada en ambas bases. |
| Publicacion y secretos debiles | Resuelto en aplicacion y equipo local | Arranque estricto, JWT de 64 caracteres, `CAMPO_PUBLIC_ONLY=1` y despliegue con rotacion segura. El acceso remoto completo debe usar VPN o HTTPS propio. |
| Migraciones con checksum roto y DDL destructivo al arrancar | Resuelto | Agua 10/10 y Luz 5/5. La limpieza RENIEC paso a una migracion versionada y el servidor bloquea el arranque si hay migraciones pendientes o inconsistentes. |
| Adjuntos personales versionados | Resuelto | `server/uploads/` esta ignorado y sin archivos rastreados. El historial de todas las ramas remotas fue reescrito y verificado sin objetos de adjuntos personales. |
| Backups incompletos | Resuelto localmente / operacion externa pendiente | Backup verificado con Agua, Luz, seis adjuntos y manifiesto SHA-256. Existe espejo obligatorio configurable; falta designar y validar un medio cifrado en otro dispositivo fisico y ejecutar el simulacro mensual de restauracion. Una particion del mismo disco no aporta redundancia ante una falla fisica. |
| Datos personales offline tras cerrar sesion | Resuelto | Campo borra snapshot, calles, contribuyentes, cola y registros recientes; advierte antes si existen solicitudes pendientes. |
| Dependencias vulnerables | Resuelto | Auditoria npm de produccion: 0 vulnerabilidades en backend y frontend. `nodemon` quedo solo como dependencia de desarrollo. |
| Contradiccion de rol `ADMIN_SEC` en Caja | Resuelto | Administrador secundario / Ventanilla puede entrar a Caja, coherente con la jerarquia del backend. |
| Deuda automatica dependiente de una ventana de minutos | Resuelto | Recupera el ultimo periodo cerrado al volver a encenderse y no reabre periodos que ya tengan recibos. Incluye pruebas unitarias. |
| Calidad y pruebas | Mejorado | Lint 0 errores, 7 pruebas backend y CI para audit, test, lint y build. El monolito `server/index.js` sigue siendo deuda tecnica para una refactorizacion gradual. |
| Accesibilidad y operacion | Mejorado | Idioma/titulo/favicon correctos, formularios de acceso asociados, healthcheck de BD/migraciones/backups y manejadores de apagado. Aun conviene ampliar asociaciones de etiquetas en formularios administrativos. |

## Verificaciones ejecutadas

- `npm --prefix server test`: 7/7.
- `npm --prefix client run lint`: 0 errores.
- `npm --prefix client run build`: correcto.
- `npm audit --omit=dev`: 0 vulnerabilidades de produccion en backend y frontend.
- Migraciones: Agua 10/10, Luz 5/5, ninguna pendiente.
- Healthcheck: ambas bases OK, migraciones OK y backup completo vigente.
- Backup completo: `agua.sql`, `luz.sql`, seis adjuntos y manifiesto verificados por tamaño y SHA-256.
