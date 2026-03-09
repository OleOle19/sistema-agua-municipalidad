(function () {
  "use strict";

  const TOKEN_KEY = "campo_app_token";
  const USER_KEY = "campo_app_user";
  const API_BASE_KEY = "campo_app_api_base";
  const DB_NAME = "campo_app_offline";
  const DB_VERSION = 1;
  const STORE_META = "meta";
  const STORE_CALLES = "calles";
  const STORE_CONTRIB = "contribuyentes";
  const STORE_QUEUE = "queue";
  const SNAPSHOT_KEY = "snapshot";
  const SNAPSHOT_MAX_AGE_HOURS = 72;
  const RECENT_SUBMISSIONS_KEY = "campo_app_recent_submissions";
  const RECENT_DUPLICATE_WINDOW_HOURS = 36;
  const SEARCH_PAGE_SIZE = 40;
  const SEARCH_ONLINE_LIMIT = 300;
  const SEARCH_LOCAL_LIMIT = 1200;
  const RETRY_BASE_DELAY_MS = 20 * 1000;
  const RETRY_MAX_DELAY_MS = 30 * 60 * 1000;
  const TIPOS_SOLICITUD = {
    ACTUALIZACION: "ACTUALIZACION",
    ALTA_DIRECCION_ALTERNA: "ALTA_DIRECCION_ALTERNA"
  };
  const ROLE_LEVEL = { BRIGADA: 1, CAJERO: 2, ADMIN_SEC: 3, ADMIN: 4 };
  const ROLE_ALIASES = {
    BRIGADA: "BRIGADA",
    BRIGADISTA: "BRIGADA",
    CAMPO: "BRIGADA",
    NIVEL_5: "BRIGADA",
    CAJERO: "CAJERO",
    OPERADOR_CAJA: "CAJERO",
    OPERADOR: "CAJERO",
    NIVEL_3: "CAJERO",
    ADMIN_SEC: "ADMIN_SEC",
    ADMIN_SECUNDARIO: "ADMIN_SEC",
    JEFE_CAJA: "ADMIN_SEC",
    NIVEL_2: "ADMIN_SEC",
    ADMIN: "ADMIN",
    SUPERADMIN: "ADMIN",
    ADMIN_PRINCIPAL: "ADMIN",
    NIVEL_1: "ADMIN"
  };

  const el = {
    apiConfigCard: document.getElementById("apiConfigCard"),
    apiBaseUrl: document.getElementById("apiBaseUrl"),
    saveApiBtn: document.getElementById("saveApiBtn"),
    authSection: document.getElementById("authSection"),
    appSection: document.getElementById("appSection"),
    loginForm: document.getElementById("loginForm"),
    username: document.getElementById("username"),
    password: document.getElementById("password"),
    userInfo: document.getElementById("userInfo"),
    logoutBtn: document.getElementById("logoutBtn"),
    syncOfflineBtn: document.getElementById("syncOfflineBtn"),
    syncQueueBtn: document.getElementById("syncQueueBtn"),
    refreshQueueBtn: document.getElementById("refreshQueueBtn"),
    offlineInfo: document.getElementById("offlineInfo"),
    healthPanel: document.getElementById("healthPanel"),
    queueList: document.getElementById("queueList"),
    searchInput: document.getElementById("searchInput"),
    streetFilter: document.getElementById("streetFilter"),
    searchResults: document.getElementById("searchResults"),
    solicitudForm: document.getElementById("solicitudForm"),
    selectedInfo: document.getElementById("selectedInfo"),
    duplicateWarning: document.getElementById("duplicateWarning"),
    tipoSolicitud: document.getElementById("tipoSolicitud"),
    tipoSolicitudHint: document.getElementById("tipoSolicitudHint"),
    nombreVerificado: document.getElementById("nombreVerificado"),
    dniVerificado: document.getElementById("dniVerificado"),
    direccionVerificada: document.getElementById("direccionVerificada"),
    aguaSn: document.getElementById("aguaSn"),
    desagueSn: document.getElementById("desagueSn"),
    limpiezaSn: document.getElementById("limpiezaSn"),
    visitadoSn: document.getElementById("visitadoSn"),
    cortadoSn: document.getElementById("cortadoSn"),
    fechaCorte: document.getElementById("fechaCorte"),
    motivoObs: document.getElementById("motivoObs"),
    inspector: document.getElementById("inspector"),
    submitSolicitudBtn: document.getElementById("submitSolicitudBtn"),
    statusSection: document.getElementById("statusSection")
  };

  const state = {
    apiBase: normalizeBase(localStorage.getItem(API_BASE_KEY) || window.location.origin),
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: parseJson(localStorage.getItem(USER_KEY)),
    online: navigator.onLine,
    calles: [],
    contribuyentes: [],
    searchRows: [],
    filtered: [],
    searchVisibleCount: SEARCH_PAGE_SIZE,
    searchTruncated: false,
    selectedId: 0,
    queueCount: 0,
    queueItems: [],
    queueActionKey: "",
    syncing: false,
    snapshot: null,
    recentSubmissions: [],
    lastQueueSyncAt: null,
    lastQueueSyncOkAt: null,
    lastQueueSyncError: "",
    warnedNoSnapshotOffline: false,
    warnedSnapshotExpired: false
  };

  let dbPromise = null;
  let searchTimer = null;
  let statusTimer = null;
  let queueAutoSyncTimer = null;

  function parseJson(v) { try { return v ? JSON.parse(v) : null; } catch { return null; } }
  function normalizeBase(v) { try { return new URL(String(v || "").trim() || window.location.origin).origin; } catch { return window.location.origin; } }
  function normalizeRole(role) {
    const raw = String(role || "").trim().toUpperCase();
    return ROLE_ALIASES[raw] || "";
  }
  function hasMinRole(role, minRole) {
    const current = normalizeRole(role);
    return (ROLE_LEVEL[current] || 0) >= (ROLE_LEVEL[minRole] || 0);
  }
  function fmtMoney(v) { const n = Number(v || 0); return Number.isFinite(n) ? n.toFixed(2) : "0.00"; }
  function norm(v) { return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
  function normalizeSN(value, fallback) {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "S" || normalized === "SI") return "S";
    if (normalized === "N" || normalized === "NO") return "N";
    return String(fallback || "S").trim().toUpperCase() === "N" ? "N" : "S";
  }
  function normalizeTipoSolicitud(value, fallback) {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === TIPOS_SOLICITUD.ALTA_DIRECCION_ALTERNA) return TIPOS_SOLICITUD.ALTA_DIRECCION_ALTERNA;
    if (normalized === TIPOS_SOLICITUD.ACTUALIZACION) return TIPOS_SOLICITUD.ACTUALIZACION;
    return fallback === TIPOS_SOLICITUD.ALTA_DIRECCION_ALTERNA
      ? TIPOS_SOLICITUD.ALTA_DIRECCION_ALTERNA
      : TIPOS_SOLICITUD.ACTUALIZACION;
  }
  function isAltaDireccionMode() {
    return normalizeTipoSolicitud(el.tipoSolicitud && el.tipoSolicitud.value, TIPOS_SOLICITUD.ACTUALIZACION) === TIPOS_SOLICITUD.ALTA_DIRECCION_ALTERNA;
  }
  function renderTipoSolicitudHint() {
    if (!el.tipoSolicitudHint) return;
    el.tipoSolicitudHint.textContent = isAltaDireccionMode()
      ? "Registra una direccion secundaria del mismo contribuyente (no reemplaza la direccion principal)."
      : "Actualiza datos del registro principal del contribuyente.";
  }
  function seguimientoMotivoLabel(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return "";
    if (raw === "NO_VISITADO") return "No visitado";
    if (raw === "OBSERVACION") return "Con observacion";
    if (raw === "NO_VISITADO_Y_OBSERVACION") return "No visitado + observacion";
    return raw;
  }
  function parseMontosList(value) {
    if (Array.isArray(value)) {
      return value
        .map((x) => Number.parseFloat(x))
        .filter((n) => Number.isFinite(n));
    }
    const raw = String(value || "").trim();
    if (!raw) return [];
    return raw
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((x) => Number.parseFloat(String(x || "").trim()))
      .filter((n) => Number.isFinite(n));
  }
  function toDateMs(value) { const ms = Date.parse(String(value || "")); return Number.isFinite(ms) ? ms : 0; }
  function fmtDateTime(value) { const ms = toDateMs(value); return ms ? new Date(ms).toLocaleString("es-PE") : "sin fecha"; }
  function fmtAgo(value) {
    const ms = toDateMs(value);
    if (!ms) return "sin fecha";
    const diff = Date.now() - ms;
    if (diff < 0) return "en unos segundos";
    const min = Math.floor(diff / 60000);
    if (min < 1) return "hace segundos";
    if (min < 60) return "hace " + min + " min";
    const h = Math.floor(min / 60);
    if (h < 24) return "hace " + h + " h";
    const d = Math.floor(h / 24);
    return "hace " + d + " d";
  }
  function fmtFuture(value) {
    const ms = toDateMs(value);
    if (!ms) return "sin programar";
    const diff = ms - Date.now();
    if (diff <= 0) return "ahora";
    const min = Math.ceil(diff / 60000);
    if (min < 60) return "en " + min + " min";
    const h = Math.ceil(min / 60);
    if (h < 24) return "en " + h + " h";
    const d = Math.ceil(h / 24);
    return "en " + d + " d";
  }
  function calcRetryDelayMs(retryCount) {
    const exp = Math.max(0, Number(retryCount || 0));
    return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * Math.pow(2, exp));
  }
  function queueItemRetryCount(item) {
    return Math.max(0, Number(item && item.retry_count || 0));
  }
  function queueItemReady(item, nowMs) {
    if (Number(item && item.blocked || 0) === 1) return false;
    const nextMs = toDateMs(item && item.next_retry_at);
    if (!nextMs) return true;
    return nextMs <= (nowMs || Date.now());
  }
  function queueRetryHint(item) {
    if (Number(item && item.blocked || 0) === 1) return "No reintentar automatico";
    if (queueItemReady(item)) return "Listo para envio";
    return "Proximo: " + fmtFuture(item && item.next_retry_at);
  }
  function normalizeQueueItem(item) {
    if (!item || typeof item !== "object") return item;
    const retryCount = queueItemRetryCount(item);
    const hasNext = toDateMs(item.next_retry_at) > 0;
    return Object.assign({}, item, {
      retry_count: retryCount,
      next_retry_at: hasNext ? item.next_retry_at : (item.created_at || new Date().toISOString()),
      last_attempt_at: item.last_attempt_at || null
    });
  }
  function pruneRecentSubmissions(list) {
    const now = Date.now();
    const maxAgeMs = RECENT_DUPLICATE_WINDOW_HOURS * 60 * 60 * 1000;
    const rows = Array.isArray(list) ? list : [];
    return rows
      .filter((r) => Number(r && r.id_contribuyente) > 0)
      .filter((r) => {
        const age = now - toDateMs(r.created_at);
        return age >= 0 && age <= maxAgeMs;
      })
      .slice(-400);
  }
  function saveRecentSubmissions() {
    try {
      localStorage.setItem(RECENT_SUBMISSIONS_KEY, JSON.stringify(state.recentSubmissions));
    } catch {}
  }
  function rememberRecentSubmission(idContribuyente, source, detail) {
    const id = Number(idContribuyente || 0);
    if (!id) return;
    const userId = Number(state.user && state.user.id_usuario || 0);
    const next = state.recentSubmissions.concat([{
      user_id: userId > 0 ? userId : null,
      id_contribuyente: id,
      source: String(source || "campo"),
      detail: String(detail || ""),
      created_at: new Date().toISOString()
    }]);
    state.recentSubmissions = pruneRecentSubmissions(next);
    saveRecentSubmissions();
  }
  function duplicateSummary(idContribuyente) {
    const id = Number(idContribuyente || 0);
    if (!id) return { has: false, total: 0, queued: 0, recent: 0, latestAt: null };
    const maxAgeMs = RECENT_DUPLICATE_WINDOW_HOURS * 60 * 60 * 1000;
    const now = Date.now();
    const currentUserId = Number(state.user && state.user.id_usuario || 0);
    const queued = state.queueItems.filter((item) => {
      if (Number(item && item.payload && item.payload.id_contribuyente) !== id) return false;
      const age = now - toDateMs(item && item.created_at);
      return age >= 0 && age <= maxAgeMs;
    });
    const recent = state.recentSubmissions.filter((r) => {
      if (Number(r && r.id_contribuyente) !== id) return false;
      if (!currentUserId) return true;
      const rowUserId = Number(r && r.user_id || 0);
      return !rowUserId || rowUserId === currentUserId;
    });
    const allTimes = queued.map((x) => x.created_at).concat(recent.map((x) => x.created_at)).map(toDateMs).filter((x) => x > 0);
    const latestAt = allTimes.length ? new Date(Math.max.apply(null, allTimes)).toISOString() : null;
    const total = queued.length + recent.length;
    return { has: total > 0, total: total, queued: queued.length, recent: recent.length, latestAt: latestAt };
  }
  function updateDuplicateWarning(idContribuyente) {
    if (!el.duplicateWarning) return;
    const info = duplicateSummary(idContribuyente);
    if (!info.has) {
      el.duplicateWarning.textContent = "";
      el.duplicateWarning.classList.add("hidden");
      return;
    }
    const latestTxt = info.latestAt ? fmtAgo(info.latestAt) : "sin fecha";
    el.duplicateWarning.textContent =
      "Atencion: ya existe actividad reciente para este contribuyente (cola: " + info.queued +
      ", enviados: " + info.recent + ", ultimo: " + latestTxt + ").";
    el.duplicateWarning.classList.remove("hidden");
  }
  function updateVisibleResults() {
    const visible = Math.max(0, Number(state.searchVisibleCount || 0));
    state.filtered = state.searchRows.slice(0, visible);
  }
  function showMoreResults() {
    const next = Math.min(state.searchRows.length, Number(state.searchVisibleCount || 0) + SEARCH_PAGE_SIZE);
    state.searchVisibleCount = next;
    updateVisibleResults();
    renderResults();
  }
  function snapshotAgeHours() {
    if (!state.snapshot || !state.snapshot.synced_at) return null;
    const syncedMs = toDateMs(state.snapshot.synced_at);
    if (!syncedMs) return null;
    return (Date.now() - syncedMs) / (1000 * 60 * 60);
  }
  function isSnapshotFresh() {
    const age = snapshotAgeHours();
    return age !== null && age <= SNAPSHOT_MAX_AGE_HOURS;
  }
  function requiresFreshSnapshotForOfflineWork() {
    return !state.online && !isSnapshotFresh();
  }
  function mountFormInsideResult(resultItem) {
    if (!resultItem || !el.solicitudForm) return;
    const parent = resultItem.parentElement;
    if (!parent) return;
    const slot = document.createElement("div");
    slot.className = "result-form-slot";
    slot.appendChild(el.solicitudForm);
    parent.insertBefore(slot, resultItem.nextSibling);
  }
  function parkFormHidden() {
    if (!el.solicitudForm || !el.appSection) return;
    if (el.solicitudForm.parentElement !== el.appSection) el.appSection.appendChild(el.solicitudForm);
    el.solicitudForm.classList.remove("open");
    el.solicitudForm.classList.add("hidden");
  }
  function healthStats() {
    const now = Date.now();
    const blocked = state.queueItems.filter((x) => Number(x && x.blocked || 0) === 1).length;
    const waiting = state.queueItems.filter((x) => Number(x && x.blocked || 0) !== 1 && !queueItemReady(x, now)).length;
    const ready = Math.max(0, state.queueItems.length - blocked - waiting);
    const nextRetryAt = state.queueItems
      .filter((x) => Number(x && x.blocked || 0) !== 1 && !queueItemReady(x, now))
      .map((x) => x.next_retry_at)
      .map(toDateMs)
      .filter((x) => x > 0)
      .sort((a, b) => a - b)[0] || 0;
    return {
      blocked: blocked,
      waiting: waiting,
      ready: ready,
      nextRetryAt: nextRetryAt ? new Date(nextRetryAt).toISOString() : null
    };
  }
  function renderHealthPanel() {
    if (!el.healthPanel) return;
    el.healthPanel.innerHTML = "";
    el.healthPanel.classList.add("hidden");
  }

  function setStatus(msg, type, timeout) {
    el.statusSection.textContent = msg;
    el.statusSection.className = "status " + (type || "success");
    el.statusSection.classList.remove("hidden");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.statusSection.className = "status hidden"; }, timeout || 4000);
  }

  function renderAuth() {
    const logged = !!(state.token && state.user);
    el.authSection.classList.toggle("hidden", logged);
    el.appSection.classList.toggle("hidden", !logged);
    if (logged) el.userInfo.textContent = (state.user.nombre || "Sin nombre") + " | " + (state.user.rol || "SIN_ROL");
    if (!logged) {
      state.selectedId = 0;
      state.searchRows = [];
      state.searchVisibleCount = SEARCH_PAGE_SIZE;
      state.searchTruncated = false;
      state.queueItems = [];
      state.queueCount = 0;
      el.selectedInfo.textContent = "";
      if (el.duplicateWarning) {
        el.duplicateWarning.textContent = "";
        el.duplicateWarning.classList.add("hidden");
      }
      parkFormHidden();
      el.searchResults.innerHTML = "";
      if (el.queueList) el.queueList.innerHTML = '<p class="muted">Inicia sesion para ver pendientes.</p>';
    }
    renderHealthPanel();
    updateOperationalLock();
  }

  function updateInfo() {
    const snap = state.snapshot && state.snapshot.synced_at ? fmtDateTime(state.snapshot.synced_at) : "sin snapshot";
    const age = snapshotAgeHours();
    let snapshotState = "SIN_SNAPSHOT";
    if (age !== null && age <= SNAPSHOT_MAX_AGE_HOURS) snapshotState = "OK";
    if (age !== null && age > SNAPSHOT_MAX_AGE_HOURS) snapshotState = "VENCIDO";
    el.offlineInfo.textContent =
      "Conexion: " + (state.online ? "Online" : "Offline") +
      " | Pendientes: " + state.queueCount +
      " | Snapshot: " + snap +
      " | Estado: " + snapshotState;

    if (!state.snapshot && !state.online && !state.warnedNoSnapshotOffline) {
      state.warnedNoSnapshotOffline = true;
      setStatus("No hay snapshot local. Conectate a la red municipal y presiona 'Sincronizar offline'.", "warning", 5000);
    }
    if (snapshotState === "VENCIDO" && !state.warnedSnapshotExpired) {
      state.warnedSnapshotExpired = true;
      setStatus("Snapshot vencido. Debes sincronizar offline antes de salir a campo.", "warning", 5500);
    }
    if (snapshotState !== "VENCIDO") state.warnedSnapshotExpired = false;
    if (state.snapshot || state.online) state.warnedNoSnapshotOffline = false;
    renderHealthPanel();
    updateOperationalLock();
  }

  function updateOperationalLock() {
    const blocked = requiresFreshSnapshotForOfflineWork();
    if (el.searchInput) el.searchInput.disabled = blocked;
    if (el.streetFilter) el.streetFilter.disabled = blocked;
    if (el.submitSolicitudBtn) el.submitSolicitudBtn.disabled = blocked;
    if (blocked) {
      state.searchRows = [];
      state.filtered = [];
      state.searchVisibleCount = SEARCH_PAGE_SIZE;
      state.searchTruncated = false;
      state.selectedId = 0;
      el.searchResults.innerHTML = '<div class="muted">Operacion bloqueada offline: sincroniza snapshot reciente antes de trabajar en campo.</div>';
      if (el.duplicateWarning) {
        el.duplicateWarning.textContent = "";
        el.duplicateWarning.classList.add("hidden");
      }
      parkFormHidden();
    }
  }

  function authHeaders(extra) {
    const h = Object.assign({ "Content-Type": "application/json" }, extra || {});
    if (state.token) h.Authorization = "Bearer " + state.token;
    return h;
  }

  async function api(path, opts) {
    const conf = opts || {};
    let res;
    try {
      res = await fetch(state.apiBase + path, {
        method: conf.method || "GET",
        headers: conf.headers || {},
        body: conf.body ? JSON.stringify(conf.body) : undefined
      });
    } catch {
      const err = new Error("No se pudo conectar al servidor.");
      err.isNetworkError = true;
      throw err;
    }
    const isJson = String(res.headers.get("content-type") || "").includes("application/json");
    const data = isJson ? await res.json() : { error: await res.text() };
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || "Error de API");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "key" });
        if (!db.objectStoreNames.contains(STORE_CALLES)) db.createObjectStore(STORE_CALLES, { keyPath: "id_calle" });
        if (!db.objectStoreNames.contains(STORE_CONTRIB)) db.createObjectStore(STORE_CONTRIB, { keyPath: "id_contribuyente" });
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          const q = db.createObjectStore(STORE_QUEUE, { keyPath: "idempotency_key" });
          q.createIndex("by_user", "user_id", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("No se pudo abrir IndexedDB."));
    });
    return dbPromise;
  }

  async function idbGet(store, key) { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction(store, "readonly"); const r = tx.objectStore(store).get(key); r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error); }); }
  async function idbPut(store, value) { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
  async function idbDel(store, key) { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).delete(key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
  async function idbAll(store) { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction(store, "readonly"); const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(Array.isArray(r.result) ? r.result : []); r.onerror = () => reject(r.error); }); }
  async function queueByUser(userId) {
    if (!userId) return [];
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, "readonly");
      const i = tx.objectStore(STORE_QUEUE).index("by_user");
      const r = i.getAll(IDBKeyRange.only(Number(userId)));
      r.onsuccess = () => {
        if (!Array.isArray(r.result)) {
          resolve([]);
          return;
        }
        const normalized = r.result.map((x) => normalizeQueueItem(x));
        const rows = normalized.sort((a, b) => {
          const aMs = toDateMs(a && a.created_at);
          const bMs = toDateMs(b && b.created_at);
          if (aMs !== bMs) return aMs - bMs;
          return String((a && a.idempotency_key) || "").localeCompare(String((b && b.idempotency_key) || ""));
        });
        resolve(rows);
      };
      r.onerror = () => reject(r.error);
    });
  }

  async function replaceSnapshot(calles, contribuyentes, meta) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_CALLES, STORE_CONTRIB], "readwrite");
      const sMeta = tx.objectStore(STORE_META);
      const sCalles = tx.objectStore(STORE_CALLES);
      const sContrib = tx.objectStore(STORE_CONTRIB);
      sCalles.clear(); sContrib.clear();
      calles.forEach((c) => { if (Number(c.id_calle) > 0) sCalles.put({ id_calle: Number(c.id_calle), nombre: String(c.nombre || "").trim() }); });
      contribuyentes.forEach((c) => { if (Number(c.id_contribuyente) > 0) sContrib.put(c); });
      sMeta.put({ key: SNAPSHOT_KEY, value: meta });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadLocalData() {
    const [calles, contribuyentes, snap] = await Promise.all([idbAll(STORE_CALLES), idbAll(STORE_CONTRIB), idbGet(STORE_META, SNAPSHOT_KEY)]);
    state.calles = calles.sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || "")));
    state.contribuyentes = contribuyentes;
    state.snapshot = snap && snap.value ? snap.value : null;
    const prev = el.streetFilter.value;
    el.streetFilter.innerHTML = '<option value="">Todas las calles</option>' + state.calles.map((c) => '<option value="' + Number(c.id_calle) + '">' + String(c.nombre || "").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</option>").join("");
    if (prev && el.streetFilter.querySelector('option[value="' + prev + '"]')) el.streetFilter.value = prev;
    updateInfo();
  }

  function queueStatusClass(item) {
    if (Number(item && item.blocked || 0) === 1) return "blocked";
    return queueItemReady(item) ? "pending" : "waiting";
  }

  function queueStatusLabel(item) {
    if (Number(item && item.blocked || 0) === 1) return "BLOQUEADO";
    return queueItemReady(item) ? "PENDIENTE" : "EN_ESPERA";
  }

  async function retryQueueItem(key) {
    const idempotencyKey = String(key || "").trim();
    if (!idempotencyKey) return;
    const item = await idbGet(STORE_QUEUE, idempotencyKey);
    if (!item) {
      await refreshQueueCount();
      return;
    }
    state.queueActionKey = idempotencyKey;
    renderQueue();
    try {
      if (!state.online) {
        const retryCount = queueItemRetryCount(item) + 1;
        const nextRetryAt = new Date(Date.now() + calcRetryDelayMs(retryCount)).toISOString();
        await idbPut(STORE_QUEUE, Object.assign({}, item, {
          blocked: 0,
          retry_count: retryCount,
          next_retry_at: nextRetryAt,
          last_attempt_at: new Date().toISOString(),
          last_error: "sin_conexion"
        }));
        setStatus("Sin internet. Pendiente marcado para reintento automatico.", "warning", 4500);
      } else {
        await sendSolicitud(item.payload);
        await idbDel(STORE_QUEUE, idempotencyKey);
        rememberRecentSubmission(item && item.payload && item.payload.id_contribuyente, "sync", "reintento_manual");
        state.lastQueueSyncOkAt = new Date().toISOString();
        state.lastQueueSyncError = "";
        setStatus("Pendiente enviado correctamente.", "success", 3000);
      }
    } catch (err) {
      const hardError = !(err.status === 401 || err.status === 403 || err.isNetworkError || err.status >= 500);
      const retryCount = queueItemRetryCount(item) + 1;
      const nextRetryAt = new Date(Date.now() + calcRetryDelayMs(retryCount)).toISOString();
      await idbPut(STORE_QUEUE, Object.assign({}, item, {
        blocked: hardError ? 1 : 0,
        retry_count: hardError ? queueItemRetryCount(item) : retryCount,
        next_retry_at: hardError ? (item.next_retry_at || new Date().toISOString()) : nextRetryAt,
        last_attempt_at: new Date().toISOString(),
        last_error: err.message || "reintento_fallido"
      }));
      state.lastQueueSyncError = err.message || "reintento_fallido";
      setStatus(err.message || "No se pudo reintentar este pendiente.", "warning", 5000);
    } finally {
      state.queueActionKey = "";
      await refreshQueueCount();
    }
  }

  async function removeQueueItem(key) {
    const idempotencyKey = String(key || "").trim();
    if (!idempotencyKey) return;
    await idbDel(STORE_QUEUE, idempotencyKey);
    await refreshQueueCount();
  }

  function renderQueue() {
    if (!el.queueList) return;
    if (!(state.user && state.token)) {
      el.queueList.innerHTML = '<p class="muted">Inicia sesion para ver pendientes.</p>';
      return;
    }
    if (!state.queueItems.length) {
      el.queueList.innerHTML = '<p class="muted">No hay pendientes offline.</p>';
      return;
    }
    el.queueList.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (const item of state.queueItems) {
      const row = document.createElement("article");
      row.className = "queue-item";
      const ref = item.contribuyente_ref || {};
      const title = document.createElement("strong");
      title.textContent = (ref.codigo_municipal || "SIN-CODIGO") + " - " + (ref.nombre_completo || "Contribuyente");
      const status = document.createElement("span");
      status.className = "queue-status " + queueStatusClass(item);
      status.textContent = queueStatusLabel(item);
      const meta1 = document.createElement("div");
      meta1.className = "meta";
      meta1.textContent = "Creado: " + fmtDateTime(item.created_at);
      const meta2 = document.createElement("div");
      meta2.className = "meta";
      meta2.textContent = "Error: " + (item.last_error || "sin error") + " | Intentos: " + queueItemRetryCount(item);
      const meta3 = document.createElement("div");
      meta3.className = "meta";
      meta3.textContent = queueRetryHint(item);
      const actions = document.createElement("div");
      actions.className = "queue-actions";
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "secondary";
      retryBtn.textContent = "Reintentar";
      retryBtn.disabled = state.queueActionKey === item.idempotency_key;
      retryBtn.addEventListener("click", () => {
        retryQueueItem(item.idempotency_key).catch((err) => console.error(err));
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "secondary";
      deleteBtn.textContent = "Eliminar";
      deleteBtn.disabled = state.queueActionKey === item.idempotency_key;
      deleteBtn.addEventListener("click", () => {
        removeQueueItem(item.idempotency_key).catch((err) => console.error(err));
      });
      actions.appendChild(retryBtn);
      actions.appendChild(deleteBtn);
      row.appendChild(title);
      row.appendChild(status);
      row.appendChild(meta1);
      row.appendChild(meta2);
      row.appendChild(meta3);
      row.appendChild(actions);
      fragment.appendChild(row);
    }
    el.queueList.appendChild(fragment);
  }

  function renderResults() {
    el.searchResults.innerHTML = "";
    if (!state.filtered.length) {
      const d = document.createElement("div");
      d.className = "muted";
      d.textContent = "Sin resultados. Escribe al menos 2 letras o elige una calle.";
      el.searchResults.appendChild(d);
      if (el.duplicateWarning) {
        el.duplicateWarning.textContent = "";
        el.duplicateWarning.classList.add("hidden");
      }
      parkFormHidden();
      return;
    }
    const frag = document.createDocumentFragment();
    let mountedForm = false;
    let selectedItem = null;
    let selectedContribuyenteId = 0;
    state.filtered.forEach((c) => {
      const id = Number(c.id_contribuyente || 0);
      const isSelected = id === state.selectedId;
      const item = document.createElement("article");
      item.className = "result-item" + (isSelected ? " is-selected" : "");
      const t = document.createElement("strong"); t.textContent = (c.codigo_municipal || "SIN-CODIGO") + " - " + (c.nombre_completo || "Sin nombre");
      const d = document.createElement("div"); d.className = "meta"; d.textContent = c.direccion_completa || c.nombre_calle || "Sin direccion";
      const direccionAlterna = String(c.direccion_alterna || "").trim();
      const dAlt = document.createElement("div");
      dAlt.className = "meta";
      dAlt.textContent = direccionAlterna ? ("Dir. alterna: " + direccionAlterna) : "";
      const m = document.createElement("div"); m.className = "meta"; m.textContent = "Meses deuda: " + Number(c.meses_deuda || 0) + " | Total: S/ " + fmtMoney(c.deuda_total);
      const cargoRef = Number(c.cargo_mensual_ultimo || 0);
      const montosMensuales = parseMontosList(c.montos_mensuales_24m);
      const montosTxt = montosMensuales.length ? montosMensuales.map((n) => fmtMoney(n)).join(", ") : "-";
      const pagoRef = document.createElement("div");
      pagoRef.className = "meta";
      pagoRef.textContent = "Mensual sistema: S/ " + fmtMoney(cargoRef) + " | Montos referencia 24m: " + montosTxt;
      const emisionRef = document.createElement("div");
      emisionRef.className = "meta";
      emisionRef.textContent = "Ultima emision recibo: " + (String(c.ultima_emision_periodo || "").trim() || "Sin registros");
      const ultimoPagoRef = document.createElement("div");
      ultimoPagoRef.className = "meta";
      ultimoPagoRef.textContent = "Ultimo mes pagado: " + (String(c.ultimo_mes_pagado_periodo || "").trim() || "Sin pagos");
      const seguimientoPendiente = String(c.seguimiento_pendiente_sn || "N").trim().toUpperCase() === "S";
      const seguimientoMotivo = seguimientoMotivoLabel(c.seguimiento_motivo);
      const seg = document.createElement("div");
      seg.className = "meta";
      seg.textContent = seguimientoPendiente
        ? ("Pendiente proxima visita: SI" + (seguimientoMotivo ? " (" + seguimientoMotivo + ")" : ""))
        : "Pendiente proxima visita: NO";
      const b = document.createElement("button");
      b.type = "button"; b.textContent = isSelected ? "Seleccionado" : "Seleccionar";
      b.addEventListener("click", () => {
        if (state.selectedId === id) {
          state.selectedId = 0;
          resetForm();
          closeForm();
          renderResults();
          return;
        }
        const aguaSn = normalizeSN(c.agua_sn, "S");
        const desagueSn = normalizeSN(c.desague_sn, "S");
        const limpiezaSn = normalizeSN(c.limpieza_sn, "S");
        state.selectedId = id;
        el.selectedInfo.textContent =
          "Seleccionado: " + (c.codigo_municipal || "SIN-CODIGO") + " - " + (c.nombre_completo || "Sin nombre") +
          " | Servicios: Agua " + aguaSn + " | Desague " + desagueSn + " | Limpieza " + limpiezaSn +
          (direccionAlterna ? (" | Dir. alterna: " + direccionAlterna) : "");
        if (el.tipoSolicitud) el.tipoSolicitud.value = TIPOS_SOLICITUD.ACTUALIZACION;
        renderTipoSolicitudHint();
        el.nombreVerificado.value = c.nombre_completo || "";
        el.dniVerificado.value = c.dni_ruc || "";
        syncDireccionFieldForTipo({ forceClear: false });
        el.aguaSn.value = aguaSn;
        el.desagueSn.value = desagueSn;
        if (el.limpiezaSn) el.limpiezaSn.value = limpiezaSn;
        el.inspector.value = String((state.user && state.user.nombre) || "");
        updateDuplicateWarning(id);
        renderResults();
      });
      item.appendChild(t);
      item.appendChild(d);
      if (direccionAlterna) item.appendChild(dAlt);
      item.appendChild(m);
      item.appendChild(pagoRef);
      item.appendChild(emisionRef);
      item.appendChild(ultimoPagoRef);
      item.appendChild(seg);
      item.appendChild(b);
      if (isSelected) {
        selectedItem = item;
        selectedContribuyenteId = id;
      }
      frag.appendChild(item);
    });
    el.searchResults.appendChild(frag);
    if (selectedItem) {
      mountFormInsideResult(selectedItem);
      el.solicitudForm.classList.remove("hidden");
      requestAnimationFrame(() => el.solicitudForm.classList.add("open"));
      updateDuplicateWarning(selectedContribuyenteId);
      mountedForm = true;
    }
    if (!mountedForm) {
      if (el.duplicateWarning) {
        el.duplicateWarning.textContent = "";
        el.duplicateWarning.classList.add("hidden");
      }
      parkFormHidden();
    }
    const shown = state.filtered.length;
    const total = state.searchRows.length;
    if (total > shown || state.searchTruncated) {
      const footer = document.createElement("div");
      footer.className = "results-footer";
      const meta = document.createElement("div");
      meta.className = "meta";
      const truncMsg = state.searchTruncated ? " Se alcanzo el limite de busqueda; refine para ver mas." : "";
      meta.textContent = "Mostrando " + shown + " de " + total + "." + truncMsg;
      footer.appendChild(meta);
      if (total > shown) {
        const moreBtn = document.createElement("button");
        moreBtn.type = "button";
        moreBtn.className = "secondary";
        moreBtn.textContent = "Mostrar mas";
        moreBtn.addEventListener("click", () => showMoreResults());
        footer.appendChild(moreBtn);
      }
      el.searchResults.appendChild(footer);
    }
  }

  function closeForm() {
    if (state.selectedId) return;
    parkFormHidden();
  }

  function localSearch(qRaw, idCalleRaw) {
    const q = norm(qRaw);
    const idCalle = Number(idCalleRaw || 0);
    if (!idCalle && q.length < 2) return { rows: [], truncated: false };
    const rows = [];
    let truncated = false;
    for (const c of state.contribuyentes) {
      if (idCalle && Number(c.id_calle || 0) !== idCalle) continue;
      if (q.length >= 2) {
        const hit = [c.nombre_completo, c.dni_ruc, c.codigo_municipal, c.direccion_completa, c.direccion_alterna, c.nombre_calle].some((x) => norm(x).includes(q));
        if (!hit) continue;
      }
      rows.push(c);
      if (rows.length >= SEARCH_LOCAL_LIMIT) {
        truncated = true;
        break;
      }
    }
    return { rows: rows, truncated: truncated };
  }

  async function search() {
    if (requiresFreshSnapshotForOfflineWork()) {
      state.searchRows = [];
      state.filtered = [];
      state.searchVisibleCount = SEARCH_PAGE_SIZE;
      state.searchTruncated = false;
      renderResults();
      closeForm();
      setStatus("Operacion bloqueada offline: sincroniza snapshot reciente antes de trabajar.", "warning", 5000);
      return;
    }
    const q = String(el.searchInput.value || "").trim();
    const idCalle = Number(el.streetFilter.value || 0);
    if (!idCalle && q.length < 2) {
      state.searchRows = [];
      state.filtered = [];
      state.searchVisibleCount = SEARCH_PAGE_SIZE;
      state.searchTruncated = false;
      state.selectedId = 0;
      renderResults();
      closeForm();
      return;
    }
    let rows = [];
    let truncated = false;
    if (state.online && state.token) {
      try {
        const p = new URLSearchParams();
        if (q.length >= 2) p.set("q", q);
        if (idCalle) p.set("id_calle", String(idCalle));
        p.set("limit", String(SEARCH_ONLINE_LIMIT));
        const remoteRows = await api("/campo/contribuyentes/buscar?" + p.toString(), { headers: authHeaders() });
        rows = Array.isArray(remoteRows) ? remoteRows : [];
        truncated = rows.length >= SEARCH_ONLINE_LIMIT;
      } catch (err) {
        if (err.status === 401 || err.status === 403) setStatus("Sesion expirada. Ingresa nuevamente.", "warning", 5000);
        const local = localSearch(q, idCalle);
        rows = local.rows;
        truncated = local.truncated;
      }
    } else {
      const local = localSearch(q, idCalle);
      rows = local.rows;
      truncated = local.truncated;
    }
    state.searchRows = rows;
    state.searchTruncated = truncated;
    state.searchVisibleCount = Math.min(SEARCH_PAGE_SIZE, state.searchRows.length);
    const selectedIndex = state.searchRows.findIndex((x) => Number(x.id_contribuyente) === Number(state.selectedId));
    if (selectedIndex >= 0 && (selectedIndex + 1) > state.searchVisibleCount) {
      state.searchVisibleCount = selectedIndex + 1;
    }
    updateVisibleResults();
    if (selectedIndex < 0) { state.selectedId = 0; closeForm(); }
    renderResults();
  }

  function queueSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => search().catch((e) => console.error(e)), 240);
  }

  async function refreshQueueCount() {
    const rows = await queueByUser(state.user && state.user.id_usuario);
    state.queueCount = rows.length;
    state.queueItems = rows;
    if (state.selectedId) updateDuplicateWarning(state.selectedId);
    updateInfo();
    renderHealthPanel();
    renderQueue();
  }

  async function syncSnapshot(silent) {
    if (!state.token) { if (!silent) setStatus("Debes iniciar sesion para sincronizar snapshot.", "warning"); return; }
    if (!state.online) { if (!silent) setStatus("Sin internet.", "warning"); return; }
    el.syncOfflineBtn.disabled = true;
    try {
      const data = await api("/campo/offline-snapshot?limit=10000", { headers: authHeaders() });
      const calles = Array.isArray(data.calles) ? data.calles : [];
      const contribuyentes = Array.isArray(data.contribuyentes) ? data.contribuyentes : [];
      const meta = { synced_at: data.synced_at || new Date().toISOString(), total: Number(data.total || contribuyentes.length || 0) };
      await replaceSnapshot(calles, contribuyentes, meta);
      await loadLocalData();
      if (!silent) setStatus("Snapshot actualizado: " + meta.total + " contribuyentes.", "success");
      await search();
    } catch (err) {
      if (!silent) setStatus(err.message || "No se pudo actualizar snapshot.", "error", 5000);
    } finally {
      el.syncOfflineBtn.disabled = false;
    }
  }

  function selectedContrib() {
    const id = Number(state.selectedId || 0);
    return state.filtered.find((x) => Number(x.id_contribuyente) === id)
      || state.searchRows.find((x) => Number(x.id_contribuyente) === id)
      || state.contribuyentes.find((x) => Number(x.id_contribuyente) === id)
      || null;
  }

  function syncDireccionFieldForTipo(options) {
    const cfg = options || {};
    const c = selectedContrib();
    if (!c || !el.direccionVerificada) return;
    const alta = isAltaDireccionMode();
    if (alta) {
      if (cfg.forceClear) {
        el.direccionVerificada.value = "";
      } else {
        el.direccionVerificada.value = c.direccion_alterna || "";
      }
      return;
    }
    el.direccionVerificada.value = c.direccion_completa || "";
  }

  function makeIdempotency(idContribuyente) {
    const uid = Number(state.user && state.user.id_usuario) || 0;
    const hasRandomUuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function";
    const r = (hasRandomUuid ? crypto.randomUUID() : String(Date.now()) + String(Math.random()).slice(2)).replace(/-/g, "");
    return "campo:" + uid + ":" + Number(idContribuyente || 0) + ":" + r.slice(0, 32);
  }

  async function enqueue(payload, contrib, blocked, reason) {
    const nowIso = new Date().toISOString();
    await idbPut(STORE_QUEUE, {
      idempotency_key: payload.idempotency_key,
      user_id: Number(state.user && state.user.id_usuario) || 0,
      created_at: nowIso,
      blocked: blocked ? 1 : 0,
      retry_count: 0,
      next_retry_at: nowIso,
      last_attempt_at: null,
      last_error: reason || null,
      contribuyente_ref: { id_contribuyente: Number(contrib.id_contribuyente || 0), codigo_municipal: contrib.codigo_municipal || null, nombre_completo: contrib.nombre_completo || null },
      payload: payload
    });
    await refreshQueueCount();
  }

  async function sendSolicitud(payload) {
    return api("/campo/solicitudes", {
      method: "POST",
      headers: authHeaders({ "Idempotency-Key": payload.idempotency_key }),
      body: payload
    });
  }

  function resetForm() {
    el.visitadoSn.value = "N"; el.cortadoSn.value = "N"; el.fechaCorte.value = ""; el.motivoObs.value = "";
    el.aguaSn.value = "S"; el.desagueSn.value = "S";
    if (el.limpiezaSn) el.limpiezaSn.value = "S";
    if (el.tipoSolicitud) el.tipoSolicitud.value = TIPOS_SOLICITUD.ACTUALIZACION;
    renderTipoSolicitudHint();
    el.nombreVerificado.value = ""; el.dniVerificado.value = ""; el.direccionVerificada.value = ""; el.inspector.value = String((state.user && state.user.nombre) || "");
    if (el.duplicateWarning) {
      el.duplicateWarning.textContent = "";
      el.duplicateWarning.classList.add("hidden");
    }
  }

  async function submitSolicitud(ev) {
    ev.preventDefault();
    if (!(state.user && state.token)) { setStatus("Debes iniciar sesion.", "warning"); return; }
    if (requiresFreshSnapshotForOfflineWork()) {
      setStatus("Operacion bloqueada offline: sincroniza snapshot reciente antes de registrar.", "warning", 5000);
      return;
    }
    const c = selectedContrib();
    if (!c) { setStatus("Selecciona un contribuyente.", "warning"); return; }
    const dup = duplicateSummary(c.id_contribuyente);
    if (dup.has) {
      const latestTxt = dup.latestAt ? fmtAgo(dup.latestAt) : "sin fecha";
      const confirmMsg =
        "Ya existe actividad reciente para este contribuyente (cola: " + dup.queued +
        ", enviados: " + dup.recent + ", ultimo: " + latestTxt + ").\n\n" +
        "Deseas registrar otra solicitud?";
      if (!window.confirm(confirmMsg)) return;
    }

    const key = makeIdempotency(c.id_contribuyente);
    const obs = String(el.motivoObs.value || "").trim();
    const tipoSolicitud = normalizeTipoSolicitud(el.tipoSolicitud && el.tipoSolicitud.value, TIPOS_SOLICITUD.ACTUALIZACION);
    const direccionVerificada = String(el.direccionVerificada.value || "").trim();
    if (tipoSolicitud === TIPOS_SOLICITUD.ALTA_DIRECCION_ALTERNA && !direccionVerificada) {
      setStatus("Para direccion adicional debes registrar una direccion nueva.", "warning", 5000);
      return;
    }
    const payload = {
      id_contribuyente: Number(c.id_contribuyente),
      tipo_solicitud: tipoSolicitud,
      agua_sn: normalizeSN(el.aguaSn.value, "S"),
      desague_sn: normalizeSN(el.desagueSn.value, "S"),
      limpieza_sn: normalizeSN(el.limpiezaSn && el.limpiezaSn.value, "S"),
      visitado_sn: String(el.visitadoSn.value || "N").toUpperCase() === "S" ? "S" : "N",
      cortado_sn: String(el.cortadoSn.value || "N").toUpperCase() === "S" ? "S" : "N",
      fecha_corte: String(el.fechaCorte.value || "").trim() || null,
      inspector: String(el.inspector.value || "").trim() || String((state.user && state.user.nombre) || ""),
      motivo_obs: obs || null,
      observacion_campo: obs || null,
      nombre_verificado: String(el.nombreVerificado.value || "").trim() || null,
      dni_verificado: String(el.dniVerificado.value || "").trim() || null,
      direccion_verificada: direccionVerificada || null,
      idempotency_key: key,
      metadata: {
        app: "campo-app-pwa",
        idempotency_key: key,
        tipo_solicitud: tipoSolicitud,
        created_offline_at: new Date().toISOString()
      }
    };

    el.submitSolicitudBtn.disabled = true;
    try {
      if (state.online) {
        const data = await sendSolicitud(payload);
        rememberRecentSubmission(c.id_contribuyente, "online", "enviado");
        setStatus((data && data.mensaje) || "Solicitud enviada.", "success");
      } else {
        await enqueue(payload, c, false, "offline");
        setStatus("Sin internet. Solicitud en cola offline.", "warning", 5000);
      }
    } catch (err) {
      if (!state.online || err.isNetworkError || err.status >= 500 || err.status === 401 || err.status === 403) {
        await enqueue(payload, c, false, err.message || "pendiente");
        setStatus("No se pudo enviar. Solicitud guardada en cola offline.", "warning", 6000);
      } else {
        setStatus(err.message || "No se pudo registrar la solicitud.", "error", 6000);
        return;
      }
    } finally {
      el.submitSolicitudBtn.disabled = false;
    }

    state.selectedId = 0;
    resetForm();
    renderResults();
    closeForm();
    await refreshQueueCount();
    if (state.online) syncQueue(false).catch((e) => console.error(e));
  }

  async function syncQueue(manual) {
    if (state.syncing) return;
    if (!state.online) { if (manual) setStatus("Sin internet.", "warning"); return; }
    if (!state.token) { if (manual) setStatus("Debes iniciar sesion.", "warning"); return; }
    state.syncing = true;
    state.lastQueueSyncAt = new Date().toISOString();
    state.lastQueueSyncError = "";
    el.syncQueueBtn.disabled = true;
    renderHealthPanel();
    try {
      const allRows = await queueByUser(state.user && state.user.id_usuario);
      const activeRows = allRows.filter((x) => Number(x.blocked || 0) !== 1);
      const nowMs = Date.now();
      const rows = manual ? activeRows : activeRows.filter((x) => queueItemReady(x, nowMs));
      if (!rows.length) {
        await refreshQueueCount();
        if (manual) {
          if (allRows.length > 0) setStatus("No hay pendientes enviables: revisa los elementos bloqueados.", "warning", 5000);
          else setStatus("No hay pendientes.", "success");
        }
        return;
      }
      let sent = 0;
      let stoppedReason = "";
      for (const item of rows) {
        try {
          await sendSolicitud(item.payload);
          await idbDel(STORE_QUEUE, item.idempotency_key);
          rememberRecentSubmission(item && item.payload && item.payload.id_contribuyente, "sync", "auto");
          sent += 1;
        } catch (err) {
          if (err.status === 401 || err.status === 403 || err.isNetworkError || err.status >= 500) {
            const retryCount = queueItemRetryCount(item) + 1;
            const nextRetryAt = new Date(Date.now() + calcRetryDelayMs(retryCount)).toISOString();
            await idbPut(STORE_QUEUE, Object.assign({}, item, {
              blocked: 0,
              retry_count: retryCount,
              next_retry_at: nextRetryAt,
              last_attempt_at: new Date().toISOString(),
              last_error: err.message || "reintento_diferido"
            }));
            stoppedReason = err.message || "conexion interrumpida";
            break;
          }
          await idbPut(STORE_QUEUE, Object.assign({}, item, {
            blocked: 1,
            last_attempt_at: new Date().toISOString(),
            last_error: err.message || "error_no_reintentar"
          }));
        }
      }
      await refreshQueueCount();
      if (sent > 0) {
        state.lastQueueSyncOkAt = new Date().toISOString();
        setStatus("Pendientes enviados: " + sent + ".", "success");
      }
      if (stoppedReason) state.lastQueueSyncError = stoppedReason;
      else if (sent === 0 && manual) setStatus("No se pudo enviar pendientes en este intento.", "warning", 5000);
    } catch (err) {
      state.lastQueueSyncError = err.message || "error_sync_queue";
      if (manual) setStatus(state.lastQueueSyncError, "error", 5000);
    } finally {
      state.syncing = false;
      el.syncQueueBtn.disabled = false;
      renderHealthPanel();
    }
  }

  async function login(ev) {
    ev.preventDefault();
    const username = String(el.username.value || "").trim();
    const password = String(el.password.value || "");
    if (!username || !password) { setStatus("Completa usuario y contrasena.", "warning"); return; }
    const btn = el.loginForm.querySelector("button[type='submit']");
    if (btn) btn.disabled = true;
    try {
      const data = await api("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: { username: username, password: password } });
      if (!hasMinRole(data && data.rol, "BRIGADA")) { setStatus("El usuario no tiene permisos para campo.", "error", 5000); return; }
      const token = String((data && data.token) || "").trim();
      const idUsuario = Number(data && data.id_usuario);
      if (!token || !Number.isFinite(idUsuario) || idUsuario <= 0) {
        setStatus("Respuesta de login incompleta. Contacta al administrador.", "error", 5000);
        return;
      }
      state.token = token;
      state.user = { id_usuario: idUsuario, nombre: String(data.nombre || "").trim(), rol: normalizeRole(data.rol) || String(data.rol || "").trim().toUpperCase() };
      state.queueActionKey = "";
      state.lastQueueSyncError = "";
      localStorage.setItem(TOKEN_KEY, state.token);
      localStorage.setItem(USER_KEY, JSON.stringify(state.user));
      el.password.value = "";
      renderAuth();
      await loadLocalData();
      await refreshQueueCount();
      if (state.online && !state.snapshot) await syncSnapshot(true);
      if (state.online) await syncQueue(false);
      setStatus("Sesion iniciada.", "success", 2000);
    } catch (err) {
      setStatus(err.message || "No se pudo iniciar sesion.", "error", 5000);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function logout() {
    state.token = ""; state.user = null;
    state.queueActionKey = "";
    state.lastQueueSyncAt = null;
    state.lastQueueSyncOkAt = null;
    state.lastQueueSyncError = "";
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
    await refreshQueueCount();
    renderAuth();
    setStatus("Sesion cerrada.", "success", 1500);
  }

  function bind() {
    el.loginForm.addEventListener("submit", (e) => login(e).catch((err) => console.error(err)));
    el.logoutBtn.addEventListener("click", () => logout().catch((err) => console.error(err)));
    el.saveApiBtn.addEventListener("click", () => { state.apiBase = normalizeBase(el.apiBaseUrl.value); localStorage.setItem(API_BASE_KEY, state.apiBase); el.apiConfigCard.classList.toggle("hidden", state.apiBase === window.location.origin); setStatus("URL API guardada: " + state.apiBase, "success"); });
    el.syncOfflineBtn.addEventListener("click", () => syncSnapshot(false).catch((err) => console.error(err)));
    el.syncQueueBtn.addEventListener("click", () => syncQueue(true).catch((err) => console.error(err)));
    if (el.refreshQueueBtn) el.refreshQueueBtn.addEventListener("click", () => refreshQueueCount().catch((err) => console.error(err)));
    el.searchInput.addEventListener("input", queueSearch);
    el.streetFilter.addEventListener("change", queueSearch);
    if (el.tipoSolicitud) {
      el.tipoSolicitud.addEventListener("change", () => {
        renderTipoSolicitudHint();
        syncDireccionFieldForTipo({ forceClear: isAltaDireccionMode() });
      });
    }
    el.solicitudForm.addEventListener("submit", (e) => submitSolicitud(e).catch((err) => console.error(err)));
    window.addEventListener("online", () => { state.online = true; updateInfo(); syncQueue(false).catch((err) => console.error(err)); });
    window.addEventListener("offline", () => { state.online = false; updateInfo(); });
    if (!queueAutoSyncTimer) {
      queueAutoSyncTimer = setInterval(() => {
        if (state.online && state.token) syncQueue(false).catch((err) => console.error(err));
      }, 30000);
    }
  }

  function registerSw() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch((err) => console.error("SW:", err)));
  }

  async function init() {
    if (!el.loginForm) return;
    el.apiBaseUrl.value = state.apiBase;
    state.recentSubmissions = pruneRecentSubmissions(parseJson(localStorage.getItem(RECENT_SUBMISSIONS_KEY)) || []);
    saveRecentSubmissions();
    el.apiConfigCard.classList.toggle("hidden", state.apiBase === window.location.origin);
    bind();
    registerSw();
    resetForm();
    parkFormHidden();
    await loadLocalData();
    await refreshQueueCount();
    renderAuth();
    if (state.token && state.user && state.online) {
      if (!state.snapshot) await syncSnapshot(true);
      await syncQueue(false);
    }
  }

  init().catch((err) => { console.error(err); setStatus("No se pudo iniciar App Campo.", "error", 6000); });
})();
