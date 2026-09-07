import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaCheck,
  FaChevronDown,
  FaExclamationTriangle,
  FaInfo,
  FaTimes,
  FaTimesCircle
} from "react-icons/fa";

const MAX_VISIBLE_NOTICES = 3;

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

const ToastCard = ({ notice, expanded, duration, onDismiss, onToggle }) => {
  const timerRef = useRef(0);
  const startedAtRef = useRef(0);
  const remainingRef = useRef(duration);
  const pointerInsideRef = useRef(false);
  const focusInsideRef = useRef(false);

  const stopTimer = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = 0;
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    if (remainingRef.current <= 0 || pointerInsideRef.current || focusInsideRef.current) return;
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(
      () => onDismiss(notice.id),
      remainingRef.current
    );
  }, [notice.id, onDismiss, stopTimer]);

  const pauseTimer = useCallback(() => {
    if (!timerRef.current) return;
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
    stopTimer();
  }, [stopTimer]);

  useEffect(() => {
    remainingRef.current = Math.max(1000, Number(duration) || 5000);
    pointerInsideRef.current = false;
    focusInsideRef.current = false;
    startTimer();
    return stopTimer;
  }, [duration, notice.id, startTimer, stopTimer]);

  const type = FLASH_VARIANTS[notice.type] ? notice.type : "success";
  const variant = FLASH_VARIANTS[type];
  const Icon = variant.icon;
  const urgent = type === "danger" || type === "warning";
  const messageId = `municipal-toast-message-${notice.id}`;

  return (
    <section
      className={`municipal-toast municipal-toast--${type} municipal-toast--${expanded ? "expanded" : "collapsed"}`}
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
      <button
        type="button"
        className="municipal-toast__toggle"
        aria-expanded={expanded}
        aria-controls={messageId}
        title={expanded ? "Contraer notificación" : "Expandir notificación"}
        onClick={() => onToggle(notice.id)}
      >
        <span className="municipal-toast__icon" aria-hidden="true">
          <Icon />
        </span>
        <span className="municipal-toast__content">
          <span className="municipal-toast__heading">
            <span className="municipal-toast__title">{notice.title || variant.title}</span>
            {notice.repetitions > 1 && (
              <span className="municipal-toast__repetitions" title="Aviso repetido">
                ×{notice.repetitions}
              </span>
            )}
            <FaChevronDown className="municipal-toast__chevron" aria-hidden="true" />
          </span>
          <span id={messageId} className="municipal-toast__message">
            {notice.text}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="municipal-toast__close"
        aria-label="Cerrar notificación"
        title="Cerrar notificación"
        onClick={() => onDismiss(notice.id)}
      >
        <FaTimes aria-hidden="true" />
      </button>
    </section>
  );
};

const FlashNotice = ({ flash, onClose, duration = 5000 }) => {
  const [notices, setNotices] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const sequenceRef = useRef(0);
  const seenFlashIdsRef = useRef(new Set());
  const hadNoticesRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const incoming = (Array.isArray(flash) ? flash : [flash]).filter(Boolean);
    if (incoming.length === 0) {
      seenFlashIdsRef.current.clear();
      return;
    }

    const pending = [];
    const pendingSourceIds = new Set();
    incoming.forEach((item, index) => {
      const text = String(item?.text || "").trim();
      if (!text) return;
      const type = FLASH_VARIANTS[item?.type] ? item.type : "success";
      const title = String(item?.title || "").trim();
      const sourceId = String(
        item?.id || JSON.stringify([item?.ts ?? null, index, type, title, text])
      );
      if (seenFlashIdsRef.current.has(sourceId) || pendingSourceIds.has(sourceId)) return;
      pendingSourceIds.add(sourceId);
      pending.push({
        sourceId,
        id: `${Date.now()}-${sequenceRef.current += 1}`,
        type,
        title,
        text
      });
    });
    if (pending.length === 0) return;

    const enqueueTimer = window.setTimeout(() => {
      const freshNotices = pending.filter((notice) => {
        if (seenFlashIdsRef.current.has(notice.sourceId)) return false;
        seenFlashIdsRef.current.add(notice.sourceId);
        return true;
      });
      if (freshNotices.length === 0) return;

      setNotices((current) => {
        let next = [...current];
        freshNotices.forEach((queuedNotice) => {
          const newNotice = {
            id: queuedNotice.id,
            type: queuedNotice.type,
            title: queuedNotice.title,
            text: queuedNotice.text
          };
          const duplicate = next.find(
            (notice) => notice.type === newNotice.type
              && notice.title === newNotice.title
              && notice.text === newNotice.text
          );
          if (duplicate) {
            next = next.filter((notice) => notice.id !== duplicate.id);
          }
          next.push({
            ...newNotice,
            repetitions: Number(duplicate?.repetitions || 0) + 1
          });
        });
        return next.slice(-MAX_VISIBLE_NOTICES);
      });
      setExpandedId(freshNotices[freshNotices.length - 1].id);
    }, 0);

    return () => window.clearTimeout(enqueueTimer);
  }, [flash]);

  useEffect(() => {
    if (notices.length > 0) {
      hadNoticesRef.current = true;
      return;
    }
    if (hadNoticesRef.current) {
      hadNoticesRef.current = false;
      onCloseRef.current?.();
    }
  }, [notices]);

  const dismissNotice = useCallback((id) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
    setExpandedId((current) => (current === id ? null : current));
  }, []);

  const toggleNotice = useCallback((id) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  const dismissAll = useCallback(() => {
    setNotices([]);
    setExpandedId(null);
  }, []);

  if (notices.length === 0) return null;

  return (
    <div className="municipal-toast-viewport">
      {notices.length > 1 && (
        <div className="municipal-toast-toolbar">
          <span>{notices.length} notificaciones</span>
          <button type="button" onClick={dismissAll}>Cerrar todas</button>
        </div>
      )}
      <div className="municipal-toast-stack">
        {[...notices].reverse().map((notice) => (
          <ToastCard
            key={notice.id}
            notice={notice}
            expanded={notice.id === expandedId}
            duration={duration}
            onDismiss={dismissNotice}
            onToggle={toggleNotice}
          />
        ))}
      </div>
    </div>
  );
};

export default FlashNotice;
