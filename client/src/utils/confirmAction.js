export const CONFIRM_ACTION_EVENT = "municipal:confirm-action";

export const confirmAction = (message, options = {}) => new Promise((resolve) => {
  if (typeof window === "undefined") {
    resolve(false);
    return;
  }
  window.dispatchEvent(new CustomEvent(CONFIRM_ACTION_EVENT, {
    detail: {
      message: String(message || "¿Desea continuar?"),
      title: String(options.title || "Confirmar acción"),
      confirmLabel: String(options.confirmLabel || "Confirmar"),
      cancelLabel: String(options.cancelLabel || "Cancelar"),
      variant: options.variant === "danger" ? "danger" : "primary",
      resolve
    }
  }));
});
