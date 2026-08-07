import axios from "axios";
import { AGUA_TOKEN_KEY, getSessionToken, LEGACY_TOKEN_KEY } from "./utils/sessionAuth";

const envBaseUrl = String(import.meta.env.VITE_API_URL || "").trim();
const fallbackBaseUrl =
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "http://localhost:5000";
export const API_BASE_URL = (envBaseUrl || fallbackBaseUrl).replace(/\/$/, "");

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000
});

api.interceptors.request.use((config) => {
  const token = getSessionToken(AGUA_TOKEN_KEY, LEGACY_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
