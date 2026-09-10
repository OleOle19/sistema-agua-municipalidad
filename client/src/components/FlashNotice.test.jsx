import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FlashNotice from './FlashNotice';

const flushEnqueue = () => {
  act(() => {
    vi.advanceTimersByTime(0);
  });
};

describe('FlashNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('muestra como máximo tres avisos y expande el más reciente', () => {
    render(
      <FlashNotice
        flash={[
          { id: 1, type: 'info', text: 'Primero' },
          { id: 2, type: 'success', text: 'Segundo' },
          { id: 3, type: 'warning', text: 'Tercero' },
          { id: 4, type: 'danger', text: 'Cuarto' }
        ]}
      />
    );
    flushEnqueue();

    expect(screen.queryByText('Primero')).not.toBeInTheDocument();
    expect(screen.getByText('3 notificaciones')).toBeInTheDocument();
    expect(screen.getByText('Cuarto').closest('section')).toHaveClass('municipal-toast--expanded');
    expect(screen.getByText('Tercero').closest('section')).toHaveClass('municipal-toast--collapsed');
  });

  it('agrupa avisos repetidos sin ocupar otra tarjeta', () => {
    render(
      <FlashNotice flash={[
        { id: 1, type: 'success', title: 'Pago registrado', text: 'S/. 11.50' },
        { id: 2, type: 'success', title: 'Pago registrado', text: 'S/. 11.50' }
      ]} />
    );
    flushEnqueue();

    expect(screen.getAllByText('Pago registrado')).toHaveLength(1);
    expect(screen.getByText('×2')).toBeInTheDocument();
  });

  it('permite desplegar un aviso anterior', () => {
    render(
      <FlashNotice flash={[
        { id: 1, type: 'info', text: 'Anterior' },
        { id: 2, type: 'success', text: 'Reciente' }
      ]} />
    );
    flushEnqueue();

    fireEvent.click(screen.getByText('Anterior'));

    expect(screen.getByText('Anterior').closest('section')).toHaveClass('municipal-toast--expanded');
    expect(screen.getByText('Reciente').closest('section')).toHaveClass('municipal-toast--collapsed');
  });

  it('se cierra automáticamente al cumplirse cinco segundos', () => {
    const onClose = vi.fn();
    render(<FlashNotice flash={{ id: 1, type: 'success', text: 'Guardado' }} onClose={onClose} />);
    flushEnqueue();

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByText('Guardado')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Guardado')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
