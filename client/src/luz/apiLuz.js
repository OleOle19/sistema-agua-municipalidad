import axios from "axios";
import { API_BASE_URL } from "../api";
import { getSessionToken, LUZ_TOKEN_KEY } from "../utils/sessionAuth";

const luzApi = axios.create({
  baseURL: `${API_BASE_URL}/luz`,
  timeout: 60000
});

luzApi.interceptors.request.use((config) => {
  const token = getSessionToken(LUZ_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default luzApi;
