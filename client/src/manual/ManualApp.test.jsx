import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ManualApp from "./ManualApp";

describe("ManualApp", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/manual/");
    window.scrollTo = vi.fn();
  });

  it("muestra el índice y encuentra tareas sin depender de las tildes", () => {
    render(<ManualApp />);

    expect(screen.getByRole("heading", { name: "Manual de uso del sistema" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar una tarea" }), {
      target: { value: "desague" }
    });

    expect(screen.getByRole("button", { name: "Editar servicios y tarifas" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cobrar períodos de Luz" })).not.toBeInTheDocument();
  });

  it("filtra los temas según el perfil seleccionado", () => {
    render(<ManualApp />);

    fireEvent.change(screen.getByLabelText("Mostrar instrucciones para"), {
      target: { value: "CAJERO" }
    });

    expect(screen.getByRole("button", { name: "Cobrar períodos de Agua" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gestionar usuarios y solicitudes de acceso" })).not.toBeInTheDocument();
  });

  it("muestra el procedimiento de Caja y su captura anonimizada", () => {
    render(<ManualApp />);

    fireEvent.click(screen.getByRole("button", { name: "Cobrar períodos de Agua" }));

    expect(screen.getByRole("heading", { name: "Paso a paso" })).toBeInTheDocument();
    expect(screen.getByText("Evite duplicados")).toBeInTheDocument();
    expect(screen.getByAltText("Dos períodos pendientes seleccionados para cobrarse juntos.")).toHaveAttribute(
      "src",
      "/manual/caja/caja-03-seleccion-cobro-agua.png"
    );
  });
});
