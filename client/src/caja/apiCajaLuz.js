import axios from "axios";
import { API_BASE_URL } from "../api";

const cajaLuzApi = axios.create({
  baseURL: `${API_BASE_URL}/luz`,
  timeout: 60000
});

cajaLuzApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("token_agua") || localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default cajaLuzApi;
