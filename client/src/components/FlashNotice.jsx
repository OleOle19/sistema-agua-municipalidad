import { useCallback, useEffect, useRef } from "react";
import { FaCheck, FaExclamationTriangle, FaInfo, FaTimes, FaTimesCircle } from "react-icons/fa";

const FLASH_VARIANTS = {
  success: {
    title: "Operación completada",
    icon: FaCheck
  },
  warning: {
    title: "Atención",
    icon: FaExclamationTriangle
  },
  danger: {
    title: "No se pudo completar",
    icon: FaTimesCircle
  },
  info: {
    title: "Información",
    icon: FaInfo
  }
};

const FlashNotice = ({ flash, onClose, duration = 5000 }) => {
  const timerRef = useRef(0);
  const startedAtRef = useRef(0);
  const remainingRef = useRef(duration);
  const onCloseRef = useRef(onClose);
  const pointerInsideRef = useRef(false);
  const focusInsideRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const stopTimer = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = 0;
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    if (!flash?.text || remainingRef.current <= 0 || pointerInsideRef.current || focusInsideRef.current) return;
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => onCloseRef.current?.(), remainingRef.current);
  }, [flash?.text, stopTimer]);

  const pauseTimer = useCallback(() => {
    if (!timerRef.current) return;
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
    stopTimer();
  }, [stopTimer]);

  useEffect(() => {
    remainingRef.current = Math.max(1000, Number(duration) || 5000);
    startTimer();
    return stopTimer;
  }, [duration, flash?.ts, startTimer, stopTimer]);

  if (!flash?.text) return null;

  const type = FLASH_VARIANTS[flash.type] ? flash.type : "success";
  const variant = FLASH_VARIANTS[type];
  const Icon = variant.icon;
  const urgent = type === "danger" || type === "warning";

  return (
    <div className="municipal-toast-viewport">
      <section
        className={`municipal-toast municipal-toast--${type}`}
        role={urgent ? "alert" : "status"}
        aria-live={urgent ? "assertive" : "polite"}
        aria-atomic="true"
        onPointerEnter={() => {
          pointerInsideRef.current = true;
          pauseTimer();
        }}
        onPointerLeave={() => {
          pointerInsideRef.current = false;
          startTimer();
        }}
        onFocusCapture={() => {
          focusInsideRef.current = true;
          pauseTimer();
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            focusInsideRef.current = false;
            startTimer();
          }
        }}
      >
        <span className="municipal-toast__accent" aria-hidden="true" />
        <span className="municipal-toast__icon" aria-hidden="true">
          <Icon />
        </span>
        <div className="municipal-toast__content">
          <div className="municipal-toast__title">{flash.title || variant.title}</div>
          <div className="municipal-toast__message">{flash.text}</div>
        </div>
        <button
          type="button"
          className="municipal-toast__close"
          aria-label="Cerrar notificación"
          onClick={onClose}
        >
          <FaTimes aria-hidden="true" />
        </button>
      </section>
    </div>
  );
};

export default FlashNotice;
