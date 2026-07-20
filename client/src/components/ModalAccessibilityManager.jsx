import { useEffect } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

const isVisible = (element) => Boolean(
  element
  && (element.offsetWidth || element.offsetHeight || element.getClientRects().length)
);

const getOpenModals = () => Array.from(document.querySelectorAll(".modal.show.d-block"))
  .filter(isVisible);

const getTopModal = () => getOpenModals().at(-1) || null;

const ensureControlLabels = (root = document) => {
  root.querySelectorAll("label:not([for])").forEach((label, index) => {
    if (label.querySelector("input, select, textarea")) return;
    const container = label.parentElement;
    if (!container) return;
    const controls = container.querySelectorAll("input:not([type='hidden']), select, textarea");
    if (controls.length !== 1) return;
    const control = controls[0];
    if (!control.id) {
      control.id = `ui-control-${Date.now().toString(36)}-${index}`;
    }
    label.htmlFor = control.id;
  });
};

const prepareModal = (modal, index) => {
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.dataset.modalA11yIndex = String(index);

  const title = modal.querySelector(".modal-title");
  if (title) {
    if (!title.id) title.id = `app-modal-title-${index}`;
    modal.setAttribute("aria-labelledby", title.id);
  } else if (!modal.hasAttribute("aria-label")) {
    modal.setAttribute("aria-label", "Ventana del sistema");
  }

  modal.querySelectorAll(".btn-close:not([aria-label])").forEach((button) => {
    button.setAttribute("aria-label", "Cerrar ventana");
    button.setAttribute("title", "Cerrar");
  });
};

export default function ModalAccessibilityManager() {
  useEffect(() => {
    let activeModal = null;
    let previousFocus = null;
    let focusFrame = 0;
    let syncFrame = 0;

    const syncUi = () => {
      ensureControlLabels(document);
      const modals = getOpenModals();
      modals.forEach(prepareModal);
      document.body.classList.toggle("has-app-modal", modals.length > 0);

      const nextModal = modals.at(-1) || null;
      if (nextModal === activeModal) return;

      if (activeModal && !nextModal && previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }

      activeModal = nextModal;
      if (!activeModal) {
        previousFocus = null;
        return;
      }

      previousFocus = document.activeElement;
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => {
        const preferred = Array.from(activeModal.querySelectorAll(`[autofocus], ${FOCUSABLE_SELECTOR}`)).find(isVisible);
        if (preferred instanceof HTMLElement) preferred.focus({ preventScroll: true });
      });
    };

    const scheduleSync = () => {
      if (syncFrame) return;
      syncFrame = window.requestAnimationFrame(() => {
        syncFrame = 0;
        syncUi();
      });
    };

    const handleKeyDown = (event) => {
      const modal = getTopModal();
      if (!modal) return;

      if (event.key === "Escape") {
        const closeButton = modal.querySelector(".btn-close, [data-modal-close]");
        if (closeButton instanceof HTMLElement && !closeButton.hasAttribute("disabled")) {
          event.preventDefault();
          closeButton.click();
        }
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", handleKeyDown);
    syncUi();

    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
      window.cancelAnimationFrame(syncFrame);
      document.body.classList.remove("has-app-modal");
    };
  }, []);

  return null;
}
