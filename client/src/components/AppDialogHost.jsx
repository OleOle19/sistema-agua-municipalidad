import { useCallback, useEffect, useId, useState } from "react";
import { FaExclamationTriangle, FaInfoCircle } from "react-icons/fa";
import { registerAppDialogHost } from "../utils/appDialog";

const resolveButtonClass = (tone) => {
  if (tone === "danger") return "btn-danger";
  if (tone === "warning") return "btn-warning";
  return "btn-primary";
};

export default function AppDialogHost() {
  const [queue, setQueue] = useState([]);
  const [values, setValues] = useState({});
  const [validationError, setValidationError] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const errorId = useId();
  const current = queue[0] || null;
  const value = current ? (values[current.id] ?? current.defaultValue ?? "") : "";

  useEffect(() => registerAppDialogHost((request) => {
    setQueue((items) => [...items, request]);
  }), []);

  const finish = useCallback((result) => {
    if (!current) return;
    current.resolve?.(result);
    setQueue((items) => items.slice(1));
    setValues((items) => {
      const next = { ...items };
      delete next[current.id];
      return next;
    });
    setValidationError("");
  }, [current]);

  const cancel = useCallback(() => {
    finish(current?.kind === "prompt" ? null : undefined);
  }, [current?.kind, finish]);

  const confirm = useCallback(() => {
    if (!current) return;
    if (current.kind === "prompt") {
      if (current.required && !value.trim()) {
        setValidationError(current.requiredMessage);
        return;
      }
      finish(value);
      return;
    }
    finish(undefined);
  }, [current, finish, value]);

  if (!current) return null;

  const isPrompt = current.kind === "prompt";
  const Icon = current.tone === "primary" ? FaInfoCircle : FaExclamationTriangle;
  const inputProps = {
    id: inputId,
    className: `form-control${validationError ? " is-invalid" : ""}`,
    value,
    maxLength: current.maxLength > 0 ? current.maxLength : undefined,
    "aria-required": current.required ? "true" : undefined,
    "aria-invalid": validationError ? "true" : undefined,
    "aria-describedby": validationError ? errorId : undefined,
    autoFocus: true,
    onChange: (event) => {
      setValues((items) => ({ ...items, [current.id]: event.target.value }));
      if (validationError) setValidationError("");
    }
  };

  return (
    <div
      className="modal show d-block app-dialog"
      tabIndex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div key={current.id} className="modal-dialog modal-dialog-centered">
        <form
          className="modal-content shadow-lg"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          <div className="modal-header">
            <h5 className="modal-title d-flex align-items-center gap-2" id={titleId}>
              <Icon aria-hidden="true" />
              {current.title}
            </h5>
            <button
              type="button"
              className="btn-close"
              data-modal-close
              aria-label="Cerrar diálogo"
              onClick={cancel}
            />
          </div>
          <div className="modal-body">
            <p id={descriptionId} className="mb-3 app-dialog__message">{current.message}</p>
            {isPrompt && (
              <div>
                <label className="form-label fw-semibold" htmlFor={inputId}>{current.inputLabel}</label>
                {current.multiline ? (
                  <textarea {...inputProps} rows="4" />
                ) : (
                  <input {...inputProps} type="text" inputMode={current.inputMode} />
                )}
                {validationError && <div id={errorId} className="invalid-feedback" role="alert">{validationError}</div>}
              </div>
            )}
          </div>
          <div className="modal-footer">
            {isPrompt && (
              <button type="button" className="btn btn-outline-secondary" onClick={cancel}>
                {current.cancelLabel}
              </button>
            )}
            <button type="submit" className={`btn ${resolveButtonClass(current.tone)}`}>
              {current.confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
