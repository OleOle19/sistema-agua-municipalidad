import { useEffect, useMemo, useState } from "react";
import api, { API_BASE_URL } from "../api";

const PUBLIC_SETTINGS_URL = `${API_BASE_URL}/ui/landing-settings-public`;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILE_MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));
const SUPPORTED_BACKGROUND_LABEL = "JPG, PNG, WEBP, GIF, MP4, WEBM, MOV o M4V";

const toAbsoluteMediaUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${API_BASE_URL}${raw.startsWith("/") ? raw : `/${raw}`}`;
};

const inferMediaTypeFromName = (value = "") => {
  const cleanName = String(value || "").split("?")[0].split("#")[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v)$/i.test(cleanName)) return "video";
  if (/\.(jpe?g|png|webp|gif)$/i.test(cleanName)) return "image";
  return "";
};

const normalizeMediaType = (value = "", mediaUrl = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "video" || raw === "image") return raw;
  return inferMediaTypeFromName(mediaUrl) || "image";
};

const getFileMediaType = (file) => {
  const mime = String(file?.type || "").trim().toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return inferMediaTypeFromName(file?.name);
};

const buildConfigFromPayload = (payload = {}) => {
  const mediaUrl = String(payload?.media_url || payload?.video_url || payload?.image_url || "").trim();
  const mediaType = normalizeMediaType(payload?.media_type, mediaUrl);
  return {
    media_url: mediaUrl,
    media_type: mediaType,
    image_url: String(payload?.image_url || "").trim(),
    video_url: String(payload?.video_url || "").trim(),
    using_default: Boolean(payload?.using_default),
    updated_at: String(payload?.updated_at || "").trim()
  };
};

const DEFAULT_CONFIG = {
  media_url: "",
  media_type: "image",
  image_url: "",
  video_url: "",
  using_default: true,
  updated_at: ""
};

export default function ModalFondoInicio({ cerrarModal, onFlash }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorLocal, setErrorLocal] = useState("");

  useEffect(() => {
    let isMounted = true;
    const loadConfig = async () => {
      try {
        setLoading(true);
        const response = await fetch(PUBLIC_SETTINGS_URL, { cache: "no-store" });
        if (!response.ok) throw new Error("No se pudo cargar la configuracion actual.");
        const payload = await response.json();
        if (!isMounted) return;
        setConfig(buildConfigFromPayload(payload));
      } catch (error) {
        if (!isMounted) return;
        setErrorLocal(error?.message || "No se pudo cargar el fondo actual.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadConfig();
    return () => {
      isMounted = false;
    };
  }, []);

  const previewUrl = useMemo(() => {
    if (selectedFile) return URL.createObjectURL(selectedFile);
    return toAbsoluteMediaUrl(config?.media_url);
  }, [config?.media_url, selectedFile]);

  const previewMediaType = useMemo(() => {
    if (selectedFile) return getFileMediaType(selectedFile) || "image";
    return normalizeMediaType(config?.media_type, config?.media_url);
  }, [config?.media_type, config?.media_url, selectedFile]);

  useEffect(() => {
    return () => {
      if (selectedFile) {
        try {
          URL.revokeObjectURL(previewUrl);
        } catch {
          // Ignore preview cleanup errors during modal teardown.
        }
      }
    };
  }, [previewUrl, selectedFile]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setErrorLocal("");
    if (!file) {
      setSelectedFile(null);
      return;
    }

    const nextMediaType = getFileMediaType(file);
    if (nextMediaType !== "image" && nextMediaType !== "video") {
      setSelectedFile(null);
      setErrorLocal(`Seleccione una imagen o video valido (${SUPPORTED_BACKGROUND_LABEL}).`);
      event.target.value = "";
      return;
    }
    if (Number(file.size || 0) > MAX_FILE_BYTES) {
      setSelectedFile(null);
      setErrorLocal(`El archivo excede el limite de ${MAX_FILE_MB} MB.`);
      event.target.value = "";
      return;
    }
    setSelectedFile(file);
  };

  const handleGuardar = async () => {
    if (!selectedFile) {
      setErrorLocal("Seleccione una imagen o video antes de guardar.");
      return;
    }
    try {
      setSaving(true);
      setErrorLocal("");
      const formData = new FormData();
      formData.append("background", selectedFile);
      const response = await api.post("/admin/ui/landing-background", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      const payload = response?.data || {};
      setConfig(buildConfigFromPayload(payload));
      setSelectedFile(null);
      onFlash?.("success", payload?.mensaje || "Fondo del inicio actualizado.");
      cerrarModal?.();
    } catch (error) {
      setErrorLocal(error?.response?.data?.error || "No se pudo guardar el nuevo fondo.");
    } finally {
      setSaving(false);
    }
  };

  const handleRestaurar = async () => {
    try {
      setSaving(true);
      setErrorLocal("");
      const response = await api.delete("/admin/ui/landing-background");
      const payload = response?.data || {};
      setConfig(DEFAULT_CONFIG);
      setSelectedFile(null);
      onFlash?.("info", payload?.mensaje || "Se restauro el fondo predeterminado.");
      cerrarModal?.();
    } catch (error) {
      setErrorLocal(error?.response?.data?.error || "No se pudo restaurar el fondo predeterminado.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
      <div className="modal-dialog modal-lg modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Fondo del Inicio</h5>
            <button type="button" className="btn-close" onClick={cerrarModal} aria-label="Cerrar"></button>
          </div>

          <div className="modal-body">
            <p className="small text-muted mb-3">
              Suba una imagen o un video para el selector principal. Si sube un video, se reproducira en bucle para todos los usuarios.
            </p>

            {errorLocal && (
              <div className="alert alert-warning py-2">{errorLocal}</div>
            )}

            {loading ? (
              <div className="py-4 text-center">
                <div className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></div>
                <span>Cargando fondo actual...</span>
              </div>
            ) : (
              <>
                <div className="mb-3">
                  <div className="small fw-semibold mb-2">Vista previa actual</div>
                  <div
                    className="rounded border overflow-hidden"
                    style={{
                      minHeight: "240px",
                      background: "linear-gradient(135deg, #d9e8f5, #f7fafc)"
                    }}
                  >
                    {previewUrl ? (
                      previewMediaType === "video" ? (
                        <video
                          key={previewUrl}
                          src={previewUrl}
                          className="d-block w-100"
                          style={{ minHeight: "240px", maxHeight: "360px", objectFit: "cover" }}
                          autoPlay
                          muted
                          loop
                          playsInline
                          controls
                        />
                      ) : (
                        <img
                          src={previewUrl}
                          alt="Vista previa del fondo"
                          className="d-block w-100"
                          style={{ minHeight: "240px", maxHeight: "360px", objectFit: "cover" }}
                        />
                      )
                    ) : (
                      <div className="d-flex align-items-center justify-content-center h-100 py-5 text-muted">
                        Usando fondo predeterminado del sistema
                      </div>
                    )}
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label fw-semibold">Nueva imagen o video</label>
                  <input
                    type="file"
                    className="form-control"
                    accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.webm,.mov,.m4v"
                    onChange={handleFileChange}
                    disabled={saving}
                  />
                  <div className="form-text">
                    Formatos permitidos: {SUPPORTED_BACKGROUND_LABEL}. Tamano maximo: {MAX_FILE_MB} MB.
                  </div>
                </div>

                <div className="small text-muted">
                  Estado actual: {config.using_default ? "Predeterminado" : `Personalizado (${previewMediaType === "video" ? "video en bucle" : "imagen"})`}
                </div>
              </>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={cerrarModal} disabled={saving}>
              Cerrar
            </button>
            <button type="button" className="btn btn-outline-danger" onClick={handleRestaurar} disabled={saving || loading}>
              Restaurar predeterminado
            </button>
            <button type="button" className="btn btn-primary" onClick={handleGuardar} disabled={saving || loading || !selectedFile}>
              {saving ? "Guardando..." : "Guardar fondo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
