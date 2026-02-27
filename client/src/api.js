import axios from "axios";

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
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
