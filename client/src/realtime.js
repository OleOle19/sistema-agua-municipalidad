import { API_BASE_URL } from "./api";

const WS_FLAG_RAW = String(import.meta.env.VITE_REALTIME_WS_ENABLED ?? "0").trim();
const WS_ENABLED = WS_FLAG_RAW === "1";
const HEARTBEAT_MS = Math.max(5000, Number(import.meta.env.VITE_REALTIME_HEARTBEAT_MS || 15000));

const toWsUrl = (baseUrl) => {
  const parsed = new URL(baseUrl);
  const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${parsed.host}/ws`;
};

class RealtimeManager {
  constructor() {
    this.enabled = WS_ENABLED;
    this.socket = null;
    this.token = "";
    this.authenticated = false;
    this.manualClose = false;
    this.reconnectTimer = 0;
    this.heartbeatTimer = 0;
    this.retryCount = 0;
    this.status = this.enabled ? "idle" : "disabled";
    this.eventListeners = new Set();
    this.statusListeners = new Set();
  }

  onEvent(cb) {
    if (typeof cb !== "function") return () => {};
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  onStatus(cb) {
    if (typeof cb !== "function") return () => {};
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  emitEvent(payload) {
    for (const cb of this.eventListeners) {
      try { cb(payload); } catch {}
    }
  }

  setStatus(next) {
    if (this.status === next) return;
    this.status = next;
    for (const cb of this.statusListeners) {
      try { cb(next); } catch {}
    }
  }

  clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = 0;
    this.heartbeatTimer = 0;
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, HEARTBEAT_MS);
  }

  scheduleReconnect() {
    if (this.manualClose || !this.enabled || !this.token) return;
    if (this.reconnectTimer) return;
    this.retryCount += 1;
    const base = Math.min(15000, Math.round(600 * (1.8 ** Math.min(this.retryCount, 8))));
    const jitter = Math.floor(Math.random() * 400);
    const delay = base + jitter;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = 0;
      this.connect(this.token);
    }, delay);
  }

  connect(tokenFromOutside = "") {
    const token = String(tokenFromOutside || localStorage.getItem("token") || "").trim();
    this.token = token;
    if (!this.enabled) {
      this.setStatus("disabled");
      return;
    }
    if (!token) {
      this.disconnect(true);
      this.setStatus("fallback");
      return;
    }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.manualClose = false;
    this.authenticated = false;
    this.setStatus(this.retryCount > 0 ? "reconnecting" : "connecting");

    const ws = new WebSocket(toWsUrl(API_BASE_URL));
    this.socket = ws;

    ws.onopen = () => {
      this.send({ type: "auth", token: this.token });
      this.startHeartbeat();
    };

    ws.onmessage = (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event?.data || "{}");
      } catch {
        return;
      }
      if (!payload || typeof payload !== "object") return;
      if (payload.type === "auth_ok") {
        this.authenticated = true;
        this.retryCount = 0;
        this.setStatus("connected");
        this.emitEvent({ type: "auth_ok", payload });
        return;
      }
      if (payload.type === "event") {
        this.emitEvent(payload);
        return;
      }
      if (payload.type === "error") {
        if (payload.code === "AUTH_FAILED") {
          this.setStatus("fallback");
        }
        this.emitEvent({ type: "error", payload });
      }
    };

    ws.onclose = () => {
      const shouldReconnect = !this.manualClose && this.enabled && Boolean(this.token) && this.status !== "disabled";
      this.clearTimers();
      this.socket = null;
      this.authenticated = false;
      if (shouldReconnect) {
        this.scheduleReconnect();
      } else if (this.status !== "disabled") {
        this.setStatus("fallback");
      }
    };

    ws.onerror = () => {
      // Se maneja en onclose.
    };
  }

  disconnect(manual = true) {
    this.manualClose = manual;
    this.clearTimers();
    if (this.socket) {
      try { this.socket.close(); } catch {}
    }
    this.socket = null;
    this.authenticated = false;
    if (manual) this.retryCount = 0;
  }
}

const realtime = new RealtimeManager();
export default realtime;
