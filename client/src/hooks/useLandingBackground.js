import { useEffect, useState } from "react";
import { API_BASE_URL } from "../api";

const LANDING_SETTINGS_PUBLIC_URL = `${API_BASE_URL}/ui/landing-settings-public`;
const LANDING_BACKGROUND_CACHE_KEY = "landing_public_background_cache_v2";
const LANDING_BACKGROUND_OLD_CACHE_KEY = "landing_public_background_cache_v1";

const toAbsoluteMediaUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${API_BASE_URL}${raw.startsWith("/") ? raw : `/${raw}`}`;
};

const inferMediaTypeFromUrl = (value = "") => {
  const cleanUrl = String(value || "").split("?")[0].split("#")[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v)$/i.test(cleanUrl)) return "video";
  return "image";
};

const normalizeMediaType = (value = "", mediaUrl = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "video" || raw === "image") return raw;
  return inferMediaTypeFromUrl(mediaUrl);
};

const readCachedBackground = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LANDING_BACKGROUND_CACHE_KEY)
      || window.localStorage.getItem(LANDING_BACKGROUND_OLD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const mediaUrl = String(parsed?.mediaUrl || parsed?.imageUrl || "").trim();
    if (!mediaUrl) return null;
    const mediaType = normalizeMediaType(parsed?.mediaType, mediaUrl);
    return {
      mediaUrl,
      mediaType,
      hasCustomMedia: true
    };
  } catch {
    return null;
  }
};

const writeCachedBackground = (mediaUrl, mediaType = "image") => {
  if (typeof window === "undefined") return;
  try {
    if (!mediaUrl) {
      window.localStorage.removeItem(LANDING_BACKGROUND_CACHE_KEY);
      window.localStorage.removeItem(LANDING_BACKGROUND_OLD_CACHE_KEY);
      return;
    }
    window.localStorage.setItem(LANDING_BACKGROUND_CACHE_KEY, JSON.stringify({
      mediaUrl,
      mediaType: normalizeMediaType(mediaType, mediaUrl),
      savedAt: Date.now()
    }));
  } catch {
    // Ignore cache write failures; visual behavior still works with live fetches.
  }
};

export default function useLandingBackground(defaultImageUrl = "") {
  const [state, setState] = useState(() => {
    const cached = readCachedBackground();
    return {
      mediaUrl: cached?.mediaUrl || "",
      mediaType: cached?.mediaType || "image",
      hasCustomMedia: Boolean(cached?.hasCustomMedia),
      isReady: Boolean(cached?.hasCustomMedia)
    };
  });

  useEffect(() => {
    const controller = new AbortController();
    const cached = readCachedBackground();
    if (cached?.mediaUrl) {
      setState({
        mediaUrl: cached.mediaUrl,
        mediaType: cached.mediaType,
        hasCustomMedia: true,
        isReady: true
      });
    }

    const load = async () => {
      try {
        const response = await fetch(LANDING_SETTINGS_PUBLIC_URL, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store"
        });
        if (!response.ok) {
          setState((prev) => ({
            mediaUrl: prev.mediaUrl || defaultImageUrl,
            mediaType: prev.mediaType || "image",
            hasCustomMedia: prev.hasCustomMedia,
            isReady: true
          }));
          return;
        }

        const payload = await response.json();
        const customMediaUrl = toAbsoluteMediaUrl(payload?.media_url || payload?.video_url || payload?.image_url);
        const customMediaType = normalizeMediaType(payload?.media_type, customMediaUrl);

        if (customMediaUrl) {
          writeCachedBackground(customMediaUrl, customMediaType);
          setState({
            mediaUrl: customMediaUrl,
            mediaType: customMediaType,
            hasCustomMedia: true,
            isReady: true
          });
          return;
        }

        writeCachedBackground("", "image");
        setState({
          mediaUrl: defaultImageUrl,
          mediaType: "image",
          hasCustomMedia: false,
          isReady: true
        });
      } catch (error) {
        if (error?.name === "AbortError") return;
        setState((prev) => ({
          mediaUrl: prev.mediaUrl || defaultImageUrl,
          mediaType: prev.mediaType || "image",
          hasCustomMedia: prev.hasCustomMedia,
          isReady: true
        }));
      }
    };

    load();

    return () => controller.abort();
  }, [defaultImageUrl]);

  const mediaType = state.mediaType || "image";

  return {
    resolvedMediaUrl: state.mediaUrl,
    mediaType,
    hasCustomMedia: state.hasCustomMedia,
    resolvedImageUrl: mediaType === "image" ? state.mediaUrl : defaultImageUrl,
    hasCustomImage: state.hasCustomMedia && mediaType === "image",
    isReady: state.isReady
  };
}
