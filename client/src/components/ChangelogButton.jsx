import { lazy, Suspense, useState } from "react";
import { FaHistory } from "react-icons/fa";

const ChangelogModal = lazy(() => import("./ChangelogModal"));

export default function ChangelogButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn btn-primary shadow changelog-launcher"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Ver cambios del sistema"
      >
        <FaHistory aria-hidden="true" />
        <span>Novedades</span>
      </button>

      {open && (
        <Suspense fallback={(
          <div className="modal show d-block changelog-modal" aria-label="Cargando novedades">
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content shadow-lg">
                <div className="modal-body py-5 text-center">
                  <div className="spinner-border text-primary" role="status" aria-hidden="true" />
                  <div className="mt-3 fw-semibold">Cargando novedades...</div>
                </div>
              </div>
            </div>
          </div>
        )}>
          <ChangelogModal onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
