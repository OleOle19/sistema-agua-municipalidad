# Migracion 2026-05-29_007 - Busqueda Caja Agua

Esta migración agrega índices para acelerar la búsqueda de contribuyentes desde Caja Agua.

## Qué cambia

- Índice por `dni_ruc` normalizado a solo números.
- Índice por `codigo_municipal` normalizado para búsqueda rápida.
- Índice por nombre visible del contribuyente para consultas de Caja.

## Qué no cambia

- No modifica datos de contribuyentes.
- No cambia rutas ni pantallas.
- No es necesaria para corregir una pantalla en blanco del frontend.

## Cuándo aplicarla

Después de desplegar el código del backend y frontend que ya usa la búsqueda remota de Caja.

## Cómo aplicarla

```powershell
npm --prefix server run migrate:status
npm --prefix server run migrate
```

## Resultado esperado

La búsqueda seguirá funcionando aunque la migración no se haya aplicado todavía, pero con la migración aplicada debería responder más rápido en bases con muchos contribuyentes.
