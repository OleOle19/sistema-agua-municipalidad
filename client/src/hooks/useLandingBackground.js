import { useEffect, useState } from "react";
import { API_BASE_URL } from "../api";

const LANDING_SETTINGS_PUBLIC_URL = `${API_BASE_URL}/ui/landing-settings-public`;
const LANDING_BACKGROUND_CACHE_KEY = "landing_public_background_cache_v1";

const toAbsoluteImageUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${API_BASE_URL}${raw.startsWith("/") ? raw : `/${raw}`}`;
};

const readCachedBackground = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LANDING_BACKGROUND_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const imageUrl = String(parsed?.imageUrl || "").trim();
    if (!imageUrl) return null;
    return {
      imageUrl,
      hasCustomImage: true
    };
  } catch {
    return null;
  }
};

const writeCachedBackground = (imageUrl) => {
  if (typeof window === "undefined") return;
  try {
    if (!imageUrl) {
      window.localStorage.removeItem(LANDING_BACKGROUND_CACHE_KEY);
      return;
    }
    window.localStorage.setItem(LANDING_BACKGROUND_CACHE_KEY, JSON.stringify({
      imageUrl,
      savedAt: Date.now()
    }));
  } catch {
    // Ignore cache write failures; visual behavior still works with live fetches.
  }
};

export default function useLandingBackground(defaultImageUrl = "") {
  const cached = readCachedBackground();
  const [state, setState] = useState(() => ({
    imageUrl: cached?.imageUrl || "",
    hasCustomImage: Boolean(cached?.hasCustomImage),
    isReady: Boolean(cached?.hasCustomImage)
  }));

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch(LANDING_SETTINGS_PUBLIC_URL, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store"
        });
        if (!response.ok) {
          setState((prev) => ({
            imageUrl: prev.imageUrl || defaultImageUrl,
            hasCustomImage: prev.hasCustomImage,
            isReady: true
          }));
          return;
        }

        const payload = await response.json();
        const customImageUrl = toAbsoluteImageUrl(payload?.image_url);

        if (customImageUrl) {
          writeCachedBackground(customImageUrl);
          setState({
            imageUrl: customImageUrl,
            hasCustomImage: true,
            isReady: true
          });
          return;
        }

        writeCachedBackground("");
        setState({
          imageUrl: defaultImageUrl,
          hasCustomImage: false,
          isReady: true
        });
      } catch (error) {
        if (error?.name === "AbortError") return;
        setState((prev) => ({
          imageUrl: prev.imageUrl || defaultImageUrl,
          hasCustomImage: prev.hasCustomImage,
          isReady: true
        }));
      }
    };

    load();

    return () => controller.abort();
  }, [defaultImageUrl]);

  return {
    resolvedImageUrl: state.imageUrl,
    hasCustomImage: state.hasCustomImage,
    isReady: state.isReady
  };
}
