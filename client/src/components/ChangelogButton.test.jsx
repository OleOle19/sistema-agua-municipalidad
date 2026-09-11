import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ChangelogButton from "./ChangelogButton";

describe("ChangelogButton", () => {
  it("carga el historial solo cuando se abre y permite cerrarlo", async () => {
    render(<ChangelogButton />);

    expect(screen.queryByRole("heading", { name: "Cambios del sistema" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Novedades" }));

    expect(await screen.findByRole("heading", { name: "Cambios del sistema" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar novedades" }));
    expect(screen.queryByRole("heading", { name: "Cambios del sistema" })).not.toBeInTheDocument();
  });
});
