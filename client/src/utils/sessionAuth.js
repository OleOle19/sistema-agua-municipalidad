export const AGUA_TOKEN_KEY = "token_agua";
export const LUZ_TOKEN_KEY = "token_luz";
export const LEGACY_TOKEN_KEY = "token";
export const AUTH_TOKEN_KEYS = [AGUA_TOKEN_KEY, LUZ_TOKEN_KEY, LEGACY_TOKEN_KEY];
export const SESSION_AUTH_CHANGED_EVENT = "municipal:session-auth-changed";

const notifySessionChange = (action, key = "") => {
  if (typeof window === "undefined") return;
  const dispatch = () => {
    window.dispatchEvent(new CustomEvent(SESSION_AUTH_CHANGED_EVENT, {
      detail: { action, key }
    }));
  };
  if (typeof window.queueMicrotask === "function") window.queueMicrotask(dispatch);
  else window.setTimeout(dispatch, 0);
};

export const getSessionToken = (...keys) => {
  if (typeof window === "undefined") return "";
  for (const key of keys.flat().filter(Boolean)) {
    try {
      const token = String(window.sessionStorage.getItem(key) || "").trim();
      if (token) return token;
    } catch {
      return "";
    }
  }
  return "";
};

export const setSessionToken = (key, token) => {
  if (typeof window === "undefined" || !key) return false;
  try {
    window.sessionStorage.setItem(key, String(token || ""));
    notifySessionChange("set", key);
    return true;
  } catch {
    return false;
  }
};

export const removeSessionTokens = (...keys) => {
  if (typeof window === "undefined") return;
  const cleanKeys = keys.flat().filter(Boolean);
  try {
    cleanKeys.forEach((key) => window.sessionStorage.removeItem(key));
  } finally {
    notifySessionChange("remove", cleanKeys.join(","));
  }
};

export const clearAllSessionTokens = () => {
  removeSessionTokens(AUTH_TOKEN_KEYS);
};

export const hasActiveSession = () => Boolean(getSessionToken(AUTH_TOKEN_KEYS));

export const discardLegacyPersistentTokens = () => {
  if (typeof window === "undefined") return;
  try {
    AUTH_TOKEN_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // La limpieza es preventiva; sessionStorage sigue siendo la unica fuente valida.
  }
};
