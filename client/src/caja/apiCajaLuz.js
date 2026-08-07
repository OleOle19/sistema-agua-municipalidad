import axios from "axios";
import { API_BASE_URL } from "../api";
import { AGUA_TOKEN_KEY, getSessionToken, LEGACY_TOKEN_KEY } from "../utils/sessionAuth";

const cajaLuzApi = axios.create({
  baseURL: `${API_BASE_URL}/luz`,
  timeout: 60000
});

cajaLuzApi.interceptors.request.use((config) => {
  const token = getSessionToken(AGUA_TOKEN_KEY, LEGACY_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default cajaLuzApi;
