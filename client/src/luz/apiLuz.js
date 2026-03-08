import axios from "axios";
import { API_BASE_URL } from "../api";

const luzApi = axios.create({
  baseURL: `${API_BASE_URL}/luz`,
  timeout: 60000
});

luzApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("token_luz");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default luzApi;
