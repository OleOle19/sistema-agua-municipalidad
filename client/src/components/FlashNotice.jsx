const FLASH_VARIANTS = {
  success: {
    alertClass: "alert-success border-success-subtle shadow",
    title: "Listo"
  },
  warning: {
    alertClass: "alert-warning border-warning-subtle shadow",
    title: "Atencion"
  },
  danger: {
    alertClass: "alert-danger border-danger-subtle shadow",
    title: "Error"
  }
};

const FlashNotice = ({ flash, onClose }) => {
  if (!flash?.text) return null;

  const variant = FLASH_VARIANTS[flash.type] || FLASH_VARIANTS.success;

  return (
    <div
      className="position-fixed p-3"
      style={{
        top: 12,
        right: 12,
        zIndex: 2000,
        width: "min(520px, calc(100vw - 24px))"
      }}
    >
      <div className={`alert ${variant.alertClass} mb-0`} role="alert">
        <div className="d-flex align-items-start gap-3">
          <div className="flex-grow-1">
            <div className="fw-bold small text-uppercase">{variant.title}</div>
            <div style={{ whiteSpace: "pre-line" }}>{flash.text}</div>
          </div>
          <button
            type="button"
            className="btn-close"
            aria-label="Cerrar aviso"
            onClick={onClose}
          ></button>
        </div>
      </div>
    </div>
  );
};

export default FlashNotice;
