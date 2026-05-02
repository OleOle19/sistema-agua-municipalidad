## Reemplazo manual de historial financiero viejo

Uso recomendado cuando vas a reemplazar pagos o deudas de meses anteriores con un Excel ya corregido.

### Idea

El importador de historial ahora puede reemplazar pagos/recibos existentes del mismo `contribuyente + periodo` si el Excel viene corregido. Igual conviene hacer respaldo antes de rehacer meses viejos completos.

### Importante

- Haz backup SQL antes de borrar o rehacer una carga grande.
- Si tu Excel trae `FECHA`, el importador la respeta como fecha real del pago. Si tus datos antiguos solo tienen mes y no dia, guarda `fecha_pago` en primer dia de ese mes.
- El Excel de historial sirve bien para este caso porque toma columnas por periodo y monto.
- En columna `CONTRIBUYENTE` ahora puede venir `codigo municipal` o `nombre completo exacto`.
- El nombre exacto si distingue tildes, comas, puntos y otros signos. Si no coincide exacto, no reasigna.
- `GASTOS ADMINISTRATIVOS` tambien sirve como columna de administracion.
- Ojo: ejemplo SQL de abajo borra **todo** lo anterior a abril 2026. Si no quieres eso, reduce filtro antes de ejecutar.

### Vista previa antes de borrar

```sql
SELECT
  r.anio,
  r.mes,
  COUNT(*) AS total_recibos,
  COALESCE(SUM(p.monto_pagado), 0) AS total_pagado
FROM recibos r
LEFT JOIN pagos p ON p.id_recibo = r.id_recibo
WHERE (r.anio < 2026 OR (r.anio = 2026 AND r.mes < 4))
GROUP BY r.anio, r.mes
ORDER BY r.anio, r.mes;
```

### Borrado manual para meses antes de abril 2026

```sql
BEGIN;

DELETE FROM pagos p
USING recibos r
WHERE p.id_recibo = r.id_recibo
  AND (r.anio < 2026 OR (r.anio = 2026 AND r.mes < 4));

DELETE FROM recibos r
WHERE (r.anio < 2026 OR (r.anio = 2026 AND r.mes < 4));

COMMIT;
```

### Variante mas segura: borrar solo rango puntual

Ejemplo: solo setiembre a diciembre 2025.

```sql
BEGIN;

DELETE FROM pagos p
USING recibos r
WHERE p.id_recibo = r.id_recibo
  AND (
    (r.anio = 2025 AND r.mes BETWEEN 9 AND 12)
  );

DELETE FROM recibos r
WHERE (
  (r.anio = 2025 AND r.mes BETWEEN 9 AND 12)
);

COMMIT;
```

### Si quieres revisar antes de confirmar

```sql
BEGIN;

DELETE FROM pagos p
USING recibos r
WHERE p.id_recibo = r.id_recibo
  AND (r.anio < 2026 OR (r.anio = 2026 AND r.mes < 4));

DELETE FROM recibos r
WHERE (r.anio < 2026 OR (r.anio = 2026 AND r.mes < 4));

ROLLBACK;
```

### Despues

1. Importa tu Excel desde `Importacion > Historial`.
2. Revisa rechazos.
3. Verifica un contribuyente con historial y recibo reimpreso.

### Ajustes manuales complementarios de marzo 2026

Si despues de importar `MARZO.xlsx` necesitas aplicar los cobros omitidos que fuimos confirmando manualmente, ejecuta:

```powershell
node server\scripts\aplicar_recaudacion_marzo_2026_complementaria.js --apply
```

Notas:

- El script es idempotente para esos casos: recrea o reemplaza el pago del periodo objetivo.
- Tambien corrige las fechas manuales ya acordadas para marzo 2026.
- Conviene hacer backup antes de correrlo en otro servidor.

## Variante con `PAGOSACTA.TXT`

Si el servidor remoto ya tiene el padron pero no tiene pagos/recibos historicos visibles antes de abril 2026, puedes usar:

```powershell
node server\scripts\importar_pagos_acta_txt.js "C:\ruta\real\PAGOSACTA.TXT" --apply --max-period=2026-04
```

Notas:

- Crea recibos faltantes con los subtotales del TXT.
- Inserta solo pagos faltantes.
- Si encuentra pagos ocultos con `IMPORTACION_HISTORIAL`, los vuelve visibles.
- Si un `abono` excede el `total` del recibo, recorta el pago al total y lo reporta en salida.
