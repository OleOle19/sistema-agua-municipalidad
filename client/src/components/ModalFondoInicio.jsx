import { useEffect, useMemo, useState } from "react";
import api, { API_BASE_URL } from "../api";

const PUBLIC_SETTINGS_URL = `${API_BASE_URL}/ui/landing-settings-public`;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

export default function ModalFondoInicio({ cerrarModal, darkMode = false, onFlash }) {
  const [config, setConfig] = useState({ image_url: "", using_default: true, updated_at: "" });
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
        setConfig({
          image_url: String(payload?.image_url || "").trim(),
          using_default: Boolean(payload?.using_default),
          updated_at: String(payload?.updated_at || "").trim()
        });
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
    const currentUrl = String(config?.image_url || "").trim();
    return currentUrl ? `${API_BASE_URL}${currentUrl}` : "";
  }, [config?.image_url, selectedFile]);

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
    if (!String(file.type || "").startsWith("image/")) {
      setErrorLocal("Seleccione una imagen valida (JPG, PNG, WEBP o GIF).");
      event.target.value = "";
      return;
    }
    if (Number(file.size || 0) > MAX_FILE_BYTES) {
      setErrorLocal("La imagen excede el limite de 12 MB.");
      event.target.value = "";
      return;
    }
    setSelectedFile(file);
  };

  const handleGuardar = async () => {
    if (!selectedFile) {
      setErrorLocal("Seleccione una imagen antes de guardar.");
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
      setConfig({
        image_url: String(payload?.image_url || "").trim(),
        using_default: Boolean(payload?.using_default),
        updated_at: String(payload?.updated_at || "").trim()
      });
      setSelectedFile(null);
      onFlash?.("success", payload?.mensaje || "Fondo del inicio actualizado.");
      cerrarModal?.();
    } catch (error) {
      setErrorLocal(error?.response?.data?.error || "No se pudo guardar la nueva imagen.");
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
      setConfig({
        image_url: "",
        using_default: true,
        updated_at: ""
      });
      setSelectedFile(null);
      onFlash?.("info", payload?.mensaje || "Se restauro la imagen predeterminada.");
      cerrarModal?.();
    } catch (error) {
      setErrorLocal(error?.response?.data?.error || "No se pudo restaurar la imagen predeterminada.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
      <div className="modal-dialog modal-lg modal-dialog-centered">
        <div className={`modal-content ${darkMode ? "bg-dark text-white border-secondary" : ""}`}>
          <div className="modal-header">
            <h5 className="modal-title">Fondo del Inicio</h5>
            <button type="button" className="btn-close" onClick={cerrarModal} aria-label="Cerrar"></button>
          </div>

          <div className="modal-body">
            <p className={`small mb-3 ${darkMode ? "text-light" : "text-muted"}`}>
              Cambie la imagen del selector principal. La nueva imagen se aplicara para todos los usuarios.
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
                      background: previewUrl
                        ? `center / cover no-repeat url(${previewUrl})`
                        : darkMode
                          ? "linear-gradient(135deg, #0b1220, #10253a)"
                          : "linear-gradient(135deg, #d9e8f5, #f7fafc)"
                    }}
                  >
                    {!previewUrl && (
                      <div className={`d-flex align-items-center justify-content-center h-100 py-5 ${darkMode ? "text-light" : "text-muted"}`}>
                        Usando imagen predeterminada del sistema
                      </div>
                    )}
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label fw-semibold">Nueva imagen</label>
                  <input
                    type="file"
                    className="form-control"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleFileChange}
                    disabled={saving}
                  />
                  <div className={`form-text ${darkMode ? "text-light" : ""}`}>
                    Formatos permitidos: JPG, PNG, WEBP o GIF. Tamano maximo: 12 MB.
                  </div>
                </div>

                <div className={`small ${darkMode ? "text-light" : "text-muted"}`}>
                  Estado actual: {config.using_default ? "Predeterminado" : "Personalizado"}
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
              {saving ? "Guardando..." : "Guardar imagen"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
