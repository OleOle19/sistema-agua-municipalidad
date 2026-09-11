import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppDialogHost from "./AppDialogHost";
import { requestAppInput, showAppAlert } from "../utils/appDialog";

describe("AppDialogHost", () => {
  it("recoge texto y conserva el valor sugerido", async () => {
    render(<AppDialogHost />);
    let resultPromise;

    act(() => {
      resultPromise = requestAppInput("Ingrese el motivo.", "Motivo sugerido", {
        title: "Justificar cambio",
        inputLabel: "Motivo",
        required: true
      });
    });

    expect(screen.getByRole("heading", { name: /justificar cambio/i })).toBeInTheDocument();
    const input = screen.getByLabelText("Motivo");
    expect(input).toHaveValue("Motivo sugerido");
    fireEvent.change(input, { target: { value: "Corrección verificada" } });
    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));

    await expect(resultPromise).resolves.toBe("Corrección verificada");
  });

  it("muestra la validación obligatoria dentro del diálogo", async () => {
    render(<AppDialogHost />);
    let resultPromise;

    act(() => {
      resultPromise = requestAppInput("Escriba una respuesta.", "", {
        inputLabel: "Respuesta requerida",
        required: true,
        requiredMessage: "Complete este dato."
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
    expect(screen.getByText("Complete este dato.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Respuesta requerida"), { target: { value: "Listo" } });
    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
    await expect(resultPromise).resolves.toBe("Listo");
  });

  it("devuelve null al cancelar una entrada", async () => {
    render(<AppDialogHost />);
    let resultPromise;

    act(() => {
      resultPromise = requestAppInput("Dato opcional", "");
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await expect(resultPromise).resolves.toBeNull();
  });

  it("atiende varios avisos en el orden en que llegaron", async () => {
    render(<AppDialogHost />);
    let firstPromise;
    let secondPromise;

    act(() => {
      firstPromise = showAppAlert("Primer aviso", { title: "Primero" });
      secondPromise = showAppAlert("Segundo aviso", { title: "Segundo" });
    });

    expect(screen.getByText("Primer aviso")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));
    await expect(firstPromise).resolves.toBeUndefined();

    expect(screen.getByText("Segundo aviso")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));
    await expect(secondPromise).resolves.toBeUndefined();
  });
});
