import { useEffect, useRef, useState } from "react";
import { CONFIRM_ACTION_EVENT } from "../utils/confirmAction";

export default function ConfirmDialogHost() {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  useEffect(() => {
    const handleRequest = (event) => {
      if (resolverRef.current) resolverRef.current(false);
      resolverRef.current = event.detail?.resolve || null;
      setRequest(event.detail || null);
    };
    window.addEventListener(CONFIRM_ACTION_EVENT, handleRequest);
    return () => {
      window.removeEventListener(CONFIRM_ACTION_EVENT, handleRequest);
      if (resolverRef.current) resolverRef.current(false);
    };
  }, []);

  const finish = (accepted) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolve?.(accepted);
  };

  if (!request) return null;

  return (
    <div className="modal show d-block app-confirm-modal" style={{ backgroundColor: "rgba(15, 23, 42, 0.58)" }}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content shadow-lg">
          <div className="modal-header">
            <h5 className="modal-title">{request.title}</h5>
            <button type="button" className="btn-close" onClick={() => finish(false)} aria-label="Cerrar confirmación" />
          </div>
          <div className="modal-body">
            <p className="mb-0" style={{ whiteSpace: "pre-line" }}>{request.message}</p>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={() => finish(false)}>
              {request.cancelLabel}
            </button>
            <button type="button" className={`btn btn-${request.variant}`} onClick={() => finish(true)} autoFocus>
              {request.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
