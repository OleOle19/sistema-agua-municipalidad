let dialogHost = null;
let dialogSequence = 0;

export const registerAppDialogHost = (host) => {
  dialogHost = typeof host === "function" ? host : null;
  return () => {
    if (dialogHost === host) dialogHost = null;
  };
};

const fallbackAlert = (message) => {
  if (typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(String(message || ""));
  }
};

const fallbackPrompt = (message, defaultValue) => {
  if (typeof window !== "undefined" && typeof window.prompt === "function") {
    return window.prompt(String(message || ""), String(defaultValue ?? ""));
  }
  return null;
};

const enqueueDialog = (request, fallback) => {
  if (!dialogHost) return Promise.resolve(fallback());
  return new Promise((resolve) => {
    dialogSequence += 1;
    dialogHost({ ...request, id: `app-dialog-${dialogSequence}`, resolve });
  });
};

export const showAppAlert = (message, options = {}) => enqueueDialog({
  kind: "alert",
  message: String(message || "").trim() || "Aviso del sistema.",
  title: String(options.title || "Aviso del sistema"),
  confirmLabel: String(options.confirmLabel || "Entendido"),
  tone: String(options.tone || "warning")
}, () => fallbackAlert(message));

export const requestAppInput = (message, defaultValue = "", options = {}) => enqueueDialog({
  kind: "prompt",
  message: String(message || "").trim(),
  title: String(options.title || "Ingrese la información"),
  inputLabel: String(options.inputLabel || "Respuesta"),
  defaultValue: String(defaultValue ?? ""),
  confirmLabel: String(options.confirmLabel || "Aceptar"),
  cancelLabel: String(options.cancelLabel || "Cancelar"),
  required: Boolean(options.required),
  requiredMessage: String(options.requiredMessage || "Este campo es obligatorio."),
  multiline: Boolean(options.multiline),
  inputMode: String(options.inputMode || "text"),
  maxLength: Number(options.maxLength || 0),
  tone: String(options.tone || "primary")
}, () => fallbackPrompt(message, defaultValue));
