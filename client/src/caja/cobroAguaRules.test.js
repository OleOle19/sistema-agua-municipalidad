import { describe, expect, it } from 'vitest';
import {
  buildCobroAguaVisibleYears,
  buildCobroAguaYearRows,
  canAnnulCobroAguaRow,
  canSelectCobroAguaRow,
  normalizeCobroAguaRowConsistency,
  resolveCobroDateWindow
} from './cobroAguaRules';

describe('reglas de cobro de agua', () => {
  it('crea una vista anual completa sin inventar recibos cobrables', () => {
    const enero = { id_recibo: 10, anio: 2026, mes: 1, deuda_mes: 11.5 };
    const rows = buildCobroAguaYearRows([enero], 2026);

    expect(rows).toHaveLength(12);
    expect(rows[0]).toBe(enero);
    expect(rows[1]).toMatchObject({
      anio: 2026,
      mes: 2,
      estado: 'SIN_RECIBO',
      placeholder_sin_recibo: true,
      deuda_mes: 0
    });
  });

  it('mantiene visibles los años intermedios aunque no tengan filas', () => {
    expect(buildCobroAguaVisibleYears([
      { anio: 2024 },
      { anio: 2026 }
    ], 2025)).toEqual([2026, 2025, 2024]);
  });

  it('limpia una anulación pendiente obsoleta y reabre el saldo', () => {
    const normalized = normalizeCobroAguaRowConsistency({
      anio: 2026,
      mes: 6,
      estado: 'PAGADO',
      deuda_mes: 1006.5,
      abono_mes: 0,
      id_ultimo_pago: null,
      id_anulacion_pendiente: 77,
      anulado_en_pendiente: '2026-09-10'
    }, '2026-09-10');

    expect(normalized).toMatchObject({
      estado: 'PENDIENTE',
      id_anulacion_pendiente: 0,
      anulado_en_pendiente: null
    });
  });

  it('permite al administrador anular pagos y respeta la ventana del cajero', () => {
    const pago = {
      id_recibo: 22,
      estado: 'PAGADO',
      fecha_ultimo_pago: '2026-09-07'
    };

    expect(canAnnulCobroAguaRow(pago, {
      role: 'ADMIN',
      canCorregirPagos: true
    }, '2026-09-10')).toBe(true);
    expect(canAnnulCobroAguaRow(pago, {
      role: 'CAJERO',
      canCorregirPagos: true
    }, '2026-09-10')).toBe(true);
    expect(canAnnulCobroAguaRow({
      ...pago,
      fecha_ultimo_pago: '2026-09-06'
    }, {
      role: 'CAJERO',
      canCorregirPagos: true
    }, '2026-09-10')).toBe(false);
  });

  it('evita cobrar saldos pagados o vacíos y conserva importes altos', () => {
    const permisosAdmin = { role: 'ADMIN', canCorregirPagos: true };

    expect(canSelectCobroAguaRow({ estado: 'PAGADO', deuda_mes: 1006.5 }, permisosAdmin)).toBe(false);
    expect(canSelectCobroAguaRow({ estado: 'PENDIENTE', deuda_mes: 0 }, permisosAdmin)).toBe(false);
    expect(canSelectCobroAguaRow({ estado: 'PENDIENTE', deuda_mes: 1006.5 }, permisosAdmin)).toBe(true);
  });

  it('calcula la ventana retroactiva sin cambiar la política vigente', () => {
    expect(resolveCobroDateWindow('CAJERO', '2026-09-10')).toEqual({
      min: '2026-09-07',
      max: '2026-09-10',
      maxDiasRetroactivo: 3
    });
    expect(resolveCobroDateWindow('ADMIN', '2026-09-10')).toEqual({
      min: '',
      max: '2026-09-10',
      maxDiasRetroactivo: null
    });
  });
});
