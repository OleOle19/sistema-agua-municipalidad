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
  const ROLES = { BRIGADA: 1, CAJERO: 2, ADMIN_SEC: 3, ADMIN: 4 };

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
    queueList: document.getElementById("queueList"),
    searchInput: document.getElementById("searchInput"),
    streetFilter: document.getElementById("streetFilter"),
    searchResults: document.getElementById("searchResults"),
    solicitudForm: document.getElementById("solicitudForm"),
    selectedInfo: document.getElementById("selectedInfo"),
    nombreVerificado: document.getElementById("nombreVerificado"),
    dniVerificado: document.getElementById("dniVerificado"),
    direccionVerificada: document.getElementById("direccionVerificada"),
    aguaSn: document.getElementById("aguaSn"),
    desagueSn: document.getElementById("desagueSn"),
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
    filtered: [],
    selectedId: 0,
    queueCount: 0,
    queueItems: [],
    queueActionKey: "",
    syncing: false,
    snapshot: null,
    warnedNoSnapshotOffline: false,
    warnedSnapshotExpired: false
  };

  let dbPromise = null;
  let searchTimer = null;
  let statusTimer = null;

  function parseJson(v) { try { return v ? JSON.parse(v) : null; } catch { return null; } }
  function normalizeBase(v) { try { return new URL(String(v || "").trim() || window.location.origin).origin; } catch { return window.location.origin; } }
  function hasMinRole(role, minRole) { return (ROLES[String(role || "").toUpperCase()] || 0) >= (ROLES[minRole] || 0); }
  function fmtMoney(v) { const n = Number(v || 0); return Number.isFinite(n) ? n.toFixed(2) : "0.00"; }
  function norm(v) { return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
  function normalizeSN(value, fallback) {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "S" || normalized === "SI") return "S";
    if (normalized === "N" || normalized === "NO") return "N";
    return String(fallback || "S").trim().toUpperCase() === "N" ? "N" : "S";
  }
  function toDateMs(value) { const ms = Date.parse(String(value || "")); return Number.isFinite(ms) ? ms : 0; }
  function fmtDateTime(value) { const ms = toDateMs(value); return ms ? new Date(ms).toLocaleString("es-PE") : "sin fecha"; }
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
      state.queueItems = [];
      el.selectedInfo.textContent = "";
      el.solicitudForm.classList.remove("open");
      el.solicitudForm.classList.add("hidden");
      el.searchResults.innerHTML = "";
      if (el.queueList) el.queueList.innerHTML = '<p class="muted">Inicia sesion para ver pendientes.</p>';
    }
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
    updateOperationalLock();
  }

  function updateOperationalLock() {
    const blocked = requiresFreshSnapshotForOfflineWork();
    if (el.searchInput) el.searchInput.disabled = blocked;
    if (el.streetFilter) el.streetFilter.disabled = blocked;
    if (el.submitSolicitudBtn) el.submitSolicitudBtn.disabled = blocked;
    if (blocked) {
      state.filtered = [];
      state.selectedId = 0;
      el.searchResults.innerHTML = '<div class="muted">Operacion bloqueada offline: sincroniza snapshot reciente antes de trabajar en campo.</div>';
      el.solicitudForm.classList.remove("open");
      el.solicitudForm.classList.add("hidden");
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
  async function queueByUser(userId) { if (!userId) return []; const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE_QUEUE, "readonly"); const i = tx.objectStore(STORE_QUEUE).index("by_user"); const r = i.getAll(IDBKeyRange.only(Number(userId))); r.onsuccess = () => resolve(Array.isArray(r.result) ? r.result.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) : []); r.onerror = () => reject(r.error); }); }

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
    return Number(item && item.blocked || 0) === 1 ? "blocked" : "pending";
  }

  function queueStatusLabel(item) {
    return Number(item && item.blocked || 0) === 1 ? "BLOQUEADO" : "PENDIENTE";
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
        await idbPut(STORE_QUEUE, Object.assign({}, item, { blocked: 0, last_error: "sin_conexion" }));
        setStatus("Sin internet. Pendiente marcado para reintento automatico.", "warning", 4500);
      } else {
        await sendSolicitud(item.payload);
        await idbDel(STORE_QUEUE, idempotencyKey);
        setStatus("Pendiente enviado correctamente.", "success", 3000);
      }
    } catch (err) {
      const hardError = !(err.status === 401 || err.status === 403 || err.isNetworkError || err.status >= 500);
      await idbPut(STORE_QUEUE, Object.assign({}, item, {
        blocked: hardError ? 1 : 0,
        last_error: err.message || "reintento_fallido"
      }));
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
      meta2.textContent = "Error: " + (item.last_error || "sin error");
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
      return;
    }
    const frag = document.createDocumentFragment();
    state.filtered.forEach((c) => {
      const id = Number(c.id_contribuyente || 0);
      const item = document.createElement("article");
      item.className = "result-item" + (id === state.selectedId ? " is-selected" : "");
      const t = document.createElement("strong"); t.textContent = (c.codigo_municipal || "SIN-CODIGO") + " - " + (c.nombre_completo || "Sin nombre");
      const d = document.createElement("div"); d.className = "meta"; d.textContent = c.direccion_completa || c.nombre_calle || "Sin direccion";
      const m = document.createElement("div"); m.className = "meta"; m.textContent = "Meses deuda: " + Number(c.meses_deuda || 0) + " | Total: S/ " + fmtMoney(c.deuda_total);
      const b = document.createElement("button");
      b.type = "button"; b.textContent = id === state.selectedId ? "Seleccionado" : "Seleccionar";
      b.addEventListener("click", () => {
        const aguaSn = normalizeSN(c.agua_sn, "S");
        const desagueSn = normalizeSN(c.desague_sn, "S");
        state.selectedId = id;
        el.selectedInfo.textContent =
          "Seleccionado: " + (c.codigo_municipal || "SIN-CODIGO") + " - " + (c.nombre_completo || "Sin nombre") +
          " | Servicios: Agua " + aguaSn + " | Desague " + desagueSn + " | Limpieza SI (fijo)";
        el.nombreVerificado.value = c.nombre_completo || "";
        el.dniVerificado.value = c.dni_ruc || "";
        el.direccionVerificada.value = c.direccion_completa || "";
        el.aguaSn.value = aguaSn;
        el.desagueSn.value = desagueSn;
        el.inspector.value = String((state.user && state.user.nombre) || "");
        el.solicitudForm.classList.remove("hidden");
        requestAnimationFrame(() => el.solicitudForm.classList.add("open"));
        renderResults();
      });
      item.appendChild(t); item.appendChild(d); item.appendChild(m); item.appendChild(b); frag.appendChild(item);
    });
    el.searchResults.appendChild(frag);
  }

  function closeForm() {
    if (state.selectedId) return;
    el.solicitudForm.classList.remove("open");
    setTimeout(() => { if (!state.selectedId) el.solicitudForm.classList.add("hidden"); }, 260);
  }

  function localSearch(qRaw, idCalleRaw) {
    const q = norm(qRaw);
    const idCalle = Number(idCalleRaw || 0);
    if (!idCalle && q.length < 2) return [];
    const rows = [];
    for (const c of state.contribuyentes) {
      if (idCalle && Number(c.id_calle || 0) !== idCalle) continue;
      if (q.length >= 2) {
        const hit = [c.nombre_completo, c.dni_ruc, c.codigo_municipal, c.direccion_completa, c.nombre_calle].some((x) => norm(x).includes(q));
        if (!hit) continue;
      }
      rows.push(c);
      if (rows.length >= 300) break;
    }
    return rows;
  }

  async function search() {
    if (requiresFreshSnapshotForOfflineWork()) {
      state.filtered = [];
      renderResults();
      closeForm();
      setStatus("Operacion bloqueada offline: sincroniza snapshot reciente antes de trabajar.", "warning", 5000);
      return;
    }
    const q = String(el.searchInput.value || "").trim();
    const idCalle = Number(el.streetFilter.value || 0);
    if (!idCalle && q.length < 2) {
      state.filtered = []; state.selectedId = 0; renderResults(); closeForm(); return;
    }
    if (state.online && state.token) {
      try {
        const p = new URLSearchParams(); if (q.length >= 2) p.set("q", q); if (idCalle) p.set("id_calle", String(idCalle)); p.set("limit", "250");
        const rows = await api("/campo/contribuyentes/buscar?" + p.toString(), { headers: authHeaders() });
        state.filtered = Array.isArray(rows) ? rows : [];
      } catch (err) {
        if (err.status === 401 || err.status === 403) setStatus("Sesion expirada. Ingresa nuevamente.", "warning", 5000);
        state.filtered = localSearch(q, idCalle);
      }
    } else {
      state.filtered = localSearch(q, idCalle);
    }
    if (!state.filtered.some((x) => Number(x.id_contribuyente) === Number(state.selectedId))) { state.selectedId = 0; closeForm(); }
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
    updateInfo();
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
    return state.filtered.find((x) => Number(x.id_contribuyente) === id) || state.contribuyentes.find((x) => Number(x.id_contribuyente) === id) || null;
  }

  function makeIdempotency(idContribuyente) {
    const uid = Number(state.user && state.user.id_usuario) || 0;
    const hasRandomUuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function";
    const r = (hasRandomUuid ? crypto.randomUUID() : String(Date.now()) + String(Math.random()).slice(2)).replace(/-/g, "");
    return "campo:" + uid + ":" + Number(idContribuyente || 0) + ":" + r.slice(0, 32);
  }

  async function enqueue(payload, contrib, blocked, reason) {
    await idbPut(STORE_QUEUE, {
      idempotency_key: payload.idempotency_key,
      user_id: Number(state.user && state.user.id_usuario) || 0,
      created_at: new Date().toISOString(),
      blocked: blocked ? 1 : 0,
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
    el.nombreVerificado.value = ""; el.dniVerificado.value = ""; el.direccionVerificada.value = ""; el.inspector.value = String((state.user && state.user.nombre) || "");
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

    const key = makeIdempotency(c.id_contribuyente);
    const obs = String(el.motivoObs.value || "").trim();
    const payload = {
      id_contribuyente: Number(c.id_contribuyente),
      agua_sn: normalizeSN(el.aguaSn.value, "S"),
      desague_sn: normalizeSN(el.desagueSn.value, "S"),
      visitado_sn: String(el.visitadoSn.value || "N").toUpperCase() === "S" ? "S" : "N",
      cortado_sn: String(el.cortadoSn.value || "N").toUpperCase() === "S" ? "S" : "N",
      fecha_corte: String(el.fechaCorte.value || "").trim() || null,
      inspector: String(el.inspector.value || "").trim() || String((state.user && state.user.nombre) || ""),
      motivo_obs: obs || null,
      observacion_campo: obs || null,
      nombre_verificado: String(el.nombreVerificado.value || "").trim() || null,
      dni_verificado: String(el.dniVerificado.value || "").trim() || null,
      direccion_verificada: String(el.direccionVerificada.value || "").trim() || null,
      idempotency_key: key,
      metadata: { app: "campo-app-pwa", idempotency_key: key, created_offline_at: new Date().toISOString() }
    };

    el.submitSolicitudBtn.disabled = true;
    try {
      if (state.online) {
        const data = await sendSolicitud(payload);
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
    state.syncing = true; el.syncQueueBtn.disabled = true;
    try {
      const allRows = await queueByUser(state.user && state.user.id_usuario);
      const rows = allRows.filter((x) => Number(x.blocked || 0) !== 1);
      if (!rows.length) {
        await refreshQueueCount();
        if (manual) {
          if (allRows.length > 0) setStatus("No hay pendientes enviables: revisa los elementos bloqueados.", "warning", 5000);
          else setStatus("No hay pendientes.", "success");
        }
        return;
      }
      let sent = 0;
      for (const item of rows) {
        try {
          await sendSolicitud(item.payload);
          await idbDel(STORE_QUEUE, item.idempotency_key);
          sent += 1;
        } catch (err) {
          if (err.status === 401 || err.status === 403 || err.isNetworkError || err.status >= 500) break;
          await idbPut(STORE_QUEUE, Object.assign({}, item, { blocked: 1, last_error: err.message || "error_no_reintentar" }));
        }
      }
      await refreshQueueCount();
      if (sent > 0) setStatus("Pendientes enviados: " + sent + ".", "success");
      else if (manual) setStatus("No se pudo enviar pendientes en este intento.", "warning", 5000);
    } finally {
      state.syncing = false; el.syncQueueBtn.disabled = false;
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
      state.token = String(data.token || "");
      state.user = { id_usuario: Number(data.id_usuario || 0), nombre: String(data.nombre || "").trim(), rol: String(data.rol || "").trim().toUpperCase() };
      state.queueActionKey = "";
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
    el.solicitudForm.addEventListener("submit", (e) => submitSolicitud(e).catch((err) => console.error(err)));
    window.addEventListener("online", () => { state.online = true; updateInfo(); syncQueue(false).catch((err) => console.error(err)); });
    window.addEventListener("offline", () => { state.online = false; updateInfo(); });
  }

  function registerSw() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch((err) => console.error("SW:", err)));
  }

  async function init() {
    if (!el.loginForm) return;
    el.apiBaseUrl.value = state.apiBase;
    el.apiConfigCard.classList.toggle("hidden", state.apiBase === window.location.origin);
    bind();
    registerSw();
    resetForm();
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
