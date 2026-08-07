import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearAllSessionTokens,
  hasActiveSession,
  SESSION_AUTH_CHANGED_EVENT
} from "../utils/sessionAuth";

const parsePositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const IDLE_MINUTES = parsePositiveNumber(import.meta.env.VITE_SESSION_IDLE_MINUTES, 30);
const IDLE_MS = Math.max(60_000, Math.round(IDLE_MINUTES * 60_000));
const configuredWarningSeconds = parsePositiveNumber(import.meta.env.VITE_SESSION_WARNING_SECONDS, 120);
const WARNING_MS = Math.min(Math.round(configuredWarningSeconds * 1000), IDLE_MS - 10_000);

const formatCountdown = (seconds) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
};

function SessionInactivityGuard({ onExpire }) {
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const warningTimerRef = useRef(0);
  const expiryTimerRef = useRef(0);
  const countdownTimerRef = useRef(0);
  const deadlineRef = useRef(0);
  const lastResetRef = useRef(0);

  const clearTimers = useCallback(() => {
    window.clearTimeout(warningTimerRef.current);
    window.clearTimeout(expiryTimerRef.current);
    window.clearInterval(countdownTimerRef.current);
    warningTimerRef.current = 0;
    expiryTimerRef.current = 0;
    countdownTimerRef.current = 0;
  }, []);

  const expireSession = useCallback(() => {
    clearTimers();
    deadlineRef.current = 0;
    setRemainingSeconds(null);
    clearAllSessionTokens();
    onExpire?.();
  }, [clearTimers, onExpire]);

  const updateCountdown = useCallback(() => {
    const remaining = Math.ceil((deadlineRef.current - Date.now()) / 1000);
    if (remaining <= 0) {
      expireSession();
      return;
    }
    setRemainingSeconds(remaining);
  }, [expireSession]);

  const beginWarning = useCallback(() => {
    if (!hasActiveSession()) return;
    updateCountdown();
    window.clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = window.setInterval(updateCountdown, 1000);
  }, [updateCountdown]);

  const scheduleSession = useCallback(() => {
    clearTimers();
    setRemainingSeconds(null);
    if (!hasActiveSession()) {
      deadlineRef.current = 0;
      return;
    }

    const now = Date.now();
    lastResetRef.current = now;
    deadlineRef.current = now + IDLE_MS;
    warningTimerRef.current = window.setTimeout(beginWarning, IDLE_MS - WARNING_MS);
    expiryTimerRef.current = window.setTimeout(expireSession, IDLE_MS);
  }, [beginWarning, clearTimers, expireSession]);

  useEffect(() => {
    const initialScheduleTimer = window.setTimeout(scheduleSession, 0);

    const registerActivity = () => {
      if (!hasActiveSession()) return;
      const now = Date.now();
      if (now - lastResetRef.current < 1500) return;
      scheduleSession();
    };
    const handleSessionChange = () => scheduleSession();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !hasActiveSession()) return;
      if (deadlineRef.current && Date.now() >= deadlineRef.current) {
        expireSession();
      } else if (deadlineRef.current && deadlineRef.current - Date.now() <= WARNING_MS) {
        beginWarning();
      }
    };

    const activityEvents = ["pointerdown", "keydown", "mousemove", "touchstart", "scroll"];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, registerActivity, { passive: true });
    });
    window.addEventListener(SESSION_AUTH_CHANGED_EVENT, handleSessionChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(initialScheduleTimer);
      clearTimers();
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, registerActivity));
      window.removeEventListener(SESSION_AUTH_CHANGED_EVENT, handleSessionChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [beginWarning, clearTimers, expireSession, scheduleSession]);

  if (remainingSeconds === null) return null;

  return (
    <div
      className="alert alert-warning shadow position-fixed end-0 bottom-0 m-3 session-timeout-warning"
      role="status"
      aria-live="polite"
      style={{ zIndex: 2100, maxWidth: "390px" }}
    >
      <div className="fw-bold mb-1">Sesión por cerrar</div>
      <div className="small mb-2">
        Se cerrará en <strong>{formatCountdown(remainingSeconds)}</strong> por inactividad.
      </div>
      <button type="button" className="btn btn-warning btn-sm fw-semibold" onClick={scheduleSession}>
        Continuar sesión
      </button>
    </div>
  );
}

export default SessionInactivityGuard;
