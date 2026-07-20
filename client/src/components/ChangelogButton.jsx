import { useState } from "react";
import { FaHistory } from "react-icons/fa";
import CHANGELOG_ENTRIES from "../data/changelog";

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
        <div className="modal show d-block changelog-modal" style={{ backgroundColor: "rgba(15, 23, 42, 0.58)" }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content shadow-lg">
              <div className="modal-header bg-primary text-white">
                <div>
                  <h5 className="modal-title d-flex align-items-center gap-2">
                    <FaHistory aria-hidden="true" /> Cambios del sistema
                  </h5>
                  <div className="small opacity-75">Cambios recientes</div>
                </div>
                <button type="button" className="btn-close btn-close-white" onClick={() => setOpen(false)} aria-label="Cerrar novedades" />
              </div>
              <div className="modal-body bg-light">
                <div className="changelog-timeline">
                  {CHANGELOG_ENTRIES.map((entry) => (
                    <article className="card border-0 shadow-sm changelog-entry" key={`${entry.date}-${entry.title}`}>
                      <div className="card-body">
                        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                          <h6 className="mb-0">{entry.title}</h6>
                          <span className="badge text-bg-light border">{entry.date}</span>
                        </div>
                        <ul className="mb-0 ps-3">
                          {entry.changes.map((change) => <li key={change} className="mb-1">{change}</li>)}
                        </ul>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
